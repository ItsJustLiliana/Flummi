#!/usr/bin/env bash
set -Eeuo pipefail

project_root="${FLUMMI_ROOT:-/projects/Flummi}"
plain_dir="${project_root}/data"
cipher_dir="${project_root}/.flummi-data.encrypted"
backup_dir="${project_root}/.flummi-data.plaintext-backup"
verified_marker="${plain_dir}/.flummi-migration-verified"
service_name="${FLUMMI_SERVICE:-}"
instance_name="${FLUMMI_INSTANCE:-}"
mount_service_name=""
passfile=""

usage() {
  cat <<'USAGE'
Usage: flummi-data-encryption.sh <command> [options]

Options:
  --root /projects/Flummi         Project checkout to encrypt.
  --service flummi.service        Matching bot service.
  --instance flummi               Unique systemd mount-unit prefix.
  --passfile /secure/path         Optional unattended unlock secret.

Commands:
  preflight          Check required programs and paths without changing data.
  migrate            Stop Flummi, initialize encryption, copy and verify data.
  verify             Compare the plaintext rollback copy with the mounted data.
  finalize           Permanently remove the verified plaintext rollback copy.
  rollback           Restore the plaintext copy; encrypted data is kept.
  mount              Unlock and mount encrypted data after a reboot.
  unmount            Stop Flummi and unmount the plaintext view.
  install-auto-mount Install a user systemd mount unit using --passfile.
  status             Show mount, service, and migration status.

Without --passfile, gocryptfs asks interactively for the encryption password.
USAGE
}

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "==> $*"; }

parse_options() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --passfile)
        [[ $# -ge 2 ]] || die "--passfile needs an absolute file path."
        passfile="$2"
        shift 2
        ;;
      --root)
        [[ $# -ge 2 ]] || die "--root needs an absolute directory path."
        project_root="$2"
        shift 2
        ;;
      --service)
        [[ $# -ge 2 ]] || die "--service needs a systemd service name."
        service_name="$2"
        shift 2
        ;;
      --instance)
        [[ $# -ge 2 ]] || die "--instance needs a unique name."
        instance_name="$2"
        shift 2
        ;;
      *) die "Unknown option: $1" ;;
    esac
  done
}

require_command() { command -v "$1" >/dev/null 2>&1 || die "Missing '$1'. On Arch run: sudo pacman -S --needed gocryptfs rsync fuse3"; }

validate_paths() {
  project_root="$(realpath -m -- "$project_root")"
  plain_dir="${project_root}/data"
  cipher_dir="${project_root}/.flummi-data.encrypted"
  backup_dir="${project_root}/.flummi-data.plaintext-backup"
  verified_marker="${plain_dir}/.flummi-migration-verified"
  if [[ -z "$instance_name" ]]; then
    [[ "$(basename -- "$project_root")" == "Flummi-staging" ]] && instance_name="flummi-staging" || instance_name="flummi"
  fi
  if [[ -z "$service_name" ]]; then service_name="${instance_name}.service"; fi
  [[ "$instance_name" =~ ^[A-Za-z0-9_-]+$ ]] || die "Invalid instance name: $instance_name"
  [[ "$service_name" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || die "Invalid service name: $service_name"
  mount_service_name="${instance_name}-data-mount.service"
  [[ "$project_root" != "/" && "$project_root" != "$HOME" ]] || die "Refusing unsafe project root: $project_root"
  [[ -d "$project_root" ]] || die "Project root does not exist: $project_root"
  [[ "$plain_dir" == "$project_root/data" ]] || die "Unsafe plaintext path."
  [[ "$cipher_dir" == "$project_root/.flummi-data.encrypted" ]] || die "Unsafe cipher path."
  [[ "$backup_dir" == "$project_root/.flummi-data.plaintext-backup" ]] || die "Unsafe backup path."
  if [[ -n "$passfile" ]]; then
    [[ "$passfile" = /* ]] || die "Passfile path must be absolute."
    [[ -f "$passfile" ]] || die "Passfile not found: $passfile"
  fi
}

gocryptfs_password_args() {
  GOCRYPTFS_PASSWORD_ARGS=()
  [[ -n "$passfile" ]] && GOCRYPTFS_PASSWORD_ARGS=(-passfile "$passfile")
  return 0
}

unmount_plain() {
  if mountpoint -q "$plain_dir"; then
    if command -v fusermount3 >/dev/null 2>&1; then fusermount3 -u "$plain_dir"; else fusermount -u "$plain_dir"; fi
  fi
}

service_was_active=false
mount_service_was_active=false
stop_flummi() {
  if systemctl --user is-active --quiet "$service_name"; then service_was_active=true; fi
  systemctl --user stop "$service_name" 2>/dev/null || true
}

restart_if_needed() {
  if [[ "$service_was_active" == true ]]; then systemctl --user start "$service_name"; fi
}

stop_encrypted_mount() {
  if systemctl --user is-active --quiet "$mount_service_name" 2>/dev/null; then
    mount_service_was_active=true
    systemctl --user stop "$mount_service_name"
  else
    unmount_plain
  fi
}

restore_encrypted_mount() {
  if [[ "$mount_service_was_active" == true ]]; then
    systemctl --user start "$mount_service_name"
    mountpoint -q "$plain_dir" || die "Automatic encrypted mount did not restart."
  else
    mount_data
  fi
}

verify_copy() {
  [[ -d "$backup_dir" ]] || die "No plaintext rollback copy exists at $backup_dir."
  mountpoint -q "$plain_dir" || die "$plain_dir is not an encrypted mount."
  local changes
  changes="$(rsync -a --checksum --delete --dry-run --itemize-changes "$backup_dir/" "$plain_dir/")"
  [[ -z "$changes" ]] || { echo "$changes" >&2; die "Verification failed: mounted data differs from the rollback copy."; }
  note "Checksum verification passed."
}

verify_encrypted_store() {
  require_command gocryptfs
  mountpoint -q "$plain_dir" || die "$plain_dir is not an encrypted mount."
  [[ -f "$verified_marker" ]] || die "Successful migration marker is missing. Do not delete the rollback copy."
  gocryptfs_password_args
  stop_flummi
  stop_encrypted_mount
  set +e
  gocryptfs -fsck "${GOCRYPTFS_PASSWORD_ARGS[@]}" "$cipher_dir"
  local fsck_status=$?
  set -e
  restore_encrypted_mount
  restart_if_needed
  [[ $fsck_status -eq 0 ]] || die "gocryptfs integrity check failed; rollback copy was retained."
  note "Encrypted filesystem integrity check passed."
}

preflight() {
  require_command gocryptfs
  require_command rsync
  require_command mountpoint
  require_command realpath
  require_command systemctl
  [[ -d "$plain_dir" ]] || die "Existing data directory not found: $plain_dir"
  note "Preflight passed for $project_root."
}

migration_failure() {
  local exit_code=$?
  trap - ERR
  echo "Migration failed; attempting automatic rollback." >&2
  systemctl --user stop "$service_name" 2>/dev/null || true
  unmount_plain || true
  if [[ -d "$backup_dir" ]]; then
    rmdir "$plain_dir" 2>/dev/null || true
    if [[ ! -e "$plain_dir" ]]; then mv -- "$backup_dir" "$plain_dir"; fi
  fi
  restart_if_needed || true
  echo "Encrypted working files were retained at $cipher_dir for inspection." >&2
  exit "$exit_code"
}

migrate() {
  preflight
  [[ ! -e "$backup_dir" ]] || die "Rollback copy already exists: $backup_dir"
  [[ ! -e "$cipher_dir" ]] || die "Encrypted directory already exists: $cipher_dir"
  mountpoint -q "$plain_dir" && die "$plain_dir is already a mountpoint."
  gocryptfs_password_args
  stop_flummi
  trap migration_failure ERR
  mv -- "$plain_dir" "$backup_dir"
  mkdir -m 700 -- "$plain_dir" "$cipher_dir"
  note "Initializing encrypted filesystem. Save the recovery master key offline."
  gocryptfs -init "${GOCRYPTFS_PASSWORD_ARGS[@]}" "$cipher_dir"
  gocryptfs -q "${GOCRYPTFS_PASSWORD_ARGS[@]}" "$cipher_dir" "$plain_dir"
  rsync -a -- "$backup_dir/" "$plain_dir/"
  verify_copy
  printf 'verified_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$verified_marker"
  restart_if_needed
  trap - ERR
  note "Migration complete. Test Flummi, then run '$0 finalize'."
}

mount_data() {
  require_command gocryptfs
  require_command mountpoint
  [[ -f "$cipher_dir/gocryptfs.conf" ]] || die "Encrypted store is not initialized: $cipher_dir"
  mkdir -m 700 -p -- "$plain_dir"
  mountpoint -q "$plain_dir" && { note "Encrypted data is already mounted."; return; }
  [[ -z "$(find "$plain_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]] || die "Mountpoint is not empty: $plain_dir"
  gocryptfs_password_args
  gocryptfs -q "${GOCRYPTFS_PASSWORD_ARGS[@]}" "$cipher_dir" "$plain_dir"
  mountpoint -q "$plain_dir" || die "Mount did not become active."
  note "Encrypted data mounted at $plain_dir."
}

finalize() {
  echo "This permanently deletes the plaintext rollback copy: $backup_dir"
  echo "On SSDs, deletion cannot guarantee that old blocks are physically unrecoverable."
  read -r -p 'Type ERASE PLAINTEXT to continue: ' confirmation
  [[ "$confirmation" == "ERASE PLAINTEXT" ]] || die "Finalization cancelled."
  verify_encrypted_store
  local resolved_backup
  resolved_backup="$(realpath -m -- "$backup_dir")"
  [[ "$resolved_backup" == "$project_root/.flummi-data.plaintext-backup" ]] || die "Unsafe deletion target: $resolved_backup"
  rm -rf --one-file-system -- "$resolved_backup"
  note "Plaintext rollback copy deleted."
}

rollback() {
  [[ -d "$backup_dir" ]] || die "No rollback copy exists."
  stop_flummi
  unmount_plain
  rmdir "$plain_dir" 2>/dev/null || die "Plain mount directory is not empty; refusing rollback."
  mv -- "$backup_dir" "$plain_dir"
  rm -f -- "$verified_marker"
  restart_if_needed
  note "Plaintext data restored. Encrypted files remain at $cipher_dir."
}

unmount_data() {
  stop_flummi
  if systemctl --user is-active --quiet "$mount_service_name" 2>/dev/null; then
    systemctl --user stop "$mount_service_name"
  else
    unmount_plain
  fi
  note "Flummi stopped and encrypted data unmounted."
}

install_auto_mount() {
  [[ -n "$passfile" ]] || die "install-auto-mount requires --passfile /absolute/secure/path."
  require_command gocryptfs
  require_command mountpoint
  [[ -f "$cipher_dir/gocryptfs.conf" ]] || die "Run migrate first."
  chmod 600 "$passfile"
  local unit_dir="$HOME/.config/systemd/user"
  local override_dir="$unit_dir/${service_name}.d"
  mkdir -p "$unit_dir" "$override_dir"
  cat >"$unit_dir/$mount_service_name" <<EOF
[Unit]
Description=Unlock Flummi encrypted data
Before=${service_name}

[Service]
Type=simple
ExecStart=/usr/bin/gocryptfs -fg -q -passfile=${passfile} ${cipher_dir} ${plain_dir}
ExecStop=/usr/bin/fusermount3 -u ${plain_dir}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
  cat >"$override_dir/encrypted-data.conf" <<EOF
[Unit]
Requires=${mount_service_name}
After=${mount_service_name}

[Service]
ExecStartPre=/usr/bin/mountpoint -q ${plain_dir}
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$mount_service_name"
  systemctl --user restart "$service_name"
  note "Automatic mount installed and $service_name restarted."
  echo "WARNING: a passfile on the same disk does not protect against full-machine compromise or disk theft."
}

status() {
  if mountpoint -q "$plain_dir"; then echo "Encrypted mount: active"; else echo "Encrypted mount: inactive"; fi
  [[ -f "$cipher_dir/gocryptfs.conf" ]] && echo "Encrypted store: initialized" || echo "Encrypted store: absent"
  [[ -f "$verified_marker" ]] && echo "Migration checksum: passed" || echo "Migration checksum: absent"
  echo "Bot service: $service_name"
  echo "Mount service: $mount_service_name"
  [[ -d "$backup_dir" ]] && echo "Plaintext rollback copy: PRESENT" || echo "Plaintext rollback copy: absent"
  systemctl --user is-active "$service_name" 2>/dev/null || true
}

command_name="${1:-}"
[[ -n "$command_name" ]] || { usage; exit 2; }
shift
parse_options "$@"
validate_paths

case "$command_name" in
  preflight) preflight ;;
  migrate) migrate ;;
  verify) verify_encrypted_store ;;
  finalize) finalize ;;
  rollback) rollback ;;
  mount) mount_data ;;
  unmount) unmount_data ;;
  install-auto-mount) install_auto_mount ;;
  status) status ;;
  help|-h|--help) usage ;;
  *) usage; die "Unknown command: $command_name" ;;
esac
