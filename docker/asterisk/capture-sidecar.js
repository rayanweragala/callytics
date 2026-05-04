#!/usr/bin/env node

const { spawn } = require('child_process');
const readline = require('readline');

const SIP_CAPTURE_STREAM = 'callytics:sip-capture';
const SIP_CAPTURE_MAXLEN = 500;
const RETRY_DELAY_MS = 5000;

const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env.REDIS_PORT || '6379';
const tsharkPortRaw = process.env.TSHARK_PORT || '5060';
const tsharkPort = Number.parseInt(tsharkPortRaw, 10);
const sipCapturePort = Number.isFinite(tsharkPort) && tsharkPort > 0 ? String(tsharkPort) : '5060';

let shuttingDown = false;
let tsharkProcess = null;
let lineReader = null;

if (process.env.TSHARK_ENABLED !== 'true') {
  console.log('[capture-sidecar] TSHARK_ENABLED is not true; sidecar exiting');
  process.exit(0);
}

function readValue(source, keys) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim().length > 0);
      if (typeof first === 'string') {
        return first;
      }
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function formatTimestamp(raw) {
  if (!raw) {
    return '00:00:00.000';
  }

  const numeric = Number(raw);
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return '00:00:00.000';
  }

  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function resolveDirection(layers) {
  if (!layers || typeof layers !== 'object') {
    return 'in';
  }

  const udp = layers.udp && typeof layers.udp === 'object' ? layers.udp : layers;
  const srcPort = readValue(udp, ['udp.srcport', 'tcp.srcport', 'udp_udp_srcport', 'tcp_tcp_srcport']);
  const dstPort = readValue(udp, ['udp.dstport', 'tcp.dstport', 'udp_udp_dstport', 'tcp_tcp_dstport']);
  if (srcPort === sipCapturePort && dstPort !== sipCapturePort) {
    return 'out';
  }

  return 'in';
}

function parseSipPacket(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return null;
  }

  const layers = payload.layers || payload;
  const sip = layers.sip && typeof layers.sip === 'object' ? layers.sip : layers;
  const frame = layers.frame && typeof layers.frame === 'object' ? layers.frame : layers;

  const callId = readValue(sip, [
    'sip.Call-ID',
    'sip.call_id',
    'sip.call-id',
    'call_id',
    'sip_sip_Call-ID',
    'sip_sip_call_id_generated',
  ]);
  if (!callId) {
    return null;
  }

  const statusCodeRaw = readValue(sip, [
    'sip.Status-Code',
    'sip.status_code',
    'sip.response.code',
    'sip_sip_Status-Code',
  ]);
  const statusCode = statusCodeRaw ? Number.parseInt(statusCodeRaw, 10) : undefined;
  const requestMethod = readValue(sip, [
    'sip.Method',
    'sip.method',
    'sip.CSeq.method',
    'sip_sip_Method',
    'sip_sip_CSeq_method',
  ]);
  const method = Number.isFinite(statusCode) ? String(statusCode) : (requestMethod || 'UNKNOWN');

  return {
    timestamp: formatTimestamp(readValue(frame, ['frame.time_epoch', 'timestamp', '@timestamp', 'frame_frame_time_epoch'])),
    method,
    from: readValue(sip, ['sip.From', 'sip.from', 'sip.from.addr', 'sip.from.user', 'sip_sip_From', 'sip_sip_from_addr', 'sip_sip_from_user']) || 'unknown',
    to: readValue(sip, ['sip.To', 'sip.to', 'sip.to.addr', 'sip.to.user', 'sip_sip_To', 'sip_sip_to_addr', 'sip_sip_to_user']) || 'unknown',
    callId,
    direction: resolveDirection(layers),
    statusCode: Number.isFinite(statusCode) ? statusCode : '',
    rawJson: JSON.stringify(payload),
  };
}

async function runRedisCommand(args) {
  await new Promise((resolve, reject) => {
    const command = spawn('redis-cli', ['-h', redisHost, '-p', redisPort, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    command.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    command.on('error', reject);
    command.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `redis-cli exited with code ${String(code)}`));
    });
  });
}

async function writePacket(packet) {
  const xaddArgs = [
    'XADD',
    SIP_CAPTURE_STREAM,
    '*',
    'timestamp',
    packet.timestamp,
    'method',
    packet.method,
    'from',
    packet.from,
    'to',
    packet.to,
    'callId',
    packet.callId,
    'direction',
    packet.direction,
    'statusCode',
    packet.statusCode === undefined ? '' : String(packet.statusCode),
    'rawJson',
    packet.rawJson,
  ];

  await runRedisCommand(xaddArgs);
  await runRedisCommand(['XTRIM', SIP_CAPTURE_STREAM, 'MAXLEN', String(SIP_CAPTURE_MAXLEN)]);
}

function startTshark() {
  if (shuttingDown) {
    return;
  }

  console.log(`[capture-sidecar] starting tshark capture loop on UDP port ${sipCapturePort}`);
  tsharkProcess = spawn('tshark', ['-i', 'any', '-f', `udp port ${sipCapturePort}`, '-T', 'ek', '-l'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  tsharkProcess.on('error', (error) => {
    console.error(`[capture-sidecar] tshark spawn failed: ${error.message}`);
  });

  tsharkProcess.stderr.on('data', (chunk) => {
    const message = chunk.toString('utf8').trim();
    if (message) {
      console.warn(`[capture-sidecar] tshark stderr: ${message}`);
    }
  });

  lineReader = readline.createInterface({ input: tsharkProcess.stdout });
  lineReader.on('line', (line) => {
    const packet = parseSipPacket(line);
    if (!packet) {
      return;
    }

    void writePacket(packet).catch((error) => {
      console.warn(`[capture-sidecar] failed to write packet to redis: ${error.message}`);
    });
  });

  tsharkProcess.on('close', (code, signal) => {
    if (lineReader) {
      lineReader.removeAllListeners();
      lineReader.close();
      lineReader = null;
    }

    tsharkProcess = null;

    if (shuttingDown) {
      console.log('[capture-sidecar] shutdown complete');
      return;
    }

    console.error(`[capture-sidecar] tshark exited unexpectedly (code=${String(code)} signal=${String(signal)}), retrying in 5s`);
    setTimeout(() => {
      startTshark();
    }, RETRY_DELAY_MS);
  });
}

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log('[capture-sidecar] shutting down');

  if (lineReader) {
    lineReader.removeAllListeners();
    lineReader.close();
    lineReader = null;
  }

  if (tsharkProcess) {
    tsharkProcess.kill('SIGTERM');
    setTimeout(() => {
      if (tsharkProcess) {
        tsharkProcess.kill('SIGKILL');
      }
    }, 2000).unref();
    return;
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startTshark();
