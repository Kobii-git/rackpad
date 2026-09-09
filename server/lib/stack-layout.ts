import {
  buildAutoPhysicalLayout,
  type PhysicalLayoutDevice,
  type PhysicalLayoutPort,
} from "./physical-layout.js";
import type { StackMember } from "./stack-data.js";

/** One layout supplies rendering, hit targets, cable anchors and exports. */
export function buildStackPhysicalLayout(
  device: PhysicalLayoutDevice,
  ports: PhysicalLayoutPort[],
  members: StackMember[],
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
    const generated = buildAutoPhysicalLayout(device, group.ports, "generic");
    for (const face of ["front", "rear"] as const) {
      const elements = result.snapshot.faces[face].elements;
      elements.push({
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
        y: y + (slot.y / 300) * group.height,
        height: (slot.height / 300) * group.height,
        groupId: group.id,
      });
    }
    result.bindings.push(...generated.bindings);
    y += group.height;
  }
  return result;
}
