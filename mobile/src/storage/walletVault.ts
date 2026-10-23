import * as Crypto from "expo-crypto";
import { decryptKeystoreJson, encryptKeystoreJson, getAddress, hexlify, Wallet } from "ethers";
import * as storage from "@/storage/secureStorage";
import type { WalletAccess } from "@/core/ports";
import { demoAccounts } from "@/dev/demoAccounts";

export const VAULT_KEY = "cooperativa_wallet_keystore";
const LEGACY_KEY = "cooperativa_wallet_pk";

export function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Crie uma senha com pelo menos 8 caracteres.");
  }
}

export async function walletAccess(): Promise<WalletAccess> {
  const encrypted = await storage.getItemAsync(VAULT_KEY);
  if (encrypted) {
    try {
      const did = getAddress(`0x${JSON.parse(encrypted).address}`);
      return { kind: "locked", did };
    } catch {
      return { kind: "locked", did: null };
    }
  }
  return { kind: await storage.getItemAsync(LEGACY_KEY) ? "legacy" : "missing", did: null };
}

export async function prepareDemoAccount(peer: "client" | "driver"): Promise<void> {
  if ((await walletAccess()).kind !== "missing") return;
  await storage.setItemAsync(VAULT_KEY, JSON.stringify(demoAccounts[peer].keystore));
}

export async function saveWallet(privateKey: string, password: string): Promise<string> {
  validatePassword(password);
  const wallet = new Wallet(privateKey);
  const [salt, iv, uuid] = await Promise.all([
    Crypto.getRandomBytesAsync(32), Crypto.getRandomBytesAsync(16), Crypto.getRandomBytesAsync(16),
  ]);
  const encrypted = await encryptKeystoreJson(
    { address: wallet.address, privateKey: wallet.privateKey }, password,
    { salt, iv, uuid: hexlify(uuid) },
  );
  // A gravação deve terminar antes de remover o formato antigo.
  await storage.setItemAsync(VAULT_KEY, encrypted);
  await storage.deleteItemAsync(LEGACY_KEY);
  return wallet.address;
}

export async function unlockWallet(password: string): Promise<string | null> {
  const encrypted = await storage.getItemAsync(VAULT_KEY);
  if (!encrypted) return null;
  if (!password) throw new Error("Digite sua senha para desbloquear a identidade.");
  try {
    const account = await decryptKeystoreJson(encrypted, password);
    return account.privateKey;
  } catch {
    throw new Error("Senha incorreta ou identidade indisponível. Confira sua senha e tente novamente.");
  }
}

export async function migrateLegacyWallet(password: string): Promise<string> {
  validatePassword(password);
  const privateKey = await storage.getItemAsync(LEGACY_KEY);
  if (!privateKey) throw new Error("Identidade não encontrada. Crie ou importe sua conta.");
  return saveWallet(privateKey, password);
}

export async function removeWallet(): Promise<void> {
  await storage.deleteItemAsync(VAULT_KEY);
  await storage.deleteItemAsync(LEGACY_KEY);
  await storage.deleteItemAsync("cooperativa_did");
}
