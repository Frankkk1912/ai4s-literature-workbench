#!/usr/bin/env python3
"""Unit tests for workbench_tls.py — stdlib unittest, no network calls."""

from __future__ import annotations

import contextlib
import io
import socket
import ssl
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import workbench_tls  # type: ignore[reportMissingImports]  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class TestDefaultVerification(unittest.TestCase):
    def test_default_context_verifies_certificates(self) -> None:
        context = workbench_tls.build_ssl_context(env={})
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_unset_or_non_truthy_insecure_values_stay_secure(self) -> None:
        for raw in (None, "", "0", "no", "off", "false", "maybe", "1x"):
            context = workbench_tls.build_ssl_context(
                env={workbench_tls.INSECURE_ENV: raw} if raw is not None else {}
            )
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED, raw)
            self.assertTrue(context.check_hostname, raw)

    def test_explicit_insecure_only_when_truthy_and_warns(self) -> None:
        stderr = io.StringIO()
        for raw in ("1", "true", "yes", " TRUE ", "Yes"):
            with contextlib.redirect_stderr(stderr):
                context = workbench_tls.build_ssl_context(
                    env={workbench_tls.INSECURE_ENV: raw}
                )
            self.assertEqual(context.verify_mode, ssl.CERT_NONE, raw)
            self.assertFalse(context.check_hostname, raw)
        self.assertIn("WARNING", stderr.getvalue())
        self.assertIn(workbench_tls.INSECURE_ENV, stderr.getvalue())


class TestCustomCaFile(unittest.TestCase):
    def test_valid_ca_file_is_loaded_on_top_of_verification(self) -> None:
        ca = str(FIXTURES / "test-root-ca.crt")
        context = workbench_tls.build_ssl_context(env={"SSL_CERT_FILE": ca})
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_request_ca_bundle_is_honored_after_ssl_cert_file(self) -> None:
        ca = str(FIXTURES / "test-root-ca.crt")
        first = workbench_tls.custom_ca_path({"REQUESTS_CA_BUNDLE": ca})
        assert first is not None
        self.assertEqual(first[1], "REQUESTS_CA_BUNDLE")
        both = workbench_tls.custom_ca_path({"SSL_CERT_FILE": ca, "REQUESTS_CA_BUNDLE": ca})
        assert both is not None
        self.assertEqual(both[1], "SSL_CERT_FILE")

    def test_empty_values_are_ignored(self) -> None:
        self.assertIsNone(workbench_tls.custom_ca_path({"SSL_CERT_FILE": "", "REQUESTS_CA_BUNDLE": "  "}))

    def test_invalid_path_raises_a_clear_error(self) -> None:
        with self.assertRaises(RuntimeError) as caught:
            workbench_tls.build_ssl_context(env={"SSL_CERT_FILE": "/no/such/bundle.pem"})
        message = str(caught.exception)
        self.assertIn("SSL_CERT_FILE", message)
        self.assertIn("/no/such/bundle.pem", message)
        self.assertIn("never silently ignored", message)

    def test_unreadable_content_raises_with_fix_guidance(self) -> None:
        bad = Path(__import__("tempfile").mkdtemp()) / "not-a-cert.pem"
        bad.write_text("this is not a certificate", encoding="utf-8")
        with self.assertRaises(RuntimeError) as caught:
            workbench_tls.build_ssl_context(env={"REQUESTS_CA_BUNDLE": str(bad)})
        message = str(caught.exception)
        self.assertIn("REQUESTS_CA_BUNDLE", message)
        self.assertIn("valid PEM", message)


class TestClassificationAndSanitization(unittest.TestCase):
    def test_tls_error_class_and_guidance(self) -> None:
        inner = ssl.SSLCertVerificationError(
            "certificate verify failed: unable to get local issuer certificate"
        )
        exc = urllib.error.URLError(inner)
        error_class, description = workbench_tls.classify_network_error(exc)
        self.assertEqual(error_class, "tls")
        self.assertIn("not trusted", description)
        self.assertIn("SSL_CERT_FILE", description)
        self.assertIn("NODE_EXTRA_CA_CERTS", description)
        self.assertIn("proxy", description)

    def test_expired_certificate_is_distinguished(self) -> None:
        inner = ssl.SSLCertVerificationError("certificate verify failed: certificate has expired")
        error_class, description = workbench_tls.classify_network_error(
            urllib.error.URLError(inner)
        )
        self.assertEqual(error_class, "tls")
        self.assertIn("expired", description)

    def test_dns_and_timeout_and_refused_are_separate_classes(self) -> None:
        dns_class, _ = workbench_tls.classify_network_error(
            urllib.error.URLError(socket.gaierror(-2, "Name or service not known"))
        )
        self.assertEqual(dns_class, "dns")
        timeout_class, _ = workbench_tls.classify_network_error(
            urllib.error.URLError(TimeoutError("timed out"))
        )
        self.assertEqual(timeout_class, "timeout")
        refused_class, _ = workbench_tls.classify_network_error(
            urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))
        )
        self.assertEqual(refused_class, "other")

    def test_sanitize_url_strips_secret_query_parameters(self) -> None:
        url = (
            "https://api.example.org/search?q=gene&api_key=SECRET1&secretkey=SECRET2"
            "&key=SECRET3&token=SECRET4&mailto=a@b.c&publicationName=Nature"
        )
        sanitized = workbench_tls.sanitize_url(url)
        for secret in ("SECRET1", "SECRET2", "SECRET3", "SECRET4", "a@b.c"):
            self.assertNotIn(secret, sanitized)
        self.assertIn("q=gene", sanitized)
        self.assertIn("publicationName=Nature", sanitized)

    def test_open_url_rejects_non_http_schemes(self) -> None:
        # The guard runs before any opener exists, so no file: URL is ever opened.
        with self.assertRaises(ValueError):
            workbench_tls._assert_http_url("file:///etc/passwd")

    def test_caching_reads_env_once(self) -> None:
        workbench_tls._context_cache = None
        with patch.dict(workbench_tls.os.environ, {}, clear=False):
            first = workbench_tls.get_ssl_context(env={})
            second = workbench_tls.get_ssl_context(env={"SSL_CERT_FILE": "/other.pem"})
            self.assertIs(first, second)
        workbench_tls._context_cache = None



class FakeOpener:
    def __init__(self, outcomes: list) -> None:
        self.outcomes = outcomes

    def open(self, request, timeout=None):  # noqa: ANN001 - test double
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


def eof_error() -> urllib.error.URLError:
    return urllib.error.URLError(
        ssl.SSLEOFError(8, "[SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol")
    )


class TestHandshakeFallback(unittest.TestCase):
    def setUp(self) -> None:
        workbench_tls._context_cache = None
        workbench_tls._opener_cache = None
        workbench_tls._compat_level = None
        self.contexts: list[ssl.SSLContext] = []

    tearDown = setUp

    def run_open(self, outcomes: list, env: dict | None = None):
        shared = list(outcomes)
        real_handler = urllib.request.HTTPSHandler

        def fake_handler(context=None):  # noqa: ANN001 - test double
            self.contexts.append(context)
            return real_handler(context=context)

        request = urllib.request.Request("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi")
        with (
            patch.object(workbench_tls.urllib.request, "HTTPSHandler", side_effect=fake_handler),
            patch.object(workbench_tls.urllib.request, "build_opener", side_effect=lambda *_: FakeOpener(shared)),
            contextlib.redirect_stderr(io.StringIO()) as stderr,
        ):
            try:
                result = workbench_tls.open_url(request, timeout=5, env=env if env is not None else {})
            except Exception as exc:  # noqa: BLE001
                result = exc
        return result, stderr.getvalue()

    def test_eof_retries_with_smaller_handshake_and_keeps_verification(self) -> None:
        result, stderr = self.run_open([eof_error(), "ok"])
        self.assertEqual(result, "ok")
        self.assertEqual(workbench_tls._compat_level, 1)
        self.assertIn("UNEXPECTED_EOF", stderr)
        self.assertEqual(len(self.contexts), 2)
        for context in self.contexts:
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)

    def test_second_eof_caps_at_tls12_then_gives_up(self) -> None:
        result, _ = self.run_open([eof_error(), eof_error(), "ok"])
        self.assertEqual(result, "ok")
        self.assertEqual(self.contexts[-1].maximum_version, ssl.TLSVersion.TLSv1_2)
        self.assertEqual(self.contexts[-1].verify_mode, ssl.CERT_REQUIRED)

        self.setUp()
        result, _ = self.run_open([eof_error(), eof_error(), eof_error()])
        self.assertIsInstance(result, urllib.error.URLError)
        error_class, description = workbench_tls.classify_network_error(result)
        self.assertEqual(error_class, "tls-handshake")
        self.assertIn("not a certificate problem", description)

    def test_other_errors_are_not_retried(self) -> None:
        refused = urllib.error.URLError(ConnectionRefusedError(61, "refused"))
        result, stderr = self.run_open([refused, "ok"])
        self.assertIs(result, refused)
        self.assertEqual(len(self.contexts), 1)
        self.assertEqual(stderr, "")

    def test_certificate_errors_are_not_retried(self) -> None:
        bad_cert = urllib.error.URLError(ssl.SSLCertVerificationError(1, "certificate verify failed"))
        result, _ = self.run_open([bad_cert, "ok"])
        self.assertIs(result, bad_cert)
        self.assertEqual(len(self.contexts), 1)

    def test_compat_env_starts_in_compat_mode(self) -> None:
        result, _ = self.run_open(["ok"], env={workbench_tls.COMPAT_ENV: "1"})
        self.assertEqual(result, "ok")
        self.assertEqual(workbench_tls._compat_level, 1)
        self.assertEqual(self.contexts[0].verify_mode, ssl.CERT_REQUIRED)

if __name__ == "__main__":
    unittest.main()
