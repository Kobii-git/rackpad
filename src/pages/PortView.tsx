import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { PortGrid } from "@/components/ports/PortGrid";
import { PortList } from "@/components/ports/PortList";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Mono } from "@/components/shared/Mono";
import { StatusDot } from "@/components/shared/StatusDot";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import {
  canEditInventory,
  createPortRecord,
  createPortTemplateRecord,
  deletePortRecord,
  deletePortTemplateRecord,
  updatePort,
  updatePortTemplateRecord,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DeviceType,
  Port,
  PortLink,
  PortTemplate,
  Vlan,
  VirtualSwitch,
} from "@/lib/types";
import { deviceTypeLabel } from "@/lib/device-types";
import { formatDeviceAddress } from "@/lib/network-labels";
import { formatPortLabel } from "@/lib/utils";
import { ArrowRight, Filter, Network, Plus, Save, Trash2 } from "lucide-react";

const NON_PORT_BEARING_TYPES = new Set<Device["deviceType"]>([
  "brush_panel",
  "blanking_panel",
  "rack_shelf",
]);

const LINK_STATES: Port["linkState"][] = ["up", "down", "disabled", "unknown"];
const PORT_KINDS: Port["kind"][] = [
  "rj45",
  "sfp",
  "sfp_plus",
  "qsfp",
  "fiber",
  "power",
  "console",
  "usb",
  "virtual",
  "wifi",
];
const PORT_MODES: NonNullable<Port["mode"]>[] = ["access", "trunk"];
type PortLinkFilter = "all" | "linked" | "unlinked" | "up" | "down";

interface PortFormState {
  name: string;
  kind: Port["kind"];
  speed: string;
  linkState: Port["linkState"];
  mode: NonNullable<Port["mode"]>;
  vlanId: string;
  allowedVlanIds: string[];
  virtualSwitchId: string;
  description: string;
  face: NonNullable<Port["face"]>;
}

interface BulkPortFormState {
  kind: Port["kind"];
  speed: string;
  linkState: Port["linkState"];
  mode: NonNullable<Port["mode"]>;
  vlanId: string;
}

const EMPTY_BULK_PORT_FORM: BulkPortFormState = {
  kind: "rj45",
  speed: "",
  linkState: "down",
  mode: "access",
  vlanId: "",
};

interface TemplatePortFormState {
  name: string;
  kind: Port["kind"];
  speed: string;
  mode: NonNullable<Port["mode"]>;
  face: NonNullable<Port["face"]>;
}

interface TemplateFormState {
  name: string;
  description: string;
  deviceTypes: DeviceType[];
  ports: TemplatePortFormState[];
}

function portToForm(port: Port): PortFormState {
  return {
    name: port.name,
    kind: port.kind,
    speed: port.speed ?? "",
    linkState: port.linkState,
    mode: port.mode ?? "access",
    vlanId: port.vlanId ?? "",
    allowedVlanIds: port.allowedVlanIds ?? [],
    virtualSwitchId: port.virtualSwitchId ?? "",
    description: port.description ?? "",
    face: port.face ?? "front",
  };
}

function templateToForm(template: PortTemplate): TemplateFormState {
  return {
    name: template.name,
    description: template.description,
    deviceTypes: template.deviceTypes,
    ports: template.ports.map((port) => ({
      name: port.name,
      kind: port.kind,
      speed: port.speed ?? "",
      mode: port.mode ?? "access",
      face: port.face ?? "front",
    })),
  };
}

function blankTemplateForm(
  deviceType: DeviceType = "switch",
): TemplateFormState {
  if (deviceType === "patch_panel") {
    return {
      name: "",
      description: "",
      deviceTypes: [deviceType],
      ports: [
        {
          name: "1",
          kind: "rj45",
          speed: "1G",
          mode: "access",
          face: "front",
        },
        {
          name: "1",
          kind: "rj45",
          speed: "1G",
          mode: "access",
          face: "rear",
        },
      ],
    };
  }

  const isVirtualWorkload =
    deviceType === "vm" || deviceType === "container";
  const defaultKind: Port["kind"] = isVirtualWorkload ? "virtual" : "rj45";
  const defaultSpeed = isVirtualWorkload ? "virtio" : "";
  return {
    name: "",
    description: "",
    deviceTypes: [deviceType],
    ports: [
      {
        name: "",
        kind: defaultKind,
        speed: defaultSpeed,
        mode: "access",
        face: "front",
      },
    ],
  };
}

function blankPortForm(device?: Device): PortFormState {
  const isVirtualDevice =
    device?.deviceType === "vm" || device?.deviceType === "container";
  return {
    name: "",
    kind: isVirtualDevice ? "virtual" : "rj45",
    speed: isVirtualDevice ? "virtio" : "",
    linkState: "down",
    mode: "access",
    vlanId: "",
    allowedVlanIds: [],
    virtualSwitchId: "",
    description: "",
    face: "front",
  };
}

function isPatchPanelTemplate(form: TemplateFormState) {
  return form.deviceTypes.includes("patch_panel");
}

function appendTemplatePorts(form: TemplateFormState): TemplateFormState {
  if (!isPatchPanelTemplate(form)) {
    return {
      ...form,
      ports: [
        ...form.ports,
        {
          name: "",
          kind: "rj45",
          speed: "",
          mode: "access",
          face: "front",
        },
      ],
    };
  }

  const nextJackNumber = String(
    form.ports.filter((port) => port.face !== "rear").length + 1,
  );

  return {
    ...form,
    ports: [
      ...form.ports,
      {
        name: nextJackNumber,
        kind: "rj45",
        speed: "1G",
        mode: "access",
        face: "front",
      },
      {
        name: nextJackNumber,
        kind: "rj45",
        speed: "1G",
        mode: "access",
        face: "rear",
      },
    ],
  };
}

export default function PortView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useStore((s) => s.currentUser);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const portLinks = useStore((s) => s.portLinks);
  const portTemplates = useStore((s) => s.portTemplates);
  const deviceTypes = useStore((s) => s.deviceTypes);
  const virtualSwitches = useStore((s) => s.virtualSwitches);
  const vlans = useStore((s) => s.vlans);
  const canEdit = canEditInventory(currentUser);
  const portBearingDevices = useMemo(
    () =>
      devices.filter(
        (device) => !NON_PORT_BEARING_TYPES.has(device.deviceType),
      ),
    [devices],
  );
  const portDeviceTypeOptions = useMemo(
    () =>
      deviceTypes.filter(
        (deviceType) => !NON_PORT_BEARING_TYPES.has(deviceType.id),
      ),
    [deviceTypes],
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [selectedPortId, setSelectedPortId] = useState<string | undefined>();
  const [selectedPortIds, setSelectedPortIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkPortFields, setBulkPortFields] = useState<
    Set<keyof BulkPortFormState>
  >(new Set());
  const [bulkPortForm, setBulkPortForm] = useState<BulkPortFormState>(
    EMPTY_BULK_PORT_FORM,
  );
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [form, setForm] = useState<PortFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [deviceQuery, setDeviceQuery] = useState("");
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<DeviceType | "all">(
    "all",
  );
  const [portLinkFilter, setPortLinkFilter] = useState<PortLinkFilter>("all");
  const [portQuery, setPortQuery] = useState("");

  const [selectedTemplateId, setSelectedTemplateId] = useState<
    string | undefined
  >();
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [templateForm, setTemplateForm] =
    useState<TemplateFormState>(blankTemplateForm());
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateDeleting, setTemplateDeleting] = useState(false);
  const [templateError, setTemplateError] = useState("");

  const deviceById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.id] = device;
      return acc;
    }, {});
  }, [devices]);
  const vlanById = useMemo(() => {
    return vlans.reduce<Record<string, (typeof vlans)[number]>>((acc, vlan) => {
      acc[vlan.id] = vlan;
      return acc;
    }, {});
  }, [vlans]);

  const portsByDeviceId = useMemo(() => {
    return ports.reduce<Record<string, Port[]>>((acc, port) => {
      (acc[port.deviceId] ??= []).push(port);
      return acc;
    }, {});
  }, [ports]);

  const virtualSwitchById = useMemo(() => {
    return virtualSwitches.reduce<
      Record<string, (typeof virtualSwitches)[number]>
    >((acc, virtualSwitch) => {
      acc[virtualSwitch.id] = virtualSwitch;
      return acc;
    }, {});
  }, [virtualSwitches]);

  const portById = useMemo(() => {
    return ports.reduce<Record<string, Port>>((acc, port) => {
      acc[port.id] = port;
      return acc;
    }, {});
  }, [ports]);

  const linkByPortId = useMemo(() => {
    return portLinks.reduce<Record<string, PortLink>>((acc, link) => {
      acc[link.fromPortId] = link;
      acc[link.toPortId] = link;
      return acc;
    }, {});
  }, [portLinks]);
  const requestedDeviceId = searchParams.get("deviceId") ?? "";
  const requestedPortId = searchParams.get("portId") ?? "";

  const filteredPortBearingDevices = useMemo(() => {
    const query = deviceQuery.trim().toLowerCase();
    return portBearingDevices.filter((entry) => {
      if (deviceTypeFilter !== "all" && entry.deviceType !== deviceTypeFilter) {
        return false;
      }

      const entryPorts = portsByDeviceId[entry.id] ?? [];
      if (
        portLinkFilter !== "all" &&
        !entryPorts.some((port) =>
          portMatchesLinkFilter(port, portLinkFilter, linkByPortId),
        )
      ) {
        return false;
      }

      if (!query) return true;
      const haystack = [
        entry.hostname,
        entry.displayName,
        entry.deviceType,
        entry.manufacturer,
        entry.model,
        entry.managementIp,
        entry.macAddress,
        entry.placement,
        entry.status,
        ...(entry.tags ?? []),
        ...entryPorts.map((port) =>
          portSearchHaystack(port, {
            deviceById,
            linkByPortId,
            portById,
            virtualSwitchById,
            vlanById,
          }),
        ),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [
    deviceById,
    deviceQuery,
    deviceTypeFilter,
    linkByPortId,
    portBearingDevices,
    portById,
    portLinkFilter,
    portsByDeviceId,
    virtualSwitchById,
    vlanById,
  ]);

  useEffect(() => {
    if (requestedPortId && portById[requestedPortId]) {
      const requestedPort = portById[requestedPortId];
      if (requestedPort.deviceId !== selectedDeviceId) {
        setSelectedDeviceId(requestedPort.deviceId);
      }
      if (selectedPortId !== requestedPort.id) {
        setSelectedPortId(requestedPort.id);
      }
      return;
    }
    if (
      requestedDeviceId &&
      filteredPortBearingDevices.some(
        (deviceEntry) => deviceEntry.id === requestedDeviceId,
      )
    ) {
      if (selectedDeviceId !== requestedDeviceId) {
        setSelectedDeviceId(requestedDeviceId);
        setSelectedPortId(undefined);
      }
      return;
    }
    if (!filteredPortBearingDevices.length) {
      setSelectedDeviceId("");
      setSelectedPortId(undefined);
      return;
    }
    if (
      !selectedDeviceId ||
      !filteredPortBearingDevices.some(
        (deviceEntry) => deviceEntry.id === selectedDeviceId,
      )
    ) {
      setSelectedDeviceId(filteredPortBearingDevices[0].id);
      setSelectedPortId(undefined);
    }
  }, [
    filteredPortBearingDevices,
    portById,
    requestedDeviceId,
    requestedPortId,
    selectedDeviceId,
    selectedPortId,
  ]);

  const device = deviceById[selectedDeviceId];
  const devicePorts = portsByDeviceId[selectedDeviceId] ?? [];
  const visibleDevicePorts = useMemo(() => {
    const query = portQuery.trim().toLowerCase();
    return devicePorts.filter((port) => {
      if (!portMatchesLinkFilter(port, portLinkFilter, linkByPortId)) {
        return false;
      }
      if (!query) return true;
      return portSearchHaystack(port, {
        deviceById,
        linkByPortId,
        portById,
        virtualSwitchById,
        vlanById,
      }).includes(query);
    });
  }, [
    deviceById,
    devicePorts,
    linkByPortId,
    portById,
    portLinkFilter,
    portQuery,
    virtualSwitchById,
    vlanById,
  ]);
  const selectedBulkPorts = useMemo(
    () => visibleDevicePorts.filter((port) => selectedPortIds.has(port.id)),
    [selectedPortIds, visibleDevicePorts],
  );
  const allVisiblePortsSelected =
    visibleDevicePorts.length > 0 &&
    visibleDevicePorts.every((port) => selectedPortIds.has(port.id));
  const candidateVirtualSwitches = useMemo(() => {
    if (!device) return [];
    const hostDeviceId = device.parentDeviceId ?? device.id;
    return virtualSwitches.filter(
      (virtualSwitch) => virtualSwitch.hostDeviceId === hostDeviceId,
    );
  }, [device, virtualSwitches]);

  useEffect(() => {
    if (!visibleDevicePorts.length) {
      setSelectedPortId(undefined);
      return;
    }
    if (
      !selectedPortId ||
      !visibleDevicePorts.some((port) => port.id === selectedPortId)
    ) {
      setSelectedPortId(visibleDevicePorts[0].id);
    }
  }, [selectedPortId, visibleDevicePorts]);

  useEffect(() => {
    const portIds = new Set(ports.map((port) => port.id));
    setSelectedPortIds((current) => {
      const next = new Set([...current].filter((portId) => portIds.has(portId)));
      return next.size === current.size ? current : next;
    });
  }, [ports]);

  useEffect(() => {
    if (!portTemplates.length) {
      setSelectedTemplateId(undefined);
      return;
    }
    if (
      !selectedTemplateId ||
      !portTemplates.some((template) => template.id === selectedTemplateId)
    ) {
      const preferred = device
        ? portTemplates.find((template) =>
            template.deviceTypes.includes(device.deviceType),
          )
        : portTemplates[0];
      setSelectedTemplateId(preferred?.id ?? portTemplates[0].id);
    }
  }, [device, portTemplates, selectedTemplateId]);

  const selectedPort =
    !creating && selectedPortId ? portById[selectedPortId] : undefined;
  const selectedLink = selectedPort ? linkByPortId[selectedPort.id] : undefined;
  const peerPortId =
    selectedPort && selectedLink
      ? selectedLink.fromPortId === selectedPort.id
        ? selectedLink.toPortId
        : selectedLink.fromPortId
      : undefined;
  const peerPort = peerPortId ? portById[peerPortId] : undefined;
  const peerDevice = peerPort ? deviceById[peerPort.deviceId] : undefined;
  const selectedTemplate =
    !creatingTemplate && selectedTemplateId
      ? portTemplates.find((template) => template.id === selectedTemplateId)
      : undefined;

  useEffect(() => {
    if (creating) {
      setForm(blankPortForm(device));
      setError("");
      return;
    }
    setForm(selectedPort ? portToForm(selectedPort) : null);
    setError("");
  }, [creating, device, selectedPort]);

  useEffect(() => {
    if (creatingTemplate) return;
    if (!selectedTemplate) return;
    setTemplateForm(templateToForm(selectedTemplate));
    setTemplateError("");
  }, [creatingTemplate, selectedTemplate]);

  const isVisualGrid =
    device &&
    (device.deviceType === "switch" || device.deviceType === "router");

  const linkedCount = devicePorts.filter(
    (port) => port.linkState === "up",
  ).length;
  const totalCableCount = portLinks.length;

  async function handleSave() {
    if (!device || !form) return;

    setSaving(true);
    setError("");
    try {
      if (creating) {
        const created = await createPortRecord({
          deviceId: device.id,
          name: form.name.trim(),
          kind: form.kind,
          speed: form.speed.trim() || undefined,
          linkState: form.linkState,
          mode: form.mode,
          vlanId: form.vlanId || undefined,
          allowedVlanIds:
            form.mode === "trunk" ? form.allowedVlanIds : undefined,
          description: form.description.trim() || undefined,
          virtualSwitchId: form.virtualSwitchId || undefined,
          face: form.face,
          position: (devicePorts.at(-1)?.position ?? 0) + 1,
        });
        setCreating(false);
        setSelectedPortId(created.id);
      } else if (selectedPort) {
        await updatePort(selectedPort.id, {
          name: form.name.trim(),
          kind: form.kind,
          speed: form.speed.trim() || undefined,
          linkState: form.linkState,
          mode: form.mode,
          vlanId: form.vlanId || undefined,
          allowedVlanIds:
            form.mode === "trunk" ? form.allowedVlanIds : undefined,
          description: form.description.trim() || undefined,
          virtualSwitchId: form.virtualSwitchId || undefined,
          face: form.face,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update port.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedPort) return;
    if (!window.confirm(`Delete port ${selectedPort.name}?`)) return;

    setDeleting(true);
    setError("");
    try {
      await deletePortRecord(selectedPort.id);
      setSelectedPortId(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete port.");
    } finally {
      setDeleting(false);
    }
  }

  function beginBlankTemplate() {
    setCreatingTemplate(true);
    setSelectedTemplateId(undefined);
    setTemplateForm(blankTemplateForm(device?.deviceType ?? "switch"));
    setTemplateError("");
  }

  function beginTemplateFromDevice() {
    if (!device) {
      beginBlankTemplate();
      return;
    }

    setCreatingTemplate(true);
    setSelectedTemplateId(undefined);
    setTemplateForm({
      name: `${device.hostname} template`,
      description: `Template captured from ${device.hostname}`,
      deviceTypes: [device.deviceType],
      ports:
        devicePorts.length > 0
          ? devicePorts.map((port) => ({
              name: port.name,
              kind: port.kind,
              speed: port.speed ?? "",
              mode: port.mode ?? "access",
              face: port.face ?? "front",
            }))
          : blankTemplateForm(device.deviceType).ports,
    });
    setTemplateError("");
  }

  async function handleSaveTemplate() {
    const normalizedPorts = templateForm.ports
      .map((port) => ({
        name: port.name.trim(),
        kind: port.kind,
        speed: port.speed.trim() || undefined,
        mode: port.mode,
        face: port.face,
      }))
      .filter((port) => port.name);

    if (!templateForm.name.trim()) {
      setTemplateError("Template name is required.");
      return;
    }
    if (!templateForm.description.trim()) {
      setTemplateError("Template description is required.");
      return;
    }
    if (templateForm.deviceTypes.length === 0) {
      setTemplateError("Select at least one device type.");
      return;
    }
    if (normalizedPorts.length === 0) {
      setTemplateError("Add at least one named port.");
      return;
    }

    setTemplateSaving(true);
    setTemplateError("");
    try {
      if (creatingTemplate) {
        const created = await createPortTemplateRecord({
          name: templateForm.name.trim(),
          description: templateForm.description.trim(),
          deviceTypes: templateForm.deviceTypes,
          ports: normalizedPorts.map((port, index) => ({
            ...port,
            position: index + 1,
          })),
        });
        setCreatingTemplate(false);
        setSelectedTemplateId(created.id);
        return;
      }

      if (!selectedTemplate || selectedTemplate.builtIn) {
        setTemplateError("Built-in templates cannot be modified.");
        return;
      }

      await updatePortTemplateRecord(selectedTemplate.id, {
        name: templateForm.name.trim(),
        description: templateForm.description.trim(),
        deviceTypes: templateForm.deviceTypes,
        ports: normalizedPorts.map((port, index) => ({
          ...port,
          position: index + 1,
        })),
      });
    } catch (err) {
      setTemplateError(
        err instanceof Error ? err.message : "Failed to save port template.",
      );
    } finally {
      setTemplateSaving(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplate || selectedTemplate.builtIn) return;
    if (!window.confirm(`Delete port template ${selectedTemplate.name}?`))
      return;

    setTemplateDeleting(true);
    setTemplateError("");
    try {
      await deletePortTemplateRecord(selectedTemplate.id);
      setSelectedTemplateId(undefined);
      setCreatingTemplate(false);
    } catch (err) {
      setTemplateError(
        err instanceof Error ? err.message : "Failed to delete port template.",
      );
    } finally {
      setTemplateDeleting(false);
    }
  }

  function togglePortSelection(portId: string) {
    setSelectedPortIds((current) => {
      const next = new Set(current);
      if (next.has(portId)) next.delete(portId);
      else next.add(portId);
      return next;
    });
  }

  function toggleAllVisiblePorts() {
    setSelectedPortIds((current) => {
      const next = new Set(current);
      if (allVisiblePortsSelected) {
        for (const port of visibleDevicePorts) next.delete(port.id);
      } else {
        for (const port of visibleDevicePorts) next.add(port.id);
      }
      return next;
    });
  }

  function toggleBulkPortField(key: keyof BulkPortFormState) {
    setBulkPortFields((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectPort(portId: string | undefined) {
    setSelectedPortId(portId);
    if (device && portId) {
      setSearchParams({ deviceId: device.id, portId });
    }
  }

  async function handleBulkPortSave() {
    if (selectedBulkPorts.length === 0 || bulkPortFields.size === 0) return;
    const changes: Partial<Omit<Port, "id" | "deviceId" | "position">> = {};
    if (bulkPortFields.has("kind")) changes.kind = bulkPortForm.kind;
    if (bulkPortFields.has("speed")) {
      changes.speed = bulkPortForm.speed.trim() || undefined;
    }
    if (bulkPortFields.has("linkState")) {
      changes.linkState = bulkPortForm.linkState;
    }
    if (bulkPortFields.has("mode")) {
      changes.mode = bulkPortForm.mode;
      changes.allowedVlanIds = [];
    }
    if (bulkPortFields.has("vlanId")) {
      changes.vlanId = bulkPortForm.vlanId || undefined;
    }

    setBulkSaving(true);
    setBulkError("");
    try {
      for (const port of selectedBulkPorts) {
        await updatePort(port.id, changes);
      }
      setSelectedPortIds(new Set());
      setBulkPortFields(new Set());
      setBulkPortForm(EMPTY_BULK_PORT_FORM);
    } catch (err) {
      setBulkError(
        err instanceof Error ? err.message : "Failed to update selected ports.",
      );
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <>
      <TopBar
        subtitle="Ports & cabling"
        title="Ports"
        meta={
          <>
            <Mono className="text-[var(--color-fg-muted)]">{linkedCount}</Mono>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              linked / {devicePorts.length} total | {totalCableCount} cables
            </span>
          </>
        }
        actions={
          canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreating(true);
                setSelectedPortId(undefined);
                setForm(blankPortForm(device));
              }}
            >
              <Plus className="size-3.5" />
              Add port
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-64 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-2)]/40">
          <div className="border-b border-[var(--color-line)] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
              {filteredPortBearingDevices.length} / {portBearingDevices.length}{" "}
              devices
            </span>
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
                <Input
                  value={deviceQuery}
                  onChange={(event) => setDeviceQuery(event.target.value)}
                  placeholder="Filter devices..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={deviceTypeFilter}
                  onChange={(value) =>
                    setDeviceTypeFilter(value as DeviceType | "all")
                  }
                >
                  <option value="all">All types</option>
                  {portDeviceTypeOptions.map((deviceType) => (
                    <option key={deviceType.id} value={deviceType.id}>
                      {deviceType.label}
                    </option>
                  ))}
                </Select>
                <Select
                  value={portLinkFilter}
                  onChange={(value) =>
                    setPortLinkFilter(value as PortLinkFilter)
                  }
                >
                  <option value="all">All ports</option>
                  <option value="linked">Linked</option>
                  <option value="unlinked">Unlinked</option>
                  <option value="up">Up</option>
                  <option value="down">Down</option>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {filteredPortBearingDevices.map((entry) => {
              const entryPorts = portsByDeviceId[entry.id] ?? [];
              const linked = entryPorts.filter(
                (port) => port.linkState === "up",
              ).length;
              const isActive = entry.id === selectedDeviceId;
              return (
                <button
                  key={entry.id}
                  onClick={() => {
                    setSelectedDeviceId(entry.id);
                    setSelectedPortId(undefined);
                    setCreating(false);
                    setSearchParams({ deviceId: entry.id });
                  }}
                  className={`flex w-full items-center gap-2.5 border-l-2 px-4 py-2 text-left transition-colors ${
                    isActive
                      ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
                      : "border-transparent hover:bg-[var(--color-surface)]/40"
                  }`}
                >
                  <DeviceTypeIcon
                    type={entry.deviceType}
                    className="size-3.5 shrink-0 text-[var(--color-fg-muted)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-[var(--color-fg)]">
                      {entry.hostname}
                    </div>
                    <div className="truncate font-mono text-[10px] text-[var(--color-fg-subtle)]">
                      {entry.macAddress
                        ? entry.macAddress
                        : `${linked}/${entryPorts.length} linked`}
                    </div>
                  </div>
                  <StatusDot status={entry.status} />
                </button>
              );
            })}
            {filteredPortBearingDevices.length === 0 && (
              <div className="px-4 py-6 text-xs text-[var(--color-fg-subtle)]">
                No devices match the current filters.
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
          {!device ? (
            <EmptyDevice />
          ) : (
            <div className="grid h-full min-h-0 grid-cols-12 gap-5">
              <div className="col-span-12 min-h-0 overflow-y-auto pr-1 xl:col-span-8">
                <div className="mb-5">
                  <div className="mb-1 flex items-center gap-2">
                    <DeviceTypeIcon
                      type={device.deviceType}
                      className="size-4 text-[var(--color-accent)]"
                    />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                      {deviceTypeLabel(device.deviceType, deviceTypes)}
                    </span>
                  </div>
                  <Link
                    to={`/devices/${device.id}`}
                    className="text-lg font-semibold tracking-tight hover:text-[var(--color-accent)]"
                  >
                    {device.hostname}
                  </Link>
                  <div className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
                    {device.manufacturer} {device.model}
                    {formatDeviceAddress(device) && (
                      <>
                        <span className="mx-1.5 text-[var(--color-fg-faint)]">
                          |
                        </span>
                        <span className="font-mono">
                          {formatDeviceAddress(device)}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-3">
                  <div className="relative min-w-[16rem] max-w-md flex-1">
                    <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
                    <Input
                      value={portQuery}
                      onChange={(event) => setPortQuery(event.target.value)}
                      placeholder="Filter ports, VLANs, peers, bridges..."
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    {canEdit && visibleDevicePorts.length > 0 && (
                      <label className="inline-flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                        <input
                          type="checkbox"
                          checked={allVisiblePortsSelected}
                          onChange={() => toggleAllVisiblePorts()}
                        />
                        Select shown
                      </label>
                    )}
                    <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                      {visibleDevicePorts.length} / {devicePorts.length} shown
                    </Mono>
                  </div>
                </div>

                {isVisualGrid ? (
                  <div className="space-y-4">
                    <PortGrid
                      device={device}
                      ports={visibleDevicePorts}
                      links={linkByPortId}
                      portsById={portById}
                      devicesById={deviceById}
                      vlansById={vlanById}
                      virtualSwitchesById={virtualSwitchById}
                      onSelectPort={selectPort}
                      selectedPortId={selectedPortId}
                    />
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <CardLabel>Table</CardLabel>
                          <CardHeading>Selectable ports</CardHeading>
                        </CardTitle>
                      </CardHeader>
                      <CardBody className="p-0">
                        <PortList
                          ports={visibleDevicePorts}
                          links={linkByPortId}
                          portsById={portById}
                          devicesById={deviceById}
                          vlansById={vlanById}
                          virtualSwitchesById={virtualSwitchById}
                          onSelectPort={selectPort}
                          selectedPortId={selectedPortId}
                          selectedPortIds={selectedPortIds}
                          onTogglePortSelection={togglePortSelection}
                        />
                      </CardBody>
                    </Card>
                  </div>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <CardLabel>Interfaces</CardLabel>
                        <CardHeading>
                          {visibleDevicePorts.length} ports
                        </CardHeading>
                      </CardTitle>
                    </CardHeader>
                    <CardBody className="p-0">
                      <PortList
                        ports={visibleDevicePorts}
                        links={linkByPortId}
                        portsById={portById}
                        devicesById={deviceById}
                        vlansById={vlanById}
                        virtualSwitchesById={virtualSwitchById}
                        onSelectPort={selectPort}
                        selectedPortId={selectedPortId}
                        selectedPortIds={selectedPortIds}
                        onTogglePortSelection={togglePortSelection}
                      />
                    </CardBody>
                  </Card>
                )}
              </div>

              <div className="col-span-12 min-h-0 space-y-5 overflow-y-auto pr-1 xl:col-span-4">
                {canEdit && selectedBulkPorts.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <CardLabel>Bulk edit</CardLabel>
                        <CardHeading>
                          {selectedBulkPorts.length} selected ports
                        </CardHeading>
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPortIds(new Set())}
                      >
                        Clear
                      </Button>
                    </CardHeader>
                    <CardBody className="space-y-3">
                      <BulkField
                        label="Kind"
                        checked={bulkPortFields.has("kind")}
                        onChecked={() => toggleBulkPortField("kind")}
                      >
                        <Select
                          value={bulkPortForm.kind}
                          onChange={(value) =>
                            setBulkPortForm((prev) => ({
                              ...prev,
                              kind: value as Port["kind"],
                            }))
                          }
                        >
                          {PORT_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </Select>
                      </BulkField>
                      <BulkField
                        label="Speed"
                        checked={bulkPortFields.has("speed")}
                        onChecked={() => toggleBulkPortField("speed")}
                      >
                        <Input
                          value={bulkPortForm.speed}
                          onChange={(event) =>
                            setBulkPortForm((prev) => ({
                              ...prev,
                              speed: event.target.value,
                            }))
                          }
                          placeholder="1G, 10G, virtio..."
                        />
                      </BulkField>
                      <div className="grid grid-cols-2 gap-3">
                        <BulkField
                          label="State"
                          checked={bulkPortFields.has("linkState")}
                          onChecked={() => toggleBulkPortField("linkState")}
                        >
                          <Select
                            value={bulkPortForm.linkState}
                            onChange={(value) =>
                              setBulkPortForm((prev) => ({
                                ...prev,
                                linkState: value as Port["linkState"],
                              }))
                            }
                          >
                            {LINK_STATES.map((state) => (
                              <option key={state} value={state}>
                                {state}
                              </option>
                            ))}
                          </Select>
                        </BulkField>
                        <BulkField
                          label="Mode"
                          checked={bulkPortFields.has("mode")}
                          onChecked={() => toggleBulkPortField("mode")}
                        >
                          <Select
                            value={bulkPortForm.mode}
                            onChange={(value) =>
                              setBulkPortForm((prev) => ({
                                ...prev,
                                mode: value as Port["mode"],
                              }))
                            }
                          >
                            {PORT_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </Select>
                        </BulkField>
                      </div>
                      <BulkField
                        label={
                          bulkPortForm.mode === "trunk"
                            ? "Native VLAN"
                            : "Access VLAN"
                        }
                        checked={bulkPortFields.has("vlanId")}
                        onChecked={() => toggleBulkPortField("vlanId")}
                      >
                        <Select
                          value={bulkPortForm.vlanId}
                          onChange={(value) =>
                            setBulkPortForm((prev) => ({
                              ...prev,
                              vlanId: value,
                            }))
                          }
                        >
                          <option value="">Unassigned</option>
                          {vlans.map((vlan) => (
                            <option key={vlan.id} value={vlan.id}>
                              {vlan.vlanId} - {vlan.name}
                            </option>
                          ))}
                        </Select>
                      </BulkField>
                      {bulkError && (
                        <div className="text-xs text-[var(--color-err)]">
                          {bulkError}
                        </div>
                      )}
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          disabled={bulkSaving || bulkPortFields.size === 0}
                          onClick={() => void handleBulkPortSave()}
                        >
                          <Save className="size-3.5" />
                          {bulkSaving ? "Saving..." : "Apply to ports"}
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                )}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <CardLabel>Inspector</CardLabel>
                      <CardHeading>
                        {creating
                          ? "New port"
                          : selectedPort
                            ? formatPortLabel(selectedPort, {
                                includeFace:
                                  device?.deviceType === "patch_panel" ||
                                  selectedPort.face === "rear",
                              })
                            : "Select a port"}
                      </CardHeading>
                    </CardTitle>
                    {(selectedPort || creating) && (
                      <Badge tone="cyan">{form?.kind ?? "port"}</Badge>
                    )}
                  </CardHeader>
                  <CardBody>
                    {!form ? (
                      <div className="text-xs text-[var(--color-fg-subtle)]">
                        Select a port to edit its details.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Port name">
                            <Input
                              value={form.name}
                              onChange={(event) =>
                                setForm((prev) =>
                                  prev
                                    ? { ...prev, name: event.target.value }
                                    : prev,
                                )
                              }
                            />
                          </Field>
                          <Field label="Kind">
                            <Select
                              value={form.kind}
                              onChange={(value) =>
                                setForm((prev) =>
                                  prev
                                    ? { ...prev, kind: value as Port["kind"] }
                                    : prev,
                                )
                              }
                            >
                              {PORT_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {kind}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Speed">
                            <Input
                              value={form.speed}
                              onChange={(event) =>
                                setForm((prev) =>
                                  prev
                                    ? { ...prev, speed: event.target.value }
                                    : prev,
                                )
                              }
                              placeholder="e.g. 10G"
                            />
                          </Field>
                          <Field label="Face">
                            <Select
                              value={form.face}
                              onChange={(value) =>
                                setForm((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        face: value as PortFormState["face"],
                                      }
                                    : prev,
                                )
                              }
                            >
                              <option value="front">Front</option>
                              <option value="rear">Rear</option>
                            </Select>
                          </Field>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Link state">
                            <Select
                              value={form.linkState}
                              onChange={(value) =>
                                setForm((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        linkState: value as Port["linkState"],
                                      }
                                    : prev,
                                )
                              }
                            >
                              {LINK_STATES.map((state) => (
                                <option key={state} value={state}>
                                  {state}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Mode">
                            <Select
                              value={form.mode}
                              onChange={(value) =>
                                setForm((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        mode: value as PortFormState["mode"],
                                        allowedVlanIds:
                                          value === "trunk"
                                            ? prev.allowedVlanIds
                                            : [],
                                      }
                                    : prev,
                                )
                              }
                            >
                              {PORT_MODES.map((mode) => (
                                <option key={mode} value={mode}>
                                  {mode}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>

                        <div
                          className={`grid gap-3 ${form.mode === "trunk" ? "grid-cols-2" : "grid-cols-1"}`}
                        >
                          <Field
                            label={
                              form.mode === "trunk"
                                ? "Native VLAN"
                                : "Access VLAN"
                            }
                          >
                            <Select
                              value={form.vlanId}
                              onChange={(value) =>
                                setForm((prev) =>
                                  prev ? { ...prev, vlanId: value } : prev,
                                )
                              }
                            >
                              <option value="">
                                {form.mode === "trunk"
                                  ? "No native VLAN"
                                  : "Unassigned"}
                              </option>
                              {vlans.map((vlan) => (
                                <option key={vlan.id} value={vlan.id}>
                                  {vlan.vlanId} - {vlan.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          {form.mode === "trunk" && (
                            <Field label="Add tagged VLAN">
                              <Select
                                value=""
                                onChange={(value) => {
                                  if (!value) return;
                                  setForm((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          allowedVlanIds:
                                            prev.allowedVlanIds.includes(value)
                                              ? prev.allowedVlanIds
                                              : [...prev.allowedVlanIds, value],
                                        }
                                      : prev,
                                  );
                                }}
                              >
                                <option value="">Add tagged VLAN...</option>
                                {vlans
                                  .filter(
                                    (vlan) =>
                                      vlan.id !== form.vlanId &&
                                      !form.allowedVlanIds.includes(vlan.id),
                                  )
                                  .map((vlan) => (
                                    <option key={vlan.id} value={vlan.id}>
                                      {vlan.vlanId} - {vlan.name}
                                    </option>
                                  ))}
                              </Select>
                            </Field>
                          )}
                        </div>

                        {form.mode === "trunk" && (
                          <>
                            <Field label="Tagged VLANs">
                              <div className="flex flex-wrap gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-2">
                                {form.allowedVlanIds.length === 0 ? (
                                  <div className="px-1 py-1 text-xs text-[var(--color-fg-subtle)]">
                                    No tagged VLANs documented yet.
                                  </div>
                                ) : (
                                  form.allowedVlanIds.map((vlanId) => {
                                    const vlan = vlans.find(
                                      (entry) => entry.id === vlanId,
                                    );
                                    return (
                                      <button
                                        key={vlanId}
                                        type="button"
                                        onClick={() =>
                                          setForm((prev) =>
                                            prev
                                              ? {
                                                  ...prev,
                                                  allowedVlanIds:
                                                    prev.allowedVlanIds.filter(
                                                      (entry) =>
                                                        entry !== vlanId,
                                                    ),
                                                }
                                              : prev,
                                          )
                                        }
                                        className="rounded-[var(--radius-xs)] border border-[var(--color-accent-soft)]/40 bg-[var(--color-accent)]/10 px-2 py-1 text-xs text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/15"
                                      >
                                        {vlan
                                          ? `${vlan.vlanId} - ${vlan.name}`
                                          : vlanId}{" "}
                                        ×
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </Field>
                          </>
                        )}

                        <Field label="Virtual switch / bridge">
                          <Select
                            value={form.virtualSwitchId}
                            onChange={(value) =>
                              setForm((prev) =>
                                prev
                                  ? { ...prev, virtualSwitchId: value }
                                  : prev,
                              )
                            }
                          >
                            <option value="">
                              {candidateVirtualSwitches.length > 0
                                ? "No bridge membership"
                                : "No host bridges documented"}
                            </option>
                            {candidateVirtualSwitches.map((virtualSwitch) => (
                              <option
                                key={virtualSwitch.id}
                                value={virtualSwitch.id}
                              >
                                {virtualSwitch.name}
                              </option>
                            ))}
                          </Select>
                          <div className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                            {candidateVirtualSwitches.length > 0
                              ? "Use this to map VM NICs and host uplinks onto the same virtual switch or bridge."
                              : "Create host bridges from the Compute workspace, then assign VM and host ports here."}
                          </div>
                        </Field>

                        <Field label="Description">
                          <textarea
                            value={form.description}
                            onChange={(event) =>
                              setForm((prev) =>
                                prev
                                  ? { ...prev, description: event.target.value }
                                  : prev,
                              )
                            }
                            rows={3}
                            className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
                          />
                        </Field>

                        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
                          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                            Link
                          </div>
                          {selectedLink && peerDevice && peerPort ? (
                            <div className="space-y-1 text-xs">
                              <div className="inline-flex items-center gap-1.5">
                                <ArrowRight className="size-3 text-[var(--color-cyan)]" />
                                <span>{peerDevice.hostname}</span>
                                <span className="text-[var(--color-fg-faint)]">
                                  :
                                </span>
                                <Mono className="text-[var(--color-cyan)]">
                                  {formatPortLabel(peerPort, {
                                    includeFace: true,
                                  })}
                                </Mono>
                              </div>
                              <div className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
                                {selectedLink.cableType ?? "Cable"} |{" "}
                                {selectedLink.cableLength ?? "length n/a"}
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-[var(--color-fg-subtle)]">
                              {creating
                                ? "Save the port first before cabling it."
                                : "No linked cable."}
                            </div>
                          )}
                        </div>

                        {error && (
                          <div className="text-xs text-[var(--color-err)]">
                            {error}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-3">
                          {!creating && canEdit && selectedPort && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void handleDelete()}
                              disabled={deleting}
                            >
                              <Trash2 className="size-3.5" />
                              {deleting ? "Deleting..." : "Delete port"}
                            </Button>
                          )}
                          <div className="ml-auto flex items-center gap-2">
                            {creating && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCreating(false)}
                              >
                                Cancel
                              </Button>
                            )}
                            <Button
                              variant="default"
                              size="sm"
                              disabled={saving || !canEdit}
                              onClick={() => void handleSave()}
                            >
                              <Save className="size-3.5" />
                              {saving
                                ? "Saving..."
                                : creating
                                  ? "Create port"
                                  : "Save port"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      <CardLabel>Templates</CardLabel>
                      <CardHeading>
                        {creatingTemplate
                          ? "New template"
                          : (selectedTemplate?.name ?? "Port templates")}
                      </CardHeading>
                    </CardTitle>
                    <Badge
                      tone={selectedTemplate?.builtIn ? "neutral" : "accent"}
                    >
                      <Network className="size-3" />
                      {creatingTemplate
                        ? "custom"
                        : selectedTemplate?.builtIn
                          ? "built-in"
                          : "custom"}
                    </Badge>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={beginTemplateFromDevice}
                        >
                          <Plus className="size-3.5" />
                          From device
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={beginBlankTemplate}
                        >
                          <Plus className="size-3.5" />
                          Blank template
                        </Button>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {portTemplates.map((template) => {
                        const active =
                          !creatingTemplate &&
                          template.id === selectedTemplateId;
                        const appliesToCurrent = device
                          ? template.deviceTypes.includes(device.deviceType)
                          : false;
                        return (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => {
                              setCreatingTemplate(false);
                              setSelectedTemplateId(template.id);
                              setTemplateError("");
                            }}
                            className={`rounded-[var(--radius-xs)] border px-2.5 py-1 text-left text-xs transition-colors ${
                              active
                                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                                : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
                            }`}
                          >
                            <div className="font-medium">{template.name}</div>
                            <div className="font-mono text-[10px] uppercase tracking-[0.12em]">
                              {template.ports.length} ports
                              {appliesToCurrent ? " | matches device" : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {creatingTemplate || selectedTemplate ? (
                      <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Template name">
                            <Input
                              value={templateForm.name}
                              onChange={(event) =>
                                setTemplateForm((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                              disabled={Boolean(selectedTemplate?.builtIn)}
                              placeholder="48-port access switch"
                            />
                          </Field>
                          <Field label="Description">
                            <Input
                              value={templateForm.description}
                              onChange={(event) =>
                                setTemplateForm((prev) => ({
                                  ...prev,
                                  description: event.target.value,
                                }))
                              }
                              disabled={Boolean(selectedTemplate?.builtIn)}
                              placeholder="Common layout for edge switches"
                            />
                          </Field>
                        </div>

                        <Field label="Applies to">
                          <div className="flex flex-wrap gap-2">
                            {portDeviceTypeOptions.map((deviceType) => {
                              const selected =
                                templateForm.deviceTypes.includes(
                                  deviceType.id,
                                );
                              return (
                                <button
                                  key={deviceType.id}
                                  type="button"
                                  disabled={Boolean(selectedTemplate?.builtIn)}
                                  onClick={() =>
                                    setTemplateForm((prev) => ({
                                      ...prev,
                                      deviceTypes: selected
                                        ? prev.deviceTypes.filter(
                                            (entry) => entry !== deviceType.id,
                                          )
                                        : [...prev.deviceTypes, deviceType.id],
                                    }))
                                  }
                                  className={`rounded-[var(--radius-xs)] border px-2 py-1 text-xs capitalize transition-colors ${
                                    selected
                                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                                      : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
                                  } disabled:cursor-default disabled:opacity-70`}
                                >
                                  {deviceType.label}
                                </button>
                              );
                            })}
                          </div>
                        </Field>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                              Port layout
                            </div>
                            {!selectedTemplate?.builtIn && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setTemplateForm((prev) =>
                                    appendTemplatePorts(prev),
                                  )
                                }
                              >
                                <Plus className="size-3.5" />
                                {isPatchPanelTemplate(templateForm)
                                  ? "Add jack"
                                  : "Add port"}
                              </Button>
                            )}
                          </div>

                          <div className="space-y-2">
                            {templateForm.ports.map((port, index) => (
                              <div
                                key={index}
                                className="grid grid-cols-12 gap-2 rounded-[var(--radius-xs)] border border-[var(--color-line)] p-2"
                              >
                                <div className="col-span-3">
                                  <Field label={`Port ${index + 1}`}>
                                    <Input
                                      value={port.name}
                                      disabled={Boolean(
                                        selectedTemplate?.builtIn,
                                      )}
                                      onChange={(event) =>
                                        setTemplateForm((prev) => ({
                                          ...prev,
                                          ports: prev.ports.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    name: event.target.value,
                                                  }
                                                : entry,
                                          ),
                                        }))
                                      }
                                      placeholder="Gi1/0/1"
                                    />
                                  </Field>
                                </div>
                                <div className="col-span-2">
                                  <Field label="Kind">
                                    <Select
                                      value={port.kind}
                                      disabled={Boolean(
                                        selectedTemplate?.builtIn,
                                      )}
                                      onChange={(value) =>
                                        setTemplateForm((prev) => ({
                                          ...prev,
                                          ports: prev.ports.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    kind: value as Port["kind"],
                                                  }
                                                : entry,
                                          ),
                                        }))
                                      }
                                    >
                                      {PORT_KINDS.map((kind) => (
                                        <option key={kind} value={kind}>
                                          {kind}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                </div>
                                <div className="col-span-2">
                                  <Field label="Speed">
                                    <Input
                                      value={port.speed}
                                      disabled={Boolean(
                                        selectedTemplate?.builtIn,
                                      )}
                                      onChange={(event) =>
                                        setTemplateForm((prev) => ({
                                          ...prev,
                                          ports: prev.ports.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    speed: event.target.value,
                                                  }
                                                : entry,
                                          ),
                                        }))
                                      }
                                      placeholder="10G"
                                    />
                                  </Field>
                                </div>
                                <div className="col-span-2">
                                  <Field label="Mode">
                                    <Select
                                      value={port.mode}
                                      disabled={Boolean(
                                        selectedTemplate?.builtIn,
                                      )}
                                      onChange={(value) =>
                                        setTemplateForm((prev) => ({
                                          ...prev,
                                          ports: prev.ports.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    mode: value as TemplatePortFormState["mode"],
                                                  }
                                                : entry,
                                          ),
                                        }))
                                      }
                                    >
                                      {PORT_MODES.map((mode) => (
                                        <option key={mode} value={mode}>
                                          {mode}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                </div>
                                <div className="col-span-2">
                                  <Field label="Face">
                                    <Select
                                      value={port.face}
                                      disabled={Boolean(
                                        selectedTemplate?.builtIn,
                                      )}
                                      onChange={(value) =>
                                        setTemplateForm((prev) => ({
                                          ...prev,
                                          ports: prev.ports.map(
                                            (entry, entryIndex) =>
                                              entryIndex === index
                                                ? {
                                                    ...entry,
                                                    face: value as TemplatePortFormState["face"],
                                                  }
                                                : entry,
                                          ),
                                        }))
                                      }
                                    >
                                      <option value="front">Front</option>
                                      <option value="rear">Rear</option>
                                    </Select>
                                  </Field>
                                </div>
                                <div className="col-span-1 flex items-end justify-end">
                                  {!selectedTemplate?.builtIn && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() =>
                                        setTemplateForm((prev) => ({
                                          ...prev,
                                          ports:
                                            prev.ports.length === 1
                                              ? prev.ports
                                              : prev.ports.filter(
                                                  (_, entryIndex) =>
                                                    entryIndex !== index,
                                                ),
                                        }))
                                      }
                                      aria-label="Remove port"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {templateError && (
                          <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                            {templateError}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-[var(--color-fg-subtle)]">
                            {selectedTemplate?.builtIn
                              ? "Built-in templates are read-only but can still be applied to devices."
                              : "Custom templates become available immediately in the device drawer."}
                          </div>
                          <div className="flex items-center gap-2">
                            {creatingTemplate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCreatingTemplate(false)}
                              >
                                Cancel
                              </Button>
                            )}
                            {!creatingTemplate &&
                              selectedTemplate &&
                              !selectedTemplate.builtIn && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => void handleDeleteTemplate()}
                                  disabled={templateDeleting}
                                >
                                  <Trash2 className="size-3.5" />
                                  {templateDeleting ? "Deleting..." : "Delete"}
                                </Button>
                              )}
                            {!selectedTemplate?.builtIn && (
                              <Button
                                size="sm"
                                onClick={() => void handleSaveTemplate()}
                                disabled={templateSaving}
                              >
                                <Save className="size-3.5" />
                                {templateSaving
                                  ? "Saving..."
                                  : creatingTemplate
                                    ? "Create template"
                                    : "Save template"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--color-fg-subtle)]">
                        Select a template to inspect it, or create a custom one
                        from the current device.
                      </div>
                    )}
                  </CardBody>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="rk-field-label">{label}</span>
      {children}
    </label>
  );
}

function BulkField({
  label,
  checked,
  onChecked,
  children,
}: {
  label: string;
  checked: boolean;
  onChecked: () => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={() => onChecked()} />
        <span className="rk-field-label mb-0">{label}</span>
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="rk-control h-8 w-full px-2 text-sm text-[var(--text-primary)]"
    >
      {children}
    </select>
  );
}

function portMatchesLinkFilter(
  port: Port,
  filter: PortLinkFilter,
  linksByPortId: Record<string, PortLink>,
) {
  if (filter === "all") return true;
  const linked = Boolean(linksByPortId[port.id]);
  if (filter === "linked") return linked;
  if (filter === "unlinked") return !linked;
  if (filter === "up") return port.linkState === "up";
  return port.linkState !== "up";
}

function portSearchHaystack(
  port: Port,
  context: {
    vlanById: Record<string, Vlan>;
    virtualSwitchById: Record<string, VirtualSwitch>;
    linkByPortId: Record<string, PortLink>;
    portById: Record<string, Port>;
    deviceById: Record<string, Device>;
  },
) {
  const link = context.linkByPortId[port.id];
  const peerPortId = link
    ? link.fromPortId === port.id
      ? link.toPortId
      : link.fromPortId
    : undefined;
  const peerPort = peerPortId ? context.portById[peerPortId] : undefined;
  const peerDevice = peerPort
    ? context.deviceById[peerPort.deviceId]
    : undefined;
  const accessVlan = port.vlanId ? context.vlanById[port.vlanId] : undefined;
  const taggedVlans = (port.allowedVlanIds ?? [])
    .map((vlanId) => context.vlanById[vlanId])
    .filter(Boolean);
  const virtualSwitch = port.virtualSwitchId
    ? context.virtualSwitchById[port.virtualSwitchId]
    : undefined;

  return [
    formatPortLabel(port, { includeFace: true }),
    port.name,
    port.kind,
    port.speed,
    port.linkState,
    port.mode,
    port.face,
    port.description,
    accessVlan?.name,
    accessVlan?.vlanId,
    ...taggedVlans.flatMap((vlan) => [vlan.name, vlan.vlanId]),
    virtualSwitch?.name,
    virtualSwitch?.kind,
    peerDevice?.hostname,
    peerDevice?.managementIp,
    peerDevice?.macAddress,
    peerDevice?.deviceType,
    peerPort?.name,
    link?.cableType,
    link?.cableLength,
    link?.color,
    link?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function EmptyDevice() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="text-sm text-[var(--color-fg-subtle)]">
          Select a device
        </div>
      </div>
    </div>
  );
}
