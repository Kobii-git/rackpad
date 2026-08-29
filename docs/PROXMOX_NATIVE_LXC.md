# Proxmox native LXC operations

> [!WARNING]
> The first-party native LXC helper is implemented for beta validation but is
> not a supported public installer yet. Do not use the `main` dispatcher for a
> production install until Phase 6 of the
> [native LXC roadmap](./PROXMOX_LXC_ROADMAP.md) is complete.

Rackpad's native deployment runs one Node.js process directly in an
unprivileged LXC. Docker remains the general recommendation. The intended
production support matrix is Proxmox VE 9.x on `amd64`, with Debian 13 as the
default guest and Ubuntu 24.04 LTS as the tested alternative. Fresh LXCs are the
only planned supported installation path; automatic conversion of an existing
Docker LXC is not provided.

## Installed layout

| Path | Purpose |
| --- | --- |
| `/opt/rackpad` | Atomic symlink to the active immutable release |
| `/opt/rackpad_releases/<tag>` | Root-owned release code and dependencies |
| `/opt/rackpad_data/rackpad.db` | Live SQLite database |
| `/opt/rackpad_data/backups` | Optional in-app native snapshots |
| `/opt/rackpad_data/update-rollback` | Paired update recovery points |
| `/etc/rackpad/rackpad.env` | Operator configuration and secret key |
| `/etc/rackpad/native-lxc` | Exact marker required by native tools |
| `/usr/bin/update` | Manual stable update entrypoint |
| `/usr/local/sbin/rackpad-discovery-mode` | Root-only discovery privilege control |

The service runs as the non-login `rackpad` account. Code is root-owned and
read-only; only `/opt/rackpad_data` is writable by the service.

## Routine operations

Check the service and follow its logs:

```bash
systemctl status rackpad
journalctl -u rackpad -f
```

Edit configuration as root, then restart Rackpad:

```bash
editor /etc/rackpad/rackpad.env
systemctl restart rackpad
systemctl is-active rackpad
```

Do not remove or rotate `RACKPAD_SECRET_KEY`. Rackpad needs the same value to
decrypt stored integration and SNMP secrets. Updates append newly introduced
variables without overwriting operator values and report unknown keys by name
only.

Run a stable update manually:

```bash
/usr/bin/update
```

The updater downloads and builds before downtime. It then stops Rackpad,
integrity-checks a SQLite snapshot, activates the new release, and verifies the
service, health and authentication APIs, SPA, and both collector downloads. A
current installation exits without restarting the service. Failed activation
restores the paired code, database, configuration, systemd assets, script
origin, and Community core pin.

## Discovery privilege modes

Native LXC starts in `safe` mode. The command is root-only and shares the update
transaction lock:

```bash
/usr/local/sbin/rackpad-discovery-mode status
/usr/local/sbin/rackpad-discovery-mode safe
/usr/local/sbin/rackpad-discovery-mode advanced
```

`safe` fixes `DISCOVERY_MAC_SCAN_MODE=neighbor` and clears all service
capabilities. It can use the guest's existing neighbor cache but does not grant
raw network access.

`advanced` first verifies that both the LXC capability boundary and the running
guest permit `CAP_NET_RAW`, `CAP_NET_ADMIN`, and a raw packet socket. Only then
does it set discovery to `auto` and install those two capabilities for the
Rackpad service. If the outer unprivileged LXC blocks the preflight, the command
refuses the change and explains that an administrator must make an explicit
Proxmox-side policy decision. It never changes the LXC to privileged mode or
weakens its outer policy.

SNMP traps are independent of discovery mode and remain disabled by default.
To accept traps, set `SNMP_TRAP_ENABLED=1` in the environment, restart Rackpad,
and explicitly permit UDP 1162 through the Proxmox, guest, and network
firewalls. Switching discovery modes neither enables nor disables traps.

## Backup, restore, and password reset

The portable JSON export in **Users -> Backup and release state** remains the
cross-deployment backup. Native SQLite snapshots are configured at
`/opt/rackpad_data/backups`, but their schedule starts disabled. An administrator
can create a snapshot immediately or enable scheduling from that same page.
Snapshot files are created with mode `0600`.

For an offline native-database restore, first place a trusted Rackpad native
snapshot outside the live database path. Then stop the service and run the
versioned restore CLI as the service account:

```bash
systemctl stop rackpad
runuser -u rackpad -- env \
  DATABASE_PATH=/opt/rackpad_data/rackpad.db \
  node /opt/rackpad/dist-server/cli/restore-native-backup.js \
  --source /opt/rackpad_data/backups/rackpad-native-YYYYMMDDTHHMMSSZ.db
systemctl start rackpad
systemctl is-active rackpad
```

The restore command validates the source and replacement database. Keep the
pre-restore recovery file it reports until acceptance checks pass.

Reset a local user's password interactively while Rackpad is stopped:

```bash
systemctl stop rackpad
runuser -u rackpad -- env \
  DATABASE_PATH=/opt/rackpad_data/rackpad.db \
  node /opt/rackpad/dist-server/cli/reset-password.js --username admin
systemctl start rackpad
```

## Rollback retention and recovery

Successful updates keep the current release and the latest three complete,
paired code/database rollback points. Older release directories are removed
only when neither active nor referenced by a retained pair. Incomplete recovery
directories are retained for diagnosis.

If automatic rollback cannot validate the previous release, Rackpad stays
stopped and prints the exact rollback directory, database snapshot,
environment backup, and previous release target. Do not delete those paths.
Inspect the journal and recovery directory and repair the reported condition.
Then retry the complete paired restore with the exact recovery path printed by
the updater:

```bash
recovery=/opt/rackpad_data/update-rollback/EXACT-DIRECTORY-FROM-UPDATE
bash -c '
  set -Eeuo pipefail
  source /usr/local/lib/rackpad/native-update.sh
  rp_restore_update_state "$1"
' _ "$recovery"
```

The restore function refuses an incomplete pair and validates the old service
before returning success. If it still fails, leave Rackpad stopped and preserve
the directory. If the database must be inspected or restored independently,
use the offline restore procedure above with the recovery directory's
`rackpad.db`, but do not start Rackpad with code other than the matching release
recorded in `active-target`.

## Controlled Docker-to-native migration

Use a fresh native LXC. Do not install over `/opt/rackpad` from an existing
Compose deployment, because the installer deliberately refuses that collision.

1. In the Docker instance, create both a portable JSON export and a protected
   copy of its SQLite database. Record the existing `RACKPAD_SECRET_KEY`
   securely without printing it into logs.
2. Stop the old Compose deployment and leave its LXC and volume intact. Do not
   run the old and new instances against the same data.
3. Install the matching Rackpad version in a fresh native LXC through the
   maintainer-controlled beta procedure. Put the original secret into
   `/etc/rackpad/rackpad.env` with its existing `root:rackpad` ownership and
   `0640` mode.
4. Choose one transfer path:
   - Copy a stopped, validated SQLite database to a protected temporary path and
     use the offline native restore CLI. This preserves the complete stored
     state and requires the original secret to decrypt encrypted values.
   - Import the portable JSON backup through **Users -> Backup and release
     state**. This is safer across differing versions but intentionally redacts
     Discord webhooks, Telegram bot tokens, SMTP passwords, and Docker source
     tokens; re-enter those credentials after import.
5. Start the native instance and verify admin sign-in, inventory, images and
   documents, integrations, monitoring, discovery, backup creation, and both
   collector downloads.
6. Keep the old LXC stopped but recoverable until the new deployment has passed
   acceptance and its own protected backup has been tested.

Never copy a live SQLite file, silently replace the generated native secret, or
delete the old deployment during migration acceptance.
