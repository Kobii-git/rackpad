import type { useI18n } from "@/i18n";
import type { Port, VirtualSwitch, Vlan } from "@/lib/types";

type Translate = ReturnType<typeof useI18n>["t"];

function formatCompactVlanLabel(
  vlanId: string,
  vlansById: Record<string, Vlan>,
) {
  const vlan = vlansById[vlanId];
  return vlan ? String(vlan.vlanId) : vlanId;
}

function bridgeSuffix(
  t: Translate,
  port: Port,
  virtualSwitchesById: Record<string, VirtualSwitch>,
) {
  if (!port.virtualSwitchId) return "";
  return t(" | bridge {name}", {
    name:
      virtualSwitchesById[port.virtualSwitchId]?.name ?? port.virtualSwitchId,
  });
}

export function formatPortModeSummary(
  t: Translate,
  port: Port,
  vlansById: Record<string, Vlan>,
  virtualSwitchesById: Record<string, VirtualSwitch>,
  includeBridge = true,
) {
  const bridge = includeBridge
    ? bridgeSuffix(t, port, virtualSwitchesById)
    : "";

  if (port.mode === "trunk") {
    const tagged = (port.allowedVlanIds ?? [])
      .map((vlanId) => formatCompactVlanLabel(vlanId, vlansById))
      .join(", ");
    const nativeVlan = port.vlanId
      ? formatCompactVlanLabel(port.vlanId, vlansById)
      : "";

    if (tagged && nativeVlan) {
      return (
        t("trunk | native {vlan} | tagged {vlans}", {
          vlan: nativeVlan,
          vlans: tagged,
        }) + bridge
      );
    }
    if (tagged) {
      return (
        t("trunk | no native | tagged {vlans}", { vlans: tagged }) + bridge
      );
    }
    if (nativeVlan) {
      return t("trunk | native {vlan}", { vlan: nativeVlan }) + bridge;
    }
    return t("trunk | no native") + bridge;
  }

  const base = port.vlanId
    ? t("access | VLAN {vlan}", {
        vlan: formatCompactVlanLabel(port.vlanId, vlansById),
      })
    : t("access | unassigned");

  return base + bridge;
}
