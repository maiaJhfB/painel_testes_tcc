import unittest
from unittest.mock import patch
import server


class CoexistenceTest(unittest.TestCase):
    def test_panel_uses_the_configured_web_port(self):
        with patch.object(server, "WEB_PORT", 8086), server.app.test_request_context("/panel"):
            html = server.get_panel_html()
        self.assertIn("+':8086/'", html)
        self.assertNotIn("+':8085/'", html)
