import { MockP2PService } from "../MockP2PService";
import { isRideFare, loadFareQuote, money } from "../demoFare";
import { fareFixture } from "../../../test/fixtures/fare";

jest.mock("../browserDemoSession", () => ({ isPairedBrowserDemo: () => true }));

describe("Transporte da estimativa na demo", () => {
  afterEach(() => { jest.useRealTimers(); });

  it("formata reais e recusa uma estimativa adulterada", () => {
    expect(money(1900)).toBe("R$ 19,00");
    expect(isRideFare(fareFixture)).toBe(true);
    expect(isRideFare({ ...fareFixture, totalCents: 1 })).toBe(false);
    expect(isRideFare({ ...fareFixture, routeSource: "unknown" })).toBe(false);
  });

  it("consulta uma estimativa vinculada aos dois participantes", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ fare: fareFixture }) });
    await expect(loadFareQuote("client", "driver")).resolves.toEqual(fareFixture);
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ caller: "client", callee: "driver" });
  });

  it("envia o ID do orçamento e publica a cópia confirmada pelo servidor", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
      autoAccepted: false, state: "active", fare: fareFixture,
    }) });
    const onFare = jest.fn();
    const service = new MockP2PService("client");
    try {
      await service.call("driver", { onFare, onConnected: jest.fn(), onDisconnected: jest.fn(), onData: jest.fn(), onError: jest.fn() }, fareFixture.quoteId);
      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const request = JSON.parse(options.body);
      expect(request.fareQuoteId).toBe(fareFixture.quoteId);
      expect(request.fare).toBeUndefined();
      expect(onFare).toHaveBeenCalledWith(fareFixture);
    } finally { await service.disconnect(); }
  });

  it("o aceite confirma o orçamento exibido e preserva o preço no estado", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ fare: fareFixture }) });
    const onFare = jest.fn();
    const service = new MockP2PService("driver");
    const pending = service.answer("ride", { type: "offer", sdp: "demo" }, "client",
      { onFare, onConnected: jest.fn(), onDisconnected: jest.fn(), onData: jest.fn(), onError: jest.fn() }, fareFixture.quoteId);
    await jest.advanceTimersByTimeAsync(600);
    await pending;
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body).fareQuoteId).toBe(fareFixture.quoteId);
    expect(onFare).toHaveBeenCalledWith(fareFixture);
    await service.disconnect();
  });
});
