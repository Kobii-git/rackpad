# Proxmox native LXC operations

> [!WARNING]
> `v1.8.2-beta.5` is an experimental tester beta, not a supported production
> installer. Use the prerelease and installer files from that exact Git tag.
> Use it only for a fresh disposable LXC and keep Docker as the
> recommended deployment until Phase 6 of the
> [native LXC roadmap](./PROXMOX_LXC_ROADMAP.md) is complete. Real Proxmox
> validation and the seven-day soak remain outstanding.

Rackpad's native deployment runs one Node.js process directly in an
unprivileged LXC. Docker remains the general recommendation. The intended
production support matrix is Proxmox VE 9.x on `amd64`, with Debian 13 as the
default guest and Ubuntu 24.04 LTS as the tested alternative. Fresh LXCs are the
only planned supported installation path; automatic conversion of an existing
Docker LXC is not provided.

## Experimental Beta 5 test procedure

Run the following only from a root shell on a disposable Proxmox VE 9.x
`amd64` host. Do not run it inside an LXC, do not point it at an existing
Rackpad deployment, and do not use it for production data.

Confirm the host first:

```bash
pveversion | head -n 1
dpkg --print-architecture
command -v curl
command -v jq
```

The first command must report Proxmox VE 9.x and the second must report
`amd64`. Install `curl` or `jq` through the host package manager if either of
the last two commands is empty. Then run the exact tagged installer:

```bash
RACKPAD_MAINTAINER_MODE=1 \
RACKPAD_MAINTAINER_REF=v1.8.2-beta.5 \
RACKPAD_MAINTAINER_RELEASE=v1.8.2-beta.5 \
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Kobii-git/rackpad/v1.8.2-beta.5/scripts/install-proxmox-lxc.sh)"
```

Choose the defaults for the first pass: Debian 13, unprivileged, nesting
enabled, 2 CPU, 4096 MiB RAM, 16 GiB disk, DHCP, and port 3000. Record the new
container ID shown by the helper, then replace `123` below with that ID:

```bash
export CTID=123
pct status "$CTID"
pct config "$CTID" | grep -E '^(arch|cores|memory|rootfs|unprivileged|features|net0):'
pct exec "$CTID" -- systemctl is-active rackpad
pct exec "$CTID" -- cat /etc/rackpad/version
pct exec "$CTID" -- readlink -f /opt/rackpad
CT_IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
echo "http://${CT_IP}:3000"
```

The version must be `v1.8.2-beta.5`, the active path must end in
`/opt/rackpad_releases/v1.8.2-beta.5`, and the service must be active. Check the
HTTP surfaces from both the guest and a machine that will use Rackpad:

```bash
pct exec "$CTID" -- curl -fsS http://127.0.0.1:3000/api/health
pct exec "$CTID" -- curl -fsS http://127.0.0.1:3000/api/auth/status
pct exec "$CTID" -- bash -lc 'curl -fsS http://127.0.0.1:3000/ | grep -q '\''id="root"'\'''
pct exec "$CTID" -- bash -lc 'curl -fsS http://127.0.0.1:3000/api/imports/proxmox-collector | head -n 1'
pct exec "$CTID" -- bash -lc 'curl -fsS http://127.0.0.1:3000/api/imports/hyperv-collector | head -n 1'
curl -fsS "http://${CT_IP}:3000/api/health"
```

Open the displayed URL, create the first administrator, sign out, sign back in,
and confirm `/api/auth/status` changes from requiring bootstrap to not requiring
it. Create a clearly named disposable device so backup and restore can be
verified without ambiguity.

Check ownership, permissions, and systemd hardening without displaying the
environment or secret values:

```bash
pct exec "$CTID" -- stat -c '%U:%G %a %n' \
  /etc/rackpad/rackpad.env /opt/rackpad_data /etc/rackpad/native-lxc
pct exec "$CTID" -- bash -lc 'test -z "$(find /opt/rackpad_releases/v1.8.2-beta.5 -not -user root -print -quit)"'
pct exec "$CTID" -- runuser -u rackpad -- test ! -w /opt/rackpad/package.json
pct exec "$CTID" -- runuser -u rackpad -- test -w /opt/rackpad_data
pct exec "$CTID" -- systemctl show rackpad \
  -p User -p Group -p NoNewPrivileges -p PrivateTmp -p ProtectSystem \
  -p ProtectHome -p UMask -p CapabilityBoundingSet -p AmbientCapabilities \
  -p ReadWritePaths -p RestrictAddressFamilies
```

The environment must be `root:rackpad 640`, data must be `rackpad:rackpad 750`,
code must be root-owned and not writable by `rackpad`, and the service must show
the hardened settings documented below. Verify discovery and the closed trap
listener:

```bash
pct exec "$CTID" -- /usr/local/sbin/rackpad-discovery-mode status
if pct exec "$CTID" -- ss -H -lunp | grep -qE '(^|:)1162[[:space:]]'; then
  echo 'FAIL: UDP 1162 is listening'
else
  echo 'PASS: UDP 1162 is closed'
fi
pct exec "$CTID" -- /usr/local/sbin/rackpad-discovery-mode advanced
pct exec "$CTID" -- /usr/local/sbin/rackpad-discovery-mode status
pct exec "$CTID" -- /usr/local/sbin/rackpad-discovery-mode safe
```

Advanced mode may either succeed or truthfully refuse because the outer
unprivileged LXC blocks raw networking. Record which result occurred; do not
make the LXC privileged merely to force success.

Test a custom port and restore the default:

```bash
pct exec "$CTID" -- sed -i 's/^PORT=3000$/PORT=3100/' /etc/rackpad/rackpad.env
pct exec "$CTID" -- systemctl restart rackpad
pct exec "$CTID" -- curl -fsS http://127.0.0.1:3100/api/health
pct exec "$CTID" -- sed -i 's/^PORT=3100$/PORT=3000/' /etc/rackpad/rackpad.env
pct exec "$CTID" -- systemctl restart rackpad
```

In **Users -> Backup and release state**, create a native SQLite snapshot and
record its exact filename. Change or remove the disposable device, then restore
that snapshot while the service is stopped:

```bash
export SNAPSHOT=/opt/rackpad_data/backups/REPLACE-WITH-EXACT-SNAPSHOT.db
pct exec "$CTID" -- systemctl stop rackpad
pct exec "$CTID" -- runuser -u rackpad -- env \
  DATABASE_PATH=/opt/rackpad_data/rackpad.db \
  node /opt/rackpad/dist-server/cli/restore-native-backup.js --source "$SNAPSHOT"
pct exec "$CTID" -- systemctl start rackpad
pct exec "$CTID" -- systemctl is-active rackpad
```

Confirm the disposable device returned. Then exercise the interactive password
reset from `pct enter "$CTID"` using the password-reset procedure below, verify
the new password, and reboot the guest:

```bash
pct reboot "$CTID"
pct exec "$CTID" -- systemctl is-active rackpad
pct exec "$CTID" -- curl -fsS http://127.0.0.1:3000/api/health
```

For separate disposable beta.3 and beta.4 test guests, the exact prerelease
update and no-op commands are:

```bash
RACKPAD_MAINTAINER_MODE=1 \
RACKPAD_MAINTAINER_RELEASE=v1.8.2-beta.5 \
/usr/bin/update

RACKPAD_MAINTAINER_MODE=1 \
RACKPAD_MAINTAINER_RELEASE=v1.8.2-beta.5 \
/usr/bin/update
```

The first must preserve configuration and data and switch to Beta 5; the second
must report that no update is available without restarting Rackpad. Bare
`/usr/bin/update` follows only stable Releases. The updater refuses an older stable
release before download or downtime and will permit the forward move to stable
`v1.8.2` after that Release exists.

Repeat the fresh-install critical checks on Ubuntu 24.04 using the helper's
advanced settings. Keep successful Debian and Ubuntu guests for rollback and
soak testing. Report results on [issue #138](https://github.com/Kobii-git/rackpad/issues/138)
with the PVE version, guest OS, CT settings, pass/fail checklist, failing step,
and sanitized service logs. Never post `/etc/rackpad/rackpad.env`, secret values,
database files, backups, access tokens, or private network details.

## Required candidate evidence

Use the [beta.5 acceptance matrix](releases/v1.8.2-beta.5-test-notes.md) for
both guest operating systems, the schema-49-to-50 update, paired rollback,
security checks, and seven-day soak. Retain the original encryption key and a
matching database/configuration snapshot before upgrading. A failed upgrade
must restore the previous application together with that snapshot; never start
an older binary against schema 50.

The base systemd unit permits `AF_UNIX AF_INET AF_INET6 AF_NETLINK`; this fixes
the reported Node interface-enumeration startup error. `AF_PACKET` remains
exclusive to explicitly enabled advanced discovery. Check both modes and
confirm UDP 1162 remains closed unless traps were explicitly enabled.

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
