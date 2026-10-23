/** @jest-environment jsdom */
jest.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { browserLocationService } from "../BrowserLocationService";

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value });
}

function installGeolocation(overrides: Partial<Geolocation> = {}) {
  const watchPosition = jest.fn<number, [PositionCallback, PositionErrorCallback, PositionOptions]>(() => 7);
  const clearWatch = jest.fn<void, [number]>();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition, clearWatch, getCurrentPosition: jest.fn(), ...overrides },
  });
  return { watchPosition, clearWatch };
}

describe("GPS real do navegador", () => {
  beforeEach(() => {
    setSecureContext(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("publica a posição e a precisão informadas pelo navegador", () => {
    const { watchPosition, clearWatch } = installGeolocation();
    watchPosition.mockImplementation((success: PositionCallback) => {
      success({
        coords: {
          latitude: -23.55, longitude: -46.65, accuracy: 9,
          altitude: null, altitudeAccuracy: null, heading: null, speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
      return 42;
    });

    const positions: GeolocationPosition[] = [];
    const snapshots: Array<{ status: string; accuracyMeters: number | null }> = [];
    const lease = browserLocationService.acquire(
      (position) => positions.push(position),
      (snapshot) => snapshots.push(snapshot)
    );

    expect(snapshots[0].status).toBe("requesting");
    expect(snapshots[snapshots.length - 1]).toMatchObject({ status: "tracking", accuracyMeters: 9 });
    expect(positions).toHaveLength(1);
    expect(watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: true })
    );

    lease.release();
    expect(clearWatch).toHaveBeenCalled();
  });

  it("distingue permissão negada de GPS indisponível", () => {
    const { watchPosition } = installGeolocation();
    watchPosition.mockImplementation((_success: PositionCallback, failure: PositionErrorCallback) => {
      failure({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      return 1;
    });
    const snapshots: Array<{ status: string; message: string; canRetry: boolean }> = [];
    const lease = browserLocationService.acquire(jest.fn(), (snapshot) => snapshots.push(snapshot));

    expect(snapshots[snapshots.length - 1].status).toBe("denied");
    expect(snapshots[snapshots.length - 1].canRetry).toBe(true);
    expect(snapshots[snapshots.length - 1].message).toMatch(/permissão/i);
    lease.release();
  });

  it("não tenta usar GPS fora de HTTPS ou localhost", () => {
    setSecureContext(false);
    const { watchPosition } = installGeolocation();
    const snapshots: Array<{ status: string }> = [];
    const lease = browserLocationService.acquire(jest.fn(), (snapshot) => snapshots.push(snapshot));

    expect(snapshots[0].status).toBe("unsupported");
    expect(watchPosition).not.toHaveBeenCalled();
    lease.release();
  });
});
