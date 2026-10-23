import { useEffect } from "react";
import { rideLocationService } from "@/services/rideLocationService";
import { useGpsStore } from "@/store/useGpsStore";
import { useP2PStore } from "@/store/useP2PStore";

/**
 * Publica a localização real do dispositivo durante a corrida.
 *
 * Fica no layout raiz para continuar recebendo posições mesmo quando o
 * usuário abre o chat. O adaptador usa expo-location no APK e a API do navegador na web.
 */
export function useLiveGps(): void {
  const rideActive = useP2PStore((state) => state.status === "active");
  const updateMyLocation = useP2PStore((state) => state.updateMyLocation);
  const applyGps = useGpsStore((state) => state.apply);
  const resetGps = useGpsStore((state) => state.reset);

  useEffect(() => {
    if (!rideActive) {
      resetGps();
      return;
    }

    const lease = rideLocationService.acquire(
      (position) => {
        updateMyLocation(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.heading ?? undefined,
          position.coords.speed ?? undefined
        );
      },
      applyGps
    );

    return () => {
      lease.release();
      resetGps();
    };
  }, [rideActive, updateMyLocation, applyGps, resetGps]);
}
