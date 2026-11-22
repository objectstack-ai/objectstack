---
'@objectstack/spec': minor
---

fix(spec)!: retire `columnState` from the stored `view` row — column widths live in each reader's browser and a column order is saved into the view itself

Clause-②: no (narrowing) — `columnState` stops being an accepted key on a view item record and on a flattened view overlay; no published export is removed
Metadata-protocol: narrowed

<!-- adr-0087: registered view-column-state-retired -->

**BREAKING** for a stored `view` row, a package view or a source that still carries `columnState`. The key held the console grid's per-user column order and widths on a shared view row (admitted as a runtime-only overlay key in 17.1.0). Since #35955 nothing writes it: a column drag goes to the list's draft and is saved into the view's own `columns` / `fieldOrder`, and column widths are kept in the reader's browser, per view. Until this release a stored layout was still applied: a reader with no column order or widths of their own in the browser saw the order and widths the row held. It is not carried forward (the maintainer's ruling on #35955, restated on #36403 in comment 7079029398: a stored layout is not migrated): from this release that reader sees the view's own columns, column order and widths. No stored order is moved into `fieldOrder`; to keep a layout for everyone, reorder the columns and Save to the view, or set `width` on the columns.

What moves (each line FROM → TO):

- `columnState` on a view item record (`ViewItemWireSchema`, member 1 of the `view` union the `PUT /api/v1/meta/view/:name` save validates) and on a flattened view overlay (`VIEW_METADATA_MEMBERS.listOverlay` / `formOverlay`): FROM `{ order?: string[]; widths?: Record<string, number> }` accepted and stored TO a `retiredKey()` tombstone — the save answers 422 `INVALID_METADATA` with the prescription at the key, and `tsc` types the key `never`.
- `VIEW_CONSOLE_ROUND_TRIP_KEYS` (`@objectstack/spec/ui`): FROM six keys TO five; `columnState` is gone, so the console derivations read off it (`@object-ui/data-objectstack`'s `listViews()` row keys, `@object-ui/app-shell`'s view-config save) stop carrying it without an edit.
- `columnState` on an authored view item or a list view body: still refused by name, now with the retirement text instead of the runtime-only note.
- a stored `view` row (every read replays the conversions before the row is served or badged), a package export or environment artifact (`viewItems`), and a source run through `os migrate meta --from 17`: the D2 conversion `view-column-state-removed` deletes the key from a view item record and from a flattened overlay; containers are untouched.

The fix: delete the key. To ship a default column order, list `columns` in that order (or set `fieldOrder`); to ship a default width, set `width` on the column. Run `os migrate meta --from 17` to list the mechanical edits for existing sources, and `os migrate meta --stored --apply` to rewrite stored rows.

One stored class is not brought back into the accept set: an overlay row that held nothing but its identity (`name` / `object` / `viewKind` / `label`) and `columnState` — what a column drag on a system view wrote before the overlay writer retired — is left identity-only, which the `view` door refuses ("only identity fields"). It is served badged invalid and `--apply` reports it `failed`. Delete such a row; it held only a column layout that is not carried forward. D3 entry: `view-column-state-retired`.

The retirement kit: `retiredKey()` tombstones in `ui/view.zod.ts`, D2 `view-column-state-removed` (step 18), `RETIRED_KEYS_BY_MAJOR[18]` rows `ui/ViewItemWire:columnState` and `ui/ViewMetadata:columnState`, D3 `view-column-state-retired`, the regenerated `view.mdx` reference, and the pin `ui/view-column-state-retirement.test.ts`.
