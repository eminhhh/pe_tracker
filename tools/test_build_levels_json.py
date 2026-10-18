"""Authentication regression tests; no live credentials or network required."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tools import build_levels_json as builder


class CookieTests(unittest.TestCase):
    def setUp(self):
        self.env_patch = patch.dict(builder.os.environ, {}, clear=True)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.files_patch = patch.object(builder, "ENV_FILE_PATHS", [])
        self.files_patch.start()
        self.addCleanup(self.files_patch.stop)

    def test_raw_session_value_remains_supported(self):
        with patch.dict(builder.os.environ, {"PJ_COOKIE": " session-123\n"}):
            self.assertEqual(builder.build_cookies(), {"__Host-PHPSESSID": "session-123"})

    def test_full_header_preserves_auth_and_routing_cookies(self):
        value = "Cookie: __Host-PHPSESSID=session; keep_alive=token==; DYNSRV=server"
        with patch.dict(builder.os.environ, {"PJ_COOKIE": value}):
            self.assertEqual(builder.build_cookies(), {
                "__Host-PHPSESSID": "session", "keep_alive": "token==", "DYNSRV": "server",
            })

    def test_explicit_cookie_name_is_preserved_and_filter_removed(self):
        with patch.dict(builder.os.environ, {"PJ_COOKIE": "PHPSESSID=session; filter_type=solved"}):
            self.assertEqual(builder.build_cookies(), {"PHPSESSID": "session"})

    def test_environment_overrides_dotenv_and_existing_file_order_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            server = Path(directory) / "server.env"
            local = Path(directory) / "local.env"
            server.write_text("PJ_COOKIE=server-session\n", encoding="utf-8")
            local.write_text("PJ_COOKIE='local-session'\n", encoding="utf-8")
            with patch.object(builder, "ENV_FILE_PATHS", [server, local]):
                self.assertEqual(builder.build_cookies()["__Host-PHPSESSID"], "local-session")
                with patch.dict(builder.os.environ, {"PJ_COOKIE": "ci-session"}):
                    self.assertEqual(builder.build_cookies()["__Host-PHPSESSID"], "ci-session")
                with patch.dict(builder.os.environ, {"PJ_COOKIE": ""}):
                    with self.assertRaisesRegex(SystemExit, "missing or empty"):
                        builder.build_cookies()

    def test_missing_and_malformed_cookies_fail_without_exposing_values(self):
        for value in ("", "Cookie:", "invalid secret text", "PHPSESSID=private\nDYNSRV=server"):
            with self.subTest(value=value), patch.dict(builder.os.environ, {"PJ_COOKIE": value}):
                with self.assertRaises(SystemExit) as raised:
                    builder.build_cookies()
                self.assertIn("PE_PJ_COOKIE", str(raised.exception))
                self.assertNotIn("private", str(raised.exception))


class FetchTests(unittest.TestCase):
    def setUp(self):
        self.cookie_patch = patch.object(builder, "build_cookies", return_value={"__Host-PHPSESSID": "test"})
        self.cookie_patch.start()
        self.addCleanup(self.cookie_patch.stop)

    def test_rejected_authentication_has_actionable_message(self):
        for status in (401, 403):
            response = Mock(status_code=status)
            with self.subTest(status=status), patch.object(builder.requests, "get", return_value=response):
                with self.assertRaisesRegex(SystemExit, f"HTTP {status}.*PE_PJ_COOKIE"):
                    builder.fetch_progress_html()
                response.raise_for_status.assert_not_called()

    def test_public_page_rejection_identifies_broader_access_problem(self):
        progress = Mock(status_code=401)
        public = Mock(status_code=403)
        with patch.object(builder.requests, "get", side_effect=[progress, public]) as get:
            with self.assertRaisesRegex(SystemExit, "without cookies.*request filtering"):
                builder.fetch_progress_html()
            self.assertEqual(get.call_args_list[1].args, ("https://projecteuler.net/about",))
            self.assertNotIn("cookies", get.call_args_list[1].kwargs)
            self.assertNotIn("headers", get.call_args_list[0].kwargs)
            self.assertNotIn("headers", get.call_args_list[1].kwargs)

    def test_public_page_success_does_not_claim_a_network_block(self):
        with patch.object(builder.requests, "get", side_effect=[
            Mock(status_code=401), Mock(status_code=200),
        ]):
            with self.assertRaises(SystemExit) as raised:
                builder.fetch_progress_html()
            self.assertIn("public /about page returned HTTP 200", str(raised.exception))
            self.assertIn("does not establish that the cookie is invalid", str(raised.exception))
            self.assertNotIn("PE_REFRESH_RUNNER", str(raised.exception))

    def test_failed_public_probe_preserves_original_rejection(self):
        with patch.object(builder.requests, "get", side_effect=[
            Mock(status_code=401), builder.requests.ConnectionError("private details"),
        ]):
            with self.assertRaises(SystemExit) as raised:
                builder.fetch_progress_html()
            self.assertIn("HTTP 401", str(raised.exception))
            self.assertIn("could not connect", str(raised.exception))
            self.assertNotIn("private details", str(raised.exception))

    def test_login_redirect_with_http_200_is_rejected(self):
        response = Mock(status_code=200, url="https://projecteuler.net/about")
        with patch.object(builder.requests, "get", return_value=response):
            with self.assertRaisesRegex(SystemExit, "redirected away"):
                builder.fetch_progress_html()

    def test_failed_authentication_does_not_replace_existing_data(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "levels.json"
            output.write_text("existing data", encoding="utf-8")
            response = Mock(status_code=401)
            with patch.object(builder.requests, "get", return_value=response), patch(
                "sys.argv", ["build_levels_json.py", "--output", str(output)]
            ):
                with self.assertRaises(SystemExit):
                    builder.main()
            self.assertEqual(output.read_text(encoding="utf-8"), "existing data")

    def test_successful_response_generates_metadata(self):
        html = ('<a href="problem=1"><span class="tooltiptext_narrow">'
                '<div>&quot;Test problem&quot;</div>Difficulty: Level 5 Solved by 1,234'
                '</span></a>')
        response = Mock(status_code=200, url=builder.PROGRESS_URL, text=html)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "levels.json"
            with patch.object(builder.requests, "get", return_value=response) as get, patch(
                "sys.argv", ["build_levels_json.py", "--output", str(output)]
            ):
                builder.main()
            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload["1"], {"difficulty": 5, "solved_by": 1234, "title": "Test problem"})
            self.assertEqual(payload["_meta"]["max_problem_number"], 1)
            self.assertEqual(get.call_args.kwargs["cookies"], {"__Host-PHPSESSID": "test"})
            self.assertNotIn("headers", get.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
