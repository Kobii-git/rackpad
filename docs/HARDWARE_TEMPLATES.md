# Guided hardware templates

Open **Admin → Device types** and select a device type. Built-in templates are
read-only: duplicate one before editing. Studio remains opt-in; templates do not
replace the classic rack view or its reference pictures.

## Mixed RJ45 and SFP blocks

1. Start with a switch template. In **Port layout**, select its RJ45 block.
2. Set **Ports** to 24, **Rows** to 1 and **Columns** to 24. Adjust X, Y, Width
   and Height in the face preview, then choose **Update**. Updating retains the
   block and port IDs.
3. Select **New**, choose the same face and the SFP connector, set Ports and
   Columns to 4, and place the block beside the RJ45 block. Choose **Add**.
4. Select either block to edit it independently. **Duplicate** creates a new
   block with unique IDs; **Delete** removes only that block on that face.
5. Repeat on Rear if needed. Front and Rear blocks are independent, even when
   their base names match. Coordinate units belong to the template face, not U.

## Module positions on both faces

A position is the rectangle where a module mounts. A module is the removable
part, including its artwork and physical port slots.

1. In **Module positions**, choose Add, select Front, and set its position and
   dimensions. Select that position in the module controls, choose a port count
   from 1–16, rows and columns, and add a NIC. Eight ports can use 1 × 8
   or 2 × 4. Capacity must cover every port. Fan modules do not create ports.
2. Add another position on Rear and add a PSU there. Module creation uses the
   selected position's face.
3. Move or resize a position: its assigned modules and ports move with it,
   preserving their identities. You can drag the rendered module artwork or its
   position outline; both move the containing position. Switching the position's
   face moves the module too.
4. Remove the assigned module before deleting its position. The Delete position
   action stays disabled while a module references it.

## Four bays from a six-bay chassis

1. Duplicate a six-bay template, then select Front in **Bays and appearance**.
   Choose the appearance primitive type beside the selected element and use Add
   to create the new bay, label, handle, vent, or other artwork.
2. Select the fifth bay's ID and Delete; repeat for the sixth bay. If the design
   has separate labels, handles or indicators for those bays, select and remove
   those associated elements individually. Their IDs remain visible in the list.
3. Select each of the remaining four bays and adjust X, Y, Width and Height.
   Duplicate an element to add matching artwork with a new unique ID.
4. Check the front and rear previews. Appearance edits do not change unrelated
   artwork, module positions, port blocks or inventory ports.

## Colors, resizing, and front/rear transfers

Use the **Physical layout** item list to select artwork, individual ports,
blocks, module positions, or parts inside a module. **Color** offers a native
picker and six-digit hexadecimal input; **Reset** restores the palette. Custom
fills leave selection, linkage, and health outlines or badges visible. Colors
carry through device previews, Rack Studio, and physical SVG/PNG exports.

Drag the selected item's lower-right handle to resize rectangles, blocks,
ports, or module positions. Circular artwork uses a radius handle; labels keep
text and position controls. Pointer movement uses face coordinates at the
current display scale. Escape or pointer cancellation restores the geometry
from the start of the gesture. Numeric size controls remain available. Moving
or resizing a module position transforms every associated module's artwork and
ports together, preserving IDs and compatible metadata.

**Copy to other face** creates fresh IDs; **Move to other face** retains IDs.
Module positions carry their modules and parts. Module parts transfer with their
position. Vertical geometry scales to the destination face height; operations
that exceed its bounds are rejected. A port moved out of a block stays detached
when that source block is regenerated.

Select an existing module to edit its port count, rows, and columns. Changing
the grid preserves port order, IDs, colors, and compatible metadata. Reducing
the explicit count removes template slots; device linked-port conflicts remain
visible in preview/apply.

## Save and apply

Save writes the library template; existing devices retain their saved physical
layout snapshots. To update a device, use the existing preview/apply workflow,
review the proposed port mappings, and retain any linked inventory ports. A
removed physical slot does not authorize deleting its connected inventory port.
Templates continue to use the existing backup format and physical
layout schema; no database migration is introduced.

Colors and module `portGrid` are optional metadata in layout schema version 1.
Existing modules load without regeneration. Backups retain the new metadata;
older binaries may discard these optional fields when rewriting layouts. No
SQLite migration or new API endpoint is required.
