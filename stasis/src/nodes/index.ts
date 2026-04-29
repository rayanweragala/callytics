import { parsePhoneNumber, type CountryCode } from "libphonenumber-js";
import { CallSession } from "../callSession";
import { FlowNode } from "../flowLoader";
import { resolveAudioMediaPath } from "../audioResolver";
import { publishNodeTelemetry } from "../telemetry";
import {
  registerTransferWaiter,
  rejectTransferWaiter,
  type TransferWaiterResult,
} from "../transferManager";
import { executeHunt } from "./hunt.executor";
import { executeMenu } from "../executors/menu.executor";
import { executeBusinessHours } from "../executors/business_hours.executor";
import { executeVoicemail } from "../executors/voicemail.executor";
import { executeQueueLogin } from "../executors/queue_login.executor";
import { executeQueue } from "../executors/queue.executor";
import { executeCallbackNode } from "./callback.executor";
import { executeConference } from "./conference.executor";
import { logEvent } from "../logger";
import { INTER_DIGIT_TIMEOUT_MS, resolveNodeTimeoutMs } from "../timeoutResolver";

type PlaybackTarget =
  | {
      kind: "channel";
      id: string;
      play: (
        opts: { media: string },
        playback: { id: string; stop?: () => Promise<void> },
      ) => Promise<void>;
    }
  | { kind: "bridge"; id: string };

async function executeStart(): Promise<string> {
  return "default";
}

function waitForPlaybackFinished(
  ariClient: unknown,
  playbackId: string,
  channelId: string,
): Promise<void> {
  const client = ariClient as {
    on: (
      event: string,
      listener: (event: {
        playback?: { id?: string };
        channel?: { id?: string };
      }) => void,
    ) => void;
    removeListener: (
      event: string,
      listener: (event: {
        playback?: { id?: string };
        channel?: { id?: string };
      }) => void,
    ) => void;
  };

  return new Promise((resolve, reject) => {
    const onFinished = (event: { playback?: { id?: string } }) => {
      if (event.playback?.id === playbackId) {
        cleanup();
        resolve();
      }
    };

    const onHangup = (event: { channel?: { id?: string } }) => {
      if (event.channel?.id === channelId) {
        cleanup();
        reject(new Error("hangup"));
      }
    };

    const cleanup = () => {
      client.removeListener("PlaybackFinished", onFinished);
      client.removeListener("StasisEnd", onHangup);
      client.removeListener("ChannelDestroyed", onHangup);
    };

    client.on("PlaybackFinished", onFinished);
    client.on("StasisEnd", onHangup);
    client.on("ChannelDestroyed", onHangup);
  });
}

function getPlaybackTarget(
  channel: {
    id: string;
    play: (
      opts: { media: string },
      playback: { id: string; stop?: () => Promise<void> },
    ) => Promise<void>;
  },
  session: CallSession,
): PlaybackTarget {
  if (session.inboundBridge) {
    return { kind: "bridge", id: session.inboundBridge.id };
  }
  return { kind: "channel", id: channel.id, play: channel.play };
}

async function stopLiveRecording(name: string): Promise<void> {
  const ariUrl = (process.env.ARI_URL || "http://127.0.0.1:8088").replace(
    /\/+$/,
    "",
  );
  const ariUser = process.env.ARI_USER || "callytics";
  const ariPass = process.env.ARI_PASS || "callytics";
  const response = await fetch(
    `${ariUrl}/ari/recordings/live/${encodeURIComponent(name)}/stop`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${ariUser}:${ariPass}`).toString("base64")}`,
      },
    },
  );

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `record_stop_failed status=${response.status} body=${body}`,
    );
  }
}

async function playMedia(
  target: PlaybackTarget,
  ariClient: unknown,
  media: string,
  playback: { id: string; stop?: () => Promise<void> },
): Promise<void> {
  if (target.kind === "channel") {
    await target.play({ media }, playback);
    return;
  }

  const client = ariClient as {
    bridges: {
      play: (params: {
        bridgeId: string;
        media: string;
        playbackId?: string;
        announcer_format?: string;
      }) => Promise<void>;
    };
  };

  await client.bridges.play({
    bridgeId: target.id,
    media,
    playbackId: playback.id,
    announcer_format: "ulaw",
  });
}

async function executePlayAudio(
  channel: {
    id: string;
    play: (opts: { media: string }, playback: { id: string }) => Promise<void>;
  },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  const audioFilePath = await resolveAudioMediaPath(
    node.config,
    "audio_file_id",
    "audio_file_path",
  );

  if (!audioFilePath) {
    return "default";
  }

  const playbackFactory = ariClient as { Playback: () => { id: string } };
  const playback = playbackFactory.Playback();
  const target = getPlaybackTarget(channel as never, session);
  logEvent("PlaybackRequest", { nodeType: "play_audio", target: `${target.kind}:${target.id}`, media: `sound:${audioFilePath}`, channelId: channel.id });
  await playMedia(target, ariClient, "sound:" + audioFilePath, playback);
  logEvent("PlaybackStarted", { nodeType: "play_audio", target: `${target.kind}:${target.id}`, media: `sound:${audioFilePath}`, playbackId: playback.id, channelId: channel.id });
  await waitForPlaybackFinished(ariClient, playback.id, channel.id);
  return "default";
}

async function executeGetDigits(
  channel: {
    id: string;
    play: (
      opts: { media: string },
      playback: { id: string; stop: () => Promise<void> },
    ) => Promise<void>;
    on?: (
      event: string,
      listener: (event: { channel?: { id?: string }; digit?: string }) => void,
    ) => void;
    removeListener?: (
      event: string,
      listener: (event: { channel?: { id?: string }; digit?: string }) => void,
    ) => void;
  },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  logEvent("GetDigitsStart", { channelId: channel.id, timeoutMs: node.config.timeout_ms, promptAudioFileId: node.config.prompt_audio_file_id });
  const promptPath = await resolveAudioMediaPath(
    node.config,
    "prompt_audio_file_id",
    "prompt_path",
  );
  const timeoutMs = resolveNodeTimeoutMs(node, session, 5000);
  const client = ariClient as {
    Playback: () => { id: string; stop: () => Promise<void> };
    on: (
      event: string,
      listener: (event: { channel?: { id?: string }; digit?: string }) => void,
    ) => void;
    removeListener: (
      event: string,
      listener: (event: { channel?: { id?: string }; digit?: string }) => void,
    ) => void;
  };
  const channelEmitter = channel as {
    on?: (
      event: string,
      listener: (event: { channel?: { id?: string }; digit?: string }) => void,
    ) => void;
    removeListener?: (
      event: string,
      listener: (event: { channel?: { id?: string }; digit?: string }) => void,
    ) => void;
  };
  const hasDoubleDigitCondition = session.flow.edges.some(
    (edge) => edge.sourceNodeKey === node.nodeKey && /^\d{2}$/.test(String(edge.condition || '')),
  );

  return new Promise(async (resolve, reject) => {
    const playback = client.Playback();
    let finished = false;
    let timer: NodeJS.Timeout | null = null;
    let interDigitTimer: NodeJS.Timeout | null = null;
    let collectedDigits = '';

    const cleanup = () => {
      client.removeListener("ChannelDtmfReceived", onDtmf);
      channelEmitter.removeListener?.("ChannelDtmfReceived", onDtmf);
      client.removeListener("StasisEnd", onHangup);
      client.removeListener("ChannelDestroyed", onHangup);
      if (timer) clearTimeout(timer);
      if (interDigitTimer) clearTimeout(interDigitTimer);
    };

    const stopPlaybackSafely = async () => {
      await Promise.race([
        playback.stop().catch(() => undefined),
        new Promise<void>((resolveStop) => setTimeout(resolveStop, 250)),
      ]);
    };

    const settle = (value: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      const variableName = String(node.config.variable_name || '').trim();
      if (variableName && /^\d+$/.test(value)) {
        session.variables[variableName] = value;
      }
      logEvent("GetDigitsResult", { channelId: channel.id, result: value });
      resolve(value);
      void stopPlaybackSafely();
    };

    const onDtmf = async (event: {
      channel?: { id?: string };
      digit?: string;
    }) => {
      if (event.channel?.id && event.channel.id !== channel.id) return;
      const digit = String(event.digit || "").trim();
      if (!digit) {
        return;
      }
      logEvent("DtmfReceived", { channelId: channel.id, digit });
      if (!hasDoubleDigitCondition || !/^\d$/.test(digit)) {
        settle(digit);
        return;
      }
      collectedDigits += digit;
      if (collectedDigits.length >= 2) {
        settle(collectedDigits.slice(0, 2));
        return;
      }
      if (interDigitTimer) {
        clearTimeout(interDigitTimer);
      }
      interDigitTimer = setTimeout(() => settle(collectedDigits), INTER_DIGIT_TIMEOUT_MS);
    };

    const onHangup = async (event: { channel?: { id?: string } }) => {
      if (event.channel?.id !== channel.id) return;
      settle("hangup");
    };

    logEvent("DtmfListening", { channelId: channel.id, nodeType: "get_digits" });
    client.on("ChannelDtmfReceived", onDtmf);
    channelEmitter.on?.("ChannelDtmfReceived", onDtmf);
    client.on("StasisEnd", onHangup);
    client.on("ChannelDestroyed", onHangup);

    timer = setTimeout(() => {
      logEvent("GetDigitsTimeout", { channelId: channel.id, timeoutMs });
      settle("timeout");
    }, timeoutMs);

    try {
      if (promptPath) {
        const target = getPlaybackTarget(channel as never, session);
        logEvent("PlaybackRequest", { nodeType: "get_digits", target: `${target.kind}:${target.id}`, media: `sound:${promptPath}`, channelId: channel.id });
        await playMedia(target, ariClient, "sound:" + promptPath, playback);
        logEvent("PlaybackStarted", { nodeType: "get_digits", target: `${target.kind}:${target.id}`, media: `sound:${promptPath}`, playbackId: playback.id, channelId: channel.id });
      }
    } catch (error) {
      reject(error instanceof Error ? error : new Error("get_digits_failed"));
    }
  });
}

async function executeBranch(): Promise<string> {
  return "default";
}

function waitForChannelEnd(
  ariClient: unknown,
  channelIds: string[],
): Promise<string> {
  const client = ariClient as {
    on: (
      event: string,
      listener: (event: { channel?: { id?: string } }) => void,
    ) => void;
    removeListener: (
      event: string,
      listener: (event: { channel?: { id?: string } }) => void,
    ) => void;
  };

  return new Promise((resolve) => {
    const onEnd = (event: { channel?: { id?: string } }) => {
      const endedChannelId = event.channel?.id;
      if (endedChannelId && channelIds.includes(endedChannelId)) {
        cleanup();
        resolve(endedChannelId);
      }
    };

    const cleanup = () => {
      client.removeListener("StasisEnd", onEnd);
      client.removeListener("ChannelDestroyed", onEnd);
    };

    client.on("StasisEnd", onEnd);
    client.on("ChannelDestroyed", onEnd);
  });
}

async function fetchContactNumber(
  contactId: number,
): Promise<{ number: string; trunkId: number | null } | null> {
  try {
    const res = await fetch(
      `http://localhost:3001/contact-numbers/${contactId}`,
    );
    if (!res.ok) {
      return null;
    }
    const payload = (await res.json()) as {
      data?: { number?: string; trunkId?: number | null };
      number?: string;
      trunkId?: number | null;
    };
    const contact = payload?.data || payload;
    return {
      number: String(contact?.number || "").trim(),
      trunkId:
        contact?.trunkId === null || contact?.trunkId === undefined
          ? null
          : Number(contact.trunkId),
    };
  } catch {
    return null;
  }
}

const DEV_FALLBACK_COUNTRY: CountryCode = "LK";
const PSTN_TARGET_PATTERN = /^\+?[0-9]{4,20}$/;

function normalizeDialNumber(rawNumber: string): string {
  let dialNumber = String(rawNumber || "").trim();

  try {
    let parsed: ReturnType<typeof parsePhoneNumber> | undefined;
    try {
      parsed = parsePhoneNumber(dialNumber);
    } catch {
      // TODO: derive default country from contact's trunk region/provider metadata instead of hardcoded fallback.
      parsed = parsePhoneNumber(dialNumber, DEV_FALLBACK_COUNTRY);
    }

    if (parsed && parsed.isValid()) {
      dialNumber = parsed.format("E.164");
    } else {
      logEvent("TransferNumberNormalizeFailed", { number: dialNumber });
    }
  } catch {
    logEvent("TransferNumberParseFailed", { number: dialNumber });
  }

  return dialNumber;
}

async function resolveTransferDialString(
  config: Record<string, unknown>,
): Promise<string> {
  const targetType = String(config.target_type || "").trim();
  const targetValue = String(config.target_value || "").trim();

  if (!targetType || !targetValue) {
    return "";
  }

  if (targetType === "extension") {
    return `PJSIP/${targetValue}`;
  }

  if (targetType === "sip_uri") {
    return `PJSIP/${targetValue}`;
  }

  if (targetType === "pstn") {
    // Schema A: trunk_id + raw PSTN number in config (current editor save).
    const directTrunkId = config.trunk_id ? Number(config.trunk_id) : null;
    if (directTrunkId && PSTN_TARGET_PATTERN.test(targetValue)) {
      const dialNumber = normalizeDialNumber(targetValue);
      logEvent("TransferDirectTrunkResolved", { trunkId: directTrunkId, number: dialNumber });
      return `PJSIP/${dialNumber}@trunk-${directTrunkId}`;
    }

    // Schema B: legacy contact-id target lookup.
    const contactId = parseInt(targetValue, 10);
    if (isNaN(contactId)) {
      logEvent("TransferInvalidContactTarget", { targetValue });
      return "";
    }

    const contact = await fetchContactNumber(contactId);
    if (!contact) {
      logEvent("TransferContactNotFound", { contactId });
      return "";
    }

    if (!contact.trunkId) {
      logEvent("TransferContactMissingTrunk", { contactId });
      return "";
    }

    const dialNumber = normalizeDialNumber(contact.number);
    return `PJSIP/${dialNumber}@trunk-${contact.trunkId}`;
  }

  return "";
}

type TransferPlaybackClient = {
  channels: {
    play: (params: {
      channelId: string;
      media: string;
      offsetms?: number;
    }) => Promise<{ id: string }>;
    hangup: (params: { channelId: string }) => Promise<void>;
  };
  playbacks: {
    stop: (params: { playbackId: string }) => Promise<void>;
  };
};

async function resolveTransferAudioMedia(
  config: Record<string, unknown>,
  idField: string,
): Promise<string | null> {
  return resolveAudioMediaPath(config, idField, "__unused_path");
}

async function playTransferNoAnswerSound(
  transferClient: TransferPlaybackClient,
  ariClient: unknown,
  inboundChannelId: string,
  media: string,
): Promise<void> {
  const playback = await transferClient.channels.play({
    channelId: inboundChannelId,
    media,
    offsetms: 0,
  });
  await waitForPlaybackFinished(ariClient, playback.id, inboundChannelId).catch(
    () => undefined,
  );
}

function startTransferWaitingSoundLoop(
  transferClient: TransferPlaybackClient,
  ariClient: unknown,
  inboundChannelId: string,
  media: string,
): { stop: () => Promise<void> } {
  let looping = true;
  let currentPlaybackId: string | null = null;

  const runLoop = async () => {
    while (looping) {
      try {
        const playback = await transferClient.channels.play({
          channelId: inboundChannelId,
          media,
          offsetms: 0,
        });
        currentPlaybackId = playback.id;
        await waitForPlaybackFinished(
          ariClient,
          playback.id,
          inboundChannelId,
        ).catch(() => undefined);
      } catch {
        break;
      }
    }
  };

  void runLoop();

  return {
    stop: async () => {
      looping = false;
      if (!currentPlaybackId) {
        return;
      }
      try {
        await transferClient.playbacks.stop({ playbackId: currentPlaybackId });
      } catch {}
    },
  };
}

async function executeTransfer(
  channel: { id: string; hangup?: () => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  const targetConfig = node.config as Record<string, unknown>;
  const destination = await resolveTransferDialString(targetConfig);
  const timeoutMs = resolveNodeTimeoutMs(node, session, 30000);
  const onNoAnswer = String(node.config.on_no_answer || "").trim();

  if (!destination) {
    logEvent("TransferMissingDestination", { nodeId: node.nodeKey, channelId: channel.id });
    return "hangup";
  }

  const client = ariClient as {
    channels: {
      originate: (params: {
        endpoint: string;
        app: string;
        appArgs: string;
        callerId: string;
        timeout: number;
      }) => Promise<{ id?: string } | void>;
      hangup: (params: { channelId: string }) => Promise<void>;
      play: (params: {
        channelId: string;
        media: string;
        offsetms?: number;
      }) => Promise<{ id: string }>;
    };
    bridges: {
      create: (params: { type: string }) => Promise<{ id: string }>;
      addChannel: (params: {
        bridgeId: string;
        channel: string;
      }) => Promise<void>;
      destroy: (params: { bridgeId: string }) => Promise<void>;
    };
    playbacks: {
      stop: (params: { playbackId: string }) => Promise<void>;
    };
    on: (
      event: string,
      listener: (event: { channel?: { id?: string } }) => void,
    ) => void;
    removeListener: (
      event: string,
      listener: (event: { channel?: { id?: string } }) => void,
    ) => void;
  };

  if (session.inboundBridge) {
    if (session.recording && !session.recording.endedAt) {
      try {
        await stopLiveRecording(session.recording.name);
      } catch (error) {
        logEvent("RecordingStopFailed", { callId: session.callUuid, fileName: session.recording.fileName, error });
      }
      session.recording.endedAt = new Date();
    }
    try {
      await client.bridges.destroy({ bridgeId: session.inboundBridge.id });
      logEvent("BridgeDestroyed", { bridgeId: session.inboundBridge.id, channelCountAtDestroy: 1 });
    } catch (error) {
      logEvent("BridgeDestroyFailed", { bridgeId: session.inboundBridge.id, error });
    }
    session.inboundBridge = null;
  }

  const waitForAnswer = registerTransferWaiter(channel.id);
  const appName = process.env.ARI_APP || "callytics";

  let waitForAnswerSettled = false;
  let outboundChannelId: string | null = null;
  let outboundCleanupTriggered = false;

  const waitingSoundMediaPath = await resolveTransferAudioMedia(
    targetConfig,
    "waiting_sound_id",
  );
  const noAnswerSoundMediaPath = await resolveTransferAudioMedia(
    targetConfig,
    "no_answer_sound_id",
  );
  let waitingSoundLoop: { stop: () => Promise<void> } | null = null;

  const onInboundEndedWhileRinging = (event: { channel?: { id?: string } }) => {
    if (event.channel?.id !== channel.id) {
      return;
    }
    if (waitForAnswerSettled || outboundCleanupTriggered) {
      return;
    }
    outboundCleanupTriggered = true;
    if (outboundChannelId) {
      void client.channels.hangup({ channelId: outboundChannelId }).catch(() => undefined);
    }
    rejectTransferWaiter(channel.id, "caller_disconnected");
  };

  const removeInboundRingingListeners = () => {
    client.removeListener("StasisEnd", onInboundEndedWhileRinging);
    client.removeListener("ChannelDestroyed", onInboundEndedWhileRinging);
  };

  try {
    const originateResult = await client.channels.originate({
      endpoint: destination,
      app: appName,
      appArgs: `transfer-outbound,${channel.id}`,
      callerId: session.callerNumber,
      timeout: Math.ceil(timeoutMs / 1000),
    });
    if (originateResult && typeof originateResult === "object") {
      outboundChannelId =
        "id" in originateResult && typeof originateResult.id === "string"
          ? originateResult.id
          : null;
    }

    client.on("StasisEnd", onInboundEndedWhileRinging);
    client.on("ChannelDestroyed", onInboundEndedWhileRinging);

    if (waitingSoundMediaPath) {
      waitingSoundLoop = startTransferWaitingSoundLoop(
        client,
        ariClient,
        channel.id,
        `sound:${waitingSoundMediaPath}`,
      );
    }

    const transferResult: TransferWaiterResult = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        rejectTransferWaiter(channel.id, "timeout");
        resolve({
          answered: false,
          reason: "timeout",
        });
      }, timeoutMs);

      waitForAnswer
        .then((result) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(result);
        })
        .catch(() => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve({
            answered: false,
            reason: "failed",
          });
        });
    });
    waitForAnswerSettled = true;
    removeInboundRingingListeners();

    if (waitingSoundLoop) {
      await waitingSoundLoop.stop();
      waitingSoundLoop = null;
    }

    if (transferResult.answered === false) {
      const reason = transferResult.reason;
      logEvent("TransferNoAnswer", { destination, reason, channelId: channel.id });

      if (reason !== "caller_disconnected" && noAnswerSoundMediaPath) {
        await playTransferNoAnswerSound(
          client,
          ariClient,
          channel.id,
          `sound:${noAnswerSoundMediaPath}`,
        );
      }

      if (reason === "caller_disconnected") {
        return "hangup";
      }

      return onNoAnswer ? `route:${onNoAnswer}` : "hangup";
    }

    const outboundChannel = transferResult.channel;

    const bridge = await client.bridges.create({ type: "mixing" });
    await client.bridges.addChannel({
      bridgeId: bridge.id,
      channel: channel.id,
    });
    await client.bridges.addChannel({
      bridgeId: bridge.id,
      channel: outboundChannel.id,
    });
    const endedChannelId = await waitForChannelEnd(ariClient, [
      channel.id,
      outboundChannel.id,
    ]);
    const survivingChannel = endedChannelId === channel.id ? outboundChannel : channel;
    if (survivingChannel?.hangup) {
      await survivingChannel.hangup().catch(() => undefined);
    }
    try {
      await client.bridges.destroy({ bridgeId: bridge.id });
    } catch {}
    return "done";
  } catch (error) {
    waitForAnswerSettled = true;
    removeInboundRingingListeners();
    if (waitingSoundLoop) {
      await waitingSoundLoop.stop();
      waitingSoundLoop = null;
    }
    logEvent("TransferFailed", { channelId: channel.id, error });
    return onNoAnswer ? `route:${onNoAnswer}` : "hangup";
  }
}

async function executeHangup(channel: {
  hangup: () => Promise<void>;
}): Promise<string> {
  try {
    await channel.hangup();
  } catch {}
  return "done";
}

async function executeSetVariable(
  node: FlowNode,
  session: CallSession,
): Promise<string> {
  const variableName = String(node.config.variable_name || "");
  const variableValue = String(node.config.variable_value || "");
  if (variableName) session.variables[variableName] = variableValue;
  return "default";
}

type NodeExecutor = (
  channel: {
    id: string;
    play: (
      opts: { media: string },
      playback: { id: string; stop?: () => Promise<void> },
    ) => Promise<void>;
    hangup: () => Promise<void>;
  },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
) => Promise<string>;

const executorMap: Record<string, NodeExecutor> = {
  start: async () => executeStart(),
  play_audio: executePlayAudio,
  get_digits: executeGetDigits,
  menu: executeMenu,
  business_hours: async (_channel, node) => executeBusinessHours(node),
  branch: async () => executeBranch(),
  transfer: executeTransfer,
  hunt: executeHunt,
  voicemail: executeVoicemail,
  hangup: async (channel) => executeHangup(channel),
  set_variable: async (_channel, node, session) =>
    executeSetVariable(node, session),
  queue_login: executeQueueLogin,
  queue: executeQueue,
  conference: executeConference,
  callback: executeCallbackNode,
};

function nodeExecConfig(node: FlowNode): Record<string, unknown> {
  if (node.type === "conference") {
    return {
      roomName: node.config.roomName,
      waitForModerator: Boolean(node.config.waitForModerator),
    };
  }
  if (node.type === "queue" || node.type === "queue_login") {
    return { queue_id: node.config.queue_id };
  }
  if (node.type === "transfer") {
    return {
      target_type: node.config.target_type,
      target_value: node.config.target_value,
    };
  }
  if (node.type === "hunt") {
    return { destinations: Array.isArray(node.config.destinations) ? node.config.destinations.length : 0 };
  }
  if (node.type === "play_audio") {
    return {
      audio_file_id: node.config.audio_file_id,
      audio_file_path: node.config.audio_file_path,
    };
  }
  return {};
}

export async function executeNode(
  channel: {
    id: string;
    play: (
      opts: { media: string },
      playback: { id: string; stop?: () => Promise<void> },
    ) => Promise<void>;
    hangup: () => Promise<void>;
  },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  logEvent("NodeExec", {
    nodeType: node.type,
    nodeId: node.nodeKey,
    channelId: channel.id,
    callerId: session.callerNumber,
    config: nodeExecConfig(node),
  });
  await publishNodeTelemetry(session, node, "started");

  try {
    if (node.type === "group") {
      // visual-only node — never executed at runtime
      return "default";
    }

    const executor = executorMap[node.type];
    if (!executor) {
      logEvent("UnknownNodeType", { nodeType: node.type, nodeId: node.nodeKey, channelId: channel.id });
      await publishNodeTelemetry(session, node, "completed", {
        result: "default",
      });
      return "default";
    }

    const result = await executor(channel, node, session, ariClient);
    await publishNodeTelemetry(session, node, "completed", { result });
    return result;
  } catch (error) {
    logEvent("NodeExecFailed", { nodeType: node.type, nodeId: node.nodeKey, channelId: channel.id, error });
    session.variables.__last_node_error__ =
      error instanceof Error ? error.message : "unknown error";
    await publishNodeTelemetry(session, node, "error", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return "hangup";
  }
}
