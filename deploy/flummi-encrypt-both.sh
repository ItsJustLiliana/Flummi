#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
encryption_script="${script_dir}/flummi-data-encryption.sh"
command_name="${1:-}"

if [[ -z "$command_name" ]]; then
  echo "Usage: flummi-encrypt-both.sh <preflight|migrate|verify|finalize|rollback|mount|unmount|status>" >&2
  exit 2
fi

case "$command_name" in
  preflight|migrate|verify|finalize|rollback|mount|unmount|status) ;;
  install-auto-mount)
    echo "Install automatic mounting separately so production and staging use different passfiles." >&2
    echo "See deploy/DATA_ENCRYPTION.md." >&2
    exit 2
    ;;
  *) echo "Unsupported command: $command_name" >&2; exit 2 ;;
esac

echo "=== Production: /projects/Flummi ==="
"$encryption_script" "$command_name" --root /projects/Flummi --service flummi.service --instance flummi

echo "=== Staging: /projects/Flummi-staging ==="
"$encryption_script" "$command_name" --root /projects/Flummi-staging --service flummi-staging.service --instance flummi-staging
