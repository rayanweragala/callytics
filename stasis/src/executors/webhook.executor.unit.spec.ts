import { fireWebhookAsync } from "./webhook.executor";

describe("webhook.executor fireWebhookAsync", () => {
  function makeSession() {
    return {
      callUuid: "call-1",
      channelId: "ch-1",
      callerNumber: "555-0100",
      currentNodeKey: "n-1",
      variables: { digits: "12" } as Record<string, unknown>,
      startedAt: new Date(),
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
    resolvePromise({ ok: true, status: 200 } as Response);
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
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
    } as any);
    const session = makeSession();
    const node = {
      nodeKey: "wh-1",
      type: "webhook",
      config: {
        url: "http://example.com",
        method: "POST",
        include_caller: true,
        include_digits: true,
        headers: [{ key: "X-Api-Key", value: "secret" }],
      },
    };

    fireWebhookAsync(node as any, session as any);

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body || "{}")) as Record<
      string,
      unknown
    >;
    const headers = init.headers as Record<string, string>;
    expect(body.caller_number).toBe("555-0100");
    expect(body.variables).toEqual({ digits: "12" });
    expect(headers["X-Api-Key"]).toBe("secret");
    expect(headers["X-Caller-Number"]).toBe("555-0100");
  });
});
