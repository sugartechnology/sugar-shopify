#!/bin/sh
# Start a dedicated Cloudflare quick tunnel on a fixed port, then run Shopify app
# dev against it via --tunnel-url (bypasses the CLI's built-in tunnel manager).
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

PORT="${TUNNEL_PORT:-3458}"
TUNNEL_TARGET="http://localhost:${PORT}"
LOG_FILE="${TMPDIR:-/tmp}/sugar-shopify-tunnel.log"
URL_FILE="${TMPDIR:-/tmp}/sugar-shopify-tunnel.url"

# Prefer Homebrew Node + Google DNS preload used by the rest of the project.
if command -v brew >/dev/null 2>&1; then
  NODE_PREFIX="$(brew --prefix node 2>/dev/null || true)"
  if [ -n "$NODE_PREFIX" ] && [ -x "$NODE_PREFIX/bin/node" ]; then
    export PATH="$NODE_PREFIX/bin:$PATH"
  fi
fi
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require ${SCRIPT_DIR}/dns-google-preload.cjs"

# Load .env so prisma migrate deploy inside shopify app dev sees DATABASE_URL.
if [ -f "$ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(printf '%s' "$line" | tr -d '\r')"
    case "$line" in
      ''|\#*) continue ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    # Don't let .env PORT override the tunnel local port.
    if [ "$key" = "PORT" ]; then
      continue
    fi
    if [ -n "$key" ]; then
      export "$key=$val"
    fi
  done <"$ROOT/.env"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="file:./dev.sqlite"
fi

find_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    command -v cloudflared
    return
  fi
  for candidate in \
    "$(npm root -g 2>/dev/null)/@shopify/cli/bin/cloudflared" \
    "/usr/local/Cellar/node/25.6.1_1/lib/node_modules/@shopify/cli/bin/cloudflared" \
    "/usr/local/lib/node_modules/@shopify/cli/bin/cloudflared" \
    "$ROOT/node_modules/@shopify/cli/bin/cloudflared"
  do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

CF="$(find_cloudflared || true)"
if [ -z "$CF" ]; then
  echo "cloudflared bulunamadı. Önce: npm install && (Shopify CLI kurulu olsun)" >&2
  exit 1
fi

# Stop leftover tunnels on this port / previous cloudflared quick tunnels we own.
pkill -f "cloudflared tunnel --url http://127.0.0.1:${PORT}" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://localhost:${PORT}" 2>/dev/null || true

: >"$LOG_FILE"
rm -f "$URL_FILE"

echo "→ cloudflared başlıyor (${TUNNEL_TARGET})…"
"$CF" tunnel --url "$TUNNEL_TARGET" --no-autoupdate >"$LOG_FILE" 2>&1 &
CF_PID=$!

cleanup() {
  if kill -0 "$CF_PID" 2>/dev/null; then
    kill "$CF_PID" 2>/dev/null || true
    wait "$CF_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

TUNNEL_HOST=""
i=0
while [ "$i" -lt 60 ]; do
  if ! kill -0 "$CF_PID" 2>/dev/null; then
    echo "cloudflared çıktı. Log:" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
  TUNNEL_HOST="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$LOG_FILE" | head -n 1 || true)"
  if [ -n "$TUNNEL_HOST" ]; then
    break
  fi
  i=$((i + 1))
  sleep 0.5
done

if [ -z "$TUNNEL_HOST" ]; then
  echo "Tunnel URL alınamadı. Log:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

echo "$TUNNEL_HOST" >"$URL_FILE"
echo "→ Tunnel: ${TUNNEL_HOST}"
echo "→ Shopify --tunnel-url ${TUNNEL_HOST}:${PORT}"
echo ""

# Quick DNS sanity (router vs public). Non-fatal.
if command -v dig >/dev/null 2>&1; then
  HOST_ONLY="${TUNNEL_HOST#https://}"
  if [ -z "$(dig +short "$HOST_ONLY" A 2>/dev/null | head -n 1)" ]; then
    echo "⚠ Yerel DNS bu hostu çözemiyor olabilir. DNS olarak 1.1.1.1 / 8.8.8.8 kullan." >&2
    echo "  dig @1.1.1.1 +short $HOST_ONLY" >&2
  fi
fi

exec sh "$SCRIPT_DIR/with-node.sh" shopify app dev --tunnel-url "${TUNNEL_HOST}:${PORT}" "$@"
