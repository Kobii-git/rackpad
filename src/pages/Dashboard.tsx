import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Cable,
  ChevronRight,
  ClipboardList,
  HardDrive,
  Network,
  Server,
  Wifi,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusDot } from "@/components/shared/StatusDot";
import { Mono } from "@/components/shared/Mono";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { AllocatePanel } from "@/components/shared/AllocatePanel";
import { canEditInventory, useStore } from "@/lib/store";
import { formatDeviceAddress } from "@/lib/network-labels";
import { cidrSize, relativeTime, statusLabel } from "@/lib/utils";

export default function Dashboard() {
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const rooms = useStore((s) => s.rooms);
  const racks = useStore((s) => s.racks);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const subnets = useStore((s) => s.subnets);
  const portLinks = useStore((s) => s.portLinks);
  const ipAssignments = useStore((s) => s.ipAssignments);
  const auditLog = useStore((s) => s.auditLog);
  const vlans = useStore((s) => s.vlans);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const discoveredDevices = useStore((s) => s.discoveredDevices);
  const canEdit = canEditInventory(currentUser);

  const devicesById = Object.fromEntries(
    devices.map((device) => [device.id, device]),
  );
  const cabledPortIds = new Set(
    portLinks.flatMap((link) => [link.fromPortId, link.toPortId]),
  );
  const totalUsableIps = subnets.reduce(
    (sum, subnet) => sum + Math.max(0, cidrSize(subnet.cidr) - 2),
    0,
  );
  const ipUsagePct =
    totalUsableIps === 0
      ? 0
      : Math.round((ipAssignments.length / totalUsableIps) * 100);
  const uncabledPorts = Math.max(0, ports.length - cabledPortIds.size);
  const portsWithoutSpeed = ports.filter((port) => !port.speed).length;
  const enabledMonitors = deviceMonitors.filter(
    (monitor) => monitor.enabled && monitor.type !== "none",
  );
  const monitorIssues = enabledMonitors.filter((monitor) =>
    ["offline", "unknown"].includes(monitor.lastResult ?? "unknown"),
  );
  const attentionDevices = devices
    .filter((device) =>
      ["offline", "warning", "unknown"].includes(device.status),
    )
    .sort((a, b) => statusPriority(a.status) - statusPriority(b.status));
  const newDiscoveries = discoveredDevices.filter(
    (device) => device.status === "new",
  ).length;
  const unplacedDevices = devices.filter(
    (device) =>
      device.placement !== "virtual" &&
      !device.rackId &&
      !device.roomId &&
      !device.parentDeviceId,
  ).length;
  const rackUtilization = racks.length
    ? Math.round(
        (devices.reduce(
          (sum, device) =>
            sum + (device.rackId && device.heightU ? device.heightU : 0),
          0,
        ) /
          Math.max(
            1,
            racks.reduce((sum, rack) => sum + rack.totalU, 0),
          )) *
          100,
      )
    : 0;
  const deviceTypes = Object.entries(
    devices.reduce<Record<string, number>>((acc, device) => {
      acc[device.deviceType] = (acc[device.deviceType] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8);
  const recentActivity = auditLog.slice(0, 5);

  return (
    <>
      <TopBar
        subtitle="Operations overview"
        title="Dashboard"
        meta={
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              Lab
            </span>
            <span className="text-[13px] font-medium text-[var(--text-primary)]">
              {lab.name}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {rooms.length} rooms | {racks.length} racks | {devices.length}{" "}
              devices
            </span>
          </>
        }
        actions={canEdit ? <AllocatePanel /> : undefined}
      />

      <div className="flex-1 overflow-y-auto rk-page-pad">
        <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardMetric
            to="/monitoring"
            icon={AlertTriangle}
            label="Needs attention"
            value={attentionDevices.length + monitorIssues.length}
            hint={`${attentionDevices.length} devices, ${monitorIssues.length} monitors`}
            tone={
              attentionDevices.length + monitorIssues.length > 0 ? "warn" : "ok"
            }
          />
          <DashboardMetric
            to="/ipam"
            icon={Network}
            label="IPAM used"
            value={`${ipUsagePct}%`}
            hint={`${ipAssignments.length}/${totalUsableIps || 0} usable addresses`}
            tone={ipUsagePct > 85 ? "warn" : "info"}
          />
          <DashboardMetric
            to="/ports"
            icon={Cable}
            label="Ports cabled"
            value={`${cabledPortIds.size}/${ports.length}`}
            hint={`${uncabledPorts} uncabled, ${portsWithoutSpeed} missing speed`}
            tone={uncabledPorts > 0 ? "neutral" : "ok"}
          />
          <DashboardMetric
            to="/discovery"
            icon={ClipboardList}
            label="Discovery queue"
            value={newDiscoveries}
            hint={`${discoveredDevices.length} discovered hosts total`}
            tone={newDiscoveries > 0 ? "warn" : "neutral"}
          />
        </div>

        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 xl:col-span-5">
            <CardHeader>
              <CardTitle>
                <CardHeading>Device status issues</CardHeading>
              </CardTitle>
              <Badge tone={attentionDevices.length > 0 ? "warn" : "ok"}>
                {attentionDevices.length} open
              </Badge>
            </CardHeader>
            <CardBody className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {attentionDevices.length === 0 ? (
                <EmptyLine title="No device status issues" />
              ) : (
                attentionDevices.map((device) => (
                  <Link
                    key={device.id}
                    to={`/devices/${device.id}`}
                    className="rk-list-row flex items-center gap-3 px-3 py-2"
                  >
                    <StatusDot status={device.status} />
                    <DeviceTypeIcon
                      type={device.deviceType}
                      className="size-4 text-[var(--accent-primary)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {device.hostname}
                      </div>
                      <div className="truncate text-[11px] text-[var(--text-tertiary)]">
                        {formatDeviceAddress(device) ||
                          device.displayName ||
                          device.deviceType.replace("_", " ")}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                      {statusLabel[device.status]}
                    </span>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>

          <Card className="col-span-12 xl:col-span-4">
            <CardHeader>
              <CardTitle>
                <CardHeading>Monitor targets</CardHeading>
              </CardTitle>
              <Badge tone={monitorIssues.length > 0 ? "warn" : "ok"}>
                {enabledMonitors.length} enabled
              </Badge>
            </CardHeader>
            <CardBody className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {monitorIssues.length === 0 ? (
                <EmptyLine title="No monitor failures" />
              ) : (
                monitorIssues.map((monitor) => {
                  const device = devicesById[monitor.deviceId];
                  return (
                    <Link
                      key={monitor.id}
                      to={device ? `/devices/${device.id}` : "/monitoring"}
                      className="rk-list-row block px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm text-[var(--text-primary)]">
                          {device?.hostname ?? monitor.name}
                        </span>
                        <Badge
                          tone={
                            monitor.lastResult === "offline" ? "err" : "neutral"
                          }
                        >
                          {monitor.lastResult ?? "unknown"}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-[var(--text-tertiary)]">
                        {monitor.name} | {monitor.target ?? "no target"}
                      </div>
                    </Link>
                  );
                })
              )}
            </CardBody>
          </Card>

          <Card className="col-span-12 xl:col-span-3">
            <CardHeader>
              <CardTitle>
                <CardHeading>Recent activity</CardHeading>
              </CardTitle>
              <Link
                to="/audit-log"
                className="text-xs text-[var(--accent-primary)] hover:underline"
              >
                View all
              </Link>
            </CardHeader>
            <CardBody className="space-y-2">
              {recentActivity.length === 0 ? (
                <EmptyLine title="No audit activity yet" />
              ) : (
                recentActivity.map((entry) => (
                  <Link
                    key={entry.id}
                    to="/audit-log"
                    className="rk-list-row block px-3 py-2"
                  >
                    <div className="line-clamp-2 text-xs text-[var(--text-primary)]">
                      {entry.summary}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <Mono className="text-[10px] text-[var(--text-tertiary)]">
                        {entry.user}
                      </Mono>
                      <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                        {relativeTime(entry.ts)}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>

          <Card className="col-span-12 lg:col-span-4">
            <CardHeader>
              <CardTitle>
                <CardHeading>Placement coverage</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <CoverageRow
                label="Rack utilization"
                value={`${rackUtilization}%`}
                pct={rackUtilization}
              />
              <CoverageRow
                label="Cabled ports"
                value={`${cabledPortIds.size}/${ports.length}`}
                pct={Math.round(
                  (cabledPortIds.size / Math.max(1, ports.length)) * 100,
                )}
              />
              <CoverageRow
                label="IPAM usage"
                value={`${ipUsagePct}%`}
                pct={ipUsagePct}
              />
              <div className="grid grid-cols-3 gap-2 pt-1">
                <MiniStat icon={Server} label="Racks" value={racks.length} />
                <MiniStat icon={Wifi} label="Rooms" value={rooms.length} />
                <MiniStat
                  icon={HardDrive}
                  label="Unplaced"
                  value={unplacedDevices}
                  to="/devices?placement=unplaced"
                />
              </div>
            </CardBody>
          </Card>

          <Card className="col-span-12 lg:col-span-4">
            <CardHeader>
              <CardTitle>
                <CardHeading>Device mix</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-2">
                {deviceTypes.map(([type, count]) => (
                  <Link
                    key={type}
                    to={`/devices?type=${encodeURIComponent(type)}`}
                    className="rk-list-row flex items-center gap-2.5 px-3 py-2.5"
                  >
                    <DeviceTypeIcon
                      type={type}
                      className="size-4 text-[var(--accent-primary)]"
                    />
                    <div className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-xs font-medium capitalize text-[var(--text-primary)]">
                        {type.replace("_", " ")}
                      </span>
                      <Mono className="text-[10px] text-[var(--text-tertiary)]">
                        {count}
                      </Mono>
                    </div>
                    <ChevronRight className="size-3 text-[var(--text-muted)]" />
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card className="col-span-12 lg:col-span-4">
            <CardHeader>
              <CardTitle>
                <CardHeading>Coverage gaps</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <GapRow
                to="/ports"
                label="Ports without speed"
                value={portsWithoutSpeed}
              />
              <GapRow
                to="/ports"
                label="Ports without cable"
                value={uncabledPorts}
              />
              <GapRow to="/ipam" label="Subnets" value={subnets.length} />
              <GapRow to="/vlans" label="VLANs" value={vlans.length} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function DashboardMetric({
  to,
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  to: string;
  icon: typeof Activity;
  label: string;
  value: string | number;
  hint: string;
  tone: "ok" | "warn" | "info" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success)]"
      : tone === "warn"
        ? "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning)]"
        : tone === "info"
          ? "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]"
          : "border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.025)] text-[var(--text-secondary)]";
  const metricAccent =
    tone === "ok"
      ? "var(--success)"
      : tone === "warn"
        ? "var(--warning)"
        : tone === "info"
          ? "var(--info)"
          : "var(--neutral)";
  return (
    <Link
      to={to}
      className="rk-metric-card"
      style={{ "--metric-accent": metricAccent } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0">
          <div className="rk-kicker">{label}</div>
          <div className="mt-2 text-[1.65rem] font-semibold leading-none tracking-normal text-[var(--text-primary)]">
            {value}
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {hint}
          </div>
        </div>
        <div
          className={`grid size-9 place-items-center rounded-[var(--radius-sm)] border ${toneClass}`}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </Link>
  );
}

function EmptyLine({ title }: { title: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
      {title}
    </div>
  );
}

function CoverageRow({
  label,
  value,
  pct,
}: {
  label: string;
  value: string;
  pct: number;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
        <Mono className="text-[10px] text-[var(--text-tertiary)]">{value}</Mono>
      </div>
      <div className="rk-progress-track h-2">
        <div
          className="rk-progress-fill"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  to?: string;
}) {
  const content = (
    <>
      <Icon className="mb-2 size-3.5 text-[var(--accent-primary)]" />
      <div className="font-mono text-sm text-[var(--text-primary)]">
        {value}
      </div>
      <div className="text-[10px] text-[var(--text-tertiary)]">{label}</div>
    </>
  );
  if (to) {
    return (
      <Link to={to} className="rk-list-row block p-2">
        {content}
      </Link>
    );
  }
  return <div className="rk-list-row p-2">{content}</div>;
}

function GapRow({
  to,
  label,
  value,
}: {
  to: string;
  label: string;
  value: number;
}) {
  return (
    <Link
      to={to}
      className="rk-list-row flex items-center justify-between gap-3 px-3 py-2 text-sm"
    >
      <span className="text-[var(--text-secondary)]">{label}</span>
      <Mono className="text-[var(--text-primary)]">{value}</Mono>
    </Link>
  );
}

function statusPriority(status: string) {
  if (status === "offline") return 0;
  if (status === "warning") return 1;
  if (status === "unknown") return 2;
  return 3;
}
