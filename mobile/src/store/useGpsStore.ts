import { create } from "zustand";
import {
  IDLE_GPS_SNAPSHOT,
  type BrowserGpsSnapshot,
} from "@/services/BrowserLocationService";

interface GpsState extends BrowserGpsSnapshot {
  apply: (snapshot: BrowserGpsSnapshot) => void;
  reset: () => void;
}

/**
 * Estado compartilhado do GPS real do navegador.
 *
 * O hook de layout alimenta este store; a tela do mapa lê o status para
 * distinguir GPS real de trajeto de demonstração sem duplicar observadores.
 */
export const useGpsStore = create<GpsState>((set) => ({
  ...IDLE_GPS_SNAPSHOT,
  apply: (snapshot) => set(snapshot),
  reset: () => set(IDLE_GPS_SNAPSHOT),
}));
