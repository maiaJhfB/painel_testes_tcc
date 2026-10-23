/** @jest-environment jsdom */
const fs = require("node:fs");
const path = require("node:path");
const L = require("leaflet");

describe("Mapa Leaflet nas duas janelas", () => {
  let map;
  let listeners;
  let parent;

  beforeEach(() => {
    document.body.innerHTML = '<div id="map"></div><div id="fallback"></div>';
    Object.defineProperty(document, "referrer", { configurable: true, value: "http://localhost:8085/map-ride" });
    const container = document.getElementById("map");
    Object.defineProperty(container, "clientWidth", { value: 430 });
    Object.defineProperty(container, "clientHeight", { value: 720 });
    L.Browser.svg = true;
    const createMap = L.map;
    jest.spyOn(L, "map").mockImplementation((...args) => { map = createMap(...args); return map; });
    listeners = {};
    parent = { postMessage: jest.fn() };
    const frameWindow = { L, parent, addEventListener: (name, handler) => { listeners[name] = handler; } };
    const html = fs.readFileSync(path.join(__dirname, "../../server/static/ride-map.html"), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    class ResizeObserver { observe() {} disconnect() {} }
    // O DOM executa o Leaflet real; o jsdom não busca tiles externos.
    new Function("L", "window", "document", "ResizeObserver", script)(L, frameWindow, document, ResizeObserver);
  });

  afterEach(() => {
    listeners.pagehide();
    jest.restoreAllMocks();
  });

  function publish(car = { latitude: -23.55, longitude: -46.64 }, origin = "http://localhost:8085") {
    listeners.message({ source: parent, origin, data: {
      type: "ride-map-state", stage: "going", fitRevision: 0,
      car, passenger: { latitude: -23.5533, longitude: -46.6558 },
      destination: { latitude: -23.5533, longitude: -46.6558 },
      route: { phase: "pickup", coordinates: [[-46.64, -23.55], [-46.65, -23.55], [-46.6558, -23.5533]] },
    } });
  }

  it("desenha as coordenadas da rota e move o motorista recebido pela sessão", () => {
    publish();
    const layers = Object.values(map._layers);
    const lines = layers.filter((layer) => layer instanceof L.Polyline);
    expect(lines.some((line) => line.getLatLngs().length === 3)).toBe(true);
    const markers = layers.filter((layer) => layer instanceof L.Marker);
    const driver = markers.find((marker) => marker.getLatLng().lng === -46.64);
    expect(driver).toBeDefined();
    publish({ latitude: -23.55, longitude: -46.65 });
    expect(driver.getLatLng()).toMatchObject({ lat: -23.55, lng: -46.65 });
    expect(Number.isFinite(map.getZoom())).toBe(true);
  });

  it("ignora atualizações de uma origem que não é a janela do aplicativo", () => {
    publish();
    const markers = Object.values(map._layers).filter((layer) => layer instanceof L.Marker);
    const driver = markers.find((marker) => marker.getLatLng().lng === -46.64);
    publish({ latitude: 0, longitude: 0 }, "https://unrelated.example");
    expect(driver.getLatLng().lng).toBe(-46.64);
  });
});
