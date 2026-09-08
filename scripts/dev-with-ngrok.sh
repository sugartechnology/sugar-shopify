#!/bin/sh
# Run Shopify app dev behind ngrok.
# Requires: ngrok auth token once — https://dashboard.ngrok.com/get-started/your-authtoken
#   ngrok config add-authtoken <TOKEN>
#   # or: echo "NGROK_AUTHTOKEN=..." >> .env
set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

PORT="${TUNNEL_PORT:-3458}"
URL_FILE="${TMPDIR:-/tmp}/sugar-shopify-ngrok.url"

if command -v brew >/dev/null 2>&1; then
  NODE_PREFIX="$(brew --prefix node 2>/dev/null || true)"
  if [ -n "$NODE_PREFIX" ] && [ -x "$NODE_PREFIX/bin/node" ]; then
    export PATH="$NODE_PREFIX/bin:$PATH"
  fi
fi
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require ${SCRIPT_DIR}/dns-google-preload.cjs"

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

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok yok. Kurulum: brew install ngrok/ngrok/ngrok" >&2
  exit 1
fi

if [ -n "${NGROK_AUTHTOKEN:-}" ]; then
  ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null
fi

pkill -f "ngrok http ${PORT}" 2>/dev/null || true
rm -f "$URL_FILE"

echo "→ ngrok başlıyor (localhost:${PORT})…"
ngrok http "localhost:${PORT}" --log=stdout --log-format=logfmt >"${TMPDIR:-/tmp}/sugar-shopify-ngrok.log" 2>&1 &
NGROK_PID=$!

cleanup() {
  if kill -0 "$NGROK_PID" 2>/dev/null; then
    kill "$NGROK_PID" 2>/dev/null || true
    wait "$NGROK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

TUNNEL_HOST=""
i=0
while [ "$i" -lt 40 ]; do
  if ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo "ngrok çıktı. Authtoken gerekli olabilir:" >&2
    echo "  https://dashboard.ngrok.com/get-started/your-authtoken" >&2
    tail -n 30 "${TMPDIR:-/tmp}/sugar-shopify-ngrok.log" >&2 || true
    exit 1
  fi
  TUNNEL_HOST="$(
    curl -s --max-time 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
  for t in d.get("tunnels",[]):
    u=t.get("public_url") or ""
    if u.startswith("https://"):
      print(u); break
except Exception:
  pass' 2>/dev/null || true
  )"
  if [ -n "$TUNNEL_HOST" ]; then
    break
  fi
  i=$((i + 1))
  sleep 0.5
done

if [ -z "$TUNNEL_HOST" ]; then
  echo "ngrok URL alınamadı. Authtoken ekle:" >&2
  echo "  ngrok config add-authtoken <TOKEN>" >&2
  tail -n 40 "${TMPDIR:-/tmp}/sugar-shopify-ngrok.log" >&2 || true
  exit 1
fi

echo "$TUNNEL_HOST" >"$URL_FILE"
echo "→ Tunnel: ${TUNNEL_HOST}"
echo "→ Shopify --tunnel-url ${TUNNEL_HOST}:${PORT}"
echo ""

exec sh "$SCRIPT_DIR/with-node.sh" shopify app dev --tunnel-url "${TUNNEL_HOST}:${PORT}" "$@"
