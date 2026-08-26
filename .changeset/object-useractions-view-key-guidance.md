---
"@objectstack/spec": patch
---

docs(spec): wrong-layer guidance for `group` / `hideFields` / `rowColor` on the object `userActions` block (#11459)

`data/object.zod.ts`'s object-level `userActions` block already curated
`sort` / `search` / `filter` / `editInline` with a pointer at the VIEW
`userActions` block they actually belong to. `group` / `hideFields` /
`rowColor` — adopted onto the view's vocabulary at #11195 — shared the same
wrong-layer trap but got only the generic unknown-key rejection with an
edit-distance suggestion, which has nothing useful to offer over the object
block's `create`/`import`/`edit`/`delete`/`exportCsv` shape.

**Nothing changes about what parses.** All three keys were rejected on the
object block before this change and are rejected after it; only the message
gains the same curated pointer the other four wrong-layer keys already carry.
