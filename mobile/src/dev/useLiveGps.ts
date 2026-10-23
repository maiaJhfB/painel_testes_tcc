import { useEffect } from "react";
import { Platform } from "react-native";
import { browserLocationService } from "@/services/BrowserLocationService";
import { useGpsStore } from "@/store/useGpsStore";
import { useP2PStore } from "@/store/useP2PStore";

/**
 * Publica a localização real do dispositivo durante a corrida.
 *
 * Fica no layout raiz para continuar recebendo posições mesmo quando o
 * usuário abre o chat. No celular nativo o GPS é controlado pelas telas via
 * ForegroundLocationService (expo-location); aqui só a versão web é atendida.
 */
export function useLiveGps(): void {
  const rideActive = useP2PStore((state) => state.status === "active");
  const updateMyLocation = useP2PStore((state) => state.updateMyLocation);
  const applyGps = useGpsStore((state) => state.apply);
  const resetGps = useGpsStore((state) => state.reset);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!rideActive) {
      resetGps();
      return;
    }

    const lease = browserLocationService.acquire(
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
