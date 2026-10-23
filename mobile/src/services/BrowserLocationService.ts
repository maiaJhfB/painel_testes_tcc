import { Platform } from "react-native";

/**
 * GPS real do navegador.
 *
 * A demo web usa a Geolocation API nativa do navegador, sem chave de API e sem
 * provedor pago. O navegador só libera a localização em contexto seguro
 * (HTTPS) ou em localhost; fora disso a demo cai no trajeto de demonstração.
 */

export type BrowserGpsStatus =
  | "idle"
  | "requesting"
  | "tracking"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported";

export interface BrowserGpsSnapshot {
  status: BrowserGpsStatus;
  message: string;
  accuracyMeters: number | null;
  lastFixAt: number | null;
  canRetry: boolean;
}

export interface BrowserGpsLease {
  retry: () => void;
  release: () => void;
}

export const IDLE_GPS_SNAPSHOT: BrowserGpsSnapshot = {
  status: "idle",
  message: "GPS ainda não iniciado.",
  accuracyMeters: null,
  lastFixAt: null,
  canRetry: true,
};

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 3000,
  timeout: 20_000,
};

function failure(code: number): Pick<BrowserGpsSnapshot, "status" | "message" | "canRetry"> {
  if (code === 1) {
    return {
      status: "denied",
      message:
        "Permissão de localização negada. Autorize o GPS para este site nas configurações do navegador e toque em Tentar GPS.",
      canRetry: true,
    };
  }
  if (code === 2) {
    return {
      status: "unavailable",
      message: "O GPS não está disponível neste dispositivo. Verifique se a localização do sistema está ativada.",
      canRetry: true,
    };
  }
  return {
    status: "timeout",
    message: "O GPS demorou para responder. Aproxime-se de uma janela ou toque em Tentar GPS.",
    canRetry: true,
  };
}

function unsupported(message: string): BrowserGpsSnapshot {
  return { status: "unsupported", message, accuracyMeters: null, lastFixAt: null, canRetry: false };
}

class BrowserLocationService {
  private watchId: number | null = null;
  private generation = 0;
  private onPosition: ((position: GeolocationPosition) => void) | null = null;
  private onSnapshot: ((snapshot: BrowserGpsSnapshot) => void) | null = null;

  acquire(
    onPosition: (position: GeolocationPosition) => void,
    onSnapshot: (snapshot: BrowserGpsSnapshot) => void
  ): BrowserGpsLease {
    if (Platform.OS !== "web") {
      onSnapshot(unsupported("O GPS do navegador só é usado na versão web da demo."));
      return { retry: () => {}, release: () => {} };
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      onSnapshot(unsupported("Este navegador não oferece localização por GPS."));
      return { retry: () => {}, release: () => {} };
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      onSnapshot(
        unsupported(
          "O navegador exige HTTPS ou localhost para liberar o GPS. Nesta rede, use o app no celular ou abra a demo em localhost."
        )
      );
      return { retry: () => {}, release: () => {} };
    }

    this.onPosition = onPosition;
    this.onSnapshot = onSnapshot;
    this.start();
    return {
      retry: () => this.retry(),
      release: () => this.release(),
    };
  }

  retry(): void {
    if (!this.onPosition || !this.onSnapshot) return;
    this.start();
  }

  private release(): void {
    this.generation += 1;
    this.stopWatch();
    this.onPosition = null;
    this.onSnapshot = null;
  }

  private start(): void {
    if (!this.onPosition || !this.onSnapshot) return;
    this.stopWatch();
    const generation = ++this.generation;
    const report = this.onSnapshot;

    report({
      status: "requesting",
      message: "Solicitando acesso ao GPS do dispositivo...",
      accuracyMeters: null,
      lastFixAt: null,
      canRetry: true,
    });

    try {
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (generation !== this.generation) return;
          report({
            status: "tracking",
            message: "GPS do dispositivo ativo.",
            accuracyMeters: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : null,
            lastFixAt: Date.now(),
            canRetry: true,
          });
          this.onPosition?.(position);
        },
        (error) => {
          if (generation !== this.generation) return;
          report({
            ...failure(error.code),
            accuracyMeters: null,
            lastFixAt: null,
          });
        },
        WATCH_OPTIONS
      );
    } catch {
      report({
        ...failure(2),
        accuracyMeters: null,
        lastFixAt: null,
      });
    }
  }

  private stopWatch(): void {
    if (this.watchId === null) return;
    try {
      navigator.geolocation.clearWatch(this.watchId);
    } catch {
      // O navegador pode já ter descartado o observador ao recarregar a página.
    }
    this.watchId = null;
  }
}

export const browserLocationService = new BrowserLocationService();
