export interface TrunkTestInboundEvent {
  trunkId: number;
  testCallId: string;
}

export function parseInboundTestMessage(message: string): TrunkTestInboundEvent | null {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(message);
  } catch {
    return null;
  }

  if (!parsedPayload || typeof parsedPayload !== "object") {
    return null;
  }

  const payload = parsedPayload as Partial<TrunkTestInboundEvent>;
  const trunkId = Number(payload.trunkId || 0);
  const testCallId = String(payload.testCallId || "").trim();
  if (!trunkId || !testCallId) {
    return null;
  }

  return {
    trunkId,
    testCallId,
  };
}

export function buildInboundOriginateBody(appName: string, testCallId: string) {
  return {
    endpoint: "Local/1111@callytics-inbound/n",
    context: "callytics-inbound",
    extension: "1111",
    priority: 1,
    app: appName,
    appArgs: `test-inbound,${testCallId}`,
    variables: {
      CALLYTICS_TEST_CALL_ID: testCallId,
      CALLYTICS_TEST_TYPE: "inbound",
    },
  };
}
