---
"@objectstack/spec": patch
---

docs(spec): re-cite objectui's data-table column accessor as `accessorKey` only (#14166)

Two notes in this package described objectui's `data-table` accessor as
resolving two spellings, `accessorKey || name`:

- `liveness/field.json` — the `relatedListColumns` entry's `note`
- `src/conversions/registry.ts` — the `field-column-lists-canonicalized`
  docblock

objectui#6963 retired the `name` alias, and the console pin this repo builds
against (`.objectui-sha` = `67dadd602a3a891666ea1513c5de677140784b6a`) contains
it: at that commit the adapter maps `accessorKey: col.accessorKey` with no
fallback (`packages/components/src/renderers/complex/data-table.tsx:872-876`),
while `columnIdentity` still resolves canonical `field` first
(`packages/core/src/utils/column-identity.ts:69`). Both notes described a
two-spelling resolution that no longer exists, and each carried a measurement
date that predated the retirement.

Citation accuracy only. Both notes reach the same conclusion they already did —
a spec-canonical `{ field }` object entry renders blank cells, so the
conversion folds an object entry to its identity string and the parse refuses
what has no resolvable identity. No verdict moves, no ledger state changes, no
accepted shape moves, and no code changes: the `relatedListColumns` entry keeps
its `live` status, its `verifiedAt`, its `evidence` and every count.

Why this publishes at all: `liveness/**` is in this package's `files`, and the
`registry.ts` docblock ships inside `dist/*.map` `sourcesContent`, so both
edited byte-ranges are in the tarball.
