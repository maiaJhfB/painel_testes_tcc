import { MockIdentityService, mockIdentityService } from "../MockIdentityService";
import * as storage from "@/storage/secureStorage";
import { VAULT_KEY } from "@/storage/walletVault";
import { useAuthStore } from "@/store/useAuthStore.dev";

jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock("@/dev/index", () => ({
  IS_DEV_MOCK: true,
  DEV_SERVER_URL: "http://localhost:4747",
  identityService: jest.requireActual("../MockIdentityService").mockIdentityService,
}));
jest.setTimeout(60_000);

const personas = [
  ["client", "1", "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A", "Vitor Maia"],
  ["driver", "2", "0x1563915e194D8CfBA1943570603F7606A3115508", "Carlos Silva"],
] as const;

function browserSession(peer: string | null, localValues = new Map<string, string>()) {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true, writable: true,
    value: {
      location: { protocol: "http:", hostname: "localhost", search: peer ? `?demoSession=password-login&demoPeer=${peer}` : "" },
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      localStorage: {
        getItem: (key: string) => localValues.get(key) ?? null,
        setItem: (key: string, value: string) => localValues.set(key, value),
        removeItem: (key: string) => localValues.delete(key),
      },
    },
  });
  return { values, localValues };
}

function onlineProfile(role: string, name: string) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ nonce: "1234567890abcdef1234567890abcdef", registered: true, metadata: { role, displayName: name } }),
  });
}

describe("Login por senha nas janelas da demo", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdentityService.lockWallet();
    useAuthStore.setState({ status: "idle", session: null, account: null, error: null });
  });

  it.each(personas)("desbloqueia %s com senha e assina o login sem transmitir chave ou senha", async (role, digit, did, name) => {
    const { values, localValues } = browserSession(role);
    onlineProfile(role, name);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().status).toBe("locked");
    expect(mockIdentityService.currentAddress).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    await useAuthStore.getState().login("Demo@123");
    const session = useAuthStore.getState().session!;
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(session.profile).toMatchObject({ did, role, displayName: name });
    expect(session.sessionToken).toMatch(/^0x[0-9a-f]{64}$/);
    const stored = [...values.values(), ...localValues.values()].join(" ");
    expect(stored).not.toContain(digit.repeat(64));
    expect(stored).not.toContain("Demo@123");
    expect(await storage.getItemAsync("cooperativa_wallet_pk")).toBeNull();
    const traffic = JSON.stringify((global.fetch as jest.Mock).mock.calls);
    expect(traffic).not.toContain("Demo@123");
    expect(traffic).not.toContain(`0x${digit.repeat(64)}`);

    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().status).toBe("locked");
    expect(useAuthStore.getState().session).toBeNull();
    expect(mockIdentityService.currentAddress).toBeNull();
    expect(await storage.getItemAsync(VAULT_KEY)).not.toBeNull();
    await expect(mockIdentityService.createSignedSession("12345678")).rejects.toThrow("Wallet não carregada");
  });

  it("recusa senha incorreta sem abrir a chave nem consultar o servidor", async () => {
    browserSession("client");
    onlineProfile("client", "Vitor Maia");
    await useAuthStore.getState().initialize();
    await expect(useAuthStore.getState().login("SenhaIncorreta")).rejects.toThrow("Senha incorreta");
    expect(useAuthStore.getState().status).toBe("locked");
    expect(mockIdentityService.currentAddress).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    await expect(mockIdentityService.exportPrivateKey("SenhaIncorreta")).rejects.toThrow("Senha incorreta");
  });

  it("ao recarregar volta bloqueado e preserva o mesmo DID", async () => {
    const { localValues } = browserSession("driver");
    onlineProfile("driver", "Carlos Silva");
    await useAuthStore.getState().initialize();
    await useAuthStore.getState().login("Demo@123");
    (global.fetch as jest.Mock).mockClear();
    browserSession("driver", localValues);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().status).toBe("locked");
    expect(useAuthStore.getState().account?.did).toBe(personas[1][2]);
    expect(mockIdentityService.currentAddress).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("mantém os cofres de passageiro e motorista separados no mesmo navegador", async () => {
    const localValues = new Map<string, string>();
    browserSession("client", localValues);
    await useAuthStore.getState().initialize();
    const clientVault = await storage.getItemAsync(VAULT_KEY);
    browserSession("driver", localValues);
    await useAuthStore.getState().initialize();
    const driverVault = await storage.getItemAsync(VAULT_KEY);
    expect(driverVault).not.toBe(clientVault);
    expect(useAuthStore.getState().account?.did).toBe(personas[1][2]);
    browserSession("client", localValues);
    await useAuthStore.getState().initialize();
    expect(await storage.getItemAsync(VAULT_KEY)).toBe(clientVault);
    expect(useAuthStore.getState().account?.did).toBe(personas[0][2]);
  });

  it("importa uma identidade pessoal, cifra a chave e exige a nova senha para reabrir", async () => {
    const { localValues, values } = browserSession(null);
    const privateKey = `0x${"3".repeat(64)}`;
    const password = "SenhaPessoal123!";
    await useAuthStore.getState().importWallet(privateKey, password);
    expect(mockIdentityService.currentAddress).toBeNull();
    const saved = [...localValues.values(), ...values.values()].join(" ");
    expect(saved).not.toContain(privateKey.slice(2));
    expect(saved).not.toContain(password);
    browserSession(null, localValues);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().status).toBe("locked");
    await expect(mockIdentityService.exportPrivateKey("OutraSenha123")).rejects.toThrow("Senha incorreta");
    await expect(mockIdentityService.exportPrivateKey(password)).resolves.toBe(privateKey);
  });

  it("migra a identidade anterior para um cofre cifrado sem trocar a chave", async () => {
    browserSession(null);
    const password = "Senha de teste123!";
    const privateKey = `0x${"1".repeat(64)}`;
    await storage.setItemAsync("cooperativa_wallet_pk", privateKey);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().status).toBe("needs_password");
    await useAuthStore.getState().migrateWallet(password);
    expect(await storage.getItemAsync("cooperativa_wallet_pk")).toBeNull();
    expect(await storage.getItemAsync(VAULT_KEY)).not.toContain(privateKey.slice(2));
    const reloaded = new MockIdentityService();
    await expect(reloaded.loadWallet(password)).resolves.toBe(personas[0][2]);
    await expect(reloaded.exportPrivateKey(password)).resolves.toBe(privateKey);
    await expect(reloaded.loadWallet()).rejects.toThrow("Digite sua senha");
  });

  it("informa falha de conexão e bloqueia novamente a chave", async () => {
    browserSession("client");
    await useAuthStore.getState().initialize();
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(useAuthStore.getState().login("Demo@123")).rejects.toThrow("servidor da demo");
    expect(useAuthStore.getState().status).toBe("locked");
    expect(mockIdentityService.currentAddress).toBeNull();
  });

  it("explica quando um DID foi colado no lugar da chave", async () => {
    browserSession(null);
    await expect(new MockIdentityService().importWallet(personas[0][2], "MinhaSenha123")).rejects.toThrow("DID");
    expect(await storage.getItemAsync(VAULT_KEY)).toBeNull();
  });
});
