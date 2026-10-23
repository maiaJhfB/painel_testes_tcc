/**
 * @module useAuthStore
 * @description Estado global de autenticação — gerenciado com Zustand
 *
 * Orquestra o ciclo completo de autenticação SSI.
 * Em modo DEV_MOCK, usa MockIdentityService automaticamente.
 *
 * ALTERADO: importa identityService de src/dev/index.ts em vez de
 * src/services/IdentityService.ts diretamente.
 * Isso garante troca transparente entre mock e real.
 */

import { create } from "zustand";
import Constants from "expo-constants";
import { identityService } from "@/dev/index";
import type { AuthSession, IdentityProfile } from "@/services/IdentityService";
import { IS_DEV_MOCK } from "@/dev/index";
import { getDevServerUrl } from "@/dev/serverUrl";
import { getDemoPeer } from "@/dev/browserDemoSession";
import { hydrateDemoPairing } from "@/dev/demoPairing";
import { demoAccounts } from "@/dev/demoAccounts";
import { prepareDemoAccount } from "@/storage/walletVault";
import * as storage from "@/storage/secureStorage";
import { useP2PStore } from "@/store/useP2PStore";

const SIGNALING_URL =
  Constants.expoConfig?.extra?.SIGNALING_SERVER_URL ??
  "https://signaling.cooperativa-worker.workers.dev";

// ─── Tipos ─────────────────────────────────────────────────────────────────────

type AuthStatus =
  | "idle"
  | "checking"
  | "no_wallet"
  | "locked"
  | "needs_password"
  | "signing"
  | "authenticated"
  | "error";

interface AuthState {
  status: AuthStatus;
  session: AuthSession | null;
  error: string | null;
  account: { did: string; displayName: string; role: string } | null;

  initialize: () => Promise<void>;
  createNewWallet: (password: string) => Promise<string>;
  importWallet: (privateKey: string, password: string) => Promise<string>;
  migrateWallet: (password: string) => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  forgetIdentity: () => Promise<void>;
  exportPrivateKey: (password: string) => Promise<string>;
  registerOnChain: (role: "driver" | "client", displayName: string) => Promise<string>;
}

async function accountSummary(did: string | null): Promise<AuthState["account"]> {
  if (!did) return null;
  try {
    const cached = JSON.parse(await storage.getItemAsync("cooperativa_did") ?? "null");
    if (cached?.did?.toLowerCase() === did.toLowerCase()) {
      return { did, displayName: cached.displayName, role: cached.role };
    }
  } catch {}
  const prepared = Object.values(demoAccounts).find((account) => account.did.toLowerCase() === did.toLowerCase());
  return { did, displayName: prepared?.displayName ?? "Minha conta", role: prepared?.role ?? "client" };
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "idle",
  session: null,
  error: null,
  account: null,

  initialize: async () => {
    identityService.lockWallet();
    set({ status: "checking", session: null, error: null });
    try {
      await hydrateDemoPairing();
      let access = await identityService.getWalletAccess();
      const peer = getDemoPeer();
      if (access.kind === "missing" && peer) {
        await prepareDemoAccount(peer);
        access = await identityService.getWalletAccess();
      }
      set({
        status: access.kind === "locked" ? "locked" : access.kind === "legacy" ? "needs_password" : "no_wallet",
        account: await accountSummary(access.did),
      });
    } catch (err) {
      set({ status: "error", error: String(err) });
    }
  },

  createNewWallet: async (password) => {
    const address = await identityService.generateNewWallet(password);
    identityService.lockWallet();
    set({ status: "locked", account: await accountSummary(address), session: null, error: null });
    return address;
  },

  importWallet: async (privateKey, password) => {
    const address = await identityService.importWallet(privateKey, password);
    identityService.lockWallet();
    set({ status: "locked", account: await accountSummary(address), session: null, error: null });
    return address;
  },

  migrateWallet: async (password) => {
    const address = await identityService.migrateWallet(password);
    set({ status: "locked", account: await accountSummary(address), session: null, error: null });
  },

  login: async (password) => {
    set({ status: "signing", error: null });
    try {
      const address = await identityService.loadWallet(password);
      if (!address) throw new Error("Identidade não encontrada. Crie ou importe sua conta.");
      // Em modo dev usa o servidor mock; em prod usa o Cloudflare Worker
      const nonceUrl = IS_DEV_MOCK
        ? `${getDevServerUrl()}/nonce`
        : `${SIGNALING_URL}/nonce`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let nonce: string;
      try {
        const res = await fetch(nonceUrl, { signal: controller.signal });
        if (!res.ok) throw new Error("Servidor indisponível.");
        const data = await res.json();
        if (typeof data.nonce !== "string" || !/^[a-zA-Z0-9]{8,}$/.test(data.nonce)) {
          throw new Error("Resposta de autenticação inválida.");
        }
        nonce = data.nonce;
      } catch {
        throw new Error("Não foi possível conectar ao servidor da demo. Confirme que iniciar-demo.bat está aberto e tente novamente.");
      } finally {
        clearTimeout(timeout);
      }

      const session = await identityService.createSignedSession(nonce);
      set({ status: "authenticated", session, account: {
        did: session.profile.did, displayName: session.profile.displayName, role: session.profile.role,
      } });
    } catch (err) {
      identityService.lockWallet();
      set({ status: "locked", session: null, error: err instanceof Error ? err.message : "Não foi possível entrar." });
      throw err;
    }
  },

  logout: async () => {
    identityService.lockWallet();
    void useP2PStore.getState().disconnect().catch(() => {});
    set({ status: "locked", session: null, error: null });
  },

  forgetIdentity: async () => {
    identityService.lockWallet();
    void useP2PStore.getState().disconnect().catch(() => {});
    await identityService.deleteWallet();
    set({ status: "no_wallet", session: null, account: null, error: null });
  },

  exportPrivateKey: (password) => identityService.exportPrivateKey(password),

  registerOnChain: async (role, displayName) => {
    const txHash = await identityService.registerOnChain(role, displayName);
    set((state) => ({
      session: state.session
        ? {
            ...state.session,
            profile: { ...state.session.profile, role, displayName, onChainRegistered: true },
          }
        : null,
      account: state.account ? { ...state.account, role, displayName } : null,
    }));
    return txHash;
  },
}));
