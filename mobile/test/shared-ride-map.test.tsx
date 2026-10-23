import React from "react";
import RideMapScreen from "../src/screens/RideMapScreen";
import { destinationFromPickup } from "../src/dev/demoRoutes";
const { act, create } = require("react-test-renderer");
const mockRoute = jest.fn();
const mockRetry = jest.fn();
let mockMapProps: any;
let mockRide: any;
let mockGps: any;
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn() }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/RideMap", () => ({ __esModule: true, default: (props: any) => { mockMapProps = props; return null; } }));
jest.mock("@/store/useAuthStore", () => ({ useAuthStore: (select: any) => select({ session: { profile: { role: "driver" } } }) }));
jest.mock("@/store/useP2PStore", () => ({ useP2PStore: () => mockRide }));
jest.mock("@/store/useGpsStore", () => ({ useGpsStore: (select: any) => select(mockGps) }));
jest.mock("@/services/rideLocationService", () => ({ rideLocationService: { retry: () => mockRetry() } }));
jest.mock("@/dev/demoRoutes", () => ({
  ...jest.requireActual("@/dev/demoRoutes"),
  loadLiveRoute: (...args: any[]) => mockRoute(...args),
  loadDemoRoute: (phase: string) => mockRoute(null, null, phase),
}));

describe("Fluxo do mapa compartilhado pelo APK e painel", () => {
  beforeEach(() => {
    mockRide = { rideStatus: "accepted", myLocation: { latitude: -23.5, longitude: -46.6 },
      peerLocation: { latitude: -23.51, longitude: -46.61 }, updateRideStatus: jest.fn(), disconnect: jest.fn() };
    mockGps = { status: "tracking", accuracyMeters: 8, canRetry: true };
    mockRoute.mockImplementation(async (_origin: any, _target: any, phase: string) => ({
      phase, source: "osrm", distanceMeters: 2000, durationSeconds: 300,
      coordinates: [[-46.6, -23.5], [-46.61, -23.51]],
    }));
  });

  it("troca embarque por destino fixo ao iniciar e mantém o destino quando o passageiro se move", async () => {
    let screen: any;
    await act(async () => { screen = create(<RideMapScreen />); });
    expect(mockRoute).toHaveBeenLastCalledWith(mockRide.myLocation, mockRide.peerLocation, "pickup");
    const target = destinationFromPickup(mockRide.peerLocation);
    mockRide = { ...mockRide, rideStatus: "in_progress" };
    await act(async () => screen.update(<RideMapScreen />));
    expect(mockRoute).toHaveBeenLastCalledWith(mockRide.myLocation, target, "trip");
    mockRide = { ...mockRide, myLocation: { latitude: -23.52, longitude: -46.62 }, peerLocation: { latitude: -23.52, longitude: -46.62 } };
    await act(async () => screen.update(<RideMapScreen />));
    expect(mockRoute).toHaveBeenLastCalledWith(mockRide.myLocation, target, "trip");
    expect(mockMapProps.stage).toBe("in_progress");
    act(() => screen.unmount());
  });

  it("usa o roteiro demonstrativo se o GPS foi negado", async () => {
    mockGps = { status: "denied", message: "Sem permissão", canRetry: true };
    let screen: any;
    await act(async () => { screen = create(<RideMapScreen />); });
    expect(mockRoute).toHaveBeenCalledWith(null, null, "pickup");
    act(() => screen.unmount());
  });
});
