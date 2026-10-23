import os
import tempfile
import time
import unittest
from unittest.mock import patch

import server


class DemoServerSmokeTest(unittest.TestCase):
    def setUp(self):
        route = patch.object(server, "get_demo_route", return_value={
            "distanceMeters": 5000, "durationSeconds": 900, "source": "osrm",
        })
        route.start()
        self.addCleanup(route.stop)
        # Mantém todos os artefatos de teste dentro do ambiente-demo. Isso
        # evita depender do diretório temporário global do Windows/sandbox.
        self.temp_dir = tempfile.TemporaryDirectory(dir=os.path.dirname(__file__))
        server.DB_PATH = os.path.join(self.temp_dir.name, "demo-test.sqlite")
        server.DEMO_AUTOPILOT_STEP_SECONDS = 0.01
        server.init_db()
        self.client = server.app.test_client()

    def tearDown(self):
        for session_id in list(server._demo_pilots.keys()):
            server.stop_demo_pilot(session_id)
        for simulation in list(server._active_sims.values()):
            simulation["stop"].set()
        server._active_sims.clear()
        self.temp_dir.cleanup()

    def test_recording_flow(self):
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json["ok"])
        self.assertEqual(health.json["demo_version"], server.DEMO_SERVER_VERSION)
        self.assertEqual(health.json["registered_identities"], 2)

        panel = self.client.get("/panel")
        self.assertEqual(panel.status_code, 200)
        self.assertIn("Painel de Testes", panel.get_data(as_text=True))
        self.assertIn("Iniciar sessão passageiro + motorista", panel.get_data(as_text=True))
        self.assertIn("Demo@123", panel.get_data(as_text=True))
        self.assertIn("copyDemoPassword()", panel.get_data(as_text=True))

        # Pareamento do APK: dois QR codes gerados localmente, sem CDN.
        panel_html = panel.get_data(as_text=True)
        self.assertIn("Conectar APK por QR code", panel_html)
        self.assertIn('id="qr-client"', panel_html)
        self.assertIn('id="qr-driver"', panel_html)
        self.assertIn("/panel/qrcode.js", panel_html)
        with self.client.get("/panel/qrcode.js") as qrcode_js:
            self.assertEqual(qrcode_js.status_code, 200)
            self.assertIn(b"QRCode", qrcode_js.data)

        nonce = self.client.get("/nonce")
        self.assertEqual(len(nonce.json["nonce"]), 32)

        driver = self.client.get(f"/mock/identity/{server.DEMO_DRIVER_DID}")
        self.assertTrue(driver.json["registered"])
        self.assertEqual(driver.json["metadata"]["role"], "driver")

        session_id = "smoke-demo-session"
        call = self.client.post(
            "/mock/p2p/call",
            json={
                "sessionId": session_id,
                "caller": server.DEMO_CLIENT_DID,
                "callee": server.DEMO_DRIVER_DID,
            },
        )
        self.assertTrue(call.json["ok"])
        self.assertTrue(call.json["autoAccepted"])

        pending_session = self.client.get(f"/mock/p2p/session/{session_id}")
        self.assertEqual(pending_session.status_code, 200)
        self.assertIn(pending_session.json["state"], ("calling", "active"))

        incoming = self.client.get(f"/incoming?to={server.DEMO_DRIVER_DID}")
        self.assertEqual(incoming.json["sessionId"], session_id)

        answer = self.client.post("/mock/p2p/answer", json={"sessionId": session_id})
        self.assertEqual(answer.status_code, 200)
        self.assertTrue(answer.json["ok"])

        active_session = self.client.get(f"/mock/p2p/session/{session_id}")
        self.assertEqual(active_session.json["state"], "active")

        sent = self.client.post(
            "/mock/p2p/send",
            json={
                "sessionId": session_id,
                "from": server.DEMO_CLIENT_DID,
                "payload": {
                    "type": "message",
                    "text": "Estou esperando na portaria.",
                    "senderId": server.DEMO_CLIENT_DID,
                    "timestamp": 1,
                },
            },
        )
        self.assertTrue(sent.json["ok"])

        injected = self.client.post(
            "/mock/p2p/inject",
            json={
                "sessionId": session_id,
                "targetDid": server.DEMO_CLIENT_DID,
                "payload": {
                    "type": "message",
                    "text": "smoke ok",
                    "senderId": "dev-panel",
                    "timestamp": 1,
                },
            },
        )
        self.assertTrue(injected.json["ok"])

        payloads = []
        deadline = time.time() + 2
        while time.time() < deadline:
            received = self.client.get(
                f"/mock/p2p/receive?sessionId={session_id}"
                f"&to={server.DEMO_CLIENT_DID}&since=0"
            )
            payloads = [item["payload"] for item in received.json["payloads"]]
            if (
                any(item.get("type") == "location" for item in payloads)
                and any(item.get("text") == "Perfeito, aviso assim que eu chegar." for item in payloads)
            ):
                break
            time.sleep(0.05)
        self.assertTrue(any(item.get("type") == "status" for item in payloads))
        self.assertTrue(any(item.get("type") == "location" for item in payloads))
        self.assertTrue(
            any(item.get("text") == "Perfeito, aviso assim que eu chegar." for item in payloads)
        )
        self.assertTrue(any(item.get("text") == "smoke ok" for item in payloads))

        # Uma identidade comum só conecta depois de um aceite explícito, como
        # no fluxo da versão final. Apenas o motorista do roteiro usa piloto.
        regular_session_id = "regular-peer-session"
        regular_call = self.client.post(
            "/mock/p2p/call",
            json={
                "sessionId": regular_session_id,
                "caller": server.DEMO_CLIENT_DID,
                "callee": "0x0000000000000000000000000000000000000001",
            },
        )
        self.assertFalse(regular_call.json["autoAccepted"])
        regular_pending = self.client.get(f"/mock/p2p/session/{regular_session_id}")
        self.assertEqual(regular_pending.json["state"], "calling")
        self.client.post("/mock/p2p/answer", json={"sessionId": regular_session_id})
        regular_active = self.client.get(f"/mock/p2p/session/{regular_session_id}")
        self.assertEqual(regular_active.json["state"], "active")

        browser_session_id = "same-pc-browser-session"
        browser_call = self.client.post(
            "/mock/p2p/call",
            json={
                "sessionId": browser_session_id,
                "caller": server.DEMO_CLIENT_DID,
                "callee": server.DEMO_DRIVER_DID,
                "manualPeer": True,
            },
        )
        self.assertFalse(browser_call.json["autoAccepted"])
        self.assertEqual(browser_call.json["peerMode"], "manual")
        browser_pending = self.client.get(f"/mock/p2p/session/{browser_session_id}")
        self.assertEqual(browser_pending.json["state"], "calling")

        routes = self.client.get("/mock/map/routes")
        self.assertIn("consolacao_pinheiros", routes.json["routes"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
