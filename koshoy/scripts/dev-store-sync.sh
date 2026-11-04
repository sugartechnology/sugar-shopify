#!/usr/bin/env bash
# Live store → dev store copy (scripts/dev-store-sync.mjs) with its settings read from
# Coolify, never printed. Live is read only.
#   scripts/dev-store-sync.sh            show what would change
#   scripts/dev-store-sync.sh --apply    write into the dev store
# Needs the Coolify API token in $COOLIFY_TOKEN_FILE
# (default /Users/yufae/Desktop/SugarTech-Projects/_koshoy-wt/.coolify-token).
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN_FILE="${COOLIFY_TOKEN_FILE:-/Users/yufae/Desktop/SugarTech-Projects/_koshoy-wt/.coolify-token}"
LIVE_APP=qejh5pn0k31jeszwced4vre6   # koshoy-studio      (feature/koshoy-backend)
DEV_APP=q2kfcjiuva1nzw3a8soz97jz    # koshoy-studio-dev  (dev)

# Prints "export NAME=…" lines for one app's env (values shell-quoted, not shown on screen).
coolify_env() {
  python3 - "$TOKEN_FILE" "$1" "$2" <<'PY'
import json, shlex, sys, urllib.request
token = open(sys.argv[1]).read().strip()
app, prefix = sys.argv[2], sys.argv[3]
req = urllib.request.Request(f"https://coolify.sugartech.io/api/v1/applications/{app}/envs",
                             headers={"Authorization": "Bearer " + token})
envs = {e["key"]: e["value"] for e in json.load(urllib.request.urlopen(req)) if not e.get("is_preview")}
pick = {"SHOP": envs["KOSHOY_SHOPS"].split(",")[0].strip(), "CLIENT_ID": envs["SHOPIFY_API_KEY"],
        "CLIENT_SECRET": envs["SHOPIFY_API_SECRET"], "DATA_KEY": envs["KOSHOY_DATA_API_KEY"],
        "DATA_URL": envs["SHOPIFY_APP_URL"].rstrip("/") + "/api/koshoy"}
for name, value in pick.items():
    print(f"export {prefix}_{name}={shlex.quote(value)}")
PY
}

eval "$(coolify_env "$LIVE_APP" LIVE)"
eval "$(coolify_env "$DEV_APP" DEV)"
exec node scripts/dev-store-sync.mjs "$@"
