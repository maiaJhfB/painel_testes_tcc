import math
import os
import sqlite3
import unittest
from unittest.mock import patch
from contextlib import closing

import server
import test_demo
from demo_fares import estimate_fare


class FareCalculationTest(unittest.TestCase):
    def test_distance_time_and_base_are_calculated_in_cents(self):
        fare = estimate_fare({"distanceMeters": 5000, "durationSeconds": 900, "source": "osrm"})
        self.assertEqual((fare["baseCents"], fare["distanceCents"], fare["timeCents"]), (450, 1000, 450))
        self.assertEqual(fare["totalCents"], 1900)
        self.assertTrue(fare["simulated"])

    def test_minimum_and_half_cent_rounding(self):
        short = estimate_fare({"distanceMeters": 100, "durationSeconds": 60, "source": "approximate"})
        self.assertEqual(short["totalCents"], 800)
        self.assertEqual(short["minimumAdjustmentCents"], 300)
        rounded = estimate_fare({"distanceMeters": 1002.5, "durationSeconds": 301, "source": "osrm"})
        self.assertEqual((rounded["distanceCents"], rounded["timeCents"], rounded["totalCents"]), (201, 151, 802))

    def test_invalid_route_metrics_are_not_priced(self):
        for value in (0, -1, math.nan, math.inf, True, "5000"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                estimate_fare({"distanceMeters": value, "durationSeconds": 900, "source": "osrm"})


class FareFlowTest(unittest.TestCase):
    setUp = test_demo.DemoServerSmokeTest.setUp
    tearDown = test_demo.DemoServerSmokeTest.tearDown

    def quote(self):
        response = self.client.post("/mock/fare/quote", json={
            "caller": server.DEMO_CLIENT_DID, "callee": server.DEMO_DRIVER_DID,
        })
        self.assertEqual(response.status_code, 200)
        return response.json["fare"]

    def call(self, quote, **overrides):
        return self.client.post("/mock/p2p/call", json={
            "sessionId": "fare-session", "caller": server.DEMO_CLIENT_DID,
            "callee": server.DEMO_DRIVER_DID, "manualPeer": True,
            "fareQuoteId": quote["quoteId"], **overrides,
        })

    def test_quote_call_offer_and_accept_preserve_exact_same_price(self):
        fare = self.quote()
        with patch.object(server, "get_demo_route", return_value={"distanceMeters": 99999, "durationSeconds": 9000, "source": "osrm"}):
            call = self.call(fare, fare={"totalCents": 1})
            self.assertEqual(call.json["fare"], fare)
            self.assertFalse(call.json["autoAccepted"])
            incoming = self.client.get(f"/incoming?to={server.DEMO_DRIVER_DID}")
            self.assertEqual(incoming.json["offer"]["fare"], fare)
            accepted = self.client.post("/mock/p2p/answer", json={"sessionId": "fare-session", "fareQuoteId": fare["quoteId"]})
            self.assertEqual(accepted.status_code, 200)
            self.assertEqual(accepted.json["fare"], fare)
            session = self.client.get("/mock/p2p/session/fare-session").json
            self.assertEqual(session["fare"], fare)
            self.assertEqual(session["state"], "active")

    def test_expired_quotes_and_quotes_from_other_participants_are_rejected(self):
        fare = self.quote()
        self.assertEqual(self.call(fare, caller=server.DEMO_DRIVER_DID).status_code, 409)
        with server.get_db() as conn:
            conn.execute("UPDATE fare_quotes SET expires = 0")
        self.assertEqual(self.call(fare).status_code, 409)
        self.assertEqual(self.client.get("/mock/p2p/session/fare-session").status_code, 404)

    def test_expiration_after_call_does_not_change_the_accepted_price(self):
        fare = self.quote()
        self.call(fare)
        with server.get_db() as conn:
            conn.execute("DELETE FROM fare_quotes")
        accepted = self.client.post("/mock/p2p/answer", json={"sessionId": "fare-session", "fareQuoteId": fare["quoteId"]})
        self.assertEqual(accepted.json["fare"], fare)

    def test_stale_offer_is_not_accepted_with_a_different_price(self):
        old = self.quote()
        new = self.quote()
        self.call(new)
        rejected = self.client.post("/mock/p2p/answer", json={"sessionId": "fare-session", "fareQuoteId": old["quoteId"]})
        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(self.client.get("/mock/p2p/session/fare-session").json["state"], "calling")

    def test_panel_call_has_a_fare_and_reset_clears_quotes(self):
        self.quote()
        self.assertEqual(self.client.post("/mock/demo/trigger_call").status_code, 200)
        incoming = self.client.get(f"/incoming?to={server.DEMO_DRIVER_DID}")
        self.assertEqual(incoming.json["offer"]["fare"]["totalCents"], 1900)
        self.client.post("/mock/reset")
        with server.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM fare_quotes").fetchone()[0], 0)

    def test_schema_upgrade_keeps_existing_sessions_and_is_repeatable(self):
        path = os.path.join(self.temp_dir.name, "legacy.sqlite")
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("CREATE TABLE p2p_sessions (session_id TEXT PRIMARY KEY, caller TEXT, callee TEXT, state TEXT, created_at REAL)")
            conn.execute("INSERT INTO p2p_sessions VALUES ('old', 'client', 'driver', 'completed', 1)")
            conn.commit()
        with patch.object(server, "DB_PATH", path):
            server.init_db()
            server.init_db()
            with server.get_db() as conn:
                row = conn.execute("SELECT * FROM p2p_sessions WHERE session_id = 'old'").fetchone()
                self.assertEqual(row["state"], "completed")
                self.assertIsNone(row["fare"])
