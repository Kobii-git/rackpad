# Rackpad on Proxmox

Rackpad runs well in a small Debian or Ubuntu LXC on Proxmox. The recommended
path is to enable LXC nesting, install Docker inside the container, and pull the
published Rackpad container image from GHCR. This avoids cloning the source repo
onto the server.

If you want to import Proxmox node, VM, container, bridge, MAC, VLAN, IP, CPU,
RAM, and disk data into Rackpad, see the
[Proxmox import guide](./PROXMOX_IMPORT.md).

## Recommended LXC size

- Debian 12 or Ubuntu 24.04 LXC
- 2 vCPU minimum
- 2 GB RAM minimum, 4 GB preferred
- 8 GB disk minimum, 16 GB preferred
- Static DHCP lease or fixed IP recommended

## Enable nesting

Docker inside an LXC needs nesting enabled.

From the Proxmox UI:

1. Select the container.
2. Open `Options`.
3. Open `Features`.
4. Enable `Nesting`.
5. Restart the container.

Or from the Proxmox host shell:

```bash
pct set <CTID> -features nesting=1,keyctl=1
pct reboot <CTID>
```

Replace `<CTID>` with the container ID.

## Install Rackpad without git clone

Run this inside the LXC:

```bash
apt-get update
apt-get install -y curl ca-certificates
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh | bash
```

The script writes a small compose project to `/opt/rackpad`, pulls the release
image, starts the container, and stores data in the Docker volume
`rackpad_data`.

Open Rackpad at:

```text
http://LXC_IP:3000
```

## Install a specific version or port

The script defaults to the current stable release. To install the current beta:

```bash
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh -o /tmp/install-rackpad.sh
RACKPAD_TAG=beta bash /tmp/install-rackpad.sh
```

To follow the newest stable GHCR image instead of pinning a release:

```bash
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh -o /tmp/install-rackpad.sh
RACKPAD_TAG=latest bash /tmp/install-rackpad.sh
```

For a custom port:

```bash
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh -o /tmp/install-rackpad.sh
RACKPAD_PORT=8080 bash /tmp/install-rackpad.sh
```

## Update later

Inside the LXC:

```bash
cd /opt/rackpad
docker compose pull
docker compose up -d
```

If you pinned a version in `/opt/rackpad/.env`, update `RACKPAD_TAG` before
running the pull.

## Backups

Rackpad stores its SQLite database in the `rackpad_data` Docker volume. For app
level backups, use the admin backup export from the Rackpad Users screen before
upgrades or container rebuilds.

## Notes

- Keep Rackpad on a private LAN, VPN, or behind a trusted reverse proxy.
- If exposing it through Cloudflare or another proxy, set `TRUST_PROXY=1`,
  `TRUSTED_HOSTS`, and `TRUSTED_ORIGINS` in `/opt/rackpad/.env`.
- A full Proxmox host-side helper that creates the LXC automatically can be
  added later. The LXC-internal installer is intentionally safer and easier to
  audit for a public patch release.
