jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearDemoPairing, getCachedDemoPairing, parseDemoPairing, saveDemoPairing,
} from "../demoPairing";
import { getDevServerUrl, setDevServerUrl } from "../serverUrl";

const payload = {
  v: 1,
  server: "http://192.168.15.6:4747",
  session: "browser-abc123",
  peer: "client",
};

describe("Pareamento do APK por QR", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setDevServerUrl(null);
  });

  it("aceita o JSON gerado pelo painel", () => {
    expect(parseDemoPairing(JSON.stringify(payload))).toMatchObject({
      ...payload,
      savedAt: expect.any(Number),
    });
  });

  it("aceita também o formato de URL com query", () => {
    const parsed = parseDemoPairing(
      "cooperativa-demo://pair?server=http%3A%2F%2F192.168.15.6%3A4747&session=browser-abc123&peer=driver&v=1"
    );
    expect(parsed.server).toBe("http://192.168.15.6:4747");
    expect(parsed.peer).toBe("driver");
  });

  it("rejeita QR de outra versão, servidor inválido ou papel desconhecido", () => {
    expect(() => parseDemoPairing(JSON.stringify({ ...payload, v: 2 }))).toThrow(/painel/);
    expect(() => parseDemoPairing(JSON.stringify({ ...payload, server: "ftp://x" }))).toThrow(/servidor/);
    expect(() => parseDemoPairing(JSON.stringify({ ...payload, peer: "admin" }))).toThrow(/passageiro ou motorista/);
  });

  it("persiste o pareamento e troca o endereço do servidor em tempo de execução", async () => {
    const saved = await saveDemoPairing(JSON.stringify(payload));
    expect(saved.server).toBe("http://192.168.15.6:4747");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("cooperativa_demo_pairing", expect.any(String));
    expect(getCachedDemoPairing()?.peer).toBe("client");
    expect(getDevServerUrl()).toBe("http://192.168.15.6:4747");

    await clearDemoPairing();
    expect(getCachedDemoPairing()).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("cooperativa_demo_pairing");
  });
});
