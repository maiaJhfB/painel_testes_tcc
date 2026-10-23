/**
 * @module useP2PStore
 * @description Re-exporta de useP2PStore.dev.ts que usa P2PServiceClass condicional.
 * Em modo DEV_MOCK usa MockP2PService; em prod usa P2PService real.
 *
 * NOTA: O P2PService real (react-native-webrtc) requer build nativo (EAS Build).
 * Para desenvolvimento com Expo Go, mantenha DEV_MOCK_ENABLED: true no app.json.
 */
export { useP2PStore } from "./useP2PStore.dev";
