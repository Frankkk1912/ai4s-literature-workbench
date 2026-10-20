#!/usr/bin/env bash
# Wrapper: all logic lives in bootstrap.mjs.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
	echo "Node.js was not found. Install the current LTS version from https://nodejs.org/ and run this again." >&2
	exit 1
fi

exec node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/bootstrap.mjs" "$@"
