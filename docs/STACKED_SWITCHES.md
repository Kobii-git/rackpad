# Stacked switches

A **Stacked switches** device represents one logical managed switch assembled
from ordered physical members. It inherits switch port templates and controls.
Custom device types can inherit from Stacked switches too. Existing switches are
never converted automatically.

Create a device with this type, or change an existing switch's type explicitly.
Open its **Stack Members** tab to add members. Each member records a name,
manufacturer, model, serial, height, descriptive status, notes, and labelled MAC
addresses. MAC addresses are normalized to lowercase colon notation and must be
unique within that member. Each member is 1–20U; the logical device's height is
the sum, or a 1U placeholder when empty.

Use **Move up** and **Move down** to set top-to-bottom order. Both work with the
keyboard. Assign existing canonical ports to members in the workspace table;
the member filter includes **Stack-wide ports** for unassigned ports. Ordinary member edits do not generate or rename ports.
Member layout apply can create only explicitly approved missing ports. Unassign referenced ports before deleting a member.
A populated stack cannot change device type or lose its stack ancestry.

The stack retains one hostname, management IP, status, monitoring identity,
integration identity, and rack placement. Member status does not override the
logical status. Controller refreshes preserve manual membership and port
assignments. The height field is read-only; resize the members instead. Placement
and member changes commit together and reject rack overlap or invalid bounds.
Rack shrinking is also checked against stacks. Deleting a rack or parent shelf
unmounts surviving stacks while preserving their members and port assignments.

Each member has its own **Physical layout** selector and Preview/Apply controls.
Choose a hardware template and installed modules, inspect both faces and canonical
port mappings, and approve each missing port you want created. Unassigned
stack-wide ports must be explicitly selected before they become mapping candidates;
ports belonging to another member cannot be taken implicitly. Linked ports must
remain mapped. Changing the proposed member height also requires an explicit
approval, and apply rejects rack bounds or collisions atomically.

Applied layouts are independent snapshots. Editing or deleting the library
source does not change a member. Reordering and renaming members preserve slot
namespaces, canonical port IDs and cables. Rack Studio, Rack Cabling, tracing and
exports use the same composed snapshots, scaled into member footprints. Members
without a snapshot keep generic faces; unassigned stack-wide ports retain their
separate area. Unmapped member ports remain visible in a generic area within
that member. Members still share the logical device's placement and monitoring.
Manufacturer/model suggestions come from accessible records in the current lab;
model suggestions are filtered by manufacturer and both fields accept free text.

## Backup and compatibility

Schema 51 adds members, labelled MACs, and nullable port-member associations.
Logical and native backups preserve them. Logical restores validate ownership,
ordering, member data, derived height, and physical geometry before committing.
Older logical backups without membership remain supported. Native schema-50
snapshots remain accepted only when they have genuine pre-stack structure; the
next application startup applies migration 51. The security cutoff remains 50.
Native restores validate the supplied snapshot rather than the active database.

Retain the encryption key and take a database/configuration backup before
upgrading. Rollback requires the matching previous application and pre-upgrade
database/configuration snapshot. Never run an older binary against an unsupported schema.
Existing backups remain sensitive and are not deleted automatically.

Schema 54 appends `deviceStackMemberLayouts`, keyed by member ID, with the
resolved snapshot, canonical bindings, status, source-template identity and
fingerprint. Logical/native recovery validates ownership, physical-port kinds,
slot references and compatibility. Backups without this table restore generic
member faces. Snapshots remain valid when their source library template is absent.
Before schema 54, retain a protected database/configuration snapshot and its
matching image. Rollback restores that pair; an older image must not open schema 54.

## API

All member routes require authentication and permission for the logical device's
lab. Reads allow viewers; writes require lab editor or administrator access.

- `GET /api/devices/:id/stack-members` returns members in order, each with `macs`.
- `POST /api/devices/:id/stack-members` creates a member.
- `PATCH /api/devices/:id/stack-members/:memberId` updates member metadata.
- `DELETE /api/devices/:id/stack-members/:memberId` removes an unreferenced member.
- `PUT /api/devices/:id/stack-members/order` accepts `{ "memberIds": [...] }`,
  containing every member ID exactly once.

Member input fields are `name`, `manufacturer`, `model`, `serial`, `heightU`,
`status`, `notes`, and `macs: [{ label, macAddress }]`. Omitted PATCH fields are
preserved; an empty MAC array clears MAC entries. IDs, ownership, and position
are server controlled. Device responses include `stackMembers` for stacks.
Port create/PATCH accepts `stackMemberId`; null clears it, omission preserves an
existing assignment. Cross-device assignment is rejected. Referenced deletion,
populated type changes, and overriding derived height return HTTP 409.

Member responses include nullable `appliedLayout: { sourceTemplateId, status }`.
The following authenticated endpoints resolve authorization through the logical
parent device, then verify member ownership:

- `GET /api/devices/:id/stack-members/:memberId/physical-layout` reads the stored snapshot (lab read access).
- `POST .../physical-layout/preview` requires lab write access and accepts `templateId`, optional `moduleIds`, `heightU`, `unassignedPortIds`, and requested `bindings`.
- `POST .../physical-layout/apply` repeats those inputs plus `expectedFingerprint`, `approvedPortSlotIds`, and `acceptHeightChange` when resizing.

Preview returns mappings, conflicts, linked unmapped ports, missing-port proposals,
current/proposed/suggested heights and a fingerprint. Apply recomputes the preview
inside the transaction. Changes to the member, device placement, prior layout,
ports, cables or selected template invalidate it. Successful apply and its audit
entry commit together; rejected apply leaves inventory unchanged.
