import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { AlertCircle, Plus, Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import { Badge } from "@/components/ui/Badge";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { cn } from "@/lib/utils";
import {
  allocateIp,
  allocateVlan,
  canEditInventory,
  previewNextIpAllocation,
  previewNextVlanId,
  useStore,
} from "@/lib/store";
import type { IpAllocationMode, IpAssignmentType } from "@/lib/types";
import { useI18n } from "@/i18n";

interface AllocatePanelProps {
  defaultTab?: "ip" | "vlan";
  defaultSubnetId?: string;
  defaultRangeId?: string;
  trigger?: ReactNode;
  onAllocated?: (kind: "ip" | "vlan", id: string) => void;
}

export function AllocatePanel({
  defaultTab = "ip",
  defaultSubnetId,
  defaultRangeId,
  trigger,
  onAllocated,
}: AllocatePanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="default" size="sm">
            <Plus className="size-3.5" />
            {t("Allocate")}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <AllocatePanelBody
          defaultTab={defaultTab}
          defaultSubnetId={defaultSubnetId}
          defaultRangeId={defaultRangeId}
          onClose={() => setOpen(false)}
          onAllocated={onAllocated}
        />
      </PopoverContent>
    </Popover>
  );
}

interface BodyProps {
  defaultTab: "ip" | "vlan";
  defaultSubnetId?: string;
  defaultRangeId?: string;
  onClose: () => void;
  onAllocated?: (kind: "ip" | "vlan", id: string) => void;
}

function AllocatePanelBody({
  defaultTab,
  defaultSubnetId,
  defaultRangeId,
  onClose,
  onAllocated,
}: BodyProps) {
  const { t } = useI18n();
  return (
    <Tabs defaultValue={defaultTab}>
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 pb-2 pt-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
            {t("New")}
          </div>
          <div className="text-sm font-semibold tracking-tight">
            {t("Allocate")}
          </div>
        </div>
        <Sparkles className="size-4 text-[var(--color-accent)]" />
      </div>

      <TabsList className="-mb-px px-2">
        <TabsTrigger value="ip">{t("IP address")}</TabsTrigger>
        <TabsTrigger value="vlan">{t("VLAN ID")}</TabsTrigger>
      </TabsList>

      <TabsContent value="ip">
        <AllocateIpForm
          defaultSubnetId={defaultSubnetId}
          onClose={onClose}
          onAllocated={onAllocated}
        />
      </TabsContent>
      <TabsContent value="vlan">
        <AllocateVlanForm
          defaultRangeId={defaultRangeId}
          onClose={onClose}
          onAllocated={onAllocated}
        />
      </TabsContent>
    </Tabs>
  );
}

function AllocateIpForm({
  defaultSubnetId,
  onClose,
  onAllocated,
}: {
  defaultSubnetId?: string;
  onClose: () => void;
  onAllocated?: (kind: "ip" | "vlan", id: string) => void;
}) {
  const { t } = useI18n();
  const subnets = useStore((s) => s.subnets);
  const scopes = useStore((s) => s.scopes);
  const ipZones = useStore((s) => s.ipZones);
  const ipAssignments = useStore((s) => s.ipAssignments);
  const currentUser = useStore((s) => s.currentUser);
  const canEdit = canEditInventory(currentUser);

  const [subnetId, setSubnetId] = useState(
    defaultSubnetId ?? subnets[0]?.id ?? "",
  );
  const [hostname, setHostname] = useState("");
  const [description, setDescription] = useState("");
  const [assignmentType, setAssignmentType] =
    useState<IpAssignmentType>("device");
  const [allocationMode, setAllocationMode] =
    useState<IpAllocationMode>("static");
  const [dhcpScopeId, setDhcpScopeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deviceDrawerOpen, setDeviceDrawerOpen] = useState(false);

  const scopesForSubnet = useMemo(
    () => scopes.filter((scope) => scope.subnetId === subnetId),
    [scopes, subnetId],
  );
  const effectiveDhcpScopeId =
    allocationMode === "dhcp-reservation"
      ? dhcpScopeId || scopesForSubnet[0]?.id || ""
      : "";

  useEffect(() => {
    if (allocationMode !== "dhcp-reservation") return;
    if (
      dhcpScopeId &&
      scopesForSubnet.some((scope) => scope.id === dhcpScopeId)
    )
      return;
    setDhcpScopeId(scopesForSubnet[0]?.id ?? "");
  }, [allocationMode, dhcpScopeId, scopesForSubnet]);

  const preview = useMemo(() => {
    if (!subnetId) return null;
    return previewNextIpAllocation(subnetId, assignmentType, {
      allocationMode,
      dhcpScopeId: effectiveDhcpScopeId || null,
    });
  }, [
    allocationMode,
    assignmentType,
    effectiveDhcpScopeId,
    ipAssignments,
    ipZones,
    scopes,
    subnets,
    subnetId,
  ]);
  const previewIp = preview?.ipAddress ?? null;

  const subnet = subnets.find((entry) => entry.id === subnetId);
  const canSubmit = !!previewIp && hostname.trim().length > 0;
  const canRegisterDevice =
    canEdit &&
    !!previewIp &&
    hostname.trim().length > 0 &&
    (assignmentType === "device" ||
      assignmentType === "vm" ||
      assignmentType === "container");

  async function submit() {
    if (!canSubmit || !preview) return;

    setSaving(true);
    try {
      const result = await allocateIp({
        subnetId,
        hostname: hostname.trim(),
        description: description.trim() || undefined,
        assignmentType,
        allocationMode,
        dhcpScopeId: (preview.dhcpScopeId ?? effectiveDhcpScopeId) || undefined,
      });
      if (result) {
        onAllocated?.("ip", result.id);
        setHostname("");
        setDescription("");
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <Field label={t("Subnet")}>
        <Select value={subnetId} onChange={setSubnetId}>
          {subnets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.cidr} · {entry.name}
            </option>
          ))}
        </Select>
      </Field>

      <PreviewBox
        label={t("Next available")}
        value={previewIp}
        emptyText={t("No free static or DHCP reservation IPs in this subnet")}
        unit={[
          subnet ? `· ${subnet.name}` : "",
          preview?.source === "dhcp-reservation" ? "· DHCP reservation" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      />

      <Field label={t("Allocation")}>
        <div className="grid grid-cols-2 gap-1">
          {(["static", "dhcp-reservation"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setAllocationMode(mode)}
              className={cn(
                "rounded-[var(--radius-xs)] border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                allocationMode === mode
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                  : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]",
              )}
            >
              {mode === "dhcp-reservation"
                ? t("DHCP reservation")
                : t("Static")}
            </button>
          ))}
        </div>
      </Field>

      {allocationMode === "dhcp-reservation" && (
        <Field label={t("DHCP scope")}>
          <Select value={effectiveDhcpScopeId} onChange={setDhcpScopeId}>
            {scopesForSubnet.length === 0 && (
              <option value="">{t("No DHCP scope in this subnet")}</option>
            )}
            {scopesForSubnet.map((scope) => (
              <option key={scope.id} value={scope.id}>
                {scope.name} · {scope.startIp}-{scope.endIp}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
            {t(
              "The address keeps its real assignment type and is marked as a DHCP reservation.",
            )}
          </p>
        </Field>
      )}

      <Field label={t("Type")}>
        <div className="grid grid-cols-4 gap-1">
          {(["device", "vm", "container", "reserved"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setAssignmentType(type)}
              className={cn(
                "rounded-[var(--radius-xs)] border px-2 py-1 font-mono text-[11px] uppercase tracking-wider capitalize transition-colors",
                assignmentType === type
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                  : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]",
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("Hostname")}>
        <Input
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder={t("e.g. monitoring-01")}
          autoFocus
        />
      </Field>

      <Field label={t("Description (optional)")}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("e.g. Grafana on pve-02")}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("Cancel")}
        </Button>
        {canRegisterDevice && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDeviceDrawerOpen(true)}
          >
            {t("Allocate & add device")}
          </Button>
        )}
        <Button
          variant="default"
          size="sm"
          disabled={!canSubmit || saving}
          onClick={() => void submit()}
        >
          {t("Allocate")}{" "}
          {previewIp && (
            <Mono className="text-[var(--color-bg)]">{previewIp}</Mono>
          )}
        </Button>
      </div>
      {preview && previewIp && (
        <DeviceDrawer
          open={deviceDrawerOpen}
          onClose={() => setDeviceDrawerOpen(false)}
          defaults={{
            hostname: hostname.trim(),
            managementIp: previewIp,
            ipAllocationMode: preview.allocationMode,
            ipSubnetId: subnetId,
            dhcpScopeId: preview.dhcpScopeId ?? "",
            deviceType:
              assignmentType === "vm"
                ? "vm"
                : assignmentType === "container"
                  ? "container"
                  : "server",
            placement:
              assignmentType === "vm" || assignmentType === "container"
                ? "virtual"
                : "room",
            notes: description.trim(),
          }}
          onSaved={() => {
            setHostname("");
            setDescription("");
            setDeviceDrawerOpen(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

function AllocateVlanForm({
  defaultRangeId,
  onClose,
  onAllocated,
}: {
  defaultRangeId?: string;
  onClose: () => void;
  onAllocated?: (kind: "ip" | "vlan", id: string) => void;
}) {
  const { t } = useI18n();
  const ranges = useStore((s) => s.vlanRanges);
  const vlans = useStore((s) => s.vlans);

  const [rangeId, setRangeId] = useState(defaultRangeId ?? ranges[0]?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const previewId = useMemo(() => {
    if (!rangeId) return null;
    return previewNextVlanId(rangeId);
  }, [rangeId, vlans]);

  const range = ranges.find((entry) => entry.id === rangeId);
  const canSubmit = previewId != null && name.trim().length > 0;

  async function submit() {
    if (!canSubmit) return;

    setSaving(true);
    try {
      const result = await allocateVlan({
        rangeId,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      if (result) {
        onAllocated?.("vlan", result.id);
        setName("");
        setDescription("");
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <Field label={t("Range")}>
        <Select value={rangeId} onChange={setRangeId}>
          {ranges.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} · {entry.startVlan}-{entry.endVlan}
            </option>
          ))}
        </Select>
      </Field>

      <PreviewBox
        label={t("Next available")}
        value={previewId != null ? `VLAN ${previewId}` : null}
        emptyText={t("No free VLAN IDs in this range")}
        unit={range ? `· ${range.name}` : ""}
      />

      <Field label={t("Name")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("e.g. cameras")}
          autoFocus
        />
      </Field>

      <Field label={t("Description (optional)")}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("e.g. RTSP cameras + NVR")}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={!canSubmit || saving}
          onClick={() => void submit()}
        >
          {t("Allocate")}{" "}
          {previewId != null && (
            <Mono className="text-[var(--color-bg)]">
              {t("VLAN")}
              {previewId}
            </Mono>
          )}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm font-sans",
        "text-[var(--color-fg)]",
        "focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]",
      )}
    >
      {children}
    </select>
  );
}

function PreviewBox({
  label,
  value,
  unit,
  emptyText,
}: {
  label: string;
  value: string | null;
  unit?: string;
  emptyText: string;
}) {
  const { t } = useI18n();
  return (
    <motion.div
      key={value ?? "empty"}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2",
        value
          ? "border-[var(--color-accent-soft)]/40 bg-[var(--color-accent)]/5"
          : "border-[var(--color-err)]/30 bg-[var(--color-err)]/5",
      )}
    >
      {value ? (
        <>
          <span className="size-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_6px_var(--color-accent-glow)] animate-pulse-slow" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              {label}
            </div>
            <div className="flex items-baseline gap-1.5">
              <Mono className="text-base font-semibold text-[var(--color-fg)]">
                {value}
              </Mono>
              {unit && (
                <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                  {unit}
                </span>
              )}
            </div>
          </div>
          <Badge tone="accent">{t("ready")}</Badge>
        </>
      ) : (
        <>
          <AlertCircle className="size-4 shrink-0 text-[var(--color-err)]" />
          <div className="flex-1 text-[11px] text-[var(--color-err)]">
            {emptyText}
          </div>
        </>
      )}
    </motion.div>
  );
}
