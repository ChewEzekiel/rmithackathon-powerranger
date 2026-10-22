#!/bin/bash
# Run INSIDE a Linux host with Docker (GitHub Codespace, WSL, any VM).
# Starts the official tideorg/tidecloak-dev image and bootstraps the "consortium" realm with
# the app's own init script. Needs app/.env (KC_BOOTSTRAP_ADMIN_PASSWORD, TIDE_LICENSE_EMAIL,
# TIDE_TERMS_ACCEPTED=yes). Then forward port 8080 to the machine running the browser.
set -euo pipefail
cd "$(dirname "$0")/../app"
set -a; . ./.env; set +a
command -v jq >/dev/null || sudo apt-get install -y jq >/dev/null
mkdir -p data/h2
sudo chown -R 1000:1000 data/h2  # the image runs keycloak as uid 1000
if ! docker ps --format '{{.Names}}' | grep -qx tidecloak; then
  docker rm -f tidecloak >/dev/null 2>&1 || true
  docker run -d --name tidecloak -p 8080:8080 \
    -v "$PWD/data/h2:/opt/keycloak/data/h2" \
    -e KC_BOOTSTRAP_ADMIN_USERNAME="$KC_BOOTSTRAP_ADMIN_USERNAME" \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_BOOTSTRAP_ADMIN_PASSWORD" \
    tideorg/tidecloak-dev:latest
fi
until curl -sf http://localhost:8080 >/dev/null; do sleep 3; done
echo "TideCloak up on :8080"
TIDECLOAK_EXTERNAL=1 BRAND_SKIP=1 bash scripts/init-tidecloak.sh
