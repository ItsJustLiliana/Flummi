# Staged Tailscale releases

Flummi now supports two separate runtime checkouts:

- `/projects/Flummi-staging` listens on loopback port `3790` and is exposed privately through Tailscale Serve HTTPS on port `8443`.
- `/projects/Flummi` remains the public production checkout on port `3789`.

Git pushes must update the staging checkout only. Point the existing automatic updater at `deploy/stage-update.sh` instead of pulling into `/projects/Flummi`. This keeps the public service pinned while a new commit is tested through Tailscale.

## One-time server setup

1. Clone the repository to `/projects/Flummi-staging`.
2. Give that checkout its own `.env` with a separate staging Discord bot token and staging-safe runtime settings. Never run the production bot token in both services and do not share a writable `data/` directory.
3. Install `deploy/flummi-staging.service` as `~/.config/systemd/user/flummi-staging.service`.
4. Run `systemctl --user daemon-reload && systemctl --user enable --now flummi-staging.service`.
5. Configure the GitHub update hook/timer to run `/projects/Flummi-staging/deploy/stage-update.sh`.

The staging service binds only to loopback port `3790`; Tailscale Serve provides its private HTTPS endpoint. Cloudflare continues to target production on `3789`.

## Promotion

After testing staging, open **Developer tools** on the Tailscale site and press **Promote to live**. The request requires a developer session, a direct localhost/Tailscale connection, and a Discord authentication less than 30 minutes old.

`deploy/promote-live.sh` promotes the exact Git commit running in staging, while ignored runtime files such as `.env`, `config.json`, and `data/` remain in place. It refuses to overwrite tracked production edits, records the former commit in `data/runtime/previous-live-commit`, installs locked production dependencies, and restarts `flummi.service`. The script uses a lock to prevent overlapping promotions.

The optional environment variables `FLUMMI_STAGING_DIR` and `FLUMMI_PRODUCTION_DIR` can override the default checkout paths.
