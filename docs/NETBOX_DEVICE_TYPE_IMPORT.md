# NetBox Device Type Import

Rackpad can ingest YAML files from the [NetBox device-type-library](https://github.com/netbox-community/devicetype-library) as **port templates or devices with ports**. Both modes use a preview before writing. Device import creates inventory in the selected lab; neither mode writes IPAM or VLAN data.

Open Rackpad → **Imports** → **NetBox device types**.

## What Works Today

1. Upload a NetBox `device-type` YAML file (`.yaml` / `.yml`).
2. Rackpad parses and previews:
   - manufacturer
   - model
   - U-height (`u_height`)
   - interfaces (`interfaces`)
   - console ports (`console-ports`)
   - power ports (`power-ports`)
3. The preview maps NetBox interface types to Rackpad port kinds (for example `1000base-t` → RJ45 1G, `10gbase-x-sfpp` → SFP+ 10G).
4. Template mode checks for an existing template with the same **manufacturer + model** (via a `netbox:` description tag or matching template name).
5. **Import port template** creates a new custom template through `POST /api/imports/netbox-device-type/import` with `mode: "template"`. Built-in templates and unrelated custom templates are never modified.
6. **Import device** creates a loose device with manufacturer, model, U-height, notes tag, and all parsed interfaces as ports. Dedupe rejects the same manufacturer+model in the selected lab and rejects a hostname already used in that lab.

## Safety Guarantees

- Template mode creates only a port template. Device mode creates a loose device and its ports in one transaction; it does not modify existing devices, racks, cables, subnets, scopes, zones, or VLAN records.
- Duplicate NetBox imports are rejected with HTTP 409 when a matching template already exists.
- Template import requires a global administrator. Device import requires write access to the selected lab. Preview requires authentication and scopes duplicate device matches to readable labs.

## Deferred Work

The following are intentionally **not** implemented in this foundation pass:

- Creating or updating **device type definitions** with imported U-height and manufacturer metadata beyond the imported device record itself.
- Applying imported templates automatically to devices during import (device import already creates ports inline).
- Module bays, inventory items, device bays, and rear/front port pass-through mappings.
- Bulk directory import from a cloned device-type-library repo.
- Image/front-panel rendering from NetBox layout data.
- Slug-based update/merge of an existing NetBox template when the library revision changes.

Issue [#53](https://github.com/Kobii-git/rackpad/issues/53) records the completed foundation. The limitations above remain outside the current importer; this is not a hardware catalog synchronization service.

## API Endpoints

- `POST /api/imports/netbox-device-type/preview` — parse YAML and return preview + dedupe status.
- `POST /api/imports/netbox-device-type/import` — create a port template (`mode: "template"`) or device with ports (`mode: "device"`, requires `labId` + `hostname`).

## Parser Tests

Server unit tests live in `server/tests/netbox-device-type.test.ts` with a representative Cisco Catalyst sample YAML.
