/** @jest-environment jsdom */
jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("../demoPairing", () => ({ getCachedDemoPairing: () => null }));
jest.mock("expo-secure-store", () => ({}));
import { configureBrowserDemoWindow } from "../browserDemoSession";
import * as storage from "../../storage/secureStorage";

it("preserva cofres separados quando o redirect retira a query antes do primeiro await", async () => {
  for (const peer of ["client", "driver"]) {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", `/?demoSession=regression-namespace&demoPeer=${peer}`);
    configureBrowserDemoWindow();
    window.history.replaceState(null, "", "/onboarding");
    await storage.setItemAsync("cooperativa_wallet_keystore", peer);
  }
  expect(window.localStorage.getItem("cooperativa:regression-namespace:client:cooperativa_wallet_keystore")).toBe("client");
  expect(window.localStorage.getItem("cooperativa:regression-namespace:driver:cooperativa_wallet_keystore")).toBe("driver");
});
