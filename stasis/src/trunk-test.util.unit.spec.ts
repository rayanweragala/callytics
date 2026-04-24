import { buildInboundOriginateBody, parseInboundTestMessage } from "./trunk-test.util";

describe("trunk-test.util", () => {
  it("parses valid inbound test redis payload", () => {
    const result = parseInboundTestMessage(JSON.stringify({
      trunkId: 3,
      testCallId: "abc-123",
    }));

    expect(result).toEqual({
      trunkId: 3,
      testCallId: "abc-123",
    });
  });

  it("returns null for invalid or incomplete inbound payload", () => {
    expect(parseInboundTestMessage("not-json")).toBeNull();
    expect(parseInboundTestMessage(JSON.stringify({ trunkId: 0, testCallId: "x" }))).toBeNull();
    expect(parseInboundTestMessage(JSON.stringify({ trunkId: 1 }))).toBeNull();
  });

  it("builds inbound originate body with stasis app and args", () => {
    const result = buildInboundOriginateBody("callytics", "test-id-1");

    expect(result).toEqual({
      endpoint: "Local/1111@callytics-inbound/n",
      context: "callytics-inbound",
      extension: "1111",
      priority: 1,
      app: "callytics",
      appArgs: "test-inbound,test-id-1",
      variables: {
        CALLYTICS_TEST_CALL_ID: "test-id-1",
        CALLYTICS_TEST_TYPE: "inbound",
      },
    });
  });
});
