import type { RideFare } from "@/core/ports";
import { getDevServerUrl } from "@/dev/serverUrl";

export const money = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

export function isRideFare(value: unknown): value is RideFare {
  const fare = value as RideFare | null;
  return !!fare && typeof fare.quoteId === "string" && fare.quoteId.length > 0
    && fare.currency === "BRL" && fare.simulated === true
    && typeof fare.origin === "string" && typeof fare.destination === "string"
    && typeof fare.pricingVersion === "string"
    && (fare.routeSource === "osrm" || fare.routeSource === "approximate")
    && [fare.totalCents, fare.baseCents, fare.distanceCents, fare.timeCents,
      fare.minimumAdjustmentCents, fare.minimumCents, fare.perKmCents, fare.perMinuteCents].every((amount) => Number.isSafeInteger(amount) && amount >= 0)
    && Number.isFinite(fare.distanceMeters) && fare.distanceMeters > 0
    && Number.isFinite(fare.durationSeconds) && fare.durationSeconds > 0
    && Number.isFinite(fare.expiresAt)
    && fare.totalCents === fare.baseCents + fare.distanceCents + fare.timeCents + fare.minimumAdjustmentCents;
}

export async function loadFareQuote(caller: string, callee: string): Promise<RideFare> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${getDevServerUrl()}/mock/fare/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caller, callee }), signal: controller.signal,
    });
    if (!response.ok) throw new Error("Não foi possível calcular o preço da corrida.");
    const data = await response.json();
    if (!isRideFare(data.fare)) throw new Error("Estimativa de preço inválida. Tente novamente.");
    return data.fare;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("O cálculo demorou mais que o esperado. Tente novamente.");
    throw error;
  } finally { clearTimeout(timeout); }
}
