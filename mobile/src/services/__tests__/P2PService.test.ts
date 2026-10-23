import * as WebRTC from "react-native-webrtc";
import { P2PService } from "../P2PService";

describe("P2PService", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("normalizes an incomplete remote answer before constructing RTCSessionDescription", async () => {
    const setRemoteDescription = jest.fn();
    const service = new P2PService("0xcaller") as any;
    service.pc = { setRemoteDescription };
    service.sessionId = "session-1";

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        payload: {
          sdp: { type: "answer" },
        },
      }),
    });

    service._startSignalingPoll("answer");
    await jest.advanceTimersByTimeAsync(1500);

    expect(WebRTC.RTCSessionDescription).toHaveBeenCalledWith({
      sdp: "",
      type: "answer",
    });
    expect(setRemoteDescription).toHaveBeenCalledWith({
      sdp: "",
      type: "answer",
    });

    service._stopSignalingPoll();
  });
});
