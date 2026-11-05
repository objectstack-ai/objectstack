---
'@objectstack/lint': patch
---

fix(lint)!: the object publish door refuses an object whose own list view sorts by a field the list door refuses (`sortable: false`, a `formula`, or a name the object lacks) (#30095)

Clause-②: no (narrowing) — an object write the door accepted before is refused: an object whose built-in `listViews.*.sort` names a field the list door answers `400 INVALID_SORT` now saves `422 INVALID_METADATA`.
Metadata-protocol: none
Skills-docs: none — `skills/**` names no `sortable` field key, and `content/docs/deployment/validating-metadata.mdx` lists the doors by rule family, not by reference-integrity member, so it names no object crossing to correct; the prescription ships in the refusal text.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed, and nothing an author may write changes: `os validate` / `os build` / `os lint` already refused this sort. The object publish door now gives an object's own list view sort the verdict the CLI, the view door and the page door already give it. A refused name never sorted anything (the list door answered every load 400 INVALID_SORT), so there is no rewrite that keeps what the author meant; the author sorts by a sortable field, and the refusal says which field and why. -->

**BREAKING** accept-set narrowing at the object publish door (`PUT /api/v1/meta/object/NAME`; Studio, REST and MCP authors).

- **Before.** `validateSortableFields` judged a list view's `sort` on the CLI, at the `view` door and at the `page` door, but not on an `object` write. An object whose built-in list view sorted by a field declaring `sortable: false`, by a virtual `formula`, or by a name the object does not have saved green, and that list view answered `400 INVALID_SORT` on its first load and every load after it.
- **Now.** The member declares `object`, so the object door refuses that save `422 INVALID_METADATA` with `sort-field-unsortable` or `sort-field-unknown` at `error`, at the sort key's path (`objects.NAME.listViews.KEY.sort[i]`). Nothing is stored.
- **Not changed.** A stored object already carrying such a sort keeps loading; only its next save is judged, and a stored sibling in violation is never charged to another object's write. A `?mode=draft` save is not judged, as before.

**What an author does.** Sort the list view by a sortable field, or remove `sortable: false` from the field it names. A refused sort never ordered the list, so there is nothing to keep.
