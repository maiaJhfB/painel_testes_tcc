/**
 * @module MockIdentityService
 * @description Substitui IdentityService em modo __DEV_MOCK__
 *
 * Identidade real com infraestrutura de demonstração:
 * - Carteiras Ethereum reais, cifradas com senha local
 * - Assinatura SIWE real após desbloqueio da carteira
 * - Registro "on-chain" no servidor de dev local (SQLite via HTTP)
 * - Keystore V3 no SecureStore nativo ou armazenamento isolado do navegador
 *
 * IMPORTANTE: Esta classe implementa exatamente a mesma interface do
 * IdentityService real para que as telas não precisem ser alteradas.
 */

import * as SecureStore from "@/storage/secureStorage";
import * as Crypto from "expo-crypto";
import { getDevServerUrl } from "@/dev/serverUrl";
import { Wallet, hexlify, keccak256, toUtf8Bytes } from "ethers";
import { SiweMessage } from "siwe";
import type {
  CooperativeRole,
  IProtectedIdentityService,
  SessionValidationResult,
} from "@/core/ports";
import * as vault from "@/storage/walletVault";

// ─── Constantes ────────────────────────────────────────────────────────────────

const DID_STORE_KEY = "cooperativa_did";

// URL do servidor de dev local (mesmo do mock signaling)
// ─── Tipos (idênticos ao IdentityService real) ─────────────────────────────────

export interface IdentityProfile {
  did: string;
  role: "driver" | "client" | "admin";
  displayName: string;
  onChainRegistered: boolean;
  lastLogin: number;
}

export interface AuthSession {
  profile: IdentityProfile;
  sessionToken: string;
  expiresAt: number;
}

function deriveAddress(privateKey: string): string {
  return new Wallet(privateKey).address;
}

// ─── Mock Identity Service ─────────────────────────────────────────────────────

export class MockIdentityService implements IProtectedIdentityService {
  private privateKey: string | null = null;
  private address: string | null = null;

  // ── Gerenciamento de Chaves ─────────────────────────────────────────────────

  async generateNewWallet(password = ""): Promise<string> {
    vault.validatePassword(password);
    // A blockchain é simulada, mas a identidade continua sendo uma carteira
    // Ethereum real, criada com entropia nativa do sistema operacional.
    const pk = hexlify(await Crypto.getRandomBytesAsync(32));
    const addr = deriveAddress(pk);
    await vault.saveWallet(pk, password);
    this.privateKey = pk;
    this.address = addr;
    console.log("[DEV_MOCK] Wallet gerada:", addr);
    return addr;
  }

  async importWallet(privateKey: string, password = ""): Promise<string> {
    const key = privateKey.trim().replace(/^0x/i, "");
    if (/^[0-9a-f]{40}$/i.test(key)) {
      throw new Error("Esse valor é um DID (endereço público). Para entrar, use Copiar chave do passageiro ou do motorista no painel da demo.");
    }
    if (!/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error("Chave privada inválida. Cole a chave completa: 64 caracteres hexadecimais, com ou sem o prefixo 0x.");
    }
    const normalizedKey = `0x${key}`;
    let addr: string;
    try {
      addr = deriveAddress(normalizedKey);
    } catch {
      throw new Error("Chave privada inválida. Confira a chave copiada e tente novamente.");
    }
    try {
      await vault.saveWallet(normalizedKey, password);
    } catch {
      vault.validatePassword(password);
      throw new Error("Não foi possível proteger a identidade nesta janela. Tente novamente.");
    }
    this.privateKey = normalizedKey;
    this.address = addr;
    console.log("[DEV_MOCK] Wallet importada:", addr);
    return addr;
  }

  async loadWallet(password = ""): Promise<string | null> {
    this.lockWallet();
    const pk = await vault.unlockWallet(password);
    if (!pk) return null;
    this.address = deriveAddress(pk);
    this.privateKey = pk;
    console.log("[DEV_MOCK] Wallet carregada:", this.address);
    return this.address;
  }

  async deleteWallet(): Promise<void> {
    this.lockWallet();
    await vault.removeWallet();
  }

  lockWallet(): void {
    this.privateKey = null;
    this.address = null;
  }

  getWalletAccess() { return vault.walletAccess(); }

  async migrateWallet(password: string): Promise<string> {
    this.lockWallet();
    return vault.migrateLegacyWallet(password);
  }

  async exportPrivateKey(password: string): Promise<string> {
    const privateKey = await vault.unlockWallet(password);
    if (!privateKey) throw new Error("Identidade não encontrada.");
    return privateKey;
  }

  // ── Autenticação (assinatura SIWE real) ─────────────────────────────────────

  async createSignedSession(nonce: string): Promise<AuthSession> {
    if (!this.address || !this.privateKey) {
      throw new Error("Wallet não carregada. Crie ou importe sua identidade primeiro.");
    }

    // Mesmo login criptográfico EIP-4361 do aplicativo real. Na demo apenas o
    // registro/consulta da blockchain é substituído pelo servidor local.
    const issuedAt = new Date();
    const expirationTime = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
    const message = new SiweMessage({
      domain: "cooperativa-demo",
      address: this.address,
      statement: "Autentique-se no ambiente de demonstração da Cooperativa.",
      uri: "https://cooperativa-demo.local",
      version: "1",
      chainId: 137,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expirationTime.toISOString(),
    });
    const signature = await new Wallet(this.privateKey).signMessage(message.prepareMessage());
    const sessionToken = keccak256(toUtf8Bytes(signature));
    const expiresAt = expirationTime.getTime();

    const profile = await this._loadOrCreateProfile(this.address);

    console.log("[DEV_MOCK] Sessão criada para", this.address);

    return { profile, sessionToken, expiresAt };
  }

  async verifySession(
    _message: string,
    _signature: string
  ): Promise<SessionValidationResult> {
    try {
      const result = await new SiweMessage(_message).verify({ signature: _signature });
      if (!result.success) return { valid: false, address: null };
      if (new Date(result.data.expirationTime ?? 0) < new Date()) {
        return { valid: false, address: null };
      }
      return { valid: true, address: result.data.address };
    } catch {
      return { valid: false, address: null };
    }
  }

  // ── Registro "On-Chain" (via servidor dev local) ────────────────────────────

  async registerOnChain(
    role: CooperativeRole,
    displayName: string
  ): Promise<string> {
    if (!this.address) throw new Error("Wallet não carregada. Crie ou importe sua identidade primeiro.");

    const metadata = JSON.stringify({ role, displayName, version: "1.0" });

    const res = await fetch(`${getDevServerUrl()}/mock/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ did: this.address, metadata }),
    });
    if (!res.ok) throw new Error("Não foi possível registrar a identidade.");
    const data = await res.json();

    const profile: IdentityProfile = {
      did: this.address,
      role,
      displayName,
      onChainRegistered: true,
      lastLogin: Date.now(),
    };
    await SecureStore.setItemAsync(DID_STORE_KEY, JSON.stringify(profile));

    // Retorna um txHash fictício
    return data.txHash;
  }

  async isRegisteredOnChain(address: string): Promise<boolean> {
    try {
      const res = await fetch(`${getDevServerUrl()}/mock/identity/${address}`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.registered ?? false;
    } catch { return false; }
  }

  async getProfileFromChain(
    address: string
  ): Promise<Omit<IdentityProfile, "lastLogin"> | null> {
    try {
      const res = await fetch(`${getDevServerUrl()}/mock/identity/${address}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.registered) return null;
      return {
        did: address,
        role: data.metadata?.role ?? "client",
        displayName: data.metadata?.displayName ?? `Mock ${address.slice(0, 6)}`,
        onChainRegistered: true,
      };
    } catch { return null; }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async _loadOrCreateProfile(address: string): Promise<IdentityProfile> {
    const saved = await SecureStore.getItemAsync(DID_STORE_KEY);
    if (saved) {
      try {
        const profile: IdentityProfile = JSON.parse(saved);
        if (profile.did && profile.did.toLowerCase() === address.toLowerCase()) {
          profile.lastLogin = Date.now();
          await SecureStore.setItemAsync(DID_STORE_KEY, JSON.stringify(profile));
          return profile;
        }
      } catch {}
    }

    // Consulta se já existe perfil registrado no servidor de dev (ex: Carlos Silva ou Vitor Maia)
    try {
      const serverProfile = await this.getProfileFromChain(address);
      if (serverProfile) {
        const profile: IdentityProfile = {
          did: address,
          role: serverProfile.role as any,
          displayName: serverProfile.displayName,
          onChainRegistered: true,
          lastLogin: Date.now(),
        };
        await SecureStore.setItemAsync(DID_STORE_KEY, JSON.stringify(profile));
        return profile;
      }
    } catch {}

    return {
      did: address,
      role: "client",
      displayName: `Dev ${address.slice(0, 6)}`,
      onChainRegistered: false,
      lastLogin: Date.now(),
    };
  }

  get currentAddress(): string | null {
    return this.address;
  }
}

export const mockIdentityService = new MockIdentityService();
