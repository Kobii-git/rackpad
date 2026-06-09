# Reports

The Reports workspace turns live Rackpad inventory into a clean operational
summary that can be shared, printed, or opened in a spreadsheet.

Open Rackpad -> `Reports`.

## What The Report Includes

- Lab summary and generated timestamp.
- Device inventory by type, status, placement, rack, and management IP.
- Port and cable inventory with linked endpoints.
- VLAN and IPAM summary, including subnet allocation counts.
- Monitoring summary with device rollup state and target status.
- WiFi controllers, SSIDs, APs, clients, and association context.

The report is generated from your current Rackpad data. It does not invent
metrics or include hidden sample rows.

## Export Options

### Print / PDF

1. Open `Reports`.
2. Click `Print / PDF`.
3. In the browser print dialog, choose `Save as PDF` or a printer.
4. Use landscape orientation if your report is wide.

The print stylesheet removes navigation chrome and switches the report to a
light, paper-friendly layout.

Printed reports include two layers of content:

- **On-screen summaries** — metric cards, rack utilization, monitoring posture,
  subnet allocation, WiFi counts, and recent audit activity (same as the
  Reports page).
- **Print-only detail tables** — full device inventory (hostname, type, status,
  management IP, formatted placement, ports), every documented port and cable
  link, and the complete IPAM dataset (subnets, VLANs, DHCP scopes, zones, and
  assignments). These tables are hidden on screen and appear only when printing
  or saving as PDF.

Detail tables reuse the same column layout as the CSV and Excel exports, so a
printed PDF lines up with spreadsheet exports for audits and change reviews.

Documentation pages also support `Print / PDF` from the Documentation workspace.
The print layout hides the sidebar and editor, shows the rendered markdown
preview full width, and includes the page title with lab name and generation
timestamp in the print header.

### Excel Workbook

1. Open `Reports`.
2. Click `Excel workbook`.
3. Open the downloaded `.xls` file in Excel or LibreOffice.

The workbook is HTML-based and Excel-compatible. It contains multiple sheets so
you can filter and sort inventory without copying data out of Rackpad manually.

### CSV Exports

Use `Full CSV` for a combined export, or the section-specific CSV buttons when
you only need a smaller dataset.

CSV is best when you want to feed Rackpad data into another tool, script, or
spreadsheet workflow.

## Privacy Notes

Reports are intended for operational sharing. They exclude local user password
hashes and notification secrets. Use the admin backup export when you need a
full restore snapshot.

Reports can still include internal hostnames, IP addresses, MAC addresses,
device notes, VLAN names, and monitoring targets, so treat exported files as
internal infrastructure documentation.

## Good Release Workflow

Before a major Rackpad update:

1. Download an admin backup from `Users`.
2. Open `Reports`.
3. Export the Excel workbook.
4. Save a PDF copy for a human-readable checkpoint.
5. Update Rackpad.
6. Re-run the report and compare inventory counts.
