# Docker network discovery

Rackpad's default Docker compose file is intentionally conservative: bridge
networking, no extra Linux capabilities, a read-only root filesystem, and a
non-root app user. That is the right default for most installs, but network
discovery may need more host visibility.

Use the host-discovery compose variant when Rackpad is running on Linux or inside
a Proxmox LXC and subnet discovery returns no hosts or no MAC addresses.

## Why this happens

Discovery uses ICMP, ARP/neighbor data, `arp-scan`, and `nmap` depending on the
runtime and selected scan mode. Docker bridge networking, Docker Desktop, routed
VLANs, VPNs, and missing raw-socket capabilities can hide the local layer-2
network from the Rackpad container.

For Proxmox unprivileged LXCs, Docker often needs:

- host networking so Rackpad sees the LXC's LAN directly
- `NET_RAW` for ping/ARP-style probes
- `NET_ADMIN` for `arp-scan`/neighbor inspection in stricter containers
- `NET_BIND_SERVICE` if low ports such as SNMP trap port 162 are used
- root inside the container when the LXC refuses these tools for the unprivileged
  app user

## Use the host-discovery compose file

Inside your Rackpad install directory:

```bash
cd /opt/rackpad
curl -fsSLo compose.host-discovery.yml https://raw.githubusercontent.com/Kobii-git/Rackpad/main/docker-compose.host-discovery.yml
docker compose -f compose.host-discovery.yml pull
docker compose -f compose.host-discovery.yml up -d
```

For beta builds, keep `RACKPAD_TAG=beta` in `.env`. If this guide has not been
promoted to `main` yet, replace `/main/` in the `curl` URL with `/beta/`.

With `network_mode: host`, Docker ignores normal `ports:` publishing. Rackpad
listens directly on `${RACKPAD_PORT:-3000}` on the host/LXC network namespace, so
open:

```text
http://SERVER_IP:3000
```

If you set `RACKPAD_PORT=8080`, open `http://SERVER_IP:8080`.

## Arcane / manual compose users

If you manage the compose file yourself, add these options to the `rackpad`
service and remove any `ports:` section when using `network_mode: host`:

```yaml
user: "0:0"
init: true
restart: unless-stopped
network_mode: host
cap_add:
  - NET_RAW
  - NET_ADMIN
  - NET_BIND_SERVICE
```

Keep the existing `/data` volume and environment variables from the normal
Rackpad compose file.

## Security note

Host networking and extra capabilities are broader than the default deployment.
Use them only when Rackpad is on a trusted LAN/VPN or behind a trusted reverse
proxy, and avoid exposing the app directly to the internet.
