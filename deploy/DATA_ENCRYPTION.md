# Flummi data-at-rest encryption

Flummi can keep its existing `data/` layout while encrypting the physical files with `gocryptfs`. The bot reads and writes the mounted plaintext view at `/projects/Flummi/data`; ciphertext is stored in `/projects/Flummi/.flummi-data.encrypted`.

This protects files while the encrypted store is locked. While Flummi is running, the mounted `data/` directory remains readable to the server account and root. It does not replace host security, restricted permissions, encrypted transport, retention, or backups.

## Safe migration on Arch Linux

Connect over SSH or Tailscale and run:

```bash
sudo pacman -S --needed gocryptfs rsync fuse3
cd /projects/Flummi
chmod +x deploy/flummi-data-encryption.sh
./deploy/flummi-data-encryption.sh preflight
./deploy/flummi-data-encryption.sh migrate
```

The migration stops `flummi.service`, retains the current directory as a plaintext rollback copy, initializes the encrypted store, mounts it back at `data/`, copies every existing file, compares the copy using checksums before restart, and restarts Flummi if it was running.

Store the recovery master key and password offline. Losing both makes the encrypted data unrecoverable.

Test the bot, panel, `/data export`, and recent statistics. Then run an encrypted-filesystem integrity check and remove the retained plaintext copy:

```bash
./deploy/flummi-data-encryption.sh verify
./deploy/flummi-data-encryption.sh finalize
```

`finalize` requires typing `ERASE PLAINTEXT`. Until that step, encryption is incomplete because the rollback directory remains readable. Deleted SSD blocks may remain physically recoverable; full-disk encryption provides stronger protection against disk theft.

## Reboot and unlocking

Recommended: unlock interactively after reboot, then start Flummi:

```bash
cd /projects/Flummi
./deploy/flummi-data-encryption.sh mount
systemctl --user start flummi.service
```

For unattended startup, create a strong passfile outside the repository and data directories, then install the generated user service:

```bash
mkdir -p ~/.config/flummi
chmod 700 ~/.config/flummi
printf '%s\n' 'REPLACE-WITH-A-LONG-RANDOM-SECRET' > ~/.config/flummi/data-encryption.pass
chmod 600 ~/.config/flummi/data-encryption.pass
cd /projects/Flummi
./deploy/flummi-data-encryption.sh install-auto-mount --passfile "$HOME/.config/flummi/data-encryption.pass"
```

A passfile stored on the same machine permits unattended boot but does not protect against an attacker who obtains the complete machine or disk together with that key. Prefer an interactive secret, hardware-backed secret, or full-disk encryption when physical theft is in scope.

## Recovery

Before `finalize`, restore the original plaintext directory with:

```bash
./deploy/flummi-data-encryption.sh rollback
```

The encrypted copy is retained. After `finalize`, recovery requires mounting the encrypted store with its password or recovery master key.

Useful checks:

```bash
./deploy/flummi-data-encryption.sh status
gocryptfs -fsck /projects/Flummi/.flummi-data.encrypted
systemctl --user status flummi.service flummi-data-mount.service
```
