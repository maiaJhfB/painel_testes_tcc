/**
 * @module devMode
 * @description Ponto central de controle do modo de testes
 *
 * Exporta os serviços corretos baseado na flag DEV_MOCK_ENABLED em app.json.
 * As telas e stores NUNCA importam diretamente IdentityService ou P2PService —
 * sempre importam daqui. Isso garante troca transparente.
 *
 * IMPORTANTE: Os imports do serviço real são lazy (require dinâmico) para evitar
 * que react-native-webrtc seja carregado em tempo de bundle quando em modo mock.
 * O react-native-webrtc requer módulo nativo — só funciona com EAS Build, não Expo Go.
 *
 * Como ativar o modo dev:
 *   Em apps/mobile/app.json, defina:
 *   "extra": { "DEV_MOCK_ENABLED": true, "DEV_SERVER_URL": "http://<IP>:4747" }
 *   Depois reinicie com: npx expo start --clear
 */

import Constants from "expo-constants";

// ─── Flag de controle ──────────────────────────────────────────────────────────

export const IS_DEV_MOCK: boolean =
  Constants.expoConfig?.extra?.DEV_MOCK_ENABLED === true ||
  Constants.expoConfig?.extra?.DEV_MOCK_ENABLED === "true";

export { DEV_SERVER_URL, getDevServerUrl, setDevServerUrl } from "@/dev/serverUrl";

// ─── Re-exports de tipos (não causam carregamento de módulos nativos) ──────────

export type {
  AuthSession,
  ChatMessage,
  IIdentityService,
  IP2PService,
  IP2PServiceConstructor,
  IdentityProfile,
  LocationUpdate,
  P2PCallbacks,
  P2PPayload,
  StatusUpdate,
} from "@/core/ports";
import type {
  IProtectedIdentityService,
  IP2PServiceConstructor,
} from "@/core/ports";

// ─── Serviço de identidade ─────────────────────────────────────────────────────

import { mockIdentityService } from "@/dev/MockIdentityService";

// Esta cópia é dedicada à demonstração e sempre usa a infraestrutura local.
// A implementação real permanece intacta no projeto principal tcc-2026.
export const identityService: IProtectedIdentityService = mockIdentityService;

// ─── Classe P2P ────────────────────────────────────────────────────────────────

import { MockP2PService } from "@/dev/MockP2PService";

/**
 * P2PServiceClass: instancia a implementação correta baseada no modo.
 *
 * Em modo DEV_MOCK: MockP2PService (sem WebRTC, polling HTTP)
 * Em modo PROD: RealP2PService — carregado via require lazy para que
 *   react-native-webrtc NÃO seja incluído no bundle em modo mock.
 *   Em Expo Go sem DEV_MOCK_ENABLED: true, o app irá crashar pois
 *   react-native-webrtc requer EAS Build com módulo nativo.
 */
export const P2PServiceClass: IP2PServiceConstructor = MockP2PService;

// ─── Utilitários internos ─────────────────────────────────────────────────────

/** Log técnico que só aparece no terminal, nunca na interface do usuário. */
export function devLog(tag: string, ...args: any[]) {
  if (IS_DEV_MOCK) {
    console.log(`\x1b[36m[DEV_MOCK:${tag}]\x1b[0m`, ...args);
  }
}
