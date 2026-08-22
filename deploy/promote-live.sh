#!/usr/bin/env bash
set -euo pipefail

staging_dir="${FLUMMI_STAGING_DIR:-/projects/Flummi-staging}"
production_dir="${FLUMMI_PRODUCTION_DIR:-/projects/Flummi}"
lock_file="${XDG_RUNTIME_DIR:-/tmp}/flummi-promote-live.lock"
rollback_file="${production_dir}/data/runtime/previous-live-commit"

if [[ ! -d "${staging_dir}/.git" || ! -d "${production_dir}/.git" ]]; then
  echo "Both staging and production must be Git checkouts." >&2
  exit 1
fi

exec 9>"${lock_file}"
flock -n 9 || { echo "A promotion is already running." >&2; exit 1; }

if [[ -n "$(git -C "${production_dir}" status --porcelain --untracked-files=no)" ]]; then
  echo "Production contains tracked changes. Commit or revert them before promotion." >&2
  exit 1
fi

target_commit="$(git -C "${staging_dir}" rev-parse HEAD)"
previous_commit="$(git -C "${production_dir}" rev-parse HEAD)"
git -C "${production_dir}" fetch --prune origin main
git -C "${production_dir}" cat-file -e "${target_commit}^{commit}"
git -C "${production_dir}" merge-base --is-ancestor "${target_commit}" origin/main

mkdir -p "$(dirname "${rollback_file}")"
printf '%s\n' "${previous_commit}" > "${rollback_file}"
git -C "${production_dir}" reset --hard "${target_commit}"
npm --prefix "${production_dir}" ci --omit=dev
systemctl --user restart flummi.service
echo "Promoted ${target_commit}; rollback commit is ${previous_commit}."
