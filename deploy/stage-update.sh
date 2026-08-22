#!/usr/bin/env bash
set -euo pipefail

staging_dir="${FLUMMI_STAGING_DIR:-/projects/Flummi-staging}"

if [[ ! -d "${staging_dir}/.git" ]]; then
  echo "Staging checkout not found at ${staging_dir}." >&2
  exit 1
fi

git -C "${staging_dir}" fetch --prune origin main

current_commit="$(git -C "${staging_dir}" rev-parse HEAD)"
target_commit="$(git -C "${staging_dir}" rev-parse origin/main)"

if [[ "${current_commit}" == "${target_commit}" ]]; then
  echo "Staging is already current at ${current_commit:0:7}."
  exit 0
fi

git -C "${staging_dir}" checkout main
git -C "${staging_dir}" reset --hard origin/main
npm --prefix "${staging_dir}" ci --omit=dev
systemctl --user restart flummi-staging.service
echo "Tailscale staging updated from ${current_commit:0:7} to ${target_commit:0:7}."
