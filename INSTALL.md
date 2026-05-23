# Rackpad Installation Guide

Current release: `v1.2.2`

Rackpad is easiest to run from Docker. You can either pull the published image
without cloning the repo, or clone the repo and build it yourself.

## Which Install Should I Use?

- **Linux server or VM:** Use Docker and pull the published image.
- **Proxmox:** Create a Debian/Ubuntu LXC, enable nesting, then use the Linux Docker steps inside the LXC.
- **Windows:** Use Docker Desktop with the published image.
- **Development/source build:** Clone `main` and build locally.

## Main Branch Or Version Tag?

- `main` is the stable source branch and is fine for cloning the latest stable code.
- `RACKPAD_TAG=1.2.2` pins the Docker image to a known release. Git tags use
  the `v` prefix, but Docker image tags do not.
- `RACKPAD_TAG=latest` follows the newest published stable GHCR image and is
  convenient for quick installs or test labs.
- `beta` is for testing newer changes before they are promoted.
- For production-style installs, keep `RACKPAD_TAG` pinned and change it only when you intentionally update.

The install files are downloaded from `main` because they should always point at
the current stable install method. The running app image is controlled by
`RACKPAD_TAG`.

## Common Settings

Rackpad uses this environment file for Docker installs:

```bash
RACKPAD_IMAGE=ghcr.io/kobii-git/rackpad
RACKPAD_TAG=1.2.2
RACKPAD_PORT=3000
MONITOR_INTERVAL_MS=300000
TRUST_PROXY=0
TRUSTED_HOSTS=
TRUSTED_ORIGINS=
```

Most users only change:

- `RACKPAD_PORT`: host port to expose, default `3000`.
- `RACKPAD_TAG`: release version to run, for example `1.2.2`, or `latest` for
  the newest stable GHCR image.
- `TRUST_PROXY`, `TRUSTED_HOSTS`, `TRUSTED_ORIGINS`: set these when using a reverse proxy.

Rackpad stores its SQLite database in the Docker volume `rackpad_data`.

## Linux Install

### 1. Install Docker

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

Optional: allow your user to run Docker without `sudo`.

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

### 2A. Run Straight From Docker, No Git Clone

```bash
sudo mkdir -p /opt/rackpad
cd /opt/rackpad
sudo curl -fsSLo compose.yml https://raw.githubusercontent.com/Kobii-git/Rackpad/main/docker-compose.release.yml
```

Create `.env`:

```bash
sudo tee .env >/dev/null <<'EOF'
RACKPAD_IMAGE=ghcr.io/kobii-git/rackpad
RACKPAD_TAG=1.2.2
RACKPAD_PORT=3000
MONITOR_INTERVAL_MS=300000
TRUST_PROXY=0
TRUSTED_HOSTS=
TRUSTED_ORIGINS=
EOF
```

Deploy:

```bash
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

If this is a quick lab install and you want Rackpad to follow the newest stable
published image, set `RACKPAD_TAG=latest` in `.env` instead of a fixed version.

Open:

```text
http://SERVER_IP:3000
```

### 2B. Clone The Repo And Build Locally

Use this if you want the source on the server or want to build the image locally.

```bash
cd /opt
sudo git clone https://github.com/Kobii-git/Rackpad.git rackpad
cd /opt/rackpad
sudo git pull --ff-only origin main
sudo cp .env.example .env
sudo docker compose up --build -d
```

To build an exact release instead of current `main`:

```bash
sudo git checkout v1.2.2
sudo docker compose up --build -d
```

## Proxmox Install

Recommended layout:

- Debian 12 or Ubuntu 24.04 LXC
- 2 vCPU minimum
- 2 GB RAM minimum, 4 GB preferred
- 8 GB disk minimum, 16 GB preferred
- Static DHCP lease or fixed IP recommended

### 1. Create The LXC

Create a normal Debian/Ubuntu LXC in Proxmox.

### 2. Enable Nesting

From the Proxmox UI:

1. Select the container.
2. Open `Options`.
3. Open `Features`.
4. Enable `Nesting`.
5. Restart the container.

Or from the Proxmox host shell:

```bash
pct set <CTID> -features nesting=1,keyctl=1
pct restart <CTID>
```

Replace `<CTID>` with your container ID.

### 3. Install Rackpad Inside The LXC

Enter the LXC shell, then use the Linux install flow.

Fast path:

```bash
apt-get update
apt-get install -y curl ca-certificates
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh | bash
```

Manual path:

```bash
apt-get update
apt-get install -y ca-certificates curl docker.io docker-compose-plugin
systemctl enable --now docker
mkdir -p /opt/rackpad
cd /opt/rackpad
curl -fsSLo compose.yml https://raw.githubusercontent.com/Kobii-git/Rackpad/main/docker-compose.release.yml
```

Then create `.env` and deploy exactly like the Linux no-clone install.

More detail: [docs/PROXMOX.md](./docs/PROXMOX.md)

## Windows Install

Docker Desktop is the recommended Windows path.

### 1. Install Docker Desktop

Install Docker Desktop for Windows and make sure it is using Linux containers.

### 2. Create The Rackpad Folder

Open PowerShell:

```powershell
New-Item -ItemType Directory -Force C:\Rackpad | Out-Null
Set-Location C:\Rackpad
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/Kobii-git/Rackpad/main/docker-compose.release.yml" `
  -OutFile "compose.yml"
```

### 3. Create `.env`

```powershell
@'
RACKPAD_IMAGE=ghcr.io/kobii-git/rackpad
RACKPAD_TAG=1.2.2
RACKPAD_PORT=3000
MONITOR_INTERVAL_MS=300000
TRUST_PROXY=0
TRUSTED_HOSTS=
TRUSTED_ORIGINS=
'@ | Set-Content -Encoding ascii .env
```

### 4. Deploy

```powershell
docker compose pull
docker compose up -d
docker compose ps
```

Open:

```text
http://localhost:3000
```

For access from another machine on your LAN, use the Windows host IP and allow
TCP `3000` through Windows Firewall if needed.

### Windows Source Build

This is mainly for development. Use Node `22 LTS`.

```powershell
git clone https://github.com/Kobii-git/Rackpad.git C:\Rackpad-src
Set-Location C:\Rackpad-src
npm install
npm run build
$env:HOST="0.0.0.0"
$env:PORT="3000"
$env:DATABASE_PATH="$PWD\rackpad.db"
npm start
```

If `better-sqlite3` fails during `npm install`, install Visual Studio Build
Tools or use Docker Desktop instead.

## First Run

1. Open Rackpad in the browser.
2. Create the first admin account.
3. Choose empty setup or demo data.
4. Start adding racks, devices, VLANs, IPAM, monitoring, WiFi, and compute data.

## After Install: Common Workflows

### Import Hyper-V Inventory

Use this when you have a Hyper-V host and want Rackpad to stage VMs, vNICs,
VLANs, IPs, power state, guest OS, CPU, memory, and disk data before importing.

1. Open Rackpad -> `Imports` and click `Download collector`, or copy
   [scripts/collect-hyperv.ps1](./scripts/collect-hyperv.ps1) to the Hyper-V host.
2. Open PowerShell as Administrator on the Hyper-V host.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\collect-hyperv.ps1 -OutputPath .\rackpad-hyperv-inventory.json -IncludeHostAdapters
```

4. Upload `rackpad-hyperv-inventory.json` in Rackpad -> `Imports`.
5. In the host panel, choose `Auto match or create` or select an existing
   Rackpad device to import the VMs under.
6. Edit any staged host or VM fields that Hyper-V could not report.
7. Select the categories to import, then click `Import selected`.

Full details: [docs/HYPERV_IMPORT.md](./docs/HYPERV_IMPORT.md)

### Export Reports

Open Rackpad -> `Reports`.

Use:

- `Print / PDF` to open the browser print dialog and save a polished PDF.
- `Excel workbook` to download an Excel-compatible multi-sheet workbook.
- `Full CSV` or section CSV buttons for spreadsheet-friendly raw data.

Full details: [docs/REPORTS.md](./docs/REPORTS.md)

### View Rack And Cable Relationships

Open Rackpad -> `Visualizer`.

Use it to inspect rack-mounted gear, loose room equipment, linked ports, cable
paths, and connected device context. The visualizer is generated from existing
Rackpad inventory, so add devices, ports, and cables first.

Full details: [docs/VISUALIZER.md](./docs/VISUALIZER.md)

### Configure OIDC Login

Rackpad can keep local users enabled while also offering OIDC sign-in through an
IdP such as Authentik, Pocket ID, Authelia, or Keycloak.

Set the OIDC environment variables in `/opt/rackpad/.env`, restart the
container, then use the provider login button on the sign-in screen. For
Authentik, the issuer is usually the application/provider path, for example:

```bash
OIDC_ENABLED=1
OIDC_LABEL=Authentik
OIDC_ISSUER_URL=https://authentik.example.com/application/o/rackpad
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_REDIRECT_URI=https://rackpad.example.com/api/auth/oidc/callback
OIDC_DEFAULT_ROLE=viewer
OIDC_ADMIN_GROUPS=admin
```

If provider setup returns an HTTP 404, temporarily set `OIDC_DEBUG=1` and test
`OIDC_ISSUER_URL/.well-known/openid-configuration`.

Full details: [docs/OIDC.md](./docs/OIDC.md)

### Write Runbooks And Attach Images

Open Rackpad -> `Docs` for Markdown runbooks and notes. Open a device detail
page -> `Images` to attach room, rack, label, or cabling reference images.

Full details: [docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md)

## Update Rackpad

Before updates, download a backup from:

```text
Users -> Backup and release state -> Download backup
```

Docker update:

```bash
cd /opt/rackpad
sudo docker compose pull
sudo docker compose up -d
```

Windows Docker Desktop update:

```powershell
Set-Location C:\Rackpad
docker compose pull
docker compose up -d
```

To update to a newer pinned release, change `RACKPAD_TAG` in `.env`, then run
the same pull/up commands. To always pull the newest stable image, set
`RACKPAD_TAG=latest`.

## Stop Or Remove

Stop but keep data:

```bash
docker compose down
```

Delete the app container and database volume:

```bash
docker compose down -v
```

Only use `down -v` if you are okay deleting Rackpad's stored data.

## Reverse Proxy And TLS

Keep Rackpad private, behind a VPN, or behind a TLS reverse proxy.

If you expose Rackpad through Caddy, Nginx, Cloudflare, Traefik, IIS, or another
proxy, set:

```bash
TRUST_PROXY=1
TRUSTED_HOSTS=rackpad.example.com
TRUSTED_ORIGINS=https://rackpad.example.com
```

Included examples:

- [deploy/Caddyfile.example](./deploy/Caddyfile.example)
- [deploy/nginx-rackpad.conf](./deploy/nginx-rackpad.conf)

Your proxy should pass:

- `Host`
- `X-Forwarded-Host`
- `X-Forwarded-Proto`
- `X-Forwarded-For`

## Troubleshooting

### Direct URLs return JSON errors

If `/cables`, `/compute`, or `/ipam` returns JSON instead of the app, update to
a current release and restart the container.

### Check Container Status

Linux/Proxmox:

```bash
cd /opt/rackpad
sudo docker compose ps
sudo docker compose logs -f
```

Windows:

```powershell
Set-Location C:\Rackpad
docker compose ps
docker compose logs -f
```

### Port 3000 Is Not Reachable

Check the host firewall, Proxmox firewall, router/firewall rules, Windows
Firewall, or change `RACKPAD_PORT` in `.env`.

### Native Install Fails At `better-sqlite3`

Use Node `22`. On Linux, install build tools:

```bash
sudo apt-get install -y build-essential python3
npm install
```

On Windows, use Docker Desktop unless you are comfortable installing native
build tools.

## Release Channels

- `main`: stable source branch
- `beta`: pre-release testing branch
- `vX.Y.Z`: pinned releases

See [CHANGELOG.md](./CHANGELOG.md) for version history.
