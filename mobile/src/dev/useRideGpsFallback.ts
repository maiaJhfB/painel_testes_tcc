import { useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { useGpsStore } from "@/store/useGpsStore";
import { useP2PStore } from "@/store/useP2PStore";
import { loadDemoRoute, PICKUP_POINT, point, sampleRoute } from "@/dev/demoRoutes";

const FALLBACK_GPS_STATUSES = ["denied", "unavailable", "timeout", "unsupported"] as const;

/**
 * Trajeto de demonstração usado apenas quando o GPS real não pode operar
 * (permissão negada, navegador sem suporte ou rede sem HTTPS/localhost).
 *
 * Com o GPS real ativo este hook não publica nada: a posição vem do
 * BrowserLocationService e representa o aparelho do usuário.
 */
export function useRideGpsFallback(): void {
  const gpsStatus = useGpsStore((state) => state.status);
  const fallback = (FALLBACK_GPS_STATUSES as readonly string[]).includes(gpsStatus);
  const role = useAuthStore((state) => state.session?.profile.role);
  const status = useP2PStore((state) => state.status);
  const rideStatus = useP2PStore((state) => state.rideStatus);
  const peerLocation = useP2PStore((state) => state.peerLocation);
  const updateMyLocation = useP2PStore((state) => state.updateMyLocation);

  useEffect(() => {
    if (!fallback || status !== "active" || role !== "driver") return;
    if (rideStatus === "completed" || rideStatus === "cancelled") return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const phase = rideStatus === "in_progress" ? "trip" : "pickup";
    const start = () => { void loadDemoRoute(phase).then((route) => {
      if (cancelled) return;
      if (rideStatus === "arrived") {
        const end = point(route.coordinates[route.coordinates.length - 1]);
        updateMyLocation(end.latitude, end.longitude, 0, 0);
        return;
      }
      const startedAt = Date.now();
      const duration = phase === "trip" ? 70_000 : 45_000;
      const publish = () => {
        const progress = Math.min(1, (Date.now() - startedAt) / duration);
        const location = sampleRoute(route, progress);
        updateMyLocation(location.latitude, location.longitude, undefined, progress < 1 ? route.distanceMeters / route.durationSeconds : 0);
      };
      publish();
      timer = setInterval(publish, 1000);
    }).catch(() => {
      if (!cancelled) retry = setTimeout(start, 4000);
    }); };
    start();
    return () => { cancelled = true; if (timer) clearInterval(timer); if (retry) clearTimeout(retry); };
  }, [fallback, role, status, rideStatus, updateMyLocation]);

  useEffect(() => {
    if (!fallback || status !== "active" || role !== "client") return;
    if (rideStatus === "completed" || rideStatus === "cancelled") return;
    const location = rideStatus === "in_progress" && peerLocation ? peerLocation : PICKUP_POINT;
    updateMyLocation(location.latitude, location.longitude);
  }, [fallback, role, status, rideStatus, peerLocation, updateMyLocation]);
}
