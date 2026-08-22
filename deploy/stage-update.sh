#!/usr/bin/env bash
set -euo pipefail

staging_dir="${FLUMMI_STAGING_DIR:-/projects/Flummi-staging}"

if [[ ! -d "${staging_dir}/.git" ]]; then
  echo "Staging checkout not found at ${staging_dir}." >&2
  exit 1
fi

mkdir -p "${staging_dir}/data/runtime"
lock_file="${staging_dir}/data/runtime/stage-update.lock"
exec 9>"${lock_file}"
if ! flock -n 9; then
  echo "A staging update is already running."
  exit 0
fi

user_id="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${user_id}}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

git -C "${staging_dir}" fetch --prune origin main

current_commit="$(git -C "${staging_dir}" rev-parse HEAD)"
target_commit="$(git -C "${staging_dir}" rev-parse origin/main)"

if [[ "${current_commit}" == "${target_commit}" ]]; then
  node "${staging_dir}/scripts/record-update-status.js" checked || true
  echo "Staging is already current at ${current_commit:0:7}."
  exit 0
fi

git -C "${staging_dir}" checkout main
git -C "${staging_dir}" reset --hard origin/main
npm --prefix "${staging_dir}" ci --omit=dev
systemctl --user restart flummi-staging.service
node "${staging_dir}/scripts/record-update-status.js" updated || true
echo "Tailscale staging updated from ${current_commit:0:7} to ${target_commit:0:7}."
