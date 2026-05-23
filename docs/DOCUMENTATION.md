# Documentation And Images

Rackpad includes a Markdown documentation workspace for runbooks, notes, and
reference material, plus image attachments on individual device pages.

## Markdown Documentation

Open Rackpad -> `Docs`.

You can:

- Create one documentation page per runbook, room, rack, service, or procedure.
- Search documentation by title or content.
- Edit Markdown and preview the rendered page side by side.
- Insert PNG, JPEG, WebP, or GIF images directly into the page.

Images inserted into Markdown are stored as data URLs in the documentation page.
Use them for diagrams, rack photos, room references, screenshots, or small
how-to images.

## Device Images

Open Rackpad -> `Devices`, choose a device, then open the `Images` tab.

You can attach reference images with:

- label
- original filename
- notes
- upload date

Good uses include rack-position photos, room-location photos, port labels,
wall-mount references, serial label photos, or before/after cabling shots.

## Limits

- Supported image types: PNG, JPEG, WebP, and GIF.
- Maximum size: 6 MB per image.
- Large images are stored in the Rackpad database, so keep routine reference
  images reasonably sized.

## Backups

Admin backups include:

- documentation pages
- inline Markdown images
- device image attachments
- labels and notes

Before upgrades, download a backup from:

```text
Users -> Backup and release state -> Download backup
```

The seeded demo environment includes example documentation pages and device
images so the workflows are visible immediately after choosing demo data on
first run.
