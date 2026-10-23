import { Platform } from "react-native";
import { getCachedDemoPairing } from "@/dev/demoPairing";

export type BrowserDemoPeer = "client" | "driver";

function params(): URLSearchParams | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function rememberContext(): void {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const query = params();
  const session = query?.get("demoSession");
  const peer = query?.get("demoPeer");
  if (session) window.sessionStorage.setItem("cooperativa_demo_session", session);
  if (peer === "client" || peer === "driver") {
    window.sessionStorage.setItem("cooperativa_demo_peer", peer);
  }
}

export function getBrowserDemoPeer(): BrowserDemoPeer | null {
  rememberContext();
  const value = params()?.get("demoPeer")
    ?? (typeof window !== "undefined" ? window.sessionStorage.getItem("cooperativa_demo_peer") : null);
  return value === "client" || value === "driver" ? value : null;
}

export function getBrowserDemoSessionId(): string | null {
  rememberContext();
  return params()?.get("demoSession")
    ?? (typeof window !== "undefined" ? window.sessionStorage.getItem("cooperativa_demo_session") : null);
}

/**
 * Papel configurado nesta instalação: pela URL nas duas janelas web ou pelo
 * QR do painel no APK. O QR tem prioridade no celular porque é a configuração
 * explícita daquela instalação.
 */
export function getDemoPeer(): BrowserDemoPeer | null {
  if (Platform.OS !== "web") return getCachedDemoPairing()?.peer ?? null;
  return getBrowserDemoPeer() ?? getCachedDemoPairing()?.peer ?? null;
}

export function getDemoSessionId(): string | null {
  if (Platform.OS === "web") {
    const browserSession = getBrowserDemoSessionId();
    if (browserSession) return browserSession;
  }
  return getCachedDemoPairing()?.session ?? null;
}

/**
 * Indica que o aparelho foi pareado com uma sessão controlada pelo painel.
 * Nesse modo o chamador espera o aceite do outro aparelho em vez de acionar
 * o motorista automático do servidor.
 */
export function isPairedBrowserDemo(): boolean {
  return Boolean(getDemoPeer() && getDemoSessionId());
}

export function configureBrowserDemoWindow(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const peer = getBrowserDemoPeer();
  document.title = peer === "driver"
    ? "Cooperativa — Motorista"
    : peer === "client"
      ? "Cooperativa — Passageiro"
      : "Cooperativa";
  document.documentElement.style.backgroundColor = "#020617";
  document.body.style.margin = "0";
  document.body.style.backgroundColor = "#020617";
}
