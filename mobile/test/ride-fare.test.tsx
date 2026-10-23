import React from "react";
import { Alert, Text, TextInput, TouchableOpacity } from "react-native";
import RequestRideScreen from "../app/(app)/request-ride";
import IncomingCallScreen from "../app/(app)/incoming-call";
import { fareFixture } from "./fixtures/fare";

const { act, create } = require("react-test-renderer");
const mockCall = jest.fn();
const mockAnswer = jest.fn();
const mockQuote = jest.fn();
const mockReplace = jest.fn();
const clientDid = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const driverDid = "0x1563915e194D8CfBA1943570603F7606A3115508";

jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace, back: jest.fn() }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/dev/index", () => ({
  IS_DEV_MOCK: true, DEV_SERVER_URL: "http://localhost:4747",
  identityService: {
    isRegisteredOnChain: jest.fn(async () => true),
    getProfileFromChain: jest.fn(async () => ({ role: "driver", displayName: "Carlos Silva" })),
  },
}));
jest.mock("@/dev/demoFare", () => ({
  ...jest.requireActual("@/dev/demoFare"), loadFareQuote: (...args: any[]) => mockQuote(...args),
}));
jest.mock("@/store/useAuthStore", () => ({ useAuthStore: (select: any) => {
  const state = { session: { profile: { did: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A" } } };
  return select ? select(state) : state;
} }));
jest.mock("@/store/useP2PStore", () => ({ useP2PStore: () => ({ callPeer: mockCall, answerCall: mockAnswer }) }));

function button(screen: any, label: string) {
  return screen.root.findAllByType(TouchableOpacity).find((item: any) => item.props.accessibilityLabel === label);
}
function texts(screen: any) {
  return screen.root.findAllByType(Text).map((item: any) => item.props.children).flat().join(" ");
}
async function render(Component: any) {
  let screen: any;
  await act(async () => { screen = create(<Component />); });
  return screen;
}
async function verify(screen: any) {
  await act(async () => { screen.root.findByType(TextInput).props.onChangeText(driverDid); });
  await act(async () => { await button(screen, "Verificar na Blockchain").props.onPress(); });
}

describe("Preço na solicitação e no aceite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockCall.mockResolvedValue(undefined);
    mockAnswer.mockResolvedValue(undefined);
    mockQuote.mockResolvedValue(fareFixture);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

  it("mostra os componentes do preço antes de chamar e envia a estimativa exibida", async () => {
    const screen = await render(RequestRideScreen);
    await verify(screen);
    expect(mockQuote).toHaveBeenCalledWith(clientDid, driverDid);
    expect(texts(screen)).toContain("R$ 19,00");
    expect(texts(screen)).toContain("Tarifa base");
    expect(texts(screen)).toContain("sem cobrança real");
    await act(async () => { await button(screen, "Conectar via P2P").props.onPress(); });
    expect(mockCall).toHaveBeenCalledWith(driverDid, fareFixture);
    expect(mockReplace).toHaveBeenCalledWith("/(app)/active-ride");
    screen.unmount();
  });

  it("não permite chamar com preço expirado", async () => {
    mockQuote.mockResolvedValue({ ...fareFixture, expiresAt: 1 });
    const screen = await render(RequestRideScreen);
    await verify(screen);
    await act(async () => { await button(screen, "Conectar via P2P").props.onPress(); });
    expect(mockCall).not.toHaveBeenCalled();
    expect(texts(screen)).toContain("Estimativa expirada");
    screen.unmount();
  });

  it("falha no cálculo impede a chamada e exibe erro com opção de tentar novamente", async () => {
    mockQuote.mockRejectedValue(new Error("Serviço de preço indisponível"));
    const screen = await render(RequestRideScreen);
    await verify(screen);
    expect(texts(screen)).toContain("Serviço de preço indisponível");
    expect(button(screen, "Conectar via P2P")).toBeUndefined();
    expect(button(screen, "Verificar na Blockchain")).toBeDefined();
    expect(mockCall).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("trocar o motorista invalida a estimativa anterior", async () => {
    const screen = await render(RequestRideScreen);
    await verify(screen);
    await act(async () => { screen.root.findByType(TextInput).props.onChangeText(clientDid); });
    expect(button(screen, "Conectar via P2P")).toBeUndefined();
    expect(texts(screen)).not.toContain("R$ 19,00");
    screen.unmount();
  });

  it("mostra ao motorista o mesmo preço e o inclui no aceite", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
      sessionId: "fare-session", offer: { from: clientDid, sdp: { type: "offer", sdp: "demo" }, fare: fareFixture },
    }) });
    const screen = await render(IncomingCallScreen);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(texts(screen)).toContain("Oferta de corrida");
    expect(texts(screen)).toContain("Aceitar por R$ 19,00");
    await act(async () => { await button(screen, "Aceitar corrida").props.onPress(); });
    expect(mockAnswer).toHaveBeenCalledWith("fare-session", { type: "offer", sdp: "demo" }, clientDid, fareFixture);
    screen.unmount();
  });

  it("não libera aceite de uma chamada sem preço válido", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
      sessionId: "fare-session", offer: { from: clientDid, sdp: { type: "offer", sdp: "demo" } },
    }) });
    const screen = await render(IncomingCallScreen);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(button(screen, "Aceitar corrida").props.disabled).toBe(true);
    expect(texts(screen)).toContain("Preço indisponível");
    screen.unmount();
  });
});
