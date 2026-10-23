/**
 * Compatibilidade: o antigo GPS simulado foi substituído pelo GPS real do
 * navegador. Este nome permanece apenas como alias do fallback demonstrativo,
 * ativado quando o dispositivo não pode fornecer localização.
 */
export { useRideGpsFallback as useDemoGps } from "@/dev/useRideGpsFallback";
