# Automatic staging updates from GitHub

The workflow in `.github/workflows/update-staging.yml` runs after every push to
`main`. It joins the tailnet temporarily, connects to the Arch Linux server over
Tailscale SSH, and runs `deploy/stage-update.sh`. It never promotes staging to
the live service.

## One-time Tailscale setup

1. In the Tailscale admin console, give the Arch Linux device the tag
   `tag:flummi-staging`.
2. Enable Tailscale SSH on Arch Linux:

   ```bash
   sudo tailscale set --ssh
   ```

3. Add these entries to the existing tailnet policy. Merge them with existing
   `tagOwners`, `grants`, and `ssh` sections instead of replacing those sections:

   ```hujson
   "tagOwners": {
     "tag:github-actions": ["autogroup:admin"],
     "tag:flummi-staging": ["autogroup:admin"],
   },
   "grants": [
     {
       "src": ["tag:github-actions"],
       "dst": ["tag:flummi-staging"],
       "ip": ["tcp:22"],
     },
   ],
   "ssh": [
     {
       "action": "accept",
       "src": ["tag:github-actions"],
       "dst": ["tag:flummi-staging"],
       "users": ["marijn"],
     },
   ],
   ```

4. In the Tailscale admin console, create an OAuth client with the writable
   `auth_keys` scope and the tag `tag:github-actions`.

## One-time GitHub setup

In the repository, open **Settings -> Secrets and variables -> Actions** and add
these repository secrets:

- `TS_OAUTH_CLIENT_ID`: the Tailscale OAuth client ID.
- `TS_OAUTH_SECRET`: the Tailscale OAuth client secret.

After the workflow file is pushed, open **Actions -> Update staging**. A normal
push to `main` starts it automatically; **Run workflow** is available for a
manual retry. The existing five-minute server watcher can remain enabled as a
fallback.
