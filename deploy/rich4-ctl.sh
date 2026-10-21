#!/usr/bin/env bash
# Rich4 Renew Web — VPS deployment, rollback, gateway & access-control helper.
# No secrets are stored in this script; runtime credentials live under $RUNTIME_DIR/state/ (mode 600).
set -euo pipefail

export PATH="/srv/devspace/runtime/node/bin:$PATH"
REPO_DIR="${RICH4_REPO_DIR:-/srv/devspace/repos/rich4-web}"
GAME_DIR="$REPO_DIR/game"
RUNTIME_DIR="${RICH4_RUNTIME_DIR:-/srv/devspace/repos/rich4-runtime}"
STATE_DIR="$RUNTIME_DIR/state"
CONTROL_DIR="$RUNTIME_DIR/control"
GATEWAY_DIR="${RICH4_GATEWAY_DIR:-/srv/devspace/repos/web-gateway}"
ASSETS_RELEASE_BASE="${RICH4_ASSETS_RELEASE_BASE:-https://github.com/iam567/rich4-renew-app/releases/download/assets}"

ensure_runtime_dirs() {
  mkdir -p "$RUNTIME_DIR" "$STATE_DIR" "$CONTROL_DIR"
  chmod 700 "$STATE_DIR" "$CONTROL_DIR"
}

write_basic_auth() {
  local user="$1"
  local pass="$2"
  ensure_runtime_dirs
  local hash
  hash="$(openssl passwd -6 "$pass")"
  printf "%s:%s\n" "$user" "$hash" > "$STATE_DIR/htpasswd"
  printf "username=%s\npassword=%s\n" "$user" "$pass" > "$STATE_DIR/beta-credentials.txt"
  chmod 600 "$STATE_DIR/htpasswd" "$STATE_DIR/beta-credentials.txt"
}

cmd="${1:-status}"
shift || true

case "$cmd" in
  status)
    echo "Active symlink : $(readlink -f "$RUNTIME_DIR/rich4" 2>/dev/null || echo none)"
    if [[ -f "$RUNTIME_DIR/rich4/release-manifest.json" ]]; then
      grep -E '"buildId"|"gitSha"|"generatedAt"' "$RUNTIME_DIR/rich4/release-manifest.json" || true
    fi
    if [[ -f "$RUNTIME_DIR/rich4-releases/history.json" ]]; then
      echo "Release history:"
      cat "$RUNTIME_DIR/rich4-releases/history.json"
    fi
    ;;

  fetch-assets)
    cd "$GAME_DIR"
    echo "[fetch-assets] Downloading rich4-assets.tar and .sha256..."
    curl -fSL -O "$ASSETS_RELEASE_BASE/rich4-assets.tar.sha256"
    curl -fSL -O "$ASSETS_RELEASE_BASE/rich4-assets.tar"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c rich4-assets.tar.sha256
    else
      shasum -a 256 -c rich4-assets.tar.sha256
    fi
    rm -rf public/assets
    mkdir -p public
    tar -xf rich4-assets.tar -C public/
    rm -f rich4-assets.tar rich4-assets.tar.sha256
    echo "[fetch-assets] Extracted $(find public/assets -type f | wc -l) files into $GAME_DIR/public/assets"
    ;;

  deploy)
    ensure_runtime_dirs
    release_id="${1:-$(git -C "$REPO_DIR" rev-parse --short HEAD)}"
    cd "$GAME_DIR"
    npm run audit:assets
    npm run build:web
    npm run verify:web
    npm run release:web -- deploy --root "$RUNTIME_DIR" --id "$release_id"
    rm -rf dist
    cp "$REPO_DIR/deploy/rich4-ctl.sh" "$CONTROL_DIR/rich4-ctl.sh"
    chmod +x "$CONTROL_DIR/rich4-ctl.sh"
    ;;

  rollback)
    # Issue #1: delegates to `release-web.mjs rollback` (the only rollback implementation; there is no `rollback:web` script).
    # Without an id it returns to the previous release recorded in rich4-releases/history.json.
    target_id="${1:-}"
    if [[ -n "$target_id" && ! "$target_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
      echo "[rollback] Invalid release id '$target_id' (allowed: [A-Za-z0-9][A-Za-z0-9._-]{0,63})." >&2
      exit 2
    fi
    if [[ ! -d "$RUNTIME_DIR/rich4-releases" ]]; then
      echo "[rollback] No releases directory at $RUNTIME_DIR/rich4-releases." >&2
      exit 1
    fi
    cd "$GAME_DIR"
    rollback_args=(rollback --root "$RUNTIME_DIR")
    if [[ -n "$target_id" ]]; then
      rollback_args+=(--to "$target_id")
    fi
    node scripts/release-web.mjs "${rollback_args[@]}"
    echo "Active symlink : $(readlink -f "$RUNTIME_DIR/rich4" 2>/dev/null || echo none)"
    ;;

  set-auth)
    user="${1:?Usage: rich4-ctl.sh set-auth <username> [password]}"
    pass="${2:-Rich4-$(openssl rand -hex 6)}"
    write_basic_auth "$user" "$pass"
    if [[ -x "$GATEWAY_DIR/gateway.sh" ]]; then
      "$GATEWAY_DIR/gateway.sh" reload
    fi
    echo "Updated Basic Auth credentials for user: $user (saved in $STATE_DIR/beta-credentials.txt)"
    ;;

  install-gateway)
    ensure_runtime_dirs
    if [[ ! -f "$STATE_DIR/htpasswd" ]]; then
      write_basic_auth "rich4tester" "Rich4-$(openssl rand -hex 6)"
      echo "Initialized default Basic Auth credentials in $STATE_DIR/beta-credentials.txt"
    fi
    cp "$REPO_DIR/deploy/web-gateway-rich4.conf" "$GATEWAY_DIR/conf.d/rich4.conf"
    cp "$REPO_DIR/deploy/rich4-ctl.sh" "$CONTROL_DIR/rich4-ctl.sh"
    chmod +x "$CONTROL_DIR/rich4-ctl.sh"
    "$GATEWAY_DIR/gateway.sh" reload
    echo "Installed /rich4/ route into $GATEWAY_DIR/conf.d/rich4.conf and reloaded gateway."
    ;;

  smoke-test)
    base_url="${1:-https://apps.gopeaks.club}"
    if [[ ! -f "$STATE_DIR/beta-credentials.txt" ]]; then
      echo "Missing $STATE_DIR/beta-credentials.txt; run set-auth or install-gateway first." >&2
      exit 1
    fi
    user="$(awk -F= '$1=="username"{print $2}' "$STATE_DIR/beta-credentials.txt")"
    pass="$(awk -F= '$1=="password"{print $2}' "$STATE_DIR/beta-credentials.txt")"
    auth="$user:$pass"

    unauth_code="$(curl -s -o /dev/null -w "%{http_code}" "$base_url/rich4/")"
    unauth_asset_code="$(curl -s -o /dev/null -w "%{http_code}" "$base_url/rich4/assets/maps/maps.json")"
    auth_code="$(curl -s -u "$auth" -o /dev/null -w "%{http_code}" "$base_url/rich4/")"
    auth_asset_code="$(curl -s -u "$auth" -o /dev/null -w "%{http_code}" "$base_url/rich4/assets/maps/maps.json")"
    not_found_code="$(curl -s -u "$auth" -o /dev/null -w "%{http_code}" "$base_url/rich4/assets/does-not-exist-9999.png")"

    echo "Unauthenticated /rich4/                  : HTTP $unauth_code (expected 401)"
    echo "Unauthenticated /rich4/assets/maps.json  : HTTP $unauth_asset_code (expected 401)"
    echo "Authenticated   /rich4/                  : HTTP $auth_code (expected 200)"
    echo "Authenticated   /rich4/assets/maps.json  : HTTP $auth_asset_code (expected 200)"
    echo "Authenticated   non-existent asset       : HTTP $not_found_code (expected 404)"

    if [[ "$unauth_code" != "401" || "$unauth_asset_code" != "401" || "$auth_code" != "200" || "$auth_asset_code" != "200" || "$not_found_code" != "404" ]]; then
      echo "Smoke test FAILED." >&2
      exit 1
    fi
    echo "Smoke test PASSED."
    ;;

  *)
    echo "Usage: $0 {status|fetch-assets|deploy [releaseId]|rollback [releaseId]|set-auth <user> [pass]|install-gateway|smoke-test [baseUrl]}" >&2
    exit 2
    ;;
esac
