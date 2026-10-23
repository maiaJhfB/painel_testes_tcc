import { rideLocationService } from "../src/services/rideLocationService";

let mockPosition: (position: any) => void;
let mockState: (state: any) => void;
const mockRetry = jest.fn();
const mockRelease = jest.fn();
jest.mock("../src/services/ForegroundLocationService", () => ({
  foregroundLocationService: { acquire: (position: any, state: any) => {
    mockPosition = position;
    mockState = state;
    state({ status: "checking" });
    return { retry: mockRetry, release: mockRelease };
  } },
}));

describe("GPS nativo compartilhado pela corrida", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("só informa GPS real depois de receber coordenadas, com precisão", () => {
    const report = jest.fn();
    const publish = jest.fn();
    const lease = rideLocationService.acquire(publish, report);
    mockState({ status: "tracking" });
    expect(report.mock.calls.at(-1)?.[0].status).toBe("requesting");
    const fix = { coords: { latitude: -23.5, longitude: -46.6, accuracy: 8 }, timestamp: 123 };
    mockPosition(fix);
    expect(publish).toHaveBeenCalledWith(fix);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: "tracking", accuracyMeters: 8, lastFixAt: 123 }));
    jest.advanceTimersByTime(21_000);
    expect(report.mock.calls.at(-1)?.[0].status).toBe("tracking");
    lease.release();
  });

  it("ativa fallback após timeout e recupera quando chega uma posição", () => {
    const report = jest.fn();
    const lease = rideLocationService.acquire(jest.fn(), report);
    jest.advanceTimersByTime(20_000);
    expect(report.mock.calls.at(-1)?.[0].status).toBe("timeout");
    mockPosition({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: 124 });
    expect(report.mock.calls.at(-1)?.[0].status).toBe("tracking");
    lease.release();
  });

  it("informa permissão negada e permite repetir sem criar outra assinatura", () => {
    const report = jest.fn();
    const lease = rideLocationService.acquire(jest.fn(), report);
    mockState({ status: "denied", message: "Autorize a localização." });
    jest.advanceTimersByTime(20_000);
    expect(report.mock.calls.at(-1)?.[0].status).toBe("denied");
    rideLocationService.retry();
    expect(mockRetry).toHaveBeenCalledTimes(1);
    lease.release();
  });

  it("ignora posição atrasada depois do encerramento da corrida", () => {
    const report = jest.fn();
    const publish = jest.fn();
    const lease = rideLocationService.acquire(publish, report);
    lease.release();
    report.mockClear();
    mockPosition({ coords: { latitude: 1, longitude: 2 }, timestamp: 125 });
    jest.advanceTimersByTime(30_000);
    expect(publish).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });
});
