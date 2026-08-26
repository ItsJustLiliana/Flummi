#!/usr/bin/env bash
set -Eeuo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command_name="${1:-}"
[[ -n "$command_name" ]] || { echo "Usage: $0 <preflight|migrate|verify|finalize|rollback|mount|unmount|status>" >&2; exit 2; }
case "$command_name" in
  preflight|migrate|verify|finalize|rollback|mount|unmount|status) ;;
  install-auto-mount) echo "Install automatic mounting separately so production and staging use different passfiles." >&2; exit 2 ;;
  *) echo "Unsupported command: $command_name" >&2; exit 2 ;;
esac
echo '=== Production secrets ==='
"$script_dir/flummi-secrets-encryption.sh" "$command_name" --root /projects/Flummi --service flummi.service --instance flummi
echo '=== Staging secrets ==='
"$script_dir/flummi-secrets-encryption.sh" "$command_name" --root /projects/Flummi-staging --service flummi-staging.service --instance flummi-staging
