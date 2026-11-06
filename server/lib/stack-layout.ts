import { createHash } from "node:crypto";
import type { StackMemberLayout } from "./stack-member-layout-data.js";
import {
  buildAutoPhysicalLayout,
  reconcilePhysicalLayoutBindings,
  type PhysicalLayoutDevice,
  type PhysicalLayoutPort,
} from "./physical-layout.js";
import type { StackMember } from "./stack-data.js";
import { FACE_SKIN_COLORS, faceGeometry, rotateFacePoint } from "./physical-face-appearance.js";
import { projectFaceArtwork } from "./physical-face-projection.js";

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
        const geometry = faceGeometry(definition);
        const scaleX = 1000 / geometry.width;
        const scaleY = appliedHeight / geometry.height;
        const skin = definition.skin ? FACE_SKIN_COLORS[definition.skin] : undefined;
        if (skin) result.snapshot.faces[face].elements.push({kind: "panel", id: prefix(`\u0000skin:${face}`), x: 0, y, width: 1000, height: appliedHeight, color: skin.background});
        const rank = new Map(definition.artworkOrder?.map((ref, index) => [ref.elementId, index]));
        const elements = [...definition.elements].sort((a,b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
        for (const element of elements) {
          const point = rotateFacePoint(definition, element.x, element.y);
          const opposite = "width" in element ? rotateFacePoint(definition, element.x + element.width, element.y + element.height) : point;
          const color = skin && !element.color && (!("tone" in element) || element.tone !== "accent")
            ? element.kind === "label" ? skin.text : "tone" in element && element.tone === "dark" ? skin.background : "tone" in element && element.tone === "light" ? skin.border : skin.surface
            : element.color;
          result.snapshot.faces[face].elements.push({
          ...element, ...(color ? {color} : {}), id: prefix(element.id), x: Math.min(point.x, opposite.x) * scaleX, y: y + Math.min(point.y, opposite.y) * scaleY,
          ...(definition.rotation && element.kind !== "label" ? {projection: projectFaceArtwork(element, definition, scaleX, scaleY, y)} : {}),
          ...("width" in element ? {width: Math.abs(opposite.x-point.x) * scaleX, height: Math.abs(opposite.y-point.y) * scaleY} : {}),
          ...("radius" in element ? {radius: element.radius * Math.min(scaleX, scaleY)} : {}),
        });
        }
      }
      for (const slot of stored.snapshot.portSlots) {
        const definition = stored.snapshot.faces[slot.face];
        const geometry = faceGeometry(definition);
        const scaleX = 1000 / geometry.width;
        const scaleY = appliedHeight / geometry.height;
        const rotation = ((slot.rotation + (definition.rotation ?? 0)) % 360) as typeof slot.rotation;
        const point = rotateFacePoint(definition, slot.x + slot.width/2, slot.y + slot.height/2);
        const skin = definition.skin ? FACE_SKIN_COLORS[definition.skin] : undefined;
        const quarterTurn = rotation === 90 || rotation === 270;
        const width = slot.width * (quarterTurn ? scaleY : scaleX);
        const height = slot.height * (quarterTurn ? scaleX : scaleY);
        result.snapshot.portSlots.push({...slot, ...(skin && !slot.color ? {color: skin.background} : {}), rotation, id: prefix(slot.id), x: point.x * scaleX - width / 2, width, y: y + point.y * scaleY - height / 2, height, groupId: group.id});
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
