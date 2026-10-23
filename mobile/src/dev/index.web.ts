/**
 * Implementações usadas pela sessão web da demonstração.
 *
 * Este entrypoint mantém módulos nativos (WebRTC e SecureStore nativo) fora do
 * bundle do navegador, preservando as mesmas interfaces consumidas pelas telas.
 */
import type { IProtectedIdentityService, IP2PServiceConstructor } from "@/core/ports";
import { mockIdentityService } from "@/dev/MockIdentityService";
import { MockP2PService } from "@/dev/MockP2PService";

export const IS_DEV_MOCK = true;
export { DEV_SERVER_URL, getDevServerUrl, setDevServerUrl } from "@/dev/serverUrl";

export const identityService: IProtectedIdentityService = mockIdentityService;
export const P2PServiceClass: IP2PServiceConstructor = MockP2PService;

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

export function devLog(tag: string, ...args: any[]) {
  console.log(`[DEV_MOCK:${tag}]`, ...args);
}
