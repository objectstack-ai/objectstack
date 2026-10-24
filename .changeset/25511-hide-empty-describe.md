---
'@objectstack/spec': minor
---

spec(ui): `record:details` section `hideEmpty: false` — in read-only mode an all-empty section renders its heading plus one fold row, and the `describe()` text says so

Clause-②: no
Metadata-protocol: semantic

The meaning of `hideEmpty: false` on a `record:details` section changes for a section whose fields are ALL empty (for example on a brand-new record):

- **Read-only mode:** the section renders its heading plus one fold row that counts the empty fields and reveals them on request — the same fold a partly-filled section already uses. It no longer renders a column of empty rows.
- **Edit mode:** unchanged. Every field renders as an editable row.

Nothing else changes. No key is added, removed or renamed; the shape and the default are the same. Leaving `hideEmpty` out (or writing `true`) still means an all-empty section renders nothing at all: no heading, no skeleton. A partly-filled section's empty rows are not governed by this key, in either value. Authored metadata needs no change: a section that writes `hideEmpty: false` to keep its heading on an empty record keeps it.

The `describe()` text, which the reference docs and the JSON Schema read, now states this. Its lead changes from "Hide this section's empty fields" to "Whether this section disappears when ALL its fields are empty", because under the new reading both values hide an all-empty section's empty rows in read-only mode and the old lead no longer told them apart. The renderer change is in objectui's record detail section.
