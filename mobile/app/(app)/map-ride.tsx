/**
 * @screen MapRide — rota base para Android e iOS
 * @description Tela de mapa GPS com tráfego em tempo real
 *
 * Comportamento por papel:
 * - MOTORISTA (driver): vê sua posição atual + rota até o cliente + status da viagem.
 *   Botões: "Cheguei", "Iniciar Viagem", "Concluir Viagem".
 * - PASSAGEIRO (client): vê a posição do motorista em tempo real + ETA estimado.
 *   Botão: "Cancelar".
 *
 * Mapa: react-native-maps com Google Maps provider.
 * Tráfego: showsTraffic={true} ativado para ambos os papéis.
 * GPS: expo-location watchPositionAsync, Accuracy.High, 3s/10m (conforme SKILL.md).
 * P2P: dados de localização trafegam pelo canal já estabelecido (useP2PStore).
 * Dev/Prod: mesma tela — apenas a fonte de localização do par muda
 *           (WebRTC DataChannel em prod, polling HTTP em dev).
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Platform,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { useRouter, useFocusEffect } from "expo-router";
import { foregroundLocationService, type ForegroundLocationLease, type ForegroundLocationState } from "@/services/ForegroundLocationService";

import { useP2PStore } from "@/store/useP2PStore";
import { useAuthStore } from "@/store/useAuthStore";
import RideFareCard from "@/components/RideFareCard";

// ─── Constantes ──────────────────────────────────────────────────────────────

const SP_REGION = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

// Cores do app
const COLORS = {
  primary: "#6366f1",
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#ef4444",
  dark: "#0f172a",
  surface: "#1e293b",
  text: "#f8fafc",
  muted: "#94a3b8",
  cardBg: "rgba(30,41,59,0.95)",
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

type LatLng = { latitude: number; longitude: number };

type RideStage =
  | "going_to_passenger" // Motorista a caminho do passageiro
  | "arrived_at_passenger" // Motorista chegou
  | "in_progress"          // Viagem em andamento
  | "completed"            // Viagem concluída
  | "cancelled";           // Cancelada

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function MapRideScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

  // Store
  const { rideStatus, peerLocation, myLocation, updateMyLocation, updateRideStatus, disconnect, fare } =
    useP2PStore();
  const profile = useAuthStore((s) => s.session?.profile);

  const isDriver = profile?.role === "driver";

  // Estado local
  const [myCoords, setMyCoords] = useState<LatLng | null>(null);
  const [peerCoords, setPeerCoords] = useState<LatLng | null>(null);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [eta, setEta] = useState<string | null>(null);
  const [stage, setStage] = useState<RideStage>("going_to_passenger");
  const [mapReady, setMapReady] = useState(false);
  const [gps, setGps] = useState<ForegroundLocationState>({ status: "idle", message: "Localização não iniciada." });
  const locationLease = useRef<ForegroundLocationLease | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  // Animação do pin do motorista
  const pinBounce = useRef(new Animated.Value(0)).current;

  // ── GPS próprio ──────────────────────────────────────────────────────────────

  useFocusEffect(useCallback(() => {
    const lease = foregroundLocationService.acquire((loc) => {
        const coords: LatLng = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setMyCoords(coords);
        updateMyLocation(
          loc.coords.latitude,
          loc.coords.longitude,
          loc.coords.heading ?? undefined,
          loc.coords.speed ?? undefined
        );
    }, setGps);
    locationLease.current = lease;
    return () => { locationLease.current = null; lease.release(); };
  }, [updateMyLocation]));

  // ── Atualiza coords do par (via P2P) ─────────────────────────────────────────

  useEffect(() => {
    if (!peerLocation) return;
    const coords: LatLng = {
      latitude: peerLocation.latitude,
      longitude: peerLocation.longitude,
    };
    setPeerCoords(coords);
    animatePin();
  }, [peerLocation]);

  // ── Sincroniza status da corrida com stage ───────────────────────────────────

  useEffect(() => {
    if (!rideStatus) return;
    const map: Record<string, RideStage> = {
      accepted: "going_to_passenger",
      arrived: "arrived_at_passenger",
      in_progress: "in_progress",
      completed: "completed",
      cancelled: "cancelled",
    };
    if (map[rideStatus]) setStage(map[rideStatus] as RideStage);
  }, [rideStatus]);

  // ── Busca rota ao ter ambas coordenadas ──────────────────────────────────────

  useEffect(() => {
    if (!myCoords || !peerCoords) return;
    fetchRoute(myCoords, peerCoords);
  }, [myCoords, peerCoords]);

  // ── Centraliza mapa ao par atualizar ────────────────────────────────────────

  useEffect(() => {
    if (!mapReady || !peerCoords) return;
    if (!isDriver) {
      // Passageiro: centraliza no motorista
      mapRef.current?.animateToRegion({
        ...peerCoords,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }, 1000);
    }
  }, [peerCoords, mapReady, isDriver]);

  // ─── Animação do pin ─────────────────────────────────────────────────────────

  const animatePin = useCallback(() => {
    Animated.sequence([
      Animated.timing(pinBounce, { toValue: -8, duration: 150, useNativeDriver: true }),
      Animated.timing(pinBounce, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [pinBounce]);

  // ─── Rota via Directions API ─────────────────────────────────────────────────
  // Em dev: usa rota em linha reta (sem API key necessária)
  // Em prod: usa Google Directions API com tráfego

  const fetchRoute = useCallback(
    async (origin: LatLng, destination: LatLng) => {
      setLoadingRoute(true);
      try {
        // Tenta Google Directions API (produção)
        const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
        if (GOOGLE_KEY) {
          const url =
            `https://maps.googleapis.com/maps/api/directions/json?` +
            `origin=${origin.latitude},${origin.longitude}` +
            `&destination=${destination.latitude},${destination.longitude}` +
            `&mode=driving&departure_time=now&traffic_model=best_guess` +
            `&key=${GOOGLE_KEY}`;

          const res = await fetch(url);
          const data = await res.json();

          if (data.status === "OK" && data.routes.length > 0) {
            const leg = data.routes[0].legs[0];
            const duration = leg.duration_in_traffic?.text ?? leg.duration?.text;
            setEta(duration ?? null);

            // Decodifica polyline
            const points = decodePolyline(data.routes[0].overview_polyline.points);
            setRouteCoords(points);
            setLoadingRoute(false);
            return;
          }
        }

        // Fallback: linha reta (dev/sem API key)
        setRouteCoords([origin, destination]);
        const dist = haversine(origin, destination);
        const etaMins = Math.round(dist / 400); // ~24 km/h urbano
        setEta(etaMins <= 1 ? "1 min" : `${etaMins} min`);
      } catch {
        setRouteCoords([origin, destination]);
      } finally {
        setLoadingRoute(false);
      }
    },
    []
  );

  // ─── Ações do motorista ───────────────────────────────────────────────────────

  const handleArrived = () => {
    setStage("arrived_at_passenger");
    updateRideStatus("arrived");
  };

  const handleStartRide = () => {
    setStage("in_progress");
    updateRideStatus("in_progress");
    // Centraliza em mim mesmo após iniciar
    if (myCoords && mapRef.current) {
      mapRef.current.animateToRegion({
        ...myCoords,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 800);
    }
  };

  const handleFinishRide = () => {
    setStage("completed");
    updateRideStatus("completed");
    setTimeout(() => {
      disconnect();
      router.replace("/(app)/home");
    }, 2000);
  };

  // ─── Ação do passageiro ───────────────────────────────────────────────────────

  const handleCancel = () => {
    updateRideStatus("cancelled");
    disconnect();
    router.replace("/(app)/home");
  };

  // ─── Fit bounds (mostra origem + destino) ─────────────────────────────────────

  const fitBounds = () => {
    if (!mapRef.current || !myCoords || !peerCoords) return;
    mapRef.current.fitToCoordinates([myCoords, peerCoords], {
      edgePadding: { top: 80, right: 40, bottom: 180, left: 40 },
      animated: true,
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  const origin = myCoords ?? SP_REGION;

  return (
    <View style={s.container}>
      {/* Mapa */}
      <MapView
        ref={mapRef}
        style={s.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={{ ...origin, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsUserLocation={false} // desabilitado — usamos marcador próprio
        showsMyLocationButton={false}
        showsTraffic={true}         // ← Camada de tráfego do Google
        showsCompass={true}
        showsScale={true}
        mapType="standard"
        onMapReady={() => setMapReady(true)}
      >
        {/* Marcador: minha posição */}
        {myCoords && (
          <Marker coordinate={myCoords} anchor={{ x: 0.5, y: 0.5 }} zIndex={10}>
            <View style={s.myMarker}>
              <Text style={s.myMarkerIcon}>{isDriver ? "🚗" : "👤"}</Text>
            </View>
          </Marker>
        )}

        {/* Marcador: posição do par (animado) */}
        {peerCoords && (
          <Marker coordinate={peerCoords} anchor={{ x: 0.5, y: 0.5 }} zIndex={9}>
            <Animated.View
              style={[s.peerMarker, { transform: [{ translateY: pinBounce }] }]}
            >
              <Text style={s.peerMarkerIcon}>{isDriver ? "📍" : "🚗"}</Text>
            </Animated.View>
          </Marker>
        )}

        {/* Rota */}
        {routeCoords.length > 1 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor={stage === "in_progress" ? COLORS.green : COLORS.primary}
            strokeWidth={4}
            lineDashPattern={stage === "in_progress" ? undefined : [8, 4]}
          />
        )}
      </MapView>

      {/* Botões superiores */}
      <View style={s.topControls}>
        <TouchableOpacity style={s.chatNavBtn} onPress={() => router.back()}>
          <Text style={s.chatNavBtnText}>💬 Chat P2P</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.fitBtn} onPress={fitBounds}>
          <Text style={s.fitBtnText}>⊙</Text>
        </TouchableOpacity>
      </View>

      {/* Loading rota */}
      {loadingRoute && (
        <View style={s.routeLoading}>
          <ActivityIndicator color={COLORS.primary} size="small" />
          <Text style={s.routeLoadingText}>Calculando rota...</Text>
        </View>
      )}

      {/* Card inferior — informações e ações */}
      <View style={s.bottomCard}>
        {fare && <RideFareCard fare={fare} title="Preço combinado" compact />}
        <Text accessibilityLiveRegion="polite" style={s.waitingText}>{gps.message}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={gps.canAskAgain === false ? "Verificar novamente" : "Tentar localização"}
          disabled={gps.status === "checking" || gps.status === "starting"} onPress={() => locationLease.current?.retry()}>
          <Text style={s.etaText}>{gps.canAskAgain === false ? "Verificar novamente" : "Tentar localização"}</Text>
        </TouchableOpacity>
        <StatusBar stage={stage} eta={eta} isDriver={isDriver} peerCoords={peerCoords} />

        {/* Botões do motorista */}
        {isDriver && (
          <DriverActions
            stage={stage}
            onArrived={handleArrived}
            onStart={handleStartRide}
            onFinish={handleFinishRide}
          />
        )}

        {/* Botão do passageiro */}
        {!isDriver && stage !== "completed" && stage !== "cancelled" && (
          <TouchableOpacity style={s.cancelBtn} onPress={handleCancel}>
            <Text style={s.cancelBtnText}>Cancelar corrida</Text>
          </TouchableOpacity>
        )}

        {/* Concluído */}
        {(stage === "completed" || stage === "cancelled") && (
          <View style={s.completedBanner}>
            <Text style={s.completedText}>
              {stage === "completed" ? "✅ Viagem concluída!" : "❌ Viagem cancelada"}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatusBar({
  stage,
  eta,
  isDriver,
  peerCoords,
}: {
  stage: RideStage;
  eta: string | null;
  isDriver: boolean;
  peerCoords: LatLng | null;
}) {
  const stageLabels: Record<RideStage, { label: string; color: string }> = {
    going_to_passenger: { label: isDriver ? "A caminho do passageiro" : "Motorista a caminho", color: COLORS.primary },
    arrived_at_passenger: { label: isDriver ? "Você chegou ao passageiro" : "Motorista chegou!", color: COLORS.yellow },
    in_progress: { label: "Viagem em andamento", color: COLORS.green },
    completed: { label: "Viagem concluída", color: COLORS.green },
    cancelled: { label: "Viagem cancelada", color: COLORS.red },
  };

  const { label, color } = stageLabels[stage];

  return (
    <View style={s.statusBar}>
      <View style={[s.stageDot, { backgroundColor: color }]} />
      <View style={s.statusTexts}>
        <Text style={s.stageLabel}>{label}</Text>
        {eta && stage !== "completed" && stage !== "cancelled" && (
          <Text style={s.etaText}>
            ETA: <Text style={[s.etaBold, { color }]}>{eta}</Text>
          </Text>
        )}
        {!peerCoords && stage !== "completed" && (
          <Text style={s.waitingText}>Aguardando localização...</Text>
        )}
      </View>
    </View>
  );
}

function DriverActions({
  stage,
  onArrived,
  onStart,
  onFinish,
}: {
  stage: RideStage;
  onArrived: () => void;
  onStart: () => void;
  onFinish: () => void;
}) {
  if (stage === "going_to_passenger") {
    return (
      <TouchableOpacity style={[s.actionBtn, { backgroundColor: COLORS.yellow }]} onPress={onArrived}>
        <Text style={[s.actionBtnText, { color: "#000" }]}>📍 Cheguei ao passageiro</Text>
      </TouchableOpacity>
    );
  }

  if (stage === "arrived_at_passenger") {
    return (
      <TouchableOpacity style={[s.actionBtn, { backgroundColor: COLORS.green }]} onPress={onStart}>
        <Text style={s.actionBtnText}>🚗 Iniciar viagem</Text>
      </TouchableOpacity>
    );
  }

  if (stage === "in_progress") {
    return (
      <TouchableOpacity style={[s.actionBtn, { backgroundColor: COLORS.primary }]} onPress={onFinish}>
        <Text style={s.actionBtnText}>🏁 Concluir viagem</Text>
      </TouchableOpacity>
    );
  }

  return null;
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

/** Decodifica Google Encoded Polyline */
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

/** Distância Haversine em metros */
function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) *
      Math.cos((b.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.dark },
  map: { flex: 1 },

  topControls: {
    position: "absolute",
    top: 50,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 20,
  },
  chatNavBtn: {
    backgroundColor: COLORS.cardBg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.5)",
  },
  chatNavBtnText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "700",
  },
  fitBtn: {
    backgroundColor: COLORS.cardBg,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.4)",
  },
  fitBtnText: { fontSize: 22, color: COLORS.text },

  // Loading rota
  routeLoading: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    backgroundColor: COLORS.cardBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  routeLoadingText: { color: COLORS.muted, fontSize: 13 },

  // Marcadores
  myMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  myMarkerIcon: { fontSize: 20 },
  peerMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.green,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  peerMarkerIcon: { fontSize: 22 },

  // Card inferior
  bottomCard: {
    backgroundColor: COLORS.cardBg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(99,102,241,0.2)",
    gap: 14,
  },

  // Status bar
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stageDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusTexts: { flex: 1 },
  stageLabel: { color: COLORS.text, fontSize: 16, fontWeight: "700" },
  etaText: { color: COLORS.muted, fontSize: 13, marginTop: 2 },
  etaBold: { fontWeight: "700" },
  waitingText: { color: COLORS.muted, fontSize: 12, marginTop: 2 },

  // Botão de ação do motorista
  actionBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  actionBtnText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "700",
  },

  // Cancelar
  cancelBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.red,
  },
  cancelBtnText: { color: COLORS.red, fontSize: 15, fontWeight: "600" },

  // Concluído
  completedBanner: {
    alignItems: "center",
    paddingVertical: 10,
  },
  completedText: { color: COLORS.text, fontSize: 16, fontWeight: "700" },
});
