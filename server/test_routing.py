import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import demo_routing
import server


class StreetRoutingTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.patches = [
            patch.object(demo_routing, "CACHE_DIR", Path(self.directory.name)),
            patch.object(demo_routing, "_cache", {}),
            patch.object(demo_routing, "_last_request_at", 0),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    def test_route_follows_provider_geometry_and_survives_restart(self):
        geometry = [[-46.6388, -23.5489], [-46.64, -23.549], [-46.6558, -23.5533]]
        response = {"code": "Ok", "routes": [{
            "geometry": {"coordinates": geometry}, "distance": 2300, "duration": 380,
        }]}
        with patch.object(demo_routing, "urlopen", return_value=io.StringIO(json.dumps(response))) as provider:
            route = demo_routing.get_demo_route("pickup")
            self.assertEqual(route["source"], "osrm")
            self.assertEqual(route["coordinates"], geometry)
            self.assertEqual(route["durationSeconds"], 380)
            self.assertTrue(demo_routing.get_demo_route("pickup")["cached"])
            demo_routing._cache.clear()
            self.assertTrue(demo_routing.get_demo_route("pickup")["cached"])
            self.assertEqual(provider.call_count, 1)

    def test_provider_failure_is_labelled_as_approximate_and_not_retried_repeatedly(self):
        with patch.object(demo_routing, "urlopen", side_effect=OSError("offline")) as provider:
            route = demo_routing.get_demo_route("trip")
            self.assertEqual(route["source"], "approximate")
            self.assertEqual(len(route["coordinates"]), 2)
            self.assertGreater(route["distanceMeters"], 0)
            self.assertTrue(demo_routing.get_demo_route("trip")["cached"])
            self.assertEqual(provider.call_count, 1)

    def test_live_route_uses_the_real_gps_endpoints(self):
        geometry = [[-46.65, -23.55], [-46.66, -23.56], [-46.67, -23.57]]
        response = {"code": "Ok", "routes": [{
            "geometry": {"coordinates": geometry}, "distance": 3200, "duration": 540,
        }]}
        with patch.object(demo_routing, "urlopen", return_value=io.StringIO(json.dumps(response))) as provider:
            route = demo_routing.get_live_route(
                (-46.65, -23.55), (-46.67, -23.57), phase="trip"
            )
        self.assertEqual(route["source"], "osrm")
        self.assertEqual(route["phase"], "trip")
        self.assertEqual(route["coordinates"], geometry)
        requested = provider.call_args.args[0].full_url
        self.assertIn("-46.65,-23.55;-46.67,-23.57", requested)

    def test_live_route_without_provider_falls_back_to_a_local_line(self):
        with patch.object(demo_routing, "urlopen", side_effect=OSError("offline")):
            route = demo_routing.get_live_route(
                (-46.65, -23.55), (-46.67, -23.57), phase="pickup"
            )
        self.assertEqual(route["source"], "approximate")
        self.assertEqual(route["phase"], "pickup")
        self.assertEqual(route["coordinates"], [[-46.65, -23.55], [-46.67, -23.57]])

    def test_live_route_endpoint_validates_gps_coordinates(self):
        client = server.app.test_client()
        invalid = client.get("/mock/map/route?from=abc&to=-46.6,-23.5")
        self.assertEqual(invalid.status_code, 400)
        out_of_range = client.get("/mock/map/route?from=-23.5,-46.6&to=500,0")
        self.assertEqual(out_of_range.status_code, 400)
        with patch.object(server, "get_live_route", return_value={
            "phase": "trip", "coordinates": [[-46.6, -23.5], [-46.7, -23.6]],
            "distanceMeters": 100, "durationSeconds": 20, "source": "osrm",
        }):
            ok = client.get("/mock/map/route?from=-23.5,-46.6&to=-23.6,-46.7&phase=trip")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json["phase"], "trip")

    def test_map_assets_are_local_and_unknown_routes_are_rejected(self):
        client = server.app.test_client()
        with client.get("/mock/map/view") as response:
            self.assertEqual(response.status_code, 200)
            self.assertIn("OpenStreetMap", response.get_data(as_text=True))
        for asset in ("leaflet.js", "leaflet.css"):
            with client.get(f"/mock/map/leaflet/{asset}") as response:
                self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get("/mock/map/route/unknown").status_code, 400)


if __name__ == "__main__":
    unittest.main()
