/**
 * @module IdentityService
 * @description Módulo de Identidade Autossoberana (SSI) baseado em EIP-4361
 *
 * Implementa autenticação sem servidor central:
 * 1. Usuário gera ou importa par de chaves criptográficas (armazenadas localmente)
 * 2. Login ocorre via assinatura digital local (Sign-In With Ethereum - EIP-4361)
 * 3. Verificação da identidade é feita on-chain no contrato IdentityRegistry (Polygon)
 *
 * Referência: NAKAMOTO (2008) — consenso distribuído sem autoridade central
 * Referência: EIP-4361 — https://eips.ethereum.org/EIPS/eip-4361
 */

import * as SecureStore from "@/storage/secureStorage";
import * as Crypto from "expo-crypto";
import { ethers } from "ethers";
import { SiweMessage } from "siwe";
import Constants from "expo-constants";
import type {
  AuthSession,
  CooperativeRole,
  IIdentityService,
  IdentityProfile,
  SessionValidationResult,
} from "@/core/ports";

export type {
  AuthSession,
  CooperativeRole,
  IIdentityService,
  IdentityProfile,
  SessionValidationResult,
} from "@/core/ports";

// ─── Constantes ────────────────────────────────────────────────────────────────

const PRIVATE_KEY_STORE_KEY = "cooperativa_wallet_pk";
const DID_STORE_KEY = "cooperativa_did";
const POLYGON_RPC_URL =
  Constants.expoConfig?.extra?.POLYGON_RPC_URL ?? "https://polygon-rpc.com";
const IDENTITY_CONTRACT_ADDRESS =
  Constants.expoConfig?.extra?.IDENTITY_CONTRACT_ADDRESS ?? "";

// ABI mínimo do contrato IdentityRegistry (apenas funções necessárias)
const IDENTITY_REGISTRY_ABI = [
  "function register(address did, string calldata metadata) external",
  "function isRegistered(address did) external view returns (bool)",
  "function getMetadata(address did) external view returns (string)",
  "function deregister() external",
  "event Registered(address indexed did, string metadata)",
  "event Deregistered(address indexed did)",
];

// ─── Tipos ─────────────────────────────────────────────────────────────────────

// ─── Serviço de Identidade ────────────────────────────────────────────────────

export class IdentityService implements IIdentityService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | null = null;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL);
  }

  // ── Gerenciamento de Chaves ─────────────────────────────────────────────────

  /**
   * Gera um novo par de chaves e persiste a chave privada no SecureStore do
   * dispositivo. A chave NUNCA trafega pela rede.
   */
  async generateNewWallet(): Promise<string> {
    const randomBytes = await Crypto.getRandomBytesAsync(32);
    const hexKey =
      "0x" +
      Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const wallet = new ethers.Wallet(hexKey);
    await SecureStore.setItemAsync(PRIVATE_KEY_STORE_KEY, hexKey);

    this.wallet = wallet;
    return wallet.address;
  }

  /**
   * Importa uma chave privada existente (ex: MetaMask export).
   * Valida o formato antes de persistir.
   */
  async importWallet(privateKey: string): Promise<string> {
    try {
      const wallet = new ethers.Wallet(privateKey);
      await SecureStore.setItemAsync(PRIVATE_KEY_STORE_KEY, privateKey);
      this.wallet = wallet;
      return wallet.address;
    } catch {
      throw new Error("Chave privada inválida. Verifique o formato (0x...).");
    }
  }

  /**
   * Carrega a wallet do armazenamento seguro do dispositivo.
   * Retorna null se nenhuma chave foi gerada ainda.
   */
  async loadWallet(): Promise<string | null> {
    const pk = await SecureStore.getItemAsync(PRIVATE_KEY_STORE_KEY);
    if (!pk) return null;

    this.wallet = new ethers.Wallet(pk, this.provider);
    return this.wallet.address;
  }

  /** Remove a chave privada do dispositivo (logout permanente / troca de identidade) */
  async deleteWallet(): Promise<void> {
    await SecureStore.deleteItemAsync(PRIVATE_KEY_STORE_KEY);
    await SecureStore.deleteItemAsync(DID_STORE_KEY);
    this.wallet = null;
  }

  // ── Autenticação EIP-4361 (Sign-In With Ethereum) ──────────────────────────

  /**
   * Cria e assina uma mensagem SIWE localmente.
   * A assinatura prova propriedade da chave sem revelar a chave privada.
   *
   * @param nonce - Valor único fornecido pelo servidor de sinalização para
   *                prevenir replay attacks
   */
  async createSignedSession(nonce: string): Promise<AuthSession> {
    if (!this.wallet) {
      throw new Error(
        "Wallet não carregada. Chame loadWallet() ou generateNewWallet() primeiro."
      );
    }

    const address = this.wallet.address;
    const issuedAt = new Date();
    const expirationTime = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000); // 24h

    const siweMessage = new SiweMessage({
      domain: "cooperativa-plataforma",
      address,
      statement:
        "Autentique-se na Cooperativa de Plataforma. Sua identidade é autossoberana.",
      uri: "https://cooperativa-plataforma",
      version: "1",
      chainId: 137, // Polygon Mainnet
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expirationTime.toISOString(),
    });

    const messageToSign = siweMessage.prepareMessage();
    const signature = await this.wallet.signMessage(messageToSign);

    // Token de sessão = hash da assinatura (identificador local)
    const sessionToken = ethers.keccak256(ethers.toUtf8Bytes(signature));

    // Carrega perfil salvo ou cria um básico
    const profile = await this._loadOrCreateProfile(address);

    const session: AuthSession = {
      profile,
      sessionToken,
      expiresAt: expirationTime.getTime(),
    };

    return session;
  }

  /**
   * Verifica localmente se uma sessão SIWE ainda é válida.
   * A verificação é feita sem chamar nenhum servidor externo.
   */
  async verifySession(
    message: string,
    signature: string
  ): Promise<SessionValidationResult> {
    try {
      const siweMessage = new SiweMessage(message);
      const result = await siweMessage.verify({ signature });

      if (!result.success) return { valid: false, address: null };
      if (new Date(result.data.expirationTime ?? 0) < new Date())
        return { valid: false, address: null };

      return { valid: true, address: result.data.address };
    } catch {
      return { valid: false, address: null };
    }
  }

  // ── Registro On-Chain (Polygon) ─────────────────────────────────────────────

  /**
   * Registra o DID do usuário no contrato IdentityRegistry na Polygon.
   * Custo estimado: ~0.001 MATIC (~R$ 0,003 em 2025).
   *
   * @param role - Papel do usuário na cooperativa
   * @param displayName - Nome de exibição público
   */
  async registerOnChain(
    role: CooperativeRole,
    displayName: string
  ): Promise<string> {
    if (!this.wallet || !IDENTITY_CONTRACT_ADDRESS) {
      throw new Error(
        "Wallet não carregada ou endereço do contrato não configurado."
      );
    }

    const connectedWallet = this.wallet.connect(this.provider);
    const contract = new ethers.Contract(
      IDENTITY_CONTRACT_ADDRESS,
      IDENTITY_REGISTRY_ABI,
      connectedWallet
    );

    const metadata = JSON.stringify({ role, displayName, version: "1.0" });
    const tx = await contract.register(this.wallet.address, metadata);
    const receipt = await tx.wait();

    // Persiste perfil localmente
    const profile: IdentityProfile = {
      did: this.wallet.address,
      role,
      displayName,
      onChainRegistered: true,
      lastLogin: Date.now(),
    };
    await SecureStore.setItemAsync(DID_STORE_KEY, JSON.stringify(profile));

    return receipt.hash;
  }

  /**
   * Verifica se um endereço está registrado na blockchain.
   * Usado para validar parceiros antes de iniciar uma conexão P2P.
   */
  async isRegisteredOnChain(address: string): Promise<boolean> {
    if (!IDENTITY_CONTRACT_ADDRESS) return false;
    const contract = new ethers.Contract(
      IDENTITY_CONTRACT_ADDRESS,
      IDENTITY_REGISTRY_ABI,
      this.provider
    );
    return contract.isRegistered(address);
  }

  /**
   * Busca o perfil completo de um endereço diretamente da blockchain.
   */
  async getProfileFromChain(
    address: string
  ): Promise<Omit<IdentityProfile, "lastLogin"> | null> {
    if (!IDENTITY_CONTRACT_ADDRESS) return null;
    const contract = new ethers.Contract(
      IDENTITY_CONTRACT_ADDRESS,
      IDENTITY_REGISTRY_ABI,
      this.provider
    );
    const isRegistered = await contract.isRegistered(address);
    if (!isRegistered) return null;

    const metadataRaw = await contract.getMetadata(address);
    const metadata = JSON.parse(metadataRaw);

    return {
      did: address,
      role: metadata.role,
      displayName: metadata.displayName,
      onChainRegistered: true,
    };
  }

  // ── Helpers Privados ────────────────────────────────────────────────────────

  private async _loadOrCreateProfile(
    address: string
  ): Promise<IdentityProfile> {
    const saved = await SecureStore.getItemAsync(DID_STORE_KEY);
    if (saved) {
      const profile: IdentityProfile = JSON.parse(saved);
      profile.lastLogin = Date.now();
      await SecureStore.setItemAsync(DID_STORE_KEY, JSON.stringify(profile));
      return profile;
    }

    // Perfil básico para usuário ainda não registrado on-chain
    return {
      did: address,
      role: "client",
      displayName: `Usuário ${address.slice(0, 6)}`,
      onChainRegistered: false,
      lastLogin: Date.now(),
    };
  }

  get currentAddress(): string | null {
    return this.wallet?.address ?? null;
  }
}

// Singleton exportado
export const identityService = new IdentityService();
