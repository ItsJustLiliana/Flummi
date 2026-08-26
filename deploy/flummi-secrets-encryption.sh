#!/usr/bin/env bash
set -Eeuo pipefail

project_root="${FLUMMI_ROOT:-/projects/Flummi}"
service_name="${FLUMMI_SERVICE:-flummi.service}"
instance_name="${FLUMMI_INSTANCE:-flummi}"
plain_dir=""
cipher_dir=""
backup_dir=""
marker=""
mount_service_name=""
passfile=""
secret_names=(.env config.local.json config.json)
service_was_active=false

die() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "==> $*"; }
usage() { echo "Usage: $0 <preflight|migrate|verify|finalize|rollback|mount|unmount|install-auto-mount|status> [--root PATH] [--service NAME] [--instance NAME] [--passfile PATH]"; }

parse_options() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --root) project_root="$2"; shift 2 ;;
      --service) service_name="$2"; shift 2 ;;
      --instance) instance_name="$2"; shift 2 ;;
      --passfile) passfile="$2"; shift 2 ;;
      *) die "Unknown option: $1" ;;
    esac
  done
}

validate() {
  project_root="$(realpath -m -- "$project_root")"
  [[ "$project_root" != "/" && "$project_root" != "$HOME" && -d "$project_root" ]] || die "Unsafe or missing project root: $project_root"
  [[ "$instance_name" =~ ^[A-Za-z0-9_-]+$ ]] || die "Invalid instance name."
  [[ "$service_name" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || die "Invalid service name."
  plain_dir="${project_root}/.flummi-secrets"
  cipher_dir="${project_root}/.flummi-secrets.encrypted"
  backup_dir="${project_root}/.flummi-secrets.plaintext-backup"
  marker="${plain_dir}/.flummi-secrets-verified"
  mount_service_name="${instance_name}-secrets-mount.service"
  if [[ -n "$passfile" ]]; then [[ "$passfile" = /* && -f "$passfile" ]] || die "Passfile must be an existing absolute path."; fi
}

require_tools() { for tool in gocryptfs rsync mountpoint realpath systemctl; do command -v "$tool" >/dev/null || die "Missing '$tool'."; done; }
password_args() { GOCRYPTFS_PASSWORD_ARGS=(); [[ -n "$passfile" ]] && GOCRYPTFS_PASSWORD_ARGS=(-passfile "$passfile"); return 0; }
unmount_secrets() { if mountpoint -q "$plain_dir"; then fusermount3 -u "$plain_dir" 2>/dev/null || fusermount -u "$plain_dir"; fi; }

restore_service_state() {
  if [[ "$service_was_active" == true ]]; then systemctl --user start "$service_name" || true; fi
}

migration_failed() {
  local exit_code=$?
  trap - ERR
  set +e
  unmount_secrets
  rm -f -- "$marker"
  rmdir "$plain_dir" 2>/dev/null
  if [[ -d "$backup_dir" ]]; then
    for name in "${secret_names[@]}"; do [[ -f "$backup_dir/$name" && ! -e "$project_root/$name" ]] && mv -- "$backup_dir/$name" "$project_root/$name"; done
    rmdir "$backup_dir" 2>/dev/null
  fi
  if [[ -d "$cipher_dir" ]]; then mv -- "$cipher_dir" "${cipher_dir}.failed-$(date -u +%Y%m%dT%H%M%SZ)"; fi
  restore_service_state
  echo "ERROR: Secrets migration failed; plaintext files and the previous service state were restored." >&2
  exit "$exit_code"
}

preflight() {
  require_tools
  local found=false
  for name in "${secret_names[@]}"; do [[ -f "$project_root/$name" ]] && found=true; done
  [[ "$found" == true || -f "$cipher_dir/gocryptfs.conf" ]] || die "No .env or local configuration file was found."
  note "Secrets preflight passed for $project_root."
}

mount_secrets() {
  require_tools
  [[ -f "$cipher_dir/gocryptfs.conf" ]] || die "Encrypted secrets store is not initialized."
  mkdir -m 700 -p -- "$plain_dir"
  mountpoint -q "$plain_dir" && { note "Encrypted secrets already mounted."; return; }
  [[ -z "$(find "$plain_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]] || die "Secrets mountpoint is not empty."
  password_args
  gocryptfs -q "${GOCRYPTFS_PASSWORD_ARGS[@]}" "$cipher_dir" "$plain_dir"
  mountpoint -q "$plain_dir" || die "Secrets mount failed."
}

verify() {
  [[ -d "$backup_dir" && -f "$marker" ]] || die "Verified migration and rollback copy are required."
  mountpoint -q "$plain_dir" || die "Encrypted secrets are not mounted."
  local changes
  changes="$(rsync -a --checksum --delete --dry-run --itemize-changes --exclude=.flummi-secrets-verified "$backup_dir/" "$plain_dir/")"
  [[ -z "$changes" ]] || { echo "$changes" >&2; die "Secrets checksum verification failed."; }
  note "Secrets checksum verification passed."
}

migrate() {
  preflight
  [[ ! -e "$backup_dir" && ! -e "$cipher_dir" ]] || die "Secrets migration or encrypted store already exists."
  systemctl --user is-active --quiet "$service_name" && service_was_active=true
  systemctl --user stop "$service_name"
  trap 'migration_failed' ERR
  mkdir -m 700 -- "$backup_dir" "$plain_dir" "$cipher_dir"
  local found=false
  for name in "${secret_names[@]}"; do if [[ -f "$project_root/$name" ]]; then mv -- "$project_root/$name" "$backup_dir/$name"; found=true; fi; done
  [[ "$found" == true ]] || die "No plaintext secrets were moved."
  password_args
  note "Initializing encrypted secrets store. Save the recovery master key offline."
  gocryptfs -init "${GOCRYPTFS_PASSWORD_ARGS[@]}" "$cipher_dir"
  gocryptfs -q "${GOCRYPTFS_PASSWORD_ARGS[@]}" "$cipher_dir" "$plain_dir"
  rsync -a -- "$backup_dir/" "$plain_dir/"
  printf 'verified_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$marker"
  verify
  restore_service_state
  trap - ERR
  note "Secrets migration complete. Test Flummi, then run '$0 finalize' with the same options."
}

finalize() {
  echo "This permanently deletes the plaintext secrets rollback copy: $backup_dir"
  read -r -p 'Type ERASE PLAINTEXT SECRETS to continue: ' confirmation
  [[ "$confirmation" == "ERASE PLAINTEXT SECRETS" ]] || die "Finalization cancelled."
  verify
  password_args
  systemctl --user is-active --quiet "$service_name" && service_was_active=true
  systemctl --user stop "$service_name"
  unmount_secrets
  set +e
  gocryptfs -fsck "${GOCRYPTFS_PASSWORD_ARGS[@]}" "$cipher_dir"
  local fsck_status=$?
  set -e
  mount_secrets
  restore_service_state
  [[ "$fsck_status" -eq 0 ]] || die "Integrity check failed; rollback retained and service state restored."
  local resolved="$(realpath -m -- "$backup_dir")"
  [[ "$resolved" == "$project_root/.flummi-secrets.plaintext-backup" ]] || die "Unsafe deletion target."
  rm -rf --one-file-system -- "$resolved"
  note "Plaintext secrets rollback copy deleted."
}

rollback() {
  [[ -d "$backup_dir" ]] || die "No plaintext secrets rollback copy exists."
  systemctl --user stop "$service_name"
  unmount_secrets
  rmdir "$plain_dir" 2>/dev/null || die "Secrets mount directory is not empty."
  for name in "${secret_names[@]}"; do [[ -f "$backup_dir/$name" ]] && mv -- "$backup_dir/$name" "$project_root/$name"; done
  rmdir "$backup_dir"
  systemctl --user start "$service_name"
  note "Plaintext secrets restored; encrypted files were retained."
}

install_auto_mount() {
  [[ -n "$passfile" ]] || die "install-auto-mount requires --passfile."
  [[ -f "$cipher_dir/gocryptfs.conf" ]] || die "Run migrate first."
  chmod 600 "$passfile"
  local unit_dir="$HOME/.config/systemd/user" override_dir="$HOME/.config/systemd/user/${service_name}.d"
  mkdir -p "$unit_dir" "$override_dir"
  printf '%s\n' '[Unit]' 'Description=Unlock Flummi encrypted secrets' "Before=${service_name}" '' '[Service]' 'Type=simple' "ExecStart=/usr/bin/gocryptfs -fg -q -passfile=${passfile} ${cipher_dir} ${plain_dir}" "ExecStartPost=/usr/bin/bash -c 'for attempt in {1..100}; do /usr/bin/mountpoint -q ${plain_dir} && exit 0; /usr/bin/sleep 0.1; done; exit 1'" "ExecStop=-/usr/bin/fusermount3 -u ${plain_dir}" 'Restart=on-failure' 'RestartSec=5' '' '[Install]' 'WantedBy=default.target' >"$unit_dir/$mount_service_name"
  printf '%s\n' '[Unit]' "Requires=${mount_service_name}" "After=${mount_service_name}" '' '[Service]' "ExecStartPre=/usr/bin/mountpoint -q ${plain_dir}" >"$override_dir/encrypted-secrets.conf"
  systemctl --user daemon-reload
  systemctl --user enable "$mount_service_name"
  systemctl --user stop "$service_name"
  systemctl --user stop "$mount_service_name" 2>/dev/null || true
  unmount_secrets
  systemctl --user restart "$mount_service_name"
  mountpoint -q "$plain_dir" || die "Automatic secrets mount did not become active."
  systemctl --user restart "$service_name"
  note "Automatic secrets mount installed. A passfile on the same disk does not protect against full-machine compromise."
}

status() {
  mountpoint -q "$plain_dir" && echo 'Encrypted secrets mount: active' || echo 'Encrypted secrets mount: inactive'
  [[ -f "$cipher_dir/gocryptfs.conf" ]] && echo 'Encrypted secrets store: initialized' || echo 'Encrypted secrets store: absent'
  [[ -f "$marker" ]] && echo 'Migration checksum: passed' || echo 'Migration checksum: absent'
  [[ -d "$backup_dir" ]] && echo 'Plaintext secrets rollback: PRESENT' || echo 'Plaintext secrets rollback: absent'
  for name in "${secret_names[@]}"; do [[ -f "$project_root/$name" ]] && echo "WARNING plaintext root file: $name"; done
  systemctl --user is-active "$mount_service_name" 2>/dev/null || true
  systemctl --user is-active "$service_name" 2>/dev/null || true
}

command_name="${1:-}"; [[ -n "$command_name" ]] || { usage; exit 2; }; shift
parse_options "$@"; validate
case "$command_name" in
  preflight) preflight ;; migrate) migrate ;; verify) verify ;; finalize) finalize ;; rollback) rollback ;;
  mount) mount_secrets ;; unmount) systemctl --user stop "$service_name"; unmount_secrets ;;
  install-auto-mount) install_auto_mount ;; status) status ;; help|-h|--help) usage ;; *) usage; exit 2 ;;
esac
