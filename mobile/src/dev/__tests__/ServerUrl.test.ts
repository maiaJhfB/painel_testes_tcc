/** @jest-environment jsdom */
jest.mock("expo-constants", () => ({ expoConfig: { extra: { DEV_SERVER_URL: "http://localhost:4748" } } }));
jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
import { getDevServerUrl, setDevServerUrl } from "../serverUrl";

describe("Endereco da copia coexistente", () => {
  afterEach(() => setDevServerUrl(null));
  it("usa a porta configurada com o host do navegador", () => {
    expect(getDevServerUrl()).toBe(`http://${window.location.hostname}:4748`);
  });
  it("respeita o servidor escolhido pelo QR", () => {
    setDevServerUrl("http://192.168.0.8:4749");
    expect(getDevServerUrl()).toBe("http://192.168.0.8:4749");
  });
});
