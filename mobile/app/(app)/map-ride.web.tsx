import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import RideMap from "@/components/RideMap.web";
import RideFareCard from "@/components/RideFareCard";
import { useP2PStore } from "@/store/useP2PStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useGpsStore } from "@/store/useGpsStore";
import { browserLocationService } from "@/services/BrowserLocationService";
import {
  DESTINATION_POINT, PICKUP_POINT, destinationFromPickup, loadDemoRoute, loadLiveRoute, point, remainingRatio,
  type DemoRoute, type MapPoint,
} from "@/dev/demoRoutes";

type Stage = "going" | "arrived" | "in_progress" | "completed" | "cancelled";

const GPS_FAILURE_STATUSES = ["denied", "unavailable", "timeout", "unsupported"] as const;

export default function MapRideWebScreen() {
  const router = useRouter();
  const profile = useAuthStore((state) => state.session?.profile);
  const isDriver = profile?.role === "driver";
  const { rideStatus, peerLocation, myLocation, updateRideStatus, disconnect, fare } = useP2PStore();
  const gpsStatus = useGpsStore((state) => state.status);
  const gpsMessage = useGpsStore((state) => state.message);
  const gpsAccuracy = useGpsStore((state) => state.accuracyMeters);
  const gpsCanRetry = useGpsStore((state) => state.canRetry);
  const stage: Stage = rideStatus === "arrived" || rideStatus === "in_progress" || rideStatus === "completed" || rideStatus === "cancelled" ? rideStatus : "going";
  const phase = stage === "in_progress" || stage === "completed" ? "trip" : "pickup";
  const liveGps = gpsStatus === "tracking";
  const gpsFailure = (GPS_FAILURE_STATUSES as readonly string[]).includes(gpsStatus);
  const [route, setRoute] = useState<DemoRoute | null>(null);
  const [routeIsLive, setRouteIsLive] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mapError, setMapError] = useState(false);
  const [fitRevision, setFitRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const fittedLiveRoute = useRef(false);
  const tripPickup = useRef<MapPoint | null>(null);

  const car: MapPoint | null = (isDriver ? myLocation : peerLocation) ?? null;
  const passenger = (isDriver ? peerLocation : myLocation) ?? PICKUP_POINT;

  // O destino nasce do embarque e não deve se deslocar enquanto o carro anda.
  useEffect(() => {
    if (phase === "trip") {
      if (!tripPickup.current) tripPickup.current = passenger;
    } else {
      tripPickup.current = null;
    }
  }, [phase, passenger]);

  const tripDestination = liveGps
    ? destinationFromPickup(tripPickup.current ?? passenger)
    : DESTINATION_POINT;
  const routeTarget = phase === "trip" ? tripDestination : passenger;
  const destination = route
    ? point(route.coordinates[route.coordinates.length - 1])
    : routeTarget;

  // A posição do carro e do passageiro entra na chave arredondada: isso
  // recalcula a rota a cada ~100 m, sem consultar o roteador a cada segundo.
  const routeKey = [
    phase,
    liveGps ? "live" : "demo",
    car ? `${car.latitude.toFixed(3)},${car.longitude.toFixed(3)}` : "sem-carro",
    `${routeTarget.latitude.toFixed(3)},${routeTarget.longitude.toFixed(3)}`,
  ].join("|");

  useEffect(() => { setRoute(null); }, [phase]);

  useEffect(() => {
    let active = true;
    setRouteError(null);
    const useLiveRoute = liveGps && Boolean(car);
    const request = useLiveRoute && car
      ? loadLiveRoute(car, routeTarget, phase)
      : loadDemoRoute(phase);
    void request
      .then((result) => {
        if (!active) return;
        setRoute(result);
        setRouteIsLive(useLiveRoute);
      })
      .catch((error: Error) => {
        if (!active) return;
        setRouteError(error.message);
        if (!useLiveRoute) setRoute(null);
      });
    return () => { active = false; };
    // routeKey resume as coordenadas arredondadas relevantes para a consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, retryRevision, routeKey]);

  // Reenquadra uma única vez quando a primeira rota baseada no GPS real chega.
  // As atualizações seguintes de posição não devem mover a câmera do usuário.
  useEffect(() => {
    if (!liveGps) {
      fittedLiveRoute.current = false;
      return;
    }
    if (route && routeIsLive && !fittedLiveRoute.current) {
      fittedLiveRoute.current = true;
      setFitRevision((value) => value + 1);
    }
  }, [liveGps, route, routeIsLive]);

  const ratio = route ? remainingRatio(route, car) : 1;
  const etaMinutes = route ? Math.max(1, Math.ceil(route.durationSeconds * ratio / 60)) : null;
  const remainingMeters = route ? Math.round(route.distanceMeters * ratio) : 0;
  const distance = remainingMeters >= 1000 ? `${(remainingMeters / 1000).toFixed(1).replace(".", ",")} km` : `${remainingMeters} m`;
  const eta = etaMinutes !== null ? `${etaMinutes} min` : "—";

  const finish = async () => { await disconnect(); router.replace("/(app)/home"); };
  const setStatus = (status: "arrived" | "in_progress" | "completed") => {
    updateRideStatus(status);
    if (status === "completed") setTimeout(() => { void finish(); }, 2000);
  };
  const cancel = () => { updateRideStatus("cancelled"); void finish(); };
  const labels: Record<Stage, { title: string; subtitle: string; color: string }> = {
    going: { title: "Motorista a caminho", subtitle: isDriver ? "Siga até o local de embarque" : "Acompanhe a chegada do motorista", color: "#6366f1" },
    arrived: { title: "Motorista chegou", subtitle: "Dirija-se ao local de embarque", color: "#f59e0b" },
    in_progress: { title: "Viagem em andamento", subtitle: "Seguindo até o destino", color: "#10b981" },
    completed: { title: "Viagem concluída", subtitle: "Obrigado por usar a Cooperativa", color: "#10b981" },
    cancelled: { title: "Viagem cancelada", subtitle: "A conexão foi encerrada", color: "#ef4444" },
  };
  const label = labels[stage];
  const noticeMessage = routeError
    ?? (mapError ? "Mapa indisponível. Verifique sua conexão com a internet."
      : gpsFailure ? `${gpsMessage} Usando o trajeto de demonstração.`
        : route?.source === "approximate" ? "Serviço de rotas indisponível. Exibindo trajeto aproximado."
          : !route ? "Calculando rota pelas ruas..." : null);
  const showNotice = Boolean(noticeMessage);
  const gpsPill = liveGps
    ? `● GPS REAL${gpsAccuracy ? ` ±${Math.round(gpsAccuracy)} m` : ""}`
    : gpsFailure ? "● MODO DEMO" : "● LOCALIZANDO...";

  return (
    <View style={s.container}>
      <View style={s.map}>
        <RideMap route={route} car={car} passenger={passenger} destination={destination}
          stage={stage} fitRevision={fitRevision} onMapError={setMapError} />
        <View style={s.mapHeader} pointerEvents="box-none">
          <TouchableOpacity style={s.pill} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Abrir chat">
            <Ionicons name="chatbubble-ellipses" color="#f8fafc" size={17} />
            <Text style={s.pillText}>Chat P2P</Text>
          </TouchableOpacity>
          <View style={[s.livePill, liveGps ? s.livePillActive : gpsFailure ? s.livePillFallback : s.livePillWaiting]}>
            <Text style={[s.liveText, liveGps ? s.liveTextActive : gpsFailure ? s.liveTextFallback : s.liveTextWaiting]}>
              {gpsPill}
            </Text>
          </View>
        </View>
        {showNotice && (
          <View style={s.notice}>
            {!route && !routeError && !gpsFailure && !mapError ? <ActivityIndicator color="#6366f1" /> : null}
            <Text style={s.noticeText} accessibilityLiveRegion="polite">{noticeMessage}</Text>
            <View style={s.noticeActions}>
              {routeError || route?.source === "approximate" ? (
                <TouchableOpacity onPress={() => setRetryRevision((value) => value + 1)} accessibilityRole="button">
                  <Text style={s.retryText}>Tentar rota</Text>
                </TouchableOpacity>
              ) : null}
              {gpsFailure && gpsCanRetry ? (
                <TouchableOpacity onPress={() => browserLocationService.retry()} accessibilityRole="button">
                  <Text style={s.retryText}>Tentar GPS</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
        <TouchableOpacity style={s.centerButton} onPress={() => setFitRevision((value) => value + 1)}
          accessibilityRole="button" accessibilityLabel="Centralizar rota e participantes">
          <Ionicons name="locate" size={22} color="#0f172a" />
        </TouchableOpacity>
      </View>

      <View style={s.bottomCard}>
        {fare && <RideFareCard fare={fare} title="Preço combinado" compact />}
        <View style={s.gpsRow}>
          <Ionicons name={liveGps ? "navigate-circle" : "warning-outline"} size={17}
            color={liveGps ? "#34d399" : gpsFailure ? "#fbbf24" : "#93c5fd"} />
          <Text style={s.gpsText}>
            {liveGps
              ? `GPS real do dispositivo${gpsAccuracy ? ` · precisão de ±${Math.round(gpsAccuracy)} m` : ""}`
              : gpsFailure ? "GPS indisponível · trajeto de demonstração"
                : "Obtendo a localização do dispositivo..."}
          </Text>
        </View>
        <View style={s.statusRow}>
          <View style={[s.statusDot, { backgroundColor: label.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.title}>{label.title}</Text>
            <Text style={s.subtitle}>{label.subtitle}</Text>
          </View>
          {(stage === "going" || stage === "in_progress") && (
            <View style={s.etaBlock}>
              <Text style={s.eta}>{eta}</Text>
              <Text style={s.subtitle}>{route ? distance : ""}</Text>
            </View>
          )}
        </View>
        <View style={s.legend}>
          <Text style={s.legendText}>🚗 Motorista</Text>
          <Text style={s.legendText}>👤 Passageiro</Text>
          <Text style={s.legendText}>⚑ {phase === "trip" ? "Destino" : "Embarque"}</Text>
        </View>
        {isDriver && stage === "going" && (
          <TouchableOpacity style={s.primary} onPress={() => setStatus("arrived")}><Text style={s.primaryText}>Cheguei ao passageiro</Text></TouchableOpacity>
        )}
        {isDriver && stage === "arrived" && (
          <TouchableOpacity style={s.primary} onPress={() => setStatus("in_progress")}><Text style={s.primaryText}>Iniciar viagem</Text></TouchableOpacity>
        )}
        {isDriver && stage === "in_progress" && (
          <TouchableOpacity style={[s.primary, { backgroundColor: "#10b981" }]} onPress={() => setStatus("completed")}><Text style={s.primaryText}>Concluir viagem</Text></TouchableOpacity>
        )}
        {!isDriver && stage !== "completed" && stage !== "cancelled" && (
          <TouchableOpacity style={s.cancel} onPress={cancel}><Text style={s.cancelText}>Cancelar corrida</Text></TouchableOpacity>
        )}
        {(stage === "completed" || stage === "cancelled") && (
          <TouchableOpacity style={s.primary} onPress={() => { void finish(); }}><Text style={s.primaryText}>Voltar ao início</Text></TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  map: { flex: 1, minHeight: 280, backgroundColor: "#e8edf0", overflow: "hidden" },
  mapHeader: { position: "absolute", top: 18, left: 14, right: 14, flexDirection: "row", justifyContent: "space-between" },
  pill: { backgroundColor: "#0f172a", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  pillText: { color: "#f8fafc", fontWeight: "600", fontSize: 13 },
  livePill: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10 },
  livePillActive: { backgroundColor: "#064e3b" },
  livePillFallback: { backgroundColor: "#78350f" },
  livePillWaiting: { backgroundColor: "#1e3a8a" },
  liveText: { fontWeight: "800", fontSize: 11 },
  liveTextActive: { color: "#6ee7b7" },
  liveTextFallback: { color: "#fde68a" },
  liveTextWaiting: { color: "#bfdbfe" },
  notice: { position: "absolute", top: 76, left: 14, right: 14, backgroundColor: "rgba(248,250,252,0.97)", borderRadius: 12, padding: 12, gap: 8 },
  noticeText: { color: "#334155", fontSize: 13, lineHeight: 18 },
  noticeActions: { flexDirection: "row", gap: 16 },
  retryText: { color: "#4f46e5", fontSize: 13, fontWeight: "700" },
  centerButton: { position: "absolute", right: 12, bottom: 110, backgroundColor: "#fff", width: 36, height: 36, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  bottomCard: { backgroundColor: "#1e293b", padding: 16, borderTopWidth: 1, borderColor: "#334155" },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
  gpsText: { color: "#cbd5e1", fontSize: 12, flex: 1 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  statusDot: { width: 11, height: 11, borderRadius: 6 },
  title: { color: "#f8fafc", fontSize: 17, fontWeight: "700" },
  subtitle: { color: "#94a3b8", fontSize: 12, marginTop: 3 },
  etaBlock: { alignItems: "flex-end", minWidth: 45 },
  eta: { color: "#f8fafc", fontSize: 18, fontWeight: "700" },
  legend: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 13 },
  legendText: { color: "#cbd5e1", fontSize: 11 },
  primary: { backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  cancel: { borderWidth: 1, borderColor: "#ef4444", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  cancelText: { color: "#fca5a5", fontWeight: "600" },
});
