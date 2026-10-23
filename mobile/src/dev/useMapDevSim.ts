/**
 * @module useMapDevSim
 * @description Hook de simulação GPS para modo DEV_MOCK
 *
 * Quando IS_DEV_MOCK=true, permite simular:
 * - Movimento do par remoto ao longo de uma rota fictícia em SP
 * - Cenários: motorista a caminho, em corrida, tráfego lento
 * - Controles via estado React (sem UI extra — painel web faz isso no servidor)
 *
 * Em produção (IS_DEV_MOCK=false) o hook é no-op: retorna handlers vazios.
 *
 * Uso:
 *   const { startSim, stopSim, isRunning } = useMapDevSim({ sessionId, targetDid });
 */

import { useRef, useState, useCallback } from "react";
import { IS_DEV_MOCK } from "@/dev/index";
import { getDevServerUrl } from "@/dev/serverUrl";

// ─── Rotas simuladas em SP ────────────────────────────────────────────────────
// Waypoints reais da cidade de SP para simular trajetos verossímeis

const SP_ROUTES: Record<string, Array<{ lat: number; lng: number }>> = {
  /** Consolação → Pinheiros (rota típica de corrida) */
  consolacao_pinheiros: [
    { lat: -23.5505, lng: -46.6558 },
    { lat: -23.5520, lng: -46.6590 },
    { lat: -23.5540, lng: -46.6630 },
    { lat: -23.5560, lng: -46.6680 },
    { lat: -23.5580, lng: -46.6720 },
    { lat: -23.5600, lng: -46.6760 },
    { lat: -23.5620, lng: -46.6800 },
    { lat: -23.5640, lng: -46.6830 },
  ],
  /** Vila Madalena → Jardins */
  madalena_jardins: [
    { lat: -23.5545, lng: -46.6900 },
    { lat: -23.5530, lng: -46.6850 },
    { lat: -23.5515, lng: -46.6800 },
    { lat: -23.5500, lng: -46.6750 },
    { lat: -23.5485, lng: -46.6700 },
    { lat: -23.5470, lng: -46.6650 },
    { lat: -23.5460, lng: -46.6600 },
    { lat: -23.5450, lng: -46.6558 },
  ],
  /** Centro → Paulista */
  centro_paulista: [
    { lat: -23.5489, lng: -46.6388 },
    { lat: -23.5495, lng: -46.6420 },
    { lat: -23.5500, lng: -46.6450 },
    { lat: -23.5505, lng: -46.6490 },
    { lat: -23.5510, lng: -46.6520 },
    { lat: -23.5516, lng: -46.6545 },
    { lat: -23.5524, lng: -46.6555 },
    { lat: -23.5533, lng: -46.6558 },
  ],
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface SimOptions {
  sessionId: string | null;
  targetDid: string | null;
  routeKey?: keyof typeof SP_ROUTES;
  /** Intervalo entre atualizações em ms. Default: 2000 */
  intervalMs?: number;
}

interface SimControls {
  startSim: (opts?: Partial<SimOptions>) => void;
  stopSim: () => void;
  isRunning: boolean;
  currentRouteKey: string | null;
  availableRoutes: string[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMapDevSim(defaultOpts: SimOptions): SimControls {
  const [isRunning, setIsRunning] = useState(false);
  const [currentRouteKey, setCurrentRouteKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(0);

  const stopSim = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRunning(false);
    stepRef.current = 0;
  }, []);

  const startSim = useCallback(
    (overrides?: Partial<SimOptions>) => {
      if (!IS_DEV_MOCK) return; // no-op em produção

      stopSim();

      const opts = { ...defaultOpts, ...overrides };
      const routeKey = opts.routeKey ?? "consolacao_pinheiros";
      const route = SP_ROUTES[routeKey] ?? SP_ROUTES["consolacao_pinheiros"];
      const interval = opts.intervalMs ?? 2000;

      setCurrentRouteKey(routeKey);
      setIsRunning(true);
      stepRef.current = 0;

      timerRef.current = setInterval(async () => {
        const step = stepRef.current;
        if (step >= route.length) {
          stopSim();
          return;
        }

        const point = route[step];
        stepRef.current++;

        if (!opts.sessionId || !opts.targetDid) return;

        try {
          await fetch(`${getDevServerUrl()}/mock/p2p/inject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: opts.sessionId,
              targetDid: opts.targetDid,
              payload: {
                type: "location",
                latitude: point.lat + (Math.random() - 0.5) * 0.0002, // pequeno ruído
                longitude: point.lng + (Math.random() - 0.5) * 0.0002,
                speed: 8 + Math.random() * 6, // 8–14 m/s (~30–50 km/h)
                heading: calculateHeading(route, step),
                timestamp: Date.now(),
              },
            }),
          });
        } catch {
          // dev server offline — silencioso
        }
      }, interval);
    },
    [defaultOpts, stopSim]
  );

  return {
    startSim,
    stopSim,
    isRunning,
    currentRouteKey,
    availableRoutes: Object.keys(SP_ROUTES),
  };
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function calculateHeading(
  route: Array<{ lat: number; lng: number }>,
  currentStep: number
): number {
  if (currentStep >= route.length - 1) return 0;
  const curr = route[currentStep];
  const next = route[currentStep + 1];
  const dLng = next.lng - curr.lng;
  const dLat = next.lat - curr.lat;
  const angle = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  return (angle + 360) % 360;
}
