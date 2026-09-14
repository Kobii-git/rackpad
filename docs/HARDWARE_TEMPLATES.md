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
   dimensions. Select that position in the module controls and add a NIC.
2. Add another position on Rear and add a PSU there. Module creation uses the
   selected position's face.
3. Move or resize a position: its assigned modules and ports move with it,
   preserving their identities. Switching the position's face moves them too.
4. Remove the assigned module before deleting its position. The Delete position
   action stays disabled while a module references it.

## Four bays from a six-bay chassis

1. Duplicate a six-bay template, then select Front in **Bays and appearance**.
2. Select the fifth bay's ID and Delete; repeat for the sixth bay. If the design
   has separate labels, handles or indicators for those bays, select and remove
   those associated elements individually. Their IDs remain visible in the list.
3. Select each of the remaining four bays and adjust X, Y, Width and Height.
   Duplicate an element to add matching artwork with a new unique ID.
4. Check the front and rear previews. Appearance edits do not change unrelated
   artwork, module positions, port blocks or inventory ports.

## Save and apply

Save writes the library template; existing devices retain their saved physical
layout snapshots. To update a device, use the existing preview/apply workflow,
review the proposed port mappings, and retain any linked inventory ports. A
removed physical slot does not authorize deleting its connected inventory port.
Templates continue to use the existing schema-52 backup format and physical
layout schema; no database migration is introduced.
