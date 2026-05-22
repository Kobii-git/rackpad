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
  const Icon = map[type] ?? Boxes;
  return <Icon className={className} />;
}
