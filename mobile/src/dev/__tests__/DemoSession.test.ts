jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("../demoPairing", () => ({
  getCachedDemoPairing: () => ({ peer: "driver", session: "paired-session" }),
}));

import { getDemoPeer, getDemoSessionId, isPairedBrowserDemo } from "../browserDemoSession";

describe("Sessão pareada pelo QR no APK", () => {
  it("usa o papel e a sessão salvos pelo leitor de QR", () => {
    expect(getDemoPeer()).toBe("driver");
    expect(getDemoSessionId()).toBe("paired-session");
    expect(isPairedBrowserDemo()).toBe(true);
  });
});
