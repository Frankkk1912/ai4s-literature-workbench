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
5. When the TLS handshake is cut off before it completes (`UNEXPECTED_EOF`,
   seen behind middleboxes that drop the large post-quantum TLS 1.3
   ClientHello of newer OpenSSL builds), `open_url` retries once with a
   single classical key share (P-256), then once more capped at TLS 1.2.
   Certificate verification stays exactly as configured above; only the
   handshake shape changes. `AI4S_TLS_COMPAT=1` starts in that mode.
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
COMPAT_ENV = "AI4S_TLS_COMPAT"
_TRUTHY = {"1", "true", "yes"}

# Handshake fallbacks, mildest first. Level 0 is the normal context.
# 1: TLS 1.3 kept, but only a P-256 key share (a small ClientHello).
# 2: additionally capped at TLS 1.2.
COMPAT_LEVELS = (1, 2)
_COMPAT_CURVE = "prime256v1"

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
_compat_level: int | None = None  # None: not decided yet (reads COMPAT_ENV)


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


def apply_compat_level(context: ssl.SSLContext, level: int) -> ssl.SSLContext:
    """Shrink the handshake of an already-configured context.

    Only the key-exchange groups and the protocol ceiling change; the trust
    settings (`verify_mode`, `check_hostname`, CA files) are left untouched.
    """
    if level >= 1:
        try:
            context.set_ecdh_curve(_COMPAT_CURVE)
        except (AttributeError, ValueError, ssl.SSLError):
            pass  # e.g. a truststore context without this method; level 2 still applies
    if level >= 2:
        context.maximum_version = ssl.TLSVersion.TLSv1_2
    return context


def build_compat_ssl_context(level: int, env: Mapping[str, str] | None = None) -> ssl.SSLContext:
    return apply_compat_level(build_ssl_context(env), level)


def is_handshake_eof(exc: BaseException) -> bool:
    """True when a connection attempt died mid-handshake with an EOF.

    Only `URLError` counts: urllib raises it for failures while connecting,
    before any request bytes are sent, so retrying cannot repeat a request.
    """
    if not isinstance(exc, urllib.error.URLError):
        return False
    reason = exc.reason
    if isinstance(reason, ssl.SSLEOFError):
        return True
    if isinstance(reason, ssl.SSLError):
        text = f"{getattr(reason, 'reason', '')} {reason}".upper()
        return "UNEXPECTED_EOF" in text or "EOF OCCURRED IN VIOLATION OF PROTOCOL" in text
    return False


def _current_compat_level(env: Mapping[str, str] | None) -> int:
    global _compat_level
    if _compat_level is None:
        source = os.environ if env is None else env
        _compat_level = COMPAT_LEVELS[0] if is_explicit_truthy(source.get(COMPAT_ENV)) else 0
    return _compat_level


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
    global _opener_cache, _compat_level
    while True:
        level = _current_compat_level(env)
        if _opener_cache is None:
            # Same handler stack urlopen would use (proxy support included), with
            # every HTTPS connection verified through the shared context above.
            context = get_ssl_context(env) if level == 0 else build_compat_ssl_context(level, env)
            _opener_cache = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context))
        try:
            return _opener_cache.open(request, timeout=timeout)
        except urllib.error.URLError as exc:
            next_levels = [candidate for candidate in COMPAT_LEVELS if candidate > level]
            if not is_handshake_eof(exc) or not next_levels:
                raise
            host = urllib.parse.urlsplit(request.full_url).hostname or "the server"
            shape = "a single P-256 key share" if next_levels[0] == 1 else "TLS 1.2"
            print(
                f"Note: the TLS handshake with {host} was cut off (UNEXPECTED_EOF), which usually "
                f"means a firewall or proxy drops large TLS 1.3 handshakes. Retrying with {shape}; "
                f"certificate verification is unchanged. Set {COMPAT_ENV}=1 to start this way.",
                file=sys.stderr,
            )
            # The fallback stays in effect for the rest of this process.
            _compat_level = next_levels[0]
            _opener_cache = None


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
    if is_handshake_eof(exc):
        return "tls-handshake", (
            "the TLS handshake was cut off before it completed (UNEXPECTED_EOF), even after retrying "
            "with a smaller handshake. A firewall, proxy, or VPN on this network is dropping the "
            "connection; this is not a certificate problem. Try another network, or ask the network "
            "administrator to allow TLS 1.3 to this host."
        )
    if isinstance(reason, socket.gaierror):
        return "dns", f"the host name could not be resolved ({reason}). Check the network or DNS settings; this is not a certificate problem."
    if isinstance(reason, TimeoutError):
        return "timeout", f"the connection timed out ({reason})."
    if isinstance(reason, ConnectionRefusedError):
        return "other", f"the connection was refused ({reason}); the host is reachable but nothing answered on that port."
    return "other", f"{type(reason).__name__}: {reason}"
