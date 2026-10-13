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
the member filter includes **Stack-wide ports** for unassigned ports. Ports are
not generated or renamed. Unassign referenced ports before deleting a member.
A populated stack cannot change device type or lose its stack ancestry.

The stack retains one hostname, management IP, status, monitoring identity,
integration identity, and rack placement. Member status does not override the
logical status. Controller refreshes preserve manual membership and port
assignments. The height field is read-only; resize the members instead. Placement
and member changes commit together and reject rack overlap or invalid bounds.
Rack shrinking is also checked against stacks. Deleting a rack or parent shelf
unmounts surviving stacks while preserving their members and port assignments.

Rack Studio and Rack Cabling use generic member faces from the same physical
layout that supplies cable anchors, selection targets, and exports. Member
hardware templates and independent member placement/monitoring are not supported.
The physical-layout view is read-only for stacks; inherited canonical port
creation templates remain available.

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
database/configuration snapshot. Never run an older binary against schema 51.
Existing backups remain sensitive and are not deleted automatically.

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
