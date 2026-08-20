#!/usr/bin/env bash
set -euo pipefail

project_dir="${1:-/projects/Flummi}"
cloudflared_bin="${HOME}/.local/bin/cloudflared"
config_dir="${HOME}/.config/cloudflared"
service_dir="${HOME}/.config/systemd/user"
token_file="${config_dir}/tunnel.token"

if [[ ! -x "${cloudflared_bin}" ]]; then
    echo "cloudflared was not found at ${cloudflared_bin}." >&2
    exit 1
fi

version_output="$(${cloudflared_bin} --version 2>&1)"
echo "Using ${version_output}"
version_number="$(sed -nE 's/.*version ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' <<<"${version_output}")"
if [[ -z "${version_number}" ]] || [[ "$(printf '%s\n' '2025.4.0' "${version_number}" | sort -V | head -n 1)" != '2025.4.0' ]]; then
    echo "cloudflared 2025.4.0 or newer is required for a protected token file." >&2
    exit 1
fi

read -rsp "Paste the Cloudflare tunnel token: " tunnel_token
echo
if [[ -z "${tunnel_token}" ]]; then
    echo "No token entered; nothing changed." >&2
    exit 1
fi

install -d -m 700 "${config_dir}"
install -d -m 700 "${service_dir}"
umask 077
printf '%s\n' "${tunnel_token}" > "${token_file}"
unset tunnel_token
chmod 600 "${token_file}"

install -m 600 "${project_dir}/deploy/cloudflared.service" "${service_dir}/cloudflared.service"
systemctl --user daemon-reload
systemctl --user enable --now cloudflared.service

echo
systemctl --user --no-pager --full status cloudflared.service
echo
echo "Token stored at ${token_file} with mode 0600."
echo "The service is enabled for future logins/reboots."
