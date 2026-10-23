import React from "react";
import { Text, TextInput, TouchableOpacity } from "react-native";
import OnboardingScreen from "../app/(auth)/onboarding";

const { act, create } = require("react-test-renderer");
const mockImport = jest.fn();
const mockCreate = jest.fn();
const mockMigrate = jest.fn();
const mockLogin = jest.fn();
const mockReplace = jest.fn();
let mockStatus = "no_wallet";

jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/store/useAuthStore", () => ({
  useAuthStore: () => ({ status: mockStatus,
    account: mockStatus === "locked" ? { did: "0x123", displayName: "Vitor Maia", role: "client" } : null,
    error: null, initialize: jest.fn(), importWallet: mockImport, login: mockLogin,
    createNewWallet: mockCreate, migrateWallet: mockMigrate,
  }),
}));

function button(screen: any, label: string) {
  return screen.root.findAllByType(TouchableOpacity).find((item: any) =>
    item.findAllByType(Text).some((text: any) => text.props.children === label)
  );
}

async function fill(screen: any, label: string, value: string) {
  await act(async () => { screen.root.findAllByType(TextInput).find((input: any) => input.props.accessibilityLabel === label).props.onChangeText(value); });
}

async function renderScreen() {
  let screen: any;
  await act(async () => { screen = create(<OnboardingScreen />); });
  return screen;
}

async function openSetup(mode = "Importar identidade") {
  const screen = await renderScreen();
  await act(async () => { button(screen, "Criar minha conta").props.onPress(); });
  await act(async () => { button(screen, mode).props.onPress(); });
  return screen;
}

describe("Acesso acessível por senha", () => {
  beforeEach(() => {
    mockStatus = "no_wallet";
    mockImport.mockReset().mockResolvedValue("0x123");
    mockCreate.mockReset().mockResolvedValue("0x123");
    mockMigrate.mockReset().mockResolvedValue(undefined);
    mockLogin.mockReset().mockResolvedValue(undefined);
    mockReplace.mockReset();
  });

  it("nas contas preparadas pede apenas a senha e abre a Home", async () => {
    mockStatus = "locked";
    const screen = await renderScreen();
    expect(screen.root.findAllByType(TextInput)).toHaveLength(1);
    await fill(screen, "Senha", "Demo@123");
    await act(async () => { await button(screen, "Entrar").props.onPress(); });
    expect(mockLogin).toHaveBeenCalledWith("Demo@123");
    expect(mockImport).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(app)/home");
    screen.unmount();
  });

  it("importa a chave uma vez e configura a senha antes do login", async () => {
    const screen = await openSetup();
    const key = `0x${"1".repeat(64)}`;
    await fill(screen, "Chave privada", key);
    await fill(screen, "Senha", "MinhaSenha123");
    await fill(screen, "Confirmar senha", "MinhaSenha123");
    await act(async () => { await button(screen, "Importar e entrar").props.onPress(); });
    expect(mockImport).toHaveBeenCalledWith(key, "MinhaSenha123");
    expect(mockLogin).toHaveBeenCalledWith("MinhaSenha123");
    expect(mockReplace).toHaveBeenCalledWith("/(app)/home");
    screen.unmount();
  });

  it("impede criar a conta se a confirmação da senha estiver diferente", async () => {
    const screen = await openSetup("Nova identidade");
    await fill(screen, "Senha", "MinhaSenha123");
    await fill(screen, "Confirmar senha", "OutraSenha123");
    await act(async () => { await button(screen, "Criar senha e entrar").props.onPress(); });
    expect(screen.root.findAllByType(Text).some((item: any) => item.props.accessibilityRole === "alert" && item.props.children.includes("não coincidem"))).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("mostra uma senha incorreta e permite tentar novamente", async () => {
    mockStatus = "locked";
    mockLogin.mockRejectedValueOnce(new Error("Senha incorreta"));
    const screen = await renderScreen();
    await fill(screen, "Senha", "senha-errada");
    await act(async () => { await button(screen, "Entrar").props.onPress(); });
    expect(button(screen, "Entrar").props.disabled).toBe(false);
    expect(screen.root.findAllByType(Text).some((item: any) => item.props.accessibilityRole === "alert" && item.props.children === "Senha incorreta")).toBe(true);
    await fill(screen, "Senha", "Demo@123");
    await act(async () => { await button(screen, "Entrar").props.onPress(); });
    expect(mockReplace).toHaveBeenCalledWith("/(app)/home");
    screen.unmount();
  });

  it("protege uma identidade antiga sem pedir que o usuário copie a chave", async () => {
    mockStatus = "needs_password";
    const screen = await renderScreen();
    expect(screen.root.findAllByType(TextInput)).toHaveLength(2);
    await fill(screen, "Senha", "NovaSenha123");
    await fill(screen, "Confirmar senha", "NovaSenha123");
    await act(async () => { await button(screen, "Criar senha e entrar").props.onPress(); });
    expect(mockMigrate).toHaveBeenCalledWith("NovaSenha123");
    expect(mockImport).not.toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledWith("NovaSenha123");
    screen.unmount();
  });
});
