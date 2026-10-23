import AsyncStorage from "@react-native-async-storage/async-storage";
import { demoAccounts } from "@/dev/demoAccounts";
import { setDevServerUrl } from "@/dev/serverUrl";

export type DemoPeer = "client" | "driver";

export interface DemoPairing {
  v: 1;
  server: string;
  session: string;
  peer: DemoPeer;
  savedAt: number;
}

const STORAGE_KEY = "cooperativa_demo_pairing";
let cached: DemoPairing | null = null;
let hydrated = false;

function normalizeServer(value: string): string {
  const server = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+$/i.test(server)) {
    throw new Error("O QR não contém um endereço de servidor válido.");
  }
  return server;
}

function readQuery(raw: string): Record<string, string> {
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  const values: Record<string, string> = {};
  for (const part of query.split("&")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    const key = decodeURIComponent(separator >= 0 ? part.slice(0, separator) : part);
    const value = separator >= 0 ? decodeURIComponent(part.slice(separator + 1)) : "";
    values[key] = value;
  }
  return values;
}

/** Aceita o JSON gerado pelo painel e, por compatibilidade, uma URL com query. */
export function parseDemoPairing(raw: string): DemoPairing {
  const text = raw.trim();
  if (!text) throw new Error("QR code vazio.");

  let data: Record<string, unknown>;
  try {
    data = text.startsWith("{") ? JSON.parse(text) : readQuery(text);
  } catch {
    throw new Error("Não foi possível ler o conteúdo do QR code.");
  }

  if (!data || Number(data.v) !== 1) {
    throw new Error("Este QR code não pertence ao painel desta demo.");
  }
  const server = normalizeServer(String(data.server ?? ""));
  const session = String(data.session ?? "").trim();
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(session)) {
    throw new Error("Sessão de demonstração inválida no QR code.");
  }
  if (data.peer !== "client" && data.peer !== "driver") {
    throw new Error("O QR code não indica se este aparelho é passageiro ou motorista.");
  }

  return {
    v: 1,
    server,
    session,
    peer: data.peer,
    savedAt: Date.now(),
  };
}

export async function saveDemoPairing(raw: string): Promise<DemoPairing> {
  const pairing = parseDemoPairing(raw);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
  cached = pairing;
  hydrated = true;
  setDevServerUrl(pairing.server);
  return pairing;
}

export async function hydrateDemoPairing(): Promise<DemoPairing | null> {
  if (hydrated) return cached;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setDevServerUrl(null);
      return null;
    }
    const pairing = parseDemoPairing(raw);
    cached = pairing;
    setDevServerUrl(pairing.server);
    return pairing;
  } catch {
    cached = null;
    setDevServerUrl(null);
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    return null;
  }
}

export function getCachedDemoPairing(): DemoPairing | null {
  return cached;
}

export async function clearDemoPairing(): Promise<void> {
  cached = null;
  hydrated = true;
  setDevServerUrl(null);
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

export function demoPeerProfile(peer: DemoPeer): { displayName: string; did: string } {
  const account = demoAccounts[peer];
  return { displayName: account.displayName, did: account.did };
}
