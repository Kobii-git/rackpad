# MCP inventory proposals (beta)

Rackpad can serve a stateless Streamable HTTP MCP endpoint from its existing Fastify process at `/api/mcp`. It is disabled by default. Set `MCP_ENABLED=1` and restart Rackpad to enable it. No additional listener or container port is used. Publish Rackpad through HTTPS, set `TRUSTED_HOSTS` to the public hostname and `TRUSTED_ORIGINS` to the browser origin, and retain the normal rate limit and CSP. The MCP route additionally checks Host and Origin against those allowlists. Generic non-browser clients normally send no Origin header.

Use **MCP** in Rackpad's sidebar to create a personal token. Select one or more labs you can currently access, a read or write capability, and an expiry of at most 30 days. Viewers can create read tokens only. Copy the bearer token when it appears; Rackpad stores its SHA-256 hash and will not display the token again. Configure a generic HTTP client with the server URL `https://your-rackpad.example/api/mcp` and `Authorization: Bearer <token>`. Use a client that supports the MCP 2026-07-28 protocol revision. OAuth discovery and sign-in are not available in this release. Revoke tokens on the same page. Changes to the owner's role, disabled status, or lab grants take effect on the next request.

Read tools list labs, rooms, racks, devices, ports, and connections. Each list uses a cursor and a limit of 1–100. The lab-scoped tools require a `labId` granted to the token. The `propose_inventory` tool exists only for write tokens. It accepts one lab and a bounded batch of racks, devices, ports, and connections. Each proposed record has a local `key`; later records refer to it with `{ "key": "..." }`. Existing same-lab racks, devices, and ports can be referenced with `{ "id": "..." }`. Devices may include a Studio placement (`direct`, `rack-top`, `side`, `shelf`, or `loose`). A proposal contains at most 10 racks, 100 devices, 500 ports, and 250 connections.

The tool runs the complete batch in a rollback-only SQLite transaction and returns the exact creation summary, warnings, one-hour expiry, and review link. It does not commit inventory. Open the link as the **same Rackpad user** who owns the token, inspect the full batch in the review page, and choose Apply. The server checks current write permission and inventory again, creates and audits every record in one transaction, then consumes the draft. If inventory changed, any validation fails, or the draft expired, create a new proposal. Drafts are process memory; restarting Rackpad discards them. There is no MCP apply, update, or delete tool.

MCP token rows are excluded from JSON exports and removed from native backup snapshots, so a restore revokes them. The schema-53 migration is forward-only. Before upgrading, record a protected database snapshot and keep it paired with the prior container image. To roll back the application version, restore that pre-upgrade snapshot with the prior image; do not start an older image against a schema-53 database. Issued tokens and pending drafts must be recreated after rollback or restore.

## Worked rack-photo proposal

Use a write token scoped to the photographed lab. First discover `tools/list` in
your MCP client and inspect `propose_inventory.inputSchema`; do not guess the
available fields or assume an apply tool exists. Discover the allowed lab with
`list_labs`, then page `list_rooms`, `list_racks`, `list_devices`, `list_ports` and
`list_connections` using the returned `nextCursor` until it is null. Reuse known
same-lab IDs for existing inventory instead of proposing duplicates.

For this synthetic example, the operator has confirmed a new 12U rack, a 1U server
at U 2, a 1U switch at U 6, and a visible Ethernet connection. A photo alone does not
prove rack height, hidden rear ports, cable destinations, model or live link state.
Leave uncertain details out and confirm them before proposing. Replace `LAB_ID`
with an ID returned by discovery, then call `propose_inventory` with:

```json
{
  "labId": "LAB_ID",
  "racks": [{ "key": "rack", "name": "Photo rack", "totalU": 12 }],
  "devices": [
    { "key": "server", "hostname": "photo-server", "deviceType": "server",
      "placement": { "mountKind": "direct", "rack": { "key": "rack" },
        "startU": 2, "heightU": 1, "face": "front", "column": 0, "columnSpan": 12 } },
    { "key": "switch", "hostname": "photo-switch", "deviceType": "switch",
      "placement": { "mountKind": "direct", "rack": { "key": "rack" },
        "startU": 6, "heightU": 1, "face": "front", "column": 0, "columnSpan": 12 } }
  ],
  "ports": [
    { "key": "nic", "device": { "key": "server" }, "name": "eth0", "kind": "rj45", "face": "front" },
    { "key": "access", "device": { "key": "switch" }, "name": "1", "kind": "rj45", "face": "front" }
  ],
  "connections": [{ "from": { "key": "nic" }, "to": { "key": "access" }, "cableType": "Cat6" }]
}
```

Local keys connect records created in this batch; `{ "id": "EXISTING_ID" }`
references already-discovered inventory. For example, replace `rack: {key:"rack"}`
with a known `rack: {id:"..."}` and omit the new rack when using an existing rack.
Review the returned summary, warnings and `reviewLink` in Rackpad as the token's
owner. Check every U position, face, column and cable endpoint, then Apply once.
Occupied positions, stale inventory, changed permissions and invalid references
reject the whole batch. Expired drafts or tokens require a fresh proposal/token;
revocation takes effect on subsequent SDK requests.

Automated acceptance uses the real MCP SDK client over Streamable HTTP, including
discovery, multi-page scoped reads, proposals, browser review/apply, expiry,
revocation, role/grant changes, cross-lab denial, stale inputs and atomic rejection.
Acceptance in a reporter's specific client remains a separate external check.
