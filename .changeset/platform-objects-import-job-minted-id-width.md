---
'@objectstack/platform-objects': patch
---

`sys_import_job.created_by`'s bound derivation no longer justifies its headroom with a false width. The comment claimed "a minted platform id is 26 characters"; measured on this tree by driving the real `SqlDriver` against SQLite, twelve `create()` calls supplying no id yield exactly one distinct width, **16** — and a caller-supplied id is stored verbatim at whatever width the caller chose (10, 17, 18, 26, 40 and 200 all landed and read back unaltered), so nothing on the write path bounds an id's width at all.

This is a published byte, not an internal note: `@objectstack/platform-objects` ships no `src/` in its `files[]`, but the comment survives bundling and appears verbatim in four shipped artefacts — `dist/index.js`, `dist/index.mjs`, `dist/audit/index.js` and `dist/audit/index.mjs`.

The correction does **not** restate a new number, because a number is what expires: a mint width is driver-owned (`driver-sql`, `driver-mongodb` and `driver-turso` each spell their own `DEFAULT_ID_LENGTH`, and `driver-memory` mints a variable-width shape that is not one at all), so the comment now points at `driver-sql`'s `[#15522]` note beside that constant — where the claim is measured and maintained — and states the reason `255` is safe without appealing to a floor: it is the width of the column this value is copied from, which is the referenced-column transitivity the block already derives.

`maxLength: 255` is unchanged, the derivation above it is unchanged, and no accept set, schema arm, index or export moves. `DEFAULT_ID_LENGTH` is untouched.
