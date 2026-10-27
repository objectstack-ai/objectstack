---
'@objectstack/spec': minor
---

fix(spec)!: the `view` write door refuses an unknown top-level key on a view item record and on an inline list or form view, as the object, page and dashboard doors do, instead of saving without it

`ViewMetadataSchema` judges every `view` body saved through `PUT /api/v1/meta/view/:name` (draft or publish), the MCP metadata tools and Studio. Three of its four members (the view item record `{ name, object, viewKind, config }`, and the inline list and form views that carry their config at the top level) dropped a top-level key they do not declare. The save stores the parsed body, so a misspelt or retired key answered success and was not stored. They now refuse it with `422 INVALID_METADATA` / `unrecognized_keys`, naming the key and the shape: `Unrecognized key(s) on this inline list view: \`striped\`.` The `defineView` container was already closed.

Clause-②: no (narrowing) — the `view` write door refuses a body carrying an undeclared top-level key on a view item record or an inline list or form view, which it saved before without the key. Nothing is widened.

Metadata-protocol: narrowed (a saved `view` body may no longer carry a top-level key its shape does not declare)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: the three members declared the same keys before and after, and every key the console writes and reads back is among them. An undeclared key never reached the store, since the save stores the parsed body, so there is nothing for a migration to rewrite; the author decides, and the refusal names the key. -->

**BREAKING** accept-set narrowing at the `view` write door (`@objectstack/spec`), served by every door that saves a `view`.

- **Before.** `PUT /api/v1/meta/view/:name` with a valid inline list view plus `"zzz_junk_key": true`, or a retired list key such as `"striped": true`, answered `200`, and the key was absent from the stored view. The same held for a view item record and an inline form view.
- **Now.** The same body answers `422 INVALID_METADATA` with an `unrecognized_keys` issue naming the key. A retired key gets what its retirement gives it: a key whose retirement is still current (`filterableFields`, `pageName`, `tabs`, `owner`, `hidden`) raises its own prescription, as before; one whose retirement has aged out (`striped`, `bordered`, `virtualScroll`) is named and pointed at the protocol upgrade guide. `objectName` is answered with `Did you mean \`objectName\` → \`object\`?`, and a top-level `id` with `name`.
- **Unchanged.** Every key the console writes and reads back on a stored view (`isDefault`, `isPinned`, `sortOrder`, `visibility`, `columnState`, `_isOverride`) is declared and saves as before. The console's row ids on `filter[]` / `sort[]` are still removed before the check. The read decorations (`_diagnostics`, `_draft`) and the server-stamped provenance (`_packageId`, `_packageVersion`, `_provenance`) are still removed by the save before it validates. `defineView` / `defineViewItem` were already closed.
- **Who sees it.** An author (a person, an MCP client or an AI agent) who sends a `view` body with a key its shape does not declare. That key was not stored before. A stored view row written before the save began storing the parsed body may still carry such a key; the next save of that row through the console is refused, naming it.

**The remedy.** Remove the key, or move it to where it is declared: a list view setting on a view item record goes under `config`, `objectName` is `object`, a top-level `id` is `name`.
