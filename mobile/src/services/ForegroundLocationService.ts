import * as Location from "expo-location";
import { Platform } from "react-native";

export interface ForegroundLocationState {
  status: "idle" | "checking" | "starting" | "tracking" | "denied" | "disabled" | "error";
  message: string;
  canAskAgain?: boolean;
}

export interface ForegroundLocationLease {
  retry: () => void;
  release: () => void;
}

interface Owner {
  active: boolean;
  pending: boolean;
  revision: number;
  onLocation: (location: Location.LocationObject) => void;
  onState: (state: ForegroundLocationState) => void;
}

class ForegroundLocationService {
  private owner: Owner | null = null;
  private queue: Promise<void> = Promise.resolve();
  private subscription: Location.LocationSubscription | null = null;
  private permissionPromise: Promise<Location.LocationPermissionResponse> | null = null;

  acquire(onLocation: Owner["onLocation"], onState: Owner["onState"]): ForegroundLocationLease {
    if (Platform.OS === "web") {
      // No navegador, o GPS real é observado uma única vez pelo hook de layout
      // (useLiveGps/BrowserLocationService) e publicado em toda a sessão.
      const report = () => onState({ status: "tracking", message: "Localização ativa." });
      report();
      return { retry: report, release: () => {} };
    }
    if (this.owner) this.owner.active = false;
    const owner: Owner = { active: true, pending: false, revision: 0, onLocation, onState };
    this.owner = owner;
    this.schedule(owner, false);
    return {
      retry: () => this.schedule(owner, true),
      release: () => {
        owner.active = false;
        owner.revision += 1;
        if (this.owner === owner) {
          this.owner = null;
          this.queue = this.queue.then(() => this.stopWatch()).catch(() => {});
        }
      },
    };
  }

  private current(owner: Owner, revision: number): boolean {
    return owner.active && this.owner === owner && owner.revision === revision;
  }

  private stopWatch(): void {
    // If remove throws, retain the resource so the next acquisition retries
    // removal instead of starting a concurrent watch.
    this.subscription?.remove();
    this.subscription = null;
  }

  private async requestPermission(): Promise<Location.LocationPermissionResponse> {
    const pending = this.permissionPromise ?? Promise.resolve().then(() => Location.requestForegroundPermissionsAsync());
    this.permissionPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.permissionPromise === pending) this.permissionPromise = null;
    }
  }

  private schedule(owner: Owner, explicit: boolean): void {
    if (!owner.active || this.owner !== owner || owner.pending) return;
    owner.pending = true;
    const revision = ++owner.revision;
    owner.onState({ status: "checking", message: "Consultando localização..." });
    this.queue = this.queue.then(async () => {
      this.stopWatch();
      if (!this.current(owner, revision)) return;
      let permission = await Location.getForegroundPermissionsAsync();
      if (this.permissionPromise) permission = await this.permissionPromise;
      if (!this.current(owner, revision)) return;
      if (permission.status !== "granted" && (explicit || permission.status === "undetermined") && permission.canAskAgain) {
        permission = await this.requestPermission();
      }
      if (!this.current(owner, revision)) return;
      if (permission.status !== "granted") {
        owner.onState({ status: "denied", canAskAgain: permission.canAskAgain,
          message: permission.canAskAgain
            ? "Permissão de localização negada. Toque em Tentar localização para solicitar acesso."
            : "Permissão de localização negada. Ajuste a permissão manualmente e toque em Verificar novamente." });
        return;
      }
      const enabled = await Location.hasServicesEnabledAsync();
      if (!this.current(owner, revision)) return;
      if (!enabled) {
        owner.onState({ status: "disabled", message: "GPS desativado. Ative a localização manualmente e tente novamente." });
        return;
      }
      owner.onState({ status: "starting", message: "Iniciando localização..." });
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 10 },
        location => { if (this.current(owner, revision)) owner.onLocation(location); }
      );
      if (!this.current(owner, revision)) {
        // Native acquisition cannot be cancelled; serialize its late removal.
        this.subscription = subscription;
        this.stopWatch();
        return;
      }
      this.subscription = subscription;
      owner.onState({ status: "tracking", message: "Localização ativa." });
    }).catch(error => {
      if (this.current(owner, revision)) {
        owner.onState({ status: "error", message: `Falha ao iniciar localização: ${String(error)}` });
      }
    }).finally(() => { owner.pending = false; });
  }
}

export const foregroundLocationService = new ForegroundLocationService();
