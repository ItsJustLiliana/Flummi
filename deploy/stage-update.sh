#!/usr/bin/env bash
set -euo pipefail

staging_dir="${FLUMMI_STAGING_DIR:-/projects/Flummi-staging}"

if [[ ! -d "${staging_dir}/.git" ]]; then
  echo "Staging checkout not found at ${staging_dir}." >&2
  exit 1
fi

git -C "${staging_dir}" fetch --prune origin main
git -C "${staging_dir}" checkout main
git -C "${staging_dir}" reset --hard origin/main
npm --prefix "${staging_dir}" ci --omit=dev
systemctl --user restart flummi-staging.service
echo "Tailscale staging now runs $(git -C "${staging_dir}" rev-parse --short HEAD)."
