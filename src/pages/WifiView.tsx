import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ColorInput } from "@/components/shared/ColorInput";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { StatusDot } from "@/components/shared/StatusDot";
import {
  canEditInventory,
  createWifiControllerRecord,
  createWifiRadioRecord,
  createWifiSsidRecord,
  deleteWifiClientAssociationRecord,
  deleteWifiControllerRecord,
  deleteWifiRadioRecord,
  deleteWifiSsidRecord,
  saveWifiAccessPointRecord,
  saveWifiClientAssociationRecord,
  updateWifiControllerRecord,
  updateWifiRadioRecord,
  updateWifiSsidRecord,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DeviceStatus,
  Vlan,
  WifiAccessPoint,
  WifiBand,
  WifiClientAssociation,
  WifiController,
  WifiRadio,
  WifiSsid,
} from "@/lib/types";
import { formatDeviceAddress } from "@/lib/network-labels";
import { relativeTime, statusLabel } from "@/lib/utils";
import {
  Link2,
  Pencil,
  Plus,
  Radio,
  Save,
  Trash2,
  Wifi,
  X,
} from "lucide-react";

const BAND_KEYS: Record<WifiBand, TranslationKey> = {
  "2.4ghz": "2.4 GHz",
  "5ghz": "5 GHz",
  "6ghz": "6 GHz",
};

const SELECT_CLASS =
  "rk-control h-8 w-full px-2 text-sm text-[var(--text-primary)]";
const TEXTAREA_CLASS =
  "rk-control rk-textarea min-h-20 w-full text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]";

type DrawerDefaults = {
  deviceType?: Device["deviceType"];
  placement?: NonNullable<Device["placement"]>;
  status?: DeviceStatus;
};

type EditorState =
  | { kind: "controller"; controller?: WifiController }
  | { kind: "ssid"; ssid?: WifiSsid }
  | { kind: "accessPoint"; deviceId: string }
  | { kind: "radio"; apDeviceId: string; radio?: WifiRadio }
  | {
      kind: "association";
      clientDeviceId: string;
      association?: WifiClientAssociation;
    };

function wifiAddressLabel(
  device?: Device | null,
  managementIp?: string | null,
) {
  return formatDeviceAddress({
    managementIp: managementIp ?? device?.managementIp,
    macAddress: device?.macAddress ?? null,
  });
}

export default function WifiView() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const activeLab = useStore((s) => s.lab);
  const devices = useStore((s) => s.devices);
  const vlans = useStore((s) => s.vlans);
  const wifiControllers = useStore((s) => s.wifiControllers);
  const wifiSsids = useStore((s) => s.wifiSsids);
  const wifiAccessPoints = useStore((s) => s.wifiAccessPoints);
  const wifiRadios = useStore((s) => s.wifiRadios);
  const wifiClientAssociations = useStore((s) => s.wifiClientAssociations);
  const canEdit = canEditInventory(currentUser);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDefaults, setDrawerDefaults] = useState<DrawerDefaults>();
  const [editor, setEditor] = useState<EditorState | null>(null);

  const deviceById = useMemo(
    () => Object.fromEntries(devices.map((device) => [device.id, device])),
    [devices],
  );
  const vlanById = useMemo(
    () => Object.fromEntries(vlans.map((vlan) => [vlan.id, vlan])),
    [vlans],
  );
  const controllerById = useMemo(
    () =>
      Object.fromEntries(
        wifiControllers.map((controller) => [controller.id, controller]),
      ),
    [wifiControllers],
  );
  const ssidById = useMemo(
    () => Object.fromEntries(wifiSsids.map((ssid) => [ssid.id, ssid])),
    [wifiSsids],
  );
  const accessPointByDeviceId = useMemo(
    () =>
      Object.fromEntries(
        wifiAccessPoints.map((entry) => [entry.deviceId, entry]),
      ),
    [wifiAccessPoints],
  );
  const radioById = useMemo(
    () => Object.fromEntries(wifiRadios.map((radio) => [radio.id, radio])),
    [wifiRadios],
  );
  const associationByClientId = useMemo(
    () =>
      Object.fromEntries(
        wifiClientAssociations.map((entry) => [entry.clientDeviceId, entry]),
      ),
    [wifiClientAssociations],
  );

  const apDevices = useMemo(
    () =>
      devices
        .filter((device) => device.deviceType === "ap")
        .sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [devices],
  );
  const wirelessClients = useMemo(
    () =>
      devices
        .filter(
          (device) =>
            device.deviceType !== "ap" &&
            (device.placement === "wireless" ||
              wifiClientAssociations.some(
                (entry) => entry.clientDeviceId === device.id,
              )),
        )
        .sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [devices, wifiClientAssociations],
  );

  const radiosByApId = useMemo(() => {
    return wifiRadios.reduce<Record<string, WifiRadio[]>>((acc, radio) => {
      (acc[radio.apDeviceId] ??= []).push(radio);
      return acc;
    }, {});
  }, [wifiRadios]);

  const clientsByApId = useMemo(() => {
    return wifiClientAssociations.reduce<Record<string, Device[]>>(
      (acc, association) => {
        const client = deviceById[association.clientDeviceId];
        if (client) {
          (acc[association.apDeviceId] ??= []).push(client);
        }
        return acc;
      },
      {},
    );
  }, [deviceById, wifiClientAssociations]);

  const apCountByControllerId = useMemo(() => {
    return wifiAccessPoints.reduce<Record<string, number>>(
      (acc, accessPoint) => {
        if (accessPoint.controllerId) {
          acc[accessPoint.controllerId] =
            (acc[accessPoint.controllerId] ?? 0) + 1;
        }
        return acc;
      },
      {},
    );
  }, [wifiAccessPoints]);

  const clientCountBySsidId = useMemo(() => {
    return wifiClientAssociations.reduce<Record<string, number>>(
      (acc, association) => {
        if (association.ssidId) {
          acc[association.ssidId] = (acc[association.ssidId] ?? 0) + 1;
        }
        return acc;
      },
      {},
    );
  }, [wifiClientAssociations]);

  const radioCountBySsidId = useMemo(() => {
    return wifiRadios.reduce<Record<string, number>>((acc, radio) => {
      for (const ssidId of radio.ssidIds) {
        acc[ssidId] = (acc[ssidId] ?? 0) + 1;
      }
      return acc;
    }, {});
  }, [wifiRadios]);

  const unassignedClients = wirelessClients.filter(
    (device) => !associationByClientId[device.id],
  );

  return (
    <>
      <TopBar
        subtitle={t("Wireless")}
        title={t("WiFi")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {t(
              "{controllers} controllers | {ssids} SSIDs | {aps} APs | {clients} clients",
              {
                controllers: wifiControllers.length,
                ssids: wifiSsids.length,
                aps: apDevices.length,
                clients: wirelessClients.length,
              },
            )}
          </span>
        }
        actions={
          canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditor({ kind: "controller" })}
              >
                <Plus className="size-3.5" />
                {t("Add controller")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditor({ kind: "ssid" })}
              >
                <Plus className="size-3.5" />
                {t("Add SSID")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDrawerDefaults({
                    deviceType: "ap",
                    placement: "wireless",
                    status: "unknown",
                  });
                  setDrawerOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                {t("Add AP")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDrawerDefaults({
                    deviceType: "endpoint",
                    placement: "wireless",
                    status: "unknown",
                  });
                  setDrawerOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                {t("Add client")}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <WifiStat
            label={t("Controllers")}
            value={String(wifiControllers.length)}
            hint={t("WiFi control planes in this lab")}
          />
          <WifiStat
            label={t("SSIDs")}
            value={String(wifiSsids.length)}
            hint={t("Broadcast wireless networks")}
          />
          <WifiStat
            label={t("Access points")}
            value={String(apDevices.length)}
            hint={t("Managed and standalone APs")}
          />
          <WifiStat
            label={t("Clients")}
            value={String(wirelessClients.length)}
            hint={t("Wireless-linked client devices")}
          />
          <WifiStat
            label={t("Unassigned")}
            value={String(unassignedClients.length)}
            hint={t("Clients missing AP/SSID telemetry")}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_1.55fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Controllers")}</CardLabel>
                  <CardHeading>{t("Wireless control planes")}</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {wifiControllers.length === 0 ? (
                  <EmptyState
                    icon={Wifi}
                    title={t("No WiFi controllers documented")}
                    description={t(
                      "Add a UniFi, Omada, Aruba, or other wireless controller to anchor your AP fleet.",
                    )}
                  />
                ) : (
                  wifiControllers.map((controller) => {
                    const linkedDevice = controller.deviceId
                      ? deviceById[controller.deviceId]
                      : undefined;
                    return (
                      <div
                        key={controller.id}
                        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-[var(--color-fg)]">
                              {controller.name}
                            </div>
                            <div className="text-[11px] text-[var(--color-fg-subtle)]">
                              {[controller.vendor, controller.model]
                                .filter(Boolean)
                                .join(" | ") || t("Standalone controller record")}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge tone="accent">
                              {t("{count} APs", {
                                count: apCountByControllerId[controller.id] ?? 0,
                              })}
                            </Badge>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditor({ kind: "controller", controller })
                                }
                                className="rounded-[var(--radius-xs)] border border-[var(--color-line)] p-1 text-[var(--color-fg-subtle)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-fg)]"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                          {wifiAddressLabel(
                            linkedDevice,
                            controller.managementIp,
                          ) && (
                            <span className="font-mono">
                              {wifiAddressLabel(
                                linkedDevice,
                                controller.managementIp,
                              )}
                            </span>
                          )}
                          {linkedDevice && (
                            <Link
                              to={`/devices/${linkedDevice.id}`}
                              className="text-[var(--color-accent)] hover:underline"
                            >
                              {linkedDevice.hostname}
                            </Link>
                          )}
                        </div>

                        {controller.notes && (
                          <div className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2.5 py-2 text-[11px] text-[var(--color-fg-subtle)]">
                            {controller.notes}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("SSIDs")}</CardLabel>
                  <CardHeading>{t("Broadcast wireless networks")}</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {wifiSsids.length === 0 ? (
                  <EmptyState
                    icon={Wifi}
                    title={t("No SSIDs documented")}
                    description={t(
                      "Create trusted, guest, and IoT SSIDs so wireless clients can be grouped by intent instead of only by AP.",
                    )}
                  />
                ) : (
                  wifiSsids.map((ssid) => {
                    const vlan = ssid.vlanId
                      ? vlanById[ssid.vlanId]
                      : undefined;
                    return (
                      <div
                        key={ssid.id}
                        className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="size-2.5 rounded-full border border-[var(--color-line-strong)]"
                                style={{
                                  backgroundColor: ssid.color || "#7a7a7a",
                                }}
                              />
                              <span className="text-sm font-semibold text-[var(--color-fg)]">
                                {ssid.name}
                              </span>
                              {ssid.hidden && (
                                <Badge tone="warn">{t("Hidden")}</Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--color-fg-subtle)]">
                              {ssid.security || t("Security not documented")}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge tone="cyan">
                              {t("{count} clients", {
                                count: clientCountBySsidId[ssid.id] ?? 0,
                              })}
                            </Badge>
                            <Badge tone="neutral">
                              {t("{count} radios", {
                                count: radioCountBySsidId[ssid.id] ?? 0,
                              })}
                            </Badge>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditor({ kind: "ssid", ssid })
                                }
                                className="rounded-[var(--radius-xs)] border border-[var(--color-line)] p-1 text-[var(--color-fg-subtle)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-fg)]"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                          {ssid.purpose && <span>{ssid.purpose}</span>}
                          {vlan && (
                            <Badge tone="info">
                              {t("VLAN {number}", { number: vlan.vlanId })}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Access points")}</CardLabel>
                  <CardHeading>
                    {t("Controllers, radios, and attached clients")}
                  </CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                {apDevices.length === 0 ? (
                  <EmptyState
                    icon={Radio}
                    title={t("No APs documented")}
                    description={t(
                      "Add access points to start mapping radios, channels, and wireless clients.",
                    )}
                  />
                ) : (
                  apDevices.map((ap) => {
                    const accessPoint = accessPointByDeviceId[ap.id];
                    const controller = accessPoint?.controllerId
                      ? controllerById[accessPoint.controllerId]
                      : undefined;
                    const radios = radiosByApId[ap.id] ?? [];
                    const clients = (clientsByApId[ap.id] ?? []).sort((a, b) =>
                      a.hostname.localeCompare(b.hostname),
                    );

                    return (
                      <div
                        key={ap.id}
                        className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <DeviceTypeIcon
                                type={ap.deviceType}
                                className="size-4 text-[var(--color-accent)]"
                              />
                              <Link
                                to={`/devices/${ap.id}`}
                                className="text-sm font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                              >
                                {ap.hostname}
                              </Link>
                              <StatusDot status={ap.status} />
                              <span className="text-[11px] text-[var(--color-fg-subtle)]">
                                {t(statusLabel[ap.status] as TranslationKey)}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                              {ap.displayName && <span>{ap.displayName}</span>}
                              {formatDeviceAddress(ap) && (
                                <span className="font-mono">
                                  {formatDeviceAddress(ap)}
                                </span>
                              )}
                              {controller && (
                                <span>
                                  {t("Controller: {name}", {
                                    name: controller.name,
                                  })}
                                </span>
                              )}
                              {accessPoint?.location && (
                                <span>{accessPoint.location}</span>
                              )}
                              {accessPoint?.firmwareVersion && (
                                <Badge tone="neutral">
                                  {accessPoint.firmwareVersion}
                                </Badge>
                              )}
                            </div>
                          </div>

                          {canEdit && (
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setEditor({
                                    kind: "accessPoint",
                                    deviceId: ap.id,
                                  })
                                }
                              >
                                <Pencil className="size-3.5" />
                                {t("Edit AP")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setEditor({
                                    kind: "radio",
                                    apDeviceId: ap.id,
                                  })
                                }
                              >
                                <Plus className="size-3.5" />
                                {t("Add radio")}
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 grid gap-3 xl:grid-cols-[1.05fr_1.25fr]">
                          <div className="space-y-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                              {t("Radios")}
                            </div>
                            {radios.length === 0 ? (
                              <EmptyState
                                title={t("No radios documented yet.")}
                              />
                            ) : (
                              radios.map((radio) => (
                                <div
                                  key={radio.id}
                                  className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <Radio className="size-3.5 text-[var(--color-accent)]" />
                                        <span className="text-sm font-medium text-[var(--color-fg)]">
                                          {radio.slotName}
                                        </span>
                                        <Badge tone="accent">
                                          {t(BAND_KEYS[radio.band])}
                                        </Badge>
                                      </div>
                                      <div className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                                        {t("Channel {channel}", {
                                          channel: radio.channel,
                                        })}
                                        {radio.channelWidth
                                          ? ` | ${radio.channelWidth}`
                                          : ""}
                                        {radio.txPower
                                          ? ` | ${radio.txPower}`
                                          : ""}
                                      </div>
                                    </div>
                                    {canEdit && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditor({
                                            kind: "radio",
                                            apDeviceId: ap.id,
                                            radio,
                                          })
                                        }
                                        className="rounded-[var(--radius-xs)] border border-[var(--color-line)] p-1 text-[var(--color-fg-subtle)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-fg)]"
                                      >
                                        <Pencil className="size-3.5" />
                                      </button>
                                    )}
                                  </div>

                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {radio.ssidIds.length === 0 ? (
                                      <Badge tone="warn">
                                        {t("No SSIDs linked")}
                                      </Badge>
                                    ) : (
                                      radio.ssidIds.map((ssidId) => (
                                        <Badge key={ssidId} tone="info">
                                          {ssidById[ssidId]?.name ?? ssidId}
                                        </Badge>
                                      ))
                                    )}
                                  </div>

                                  {radio.notes && (
                                    <div className="mt-3 text-[11px] text-[var(--color-fg-subtle)]">
                                      {radio.notes}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>

                          <div className="space-y-2">
                            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                              {t("Attached clients")}
                            </div>
                            {clients.length === 0 ? (
                              <EmptyState
                                title={t(
                                  "No wireless clients linked to this AP yet.",
                                )}
                              />
                            ) : (
                              clients.map((client) => {
                                const association =
                                  associationByClientId[client.id];
                                const ssid = association?.ssidId
                                  ? ssidById[association.ssidId]
                                  : undefined;
                                return (
                                  <div
                                    key={client.id}
                                    className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <DeviceTypeIcon
                                            type={client.deviceType}
                                            className="size-4 text-[var(--color-accent)]"
                                          />
                                          <Link
                                            to={`/devices/${client.id}`}
                                            className="text-sm font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                                          >
                                            {client.hostname}
                                          </Link>
                                          <StatusDot status={client.status} />
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                                          {ssid && (
                                            <Badge tone="cyan">
                                              {ssid.name}
                                            </Badge>
                                          )}
                                          {association?.band && (
                                            <Badge tone="neutral">
                                              {t(BAND_KEYS[association.band])}
                                            </Badge>
                                          )}
                                          {association?.channel && (
                                            <span>
                                              {t("Ch {channel}", {
                                                channel: association.channel,
                                              })}
                                            </span>
                                          )}
                                          {association?.signalDbm != null && (
                                            <span>
                                              {association.signalDbm} dBm
                                            </span>
                                          )}
                                          {formatDeviceAddress(client) && (
                                            <span className="font-mono">
                                              {formatDeviceAddress(client)}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[11px] text-[var(--color-fg-subtle)]">
                                          {t("Last seen {time}", {
                                            time: association?.lastSeen
                                              ? relativeTime(association.lastSeen)
                                              : relativeTime(client.lastSeen),
                                          })}
                                        </div>
                                      </div>

                                      {canEdit && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditor({
                                              kind: "association",
                                              clientDeviceId: client.id,
                                              association,
                                            })
                                          }
                                          className="rounded-[var(--radius-xs)] border border-[var(--color-line)] p-1 text-[var(--color-fg-subtle)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-fg)]"
                                        >
                                          <Link2 className="size-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Client inventory")}</CardLabel>
                  <CardHeading>{t("Association and roaming view")}</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody>
                {wirelessClients.length === 0 ? (
                  <EmptyState
                    icon={Wifi}
                    title={t("No wireless clients documented")}
                    description={t(
                      "Add phones, laptops, TVs, cameras, or IoT devices and link them to APs and SSIDs.",
                    )}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-line)] text-[11px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                          <th className="pb-2 pr-3 font-medium">{t("Client")}</th>
                          <th className="pb-2 pr-3 font-medium">{t("AP")}</th>
                          <th className="pb-2 pr-3 font-medium">{t("SSID")}</th>
                          <th className="pb-2 pr-3 font-medium">{t("Band")}</th>
                          <th className="pb-2 pr-3 font-medium">{t("Signal")}</th>
                          <th className="pb-2 pr-3 font-medium">
                            {t("Last seen")}
                          </th>
                          {canEdit && (
                            <th className="pb-2 text-right font-medium">
                              {t("Action")}
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {wirelessClients.map((client) => {
                          const association = associationByClientId[client.id];
                          const ap = association?.apDeviceId
                            ? deviceById[association.apDeviceId]
                            : undefined;
                          const ssid = association?.ssidId
                            ? ssidById[association.ssidId]
                            : undefined;
                          return (
                            <tr
                              key={client.id}
                              className="border-b border-[var(--color-line)]/70 last:border-b-0"
                            >
                              <td className="py-3 pr-3">
                                <div className="flex items-center gap-2">
                                  <DeviceTypeIcon
                                    type={client.deviceType}
                                    className="size-4 text-[var(--color-accent)]"
                                  />
                                  <div>
                                    <Link
                                      to={`/devices/${client.id}`}
                                      className="font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                                    >
                                      {client.hostname}
                                    </Link>
                                    <div className="text-[11px] text-[var(--color-fg-subtle)]">
                                      {client.displayName ||
                                        formatDeviceAddress(client) ||
                                        t(
                                          statusLabel[
                                            client.status
                                          ] as TranslationKey,
                                        )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 pr-3 text-[var(--color-fg-subtle)]">
                                {ap ? ap.hostname : t("Unassigned")}
                              </td>
                              <td className="py-3 pr-3 text-[var(--color-fg-subtle)]">
                                {ssid ? ssid.name : t("Unassigned")}
                              </td>
                              <td className="py-3 pr-3 text-[var(--color-fg-subtle)]">
                                {association?.band
                                  ? t(BAND_KEYS[association.band])
                                  : "—"}
                              </td>
                              <td className="py-3 pr-3">
                                {association?.signalDbm != null ? (
                                  <SignalPill
                                    signalDbm={association.signalDbm}
                                  />
                                ) : (
                                  <span className="text-[var(--color-fg-faint)]">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="py-3 pr-3 text-[var(--color-fg-subtle)]">
                                {association?.lastSeen
                                  ? relativeTime(association.lastSeen)
                                  : relativeTime(client.lastSeen)}
                              </td>
                              {canEdit && (
                                <td className="py-3 text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      setEditor({
                                        kind: "association",
                                        clientDeviceId: client.id,
                                        association,
                                      })
                                    }
                                  >
                                    {association ? t("Edit link") : t("Link")}
                                  </Button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {canEdit && (
        <>
          <DeviceDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            defaults={drawerDefaults}
          />

          {editor && (
            <EditorModal
              title={editorTitle(editor, t)}
              subtitle={editorSubtitle(editor, deviceById, t)}
              onClose={() => setEditor(null)}
            >
              {editor.kind === "controller" ? (
                <ControllerEditor
                  controller={editor.controller}
                  devices={devices
                    .filter((device) => device.deviceType !== "ap")
                    .sort((a, b) => a.hostname.localeCompare(b.hostname))}
                  onCancel={() => setEditor(null)}
                  onDelete={
                    editor.controller
                      ? async () => {
                          if (
                            !window.confirm(
                              t("Delete controller {name}?", {
                                name: editor.controller!.name,
                              }),
                            )
                          )
                            return;
                          await deleteWifiControllerRecord(
                            editor.controller!.id,
                          );
                          setEditor(null);
                        }
                      : undefined
                  }
                  onSave={async (payload) => {
                    if (editor.controller) {
                      await updateWifiControllerRecord(
                        editor.controller.id,
                        payload,
                      );
                    } else {
                      await createWifiControllerRecord({
                        labId: activeLab.id,
                        ...payload,
                      });
                    }
                    setEditor(null);
                  }}
                />
              ) : editor.kind === "ssid" ? (
                <SsidEditor
                  ssid={editor.ssid}
                  vlans={vlans}
                  onCancel={() => setEditor(null)}
                  onDelete={
                    editor.ssid
                      ? async () => {
                          if (
                            !window.confirm(
                              t(
                                "Delete SSID {name}? Clients and radios will lose the reference.",
                                { name: editor.ssid!.name },
                              ),
                            )
                          )
                            return;
                          await deleteWifiSsidRecord(editor.ssid!.id);
                          setEditor(null);
                        }
                      : undefined
                  }
                  onSave={async (payload) => {
                    if (editor.ssid) {
                      await updateWifiSsidRecord(editor.ssid.id, payload);
                    } else {
                      await createWifiSsidRecord({
                        labId: activeLab.id,
                        ...payload,
                      });
                    }
                    setEditor(null);
                  }}
                />
              ) : editor.kind === "accessPoint" ? (
                <AccessPointEditor
                  accessPoint={accessPointByDeviceId[editor.deviceId]}
                  controllers={wifiControllers}
                  device={deviceById[editor.deviceId]}
                  onCancel={() => setEditor(null)}
                  onSave={async (payload) => {
                    await saveWifiAccessPointRecord(editor.deviceId, payload);
                    setEditor(null);
                  }}
                />
              ) : editor.kind === "radio" ? (
                <RadioEditor
                  apDevice={deviceById[editor.apDeviceId]}
                  radio={editor.radio}
                  ssids={wifiSsids}
                  onCancel={() => setEditor(null)}
                  onDelete={
                    editor.radio
                      ? async () => {
                          if (
                            !window.confirm(
                              t(
                                "Delete radio {slotName}? Any client links will be detached from this radio.",
                                { slotName: editor.radio!.slotName },
                              ),
                            )
                          )
                            return;
                          await deleteWifiRadioRecord(editor.radio!.id);
                          setEditor(null);
                        }
                      : undefined
                  }
                  onSave={async (payload) => {
                    if (editor.radio) {
                      await updateWifiRadioRecord(editor.radio.id, payload);
                    } else {
                      await createWifiRadioRecord({
                        apDeviceId: editor.apDeviceId,
                        ...payload,
                      });
                    }
                    setEditor(null);
                  }}
                />
              ) : (
                <AssociationEditor
                  association={editor.association}
                  clientDevice={deviceById[editor.clientDeviceId]}
                  apDevices={apDevices}
                  radios={wifiRadios}
                  ssids={wifiSsids}
                  onCancel={() => setEditor(null)}
                  onDelete={
                    editor.association
                      ? async () => {
                          if (
                            !window.confirm(
                              t("Remove this wireless association?"),
                            )
                          )
                            return;
                          await deleteWifiClientAssociationRecord(
                            editor.clientDeviceId,
                          );
                          setEditor(null);
                        }
                      : undefined
                  }
                  onSave={async (payload) => {
                    await saveWifiClientAssociationRecord(
                      editor.clientDeviceId,
                      payload,
                    );
                    setEditor(null);
                  }}
                />
              )}
            </EditorModal>
          )}
        </>
      )}
    </>
  );
}

function editorTitle(
  editor: EditorState,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (editor.kind) {
    case "controller":
      return editor.controller ? t("Edit controller") : t("Add controller");
    case "ssid":
      return editor.ssid ? t("Edit SSID") : t("Add SSID");
    case "accessPoint":
      return t("Access point settings");
    case "radio":
      return editor.radio ? t("Edit radio") : t("Add radio");
    case "association":
      return t("Client association");
  }
}

function editorSubtitle(
  editor: EditorState,
  deviceById: Record<string, Device | undefined>,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (editor.kind) {
    case "controller":
      return t(
        "Document the control plane that manages one or more access points.",
      );
    case "ssid":
      return t(
        "Define the wireless network name, security, VLAN, and visual identity.",
      );
    case "accessPoint":
      return t(
        "Configure controller, location, and firmware for {hostname}.",
        {
          hostname:
            deviceById[editor.deviceId]?.hostname ?? editor.deviceId,
        },
      );
    case "radio":
      return t(
        "Document the band, channel, and broadcast SSIDs for {hostname}.",
        {
          hostname:
            deviceById[editor.apDeviceId]?.hostname ?? editor.apDeviceId,
        },
      );
    case "association":
      return t("Link {hostname} to an AP, radio, and SSID.", {
        hostname:
          deviceById[editor.clientDeviceId]?.hostname ??
          editor.clientDeviceId,
      });
  }
}

function WifiStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-fg)]">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
        {hint}
      </div>
    </div>
  );
}

function EditorModal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-line-strong)] bg-[var(--color-bg-2)] shadow-[var(--shadow-elev)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
              {t("WiFi editor")}
            </div>
            <div className="mt-1 text-base font-semibold text-[var(--color-fg)]">
              {title}
            </div>
            <div className="mt-1 text-sm text-[var(--color-fg-subtle)]">
              {subtitle}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-1.5 text-[var(--color-fg-subtle)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-fg)]"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <div className="rk-field-label">{label}</div>
      {children}
    </label>
  );
}

function ControllerEditor({
  controller,
  devices,
  onSave,
  onCancel,
  onDelete,
}: {
  controller?: WifiController;
  devices: Device[];
  onSave: (payload: Omit<WifiController, "id" | "labId">) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    deviceId: controller?.deviceId ?? "",
    name: controller?.name ?? "",
    vendor: controller?.vendor ?? "",
    model: controller?.model ?? "",
    managementIp: controller?.managementIp ?? "",
    notes: controller?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        deviceId: form.deviceId || null,
        name: form.name.trim(),
        vendor: form.vendor.trim() || null,
        model: form.model.trim() || null,
        managementIp: form.managementIp.trim() || null,
        notes: form.notes.trim() || null,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Failed to save controller."),
      );
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("Controller name")}>
          <Input
            value={form.name}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, name: event.target.value }))
            }
            placeholder="UniFi Network"
          />
        </Field>
        <Field label={t("Linked device")}>
          <select
            value={form.deviceId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, deviceId: event.target.value }))
            }
            className={SELECT_CLASS}
          >
            <option value="">{t("Standalone controller record")}</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.hostname}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Vendor")}>
          <Input
            value={form.vendor}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, vendor: event.target.value }))
            }
            placeholder="Ubiquiti"
          />
        </Field>
        <Field label={t("Model")}>
          <Input
            value={form.model}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, model: event.target.value }))
            }
            placeholder="Cloud Key Gen2 Plus"
          />
        </Field>
        <Field label={t("Management IP")}>
          <Input
            value={form.managementIp}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, managementIp: event.target.value }))
            }
            placeholder="10.0.10.4"
          />
        </Field>
      </div>

      <Field label={t("Notes")}>
        <textarea
          value={form.notes}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, notes: event.target.value }))
          }
          className={TEXTAREA_CLASS}
          placeholder="What this controller manages, where it runs, and any caveats."
        />
      </Field>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onDelete()}
            >
              {" "}
              <Trash2 className="size-3.5" /> {t("Delete")}{" "}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={saving || !form.name.trim()}>
            <Save className="size-3.5" />
            {saving
              ? t("Saving...")
              : controller
                ? t("Save controller")
                : t("Create controller")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SsidEditor({
  ssid,
  vlans,
  onSave,
  onCancel,
  onDelete,
}: {
  ssid?: WifiSsid;
  vlans: Vlan[];
  onSave: (payload: Omit<WifiSsid, "id" | "labId">) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: ssid?.name ?? "",
    purpose: ssid?.purpose ?? "",
    security: ssid?.security ?? "",
    hidden: ssid?.hidden ?? false,
    vlanId: ssid?.vlanId ?? "",
    color: ssid?.color ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        name: form.name.trim(),
        purpose: form.purpose.trim() || null,
        security: form.security.trim() || null,
        hidden: form.hidden,
        vlanId: form.vlanId || null,
        color: form.color.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to save SSID."));
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("SSID name")}>
          <Input
            value={form.name}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, name: event.target.value }))
            }
            placeholder="Home-Main"
          />
        </Field>
        <Field label={t("Security")}>
          <Input
            value={form.security}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, security: event.target.value }))
            }
            placeholder="WPA2/WPA3 Personal"
          />
        </Field>
        <Field label={t("Purpose")}>
          <Input
            value={form.purpose}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, purpose: event.target.value }))
            }
            placeholder="Primary trusted LAN"
          />
        </Field>
        <Field label={t("Linked VLAN")}>
          <select
            value={form.vlanId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, vlanId: event.target.value }))
            }
            className={SELECT_CLASS}
          >
            <option value="">{t("Unassigned")}</option>
            {vlans.map((vlan) => (
              <option key={vlan.id} value={vlan.id}>
                {vlan.vlanId} · {vlan.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={t("Color")}>
        <ColorInput
          value={form.color}
          onChange={(value) => setForm((prev) => ({ ...prev, color: value }))}
          placeholder="#6a9bd4 or blue"
        />
      </Field>

      <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]">
        <input
          type="checkbox"
          checked={form.hidden}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, hidden: event.target.checked }))
          }
        />
        {t("Hidden SSID")}
      </label>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onDelete()}
            >
              <Trash2 className="size-3.5" />
              {t("Delete")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={saving || !form.name.trim()}>
            <Save className="size-3.5" />
            {saving ? t("Saving...") : ssid ? t("Save SSID") : t("Create SSID")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function AccessPointEditor({
  accessPoint,
  controllers,
  device,
  onSave,
  onCancel,
}: {
  accessPoint?: WifiAccessPoint;
  controllers: WifiController[];
  device?: Device;
  onSave: (payload: Omit<WifiAccessPoint, "deviceId">) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    controllerId: accessPoint?.controllerId ?? "",
    location: accessPoint?.location ?? "",
    firmwareVersion: accessPoint?.firmwareVersion ?? "",
    notes: accessPoint?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        controllerId: form.controllerId || null,
        location: form.location.trim() || null,
        firmwareVersion: form.firmwareVersion.trim() || null,
        notes: form.notes.trim() || null,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Failed to save AP settings."),
      );
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg-subtle)]">
        {t("Editing wireless metadata for {hostname}", {
          hostname: device?.hostname ?? accessPoint?.deviceId ?? "",
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("Controller")}>
          <select
            value={form.controllerId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, controllerId: event.target.value }))
            }
            className={SELECT_CLASS}
          >
            <option value="">{t("Standalone / unmanaged")}</option>
            {controllers.map((controller) => (
              <option key={controller.id} value={controller.id}>
                {controller.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Firmware version")}>
          <Input
            value={form.firmwareVersion}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                firmwareVersion: event.target.value,
              }))
            }
            placeholder="6.7.18"
          />
        </Field>
        <Field label={t("Location")}>
          <Input
            value={form.location}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, location: event.target.value }))
            }
            placeholder="Ground floor lounge ceiling"
          />
        </Field>
      </div>

      <Field label={t("Notes")}>
        <textarea
          value={form.notes}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, notes: event.target.value }))
          }
          className={TEXTAREA_CLASS}
          placeholder="Coverage area, mounting notes, or maintenance reminders."
        />
      </Field>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={saving}>
          <Save className="size-3.5" />
          {saving ? t("Saving...") : t("Save AP settings")}
        </Button>
      </div>
    </form>
  );
}

function RadioEditor({
  apDevice,
  radio,
  ssids,
  onSave,
  onCancel,
  onDelete,
}: {
  apDevice?: Device;
  radio?: WifiRadio;
  ssids: WifiSsid[];
  onSave: (payload: Omit<WifiRadio, "id" | "apDeviceId">) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    slotName: radio?.slotName ?? "",
    band: (radio?.band ?? "5ghz") as WifiBand,
    channel: radio?.channel ?? "",
    channelWidth: radio?.channelWidth ?? "",
    txPower: radio?.txPower ?? "",
    ssidIds: new Set(radio?.ssidIds ?? []),
    notes: radio?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        slotName: form.slotName.trim(),
        band: form.band,
        channel: form.channel.trim(),
        channelWidth: form.channelWidth.trim() || null,
        txPower: form.txPower.trim() || null,
        ssidIds: Array.from(form.ssidIds),
        notes: form.notes.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to save radio."));
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  function toggleSsid(ssidId: string) {
    setForm((prev) => {
      const next = new Set(prev.ssidIds);
      if (next.has(ssidId)) next.delete(ssidId);
      else next.add(ssidId);
      return { ...prev, ssidIds: next };
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg-subtle)]">
        {t("Radio belongs to {hostname}", {
          hostname: apDevice?.hostname ?? t("selected AP"),
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("Slot name")}>
          <Input
            value={form.slotName}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, slotName: event.target.value }))
            }
            placeholder="radio0"
          />
        </Field>
        <Field label={t("Band")}>
          <select
            value={form.band}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                band: event.target.value as WifiBand,
              }))
            }
            className={SELECT_CLASS}
          >
            {Object.entries(BAND_KEYS).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Channel")}>
          <Input
            value={form.channel}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, channel: event.target.value }))
            }
            placeholder="44"
          />
        </Field>
        <Field label={t("Channel width")}>
          <Input
            value={form.channelWidth}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, channelWidth: event.target.value }))
            }
            placeholder="80 MHz"
          />
        </Field>
        <Field label={t("Transmit power")}>
          <Input
            value={form.txPower}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, txPower: event.target.value }))
            }
            placeholder="high"
          />
        </Field>
      </div>

      <Field label={t("Broadcast SSIDs")}>
        <div className="grid gap-2 md:grid-cols-2">
          {ssids.map((ssid) => (
            <label
              key={ssid.id}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]"
            >
              <input
                type="checkbox"
                checked={form.ssidIds.has(ssid.id)}
                onChange={() => toggleSsid(ssid.id)}
              />
              <span>{ssid.name}</span>
            </label>
          ))}
          {ssids.length === 0 && (
            <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-fg-subtle)]">
              {t("Create one or more SSIDs first.")}
            </div>
          )}
        </div>
      </Field>

      <Field label={t("Notes")}>
        <textarea
          value={form.notes}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, notes: event.target.value }))
          }
          className={TEXTAREA_CLASS}
          placeholder="Coverage notes, DFS behavior, or tuning details."
        />
      </Field>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onDelete()}
            >
              <Trash2 className="size-3.5" />
              {t("Delete")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            type="submit"
            disabled={saving || !form.slotName.trim() || !form.channel.trim()}
          >
            <Save className="size-3.5" />
            {saving ? t("Saving...") : radio ? t("Save radio") : t("Create radio")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function AssociationEditor({
  association,
  clientDevice,
  apDevices,
  radios,
  ssids,
  onSave,
  onCancel,
  onDelete,
}: {
  association?: WifiClientAssociation;
  clientDevice?: Device;
  apDevices: Device[];
  radios: WifiRadio[];
  ssids: WifiSsid[];
  onSave: (payload: WifiClientAssociation) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    apDeviceId: association?.apDeviceId ?? apDevices[0]?.id ?? "",
    radioId: association?.radioId ?? "",
    ssidId: association?.ssidId ?? "",
    band: (association?.band ?? null) as WifiBand | null,
    channel: association?.channel ?? "",
    signalDbm:
      association?.signalDbm != null ? String(association.signalDbm) : "",
    lastSeen: association?.lastSeen
      ? toLocalInputValue(association.lastSeen)
      : "",
    lastRoamAt: association?.lastRoamAt
      ? toLocalInputValue(association.lastRoamAt)
      : "",
    notes: association?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const availableRadios = useMemo(
    () => radios.filter((radio) => radio.apDeviceId === form.apDeviceId),
    [form.apDeviceId, radios],
  );
  const selectedRadio = availableRadios.find(
    (radio) => radio.id === form.radioId,
  );
  const availableSsids = selectedRadio
    ? ssids.filter((ssid) => selectedRadio.ssidIds.includes(ssid.id))
    : ssids;

  useEffect(() => {
    if (!form.radioId) return;
    if (availableRadios.some((radio) => radio.id === form.radioId)) return;
    setForm((prev) => ({
      ...prev,
      radioId: "",
      ssidId: "",
      band: null,
      channel: "",
    }));
  }, [availableRadios, form.radioId]);

  useEffect(() => {
    if (!selectedRadio) return;
    setForm((prev) => ({
      ...prev,
      band: prev.band ?? selectedRadio.band,
      channel: prev.channel || selectedRadio.channel,
      ssidId:
        prev.ssidId && selectedRadio.ssidIds.includes(prev.ssidId)
          ? prev.ssidId
          : "",
    }));
  }, [selectedRadio]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        clientDeviceId: clientDevice?.id ?? "",
        apDeviceId: form.apDeviceId,
        radioId: form.radioId || null,
        ssidId: form.ssidId || null,
        band: form.band,
        channel: form.channel.trim() || null,
        signalDbm: form.signalDbm.trim()
          ? Number.parseInt(form.signalDbm, 10)
          : null,
        lastSeen: form.lastSeen ? new Date(form.lastSeen).toISOString() : null,
        lastRoamAt: form.lastRoamAt
          ? new Date(form.lastRoamAt).toISOString()
          : null,
        notes: form.notes.trim() || null,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to save wireless association."),
      );
      setSaving(false);
      return;
    }
    setSaving(false);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg-subtle)]">
        {t("Linking {hostname}", {
          hostname: clientDevice?.hostname ?? t("wireless client"),
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("Access point")}>
          <select
            value={form.apDeviceId}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                apDeviceId: event.target.value,
                radioId: "",
                ssidId: "",
              }))
            }
            className={SELECT_CLASS}
          >
            <option value="">{t("Choose an AP")}</option>
            {apDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.hostname}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Radio")}>
          <select
            value={form.radioId}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                radioId: event.target.value,
                ssidId: "",
              }))
            }
            className={SELECT_CLASS}
          >
            <option value="">{t("Unspecified")}</option>
            {availableRadios.map((radio) => (
              <option key={radio.id} value={radio.id}>
                {t("{slotName} · {band} · Ch {channel}", {
                  slotName: radio.slotName,
                  band: t(BAND_KEYS[radio.band]),
                  channel: radio.channel,
                })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("SSID")}>
          <select
            value={form.ssidId}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, ssidId: event.target.value }))
            }
            className={SELECT_CLASS}
          >
            <option value="">{t("Unspecified")}</option>
            {availableSsids.map((ssid) => (
              <option key={ssid.id} value={ssid.id}>
                {ssid.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Band")}>
          <select
            value={form.band ?? ""}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                band: (event.target.value || null) as WifiBand | null,
              }))
            }
            className={SELECT_CLASS}
          >
            <option value="">{t("Unspecified")}</option>
            {Object.entries(BAND_KEYS).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Channel")}>
          <Input
            value={form.channel}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, channel: event.target.value }))
            }
            placeholder="44"
          />
        </Field>
        <Field label={t("Signal (dBm)")}>
          <Input
            value={form.signalDbm}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, signalDbm: event.target.value }))
            }
            placeholder="-58"
          />
        </Field>
        <Field label={t("Last seen")}>
          <Input
            type="datetime-local"
            value={form.lastSeen}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, lastSeen: event.target.value }))
            }
          />
        </Field>
        <Field label={t("Last roam")}>
          <Input
            type="datetime-local"
            value={form.lastRoamAt}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, lastRoamAt: event.target.value }))
            }
          />
        </Field>
      </div>

      <Field label={t("Notes")}>
        <textarea
          value={form.notes}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, notes: event.target.value }))
          }
          className={TEXTAREA_CLASS}
          placeholder="Why this client is pinned here, roaming behavior, or signal caveats."
        />
      </Field>

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onDelete()}
            >
              <Trash2 className="size-3.5" />
              {t("Remove link")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={saving || !form.apDeviceId}>
            <Save className="size-3.5" />
            {saving
              ? t("Saving...")
              : association
                ? t("Save link")
                : t("Create link")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SignalPill({ signalDbm }: { signalDbm: number }) {
  const tone = signalDbm >= -60 ? "ok" : signalDbm >= -70 ? "warn" : "err";
  return <Badge tone={tone}>{signalDbm} dBm</Badge>;
}

function toLocalInputValue(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}
