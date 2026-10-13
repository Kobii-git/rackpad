import { createHash } from "node:crypto";
import type { StackMemberLayout } from "./stack-member-layout-data.js";
import {
  buildAutoPhysicalLayout,
  reconcilePhysicalLayoutBindings,
  type PhysicalLayoutDevice,
  type PhysicalLayoutPort,
} from "./physical-layout.js";
import type { StackMember } from "./stack-data.js";

/** One layout supplies rendering, hit targets, cable anchors and exports. */
export function buildStackPhysicalLayout(
  device: PhysicalLayoutDevice,
  ports: PhysicalLayoutPort[],
  members: StackMember[],
  layouts: Map<string, StackMemberLayout> = new Map(),
) {
  const result = buildAutoPhysicalLayout(device, [], "generic");
  const totalU = members.reduce((sum, row) => sum + row.heightU, 0) || 1;
  const unassigned = ports.filter((port) => !port.stackMemberId);
  const faceHeight = Math.max(100, Math.min(1000, totalU * 100));
  const footerHeight =
    unassigned.length && members.length ? Math.min(80, faceHeight * 0.2) : 0;
  const memberArea = faceHeight - footerHeight;
  result.snapshot.portSlots = [];
  result.bindings = [];
  for (const face of ["front", "rear"] as const) {
    result.snapshot.faces[face] = {
      schemaVersion: 1,
      width: 1000,
      height: faceHeight,
      elements: [],
    };
  }
  const groups = members.length
    ? members.map((member) => ({
        id: member.id,
        name: member.name,
        status: member.status,
        height: (memberArea * member.heightU) / totalU,
        ports: ports.filter((port) => port.stackMemberId === member.id),
      }))
    : [
        {
          id: "stack-wide",
          name: "Stack-wide ports",
          status: "",
          height: faceHeight,
          ports: unassigned,
        },
      ];
  if (footerHeight)
    groups.push({
      id: "stack-wide",
      name: "Stack-wide ports",
      status: "",
      height: footerHeight,
      ports: unassigned,
    });
  let y = 0;
  for (const group of groups) {
    const stored = layouts.get(group.id);
    const reconciled = stored ? reconcilePhysicalLayoutBindings({...stored, ports: group.ports}) : undefined;
    const boundPortIds = new Set(reconciled?.bindings.map(binding => binding.portId));
    const extraPorts = stored ? group.ports.filter(port => !boundPortIds.has(port.id)) : group.ports;
    const extraHeight = stored && extraPorts.length ? group.height * 0.25 : 0;
    const appliedHeight = group.height - extraHeight;
    if (stored && reconciled) {
      const prefix = (id: string) => `member:${createHash("sha256").update(JSON.stringify([group.id, id])).digest("hex")}`;
      for (const face of ["front", "rear"] as const) {
        const definition = stored.snapshot.faces[face];
        const scaleX = 1000 / definition.width;
        const scaleY = appliedHeight / definition.height;
        const rank = new Map(definition.artworkOrder?.map((ref, index) => [ref.elementId, index]));
        const elements = [...definition.elements].sort((a,b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
        for (const element of elements) result.snapshot.faces[face].elements.push({
          ...element, id: prefix(element.id), x: element.x * scaleX, y: y + element.y * scaleY,
          ...("width" in element ? {width: element.width * scaleX, height: element.height * scaleY} : {}),
          ...("radius" in element ? {radius: element.radius * Math.min(scaleX, scaleY)} : {}),
        });
      }
      for (const slot of stored.snapshot.portSlots) {
        const definition = stored.snapshot.faces[slot.face];
        const scaleX = 1000 / definition.width;
        const scaleY = appliedHeight / definition.height;
        const quarterTurn = slot.rotation === 90 || slot.rotation === 270;
        const width = slot.width * (quarterTurn ? scaleY : scaleX);
        const height = slot.height * (quarterTurn ? scaleX : scaleY);
        result.snapshot.portSlots.push({...slot, id: prefix(slot.id), x: (slot.x + slot.width / 2) * scaleX - width / 2, width, y: y + (slot.y + slot.height / 2) * scaleY - height / 2, height, groupId: group.id});
      }
      result.bindings.push(...reconciled.bindings.map(binding => ({...binding, slotId: prefix(binding.slotId)})));
      if (reconciled.status === "needs-mapping") result.status = "needs-mapping";
    }
    const generated = buildAutoPhysicalLayout(device, extraPorts, "generic");
    for (const face of ["front", "rear"] as const) {
      const elements = result.snapshot.faces[face].elements;
      if (!stored) elements.push({
        kind: "panel",
        id: `${face}:${group.id}:panel`,
        x: 0,
        y,
        width: 1000,
        height: group.height,
        tone: "dark",
      });
      elements.push({
        kind: "label",
        id: `${face}:${group.id}:label`,
        x: 24,
        y: y + Math.min(24, group.height * 0.2),
        text: `${group.name}${group.status ? ` · ${group.status}` : ""}`,
      });
    }
    for (const slot of generated.snapshot.portSlots) {
      result.snapshot.portSlots.push({
        ...slot,
        y: y + (stored ? appliedHeight : 0) + (slot.y / 300) * (stored ? extraHeight : group.height),
        height: (slot.height / 300) * (stored ? extraHeight : group.height),
        groupId: group.id,
      });
    }
    result.bindings.push(...generated.bindings);
    y += group.height;
  }
  return result;
}
