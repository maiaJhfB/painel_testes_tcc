import Constants from "expo-constants";
import { Platform } from "react-native";

const configuredUrl: string =
  Constants.expoConfig?.extra?.DEV_SERVER_URL ?? "http://localhost:4747";

let runtimeUrl: string | null = null;

/** Endereço configurado pelo QR do painel, válido para toda a sessão. */
export function setDevServerUrl(url: string | null): void {
  runtimeUrl = url;
}

/**
 * Endereço efetivo do servidor da demo.
 *
 * A ordem é: QR do painel → mesma máquina que serviu o app web → app.json.
 * A consulta é feita na hora da requisição para que o pareamento por QR
 * funcione sem reconstruir o APK.
 */
export function getDevServerUrl(): string {
  if (runtimeUrl) return runtimeUrl;
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:4747`;
  }
  return configuredUrl;
}

/** Compatibilidade com imports antigos; prefira getDevServerUrl(). */
export const DEV_SERVER_URL = configuredUrl;
