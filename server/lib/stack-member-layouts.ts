import { createHash } from "node:crypto";
import { db } from "../db.js";
import {
  getPhysicalHardwareTemplate,
  getPhysicalLayoutPorts,
} from "./device-physical-layout.js";
import { deviceTypeMatches } from "./device-types.js";
import { listStackMembers, syncStackHeight } from "./device-stacks.js";
import { createId } from "./ids.js";
import {
  buildAutoPhysicalLayout,
  resolveTemplateSnapshot,
  validateResolvedPhysicalLayoutV1,
  validatePortBindingsV1,
  portSetFingerprint,
  proposePhysicalPortBindings,
  type PhysicalLayoutDevice,
  type PortBindingV1,
} from "./physical-layout.js";
import { readStackMemberLayouts } from "./stack-member-layout-data.js";
import {
  optionalInteger,
  optionalStringArray,
  requiredString,
  ValidationError,
} from "./validation.js";

export function previewStackMemberLayout(
  device: PhysicalLayoutDevice,
  memberId: string,
  body: Record<string, unknown>,
) {
  const member = listStackMembers(device.id).find(
    (member) => member.id === memberId,
  );
  if (!member) throw new ValidationError("Stack member not found.", 404);
  const templateId = requiredString(body, "templateId", { maxLength: 120 });
  const template = getPhysicalHardwareTemplate(templateId);
  if (!template)
    throw new ValidationError("Selected hardware template does not exist.");
  if (!deviceTypeMatches(device.deviceType, template.deviceTypes))
    throw new ValidationError(
      "Hardware template does not support this stack device type.",
    );
  const allPorts = getPhysicalLayoutPorts(device.id);
  const unassignedPortIds =
    optionalStringArray(body, "unassignedPortIds", { maxItems: 500 }) ?? [];
  if (
    new Set(unassignedPortIds).size !== unassignedPortIds.length ||
    unassignedPortIds.some(
      (id) => !allPorts.some((port) => port.id === id && !port.stackMemberId),
    )
  )
    throw new ValidationError(
      "Select only unassigned stack-wide ports from this device.",
    );
  const ports = allPorts.filter(
    (port) =>
      port.stackMemberId === memberId || unassignedPortIds.includes(port.id),
  );
  const moduleIds =
    optionalStringArray(body, "moduleIds", { maxItems: 64 }) ?? [];
  const heightU =
    optionalInteger(body, "heightU", { min: 1, max: 20 }) ?? member.heightU;
  const auto =
    templateId === "generic-auto-v1" || templateId === "legacy-auto-v1";
  if (auto && moduleIds.length)
    throw new ValidationError("Generic layouts do not support modules.");
  const snapshot = validateResolvedPhysicalLayoutV1(
    auto
      ? buildAutoPhysicalLayout(
          { ...device, heightU },
          ports,
          templateId === "legacy-auto-v1" ? "legacy" : "generic",
        ).snapshot
      : resolveTemplateSnapshot(template, { ...device, heightU }, moduleIds),
  );
  const current = readStackMemberLayouts(db, device.id).get(memberId);
  const requested =
    body.bindings === undefined
      ? current?.bindings.filter(
          (binding) =>
            snapshot.portSlots.some((slot) => slot.id === binding.slotId) &&
            ports.some((port) => port.id === binding.portId),
        )
      : validatePortBindingsV1(body.bindings);
  const mapping = proposePhysicalPortBindings(snapshot, ports, requested);
  const linked = db
    .prepare(
      "SELECT fromPortId, toPortId FROM portLinks WHERE fromPortId IN (SELECT id FROM ports WHERE deviceId=?) OR toPortId IN (SELECT id FROM ports WHERE deviceId=?) ORDER BY id",
    )
    .all(device.id, device.id) as Array<{
    fromPortId: string;
    toPortId: string;
  }>;
  const linkedIds = new Set(
    linked.flatMap((link) => [link.fromPortId, link.toPortId]),
  );
  const occupied = new Set(mapping.bindings.map((binding) => binding.slotId));
  const portsToCreate = snapshot.portSlots
    .filter((slot) => !occupied.has(slot.id))
    .map((slot) => ({
      slotId: slot.id,
      name: `${member.name} · ${slot.label ?? slot.id}`,
      kind: slot.acceptedPortKinds[0] ?? slot.connector,
      face: slot.face,
    }));
  const placement = db
    .prepare("SELECT * FROM devices WHERE id=?")
    .get(device.id);
  // Hash complete live inputs, including link state and the selected library definition.
  const expectedFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        member,
        placement,
        current,
        template,
        allPorts,
        linked,
        moduleIds,
        unassignedPortIds,
        heightU,
        bindings: mapping.bindings,
      }),
    )
    .digest("hex");
  return {
    deviceId: device.id,
    memberId,
    templateId,
    moduleIds,
    unassignedPortIds,
    heightU,
    currentHeightU: member.heightU,
    suggestedHeightU: template.mountDefaults.heightU,
    snapshot,
    ...mapping,
    linkedUnmappedPortIds: mapping.unmappedPortIds.filter((id) =>
      linkedIds.has(id),
    ),
    portsToCreate,
    expectedFingerprint,
  };
}
export function applyStackMemberLayout(
  device: PhysicalLayoutDevice,
  memberId: string,
  body: Record<string, unknown>,
) {
  return db.transaction(() => {
    const preview = previewStackMemberLayout(device, memberId, body);
    if (body.expectedFingerprint !== preview.expectedFingerprint)
      throw new ValidationError(
        "Stack layout preview is stale. Preview again before applying.",
        409,
      );
    if (preview.conflicts.length || preview.linkedUnmappedPortIds.length)
      throw new ValidationError(
        "Resolve port binding conflicts before applying this stack layout.",
        409,
      );
    const approved =
      optionalStringArray(body, "approvedPortSlotIds", { maxItems: 500 }) ?? [];
    if (
      new Set(approved).size !== approved.length ||
      approved.some(
        (id) => !preview.portsToCreate.some((port) => port.slotId === id),
      )
    )
      throw new ValidationError(
        "Approved port slots must belong to this preview.",
      );
    if (
      preview.heightU !== preview.currentHeightU &&
      body.acceptHeightChange !== true
    )
      throw new ValidationError("Explicitly approve the member height change.");
    const bindings: PortBindingV1[] = [...preview.bindings];
    for (const binding of bindings)
      db.prepare(
        "UPDATE ports SET stackMemberId=? WHERE id=? AND deviceId=? AND stackMemberId IS NULL",
      ).run(memberId, binding.portId, device.id);
    let position = (
      db
        .prepare(
          "SELECT COALESCE(MAX(position),0) AS position FROM ports WHERE deviceId=?",
        )
        .get(device.id) as { position: number }
    ).position;
    const createdPortIds: string[] = [];
    for (const slotId of approved) {
      const proposal = preview.portsToCreate.find(
        (port) => port.slotId === slotId,
      )!;
      const portId = createId("p");
      db.prepare(
        "INSERT INTO ports (id,deviceId,stackMemberId,name,position,kind,face,linkState,mode,portRole) VALUES (?,?,?,?,?,?,?,'down','access','physical')",
      ).run(
        portId,
        device.id,
        memberId,
        proposal.name,
        ++position,
        proposal.kind,
        proposal.face,
      );
      bindings.push({ portId, slotId });
      createdPortIds.push(portId);
    }
    db.prepare("UPDATE deviceStackMembers SET heightU=? WHERE id=?").run(
      preview.heightU,
      memberId,
    );
    syncStackHeight(device.id);
    const now = new Date().toISOString();
    const ports = getPhysicalLayoutPorts(device.id).filter(
      (port) => port.stackMemberId === memberId,
    );
    const status = preview.unmappedPortIds.some((id) =>
      ports.some((port) => port.id === id),
    )
      ? "needs-mapping"
      : preview.templateId === "legacy-auto-v1"
        ? "legacy-default"
        : preview.templateId === "generic-auto-v1"
          ? "generic-default"
          : "accurate";
    db.prepare(
      `INSERT INTO deviceStackMemberLayouts (memberId, sourceTemplateId, status, snapshot, bindings, portFingerprint, createdAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(memberId) DO UPDATE SET sourceTemplateId=excluded.sourceTemplateId,status=excluded.status,snapshot=excluded.snapshot,bindings=excluded.bindings,portFingerprint=excluded.portFingerprint,updatedAt=excluded.updatedAt`,
    ).run(
      memberId,
      preview.snapshot.sourceTemplateId,
      status,
      JSON.stringify(preview.snapshot),
      JSON.stringify(bindings),
      portSetFingerprint(ports),
      now,
      now,
    );
    return { memberId, createdPortIds, bindings };
  })();
}
