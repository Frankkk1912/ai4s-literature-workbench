#!/usr/bin/env python3
"""Shared TLS trust for the workbench's Python scripts.

Both `literature_search.py` and `zotero_literature_manager.py` import this
module instead of keeping two copies of the logic. The rules, in order:

1. Certificate verification is the default and is never turned off silently.
2. System certificates are used through the optional `truststore` package when
   it is importable (its absence is fine; the hint below explains how to add
   it). A custom CA file (below) takes precedence over system injection.
3. A custom CA file is honored through `SSL_CERT_FILE` and
   `REQUESTS_CA_BUNDLE` (first non-empty wins). An empty value is ignored; a
   path that does not point at a readable certificate file raises a clear
   error instead of failing silently.
4. `LITERATURE_TLS_INSECURE` accepts only explicit truthy values (`1`, `true`,
   `yes`, case-folded). When set, verification is disabled for this process
   and a loud warning goes to stderr. Everything else — including `no`,
   `off`, `0`, or an unset variable — keeps verification on.
"""

from __future__ import annotations

import os
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from typing import Any

try:  # Optional: system certificates. Missing is fine; see TLS_GUIDANCE.
    import truststore
except ImportError:  # pragma: no cover - depends on the environment.
    truststore = None

INSECURE_ENV = "LITERATURE_TLS_INSECURE"
_TRUTHY = {"1", "true", "yes"}

CA_ENV_VARS = ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE")

# Query parameters that must never reach an error message or a log line.
_SENSITIVE_QUERY_KEYS = {
    "api_key",
    "apikey",
    "secretkey",
    "secret",
    "key",
    "token",
    "password",
    "mailto",
}

TLS_GUIDANCE = (
    "Fix: export your organization's root certificate as a PEM file and set "
    "SSL_CERT_FILE (or REQUESTS_CA_BUNDLE) to its path, then run this again. "
    "On newer Node-based parts of the workbench, NODE_EXTRA_CA_CERTS does the "
    "same for Node itself. The optional `truststore` package "
    "(pip install truststore / uv add truststore) additionally uses the "
    "system certificate store. Certificate verification is on by default; "
    "LITERATURE_TLS_INSECURE=1 turns it off only as an explicit, warned "
    "override for trusted-network troubleshooting."
)


def is_explicit_truthy(value: str | None) -> bool:
    """True only for an explicit truthy word: 1 / true / yes (case-folded)."""
    return bool(value) and value.strip().lower() in _TRUTHY


def insecure_enabled(env: Mapping[str, str] | None = None) -> bool:
    source = os.environ if env is None else env
    return is_explicit_truthy(source.get(INSECURE_ENV))


def warn_insecure(stream: Any = None) -> None:
    print(
        f"WARNING: {INSECURE_ENV} is set: TLS certificate verification is "
        "DISABLED for every outbound request this script makes. Use it only "
        "on a trusted private network while you fix the certificate setup.",
        file=stream or sys.stderr,
    )


def sanitize_url(url: str) -> str:
    """Drop secret-looking query parameters; keep the rest of the URL."""
    parsed = urllib.parse.urlsplit(url)
    query = [
        (key, value)
        for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in _SENSITIVE_QUERY_KEYS
    ]
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(query), parsed.fragment)
    )


def custom_ca_path(env: Mapping[str, str] | None = None) -> tuple[Path, str] | None:
    """First non-empty CA-file env var, or None. Empty values are ignored."""
    source = os.environ if env is None else env
    for name in CA_ENV_VARS:
        raw = source.get(name)
        if raw and raw.strip():
            return Path(raw.strip()), name
    return None


_truststore_injected = False
_context_cache: ssl.SSLContext | None = None
_opener_cache: urllib.request.OpenerDirector | None = None


def build_ssl_context(
    env: Mapping[str, str] | None = None,
    *,
    allow_insecure: bool | None = None,
) -> ssl.SSLContext:
    """Build the SSL context every urlopen in the workbench scripts shares.

    Never turns verification off unless `allow_insecure` (or the explicit
    `LITERATURE_TLS_INSECURE` env var) says so, and warns when it does.
    """
    source = os.environ if env is None else env
    if allow_insecure is None:
        allow_insecure = insecure_enabled(source)
    if allow_insecure:
        warn_insecure()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context

    ca = custom_ca_path(source)
    if ca is not None:
        path, var_name = ca
        if not path.is_file():
            raise RuntimeError(
                f"{var_name} is set to {path}, which is not a readable file. "
                f"Point it at a valid PEM certificate bundle or unset it; an "
                f"invalid path is never silently ignored. {TLS_GUIDANCE}"
            )
        try:
            # Default trust anchors PLUS the file: extra trust, not a replacement.
            return ssl.create_default_context(cafile=str(path))
        except ssl.SSLError as exc:
            raise RuntimeError(
                f"{var_name} is set to {path}, but its certificates could not "
                f"be loaded ({exc}). Provide a valid PEM file. {TLS_GUIDANCE}"
            ) from exc

    global _truststore_injected
    if truststore is not None and not _truststore_injected:
        # Documented truststore usage: patch ssl once, then every context
        # created afterwards verifies against the system certificate store.
        truststore.inject_into_ssl()
        _truststore_injected = True
    return ssl.create_default_context()


def get_ssl_context(env: Mapping[str, str] | None = None) -> ssl.SSLContext:
    """Process-wide cached context, so env vars are read and warned once."""
    global _context_cache
    if _context_cache is None:
        _context_cache = build_ssl_context(env)
    return _context_cache


def _assert_http_url(full_url: str) -> None:
    """Only http(s) may be opened: the workbench scripts talk to web APIs."""
    if urllib.parse.urlsplit(full_url).scheme not in {"http", "https"}:
        raise ValueError(
            f"open_url only accepts http(s) URLs, not {sanitize_url(full_url)!r}"
        )


def open_url(
    request: urllib.request.Request,
    timeout: float,
    env: Mapping[str, str] | None = None,
):
    """Open an http(s) request with the workbench's shared TLS trust.

    Equivalent to `urllib.request.urlopen(request, timeout, context=...)` but
    only http/https URLs are accepted, so a stray file:// or custom scheme
    can never be opened through this path.
    """
    _assert_http_url(request.full_url)
    global _opener_cache
    if _opener_cache is None:
        # Same handler stack urlopen would use (proxy support included), with
        # every HTTPS connection verified through the shared context above.
        _opener_cache = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=get_ssl_context(env))
        )
    return _opener_cache.open(request, timeout=timeout)


def _cert_reason(exc: BaseException) -> str:
    text = " ".join(str(part) for part in (exc, getattr(exc, "verify_message", "")))
    lowered = text.lower()
    if "expired" in lowered:
        return "the server certificate has expired"
    if "hostname" in lowered and "mismatch" in lowered:
        return "the certificate does not match the server hostname"
    return "the certificate is not trusted (a self-signed or corporate root certificate the system does not know)"


def classify_network_error(exc: BaseException) -> tuple[str, str]:
    """Sort a network failure into tls / dns / timeout / other, with a short
    sanitized description. Certificate problems get the fix-it guidance."""
    reason = getattr(exc, "reason", exc)
    if isinstance(exc, urllib.error.URLError) and isinstance(reason, ssl.SSLCertVerificationError):
        return "tls", f"TLS certificate verification failed: {_cert_reason(exc)}. Behind a proxy or school/company gateway this usually means traffic is re-signed with a private root certificate. {TLS_GUIDANCE}"
    if isinstance(reason, ssl.SSLCertVerificationError):
        return "tls", f"TLS certificate verification failed: {_cert_reason(reason)}. Behind a proxy or school/company gateway this usually means traffic is re-signed with a private root certificate. {TLS_GUIDANCE}"
    if isinstance(reason, socket.gaierror):
        return "dns", f"the host name could not be resolved ({reason}). Check the network or DNS settings; this is not a certificate problem."
    if isinstance(reason, TimeoutError):
        return "timeout", f"the connection timed out ({reason})."
    if isinstance(reason, ConnectionRefusedError):
        return "other", f"the connection was refused ({reason}); the host is reachable but nothing answered on that port."
    return "other", f"{type(reason).__name__}: {reason}"
