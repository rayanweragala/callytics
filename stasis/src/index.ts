import { logEvent, stasisLogger } from "./logger";
import * as dotenv from "dotenv";
dotenv.config();

import * as ari from "ari-client";
import {
  addSession,
  createSession,
  getSession,
  removeSession,
} from "./callSession";
import { loadFlow, loadFlowById } from "./flowLoader";
import migrate from "./migrate";
import { runFlow } from "./runtime";
import seed from "./seed";
import { startAmiMonitor } from "./amiMonitor";
import { startSipTrafficMonitor } from "./sipTrafficMonitor";
import {
  publishCallEndTelemetry,
  publishSipTraffic,
  publishCallEvent,
} from "./telemetry";
import { resolveTransferWaiter, rejectTransferWaiter } from "./transferManager";
import { resolveHuntWaiter, rejectHuntWaiter, hasHuntWaiter } from "./huntManager";
import { resolveCallbackWaiter, hasCallbackWaiter } from "./callbackManager";
import { resolveAudioMediaPath } from "./audioResolver";
import { getPublisher, getSubscriber } from "./redis";
import { buildInboundOriginateBody, parseInboundTestMessage } from "./trunk-test.util";
import { accumulator as rtcpAmiAccumulator } from "./handlers/rtcp-ami.handler";
import { CampaignExecutor } from "./campaign-executor";
import { executeCallback, type CallbackExecutePayload } from "./callback-execute";

const ARI_URL = process.env.ARI_URL || "http://127.0.0.1:8088";
const ARI_USER = process.env.ARI_USER || "callytics";
const ARI_PASS = process.env.ARI_PASS || "callytics";
const ARI_APP = process.env.ARI_APP || "callytics";
const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3001";
const RECORDINGS_INTERNAL_TOKEN = process.env.RECORDINGS_INTERNAL_TOKEN || "";
const TEST_STATUS_TTL_SECONDS = 300;

const failedCalls = new Set<string>();
const testCallStates = new Map<
  string,
  { testCallId: string; type: "outbound" | "inbound"; answered: boolean }
>();

interface TrunkTestOutboundEvent {
  trunkId: number;
  number: string;
  audioFileId: number | null;
  testCallId: string;
}

interface TestPlaybackChannel {
  id: string;
  play: (opts: { media: string }, playback: { id: string }) => Promise<void>;
  hangup: () => Promise<void>;
}

function buildAriUrl(path: string, query?: Record<string, string>): string {
  const trimmedBase = ARI_URL.replace(/\/+$/, "");
  const url = new URL(`${trimmedBase}/ari${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function ariRequest(
  path: string,
  options: RequestInit = {},
  query?: Record<string, string>,
): Promise<Response> {
  return fetch(buildAriUrl(path, query), {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${ARI_USER}:${ARI_PASS}`).toString("base64")}`,
      ...(options.headers || {}),
    },
  });
}

async function setTrunkTestStatus(
  redis: { set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown> },
  testCallId: string,
  status: "dialing" | "answered" | "completed" | "failed",
  reason: string | null = null,
): Promise<void> {
  await redis.set(
    `trunk:test:${testCallId}:status`,
    JSON.stringify({ status, reason }),
    { EX: TEST_STATUS_TTL_SECONDS },
  );
}

function waitForPlaybackFinished(
  ariClient: {
    on: (event: string, listener: (event: { playback?: { id?: string } }) => void) => void;
    removeListener: (event: string, listener: (event: { playback?: { id?: string } }) => void) => void;
  },
  playbackId: string,
): Promise<void> {
  return new Promise((resolve) => {
    const onFinished = (event: { playback?: { id?: string } }) => {
      if (event.playback?.id !== playbackId) {
        return;
      }
      ariClient.removeListener("PlaybackFinished", onFinished);
      resolve();
    };
    ariClient.on("PlaybackFinished", onFinished);
  });
}

async function runOutboundTestPlayback(
  channel: TestPlaybackChannel,
  ariClient: {
    Playback: () => { id: string };
    on: (event: string, listener: (event: { playback?: { id?: string } }) => void) => void;
    removeListener: (event: string, listener: (event: { playback?: { id?: string } }) => void) => void;
  },
  audioFileId: number | null,
): Promise<void> {
  const mediaPath = audioFileId && audioFileId > 0
    ? await resolveAudioMediaPath({ audio_file_id: audioFileId }, "audio_file_id", "audio_file_path")
    : null;

  const playback = ariClient.Playback();
  const media = mediaPath ? `sound:${mediaPath}` : "sound:beep";
  await channel.play({ media }, playback);
  await waitForPlaybackFinished(ariClient, playback.id);
  await channel.hangup().catch(() => undefined);
}

async function resolveInboundRoute(
  did: string,
): Promise<{ did: string; flowId: number } | null> {
  const url = new URL(`${BACKEND_URL}/inbound-routes`);
  url.searchParams.set("did", did);
  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `route_lookup_failed status=${response.status} body=${body}`,
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ did?: string; flowId?: number }>;
  };
  const route = payload.data?.[0];
  if (!route?.did || typeof route.flowId !== "number") {
    return null;
  }

  return {
    did: route.did,
    flowId: route.flowId,
  };
}

async function startBridgeRecording(
  bridgeId: string,
  callId: string,
): Promise<{
  name: string;
  fileName: string;
  filePath: string;
  format: string;
  startedAt: Date;
  endedAt: Date | null;
}> {
  const name = callId;
  const format = "wav";
  const startedAt = new Date();
  stasisLogger.log(
    `[recording] start request bridge=${bridgeId} call_id=${callId} at=${startedAt.toISOString()}`,
  );

  const response = await ariRequest(
    `/bridges/${encodeURIComponent(bridgeId)}/record`,
    { method: "POST" },
    {
      name,
      format,
      maxDurationSeconds: "3600",
      maxSilenceSeconds: "0",
      ifExists: "overwrite",
      beep: "false",
      terminateOn: "none",
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `record_start_failed status=${response.status} body=${body}`,
    );
  }

  stasisLogger.log(
    `[recording] start ok bridge=${bridgeId} call_id=${callId} at=${new Date().toISOString()}`,
  );
  return {
    name,
    fileName: `${name}.${format}`,
    filePath: `/var/lib/asterisk/recording/${name}.${format}`,
    format,
    startedAt,
    endedAt: null,
  };
}

async function createInboundBridge(
  ariClient: unknown,
  channelId: string,
): Promise<{ id: string }> {
  const client = ariClient as {
    bridges: {
      create: (params: {
        type: string;
        name?: string;
      }) => Promise<{ id: string }>;
      addChannel: (params: {
        bridgeId: string;
        channel: string;
      }) => Promise<void>;
    };
  };

  const bridge = await client.bridges.create({
    type: "mixing",
    name: `inbound-${channelId}`,
  });
  await client.bridges.addChannel({ bridgeId: bridge.id, channel: channelId });
  logEvent("BridgeCreated", { bridgeId: bridge.id, bridgeType: "mixing" });
  return { id: bridge.id };
}

async function destroyInboundBridge(
  ariClient: unknown,
  bridgeId: string,
): Promise<void> {
  const client = ariClient as {
    bridges: {
      destroy: (params: { bridgeId: string }) => Promise<void>;
    };
  };

  try {
    await client.bridges.destroy({ bridgeId });
    logEvent("BridgeDestroyed", { bridgeId, channelCountAtDestroy: 0 });
  } catch (error) {
    stasisLogger.error(`[bridge] destroy failed bridge=${bridgeId}:`, error);
  }
}

async function stopInboundRecording(name: string): Promise<void> {
  const response = await ariRequest(
    `/recordings/live/${encodeURIComponent(name)}/stop`,
    { method: "POST" },
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

async function persistRecording(session: {
  callUuid: string;
  channelId: string;
  flow: { id: number };
  recording: {
    name: string;
    fileName: string;
    filePath: string;
    format: string;
    startedAt: Date;
    endedAt: Date | null;
  } | null;
}): Promise<void> {
  if (!session.recording) {
    return;
  }

  const endedAt = session.recording.endedAt || new Date();
  const durationSeconds = Math.max(
    0,
    Math.round(
      (endedAt.getTime() - session.recording.startedAt.getTime()) / 1000,
    ),
  );

  if (!session.recording.endedAt) {
    try {
      await stopInboundRecording(session.recording.name);
    } catch (error) {
      stasisLogger.error(
        `[recording] stop failed call_id=${session.callUuid} file=${session.recording.fileName}:`,
        error,
      );
    }
  }

  const response = await fetch(`${BACKEND_URL}/recordings/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": RECORDINGS_INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      callId: session.callUuid,
      channelId: session.channelId,
      flowId: session.flow.id,
      fileName: session.recording.fileName,
      filePath: session.recording.filePath,
      format: session.recording.format,
      durationSeconds,
      startedAt: session.recording.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `record_persist_failed status=${response.status} body=${body}`,
    );
  }

  stasisLogger.log(
    `[recording] saved call_id=${session.callUuid} file=${session.recording.fileName} duration=${durationSeconds}s`,
  );
}

async function start(): Promise<void> {
  stasisLogger.log("Running database migrations...");
  await migrate();

  stasisLogger.log("Seeding database...");
  await seed();

  const redis = await getPublisher();
  const redisSubscriber = await getSubscriber();
  const campaignExecutor = new CampaignExecutor();
  await campaignExecutor.start();

  startAmiMonitor();
  startSipTrafficMonitor(redis);

  stasisLogger.log(`Connecting to ARI at ${ARI_URL}...`);

  try {
    const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
    stasisLogger.log("Stasis app connected to ARI");

    await redisSubscriber.subscribe("trunk:test:outbound", async (message) => {
      let payload: TrunkTestOutboundEvent | null = null;
      try {
        payload = JSON.parse(message) as TrunkTestOutboundEvent;
      } catch (error) {
        stasisLogger.error("[trunk-test] invalid outbound payload:", error);
        return;
      }

      const trunkId = Number(payload.trunkId || 0);
      const testCallId = String(payload.testCallId || "").trim();
      const number = String(payload.number || "").trim();
      const audioFileId = payload.audioFileId === null || payload.audioFileId === undefined
        ? null
        : Number(payload.audioFileId);
      if (!trunkId || !testCallId || !number) {
        stasisLogger.error("[trunk-test] outbound payload missing required fields");
        return;
      }

      await setTrunkTestStatus(redis, testCallId, "dialing");

      try {
        const response = await ariRequest("/channels", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            endpoint: `PJSIP/${number}@trunk-${trunkId}`,
            app: ARI_APP,
            appArgs: `trunk-test-outbound,${testCallId},${audioFileId ?? ""}`,
            variables: {
              CALLYTICS_TEST_CALL_ID: testCallId,
              CALLYTICS_AUDIO_FILE_ID: audioFileId ? String(audioFileId) : "",
              CALLYTICS_TEST_TYPE: "outbound",
            },
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`originate_failed status=${response.status} body=${body}`);
        }

        const result = (await response.json()) as { id?: string };
        const channelId = String(result.id || "").trim();
        if (!channelId) {
          throw new Error("originate did not return channel id");
        }
        testCallStates.set(channelId, { testCallId, type: "outbound", answered: false });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "originate failed";
        stasisLogger.error("[trunk-test] outbound originate failed:", error);
        await setTrunkTestStatus(redis, testCallId, "failed", reason);
      }
    });

    await redisSubscriber.subscribe("trunk:test:inbound", async (message) => {
      const parsedPayload = parseInboundTestMessage(message);
      stasisLogger.log("[trunk:test:inbound] received", JSON.stringify(parsedPayload ?? message));
      if (!parsedPayload) {
        stasisLogger.error("[trunk-test] invalid inbound payload: expected { trunkId, testCallId }");
        return;
      }
      const { testCallId } = parsedPayload;

      await setTrunkTestStatus(redis, testCallId, "dialing");

      try {
        const response = await ariRequest("/channels", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildInboundOriginateBody(ARI_APP, testCallId)),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`originate_failed status=${response.status} body=${body}`);
        }

        const result = (await response.json()) as { id?: string };
        const channelId = String(result.id || "").trim();
        if (!channelId) {
          throw new Error("originate did not return channel id");
        }
        testCallStates.set(channelId, { testCallId, type: "inbound", answered: false });
      } catch (error) {
        stasisLogger.error("[trunk:test:inbound] originate failed", error);
        await redis.set(
          `trunk:test:${testCallId}:status`,
          JSON.stringify({
            status: "failed",
            reason: String((error as { message?: string } | undefined)?.message || error),
          }),
          { EX: TEST_STATUS_TTL_SECONDS },
        );
      }
    });

    await redisSubscriber.subscribe("callback:execute", async (message) => {
      let payload: CallbackExecutePayload | null = null;
      try {
        payload = JSON.parse(message) as CallbackExecutePayload;
      } catch (error) {
        stasisLogger.error("[callback] invalid execute payload:", error);
        return;
      }

      const hasCustomerDialString = Boolean(String(payload?.customerDialString || '').trim());
      const hasCustomerNumberAndTrunk = Boolean(payload?.customerNumber && payload?.customerTrunkId);
      if (!payload?.callbackId || !payload.operatorDialString || !payload.callerIdNumber || (!hasCustomerDialString && !hasCustomerNumberAndTrunk)) {
        stasisLogger.error("[callback] execute payload missing required fields");
        return;
      }

      await executeCallback(client, payload);
    });

    client.on(
      "StasisStart",
      async (
        event: {
          args?: string[];
          channel?: {
            caller?: { number?: string };
            dnid?: string;
            dialplan?: { context?: string; exten?: string };
          };
        },
        channel: {
          id: string;
          answer: () => Promise<void>;
          play: (
            opts: { media: string },
            playback: { id: string },
          ) => Promise<void>;
          hangup: () => Promise<void>;
        },
      ) => {
        if (await campaignExecutor.handleStasisStart(event, channel, client)) {
          return;
        }

        if (event.args?.[0] === "transfer-outbound" && event.args[1]) {
          resolveTransferWaiter(event.args[1], channel);
          stasisLogger.log(
            `Transfer leg answered: ${channel.id} for ${event.args[1]}`,
          );
          return;
        }

        if (event.args?.[0] === "hunt-outbound" && event.args[1]) {
          const token = event.args[1];
          if (!hasHuntWaiter(token)) {
            stasisLogger.log(
              `[hunt] orphan leg detected token=${token} — hanging up`,
            );
            try {
              await client.channels.hangup({ channelId: channel.id });
            } catch {}
            return;
          }
          resolveHuntWaiter(token, channel);
          stasisLogger.log(
            `Hunt leg entered Stasis: ${channel.id} token=${token}`,
          );
          return;
        }

        if (event.args?.[0] === "callback-operator" && event.args[1]) {
          const callbackId = Number(event.args[1] || 0);
          if (!callbackId || !hasCallbackWaiter(callbackId, "operator")) {
            stasisLogger.log(
              `[callback] orphan operator leg callback_id=${String(event.args[1] || "")} — hanging up`,
            );
            try {
              await client.channels.hangup({ channelId: channel.id });
            } catch {}
            return;
          }
          resolveCallbackWaiter(callbackId, "operator", channel);
          stasisLogger.log(`Callback operator leg entered Stasis: ${channel.id} callback=${callbackId}`);
          return;
        }

        if (event.args?.[0] === "callback-customer" && event.args[1]) {
          const callbackId = Number(event.args[1] || 0);
          if (!callbackId || !hasCallbackWaiter(callbackId, "customer")) {
            stasisLogger.log(
              `[callback] orphan customer leg callback_id=${String(event.args[1] || "")} — hanging up`,
            );
            try {
              await client.channels.hangup({ channelId: channel.id });
            } catch {}
            return;
          }
          resolveCallbackWaiter(callbackId, "customer", channel);
          stasisLogger.log(`Callback customer leg entered Stasis: ${channel.id} callback=${callbackId}`);
          return;
        }

        if (event.args?.[0] === "trunk-test-outbound" && event.args[1]) {
          const testCallId = String(event.args[1]).trim();
          const audioFileIdRaw = String(event.args[2] || "").trim();
          const audioFileId = audioFileIdRaw ? Number(audioFileIdRaw) : null;
          const state = testCallStates.get(channel.id) || {
            testCallId,
            type: "outbound" as const,
            answered: false,
          };
          state.answered = true;
          testCallStates.set(channel.id, state);
          await setTrunkTestStatus(redis, testCallId, "answered");
          try {
            await publishCallEvent({
              callId: channel.id,
              timestamp: new Date().toISOString(),
              type: "started",
              caller: "trunk-test",
              destination: "outbound-test",
              direction: "outbound",
            });
          } catch (error) {
            stasisLogger.error("[trunk-test] publish outbound started failed:", error);
          }
          try {
            await runOutboundTestPlayback(channel, client, Number.isFinite(audioFileId || 0) ? audioFileId : null);
            await setTrunkTestStatus(redis, testCallId, "completed");
          } catch (error) {
            const reason = error instanceof Error ? error.message : "playback failed";
            await setTrunkTestStatus(redis, testCallId, "failed", reason);
            await publishCallEvent({
              callId: channel.id,
              timestamp: new Date().toISOString(),
              type: "failed",
              caller: "trunk-test",
              destination: "outbound-test",
              direction: "outbound",
              failureReason: reason,
            }).catch((eventError) => {
              stasisLogger.error("[trunk-test] publish outbound playback failure failed:", eventError);
            });
            await channel.hangup().catch(() => undefined);
            testCallStates.delete(channel.id);
          }
          return;
        }

        if (
          (event.args?.[0] === "trunk-test-inbound" || event.args?.[0] === "test-inbound")
          && event.args[1]
        ) {
          const testCallId = String(event.args[1]).trim();
          const state = testCallStates.get(channel.id) || {
            testCallId,
            type: "inbound" as const,
            answered: false,
          };
          state.answered = true;
          testCallStates.set(channel.id, state);
          await setTrunkTestStatus(redis, testCallId, "answered");
        }

        const channelContext = String(event.channel?.dialplan?.context || "");
        const channelExten = String(event.channel?.dialplan?.exten || "");
        if (
          channelContext !== "callytics-inbound" ||
          !channelExten ||
          channelExten === "h"
        ) {
          stasisLogger.log(
            `Ignoring StasisStart for channel ${channel.id} context=${channelContext || "unknown"} exten=${channelExten || "unknown"}`,
          );
          return;
        }

        const callerNumber = event.channel?.caller?.number || "unknown";
        const inboundDid = String(
          event.channel?.dnid || channelExten || "",
        ).trim();
        stasisLogger.log(`Incoming call: ${channel.id} from ${callerNumber}`);
        try {
          await publishSipTraffic({
            callId: channel.id,
            timestamp: new Date().toISOString(),
            method: "INVITE",
            from: callerNumber,
            to: inboundDid || channelExten,
            direction: "inbound",
            responseCode: null,
            rawMessage: `INVITE sip:${inboundDid || channelExten} SIP/2.0`,
          });
        } catch (err) {
          stasisLogger.error(
            "[telemetry] sip traffic publish failed (StasisStart):",
            err,
          );
        }

        let flow = null;
        if (inboundDid) {
          try {
            const route = await resolveInboundRoute(inboundDid);
            if (route) {
              stasisLogger.log(
                `[routing] inbound route found DID=${route.did} flow_id=${route.flowId}`,
              );
              flow = await loadFlowById(route.flowId);
            } else {
              stasisLogger.warn(
                `[routing] no inbound route for DID ${inboundDid}, using default flow`,
              );
            }
          } catch (error) {
            stasisLogger.error(
              `[routing] inbound route lookup failed DID=${inboundDid}:`,
              error,
            );
          }
        }

        if (!flow) {
          flow = await loadFlow();
        }
        if (!flow) {
          stasisLogger.warn("No published flow found. Hanging up.");
          try {
            await channel.hangup();
          } catch {}
          return;
        }

        logEvent("StasisStart", {
          channelId: channel.id,
          callerId: callerNumber,
          calledNumber: inboundDid || channelExten,
          flowId: flow.id,
        });

        const entryNode =
          flow.nodes.find((node) => node.type === "start") || flow.nodes[0];
        const session = createSession(
          channel.id,
          callerNumber,
          flow,
          entryNode.nodeKey,
        );
        addSession(session);

        try {
          await publishCallEvent({
            callId: channel.id,
            timestamp: new Date().toISOString(),
            type: "started",
            caller: callerNumber,
            destination: inboundDid || channelExten,
            flowId: flow.id,
            flowVersionId: flow.versionId,
            entryNodeKey: entryNode.nodeKey,
          });
        } catch (err) {
          stasisLogger.error(
            "[telemetry] call event publish failed (StasisStart):",
            err,
          );
        }

        try {
          await channel.answer();
          session.inboundBridge = await createInboundBridge(client, channel.id);
          try {
            await client.applications.subscribe({
              applicationName: ARI_APP,
              eventSource: `channel:${channel.id}`,
            });
            stasisLogger.log(
              `Subscribed ARI app ${ARI_APP} to channel:${channel.id}`,
            );
          } catch (error) {
            stasisLogger.error(
              `Failed to subscribe ARI app ${ARI_APP} to channel:${channel.id}:`,
              error,
            );
          }
          await runFlow(channel, session, client).then((res) => {
            if (res?.status === "failed") {
              failedCalls.add(channel.id);
            }
          });
        } catch (error) {
          stasisLogger.error("Error running flow:", error);
          const failureReason =
            error instanceof Error ? error.message : "Unknown flow error";
          failedCalls.add(channel.id);
          try {
            await publishCallEvent({
              callId: channel.id,
              timestamp: new Date().toISOString(),
              type: "failed",
              caller: session.callerNumber,
              destination: inboundDid || channelExten,
              flowId: session.flow.id,
              flowVersionId: session.flow.versionId,
              failedNode: "runtime",
              failureReason,
            });
          } catch (err) {
            stasisLogger.error(
              "[telemetry] call event publish failed (flow error):",
              err,
            );
          }
          if (session.inboundBridge) {
            await destroyInboundBridge(client, session.inboundBridge.id);
            session.inboundBridge = null;
          }
          try {
            await channel.hangup();
          } catch {}
          removeSession(channel.id);
        }
      },
    );

    client.on(
      "StasisEnd",
      async (
        event: {
          channel?: {
            id?: string;
            name?: string;
            state?: string;
          };
        },
        channel: { id: string },
      ) => {
        const channelId = channel.id;
        if (await campaignExecutor.handleChannelEnd(channelId)) {
          return;
        }
        const testState = testCallStates.get(channelId);
        if (testState) {
          if (testState.type === "inbound") {
            await setTrunkTestStatus(
              redis,
              testState.testCallId,
              testState.answered ? "completed" : "failed",
              testState.answered ? null : "call ended before answer",
            );
            testCallStates.delete(channelId);
            if (!getSession(channelId)) {
              return;
            }
          } else if (!testState.answered) {
            await setTrunkTestStatus(redis, testState.testCallId, "failed", "call ended before answer");
            await publishCallEvent({
              callId: channelId,
              timestamp: new Date().toISOString(),
              type: "failed",
              caller: "trunk-test",
              destination: "outbound-test",
              direction: "outbound",
              failureReason: "call ended before answer",
            }).catch((error) => {
              stasisLogger.error("[trunk-test] publish outbound failed completion failed:", error);
            });
          } else {
            await publishCallEvent({
              callId: channelId,
              timestamp: new Date().toISOString(),
              type: "ended",
              caller: "trunk-test",
              destination: "outbound-test",
              direction: "outbound",
            }).catch((error) => {
              stasisLogger.error("[trunk-test] publish outbound ended failed:", error);
            });
            testCallStates.delete(channelId);
            return;
          }
        }
        rejectHuntWaiter(channelId, "destroyed");
        rejectTransferWaiter(channelId, "destroyed");
        rtcpAmiAccumulator.delete(channelId);
        const session = getSession(channelId);
        if (!session) {
          return;
        }

        const isFailed = failedCalls.has(channelId);
        failedCalls.delete(channelId);
        logEvent("StasisEnd", {
          channelId,
          callerId: session.callerNumber,
          durationMs: Date.now() - session.startedAt.getTime(),
        });

        // 1. Destroy bridge immediately (non-blocking — destroyInboundBridge catches its own errors)
        if (session.inboundBridge) {
          void destroyInboundBridge(client, session.inboundBridge.id);
        }

        // 2. Publish telemetry (non-blocking)
        void publishCallEndTelemetry(
          channel.id,
          session.flow.id,
          session.callerNumber,
        );
        void publishSipTraffic({
          callId: channel.id,
          timestamp: new Date().toISOString(),
          method: "BYE",
          from: session.callerNumber,
          to: "",
          direction: "inbound",
          responseCode: null,
          rawMessage: `BYE sip:${channel.id} SIP/2.0`,
        }).catch((err) =>
          stasisLogger.error(
            "[telemetry] sip traffic publish failed (StasisEnd):",
            err,
          ),
        );

        if (!isFailed) {
          void publishCallEvent({
            callId: channel.id,
            timestamp: new Date().toISOString(),
            type: "ended",
            caller: session.callerNumber,
            exitNodeKey: session.currentNodeKey,
            durationSeconds: Math.round(
              (Date.now() - session.startedAt.getTime()) / 1000,
            ),
          }).catch((err) =>
            stasisLogger.error(
              "[telemetry] call event publish failed (StasisEnd):",
              err,
            ),
          );
        }

        // 3. Remove session from in-memory registry
        removeSession(channel.id);

        // 4. Fire-and-forget recording persistence — must not block the event handler
        void persistRecording(session).catch((err) =>
          stasisLogger.error("[stasis] persistRecording failed:", err),
        );

      },
    );

    client.on(
      "ChannelDestroyed",
      async (
        event: {
          channel?: {
            id?: string;
            name?: string;
            state?: string;
          };
          cause?: number;
          cause_txt?: string;
        },
        channel: { id: string },
      ) => {
        if (
          await campaignExecutor.handleChannelEnd(channel.id, event.cause_txt)
        ) {
          return;
        }
        const testState = testCallStates.get(channel.id);
        if (testState) {
          if (testState.type === "inbound") {
            const failureReason = String(event.cause_txt || "channel destroyed");
            await setTrunkTestStatus(
              redis,
              testState.testCallId,
              testState.answered ? "completed" : "failed",
              testState.answered ? null : failureReason,
            );
            testCallStates.delete(channel.id);
            if (!getSession(channel.id)) {
              return;
            }
          } else if (!testState.answered) {
            const failureReason = String(event.cause_txt || "channel destroyed");
            await setTrunkTestStatus(
              redis,
              testState.testCallId,
              "failed",
              failureReason,
            );
            await publishCallEvent({
              callId: channel.id,
              timestamp: new Date().toISOString(),
              type: "failed",
              caller: "trunk-test",
              destination: "outbound-test",
              direction: "outbound",
              failureReason,
            }).catch((error) => {
              stasisLogger.error("[trunk-test] publish outbound destroy failed:", error);
            });
          } else {
            await publishCallEvent({
              callId: channel.id,
              timestamp: new Date().toISOString(),
              type: "ended",
              caller: "trunk-test",
              destination: "outbound-test",
              direction: "outbound",
            }).catch((error) => {
              stasisLogger.error("[trunk-test] publish outbound destroy ended failed:", error);
            });
            testCallStates.delete(channel.id);
            return;
          }
        }
        rejectHuntWaiter(channel.id, "destroyed");
        rejectTransferWaiter(channel.id, "destroyed");
        if (!getSession(channel.id)) {
          return;
        }
        const session = getSession(channel.id);
        logEvent("ChannelDestroyed", {
          channelId: channel.id,
          callerId: session?.callerNumber || null,
          cause: event.cause ?? null,
          causeText: event.cause_txt || null,
        });
      },
    );

    client.start(ARI_APP);
    stasisLogger.log(`Listening for calls on Stasis app: ${ARI_APP}`);
  } catch (error) {
    stasisLogger.error("Failed to connect to ARI:", error);
    process.exit(1);
  }
}

void start();
