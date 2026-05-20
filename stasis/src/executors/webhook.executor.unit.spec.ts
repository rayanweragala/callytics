import { fireWebhookAsync } from "./webhook.executor";
import type { CallSession } from "../callSession";
import * as redis from "../redis";

describe("webhook.executor fireWebhookAsync", () => {
  function makeSession(): CallSession {
    const startedAt = new Date("2026-05-11T10:00:00.000Z");
    return {
      callUuid: "call-1",
      channelId: "ch-1",
      callerNumber: "555-0100",
      currentNodeKey: "n-1",
      variables: { digits: "12" },
      webhookPayload: {},
      call_started_at: startedAt.toISOString(),
      call_ended_at: "2026-05-11T10:00:14.000Z",
      startedAt,
      recording: null,
      inboundBridge: null,
      flow: { id: 1, name: "Test", versionId: 1, nodes: [], edges: [] },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns immediately and does not block", async () => {
    let resolvePromise!: (value: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolvePromise = resolve;
    });
    jest.spyOn(redis, "publish").mockResolvedValue(undefined);
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockReturnValue(pendingPromise);
    const session = makeSession();
    const node = {
      nodeKey: "wh-1",
      type: "webhook",
      config: { url: "http://example.com", method: "POST" },
    };
    const result = fireWebhookAsync(node as any, session as any);
    expect(result).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolvePromise({ ok: true, status: 200, text: async () => "ok" } as Response);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("skips firing when url is empty", () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    const session = makeSession();
    const node = {
      nodeKey: "wh-1",
      type: "webhook",
      config: { url: "" },
    };

    fireWebhookAsync(node as any, session as any);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends POST body with caller and session variables when configured", () => {
    jest.spyOn(redis, "publish").mockResolvedValue(undefined);
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "ok",
    } as any);
    const session = makeSession();
    const node = {
      nodeKey: "wh-1",
      type: "webhook",
      config: {
        url: "http://example.com",
        method: "POST",
        include_session_variables: true,
        headers: [{ key: "X-Api-Key", value: "secret" }],
      },
    };
    const sourceNode = {
      nodeKey: "menu-1",
      type: "menu",
      config: {},
    };

    fireWebhookAsync(node as any, session as any, sourceNode as any);

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body || "{}")) as Record<
      string,
      unknown
    >;
    const headers = init.headers as Record<string, string>;
    expect(body.caller_number).toBe("555-0100");
    expect(body.node_type).toBe("menu");
    expect(body.node_id).toBe("menu-1");
    expect(body.call_started_at).toBe("2026-05-11T10:00:00.000Z");
    expect(body.call_ended_at).toBe("2026-05-11T10:00:14.000Z");
    expect(body.call_duration_seconds).toBe(14);
    expect(body.variables).toEqual({ digits: "12" });
    expect(headers["X-Api-Key"]).toBe("secret");
  });

  it("forwards webhook recording fields in the POST body", () => {
    jest.spyOn(redis, "publish").mockResolvedValue(undefined);
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "ok",
    } as any);
    const session = makeSession();
    const node = {
      nodeKey: "wh-1",
      type: "webhook",
      config: {
        url: "http://example.com",
        method: "POST",
      },
    };
    const sourceNode = {
      nodeKey: "voicemail-1",
      type: "voicemail",
      config: {},
    };
    session.webhookPayload.recording = {
      url: "http://127.0.0.1:3001/recordings/777/download",
      duration_seconds: 14,
    };
    session.webhookPayload.outcome = { status: "completed" };

    fireWebhookAsync(node as any, session as any, sourceNode as any);

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body || "{}")) as Record<
      string,
      unknown
    >;
    expect(body.node_type).toBe("voicemail");
    expect(body.node_id).toBe("voicemail-1");
    expect(body.recording).toEqual({
      url: "http://127.0.0.1:3001/recordings/777/download",
      duration_seconds: 14,
    });
    expect(body.outcome).toEqual({ status: "completed" });
  });

  it("includes callback outcome data in the POST body when triggered by a callback node", () => {
    jest.spyOn(redis, "publish").mockResolvedValue(undefined);
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "ok",
    } as any);
    const session = makeSession();
    const node = {
      nodeKey: "wh-1",
      type: "webhook",
      config: {
        url: "http://example.com",
        method: "POST",
        include_session_variables: false,
      },
    };
    const sourceNode = {
      nodeKey: "callback-1",
      type: "callback",
      config: {},
    };
    session.webhookPayload.callback = {
      number: "781100996",
      source: "dtmf",
    };
    session.webhookPayload.outcome = { status: "completed" };

    fireWebhookAsync(node as any, session as any, sourceNode as any);

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body || "{}")) as Record<string, unknown>;
    expect(body.caller_number).toBe("555-0100");
    expect(body.callback).toEqual({
      number: "781100996",
      source: "dtmf",
    });
    expect(body.variables).toEqual({});
  });

  it("publishes webhook delivery with non-2xx marked as failure", async () => {
    const publishSpy = jest.spyOn(redis, "publish").mockResolvedValue(undefined);
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "upstream unavailable",
    } as Response);

    const session = makeSession();
    const node = {
      nodeKey: "wh-1",
      type: "webhook",
      config: {
        url: "http://example.com",
        method: "POST",
        retry_enabled: true,
        max_attempts: 4,
      },
    };

    fireWebhookAsync(node as any, session as any);
    await Promise.resolve();
    await Promise.resolve();

    expect(publishSpy).toHaveBeenCalledWith(
      "webhook:delivery",
      expect.objectContaining({
        flow_id: 1,
        node_id: "wh-1",
        call_id: "ch-1",
        url: "http://example.com",
        attempt_number: 1,
        http_status: 503,
        response_body: "upstream unavailable",
        success: false,
        error_message: null,
        retry_enabled: true,
        max_attempts: 4,
        retry_on_5xx: true,
        retry_on_timeout: true,
        retry_on_4xx: false,
      }),
    );
  });

  it("enables retries by default when retry config is missing", async () => {
    const publishSpy = jest.spyOn(redis, "publish").mockResolvedValue(undefined);
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "upstream unavailable",
    } as Response);

    const session = makeSession();
    const node = {
      nodeKey: "wh-1",
      type: "webhook",
      config: {
        url: "http://example.com",
        method: "POST",
      },
    };

    fireWebhookAsync(node as any, session as any);
    await Promise.resolve();
    await Promise.resolve();

    expect(publishSpy).toHaveBeenCalledWith(
      "webhook:delivery",
      expect.objectContaining({
        retry_enabled: true,
        max_attempts: 3,
        retry_on_5xx: true,
        retry_on_timeout: true,
        retry_on_4xx: false,
      }),
    );
  });
});
