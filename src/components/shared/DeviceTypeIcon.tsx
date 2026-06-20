import {
  Server,
  Network,
  Shield,
  HardDrive,
  Cable,
  Power,
  Battery,
  Monitor,
  Boxes,
  Wifi,
  Minus,
} from "lucide-react";
import type { DeviceType } from "@/lib/types";
import { useStore } from "@/lib/store";
import { deviceTypeBase } from "@/lib/device-types";

const map: Record<string, typeof Server> = {
  switch: Network,
  router: Network,
  firewall: Shield,
  server: Server,
  rack_shelf: Boxes,
  ap: Wifi,
  endpoint: Monitor,
  vm: Boxes,
  patch_panel: Cable,
  brush_panel: Cable,
  blanking_panel: Minus,
  storage: HardDrive,
  pdu: Power,
  ups: Battery,
  kvm: Monitor,
  other: Boxes,
};

interface Props {
  type: DeviceType;
  className?: string;
}

export function DeviceTypeIcon({ type, className }: Props) {
  const deviceTypes = useStore((s) => s.deviceTypes);
  const Icon = map[deviceTypeBase(type, deviceTypes)] ?? Boxes;
  return <Icon className={className} />;
}
