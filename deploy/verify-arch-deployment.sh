#!/usr/bin/env bash
set -euo pipefail

project_dir="${1:-/projects/Flummi}"
cd "${project_dir}"

echo "Checking required files..."
test -f control-panel.js
test -f services/repository-file-manager.js
test -f panel/index.html
test -f .env

if ! grep -qx 'PANEL_PUBLIC_URL=https://flummi.liliananuzohra.com' .env; then
    echo "PANEL_PUBLIC_URL is missing or differs in ${project_dir}/.env." >&2
    exit 1
fi

echo "Checking JavaScript syntax..."
node --check control-panel.js
node --check services/repository-file-manager.js

echo "Running repository tests..."
npm test

echo "Checking local panel..."
curl --fail --silent --show-error --head --max-time 10 http://127.0.0.1:3789/ >/dev/null

echo "Checking user services..."
systemctl --user is-active --quiet flummi.service
if systemctl --user is-enabled --quiet cloudflared.service 2>/dev/null; then
    systemctl --user is-active --quiet cloudflared.service
    echo "cloudflared.service is enabled and active."
else
    echo "cloudflared.service is not installed yet; run deploy/install-cloudflared-user-service.sh after creating the tunnel."
fi

echo "Arch deployment checks passed."
