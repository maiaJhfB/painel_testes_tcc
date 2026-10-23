"""Rotas públicas do roteiro, compartilhadas pelas duas janelas da demo."""
import json
import math
import os
import threading
import time
from pathlib import Path
from urllib.request import Request, urlopen

CACHE_DIR = Path(__file__).resolve().parent.parent / ".runtime" / "routes"
ROUTER_URL = os.environ.get("DEMO_ROUTER_URL", "https://router.project-osrm.org").rstrip("/")
CACHE_TTL = 30 * 24 * 60 * 60
LIVE_CACHE_TTL = 10 * 60
MAX_LIVE_DISTANCE_METERS = 500_000
_lock = threading.Lock()
_cache = {}
_last_request_at = 0.0

# Coordenadas fictícias do roteiro em São Paulo, sem localização pessoal.
WAYPOINTS = {
    "pickup": [(-46.6388, -23.5489), (-46.6558, -23.5533)],
    "trip": [(-46.6558, -23.5533), (-46.6850, -23.5670)],
}


def distance_meters(first, second):
    lon1, lat1, lon2, lat2 = map(math.radians, (*first, *second))
    value = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(value)))


def valid_route(data):
    try:
        points = data["coordinates"]
        return (
            data["source"] == "osrm"
            and len(points) >= 2
            and all(len(point) == 2 and all(math.isfinite(value) for value in point)
                    and -180 <= point[0] <= 180 and -90 <= point[1] <= 90 for point in points)
            and math.isfinite(data["distanceMeters"]) and data["distanceMeters"] > 0
            and math.isfinite(data["durationSeconds"]) and data["durationSeconds"] > 0
        )
    except (KeyError, TypeError, ValueError):
        return False


def get_demo_route(phase):
    global _last_request_at
    if phase not in WAYPOINTS:
        raise ValueError("invalid route phase")
    with _lock:
        now = time.time()
        cached = _cache.get(phase)
        if cached and now - cached["savedAt"] < (CACHE_TTL if cached["source"] == "osrm" else 60):
            return dict(cached, cached=True)

        cache_path = CACHE_DIR / f"{phase}.json"
        try:
            saved = json.loads(cache_path.read_text(encoding="utf-8"))
            if valid_route(saved) and now - saved["savedAt"] < CACHE_TTL:
                _cache[phase] = saved
                return dict(saved, cached=True)
        except (OSError, ValueError, KeyError):
            pass

        try:
            # O limite vale para ambas as janelas e para as duas fases juntas.
            delay = 1.05 - (time.monotonic() - _last_request_at)
            if delay > 0:
                time.sleep(delay)
            _last_request_at = time.monotonic()
            coordinates = ";".join(f"{lon},{lat}" for lon, lat in WAYPOINTS[phase])
            request = Request(
                f"{ROUTER_URL}/route/v1/driving/{coordinates}?overview=full&geometries=geojson&steps=false",
                headers={"User-Agent": "Cooperativa-TCC-Demo/0.1 (local educational demonstration)"},
            )
            with urlopen(request, timeout=8) as response:
                result = json.load(response)
            if result.get("code") != "Ok":
                raise ValueError("No route available")
            route = result["routes"][0]
            data = {
                "phase": phase,
                "coordinates": route["geometry"]["coordinates"],
                "distanceMeters": route["distance"],
                "durationSeconds": route["duration"],
                "source": "osrm",
                "savedAt": now,
            }
            if not valid_route(data):
                raise ValueError("Invalid routing response")
            _cache[phase] = data
            try:
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(json.dumps(data), encoding="utf-8")
            except OSError:
                pass  # O cache em memória ainda evita consultas repetidas.
            return dict(data, cached=False)
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            distance = distance_meters(*WAYPOINTS[phase])
            data = {
                "phase": phase,
                "coordinates": [list(point) for point in WAYPOINTS[phase]],
                "distanceMeters": distance,
                "durationSeconds": distance / 7,
                "source": "approximate",
                "savedAt": now,
            }
            _cache[phase] = data
            return dict(data, cached=False)


def valid_position(point):
    try:
        longitude, latitude = point
        return (
            math.isfinite(longitude)
            and math.isfinite(latitude)
            and -180 <= longitude <= 180
            and -90 <= latitude <= 90
        )
    except (TypeError, ValueError):
        return False


def get_live_route(origin, destination, phase="trip"):
    """Rota pelas ruas entre duas posições reais do GPS.

    `origin` e `destination` usam (longitude, latitude), igual ao GeoJSON.
    O resultado fica em memória por poucos minutos; não é gravado no cache de
    disco porque depende da posição atual do aparelho.
    """
    global _last_request_at
    if phase not in WAYPOINTS:
        phase = "trip"
    if not valid_position(origin) or not valid_position(destination):
        raise ValueError("invalid coordinates")

    distance = distance_meters(origin, destination)
    if distance > MAX_LIVE_DISTANCE_METERS:
        raise ValueError("route too long")
    key = (
        f"live:{origin[0]:.4f},{origin[1]:.4f}:"
        f"{destination[0]:.4f},{destination[1]:.4f}"
    )

    with _lock:
        now = time.time()
        cached = _cache.get(key)
        if cached and now - cached["savedAt"] < (
            LIVE_CACHE_TTL if cached["source"] == "osrm" else 60
        ):
            return dict(cached, phase=phase, cached=True)

        # Dois pontos praticamente iguais não formam um percurso válido.
        if distance < 5:
            data = {
                "phase": phase,
                "coordinates": [list(origin), list(destination)],
                "distanceMeters": max(distance, 1),
                "durationSeconds": 1,
                "source": "approximate",
                "savedAt": now,
            }
            _cache[key] = data
            return dict(data, cached=False)

        try:
            delay = 1.05 - (time.monotonic() - _last_request_at)
            if delay > 0:
                time.sleep(delay)
            _last_request_at = time.monotonic()
            coordinates = f"{origin[0]},{origin[1]};{destination[0]},{destination[1]}"
            request = Request(
                f"{ROUTER_URL}/route/v1/driving/{coordinates}?overview=full&geometries=geojson&steps=false",
                headers={"User-Agent": "Cooperativa-TCC-Demo/0.1 (local educational demonstration)"},
            )
            with urlopen(request, timeout=8) as response:
                result = json.load(response)
            if result.get("code") != "Ok":
                raise ValueError("No route available")
            route = result["routes"][0]
            data = {
                "phase": phase,
                "coordinates": route["geometry"]["coordinates"],
                "distanceMeters": route["distance"],
                "durationSeconds": route["duration"],
                "source": "osrm",
                "savedAt": now,
            }
            if not valid_route(data):
                raise ValueError("Invalid routing response")
            _cache[key] = data
            return dict(data, cached=False)
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            data = {
                "phase": phase,
                "coordinates": [list(origin), list(destination)],
                "distanceMeters": max(distance, 1),
                "durationSeconds": max(distance / 7, 1),
                "source": "approximate",
                "savedAt": now,
            }
            _cache[key] = data
            return dict(data, cached=False)
