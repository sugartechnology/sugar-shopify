#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

if command -v brew >/dev/null 2>&1; then
  NODE_PREFIX="$(brew --prefix node 2>/dev/null || true)"
  if [ -n "$NODE_PREFIX" ] && [ -x "$NODE_PREFIX/bin/node" ]; then
    export PATH="$NODE_PREFIX/bin:$PATH"
  fi
fi

export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require ${SCRIPT_DIR}/dns-google-preload.cjs"

exec "$@"
