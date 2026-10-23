import {
  destinationFromPickup, loadDemoRoute, loadLiveRoute, meters, remainingRatio, sampleRoute,
  type DemoRoute,
} from "../demoRoutes";

const route: DemoRoute = {
  phase: "pickup", source: "osrm", distanceMeters: 2000, durationSeconds: 300,
  coordinates: [[-46.64, -23.55], [-46.65, -23.55], [-46.65, -23.56]],
};

describe("Rota de GPS da demo", () => {
  it("percorre os segmentos da rua, preservando a curva do trajeto", () => {
    const middle = sampleRoute(route, 0.5);
    expect(middle.longitude).toBeCloseTo(-46.65, 3);
    expect(middle.latitude).toBeCloseTo(-23.55, 3);
    expect(sampleRoute(route, 0)).toEqual({ longitude: -46.64, latitude: -23.55 });
    expect(sampleRoute(route, 1)).toEqual({ longitude: -46.65, latitude: -23.56 });
  });

  it("reduz o percurso restante até zero no destino", () => {
    expect(remainingRatio(route, null)).toBe(1);
    expect(remainingRatio(route, { longitude: -46.64, latitude: -23.55 })).toBe(1);
    expect(remainingRatio(route, { longitude: -46.65, latitude: -23.55 })).toBeLessThan(0.6);
    expect(remainingRatio(route, { longitude: -46.65, latitude: -23.56 })).toBe(0);
  });

  it("compartilha a consulta da rota entre mapa e GPS sem repetir requisições", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => route });
    const first = loadDemoRoute("pickup");
    const second = loadDemoRoute("pickup");
    expect(first).toBe(second);
    await expect(first).resolves.toEqual(route);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("encaminha a posição real do GPS para o roteador", async () => {
    const live: DemoRoute = {
      phase: "trip", source: "osrm", distanceMeters: 3100, durationSeconds: 420,
      coordinates: [[-46.65, -23.55], [-46.66, -23.56], [-46.67, -23.57]],
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => live });
    const result = await loadLiveRoute(
      { latitude: -23.55, longitude: -46.65 },
      { latitude: -23.57, longitude: -46.67 },
      "trip"
    );
    expect(result).toEqual(live);
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    const params = new URL(url).searchParams;
    expect(params.get("from")).toBe("-23.55,-46.65");
    expect(params.get("to")).toBe("-23.57,-46.67");
    expect(params.get("phase")).toBe("trip");
  });

  it("mantém o destino demonstrativo a poucos quilômetros do embarque real", () => {
    const pickup = { latitude: -23.55, longitude: -46.65 };
    const destination = destinationFromPickup(pickup);
    const distance = meters(
      [pickup.longitude, pickup.latitude],
      [destination.longitude, destination.latitude]
    );
    expect(Math.abs(distance - 2800)).toBeLessThan(5);
    expect(destination.latitude).toBeLessThan(pickup.latitude);
    expect(destination.longitude).toBeLessThan(pickup.longitude);
  });
});
