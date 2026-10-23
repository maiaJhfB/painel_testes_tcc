/**
 * @module MapService
 * @description Serviço de mapa e roteamento
 *
 * Responsabilidades:
 * - Buscar rota via Google Directions API (com tráfego em tempo real)
 * - Calcular ETA com tráfego (departure_time=now, traffic_model=best_guess)
 * - Decodificar Google Encoded Polyline
 * - Fallback de linha reta para modo dev (sem API key)
 *
 * Produção: requer EXPO_PUBLIC_GOOGLE_MAPS_KEY no .env ou app.json.
 * Dev/Mock: usa haversine + velocidade média urbana (~24 km/h), sem API call.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteResult {
  /** Pontos da polyline para desenhar no mapa */
  coordinates: LatLng[];
  /** ETA formatado como string, ex: "8 min", "1 hora 5 min" */
  etaText: string | null;
  /** ETA em segundos (com tráfego se disponível) */
  etaSeconds: number | null;
  /** Distância total em metros */
  distanceMeters: number | null;
  /** True se a rota foi calculada com dados de tráfego reais */
  hasTrafficData: boolean;
}

// ─── MapService ───────────────────────────────────────────────────────────────

export class MapService {
  private googleMapsKey: string | null;

  constructor(googleMapsKey?: string) {
    this.googleMapsKey = googleMapsKey ?? null;
  }

  /**
   * Calcula rota entre dois pontos.
   * Usa Google Directions API em prod, linha reta em dev.
   */
  async getRoute(origin: LatLng, destination: LatLng): Promise<RouteResult> {
    if (this.googleMapsKey) {
      try {
        return await this._fetchGoogleRoute(origin, destination);
      } catch (err) {
        console.warn("[MapService] Google Directions falhou, usando fallback:", err);
      }
    }
    return this._straightLineRoute(origin, destination);
  }

  // ── Google Directions API ──────────────────────────────────────────────────

  private async _fetchGoogleRoute(
    origin: LatLng,
    destination: LatLng
  ): Promise<RouteResult> {
    const params = new URLSearchParams({
      origin: `${origin.latitude},${origin.longitude}`,
      destination: `${destination.latitude},${destination.longitude}`,
      mode: "driving",
      departure_time: "now",          // Habilita dados de tráfego
      traffic_model: "best_guess",    // Modelo de tráfego
      language: "pt-BR",
      key: this.googleMapsKey!,
    });

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (data.status !== "OK" || !data.routes.length) {
      throw new Error(`Directions API: ${data.status}`);
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    // ETA com tráfego (disponível quando departure_time=now)
    const etaWithTraffic = leg.duration_in_traffic;
    const etaBasic = leg.duration;

    const etaSeconds = etaWithTraffic?.value ?? etaBasic?.value ?? null;
    const etaText = etaWithTraffic?.text ?? etaBasic?.text ?? null;
    const distanceMeters = leg.distance?.value ?? null;

    const coordinates = decodePolyline(route.overview_polyline.points);

    return {
      coordinates,
      etaText: formatEta(etaText),
      etaSeconds,
      distanceMeters,
      hasTrafficData: !!etaWithTraffic,
    };
  }

  // ── Fallback linha reta (dev/sem API key) ──────────────────────────────────

  private _straightLineRoute(origin: LatLng, destination: LatLng): RouteResult {
    const dist = haversine(origin, destination);
    // Velocidade média urbana brasileira: ~24 km/h = 400 m/min
    const etaSeconds = Math.round(dist / 6.67);
    const etaText = formatEtaSeconds(etaSeconds);

    return {
      coordinates: [origin, destination],
      etaText,
      etaSeconds,
      distanceMeters: Math.round(dist),
      hasTrafficData: false,
    };
  }
}

// ─── Utilitários exportados ───────────────────────────────────────────────────

/**
 * Decodifica Google Encoded Polyline v1
 * @see https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
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

/** Distância Haversine em metros entre dois pontos */
export function haversine(a: LatLng, b: LatLng): number {
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

/** Formata ETA da API do Google para pt-BR mais curto */
function formatEta(raw: string | null): string | null {
  if (!raw) return null;
  // Google retorna "1 hour 5 mins" → "1h 5min" ou "8 mins" → "8 min"
  return raw
    .replace(/hours?/g, "h")
    .replace(/mins?/g, "min")
    .replace(/\s+/g, " ")
    .trim();
}

/** Formata ETA em segundos para string pt-BR */
function formatEtaSeconds(seconds: number): string {
  if (seconds < 60) return "< 1 min";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ─── Singleton para uso nas telas ─────────────────────────────────────────────

import Constants from "expo-constants";

const googleKey =
  (Constants.expoConfig?.extra as any)?.GOOGLE_MAPS_KEY ??
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ??
  undefined;

export const mapService = new MapService(googleKey);
