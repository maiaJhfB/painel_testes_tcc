import { getDevServerUrl } from "@/dev/serverUrl";

export type RoutePhase = "pickup" | "trip";
export type Coordinate = [number, number]; // longitude, latitude (GeoJSON)
export interface MapPoint { latitude: number; longitude: number }
export interface DemoRoute {
  phase: RoutePhase;
  coordinates: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
  source: "osrm" | "approximate";
}

export const PICKUP_POINT: MapPoint = { latitude: -23.5533, longitude: -46.6558 };
export const DESTINATION_POINT: MapPoint = { latitude: -23.567, longitude: -46.685 };
const requests = new Map<RoutePhase, Promise<DemoRoute>>();
const liveRequests = new Map<string, Promise<DemoRoute>>();

/** Destino demonstrativo que acompanha o embarque real do passageiro. */
export const LIVE_TRIP_DESTINATION_METERS = 2800;
export const LIVE_TRIP_DESTINATION_BEARING = 225;

export function loadDemoRoute(phase: RoutePhase): Promise<DemoRoute> {
  const existing = requests.get(phase);
  if (existing) return existing;
  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`${getDevServerUrl()}/mock/map/route/${phase}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Não foi possível calcular a rota.");
      const route: DemoRoute = await response.json();
      if (!Array.isArray(route.coordinates) || route.coordinates.length < 2) throw new Error("Rota indisponível.");
      if (route.source !== "osrm") requests.delete(phase);
      return route;
    } catch {
      requests.delete(phase);
      throw new Error("Não foi possível carregar a rota. Verifique o servidor da demo e tente novamente.");
    } finally {
      clearTimeout(timeout);
    }
  })();
  requests.set(phase, pending);
  return pending;
}

/**
 * Calcula uma rota pelas ruas entre duas posições reais.
 *
 * É usada quando o GPS do dispositivo está ativo: o trajeto deixa de partir
 * das coordenadas fixas do roteiro e passa a refletir onde o usuário está.
 */
export function loadLiveRoute(origin: MapPoint, destination: MapPoint, phase: RoutePhase): Promise<DemoRoute> {
  const key = [
    phase,
    origin.latitude.toFixed(4), origin.longitude.toFixed(4),
    destination.latitude.toFixed(4), destination.longitude.toFixed(4),
  ].join(":");
  const existing = liveRequests.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const params = new URLSearchParams({
        from: `${origin.latitude},${origin.longitude}`,
        to: `${destination.latitude},${destination.longitude}`,
        phase,
      });
      const response = await fetch(`${getDevServerUrl()}/mock/map/route?${params.toString()}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Não foi possível calcular a rota.");
      const route: DemoRoute = await response.json();
      if (!Array.isArray(route.coordinates) || route.coordinates.length < 2) throw new Error("Rota indisponível.");
      if (route.source !== "osrm") liveRequests.delete(key);
      return route;
    } catch {
      liveRequests.delete(key);
      throw new Error("Não foi possível calcular a rota a partir da sua localização. Toque em Tentar novamente.");
    } finally {
      clearTimeout(timeout);
    }
  })();
  liveRequests.set(key, pending);
  return pending;
}

/** Ponto a poucos quilômetros do embarque, usado como destino da demonstração. */
export function destinationFromPickup(
  pickup: MapPoint,
  distance: number = LIVE_TRIP_DESTINATION_METERS,
  bearingDegrees: number = LIVE_TRIP_DESTINATION_BEARING
): MapPoint {
  const earthRadius = 6_371_000;
  const angular = distance / earthRadius;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const latitude = (pickup.latitude * Math.PI) / 180;
  const longitude = (pickup.longitude * Math.PI) / 180;
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angular) + Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing)
  );
  const targetLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude),
    Math.cos(angular) - Math.sin(latitude) * Math.sin(targetLatitude)
  );
  return {
    latitude: (targetLatitude * 180) / Math.PI,
    longitude: ((((targetLongitude * 180) / Math.PI) + 540) % 360) - 180,
  };
}

export function point(coordinate: Coordinate): MapPoint {
  return { longitude: coordinate[0], latitude: coordinate[1] };
}

export function meters(first: Coordinate, second: Coordinate): number {
  const radians = Math.PI / 180;
  const dLat = (second[1] - first[1]) * radians;
  const dLon = (second[0] - first[0]) * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(first[1] * radians) * Math.cos(second[1] * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}

export function sampleRoute(route: DemoRoute, progress: number): MapPoint {
  const segments = route.coordinates.slice(1).map((coordinate, index) => meters(route.coordinates[index], coordinate));
  const total = segments.reduce((sum, distance) => sum + distance, 0);
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < segments.length; index += 1) {
    if (remaining <= segments[index] && segments[index] > 0) {
      const ratio = remaining / segments[index];
      const start = route.coordinates[index];
      const end = route.coordinates[index + 1];
      return { longitude: start[0] + (end[0] - start[0]) * ratio, latitude: start[1] + (end[1] - start[1]) * ratio };
    }
    remaining -= segments[index];
  }
  return point(route.coordinates[route.coordinates.length - 1]);
}

export function remainingRatio(route: DemoRoute, position: MapPoint | null): number {
  if (!position) return 1;
  let closest = 0;
  let bestDistance = Infinity;
  route.coordinates.forEach((coordinate, index) => {
    const distance = meters(coordinate, [position.longitude, position.latitude]);
    if (distance < bestDistance) { closest = index; bestDistance = distance; }
  });
  let total = 0;
  let remaining = 0;
  route.coordinates.slice(1).forEach((coordinate, index) => {
    const distance = meters(route.coordinates[index], coordinate);
    total += distance;
    if (index >= closest) remaining += distance;
  });
  return total > 0 ? remaining / total : 0;
}
