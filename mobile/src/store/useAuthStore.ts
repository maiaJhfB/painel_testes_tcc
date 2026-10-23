/**
 * @module useAuthStore
 * @description Re-exporta de useAuthStore.dev.ts que usa identityService condicional.
 * Em modo DEV_MOCK usa MockIdentityService; em prod usa IdentityService real.
 *
 * NOTA: O IdentityService real usa ethers + expo-secure-store + Polygon RPC.
 * Para desenvolvimento com Expo Go, mantenha DEV_MOCK_ENABLED: true no app.json.
 */
export { useAuthStore } from "./useAuthStore.dev";
