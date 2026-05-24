#!/usr/bin/env bash
set -euo pipefail

OUTPUT_PATH="./rackpad-proxmox-inventory.json"
NODE_NAME=""
INCLUDE_HOST_ADAPTERS="1"
INCLUDE_GUEST_NETWORK="1"

usage() {
  cat <<'EOF'
Collect a Rackpad Proxmox inventory JSON export from the local Proxmox node.

Usage:
  ./collect-proxmox.sh [options]

Options:
  -o, --output, --output-path PATH   JSON file to write
  --node NAME                        Proxmox node name, defaults to hostname -s
  --no-host-adapters                 Skip host adapter/IP collection
  --no-guest-network                 Skip QEMU agent and LXC live IP collection
  -h, --help                         Show this help

Examples:
  ./collect-proxmox.sh -o ./rackpad-proxmox-inventory.json
  ./collect-proxmox.sh --node pve01 --no-guest-network
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--output|--output-path)
      OUTPUT_PATH="${2:-}"
      shift 2
      ;;
    --node)
      NODE_NAME="${2:-}"
      shift 2
      ;;
    --no-host-adapters)
      INCLUDE_HOST_ADAPTERS="0"
      shift
      ;;
    --no-guest-network)
      INCLUDE_GUEST_NETWORK="0"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$OUTPUT_PATH" ]]; then
  echo "Output path cannot be empty." >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to build the inventory JSON." >&2
  exit 1
fi

if ! command -v pvesh >/dev/null 2>&1; then
  echo "pvesh is required. Run this script on a Proxmox VE node." >&2
  exit 1
fi

export RACKPAD_PROXMOX_OUTPUT="$OUTPUT_PATH"
export RACKPAD_PROXMOX_NODE="$NODE_NAME"
export RACKPAD_PROXMOX_INCLUDE_HOST_ADAPTERS="$INCLUDE_HOST_ADAPTERS"
export RACKPAD_PROXMOX_INCLUDE_GUEST_NETWORK="$INCLUDE_GUEST_NETWORK"

python3 - <<'PY'
import datetime
import ipaddress
import json
import os
import re
import socket
import subprocess
from pathlib import Path

SCHEMA = "rackpad.proxmox.inventory.v1"
OUTPUT_PATH = os.environ["RACKPAD_PROXMOX_OUTPUT"]
NODE_NAME = os.environ.get("RACKPAD_PROXMOX_NODE") or ""
INCLUDE_HOST_ADAPTERS = os.environ.get("RACKPAD_PROXMOX_INCLUDE_HOST_ADAPTERS") == "1"
INCLUDE_GUEST_NETWORK = os.environ.get("RACKPAD_PROXMOX_INCLUDE_GUEST_NETWORK") == "1"

DISK_KEY_RE = re.compile(r"^(ide|sata|scsi|virtio)\d+$")
LXC_MOUNT_RE = re.compile(r"^(rootfs|mp\d+)$")
NET_KEY_RE = re.compile(r"^net\d+$")
QEMU_NIC_MODELS = (
    "virtio",
    "e1000",
    "e1000e",
    "rtl8139",
    "vmxnet3",
    "ne2k_pci",
    "i82551",
    "i82557b",
    "i82559er",
)


def run(cmd, *, json_output=False):
    try:
        proc = subprocess.run(
            cmd,
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError as exc:
        return None, str(exc)
    if proc.returncode != 0:
        message = (proc.stderr or proc.stdout or "").strip()
        return None, message or f"{cmd[0]} exited with {proc.returncode}"
    output = proc.stdout.strip()
    if not json_output:
        return output, None
    if not output:
        return None, "empty JSON output"
    try:
        return json.loads(output), None
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON from {' '.join(cmd)}: {exc}"


def pvesh(path):
    return run(["pvesh", "get", path, "--output-format", "json"], json_output=True)


def normalize_workload_list(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "result", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return value
    return []


def parse_key_value_output(value):
    parsed = {}
    for line in str(value or "").splitlines():
        if ":" not in line:
            continue
        key, item_value = line.split(":", 1)
        parsed[key.strip()] = item_value.strip()
    return parsed


def parse_pct_list(value):
    containers = []
    for line in str(value or "").splitlines()[1:]:
        parts = line.split()
        if len(parts) < 3:
            continue
        vmid = number(parts[0])
        if vmid is None:
            continue
        status = parts[1]
        if len(parts) >= 4:
            name = " ".join(parts[3:])
        else:
            name = parts[2]
        containers.append(
            {
                "vmid": int(vmid),
                "name": name,
                "status": status,
            }
        )
    return containers


def pct_list():
    output, error = run(["pct", "list"])
    if error:
        return [], error
    return parse_pct_list(output), None


def pct_config(vmid):
    output, error = run(["pct", "config", str(vmid)])
    if error:
        return None, error
    config = parse_key_value_output(output)
    return config, None if config else "empty pct config output"


def pct_status(vmid):
    output, error = run(["pct", "status", str(vmid)])
    if error:
        return None, error
    status = parse_key_value_output(output)
    return status, None if status else "empty pct status output"


def workload_sort_key(entry):
    parsed = number(entry.get("vmid") or entry.get("ctid"))
    return parsed if parsed is not None else 0


def list_lxc_workloads(node):
    data, error = pvesh(f"/nodes/{node}/lxc")
    items = normalize_workload_list(data)
    if items:
        return items, error

    fallback_items, fallback_error = pct_list()
    errors = unique([error, fallback_error])
    return fallback_items, "; ".join(errors) if errors and not fallback_items else error


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return ""


def parse_os_release():
    values = {}
    for line in read_text("/etc/os-release").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"')
    return values


def parse_config_string(value):
    parts = [part.strip() for part in str(value or "").split(",") if part.strip()]
    options = {}
    for index, part in enumerate(parts):
        if "=" in part:
            key, item_value = part.split("=", 1)
            options[key.strip().lower()] = item_value.strip()
        elif index == 0:
            options["_volume"] = part
        else:
            options[f"_part{index}"] = part
    return options


def normalize_mac(value):
    if not value:
        return ""
    text = str(value).strip().replace("-", ":").lower()
    parts = [part.zfill(2) for part in text.split(":") if part]
    return ":".join(parts) if len(parts) == 6 else text


def display_mac(value):
    normalized = normalize_mac(value)
    return normalized.upper() if normalized else ""


def is_usable_ipv4(value):
    try:
        address = ipaddress.ip_address(str(value).split("/")[0])
    except ValueError:
        return False
    return (
        address.version == 4
        and not address.is_loopback
        and not address.is_link_local
        and not address.is_multicast
        and not address.is_unspecified
    )


def clean_ipv4(value):
    if not value:
        return ""
    address = str(value).split("/")[0].strip()
    return address if is_usable_ipv4(address) else ""


def unique(values):
    seen = set()
    output = []
    for value in values:
        if value in seen or value in (None, ""):
            continue
        seen.add(value)
        output.append(value)
    return output


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def enabled(value):
    if value in (None, "", False):
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() not in ("0", "false", "no", "off")


def round_gb(value):
    if value is None:
        return None
    return round(float(value), 2)


def bytes_to_gb(value):
    parsed = number(value)
    if parsed is None:
        return None
    return round_gb(parsed / (1024 ** 3))


def mib_to_gb(value):
    parsed = number(value)
    if parsed is None:
        return None
    return round_gb(parsed / 1024)


def parse_size_to_gb(value):
    if value in (None, ""):
        return None
    text = str(value).strip()
    match = re.match(r"^([0-9.]+)\s*([KMGTPE]?)(i?B?)?$", text, re.I)
    if not match:
        return None
    amount = number(match.group(1))
    if amount is None:
        return None
    unit = match.group(2).upper()
    multipliers = {
        "": 1 / (1024 ** 3),
        "K": 1 / (1024 ** 2),
        "M": 1 / 1024,
        "G": 1,
        "T": 1024,
        "P": 1024 ** 2,
        "E": 1024 ** 3,
    }
    return round_gb(amount * multipliers.get(unit, 1))


def split_vlan_values(value):
    if value in (None, ""):
        return []
    return [
        item.strip()
        for item in re.split(r"[;, ]+", str(value))
        if item.strip() and item.strip() != "0"
    ]


def vlan_from_options(options):
    tag = options.get("tag") or options.get("vlan")
    trunks = options.get("trunks") or options.get("trunk") or options.get("vlans")
    native = options.get("native") or options.get("nativevlan") or options.get("native_vlan")
    if not tag and not trunks and not native:
        return None
    return {
        "mode": "trunk" if trunks else "access",
        "accessVlanId": tag if tag and not trunks else None,
        "nativeVlanId": native or (tag if trunks else None),
        "allowedVlanIds": split_vlan_values(trunks),
        "raw": ",".join(
            f"{key}={value}"
            for key, value in {
                "tag": tag,
                "native": native,
                "trunks": trunks,
            }.items()
            if value
        ),
    }


def load_ip_address():
    data, error = run(["ip", "-j", "address", "show"], json_output=True)
    if error or not isinstance(data, list):
        return []
    return data


def interface_ip_map(interfaces):
    by_name = {}
    by_mac = {}
    for item in interfaces:
        name = item.get("ifname") or ""
        mac = normalize_mac(item.get("address"))
        ips = []
        for addr in item.get("addr_info", []) or []:
            if addr.get("family") != "inet":
                continue
            ip = clean_ipv4(addr.get("local"))
            if ip:
                ips.append(ip)
        ips = unique(ips)
        if name:
            by_name[name] = ips
        if mac:
            by_mac[mac] = ips
    return by_name, by_mac


def sys_net_value(interface, file_name):
    if not interface:
        return ""
    return read_text(f"/sys/class/net/{interface}/{file_name}")


def bridge_members(interface):
    members_dir = Path(f"/sys/class/net/{interface}/brif")
    if not members_dir.exists():
        return []
    try:
        return sorted(item.name for item in members_dir.iterdir())
    except OSError:
        return []


def bridge_kind(interface, members):
    if members:
        return "external"
    if interface.startswith(("vmbr", "br", "ovs")):
        return "internal"
    return "private"


def collect_host_adapters(interfaces):
    adapters = []
    for item in interfaces:
        name = item.get("ifname")
        if not name or name == "lo":
            continue
        speed = sys_net_value(name, "speed")
        adapters.append(
            {
                "name": name,
                "interfaceDescription": item.get("link_type") or item.get("info_kind") or "",
                "macAddress": display_mac(item.get("address")),
                "status": item.get("operstate") or "unknown",
                "linkSpeed": f"{speed} Mb/s" if speed and speed != "-1" else "",
                "mtu": item.get("mtu"),
                "ipAddresses": [
                    clean_ipv4(addr.get("local"))
                    for addr in item.get("addr_info", []) or []
                    if addr.get("family") == "inet" and clean_ipv4(addr.get("local"))
                ],
            }
        )
    return adapters


def collect_switches(interfaces):
    switches = []
    for item in interfaces:
        name = item.get("ifname") or ""
        if not name or name == "lo":
            continue
        members = bridge_members(name)
        is_bridge = bool(members) or name.startswith(("vmbr", "ovs", "br-"))
        if not is_bridge:
            continue
        ips = [
            clean_ipv4(addr.get("local"))
            for addr in item.get("addr_info", []) or []
            if addr.get("family") == "inet" and clean_ipv4(addr.get("local"))
        ]
        notes = [
            "Imported from Proxmox Linux bridge/OVS interface.",
            f"Members: {', '.join(members)}" if members else "",
            f"MTU: {item.get('mtu')}" if item.get("mtu") else "",
            f"State: {item.get('operstate')}" if item.get("operstate") else "",
            f"Host IPs: {', '.join(ips)}" if ips else "",
        ]
        switches.append(
            {
                "id": name,
                "name": name,
                "kind": bridge_kind(name, members),
                "notes": "\n".join(part for part in notes if part),
                "netAdapterName": ", ".join(members) if members else None,
                "netAdapterInterfaceDescription": "Proxmox bridge",
                "allowManagementOS": bool(ips),
            }
        )
    return switches


def agent_interfaces(node, vmid):
    if not INCLUDE_GUEST_NETWORK:
        return [], "guest network collection disabled"
    data, error = pvesh(f"/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces")
    if error:
        return [], error
    if isinstance(data, dict):
        entries = data.get("result") or data.get("data") or []
    else:
        entries = data or []
    if not isinstance(entries, list):
        return [], "unexpected QEMU guest agent response"
    return entries, None


def agent_ip_map(node, vmid):
    entries, error = agent_interfaces(node, vmid)
    by_mac = {}
    for entry in entries:
        mac = normalize_mac(
            entry.get("hardware-address")
            or entry.get("mac-address")
            or entry.get("macAddress")
        )
        ips = []
        for ip_entry in entry.get("ip-addresses", []) or []:
            ip_type = ip_entry.get("ip-address-type") or ip_entry.get("type")
            if ip_type and str(ip_type).lower() != "ipv4":
                continue
            ip = clean_ipv4(ip_entry.get("ip-address") or ip_entry.get("address"))
            if ip:
                ips.append(ip)
        if mac:
            by_mac[mac] = unique(ips)
    return by_mac, error


def pct_live_interfaces(vmid):
    if not INCLUDE_GUEST_NETWORK:
        return [], "guest network collection disabled"
    data, error = run(
        ["pct", "exec", str(vmid), "--", "ip", "-j", "address", "show"],
        json_output=True,
    )
    if error or not isinstance(data, list):
        return [], error or "unexpected pct network output"
    return data, None


def disk_from_config(key, value):
    options = parse_config_string(value)
    volume = options.get("_volume") or str(value).split(",", 1)[0]
    controller = re.sub(r"\d+$", "", key)
    size_gb = parse_size_to_gb(options.get("size"))
    if size_gb is None and key == "rootfs":
        size_gb = parse_size_to_gb(options.get("size") or value)
    return {
        "path": volume,
        "controllerType": controller,
        "sizeGb": size_gb,
        "vhdType": options.get("format") or controller,
        "storage": volume.split(":", 1)[0] if ":" in volume else "",
        "raw": str(value),
    }


def qemu_network_adapter(vmid, key, value, ip_by_mac):
    options = parse_config_string(value)
    model = ""
    mac = ""
    for candidate in QEMU_NIC_MODELS:
        if options.get(candidate):
            model = candidate
            mac = options[candidate]
            break
    mac = mac or options.get("macaddr") or options.get("hwaddr")
    mac_key = normalize_mac(mac)
    connected = str(options.get("link_down", "0")).lower() not in ("1", "true", "yes", "on")
    bridge = options.get("bridge")
    return {
        "id": f"qemu-{vmid}-{key}",
        "name": key,
        "switchName": bridge,
        "macAddress": display_mac(mac),
        "status": "up" if connected else "down",
        "connected": connected,
        "ipAddresses": ip_by_mac.get(mac_key, []),
        "vlan": vlan_from_options(options),
        "model": model,
        "raw": str(value),
    }


def lxc_network_adapter(vmid, key, value, live_by_name, live_by_mac):
    options = parse_config_string(value)
    name = options.get("name") or key
    mac = options.get("hwaddr") or options.get("mac") or options.get("macaddr")
    mac_key = normalize_mac(mac)
    # `gw` is the container gateway, not an address assigned to the container.
    configured_ips = [clean_ipv4(options.get("ip"))]
    live_ips = []
    if name:
        live_ips.extend(live_by_name.get(name, []))
    if mac_key:
        live_ips.extend(live_by_mac.get(mac_key, []))
    return {
        "id": f"lxc-{vmid}-{key}",
        "name": name,
        "switchName": options.get("bridge"),
        "macAddress": display_mac(mac),
        "status": "up",
        "connected": True,
        "ipAddresses": unique([ip for ip in configured_ips + live_ips if ip]),
        "vlan": vlan_from_options(options),
        "model": options.get("type") or "veth",
        "raw": str(value),
    }


def qemu_guest(node, vmid, config, agent_error):
    ostype = config.get("ostype")
    return {
        "kvpAvailable": not bool(agent_error),
        "osName": ostype,
        "osVersion": None,
        "osBuildNumber": None,
        "computerName": config.get("name"),
        "fullyQualifiedDomainName": None,
        "integrationServicesVersion": "QEMU guest agent" if not agent_error else None,
        "error": agent_error,
    }


def lxc_guest(config, live_error):
    ostype = config.get("ostype")
    return {
        "kvpAvailable": not bool(live_error),
        "osName": f"LXC {ostype}" if ostype else "LXC container",
        "osVersion": config.get("ostype"),
        "osBuildNumber": None,
        "computerName": config.get("hostname"),
        "fullyQualifiedDomainName": None,
        "integrationServicesVersion": "pct exec ip address" if not live_error else None,
        "error": live_error,
    }


def config_tags(config):
    tags = config.get("tags")
    if not tags:
        return []
    if isinstance(tags, list):
        return [str(tag).strip() for tag in tags if str(tag).strip()]
    return [tag.strip() for tag in re.split(r"[;,]", str(tags)) if tag.strip()]


def collect_qemu(node, item):
    vmid = item.get("vmid")
    config, config_error = pvesh(f"/nodes/{node}/qemu/{vmid}/config")
    status, status_error = pvesh(f"/nodes/{node}/qemu/{vmid}/status/current")
    config = config if isinstance(config, dict) else {}
    status = status if isinstance(status, dict) else {}
    ip_by_mac, agent_error = agent_ip_map(node, vmid)
    disks = [
        disk_from_config(key, value)
        for key, value in config.items()
        if DISK_KEY_RE.match(key) and "media=cdrom" not in str(value).lower()
    ]
    adapters = [
        qemu_network_adapter(vmid, key, value, ip_by_mac)
        for key, value in sorted(config.items())
        if NET_KEY_RE.match(key)
    ]
    maxmem_gb = bytes_to_gb(status.get("maxmem")) or mib_to_gb(config.get("memory"))
    used_memory_gb = bytes_to_gb(status.get("mem"))
    storage_gb = sum(disk.get("sizeGb") or 0 for disk in disks) or bytes_to_gb(status.get("maxdisk"))
    cores = number(config.get("cores"))
    sockets = number(config.get("sockets")) or 1
    cpu_count = int(cores * sockets) if cores else int(number(status.get("cpus")) or 0) or None
    name = config.get("name") or item.get("name") or f"vm-{vmid}"
    errors = unique([config_error, status_error, agent_error])
    return {
        "id": f"qemu-{node}-{vmid}",
        "name": name,
        "state": status.get("status") or item.get("status"),
        "generation": None,
        "version": config.get("machine") or config.get("bios"),
        "processorCount": cpu_count,
        "memoryAssignedGb": maxmem_gb,
        "memoryStartupGb": maxmem_gb,
        "memoryUsedGb": used_memory_gb,
        "dynamicMemoryEnabled": enabled(config.get("balloon")),
        "storageGb": round_gb(storage_gb) if storage_gb else None,
        "disks": disks,
        "networkAdapters": adapters,
        "guest": qemu_guest(node, vmid, config, agent_error),
        "guestOsName": config.get("ostype"),
        "guestOsVersion": None,
        "notes": config.get("description") or "",
        "kind": "qemu",
        "vmType": "qemu",
        "vmid": vmid,
        "node": node,
        "template": enabled(config.get("template")),
        "tags": config_tags(config),
        "onBoot": enabled(config.get("onboot")),
        "uptimeSeconds": status.get("uptime"),
        "collectorErrors": errors,
    }


def collect_lxc(node, item):
    vmid = item.get("vmid") or item.get("ctid")
    config, config_error = pvesh(f"/nodes/{node}/lxc/{vmid}/config")
    status, status_error = pvesh(f"/nodes/{node}/lxc/{vmid}/status/current")
    if not isinstance(config, dict) or not config:
        pct_config_data, pct_config_error = pct_config(vmid)
        if isinstance(pct_config_data, dict) and pct_config_data:
            config = pct_config_data
            config_error = None
        elif pct_config_error and not config_error:
            config_error = pct_config_error
    if not isinstance(status, dict) or not status:
        pct_status_data, pct_status_error = pct_status(vmid)
        if isinstance(pct_status_data, dict) and pct_status_data:
            status = pct_status_data
            status_error = None
        elif pct_status_error and not status_error:
            status_error = pct_status_error
    config = config if isinstance(config, dict) else {}
    status = status if isinstance(status, dict) else {}
    live_interfaces, live_error = ([], None)
    if (status.get("status") or item.get("status")) == "running":
        live_interfaces, live_error = pct_live_interfaces(vmid)
    live_by_name, live_by_mac = interface_ip_map(live_interfaces)
    disks = [
        disk_from_config(key, value)
        for key, value in config.items()
        if LXC_MOUNT_RE.match(key)
    ]
    adapters = [
        lxc_network_adapter(vmid, key, value, live_by_name, live_by_mac)
        for key, value in sorted(config.items())
        if NET_KEY_RE.match(key)
    ]
    memory_gb = mib_to_gb(config.get("memory")) or bytes_to_gb(status.get("maxmem"))
    used_memory_gb = bytes_to_gb(status.get("mem"))
    storage_gb = sum(disk.get("sizeGb") or 0 for disk in disks) or bytes_to_gb(status.get("maxdisk"))
    name = config.get("hostname") or item.get("name") or f"ct-{vmid}"
    errors = unique([config_error, status_error, live_error])
    return {
        "id": f"lxc-{node}-{vmid}",
        "name": name,
        "state": status.get("status") or item.get("status"),
        "generation": None,
        "version": config.get("arch"),
        "processorCount": int(number(config.get("cores")) or number(status.get("cpus")) or 0) or None,
        "memoryAssignedGb": memory_gb,
        "memoryStartupGb": memory_gb,
        "memoryUsedGb": used_memory_gb,
        "dynamicMemoryEnabled": False,
        "storageGb": round_gb(storage_gb) if storage_gb else None,
        "disks": disks,
        "networkAdapters": adapters,
        "guest": lxc_guest(config, live_error),
        "guestOsName": f"LXC {config.get('ostype')}" if config.get("ostype") else "LXC container",
        "guestOsVersion": config.get("ostype"),
        "notes": config.get("description") or "",
        "kind": "lxc",
        "vmType": "lxc",
        "vmid": vmid,
        "node": node,
        "template": enabled(config.get("template")),
        "tags": config_tags(config),
        "onBoot": enabled(config.get("onboot")),
        "uptimeSeconds": status.get("uptime"),
        "unprivileged": enabled(config.get("unprivileged")),
        "swapGb": mib_to_gb(config.get("swap")),
        "collectorErrors": errors,
    }


def host_summary(node, interfaces):
    status, status_error = pvesh(f"/nodes/{node}/status")
    status = status if isinstance(status, dict) else {}
    os_release = parse_os_release()
    pve_version, _ = run(["pveversion"])
    pve_verbose, _ = run(["pveversion", "--verbose"])
    fqdn, _ = run(["hostname", "-f"])
    cpuinfo = status.get("cpuinfo") if isinstance(status.get("cpuinfo"), dict) else {}
    memory = status.get("memory") if isinstance(status.get("memory"), dict) else {}
    kernel = status.get("kversion") or read_text("/proc/version")
    logical_processors = cpuinfo.get("cpus") or os.cpu_count()
    return {
        "computerName": node,
        "fqdn": fqdn or socket.getfqdn(),
        "manufacturer": read_text("/sys/class/dmi/id/sys_vendor"),
        "model": read_text("/sys/class/dmi/id/product_name"),
        "logicalProcessors": logical_processors,
        "memoryGb": bytes_to_gb(memory.get("total")),
        "osCaption": os_release.get("PRETTY_NAME") or "Proxmox VE",
        "osVersion": os_release.get("VERSION") or os_release.get("VERSION_ID"),
        "nodeName": node,
        "pveVersion": pve_version,
        "pveVersionVerbose": pve_verbose,
        "kernelVersion": kernel,
        "statusError": status_error,
        "hostIpAddresses": unique(
            ip
            for item in interfaces
            for addr in item.get("addr_info", []) or []
            for ip in [clean_ipv4(addr.get("local"))]
            if addr.get("family") == "inet" and ip
        ),
    }


def main():
    node = NODE_NAME.strip()
    if not node:
        node_output, _ = run(["hostname", "-s"])
        node = (node_output or socket.gethostname().split(".")[0]).strip()

    interfaces = load_ip_address()
    qemu_items, qemu_error = pvesh(f"/nodes/{node}/qemu")
    lxc_items, lxc_error = list_lxc_workloads(node)
    qemu_items = normalize_workload_list(qemu_items)
    lxc_items = normalize_workload_list(lxc_items)

    vms = []
    for item in sorted(qemu_items, key=workload_sort_key):
        vms.append(collect_qemu(node, item))
    for item in sorted(lxc_items, key=workload_sort_key):
        vms.append(collect_lxc(node, item))

    payload = {
        "schema": SCHEMA,
        "provider": "proxmox",
        "collectorVersion": "2",
        "collectedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": host_summary(node, interfaces),
        "switches": collect_switches(interfaces),
        "hostAdapters": collect_host_adapters(interfaces) if INCLUDE_HOST_ADAPTERS else [],
        "vms": vms,
        "summary": {
            "node": node,
            "qemu": len(qemu_items),
            "lxc": len(lxc_items),
            "workloads": len(vms),
        },
        "collectorErrors": unique([qemu_error, lxc_error]),
    }

    output = Path(OUTPUT_PATH)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
PY

echo "Rackpad Proxmox inventory written to ${OUTPUT_PATH}"
