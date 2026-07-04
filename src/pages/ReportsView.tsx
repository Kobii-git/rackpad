import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Cable,
  Download,
  FileSpreadsheet,
  Network,
  Printer,
  Server,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
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
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { Mono } from "@/components/shared/Mono";
import { StatusDot } from "@/components/shared/StatusDot";
import { useStore } from "@/lib/store";
import { summarizeNetworkCapacity } from "@/lib/report-capacity";
import type {
  Device,
  DeviceMonitor,
  IpAssignment,
  Port,
  PortLink,
  Rack,
  Room,
  Subnet,
  Vlan,
  VirtualSwitch,
  WifiAccessPoint,
  WifiClientAssociation,
  WifiController,
  WifiSsid,
} from "@/lib/types";
import { formatDeviceAddress } from "@/lib/network-labels";
import {
  cidrSize,
  formatBandwidthMbps,
  formatPortEndpointLabel,
  relativeTime,
  statusLabel,
} from "@/lib/utils";

type CsvValue = string | number | boolean | null | undefined;
type CsvRows = CsvValue[][];

const REPORT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function ReportsView() {
  const { t } = useI18n();
  const lab = useStore((s) => s.lab);
  const rooms = useStore((s) => s.rooms);
  const racks = useStore((s) => s.racks);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const portLinks = useStore((s) => s.portLinks);
  const virtualSwitches = useStore((s) => s.virtualSwitches);
  const vlans = useStore((s) => s.vlans);
  const vlanRanges = useStore((s) => s.vlanRanges);
  const subnets = useStore((s) => s.subnets);
  const scopes = useStore((s) => s.scopes);
  const ipZones = useStore((s) => s.ipZones);
  const ipAssignments = useStore((s) => s.ipAssignments);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const discoveredDevices = useStore((s) => s.discoveredDevices);
  const wifiControllers = useStore((s) => s.wifiControllers);
  const wifiSsids = useStore((s) => s.wifiSsids);
  const wifiAccessPoints = useStore((s) => s.wifiAccessPoints);
  const wifiRadios = useStore((s) => s.wifiRadios);
  const wifiClientAssociations = useStore((s) => s.wifiClientAssociations);
  const auditLog = useStore((s) => s.auditLog);

  const model = useMemo(() => {
    const rackById = indexById(racks);
    const roomById = indexById(rooms);
    const deviceById = indexById(devices);
    const portById = indexById(ports);
    const vlanById = indexById(vlans);
    const subnetById = indexById(subnets);
    const virtualSwitchById = indexById(virtualSwitches);
    const linksByPortId = buildLinksByPortId(portLinks);
    const portsByDeviceId = groupBy(ports, (port) => port.deviceId);
    const monitorsByDeviceId = groupBy(
      deviceMonitors.filter(
        (monitor) => monitor.enabled && monitor.type !== "none",
      ),
      (monitor) => monitor.deviceId,
    );
    const ssidById = indexById(wifiSsids);

    const linkedPorts = ports.filter(
      (port) => port.linkState === "up" || linksByPortId.has(port.id),
    ).length;
    const { capacityMbps, linkedCapacityMbps } = summarizeNetworkCapacity(
      ports,
      devices,
    );
    const usableIpCount = subnets.reduce(
      (sum, subnet) => sum + Math.max(0, cidrSize(subnet.cidr) - 2),
      0,
    );
    const monitorTargets = deviceMonitors.filter(
      (monitor) => monitor.enabled && monitor.type !== "none",
    );
    const monitorFailures = monitorTargets.filter(
      (monitor) => monitor.lastResult === "offline",
    );
    const devicesByStatus = countBy(devices, (device) => device.status);
    const devicesByType = countBy(devices, (device) => device.deviceType);
    const rackRows = racks.map((rack) => {
      const rackDevices = devices.filter(
        (device) => device.rackId === rack.id && device.placement === "rack",
      );
      const usedU = rackDevices.reduce(
        (sum, device) => sum + (device.heightU ?? 1),
        0,
      );
      return {
        rack,
        room: rack.roomId ? roomById[rack.roomId] : undefined,
        devices: rackDevices.length,
        usedU,
        freeU: Math.max(0, rack.totalU - usedU),
        utilization: Math.round((usedU / Math.max(1, rack.totalU)) * 100),
      };
    });

    return {
      rackById,
      roomById,
      deviceById,
      portById,
      vlanById,
      subnetById,
      virtualSwitchById,
      linksByPortId,
      portsByDeviceId,
      monitorsByDeviceId,
      ssidById,
      linkedPorts,
      capacityMbps,
      linkedCapacityMbps,
      usableIpCount,
      monitorTargets,
      monitorFailures,
      devicesByStatus,
      devicesByType,
      rackRows,
    };
  }, [
    deviceMonitors,
    devices,
    portLinks,
    ports,
    racks,
    rooms,
    subnets,
    virtualSwitches,
    vlans,
    wifiSsids,
  ]);

  const reportStamp = REPORT_DATE_FORMAT.format(new Date());

  function downloadReportCsv() {
    downloadCsv(
      `${slug(lab.name)}-rackpad-report.csv`,
      buildFullReportCsv({
        labName: lab.name,
        generatedAt: reportStamp,
        racks,
        devices,
        ports,
        portLinks,
        vlans,
        subnets,
        scopes,
        ipZones,
        ipAssignments,
        deviceMonitors,
        wifiControllers,
        wifiSsids,
        wifiAccessPoints,
        wifiClientAssociations,
        rackById: model.rackById,
        deviceById: model.deviceById,
        portById: model.portById,
        vlanById: model.vlanById,
        subnetById: model.subnetById,
        virtualSwitchById: model.virtualSwitchById,
        ssidById: model.ssidById,
      }),
    );
  }

  function downloadReportWorkbook() {
    const workbookInput = {
      labName: lab.name,
      generatedAt: reportStamp,
      racks,
      devices,
      ports,
      portLinks,
      vlans,
      subnets,
      scopes,
      ipZones,
      ipAssignments,
      deviceMonitors,
      wifiControllers,
      wifiSsids,
      wifiAccessPoints,
      wifiClientAssociations,
      rackById: model.rackById,
      deviceById: model.deviceById,
      portById: model.portById,
      vlanById: model.vlanById,
      subnetById: model.subnetById,
      virtualSwitchById: model.virtualSwitchById,
      ssidById: model.ssidById,
    };

    downloadExcelWorkbook(`${slug(lab.name)}-rackpad-report.xls`, [
      {
        name: t("Summary"),
        rows: buildSummaryRows(workbookInput),
      },
      {
        name: t("Devices"),
        rows: buildDevicesCsv({
          devices,
          rackById: model.rackById,
          deviceById: model.deviceById,
          portsByDeviceId: model.portsByDeviceId,
        }),
      },
      {
        name: t("Ports Cables"),
        rows: buildPortsCsv({
          ports,
          portLinks,
          deviceById: model.deviceById,
          portById: model.portById,
          vlanById: model.vlanById,
          virtualSwitchById: model.virtualSwitchById,
        }),
      },
      {
        name: t("IPAM"),
        rows: buildIpamCsv({
          subnets,
          vlans,
          scopes,
          ipZones,
          ipAssignments,
          deviceById: model.deviceById,
          subnetById: model.subnetById,
          vlanById: model.vlanById,
        }),
      },
      {
        name: t("Monitoring"),
        rows: buildMonitoringCsv({
          monitors: deviceMonitors,
          deviceById: model.deviceById,
        }),
      },
      {
        name: t("WiFi"),
        rows: buildWifiCsv({
          wifiControllers,
          wifiSsids,
          wifiAccessPoints,
          wifiClientAssociations,
          deviceById: model.deviceById,
          ssidById: model.ssidById,
        }),
      },
    ]);
  }

  return (
    <>
      <TopBar
        subtitle={t("Reporting")}
        title={t("Reports")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {t("{lab} | generated {stamp}", {
              lab: lab.name,
              stamp: reportStamp,
            })}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadReportWorkbook}
            >
              <FileSpreadsheet className="size-3.5" />
              {t("Excel")}
            </Button>
            <Button variant="outline" size="sm" onClick={downloadReportCsv}>
              <Download className="size-3.5" />
              {t("Full CSV")}
            </Button>
            <Button variant="default" size="sm" onClick={() => window.print()}>
              <Printer className="size-3.5" />
              {t("Print / PDF")}
            </Button>
          </div>
        }
      />

      <div className="reports-page flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-7xl space-y-5">
          <Card className="reports-hero">
            <CardBody className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="rk-kicker">{t("Rackpad inventory report")}</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
                    {lab.name}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-[var(--text-tertiary)]">
                    {t(
                      "A live report generated from the current Rackpad inventory: physical placement, network links, IPAM, WiFi, monitoring, and recent operational context.",
                    )}
                  </p>
                </div>
                <div className="rk-panel-inset min-w-52 rounded-[var(--radius-md)] p-3 text-right">
                  <div className="rk-kicker">{t("Generated")}</div>
                  <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">
                    {reportStamp}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                    {t("Print this page to save a PDF.")}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ReportMetric
              icon={Server}
              label={t("Devices")}
              value={devices.length}
              hint={t("{online} online | {warning} warning", {
                online: model.devicesByStatus.online ?? 0,
                warning: model.devicesByStatus.warning ?? 0,
              })}
            />
            <ReportMetric
              icon={Cable}
              label={t("Ports linked")}
              value={`${model.linkedPorts}/${ports.length}`}
              hint={t("{count} documented cables", {
                count: portLinks.length,
              })}
            />
            <ReportMetric
              icon={Network}
              label={t("IPs allocated")}
              value={`${ipAssignments.length}/${model.usableIpCount}`}
              hint={t("{subnets} subnets | {vlans} VLANs", {
                subnets: subnets.length,
                vlans: vlans.length,
              })}
            />
            <ReportMetric
              icon={Activity}
              label={t("Monitor targets")}
              value={model.monitorTargets.length}
              hint={t("{count} failing right now", {
                count: model.monitorFailures.length,
              })}
              tone={model.monitorFailures.length > 0 ? "err" : "ok"}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
            <ReportSection
              label={t("Inventory")}
              title={t("Device and rack posture")}
              action={
                <ExportButton
                  label={t("Devices CSV")}
                  onClick={() =>
                    downloadCsv(
                      `${slug(lab.name)}-devices.csv`,
                      buildDevicesCsv({
                        devices,
                        rackById: model.rackById,
                        deviceById: model.deviceById,
                        portsByDeviceId: model.portsByDeviceId,
                      }),
                    )
                  }
                />
              }
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
                  <div className="rk-kicker">{t("By status")}</div>
                  <div className="mt-3 space-y-2">
                    {Object.entries(statusLabel).map(([status, label]) => (
                      <ReportBar
                        key={status}
                        label={t(label as TranslationKey)}
                        value={model.devicesByStatus[status] ?? 0}
                        total={Math.max(1, devices.length)}
                        tone={statusTone(status)}
                      />
                    ))}
                  </div>
                </div>

                <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
                  <div className="rk-kicker">{t("By type")}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {Object.entries(model.devicesByType)
                      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                      .map(([type, count]) => (
                        <div
                          key={type}
                          className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-2.5 py-2"
                        >
                          <DeviceTypeIcon
                            type={type as never}
                            className="size-4 text-[var(--accent-primary)]"
                          />
                          <span className="min-w-0 flex-1 truncate text-xs capitalize text-[var(--text-secondary)]">
                            {type.replace("_", " ")}
                          </span>
                          <Mono className="text-[var(--text-primary)]">
                            {count}
                          </Mono>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div className="rk-table-shell mt-4">
                <table className="rk-table">
                  <thead>
                    <tr>
                      <th>{t("Rack")}</th>
                      <th>{t("Room")}</th>
                      <th>{t("Location")}</th>
                      <th>{t("Devices")}</th>
                      <th>{t("Used U")}</th>
                      <th>{t("Free U")}</th>
                      <th>{t("Utilization")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.rackRows.map((row) => (
                      <tr key={row.rack.id}>
                        <td className="font-medium text-[var(--text-primary)]">
                          <Link
                            to={`/racks?rackId=${row.rack.id}`}
                            className="hover:underline"
                          >
                            {row.rack.name}
                          </Link>
                        </td>
                        <td>
                          {row.room ? (
                            <Link
                              to={`/racks?roomId=${row.room.id}`}
                              className="hover:underline"
                            >
                              {row.room.name}
                            </Link>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>{row.rack.location ?? "-"}</td>
                        <td>
                          <Mono>{row.devices}</Mono>
                        </td>
                        <td>
                          <Mono>
                            {row.usedU}/{row.rack.totalU}
                          </Mono>
                        </td>
                        <td>
                          <Mono>{row.freeU}</Mono>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="rk-progress-track h-1.5 w-28">
                              <div
                                className="rk-progress-fill"
                                style={{ width: `${row.utilization}%` }}
                              />
                            </div>
                            <Mono>{row.utilization}%</Mono>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {model.rackRows.length === 0 && (
                  <EmptyReportRow message={t("No racks documented yet.")} />
                )}
              </div>
            </ReportSection>

            <ReportSection
              label={t("Operations")}
              title={t("Monitoring posture")}
              action={
                <ExportButton
                  label={t("Monitoring CSV")}
                  onClick={() =>
                    downloadCsv(
                      `${slug(lab.name)}-monitoring.csv`,
                      buildMonitoringCsv({
                        monitors: deviceMonitors,
                        deviceById: model.deviceById,
                      }),
                    )
                  }
                />
              }
            >
              <div className="reports-scroll-region max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                {model.monitorTargets.length === 0 ? (
                  <EmptyState
                    icon={Activity}
                    title={t("No monitor targets configured")}
                    description={t(
                      "Add ICMP, TCP, HTTP, or HTTPS targets to devices to make this report operationally useful.",
                    )}
                  />
                ) : (
                  devices
                    .filter(
                      (device) =>
                        (model.monitorsByDeviceId[device.id] ?? []).length > 0,
                    )
                    .map((device) => (
                      <div
                        key={device.id}
                        className="rk-panel-inset rounded-[var(--radius-md)] p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <DeviceTypeIcon
                              type={device.deviceType}
                              className="size-4 text-[var(--accent-primary)]"
                            />
                            <Link
                              to={`/devices/${device.id}`}
                              className="truncate text-sm font-medium text-[var(--text-primary)] hover:underline"
                            >
                              {device.hostname}
                            </Link>
                            <Badge tone={statusBadgeTone(device.status)}>
                              <StatusDot status={device.status} />
                              {t(statusLabel[device.status] as TranslationKey)}
                            </Badge>
                          </div>
                          <Mono className="text-[var(--text-tertiary)]">
                            {t("{count} targets", {
                              count: (model.monitorsByDeviceId[device.id] ?? [])
                                .length,
                            })}
                          </Mono>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {(model.monitorsByDeviceId[device.id] ?? []).map(
                            (monitor) => (
                              <div
                                key={monitor.id}
                                className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-[rgb(0_0_0_/_0.16)] px-2.5 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-xs text-[var(--text-primary)]">
                                    {monitor.name}
                                  </div>
                                  <Mono className="text-[10px] text-[var(--text-tertiary)]">
                                    {formatMonitorTarget(monitor)}
                                  </Mono>
                                </div>
                                <Badge
                                  tone={
                                    monitor.lastResult === "online"
                                      ? "ok"
                                      : monitor.lastResult === "offline"
                                        ? "err"
                                        : "neutral"
                                  }
                                >
                                  {monitor.lastResult === "online"
                                    ? t("Online")
                                    : monitor.lastResult === "offline"
                                      ? t("Offline")
                                      : t("Unknown")}
                                </Badge>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </ReportSection>
          </div>

          <ReportSection
            label={t("Network")}
            title={t("Ports, cabling, VLANs, and IPAM")}
            action={
              <div className="flex flex-wrap gap-2">
                <ExportButton
                  label={t("Ports CSV")}
                  onClick={() =>
                    downloadCsv(
                      `${slug(lab.name)}-ports-cables.csv`,
                      buildPortsCsv({
                        ports,
                        portLinks,
                        deviceById: model.deviceById,
                        portById: model.portById,
                        vlanById: model.vlanById,
                        virtualSwitchById: model.virtualSwitchById,
                      }),
                    )
                  }
                />
                <ExportButton
                  label={t("IPAM CSV")}
                  onClick={() =>
                    downloadCsv(
                      `${slug(lab.name)}-ipam.csv`,
                      buildIpamCsv({
                        subnets,
                        vlans,
                        scopes,
                        ipZones,
                        ipAssignments,
                        deviceById: model.deviceById,
                        subnetById: model.subnetById,
                        vlanById: model.vlanById,
                      }),
                    )
                  }
                />
              </div>
            }
          >
            <div className="grid gap-4 xl:grid-cols-3">
              <NetworkTile
                label={t("Configured capacity")}
                value={formatBandwidthMbps(model.capacityMbps)}
                hint={t("{count} ports documented", { count: ports.length })}
              />
              <NetworkTile
                label={t("Linked capacity")}
                value={formatBandwidthMbps(model.linkedCapacityMbps)}
                hint={t("{count} ports are linked or cabled", {
                  count: model.linkedPorts,
                })}
              />
              <NetworkTile
                label={t("Address utilization")}
                value={`${ipAssignments.length}/${model.usableIpCount}`}
                hint={t("{subnets} subnets and {ranges} VLAN ranges", {
                  subnets: subnets.length,
                  ranges: vlanRanges.length,
                })}
              />
            </div>

            <div className="rk-table-shell mt-4">
              <table className="rk-table">
                <thead>
                  <tr>
                    <th>{t("Subnet")}</th>
                    <th>{t("VLAN")}</th>
                    <th>{t("Assigned")}</th>
                    <th>{t("DHCP")}</th>
                    <th>{t("Zones")}</th>
                    <th>{t("Utilization")}</th>
                  </tr>
                </thead>
                <tbody>
                  {subnets.map((subnet) => {
                    const assigned = ipAssignments.filter(
                      (entry) => entry.subnetId === subnet.id,
                    ).length;
                    const total = Math.max(0, cidrSize(subnet.cidr) - 2);
                    const vlan = subnet.vlanId
                      ? model.vlanById[subnet.vlanId]
                      : undefined;
                    const pct = Math.round(
                      (assigned / Math.max(1, total)) * 100,
                    );
                    return (
                      <tr key={subnet.id}>
                        <td>
                          <div className="font-medium text-[var(--text-primary)]">
                            {subnet.name}
                          </div>
                          <Mono>{subnet.cidr}</Mono>
                        </td>
                        <td>
                          {vlan ? (
                            <Badge tone="info">
                              {t("VLAN {number}", { number: vlan.vlanId })}
                            </Badge>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td>
                          <Mono>{assigned}</Mono>
                        </td>
                        <td>
                          <Mono>
                            {
                              scopes.filter(
                                (scope) => scope.subnetId === subnet.id,
                              ).length
                            }
                          </Mono>
                        </td>
                        <td>
                          <Mono>
                            {
                              ipZones.filter(
                                (zone) => zone.subnetId === subnet.id,
                              ).length
                            }
                          </Mono>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="rk-progress-track h-1.5 w-32">
                              <div
                                className="rk-progress-fill"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <Mono>{pct}%</Mono>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {subnets.length === 0 && (
                <EmptyReportRow message={t("No subnets documented yet")} />
              )}
            </div>
          </ReportSection>

          <ReportSection
            label={t("Wireless")}
            title={t("WiFi controllers, SSIDs, and clients")}
            action={
              <ExportButton
                label={t("WiFi CSV")}
                onClick={() =>
                  downloadCsv(
                    `${slug(lab.name)}-wifi.csv`,
                    buildWifiCsv({
                      wifiControllers,
                      wifiSsids,
                      wifiAccessPoints,
                      wifiClientAssociations,
                      deviceById: model.deviceById,
                      ssidById: model.ssidById,
                    }),
                  )
                }
              />
            }
          >
            <div className="grid gap-3 md:grid-cols-4">
              <NetworkTile
                label={t("Controllers")}
                value={wifiControllers.length}
                hint={t("wireless control planes")}
              />
              <NetworkTile
                label={t("SSIDs")}
                value={wifiSsids.length}
                hint={t("broadcast networks")}
              />
              <NetworkTile
                label={t("APs")}
                value={wifiAccessPoints.length}
                hint={t("{count} radios documented", {
                  count: wifiRadios.length,
                })}
              />
              <NetworkTile
                label={t("Clients")}
                value={wifiClientAssociations.length}
                hint={t("associated wireless devices")}
              />
            </div>
          </ReportSection>

          <ReportSection label={t("Activity")} title={t("Recent changes")}>
            <div className="space-y-2">
              {auditLog.slice(0, 12).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-4 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-[var(--text-primary)]">
                      {entry.summary}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Mono className="text-[10px] text-[var(--text-tertiary)]">
                        {entry.user}
                      </Mono>
                      <Mono className="text-[10px] text-[var(--text-tertiary)]">
                        {entry.action}
                      </Mono>
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]">
                    {relativeTime(entry.ts)}
                  </span>
                </div>
              ))}
              {auditLog.length === 0 && (
                <EmptyState
                  icon={Activity}
                  title={t("No recent activity")}
                  description={t(
                    "Changes will appear here as Rackpad records audit events.",
                  )}
                />
              )}
            </div>
          </ReportSection>

          <div className="print-only space-y-6">
            <ReportPrintSection
              title={t("Devices")}
              rows={buildDevicesPrintRows({
                devices,
                rackById: model.rackById,
                roomById: model.roomById,
                deviceById: model.deviceById,
                portsByDeviceId: model.portsByDeviceId,
              })}
            />
            <ReportPrintSection
              title={t("Ports Cables")}
              rows={buildPortsCsv({
                ports,
                portLinks,
                deviceById: model.deviceById,
                portById: model.portById,
                vlanById: model.vlanById,
                virtualSwitchById: model.virtualSwitchById,
              })}
            />
            <ReportPrintSection
              title={t("IPAM")}
              rows={buildIpamCsv({
                subnets,
                vlans,
                scopes,
                ipZones,
                ipAssignments,
                deviceById: model.deviceById,
                subnetById: model.subnetById,
                vlanById: model.vlanById,
              })}
            />
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.015)] px-4 py-3 text-xs text-[var(--text-tertiary)]">
            {t(
              "This report excludes local user password hashes and notification secrets. Use the admin backup export for full restore snapshots. Discovery inbox rows: {count}.",
              { count: discoveredDevices.length },
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ReportMetric({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: typeof Server;
  label: string;
  value: string | number;
  hint: string;
  tone?: "neutral" | "ok" | "err";
}) {
  const toneClass =
    tone === "ok"
      ? "text-[var(--success)]"
      : tone === "err"
        ? "text-[var(--danger)]"
        : "text-[var(--text-primary)]";

  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="rk-kicker">{label}</div>
            <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>
              {value}
            </div>
            <div className="mt-1 text-xs text-[var(--text-tertiary)]">
              {hint}
            </div>
          </div>
          <div className="grid size-9 place-items-center rounded-[var(--radius-md)] border border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]">
            <Icon className="size-4" />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ReportSection({
  label,
  title,
  action,
  children,
}: {
  label: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="reports-section">
      <CardHeader>
        <CardTitle>
          <CardLabel>{label}</CardLabel>
          <CardHeading>{title}</CardHeading>
        </CardTitle>
        <div className="reports-actions">{action}</div>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function ExportButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Download className="size-3.5" />
      {label}
    </Button>
  );
}

function ReportBar({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
}) {
  const pct = Math.round((value / total) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
        <Mono className="text-[var(--text-primary)]">{value}</Mono>
      </div>
      <div className="rk-progress-track h-1.5">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: tone }}
        />
      </div>
    </div>
  );
}

function NetworkTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
      <div className="rk-kicker">{label}</div>
      <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">{hint}</div>
    </div>
  );
}

function EmptyReportRow({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center text-xs text-[var(--text-tertiary)]">
      {message}
    </div>
  );
}

function ReportPrintSection({ title, rows }: { title: string; rows: CsvRows }) {
  if (rows.length <= 1) return null;
  const [headers, ...body] = rows;

  return (
    <section className="report-print-section">
      <h3>{title}</h3>
      <div className="rk-table-shell">
        <table className="rk-table report-print-table">
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={index}>{header == null ? "" : String(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    {cell == null || cell === "" ? "-" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDevicePlacementLabel(
  device: Device,
  rackById: Record<string, Rack>,
  roomById: Record<string, Room>,
  deviceById: Record<string, Device>,
) {
  const rack = device.rackId ? rackById[device.rackId] : undefined;
  const room = device.roomId ? roomById[device.roomId] : undefined;
  const parentDevice = device.parentDeviceId
    ? deviceById[device.parentDeviceId]
    : undefined;

  if (device.placement === "virtual") {
    return parentDevice ? `Virtual | ${parentDevice.hostname}` : "Virtual";
  }

  if (device.placement === "wireless") {
    return parentDevice ? `WiFi | ${parentDevice.hostname}` : "WiFi";
  }

  if (device.placement === "shelf") {
    return [
      "Shelf",
      parentDevice?.hostname,
      rack?.name,
      device.startU ? `U${device.startU}` : undefined,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  if (rack && device.startU) {
    return `${rack.name} | U${device.startU}`;
  }

  if (device.placement === "rack") return "Pending placement";
  return room ? `Room | ${room.name}` : "Loose / room";
}

function buildDevicesPrintRows({
  devices,
  rackById,
  roomById,
  deviceById,
  portsByDeviceId,
}: {
  devices: Device[];
  rackById: Record<string, Rack>;
  roomById: Record<string, Room>;
  deviceById: Record<string, Device>;
  portsByDeviceId: Record<string, Port[]>;
}): CsvRows {
  const rows = buildDevicesCsv({
    devices,
    rackById,
    deviceById,
    portsByDeviceId,
  });
  if (rows.length <= 1) return rows;

  const [header, ...body] = rows;
  const placementIndex = header.indexOf("Placement");
  const formattedBody = body.map((row, index) => {
    const device = devices[index];
    if (!device || placementIndex < 0) return row;
    const nextRow = [...row];
    nextRow[placementIndex] = formatDevicePlacementLabel(
      device,
      rackById,
      roomById,
      deviceById,
    );
    return nextRow;
  });

  return [header, ...formattedBody];
}

function buildDevicesCsv({
  devices,
  rackById,
  deviceById,
  portsByDeviceId,
}: {
  devices: Device[];
  rackById: Record<string, Rack>;
  deviceById: Record<string, Device>;
  portsByDeviceId: Record<string, Port[]>;
}): CsvRows {
  return [
    [
      "Hostname",
      "Display name",
      "Type",
      "Status",
      "Management IP",
      "MAC address",
      "Manufacturer",
      "Model",
      "Placement",
      "Rack",
      "Start U",
      "Height U",
      "Parent device",
      "Ports",
      "Linked ports",
      "CPU cores",
      "Memory GB",
      "Storage GB",
      "Tags",
      "Notes",
    ],
    ...devices.map((device) => {
      const devicePorts = portsByDeviceId[device.id] ?? [];
      const rack = device.rackId ? rackById[device.rackId] : undefined;
      const parent = device.parentDeviceId
        ? deviceById[device.parentDeviceId]
        : undefined;
      return [
        device.hostname,
        device.displayName,
        device.deviceType,
        device.status,
        device.managementIp,
        device.macAddress,
        device.manufacturer,
        device.model,
        device.placement,
        rack?.name,
        device.startU,
        device.heightU,
        parent?.hostname,
        devicePorts.length,
        devicePorts.filter((port) => port.linkState === "up").length,
        device.cpuCores,
        device.memoryGb,
        device.storageGb,
        device.tags?.join(", "),
        device.notes,
      ];
    }),
  ];
}

function buildPortsCsv({
  ports,
  portLinks,
  deviceById,
  portById,
  vlanById,
  virtualSwitchById,
}: {
  ports: Port[];
  portLinks: PortLink[];
  deviceById: Record<string, Device>;
  portById: Record<string, Port>;
  vlanById: Record<string, Vlan>;
  virtualSwitchById: Record<string, VirtualSwitch>;
}): CsvRows {
  const linksByPortId = buildLinksByPortId(portLinks);
  return [
    [
      "Device",
      "Port",
      "Kind",
      "Speed",
      "Face",
      "Link state",
      "Mode",
      "Native VLAN",
      "Tagged VLANs",
      "Virtual switch",
      "Linked endpoint",
      "Cable type",
      "Cable length",
      "Cable color",
      "Description",
    ],
    ...ports.map((port) => {
      const device = deviceById[port.deviceId];
      const link = linksByPortId.get(port.id);
      const peerPortId =
        link?.fromPortId === port.id ? link.toPortId : link?.fromPortId;
      const peerPort = peerPortId ? portById[peerPortId] : undefined;
      const peerDevice = peerPort ? deviceById[peerPort.deviceId] : undefined;
      const taggedVlans = (port.allowedVlanIds ?? [])
        .map((id) => formatVlan(vlanById[id]))
        .join(", ");
      return [
        device?.hostname,
        port.name,
        port.kind,
        port.speed,
        port.face,
        port.linkState,
        port.mode,
        formatVlan(port.vlanId ? vlanById[port.vlanId] : undefined),
        taggedVlans,
        port.virtualSwitchId
          ? virtualSwitchById[port.virtualSwitchId]?.name
          : "",
        peerPort
          ? formatPortEndpointLabel(peerPort, peerDevice, {
              includeFace: true,
              includeSpeed: true,
            })
          : "",
        link?.cableType,
        link?.cableLength,
        link?.color,
        port.description,
      ];
    }),
  ];
}

function buildIpamCsv({
  subnets,
  vlans,
  scopes,
  ipZones,
  ipAssignments,
  deviceById,
  subnetById,
  vlanById,
}: {
  subnets: Subnet[];
  vlans: Vlan[];
  scopes: Array<{
    subnetId: string;
    name: string;
    startIp: string;
    endIp: string;
  }>;
  ipZones: Array<{
    subnetId: string;
    kind: string;
    startIp: string;
    endIp: string;
  }>;
  ipAssignments: IpAssignment[];
  deviceById: Record<string, Device>;
  subnetById: Record<string, Subnet>;
  vlanById: Record<string, Vlan>;
}): CsvRows {
  return [
    ["Section", "Subnet", "VLAN", "Address", "Kind", "Name", "Device", "Notes"],
    ...subnets.map((subnet) => [
      "subnet",
      subnet.cidr,
      formatVlan(subnet.vlanId ? vlanById[subnet.vlanId] : undefined),
      "",
      "",
      subnet.name,
      "",
      subnet.description,
    ]),
    ...vlans.map((vlan) => [
      "vlan",
      "",
      formatVlan(vlan),
      "",
      "",
      vlan.name,
      "",
      vlan.description,
    ]),
    ...scopes.map((scope) => {
      const subnet = subnetById[scope.subnetId];
      return [
        "dhcp",
        subnet?.cidr,
        formatVlan(subnet?.vlanId ? vlanById[subnet.vlanId] : undefined),
        `${scope.startIp}-${scope.endIp}`,
        "dhcp",
        scope.name,
        "",
        "",
      ];
    }),
    ...ipZones.map((zone) => {
      const subnet = subnetById[zone.subnetId];
      return [
        "zone",
        subnet?.cidr,
        formatVlan(subnet?.vlanId ? vlanById[subnet.vlanId] : undefined),
        `${zone.startIp}-${zone.endIp}`,
        zone.kind,
        "",
        "",
        "",
      ];
    }),
    ...ipAssignments.map((assignment) => {
      const subnet = subnetById[assignment.subnetId];
      const device = assignment.deviceId
        ? deviceById[assignment.deviceId]
        : undefined;
      return [
        "assignment",
        subnet?.cidr,
        formatVlan(subnet?.vlanId ? vlanById[subnet.vlanId] : undefined),
        assignment.ipAddress,
        assignment.assignmentType,
        assignment.hostname,
        device?.hostname,
        assignment.description,
      ];
    }),
  ];
}

function buildMonitoringCsv({
  monitors,
  deviceById,
}: {
  monitors: DeviceMonitor[];
  deviceById: Record<string, Device>;
}): CsvRows {
  return [
    [
      "Device",
      "Monitor",
      "Type",
      "Target",
      "Enabled",
      "Last result",
      "Last check",
      "Last alert",
      "Message",
    ],
    ...monitors.map((monitor) => {
      const device = deviceById[monitor.deviceId];
      return [
        device?.hostname,
        monitor.name,
        monitor.type,
        formatMonitorTarget(monitor),
        monitor.enabled,
        monitor.lastResult,
        monitor.lastCheckAt,
        monitor.lastAlertAt,
        monitor.lastMessage,
      ];
    }),
  ];
}

function buildWifiCsv({
  wifiControllers,
  wifiSsids,
  wifiAccessPoints,
  wifiClientAssociations,
  deviceById,
  ssidById,
}: {
  wifiControllers: WifiController[];
  wifiSsids: WifiSsid[];
  wifiAccessPoints: WifiAccessPoint[];
  wifiClientAssociations: WifiClientAssociation[];
  deviceById: Record<string, Device>;
  ssidById: Record<string, WifiSsid>;
}): CsvRows {
  return [
    [
      "Section",
      "Name",
      "Device",
      "IP / MAC",
      "SSID",
      "Band",
      "Signal",
      "Notes",
    ],
    ...wifiControllers.map((controller) => [
      "controller",
      controller.name,
      controller.deviceId ? deviceById[controller.deviceId]?.hostname : "",
      formatDeviceAddress({
        managementIp: controller.managementIp ?? undefined,
        macAddress: controller.deviceId
          ? deviceById[controller.deviceId]?.macAddress
          : null,
      }),
      "",
      "",
      "",
      controller.notes,
    ]),
    ...wifiSsids.map((ssid) => [
      "ssid",
      ssid.name,
      "",
      "",
      ssid.name,
      "",
      "",
      ssid.purpose,
    ]),
    ...wifiAccessPoints.map((ap) => {
      const device = deviceById[ap.deviceId];
      return [
        "ap",
        device?.hostname,
        device?.hostname,
        device ? formatDeviceAddress(device) : "",
        "",
        "",
        "",
        ap.location,
      ];
    }),
    ...wifiClientAssociations.map((association) => {
      const client = deviceById[association.clientDeviceId];
      const ap = deviceById[association.apDeviceId];
      const ssid = association.ssidId
        ? ssidById[association.ssidId]
        : undefined;
      return [
        "client",
        client?.hostname,
        ap?.hostname,
        client ? formatDeviceAddress(client) : "",
        ssid?.name,
        association.band,
        association.signalDbm,
        association.notes,
      ];
    }),
  ];
}

function buildFullReportCsv(input: {
  labName: string;
  generatedAt: string;
  racks: Rack[];
  devices: Device[];
  ports: Port[];
  portLinks: PortLink[];
  vlans: Vlan[];
  subnets: Subnet[];
  scopes: Array<{
    subnetId: string;
    name: string;
    startIp: string;
    endIp: string;
  }>;
  ipZones: Array<{
    subnetId: string;
    kind: string;
    startIp: string;
    endIp: string;
  }>;
  ipAssignments: IpAssignment[];
  deviceMonitors: DeviceMonitor[];
  wifiControllers: WifiController[];
  wifiSsids: WifiSsid[];
  wifiAccessPoints: WifiAccessPoint[];
  wifiClientAssociations: WifiClientAssociation[];
  rackById: Record<string, Rack>;
  deviceById: Record<string, Device>;
  portById: Record<string, Port>;
  vlanById: Record<string, Vlan>;
  subnetById: Record<string, Subnet>;
  virtualSwitchById: Record<string, VirtualSwitch>;
  ssidById: Record<string, WifiSsid>;
}): CsvRows {
  return [
    ["Rackpad report", input.labName],
    ["Generated", input.generatedAt],
    [],
    ["Summary"],
    ["Racks", input.racks.length],
    ["Devices", input.devices.length],
    ["Ports", input.ports.length],
    ["Cables", input.portLinks.length],
    ["VLANs", input.vlans.length],
    ["Subnets", input.subnets.length],
    ["IP assignments", input.ipAssignments.length],
    ["Monitor targets", input.deviceMonitors.length],
    ["WiFi controllers", input.wifiControllers.length],
    ["WiFi SSIDs", input.wifiSsids.length],
    ["WiFi clients", input.wifiClientAssociations.length],
    [],
    ...withSection(
      "Devices",
      buildDevicesCsv({
        devices: input.devices,
        rackById: input.rackById,
        deviceById: input.deviceById,
        portsByDeviceId: groupBy(input.ports, (port) => port.deviceId),
      }),
    ),
    [],
    ...withSection(
      "Ports and cables",
      buildPortsCsv({
        ports: input.ports,
        portLinks: input.portLinks,
        deviceById: input.deviceById,
        portById: input.portById,
        vlanById: input.vlanById,
        virtualSwitchById: input.virtualSwitchById,
      }),
    ),
    [],
    ...withSection(
      "IPAM",
      buildIpamCsv({
        subnets: input.subnets,
        vlans: input.vlans,
        scopes: input.scopes,
        ipZones: input.ipZones,
        ipAssignments: input.ipAssignments,
        deviceById: input.deviceById,
        subnetById: input.subnetById,
        vlanById: input.vlanById,
      }),
    ),
    [],
    ...withSection(
      "Monitoring",
      buildMonitoringCsv({
        monitors: input.deviceMonitors,
        deviceById: input.deviceById,
      }),
    ),
    [],
    ...withSection(
      "WiFi",
      buildWifiCsv({
        wifiControllers: input.wifiControllers,
        wifiSsids: input.wifiSsids,
        wifiAccessPoints: input.wifiAccessPoints,
        wifiClientAssociations: input.wifiClientAssociations,
        deviceById: input.deviceById,
        ssidById: input.ssidById,
      }),
    ),
  ];
}

function withSection(name: string, rows: CsvRows): CsvRows {
  return [[name], ...rows];
}

function buildSummaryRows(input: Parameters<typeof buildFullReportCsv>[0]) {
  return [
    ["Rackpad report", input.labName],
    ["Generated", input.generatedAt],
    [],
    ["Metric", "Value"],
    ["Racks", input.racks.length],
    ["Devices", input.devices.length],
    ["Ports", input.ports.length],
    ["Cables", input.portLinks.length],
    ["VLANs", input.vlans.length],
    ["Subnets", input.subnets.length],
    ["IP assignments", input.ipAssignments.length],
    ["Monitor targets", input.deviceMonitors.length],
    ["WiFi controllers", input.wifiControllers.length],
    ["WiFi SSIDs", input.wifiSsids.length],
    ["WiFi clients", input.wifiClientAssociations.length],
  ];
}

function downloadExcelWorkbook(
  filename: string,
  sheets: Array<{ name: string; rows: CsvRows }>,
) {
  downloadBlob(
    filename,
    toExcelWorkbookXml(sheets),
    "application/vnd.ms-excel;charset=utf-8",
  );
}

function downloadCsv(filename: string, rows: CsvRows) {
  downloadBlob(filename, toCsv(rows), "text/csv;charset=utf-8");
}

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toExcelWorkbookXml(sheets: Array<{ name: string; rows: CsvRows }>) {
  const worksheets = sheets
    .filter((sheet) => sheet.rows.length > 0)
    .map(
      (sheet, index) => `
  <Worksheet ss:Name="${xmlEscape(sheetName(sheet.name, index))}">
    <Table>
${sheet.rows.map(excelRow).join("\n")}
    </Table>
  </Worksheet>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
${worksheets}
</Workbook>`;
}

function excelRow(row: CsvValue[]) {
  return `      <Row>${row.map(excelCell).join("")}</Row>`;
}

function excelCell(value: CsvValue) {
  if (value == null) return '<Cell><Data ss:Type="String"></Data></Cell>';
  const type = typeof value === "number" ? "Number" : "String";
  return `<Cell><Data ss:Type="${type}">${xmlEscape(String(value))}</Data></Cell>`;
}

function sheetName(name: string, index: number) {
  const safe =
    name.replace(/[:\\/?*\[\]]/g, " ").trim() || `Sheet ${index + 1}`;
  return safe.slice(0, 31);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toCsv(rows: CsvRows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: CsvValue) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function indexById<T extends { id: string }>(items: T[]) {
  return items.reduce<Record<string, T>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    (acc[getKey(item)] ??= []).push(item);
    return acc;
  }, {});
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function buildLinksByPortId(portLinks: PortLink[]) {
  const map = new Map<string, PortLink>();
  for (const link of portLinks) {
    map.set(link.fromPortId, link);
    map.set(link.toPortId, link);
  }
  return map;
}

function formatVlan(vlan?: Vlan) {
  return vlan ? `${vlan.vlanId} - ${vlan.name}` : "";
}

function formatMonitorTarget(monitor: DeviceMonitor) {
  if (!monitor.target) return "n/a";
  if (monitor.type === "http" || monitor.type === "https") {
    const port = monitor.port ?? (monitor.type === "https" ? 443 : 80);
    const path = monitor.path?.trim() || "/";
    return `${monitor.type}://${monitor.target}:${port}${path.startsWith("/") ? path : `/${path}`}`;
  }
  if (monitor.type === "tcp") {
    return `${monitor.target}:${monitor.port ?? 22}`;
  }
  if (monitor.type === "snmp") {
    return `snmp://${monitor.target}:${monitor.port ?? 161} ${monitor.snmpOid ?? ""}`.trim();
  }
  return monitor.target;
}

function slug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "rackpad"
  );
}

function statusTone(status: string) {
  switch (status) {
    case "online":
      return "var(--success)";
    case "warning":
      return "var(--warning)";
    case "maintenance":
      return "var(--info)";
    case "offline":
      return "var(--danger)";
    default:
      return "var(--neutral)";
  }
}

function statusBadgeTone(status: string) {
  switch (status) {
    case "online":
      return "ok";
    case "warning":
      return "warn";
    case "offline":
      return "err";
    case "maintenance":
      return "info";
    default:
      return "neutral";
  }
}
