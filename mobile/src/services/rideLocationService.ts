import { foregroundLocationService, type ForegroundLocationLease } from "./ForegroundLocationService";
import { IDLE_GPS_SNAPSHOT, type BrowserGpsSnapshot } from "./BrowserLocationService";
import type { LocationObject } from "expo-location";

/** One native GPS subscription for the whole ride, including the chat screen. */
class RideLocationService {
  private lease: ForegroundLocationLease | null = null;

  acquire(onPosition: (position: LocationObject) => void, report: (state: BrowserGpsSnapshot) => void) {
    this.lease?.release();
    let active = true;
    let hasFix = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { if (timeout) clearTimeout(timeout); };
    const waiting = () => {
      hasFix = false;
      clear();
      report({ ...IDLE_GPS_SNAPSHOT, status: "requesting", message: "Obtendo localização do celular..." });
      timeout = setTimeout(() => {
        if (active && !hasFix) report({ ...IDLE_GPS_SNAPSHOT, status: "timeout", message: "O GPS demorou para responder. Aproxime-se de uma janela ou tente novamente." });
      }, 20_000);
    };
    const lease = foregroundLocationService.acquire(position => {
      if (!active) return;
      hasFix = true;
      clear();
      report({ status: "tracking", message: "GPS do celular ativo.", accuracyMeters: position.coords.accuracy,
        lastFixAt: position.timestamp, canRetry: true });
      onPosition(position);
    }, state => {
      if (!active) return;
      if (state.status === "checking") waiting();
      // Starting a watch is not evidence of a GPS fix.
      if (state.status === "denied" || state.status === "disabled" || state.status === "error") {
        clear();
        report({ ...IDLE_GPS_SNAPSHOT, status: state.status === "denied" ? "denied" : "unavailable",
          message: state.message, canRetry: true });
      }
    });
    this.lease = lease;
    return { retry: () => lease.retry(), release: () => {
      active = false;
      clear();
      lease.release();
      if (this.lease === lease) this.lease = null;
    } };
  }

  retry(): void { this.lease?.retry(); }
}

export const rideLocationService = new RideLocationService();
