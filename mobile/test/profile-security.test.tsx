import React from "react";
import { Text, TextInput, TouchableOpacity } from "react-native";
import ProfileScreen from "../app/(app)/profile";

const { act, create } = require("react-test-renderer");
const mockExport = jest.fn();
const mockLogout = jest.fn();
const mockForget = jest.fn();
let mockFocusCleanup: (() => void) | undefined;

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn() }),
  useFocusEffect: (callback: () => (() => void)) => {
    require("react").useEffect(() => {
      mockFocusCleanup = callback();
      return mockFocusCleanup;
    }, [callback]);
  },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("@/store/useAuthStore", () => ({
  useAuthStore: () => ({
    session: { profile: { did: "0x123", displayName: "Vitor Maia", role: "client", onChainRegistered: true } },
    registerOnChain: jest.fn(), logout: mockLogout, forgetIdentity: mockForget, exportPrivateKey: mockExport,
  }),
}));

function button(screen: any, label: string) {
  return screen.root.findAllByType(TouchableOpacity).find((item: any) =>
    item.findAllByType(Text).some((text: any) => text.props.children === label)
  );
}

function hasText(screen: any, value: string) {
  return screen.root.findAllByType(Text).some((item: any) => item.props.children === value);
}

async function renderScreen() {
  let screen: any;
  await act(async () => { screen = create(<ProfileScreen />); });
  return screen;
}

async function requestExport(screen: any, password: string) {
  await act(async () => { button(screen, "Exportar Chave Privada").props.onPress(); });
  await act(async () => {
    screen.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === "Senha para exportar chave").props.onChangeText(password);
  });
  await act(async () => { await button(screen, "Confirmar e visualizar").props.onPress(); });
}

describe("Segurança no Perfil", () => {
  beforeEach(() => {
    mockExport.mockReset();
    mockLogout.mockReset().mockResolvedValue(undefined);
    mockForget.mockReset().mockResolvedValue(undefined);
    mockFocusCleanup = undefined;
  });

  it("exige senha novamente e permite ocultar a chave após exportar", async () => {
    mockExport.mockRejectedValueOnce(new Error("Senha incorreta"));
    mockExport.mockResolvedValueOnce("chave-de-recuperacao");
    const screen = await renderScreen();
    await requestExport(screen, "errada");
    expect(hasText(screen, "Senha incorreta")).toBe(true);
    expect(hasText(screen, "chave-de-recuperacao")).toBe(false);
    await requestExport(screen, "senha-correta");
    expect(mockExport).toHaveBeenLastCalledWith("senha-correta");
    expect(hasText(screen, "chave-de-recuperacao")).toBe(true);
    await act(async () => { button(screen, "Fechar").props.onPress(); });
    expect(hasText(screen, "chave-de-recuperacao")).toBe(false);
    screen.unmount();
  });

  it("não exibe uma chave se o usuário sair da tela antes do desbloqueio terminar", async () => {
    let finish!: (value: string) => void;
    mockExport.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const screen = await renderScreen();
    await act(async () => { button(screen, "Exportar Chave Privada").props.onPress(); });
    let pending: Promise<void>;
    await act(async () => { pending = button(screen, "Confirmar e visualizar").props.onPress(); });
    await act(async () => { mockFocusCleanup?.(); });
    await act(async () => { finish("chave-de-recuperacao"); await pending; });
    expect(hasText(screen, "chave-de-recuperacao")).toBe(false);
    screen.unmount();
  });

  it("sair apenas bloqueia; remover a identidade exige confirmação separada", async () => {
    const screen = await renderScreen();
    await act(async () => { await button(screen, "Sair e bloquear conta").props.onPress(); });
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockForget).not.toHaveBeenCalled();
    await act(async () => { button(screen, "Remover identidade deste dispositivo").props.onPress(); });
    expect(mockForget).not.toHaveBeenCalled();
    await act(async () => { await button(screen, "Confirmar remoção").props.onPress(); });
    expect(mockForget).toHaveBeenCalledTimes(1);
    screen.unmount();
  });
});
