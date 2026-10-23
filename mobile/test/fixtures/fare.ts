import type { RideFare } from "@/core/ports";

export const fareFixture: RideFare = {
  quoteId: "test-quote", expiresAt: 4_000_000_000_000,
  pricingVersion: "demo-distance-time-v1", currency: "BRL", simulated: true,
  origin: "Ponto de embarque", destination: "Destino da corrida", routeSource: "osrm",
  distanceMeters: 5000, durationSeconds: 900,
  baseCents: 450, perKmCents: 200, perMinuteCents: 30,
  distanceCents: 1000, timeCents: 450, minimumCents: 800,
  minimumAdjustmentCents: 0, totalCents: 1900,
};
