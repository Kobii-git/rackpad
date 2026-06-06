import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import {
  CheckCircle2,
  DownloadCloud,
  FileJson,
  HardDrive,
  Network,
  Server,
  Upload,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n } from "@/i18n";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import {
  canEditInventory,
  createDevice,
  createIpAssignmentRecord,
  createPortRecord,
  createVirtualSwitchRecord,
  createVlanRecord,
  updateDevice,
  updatePort,
  updateVirtualSwitchRecord,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DeviceStatus,
  IpAssignment,
  Port,
  Subnet,
  Vlan,
  VirtualSwitch,
} from "@/lib/types";
import { cidrSize, cn, ipToInt } from "@/lib/utils";

type ImportProvider = "hyperv" | "proxmox";

interface HyperVPayload {
  schema?: string;
  provider?: string;
  collectedAt?: string;
  host?: HyperVHost;
  switches?: HyperVSwitch[];
  hostAdapters?: HyperVHostAdapter[];
  vms?: HyperVVm[];
  summary?: {
    node?: string;
    qemu?: number;
    lxc?: number;
    workloads?: number;
  };
  collectorErrors?: string[];
}

interface HyperVHost {
  computerName?: string;
  fqdn?: string;
  manufacturer?: string;
  model?: string;
  logicalProcessors?: number;
  memoryGb?: number;
  osCaption?: string;
  osVersion?: string;
  nodeName?: string;
  pveVersion?: string | null;
  pveVersionVerbose?: string | null;
  kernelVersion?: string | null;
  hostIpAddresses?: string[];
  statusError?: string | null;
}

interface HyperVHostAdapter {
  name?: string;
  interfaceDescription?: string;
  macAddress?: string;
  status?: string;
  linkSpeed?: string;
  ipAddresses?: string[];
}

interface HyperVSwitch {
  id?: string;
  name?: string;
  kind?: string;
  notes?: string | null;
  netAdapterInterfaceDescription?: string | null;
  netAdapterName?: string | null;
  allowManagementOS?: boolean | null;
}

interface HyperVGuestInfo {
  kvpAvailable?: boolean;
  osName?: string | null;
  osVersion?: string | null;
  osBuildNumber?: string | null;
  computerName?: string | null;
  fullyQualifiedDomainName?: string | null;
  integrationServicesVersion?: string | null;
  error?: string | null;
}

interface HyperVVm {
  id?: string;
  name?: string;
  state?: string;
  generation?: number;
  version?: string;
  processorCount?: number;
  memoryAssignedGb?: number | null;
  memoryStartupGb?: number | null;
  memoryUsedGb?: number | null;
  dynamicMemoryEnabled?: boolean;
  storageGb?: number | null;
  disks?: HyperVDisk[];
  networkAdapters?: HyperVNetworkAdapter[];
  guest?: HyperVGuestInfo | null;
  guestOsName?: string | null;
  guestOsVersion?: string | null;
  notes?: string | null;
  kind?: string;
  vmType?: string;
  vmid?: number | string;
  node?: string;
  template?: boolean;
  tags?: string[] | string;
  onBoot?: boolean;
  uptimeSeconds?: number;
  unprivileged?: boolean;
  swapGb?: number | null;
  collectorErrors?: string[];
}

interface HyperVDisk {
  path?: string;
  controllerType?: string;
  sizeGb?: number | null;
  vhdType?: string | null;
  storage?: string;
  raw?: string;
}

interface HyperVNetworkAdapter {
  id?: string;
  name?: string;
  switchName?: string | null;
  macAddress?: string | null;
  status?: string;
  connected?: boolean;
  ipAddresses?: string[];
  vlan?: HyperVVlanConfig;
  model?: string;
  raw?: string;
}

interface HyperVVlanConfig {
  mode?: string;
  accessVlanId?: number | string | null;
  nativeVlanId?: number | string | null;
  allowedVlanIds?: Array<number | string> | number | string | null;
  raw?: string;
}

interface ImportOptions {
  host: boolean;
  vms: boolean;
  specs: boolean;
  ips: boolean;
  networks: boolean;
  ports: boolean;
  vlans: boolean;
}

interface VmDraft {
  key: string;
  source: HyperVVm;
  include: boolean;
  hostname: string;
  displayName: string;
  managementIp: string;
  osFamily: string;
  osName: string;
  cpuCores: string;
  memoryGb: string;
  storageGb: string;
  notes: string;
}

interface HostDraft {
  targetDeviceId: string;
  hostname: string;
  displayName: string;
  manufacturer: string;
  model: string;
  osName: string;
  osVersion: string;
  cpuCores: string;
  memoryGb: string;
  notes: string;
}

const DEFAULT_OPTIONS: ImportOptions = {
  host: true,
  vms: true,
  specs: true,
  ips: true,
  networks: true,
  ports: true,
  vlans: true,
};

const VLAN_COLORS = [
  "#6a9bd4",
  "#6abf69",
  "#d4a13c",
  "#d46060",
  "#b574d4",
  "#4fc3d7",
];

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HYPERV_COLLECTOR_URL = "/api/imports/hyperv-collector";
const PROXMOX_COLLECTOR_URL = "/api/imports/proxmox-collector";
const AUTO_HOST_TARGET = "__auto__";

type ProviderRunbookStep = {
  title: string;
  description: string;
  command?: string;
};

type ProviderRunbookCommand = {
  label: string;
  command: string;
};

const PROVIDER_COPY: Record<
  ImportProvider,
  {
    label: string;
    schema: string;
    sourceTag: string;
    hostFallback: string;
    workloadFallback: string;
    hostNoun: string;
    workloadNoun: string;
    downloadName: string;
    downloadUrl: string;
    command: string;
    summary: string;
    runbook: {
      prerequisites: string[];
      steps: ProviderRunbookStep[];
      optionalCommands?: ProviderRunbookCommand[];
      notes: string[];
    };
  }
> = {
  hyperv: {
    label: "Hyper-V",
    schema: "rackpad.hyperv.inventory.v1",
    sourceTag: "hyper-v",
    hostFallback: "hyperv-host",
    workloadFallback: "hyperv-vm",
    hostNoun: "Hyper-V host",
    workloadNoun: "VMs",
    downloadName: "collect-hyperv.ps1",
    downloadUrl: HYPERV_COLLECTOR_URL,
    command:
      "powershell -ExecutionPolicy Bypass -File .\\collect-hyperv.ps1 -OutputPath .\\rackpad-hyperv-inventory.json -IncludeHostAdapters",
    summary:
      "Stages host, virtual switches, VMs, vNICs, VLANs, guest IPs, CPU, RAM, disk, power state, and guest OS data.",
    runbook: {
      prerequisites: [
        "Run from an elevated PowerShell session on the Hyper-V host.",
        "Use the host you want to inventory; the collector writes one JSON file for upload.",
        "Guest IP collection depends on Hyper-V integration services reporting guest network data.",
      ],
      steps: [
        {
          title: "Download the collector",
          description:
            "Use the Hyper-V Download button and save the file as collect-hyperv.ps1 on the Hyper-V host.",
        },
        {
          title: "Run the collector",
          description:
            "Run this in elevated PowerShell from the folder that contains collect-hyperv.ps1.",
          command:
            "powershell -ExecutionPolicy Bypass -File .\\collect-hyperv.ps1 -OutputPath .\\rackpad-hyperv-inventory.json -IncludeHostAdapters",
        },
        {
          title: "Upload the JSON",
          description:
            "Return to Rackpad, choose rackpad-hyperv-inventory.json, and let the importer build a review plan.",
        },
        {
          title: "Review and import",
          description:
            "Confirm the host, VMs, switches, VLANs, ports, MACs, IPs, and specs. Uncheck anything you want to skip, then select Import selected.",
        },
      ],
      notes: [
        "Rackpad stages the file first and does not write records until Import selected is pressed.",
        "Existing devices are matched by hostname or display name before Rackpad creates new records.",
      ],
    },
  },
  proxmox: {
    label: "Proxmox",
    schema: "rackpad.proxmox.inventory.v1",
    sourceTag: "proxmox",
    hostFallback: "proxmox-host",
    workloadFallback: "proxmox-guest",
    hostNoun: "Proxmox node",
    workloadNoun: "VMs / containers",
    downloadName: "collect-proxmox.sh",
    downloadUrl: PROXMOX_COLLECTOR_URL,
    command:
      "chmod +x ./collect-proxmox.sh && sudo ./collect-proxmox.sh --output ./rackpad-proxmox-inventory.json",
    summary:
      "Stages the node, Linux bridges, host adapters, QEMU VMs, LXC containers, MACs, VLAN tags/trunks, guest IPs, CPU, RAM, disks, boot flags, and Proxmox metadata.",
    runbook: {
      prerequisites: [
        "Run on each Proxmox node you want to inventory. The collector requires python3 and pvesh.",
        "Use root or a sudo-capable account with access to pvesh and pct.",
        "QEMU guest IPs require the guest agent. LXC live IPs require running containers unless static IPs are present in config.",
      ],
      steps: [
        {
          title: "Download the collector",
          description:
            "Use the Proxmox Download button, then copy collect-proxmox.sh to the Proxmox node you want to import.",
        },
        {
          title: "Run the collector",
          description:
            "Run this on the Proxmox node. It creates rackpad-proxmox-inventory.json in the current folder.",
          command:
            "chmod +x ./collect-proxmox.sh\nsudo ./collect-proxmox.sh --output ./rackpad-proxmox-inventory.json",
        },
        {
          title: "Upload the JSON",
          description:
            "Return to Rackpad, choose rackpad-proxmox-inventory.json, and review the generated import plan.",
        },
        {
          title: "Review and import",
          description:
            "Confirm the node, Linux bridges, host adapters, QEMU VMs, LXC containers, disks, MACs, VLANs, IPs, CPU, and RAM. Uncheck anything you want to skip, then select Import selected.",
        },
        {
          title: "Repeat for clusters",
          description:
            "For a Proxmox cluster, run the collector once per node and upload each JSON file to keep node, bridge, VM, and container data complete.",
        },
      ],
      optionalCommands: [
        {
          label: "Collect a specific node",
          command:
            "sudo ./collect-proxmox.sh --node pve1 --output ./rackpad-proxmox-inventory.json",
        },
        {
          label: "Skip live guest network probes",
          command:
            "sudo ./collect-proxmox.sh --no-guest-network --output ./rackpad-proxmox-inventory.json",
        },
        {
          label: "Skip host adapters",
          command:
            "sudo ./collect-proxmox.sh --no-host-adapters --output ./rackpad-proxmox-inventory.json",
        },
      ],
      notes: [
        "Rackpad imports LXC workloads as containers and QEMU workloads as VMs.",
        "If guest IPs are missing, enable the QEMU guest agent or verify that LXC network config exposes static addresses.",
        "Existing devices are matched by hostname or display name before Rackpad creates new records.",
      ],
    },
  },
};

export default function ImportView() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const virtualSwitches = useStore((s) => s.virtualSwitches);
  const vlans = useStore((s) => s.vlans);
  const subnets = useStore((s) => s.subnets);
  const ipAssignments = useStore((s) => s.ipAssignments);
  const canEdit = canEditInventory(currentUser);
  const [payload, setPayload] = useState<HyperVPayload | null>(null);
  const [hostDraft, setHostDraft] = useState<HostDraft | null>(null);
  const [vmDrafts, setVmDrafts] = useState<VmDraft[]>([]);
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const importProvider = payload ? providerForPayload(payload) : null;
  const importCopy = importProvider ? PROVIDER_COPY[importProvider] : null;

  const devicesByHostname = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.hostname.trim().toLowerCase()] = device;
      if (device.displayName) {
        acc[device.displayName.trim().toLowerCase()] = device;
      }
      return acc;
    }, {});
  }, [devices]);

  const vlanByNumber = useMemo(() => {
    return vlans.reduce<Record<number, Vlan>>((acc, vlan) => {
      acc[vlan.vlanId] = vlan;
      return acc;
    }, {});
  }, [vlans]);

  const devicesById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.id] = device;
      return acc;
    }, {});
  }, [devices]);

  const summary = useMemo(() => {
    if (!payload) return null;
    const selectedVms = vmDrafts.filter((draft) => draft.include);
    const vlanIds = new Set<number>();
    for (const draft of selectedVms) {
      for (const adapter of draft.source.networkAdapters ?? []) {
        for (const id of vlanIdsFromAdapter(adapter)) {
          vlanIds.add(id);
        }
      }
    }
    const ipCount = selectedVms.reduce(
      (sum, draft) => sum + vmIps(draft.source).length,
      0,
    );
    return {
      selectedVms: selectedVms.length,
      switches: payload.switches?.length ?? 0,
      vlanIds: [...vlanIds].sort((a, b) => a - b),
      ips: ipCount,
      existingMatches: selectedVms.filter(
        (draft) => devicesByHostname[draft.hostname.trim().toLowerCase()],
      ).length,
    };
  }, [devicesByHostname, payload, vmDrafts]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setParseError("");
    setImportLog([]);

    try {
      const parsed = JSON.parse(await file.text()) as HyperVPayload;
      if (!Array.isArray(parsed.vms)) {
        throw new Error(
          "This file does not look like a Rackpad Hyper-V or Proxmox inventory export.",
        );
      }
      const provider = providerForPayload(parsed);
      setPayload(parsed);
      setHostDraft(hostToDraft(parsed, provider));
      setVmDrafts(parsed.vms.map((vm, index) => vmToDraft(vm, index, provider)));
    } catch (error) {
      setPayload(null);
      setHostDraft(null);
      setVmDrafts([]);
      setParseError(
        error instanceof Error ? error.message : "Failed to parse JSON file.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function handleImport() {
    if (!payload || !canEdit) return;
    setImporting(true);
    setImportLog([]);

    const log: string[] = [];
    const localPortsByDeviceId = groupPortsByDevice(ports);
    const localIpKeys = new Set(
      ipAssignments.map((entry) => `${entry.subnetId}|${entry.ipAddress}`),
    );

    try {
      const hostDevice = options.host
        ? await upsertHost(payload, hostDraft, {
            devicesByHostname,
            devicesById,
            log,
          })
        : resolveHostTarget(payload, hostDraft, {
            devicesByHostname,
            devicesById,
          });

      const vlanMap = await ensureVlans({
        enabled: options.vlans,
        drafts: vmDrafts.filter((draft) => draft.include),
        existing: vlanByNumber,
        log,
      });

      const switchMap = await ensureSwitches({
        enabled: options.networks,
        payload,
        hostDevice,
        existingSwitches: virtualSwitches,
        log,
      });

      if (options.vms) {
        for (const draft of vmDrafts.filter((entry) => entry.include)) {
          const device = await upsertVmDevice({
            draft,
            hostDevice,
            devicesByHostname,
            ipAssignments,
            subnets,
            options,
            log,
          });

          if (options.ports) {
            await upsertVmPorts({
              draft,
              device,
              currentPorts: localPortsByDeviceId[device.id] ?? [],
              vlanMap,
              switchMap,
              log,
            }).then((nextPorts) => {
              localPortsByDeviceId[device.id] = nextPorts;
            });
          }

          if (options.ips) {
            await importSecondaryIps({
              draft,
              device,
              subnets,
              existingKeys: localIpKeys,
              log,
            });
          }
        }
      }

      setImportLog(log.length > 0 ? log : ["No changes were needed."]);
    } catch (error) {
      setImportLog([
        ...log,
        `Import stopped: ${error instanceof Error ? error.message : "Unknown error."}`,
      ]);
    } finally {
      setImporting(false);
    }
  }

  function setDraftValue(key: string, changes: Partial<VmDraft>) {
    setVmDrafts((current) =>
      current.map((draft) =>
        draft.key === key ? { ...draft, ...changes } : draft,
      ),
    );
  }

  function setHostDraftValue(changes: Partial<HostDraft>) {
    setHostDraft((current) => (current ? { ...current, ...changes } : current));
  }

  return (
    <>
      <TopBar
        subtitle="Import tools"
        title={t("Imports")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {lab.name} | {importCopy?.label ?? "Hyper-V / Proxmox"} importer
          </span>
        }
        actions={
          <Button
            variant="default"
            size="sm"
            disabled={!payload || importing || !canEdit}
            onClick={() => void handleImport()}
          >
            <CheckCircle2 className="size-3.5" />
            {importing ? "Importing..." : "Import selected"}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-7xl space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>Inventory collectors</CardLabel>
                <CardHeading>Upload Hyper-V or Proxmox JSON</CardHeading>
              </CardTitle>
              <Badge tone="cyan">
                <FileJson className="size-3" />
                review-first import
              </Badge>
            </CardHeader>
            <CardBody className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-tertiary)]">
                  Run a collector on the virtualization host, then upload the
                  JSON here. Rackpad stages the host, guests, virtual networks,
                  VLANs, ports, specs, MACs, and IPs before anything is written.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <CollectorDownload provider="hyperv" />
                  <CollectorDownload provider="proxmox" />
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]">
                  <Upload className="size-4" />
                  Choose import JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => void handleFile(event)}
                  />
                </label>
                {parseError && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                    {parseError}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <ImportStat
                  icon={Server}
                  label={importCopy?.workloadNoun ?? "Workloads selected"}
                  value={summary?.selectedVms ?? 0}
                  hint={`${summary?.existingMatches ?? 0} matched existing`}
                />
                <ImportStat
                  icon={Network}
                  label="Virtual switches"
                  value={summary?.switches ?? 0}
                  hint="external, internal, private"
                />
                <ImportStat
                  icon={HardDrive}
                  label="Guest IPs"
                  value={summary?.ips ?? 0}
                  hint="only matched subnets become IPAM records"
                />
                <ImportStat
                  icon={FileJson}
                  label="VLAN IDs"
                  value={summary?.vlanIds.length ?? 0}
                  hint={summary?.vlanIds.slice(0, 5).join(", ") || "none found"}
                />
              </div>
            </CardBody>
          </Card>

          <CollectorRunbooks />

          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>Import categories</CardLabel>
                <CardHeading>Select what Rackpad should write</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {Object.entries(CATEGORY_COPY).map(([key, copy]) => (
                  <label
                    key={key}
                    className="rk-panel-inset flex items-start gap-3 rounded-[var(--radius-md)] p-3"
                  >
                    <input
                      type="checkbox"
                      checked={options[key as keyof ImportOptions]}
                      onChange={(event) =>
                        setOptions((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium text-[var(--text-primary)]">
                        {copy.title}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--text-tertiary)]">
                        {copy.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </CardBody>
          </Card>

          {payload && (
            <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
              <HostPreview
                devices={devices}
                devicesByHostname={devicesByHostname}
                hostRecordEnabled={options.host}
                onChange={setHostDraftValue}
                payload={payload}
                value={hostDraft}
              />
              <VmPreview
                drafts={vmDrafts}
                devicesByHostname={devicesByHostname}
                ipAssignments={ipAssignments}
                subnets={subnets}
                onChange={setDraftValue}
              />
            </div>
          )}

          {importLog.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>Import log</CardLabel>
                  <CardHeading>What Rackpad changed</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="space-y-2">
                  {importLog.map((entry, index) => (
                    <div
                      key={`${entry}-${index}`}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                    >
                      {entry}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const CATEGORY_COPY: Record<
  keyof ImportOptions,
  { title: string; description: string }
> = {
  host: {
    title: "Host record",
    description: "Create or update the virtualization host as a server device.",
  },
  vms: {
    title: "Workloads",
    description: "Create or update selected VM and container records.",
  },
  specs: {
    title: "CPU, RAM, disks, OS",
    description: "Import CPU cores, memory, storage, guest OS, and spec notes.",
  },
  ips: {
    title: "IPs",
    description:
      "Set management IPs and create IPAM records for known subnets.",
  },
  networks: {
    title: "Virtual switches",
    description: "Create Hyper-V switches or Proxmox bridge records.",
  },
  ports: {
    title: "Virtual ports",
    description: "Create guest NIC ports with switch and VLAN metadata.",
  },
  vlans: {
    title: "VLANs",
    description: "Create missing VLAN records referenced by guest adapters.",
  },
};

function CollectorRunbooks() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>Collector runbook</CardLabel>
          <CardHeading>Exact steps before importing</CardHeading>
        </CardTitle>
        <Badge tone="ok">
          <CheckCircle2 className="size-3" />
          beta guide
        </Badge>
      </CardHeader>
      <CardBody>
        <div className="grid gap-4 lg:grid-cols-2">
          {(["hyperv", "proxmox"] as const).map((provider) => (
            <ProviderRunbook key={provider} provider={provider} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function ProviderRunbook({ provider }: { provider: ImportProvider }) {
  const copy = PROVIDER_COPY[provider];
  return (
    <section className="rk-panel-inset rounded-[var(--radius-md)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {copy.label}
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {copy.downloadName} - {copy.schema}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a
            href={copy.downloadUrl}
            download={copy.downloadName}
            target="_blank"
            rel="noreferrer"
          >
            <DownloadCloud className="size-3.5" />
            Download
          </a>
        </Button>
      </div>

      <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.015)] p-3">
        <div className="rk-kicker">Before you run it</div>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-[var(--text-tertiary)]">
          {copy.runbook.prerequisites.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--accent-secondary)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <ol className="mt-4 space-y-3">
        {copy.runbook.steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-2)] font-mono text-[10px] text-[var(--text-secondary)]">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-[var(--text-primary)]">
                {step.title}
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">
                {step.description}
              </p>
              {step.command && (
                <pre className="mt-2 overflow-x-auto rounded-[var(--radius-sm)] bg-[rgb(0_0_0_/_0.22)] p-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                  {step.command}
                </pre>
              )}
            </div>
          </li>
        ))}
      </ol>

      {copy.runbook.optionalCommands?.length ? (
        <div className="mt-4 space-y-2">
          <div className="rk-kicker">Optional commands</div>
          {copy.runbook.optionalCommands.map((entry) => (
            <div key={entry.label}>
              <div className="text-[11px] font-medium text-[var(--text-secondary)]">
                {entry.label}
              </div>
              <pre className="mt-1 overflow-x-auto rounded-[var(--radius-sm)] bg-[rgb(0_0_0_/_0.22)] p-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                {entry.command}
              </pre>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.015)] p-3">
        <div className="rk-kicker">Import notes</div>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-[var(--text-tertiary)]">
          {copy.runbook.notes.map((item) => (
            <li key={item} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HostPreview({
  devices,
  devicesByHostname,
  hostRecordEnabled,
  onChange,
  payload,
  value,
}: {
  devices: Device[];
  devicesByHostname: Record<string, Device>;
  hostRecordEnabled: boolean;
  onChange: (changes: Partial<HostDraft>) => void;
  payload: HyperVPayload;
  value: HostDraft | null;
}) {
  const provider = providerForPayload(payload);
  const copy = PROVIDER_COPY[provider];
  const host = payload.host;
  const matched = findExistingHost(payload, devicesByHostname);
  const selected =
    value?.targetDeviceId && value.targetDeviceId !== AUTO_HOST_TARGET
      ? devices.find((device) => device.id === value.targetDeviceId)
      : null;
  const hostCandidates = devices.filter(
    (device) => !isWorkloadDeviceType(device.deviceType),
  );
  const targetLabel = selected
    ? `Selected existing: ${selected.hostname}`
    : matched
      ? `Auto-matched: ${matched.hostname}`
      : `Will create a new ${copy.hostNoun}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>Host</CardLabel>
          <CardHeading>
            {value?.displayName || host?.computerName || `Unknown ${copy.hostNoun}`}
          </CardHeading>
        </CardTitle>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge tone={selected || matched ? "ok" : "info"}>
            {targetLabel}
          </Badge>
          <Badge>{payload.schema ?? "unknown schema"}</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <Field label="Import VMs under">
          <select
            className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--focus-ring)]"
            value={value?.targetDeviceId ?? AUTO_HOST_TARGET}
            onChange={(event) =>
              onChange({ targetDeviceId: event.target.value })
            }
          >
            <option value={AUTO_HOST_TARGET}>
              Auto match or create {host?.computerName ?? copy.hostNoun}
            </option>
            {hostCandidates.map((device) => (
              <option key={device.id} value={device.id}>
                {device.hostname} ({device.deviceType})
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] leading-5 text-[var(--text-tertiary)]">
            {hostRecordEnabled
              ? "Host record is enabled, so Rackpad will create/update the target below."
              : "Host record is disabled, so this target is only used as the VM parent."}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hostname">
            <Input
              disabled={!hostRecordEnabled}
              value={value?.hostname ?? ""}
              onChange={(event) => onChange({ hostname: event.target.value })}
            />
          </Field>
          <Field label="Display name">
            <Input
              disabled={!hostRecordEnabled}
              value={value?.displayName ?? ""}
              onChange={(event) =>
                onChange({ displayName: event.target.value })
              }
            />
          </Field>
          <Field label="Manufacturer">
            <Input
              disabled={!hostRecordEnabled}
              value={value?.manufacturer ?? ""}
              onChange={(event) =>
                onChange({ manufacturer: event.target.value })
              }
            />
          </Field>
          <Field label="Model">
            <Input
              disabled={!hostRecordEnabled}
              value={value?.model ?? ""}
              onChange={(event) => onChange({ model: event.target.value })}
            />
          </Field>
          <Field label="OS">
            <Input
              disabled={!hostRecordEnabled}
              value={value?.osName ?? ""}
              onChange={(event) => onChange({ osName: event.target.value })}
            />
          </Field>
          <Field label="OS version">
            <Input
              disabled={!hostRecordEnabled}
              value={value?.osVersion ?? ""}
              onChange={(event) => onChange({ osVersion: event.target.value })}
            />
          </Field>
          <Field label="CPU cores">
            <Input
              disabled={!hostRecordEnabled}
              type="number"
              value={value?.cpuCores ?? ""}
              onChange={(event) => onChange({ cpuCores: event.target.value })}
            />
          </Field>
          <Field label="Memory GB">
            <Input
              disabled={!hostRecordEnabled}
              type="number"
              value={value?.memoryGb ?? ""}
              onChange={(event) => onChange({ memoryGb: event.target.value })}
            />
          </Field>
        </div>

        <Field label="Notes / missing info">
          <textarea
            className="min-h-20 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!hostRecordEnabled}
            value={value?.notes ?? ""}
            onChange={(event) => onChange({ notes: event.target.value })}
          />
        </Field>

        <InfoRow label="Collected FQDN" value={host?.fqdn} />
        {provider === "proxmox" && (
          <>
            <InfoRow label="Proxmox node" value={host?.nodeName} />
            <InfoRow label="Proxmox version" value={host?.pveVersion} />
          </>
        )}
        <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
          <div className="rk-kicker">Switches</div>
          <div className="mt-2 space-y-2">
            {(payload.switches ?? []).map((entry) => (
              <div
                key={entry.id ?? entry.name}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="truncate text-[var(--text-primary)]">
                  {entry.name}
                </span>
                <Badge tone="info">{mapSwitchKind(entry.kind)}</Badge>
              </div>
            ))}
            {(payload.switches ?? []).length === 0 && (
              <div className="text-xs text-[var(--text-tertiary)]">
                No virtual switches found.
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function VmPreview({
  drafts,
  devicesByHostname,
  ipAssignments,
  subnets,
  onChange,
}: {
  drafts: VmDraft[];
  devicesByHostname: Record<string, Device>;
  ipAssignments: IpAssignment[];
  subnets: Subnet[];
  onChange: (key: string, changes: Partial<VmDraft>) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>Wizard</CardLabel>
          <CardHeading>Review workloads before import</CardHeading>
        </CardTitle>
        <Badge tone="accent">
          {drafts.filter((draft) => draft.include).length} selected
        </Badge>
      </CardHeader>
      <CardBody className="max-h-[720px] space-y-3 overflow-y-auto">
        {drafts.map((draft) => {
          const existing =
            devicesByHostname[draft.hostname.trim().toLowerCase()];
          const ipKnown = draft.managementIp
            ? Boolean(findSubnetForIp(subnets, draft.managementIp))
            : true;
          const ipConflict = draft.managementIp
            ? findIpAssignment(subnets, ipAssignments, draft.managementIp)
            : undefined;
          const guest = getVmGuestInfo(draft.source);
          const conflictBelongsToDevice =
            existing &&
            ipConflict &&
            (ipConflict.deviceId === existing.id ||
              ipConflict.vmId === existing.id ||
              ipConflict.containerId === existing.id);
          const osFamily =
            draft.osFamily || inferGuestOsFamily(draft.osName, guest.osVersion);
          const workloadLabel = workloadTypeLabel(draft.source);
          return (
            <div
              key={draft.key}
              className={cn(
                "rounded-[var(--radius-lg)] border bg-[var(--surface-1)] p-3",
                draft.include
                  ? "border-[var(--border-default)]"
                  : "border-[var(--border-subtle)] opacity-65",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={draft.include}
                    onChange={(event) =>
                      onChange(draft.key, { include: event.target.checked })
                    }
                  />
                  {draft.source.name ?? draft.hostname}
                </label>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="info">{workloadLabel}</Badge>
                  <Badge tone={existing ? "warn" : "ok"}>
                    {existing ? "will update" : "new"}
                  </Badge>
                  <Badge tone={vmStateTone(draft.source.state)}>
                    {draft.source.state ?? "unknown"}
                  </Badge>
                  {draft.osName && (
                    <Badge tone={guestOsTone(osFamily)}>
                      {guestOsLabel(osFamily)}
                    </Badge>
                  )}
                  {!ipKnown && <Badge tone="warn">IP not in IPAM</Badge>}
                  {ipConflict && !conflictBelongsToDevice && (
                    <Badge tone="err">IP conflict</Badge>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <Field label="Hostname">
                  <Input
                    value={draft.hostname}
                    onChange={(event) =>
                      onChange(draft.key, { hostname: event.target.value })
                    }
                  />
                </Field>
                <Field label="Display name">
                  <Input
                    value={draft.displayName}
                    onChange={(event) =>
                      onChange(draft.key, { displayName: event.target.value })
                    }
                  />
                </Field>
                <Field label="Primary IP">
                  <Input
                    value={draft.managementIp}
                    placeholder="Add manually if missing"
                    onChange={(event) =>
                      onChange(draft.key, { managementIp: event.target.value })
                    }
                  />
                </Field>
                <Field label="Guest OS">
                  <Input
                    value={draft.osName}
                    placeholder="Windows Server, Ubuntu, Debian..."
                    onChange={(event) =>
                      onChange(draft.key, {
                        osName: event.target.value,
                        osFamily: inferGuestOsFamily(
                          event.target.value,
                          guest.osVersion,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="OS family">
                  <select
                    value={draft.osFamily}
                    onChange={(event) =>
                      onChange(draft.key, { osFamily: event.target.value })
                    }
                    className="rk-control h-10 w-full px-3 text-sm text-[var(--text-primary)]"
                  >
                    <option value="">Auto / unknown</option>
                    <option value="windows">Windows</option>
                    <option value="linux">Linux</option>
                    <option value="bsd">BSD / firewall appliance</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="CPU">
                    <Input
                      value={draft.cpuCores}
                      onChange={(event) =>
                        onChange(draft.key, { cpuCores: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="RAM GB">
                    <Input
                      value={draft.memoryGb}
                      onChange={(event) =>
                        onChange(draft.key, { memoryGb: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Disk GB">
                    <Input
                      value={draft.storageGb}
                      onChange={(event) =>
                        onChange(draft.key, { storageGb: event.target.value })
                      }
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_0.8fr]">
                <Field label="Notes / missing info">
                  <textarea
                    value={draft.notes}
                    onChange={(event) =>
                      onChange(draft.key, { notes: event.target.value })
                    }
                    className="rk-control min-h-20 w-full px-3 py-2 text-sm text-[var(--text-primary)]"
                  />
                </Field>
                <div className="rk-panel-inset rounded-[var(--radius-md)] p-3 text-xs">
                  <div className="rk-kicker">Adapters</div>
                  <div className="mt-2 space-y-2">
                    {(draft.source.networkAdapters ?? []).map((adapter) => (
                      <div
                        key={adapter.id ?? adapter.name}
                        className="rounded-[var(--radius-sm)] bg-[rgb(0_0_0_/_0.16)] px-2 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[var(--text-primary)]">
                            {adapter.name ?? "Network adapter"}
                          </span>
                          <Mono>{adapter.switchName ?? "no switch"}</Mono>
                        </div>
                        <div className="mt-1 text-[var(--text-tertiary)]">
                          {vlanSummary(adapter)} |{" "}
                          {normalizeStringList(adapter.ipAddresses).join(
                            ", ",
                          ) || "no IPs"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="rk-kicker mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value?: string | number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-3 py-2 text-xs">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className="text-right text-[var(--text-primary)]">
        {value || "-"}
      </span>
    </div>
  );
}

function ImportStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Server;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="rk-kicker">{label}</div>
          <div className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
            {value}
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {hint}
          </div>
        </div>
        <Icon className="size-4 text-[var(--accent-secondary)]" />
      </div>
    </div>
  );
}

function CollectorDownload({ provider }: { provider: ImportProvider }) {
  const copy = PROVIDER_COPY[provider];
  return (
    <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {copy.label}
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {copy.schema}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <a
            href={copy.downloadUrl}
            download={copy.downloadName}
            target="_blank"
            rel="noreferrer"
          >
            <DownloadCloud className="size-3.5" />
            Download
          </a>
        </Button>
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--text-tertiary)]">
        {copy.summary}
      </p>
      <pre className="mt-3 overflow-x-auto rounded-[var(--radius-sm)] bg-[rgb(0_0_0_/_0.22)] p-3 font-mono text-[11px] text-[var(--text-secondary)]">
        {copy.command}
      </pre>
    </div>
  );
}

function vmToDraft(
  vm: HyperVVm,
  index: number,
  provider: ImportProvider = providerForWorkload(vm),
): VmDraft {
  const ips = vmIps(vm);
  const guest = getVmGuestInfo(vm);
  const osName = deriveGuestOsName(vm);
  const fallback = PROVIDER_COPY[provider].workloadFallback;
  return {
    key: vm.id || vm.name || `vm-${index}`,
    source: vm,
    include: true,
    hostname: slugHost(vm.name || `${fallback}-${index + 1}`, fallback),
    displayName: vm.name || "",
    managementIp: ips[0] ?? "",
    osFamily: inferGuestOsFamily(osName, guest.osVersion),
    osName,
    cpuCores: vm.processorCount ? String(vm.processorCount) : "",
    memoryGb: formatOptionalNumber(workloadAllocatedMemoryGb(vm)),
    storageGb: vm.storageGb ? String(vm.storageGb) : "",
    notes: vm.notes ?? "",
  };
}

function hostToDraft(
  payload: HyperVPayload,
  provider: ImportProvider = providerForPayload(payload),
): HostDraft {
  const host = payload.host;
  const fallback = PROVIDER_COPY[provider].hostFallback;
  const hostname = slugHost(host?.computerName || host?.fqdn || fallback, fallback);

  return {
    targetDeviceId: AUTO_HOST_TARGET,
    hostname,
    displayName: host?.computerName || hostname,
    manufacturer: host?.manufacturer ?? "",
    model: host?.model ?? "",
    osName: host?.osCaption ?? "",
    osVersion: host?.osVersion ?? "",
    cpuCores: host?.logicalProcessors ? String(host.logicalProcessors) : "",
    memoryGb: host?.memoryGb ? String(host.memoryGb) : "",
    notes: "",
  };
}

function providerForPayload(payload?: HyperVPayload | null): ImportProvider {
  const text = `${payload?.provider ?? ""} ${payload?.schema ?? ""}`.toLowerCase();
  return text.includes("proxmox") ? "proxmox" : "hyperv";
}

function providerForWorkload(vm: HyperVVm): ImportProvider {
  const text = `${vm.kind ?? ""} ${vm.vmType ?? ""} ${vm.id ?? ""}`.toLowerCase();
  return text.includes("lxc") || text.includes("qemu") ? "proxmox" : "hyperv";
}

function isContainerWorkload(vm: HyperVVm) {
  const text = `${vm.kind ?? ""} ${vm.vmType ?? ""}`.toLowerCase();
  return text.includes("lxc") || text.includes("container");
}

function isWorkloadDeviceType(deviceType: string) {
  const value = deviceType.toLowerCase();
  return value === "vm" || value === "container";
}

function workloadTypeLabel(vm: HyperVVm) {
  if (isContainerWorkload(vm)) return "LXC container";
  const type = `${vm.kind ?? vm.vmType ?? ""}`.toLowerCase();
  if (type.includes("qemu")) return "QEMU VM";
  return "VM";
}

function workloadAllocatedMemoryGb(vm: HyperVVm) {
  const provider = providerForWorkload(vm);
  if (provider === "proxmox") {
    return vm.memoryStartupGb ?? vm.memoryAssignedGb ?? null;
  }
  return vm.memoryAssignedGb ?? vm.memoryStartupGb ?? null;
}

function findExistingHost(
  payload: HyperVPayload,
  devicesByHostname: Record<string, Device>,
) {
  const host = payload.host;
  const keys = [host?.computerName, host?.fqdn, host?.nodeName]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  for (const key of keys) {
    const match = devicesByHostname[key] ?? devicesByHostname[slugHost(key)];
    if (match) return match;
  }
  return null;
}

function resolveHostTarget(
  payload: HyperVPayload,
  draft: HostDraft | null,
  context: {
    devicesByHostname: Record<string, Device>;
    devicesById: Record<string, Device>;
  },
) {
  if (draft?.targetDeviceId && draft.targetDeviceId !== AUTO_HOST_TARGET) {
    return context.devicesById[draft.targetDeviceId] ?? null;
  }
  return findExistingHost(payload, context.devicesByHostname);
}

function hostSpecs(host: HyperVHost | undefined, draft: HostDraft) {
  return [
    draft.osName.trim()
      ? `OS: ${draft.osName.trim()} ${draft.osVersion.trim()}`.trim()
      : "",
    draft.cpuCores.trim() ? `Logical processors: ${draft.cpuCores.trim()}` : "",
    draft.memoryGb.trim() ? `Memory: ${draft.memoryGb.trim()} GB` : "",
    host?.fqdn ? `FQDN: ${host.fqdn}` : "",
    host?.nodeName ? `Proxmox node: ${host.nodeName}` : "",
    host?.pveVersion ? `Proxmox version: ${host.pveVersion}` : "",
    host?.kernelVersion ? `Kernel: ${host.kernelVersion}` : "",
    host?.hostIpAddresses?.length
      ? `Host IPs: ${host.hostIpAddresses.join(", ")}`
      : "",
    host?.statusError ? `Collector status warning: ${host.statusError}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function upsertHost(
  payload: HyperVPayload,
  draft: HostDraft | null,
  context: {
    devicesByHostname: Record<string, Device>;
    devicesById: Record<string, Device>;
    log: string[];
  },
) {
  const provider = providerForPayload(payload);
  const copy = PROVIDER_COPY[provider];
  const host = payload.host;
  const sourceDraft = draft ?? hostToDraft(payload, provider);
  const hostname = slugHost(
    sourceDraft.hostname || host?.computerName || host?.fqdn || copy.hostFallback,
    copy.hostFallback,
  );
  const selected =
    sourceDraft.targetDeviceId !== AUTO_HOST_TARGET
      ? context.devicesById[sourceDraft.targetDeviceId]
      : null;
  const existing =
    selected ?? context.devicesByHostname[hostname.toLowerCase()];
  const specs = hostSpecs(host, sourceDraft);

  if (existing) {
    const updated = await updateDevice(existing.id, {
      hostname,
      deviceType: "server",
      displayName:
        sourceDraft.displayName.trim() || existing.displayName || hostname,
      manufacturer: sourceDraft.manufacturer.trim() || existing.manufacturer,
      model: sourceDraft.model.trim() || existing.model,
      placement: existing.placement ?? "room",
      cpuCores: toNumber(sourceDraft.cpuCores) ?? existing.cpuCores,
      memoryGb: toNumber(sourceDraft.memoryGb) ?? existing.memoryGb,
      specs: mergeText(existing.specs, specs),
      tags: mergeTags(existing.tags, [copy.sourceTag, "imported"]),
      notes: mergeText(existing.notes, sourceDraft.notes),
    });
    context.log.push(`Updated ${copy.hostNoun} ${updated?.hostname ?? hostname}.`);
    return updated ?? existing;
  }

  const created = await createDevice({
    hostname,
    displayName: sourceDraft.displayName.trim() || hostname,
    deviceType: "server",
    manufacturer: sourceDraft.manufacturer.trim(),
    model: sourceDraft.model.trim(),
    status: "unknown",
    placement: "room",
    cpuCores: toNumber(sourceDraft.cpuCores),
    memoryGb: toNumber(sourceDraft.memoryGb),
    specs,
    tags: [copy.sourceTag, "imported"],
    notes: mergeText(
      `Imported from ${copy.label} inventory collector.`,
      sourceDraft.notes,
    ),
  });
  context.log.push(`Created ${copy.hostNoun} ${created.hostname}.`);
  return created;
}

async function ensureVlans({
  enabled,
  drafts,
  existing,
  log,
}: {
  enabled: boolean;
  drafts: VmDraft[];
  existing: Record<number, Vlan>;
  log: string[];
}) {
  const map = { ...existing };
  if (!enabled) return map;

  const ids = new Set<number>();
  for (const draft of drafts) {
    for (const adapter of draft.source.networkAdapters ?? []) {
      for (const id of vlanIdsFromAdapter(adapter)) {
        ids.add(id);
      }
    }
  }

  for (const vlanId of [...ids].sort((a, b) => a - b)) {
    if (map[vlanId]) continue;
    const vlan = await createVlanRecord({
      vlanId,
      name: `VLAN ${vlanId}`,
      description: "Imported from virtualization guest NIC configuration.",
      color: VLAN_COLORS[vlanId % VLAN_COLORS.length],
    });
    map[vlanId] = vlan;
    log.push(`Created VLAN ${vlanId}.`);
  }
  return map;
}

async function ensureSwitches({
  enabled,
  payload,
  hostDevice,
  existingSwitches,
  log,
}: {
  enabled: boolean;
  payload: HyperVPayload;
  hostDevice: Device | null;
  existingSwitches: VirtualSwitch[];
  log: string[];
}) {
  const map: Record<string, VirtualSwitch> = {};
  if (!hostDevice) return map;
  for (const entry of existingSwitches.filter(
    (item) => item.hostDeviceId === hostDevice.id,
  )) {
    map[entry.name.toLowerCase()] = entry;
  }
  if (!enabled) return map;

  for (const entry of payload.switches ?? []) {
    const name = entry.name?.trim();
    if (!name) continue;
    const existing = map[name.toLowerCase()];
    const notes = [
      entry.notes,
      entry.netAdapterName ? `Host adapter: ${entry.netAdapterName}` : "",
      entry.netAdapterInterfaceDescription
        ? `Adapter description: ${entry.netAdapterInterfaceDescription}`
        : "",
      entry.allowManagementOS != null
        ? `Allow management OS: ${entry.allowManagementOS}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (existing) {
      const updated = await updateVirtualSwitchRecord(existing.id, {
        kind: mapSwitchKind(entry.kind),
        notes,
      });
      map[name.toLowerCase()] = updated ?? existing;
      log.push(`Updated virtual switch ${name}.`);
    } else {
      const created = await createVirtualSwitchRecord({
        hostDeviceId: hostDevice.id,
        name,
        kind: mapSwitchKind(entry.kind),
        notes,
      });
      map[name.toLowerCase()] = created;
      log.push(`Created virtual switch ${name}.`);
    }
  }
  return map;
}

async function upsertVmDevice({
  draft,
  hostDevice,
  devicesByHostname,
  ipAssignments,
  subnets,
  options,
  log,
}: {
  draft: VmDraft;
  hostDevice: Device | null;
  devicesByHostname: Record<string, Device>;
  ipAssignments: IpAssignment[];
  subnets: Subnet[];
  options: ImportOptions;
  log: string[];
}) {
  const provider = providerForWorkload(draft.source);
  const copy = PROVIDER_COPY[provider];
  const isContainer = isContainerWorkload(draft.source);
  const workloadLabel = isContainer ? "container" : "VM";
  const hostname = slugHost(
    draft.hostname ||
      draft.source.name ||
      (isContainer ? "proxmox-container" : copy.workloadFallback),
    copy.workloadFallback,
  );
  const existing = devicesByHostname[hostname.toLowerCase()];
  const candidateManagementIp =
    options.ips &&
    draft.managementIp &&
    findSubnetForIp(subnets, draft.managementIp)
      ? draft.managementIp.trim()
      : undefined;
  const managementIpConflict = candidateManagementIp
    ? findIpAssignment(subnets, ipAssignments, candidateManagementIp)
    : undefined;
  const managementIp =
    candidateManagementIp &&
    (!managementIpConflict ||
      managementIpConflict.deviceId === existing?.id ||
      managementIpConflict.vmId === existing?.id ||
      managementIpConflict.containerId === existing?.id)
      ? candidateManagementIp
      : undefined;
  const sourceIps = vmIps(draft.source);
  const guest = getVmGuestInfo(draft.source);
  const osName = draft.osName.trim();
  const osFamily =
    draft.osFamily || inferGuestOsFamily(osName, guest.osVersion);
  const importedTags = [
    copy.sourceTag,
    "imported",
    isContainer ? "container" : "vm",
    draft.source.kind || draft.source.vmType || "",
    osFamily ? `os:${osFamily}` : "",
    ...normalizeStringList(draft.source.tags),
  ].filter(Boolean);
  const specs = options.specs ? vmSpecs(draft.source, draft) : "";
  const macAddress = (draft.source.networkAdapters ?? [])
    .map((adapter) => adapter.macAddress?.trim())
    .find(Boolean);
  const notes = [
    draft.notes,
    sourceIps.length > 0 ? `Collected IPs: ${sourceIps.join(", ")}` : "",
    !osName && guest.error ? `Guest OS not reported: ${guest.error}` : "",
    candidateManagementIp && !managementIp
      ? `Primary IP ${candidateManagementIp} was skipped because it is already assigned in IPAM.`
      : "",
    draft.source.id ? `${copy.label} ID: ${draft.source.id}` : "",
    draft.source.vmid ? `Proxmox VMID: ${draft.source.vmid}` : "",
    draft.source.node ? `Proxmox node: ${draft.source.node}` : "",
    draft.source.collectorErrors?.length
      ? `Collector warnings: ${draft.source.collectorErrors.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const patch = {
    hostname,
    displayName: draft.displayName.trim() || draft.source.name || hostname,
    deviceType: isContainer ? "container" : ("vm" as const),
    status: mapVmStatus(draft.source.state),
    placement: "virtual" as const,
    parentDeviceId: hostDevice?.id,
    managementIp,
    macAddress,
    model: osName || existing?.model,
    cpuCores: options.specs ? toNumber(draft.cpuCores) : undefined,
    memoryGb: options.specs ? toNumber(draft.memoryGb) : undefined,
    storageGb: options.specs ? toNumber(draft.storageGb) : undefined,
    specs,
    tags: importedTags,
    notes,
  };

  if (existing) {
    const updated = await updateDevice(existing.id, {
      ...patch,
      specs: mergeText(existing.specs, specs),
      notes: mergeText(existing.notes, notes),
      tags: mergeTags(existing.tags, patch.tags),
    });
    log.push(`Updated ${workloadLabel} ${updated?.hostname ?? existing.hostname}.`);
    if (candidateManagementIp && !managementIp) {
      log.push(
        `Skipped primary IP ${candidateManagementIp} for ${hostname}; IPAM already has that address.`,
      );
    }
    return updated ?? existing;
  }

  const created = await createDevice(patch);
  log.push(`Created ${workloadLabel} ${created.hostname}.`);
  if (candidateManagementIp && !managementIp) {
    log.push(
      `Skipped primary IP ${candidateManagementIp} for ${hostname}; IPAM already has that address.`,
    );
  }
  return created;
}

async function upsertVmPorts({
  draft,
  device,
  currentPorts,
  vlanMap,
  switchMap,
  log,
}: {
  draft: VmDraft;
  device: Device;
  currentPorts: Port[];
  vlanMap: Record<number, Vlan>;
  switchMap: Record<string, VirtualSwitch>;
  log: string[];
}) {
  const nextPorts = [...currentPorts];
  for (const [index, adapter] of (
    draft.source.networkAdapters ?? []
  ).entries()) {
    const name = adapter.name?.trim() || `vNIC ${index + 1}`;
    const existing = nextPorts.find(
      (port) => port.name.trim().toLowerCase() === name.toLowerCase(),
    );
    const vlan = portVlanConfig(adapter, vlanMap);
    const virtualSwitch = adapter.switchName
      ? switchMap[adapter.switchName.toLowerCase()]
      : undefined;
    const changes = {
      name,
      kind: "virtual" as const,
      speed: "virtual",
      linkState:
        adapter.connected === false ? ("down" as const) : ("up" as const),
      mode: vlan.mode,
      vlanId: vlan.nativeVlanId,
      allowedVlanIds: vlan.allowedVlanIds,
      virtualSwitchId: virtualSwitch?.id ?? null,
      description: [
        adapter.switchName ? `Switch: ${adapter.switchName}` : "",
        adapter.macAddress ? `MAC: ${adapter.macAddress}` : "",
        vlan.description,
      ]
        .filter(Boolean)
        .join(" | "),
      face: "front" as const,
    };

    if (existing) {
      const updated = await updatePort(existing.id, changes);
      if (updated) {
        nextPorts.splice(nextPorts.indexOf(existing), 1, updated);
        log.push(`Updated virtual port ${device.hostname}:${updated.name}.`);
      }
    } else {
      const created = await createPortRecord({
        deviceId: device.id,
        position: nextPortPosition(nextPorts),
        ...changes,
      });
      nextPorts.push(created);
      log.push(`Created virtual port ${device.hostname}:${created.name}.`);
    }
  }
  return nextPorts;
}

async function importSecondaryIps({
  draft,
  device,
  subnets,
  existingKeys,
  log,
}: {
  draft: VmDraft;
  device: Device;
  subnets: Subnet[];
  existingKeys: Set<string>;
  log: string[];
}) {
  const isContainer = isContainerWorkload(draft.source);
  const provider = providerForWorkload(draft.source);
  const candidateIps = new Set(vmIps(draft.source));
  if (draft.managementIp) candidateIps.add(draft.managementIp.trim());
  if (device.managementIp) candidateIps.delete(device.managementIp);

  for (const ipAddress of candidateIps) {
    const subnet = findSubnetForIp(subnets, ipAddress);
    if (!subnet) continue;
    const key = `${subnet.id}|${ipAddress}`;
    if (existingKeys.has(key)) continue;
    const created = await createIpAssignmentRecord({
      subnetId: subnet.id,
      ipAddress,
      assignmentType: isContainer ? "container" : "vm",
      deviceId: device.id,
      vmId: isContainer ? undefined : device.id,
      containerId: isContainer ? device.id : undefined,
      hostname: device.hostname,
      description: `Imported from ${PROVIDER_COPY[provider].label} guest network adapter.`,
    });
    existingKeys.add(key);
    log.push(`Imported IP ${created.ipAddress} for ${device.hostname}.`);
  }
}

function vmIps(vm: HyperVVm) {
  const ips = new Set<string>();
  for (const adapter of vm.networkAdapters ?? []) {
    for (const ip of normalizeStringList(adapter.ipAddresses)) {
      const value = ip.trim();
      if (isUsableIpv4(value)) ips.add(value);
    }
  }
  return [...ips].sort((a, b) => ipToInt(a) - ipToInt(b));
}

function vlanIdsFromAdapter(adapter: HyperVNetworkAdapter) {
  const vlan = adapter.vlan;
  if (!vlan) return [];
  const ids = [
    toVlanNumber(vlan.accessVlanId),
    toVlanNumber(vlan.nativeVlanId),
    ...parseDiscreteVlanIds(vlan.allowedVlanIds ?? []),
  ].filter((value): value is number => value != null);
  return [...new Set(ids)];
}

function portVlanConfig(
  adapter: HyperVNetworkAdapter,
  vlanMap: Record<number, Vlan>,
) {
  const vlan = adapter.vlan;
  const mode = (vlan?.mode ?? "").toLowerCase();
  const allowedIds = parseDiscreteVlanIds(vlan?.allowedVlanIds ?? []);
  const nativeVlan = toVlanNumber(vlan?.nativeVlanId);
  const accessVlan = toVlanNumber(vlan?.accessVlanId);
  const isTrunk = mode.includes("trunk") || allowedIds.length > 0;
  return {
    mode: isTrunk ? ("trunk" as const) : ("access" as const),
    nativeVlanId: isTrunk
      ? nativeVlan
        ? vlanMap[nativeVlan]?.id
        : undefined
      : accessVlan
        ? vlanMap[accessVlan]?.id
        : undefined,
    allowedVlanIds: isTrunk
      ? allowedIds
          .map((id) => vlanMap[id]?.id)
          .filter((id): id is string => Boolean(id))
      : [],
    description: vlanSummary(adapter),
  };
}

function vlanSummary(adapter: HyperVNetworkAdapter) {
  const vlan = adapter.vlan;
  if (!vlan) return "VLAN unknown";
  const allowedVlanIds = normalizeStringList(vlan.allowedVlanIds);
  const parts = [
    vlan.mode ? `mode ${vlan.mode}` : "",
    vlan.accessVlanId ? `access ${vlan.accessVlanId}` : "",
    vlan.nativeVlanId ? `native ${vlan.nativeVlanId}` : "",
    allowedVlanIds.length ? `allowed ${allowedVlanIds.join(",")}` : "",
  ].filter(Boolean);
  return parts.join(" | ") || "untagged";
}

function parseDiscreteVlanIds(values: unknown) {
  return normalizeStringList(values).flatMap((value) => {
    if (/^\d+$/.test(value)) {
      const id = Number(value);
      return id >= 1 && id <= 4094 ? [id] : [];
    }

    const rangeMatch = value.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!rangeMatch) return [];
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end > 4094 ||
      end < start
    ) {
      return [];
    }

    // Avoid creating thousands of VLAN records from broad trunk ranges like 1-4094.
    if (end - start > 64) return [];
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });
}

function normalizeStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeStringList(entry));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((entry) =>
      normalizeStringList(entry),
    );
  }
  return String(value)
    .split(/[,\n;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && entry !== "0");
}

function toVlanNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4094
    ? parsed
    : null;
}

function findSubnetForIp(subnets: Subnet[], ipAddress: string) {
  if (!isUsableIpv4(ipAddress)) return undefined;
  const ipValue = ipToInt(ipAddress);
  return subnets.find((subnet) => {
    const [networkAddress, prefixRaw] = subnet.cidr.split("/");
    const prefix = Number.parseInt(prefixRaw, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const network = ipToInt(networkAddress);
    const broadcast = network + cidrSize(subnet.cidr) - 1;
    return ipValue > network && ipValue < broadcast;
  });
}

function findIpAssignment(
  subnets: Subnet[],
  ipAssignments: IpAssignment[],
  ipAddress: string,
) {
  const subnet = findSubnetForIp(subnets, ipAddress);
  if (!subnet) return undefined;
  return ipAssignments.find(
    (assignment) =>
      assignment.subnetId === subnet.id && assignment.ipAddress === ipAddress,
  );
}

function isUsableIpv4(value: string) {
  return (
    IPV4_RE.test(value) &&
    value !== "0.0.0.0" &&
    value !== "255.255.255.255" &&
    !value.startsWith("169.254.")
  );
}

function mapSwitchKind(kind?: string): VirtualSwitch["kind"] {
  const value = (kind ?? "").toLowerCase();
  if (value.includes("internal")) return "internal";
  if (value.includes("private")) return "private";
  return "external";
}

function mapVmStatus(state?: string): DeviceStatus {
  const value = (state ?? "").toLowerCase();
  if (value === "running") return "online";
  if (value === "off" || value === "stopped") return "offline";
  if (
    value === "paused" ||
    value === "saved" ||
    value === "suspended" ||
    value === "template"
  ) {
    return "maintenance";
  }
  return "unknown";
}

function vmStateTone(state?: string) {
  const status = mapVmStatus(state);
  if (status === "online") return "ok" as const;
  if (status === "offline") return "err" as const;
  if (status === "maintenance") return "info" as const;
  return "neutral" as const;
}

function getVmGuestInfo(vm: HyperVVm) {
  return {
    kvpAvailable: vm.guest?.kvpAvailable,
    osName: vm.guest?.osName ?? vm.guestOsName ?? null,
    osVersion: vm.guest?.osVersion ?? vm.guestOsVersion ?? null,
    osBuildNumber: vm.guest?.osBuildNumber ?? null,
    computerName: vm.guest?.computerName ?? null,
    fullyQualifiedDomainName: vm.guest?.fullyQualifiedDomainName ?? null,
    integrationServicesVersion: vm.guest?.integrationServicesVersion ?? null,
    error: vm.guest?.error ?? null,
  };
}

function deriveGuestOsName(vm: HyperVVm) {
  const guest = getVmGuestInfo(vm);
  const osName = guest.osName?.trim();
  if (osName) return friendlyGuestOsName(osName, vm);
  if (isLikelyLinuxKernelVersion(guest.osVersion)) {
    return `Linux (kernel ${guest.osVersion})`;
  }
  return "";
}

function friendlyGuestOsName(value: string, vm: HyperVVm) {
  if (providerForWorkload(vm) !== "proxmox") return value;
  const normalized = value.toLowerCase();
  const proxmoxNames: Record<string, string> = {
    l24: "Linux 2.4",
    l26: "Linux",
    win11: "Windows 11",
    win10: "Windows 10",
    win8: "Windows 8",
    win7: "Windows 7",
    w2k22: "Windows Server 2022",
    w2k19: "Windows Server 2019",
    w2k16: "Windows Server 2016",
    w2k12: "Windows Server 2012",
    w2k8: "Windows Server 2008",
    wxp: "Windows XP",
    solaris: "Solaris",
    other: "Other OS",
  };
  if (normalized.startsWith("lxc ")) return value;
  return proxmoxNames[normalized] ?? value;
}

function isLikelyLinuxKernelVersion(value?: string | null) {
  const text = (value ?? "").trim();
  return /^[2-9]\.\d+(\.\d+)?([-.][A-Za-z0-9._-]+)?$/.test(text);
}

function inferGuestOsFamily(value?: string | null, version?: string | null) {
  const text = (value ?? "").toLowerCase();
  if (!text.trim()) {
    return isLikelyLinuxKernelVersion(version) ? "linux" : "";
  }
  if (text.includes("windows")) return "windows";
  if (
    text.includes("linux") ||
    text.includes("ubuntu") ||
    text.includes("debian") ||
    text.includes("centos") ||
    text.includes("fedora") ||
    text.includes("red hat") ||
    text.includes("rhel") ||
    text.includes("suse") ||
    text.includes("alma") ||
    text.includes("rocky")
  ) {
    return "linux";
  }
  if (
    text.includes("bsd") ||
    text.includes("opnsense") ||
    text.includes("pfsense") ||
    text.includes("truenas")
  ) {
    return "bsd";
  }
  return "other";
}

function guestOsLabel(family: string) {
  if (family === "windows") return "Windows";
  if (family === "linux") return "Linux";
  if (family === "bsd") return "BSD";
  if (family === "other") return "Other OS";
  return "OS unknown";
}

function guestOsTone(family: string) {
  if (family === "windows") return "info" as const;
  if (family === "linux") return "ok" as const;
  if (family === "bsd") return "accent" as const;
  if (family === "other") return "neutral" as const;
  return "warn" as const;
}

function vmSpecs(vm: HyperVVm, draft?: VmDraft) {
  const guest = getVmGuestInfo(vm);
  const osName = draft?.osName.trim() || deriveGuestOsName(vm);
  const osFamily =
    draft?.osFamily || inferGuestOsFamily(osName, guest.osVersion);
  return [
    osName ? `Guest OS: ${osName}` : "",
    osFamily ? `OS family: ${guestOsLabel(osFamily)}` : "",
    guest.osVersion ? `OS version: ${guest.osVersion}` : "",
    guest.osBuildNumber ? `OS build: ${guest.osBuildNumber}` : "",
    guest.computerName ? `Guest computer name: ${guest.computerName}` : "",
    guest.fullyQualifiedDomainName
      ? `Guest FQDN: ${guest.fullyQualifiedDomainName}`
      : "",
    guest.integrationServicesVersion
      ? `Integration services: ${guest.integrationServicesVersion}`
      : "",
    vm.kind || vm.vmType ? `Workload type: ${workloadTypeLabel(vm)}` : "",
    vm.vmid ? `Proxmox VMID: ${vm.vmid}` : "",
    vm.node ? `Proxmox node: ${vm.node}` : "",
    vm.template != null ? `Template: ${vm.template ? "yes" : "no"}` : "",
    vm.onBoot != null ? `Start on boot: ${vm.onBoot ? "yes" : "no"}` : "",
    vm.unprivileged != null
      ? `Unprivileged container: ${vm.unprivileged ? "yes" : "no"}`
      : "",
    vm.swapGb ? `Swap: ${vm.swapGb} GB` : "",
    vm.uptimeSeconds ? `Uptime: ${vm.uptimeSeconds} seconds` : "",
    normalizeStringList(vm.tags).length
      ? `Source tags: ${normalizeStringList(vm.tags).join(", ")}`
      : "",
    vm.generation ? `Generation: ${vm.generation}` : "",
    vm.version ? `Configuration version: ${vm.version}` : "",
    vm.dynamicMemoryEnabled != null
      ? `Dynamic memory: ${vm.dynamicMemoryEnabled ? "enabled" : "disabled"}`
      : "",
    workloadAllocatedMemoryGb(vm)
      ? `Memory allocation: ${workloadAllocatedMemoryGb(vm)} GB`
      : "",
    vm.memoryUsedGb ? `Memory used at collection: ${vm.memoryUsedGb} GB` : "",
    vm.disks?.length
      ? `Disks:\n${vm.disks
          .map(
            (disk) =>
              `- ${disk.path ?? "unknown"} (${disk.sizeGb ?? "unknown"} GB${disk.vhdType ? `, ${disk.vhdType}` : ""})`,
          )
          .join("\n")}`
      : "",
    vm.collectorErrors?.length
      ? `Collector warnings:\n${vm.collectorErrors
          .map((entry) => `- ${entry}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function mergeText(existing: string | undefined, imported: string) {
  if (!imported.trim()) return existing;
  if (!existing?.trim()) return imported;
  if (existing.includes(imported)) return existing;
  return `${existing}\n\n${imported}`;
}

function mergeTags(existing: string[] | undefined, imported: string[]) {
  return [...new Set([...(existing ?? []), ...imported])];
}

function groupPortsByDevice(ports: Port[]) {
  return ports.reduce<Record<string, Port[]>>((acc, port) => {
    (acc[port.deviceId] ??= []).push(port);
    return acc;
  }, {});
}

function nextPortPosition(ports: Port[]) {
  return Math.max(0, ...ports.map((port) => port.position)) + 1;
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatOptionalNumber(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function slugHost(value: string, fallback = "imported-workload") {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}
