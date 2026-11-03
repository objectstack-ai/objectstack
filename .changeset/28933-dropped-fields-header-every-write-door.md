---
'@objectstack/rest': patch
'@objectstack/spec': patch
'@objectstack/client': patch
---

fix(rest): every 2xx write answer whose body reports `droppedFields` also sends the `X-ObjectStack-Dropped-Fields` header

Clause-②: yes (widening)
Metadata-protocol: none

Single `POST /data/:object` and `PATCH /data/:object/:id` advertise a legal write strip (a static `readonly` or a true `readonlyWhen` field) in the body and in the `X-ObjectStack-Dropped-Fields` header. The other write doors reported the same strip in the body only, so a caller that reads the header was told nothing. They now send the header too, through the same `applyDroppedFieldsHeader` seam and in the same `field;reason=REASON` format:

- **Clone** (`POST /data/:object/:id/clone`): the clone's own strips.
- **createMany** (`POST /data/:object/createMany`): the body's `droppedFields` is already the union of the rows' strips (its answer has no per-row slot), and the header names that union.
- **Per-row bulk doors**: the per-object `POST /data/:object/batch`, `POST /data/:object/updateMany` and an import commit (`POST /data/:object/import`) report each row's strips in `results[i].droppedFields`. The header names their union.
- **Cross-object `POST /batch`**: its body reports one event per op, with the op's `index`. The header names their union.

The header has one token per field and reason, so it cannot say which row, op or object dropped a field. On a bulk door it names the union, each token once, and the body keeps the per-row report. A field one row strips and another does not is still named once. The stale roll-up answer (`201` over a write that landed) of clone and createMany carries the header as their success answers do. Each door sends no header when nothing was stripped, and an import dry run sends none: it writes nothing, though its rows preview the strip in the body. Response bodies and statuses are unchanged.

The spec's `.describe()` text on the clone, createMany and batch-row `droppedFields`, and the client's `CloneDataResult` docblock, stop saying that these answers carry no header.
