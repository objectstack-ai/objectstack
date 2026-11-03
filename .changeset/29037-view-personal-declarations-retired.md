---
'@objectstack/spec': minor
'@object-ui/plugin-list': minor
'@object-ui/core': minor
'@object-ui/i18n': minor
---

feat(spec)!: a view no longer declares itself personal — `scope: 'personal'` and `sharing.type` are retired, because nothing ever restricted a view to one user

Clause-②: no (narrowing)

Metadata-protocol: narrowed

Skills-docs: none — no file under `skills/**` teaches either declaration (a `git grep` of `skills/` finds no `scope: 'personal'` and no list-view `sharing.type`; its one `sharing` block is the public form link, which this does not touch); `content/docs/ui/audience-based-interfaces.mdx` now says data mode offers per-user list preferences, not personal views.

<!-- adr-0087: registered view-personal-declarations-removed, ui-view-personal-declarations-retired -->

**BREAKING** accept-set narrowing on the view surface (`@objectstack/spec`), ADR-0049 enforce-or-remove.

A view item saved with `scope: 'personal'`, or a list view saved with `sharing: { type: 'personal' }`, was accepted and served, and every user who could read the object still saw it: both switcher read paths list every view bound to the object, and nothing read either declaration as a visibility rule. The console list toolbar, the one reader of `sharing.type`, then labelled the view "Personal view". Personal named views are ruled to be a user-owned record, not view metadata, and they do not reuse either key.

- **FROM → TO.** `{ name, object, viewKind, scope: 'personal', … }` → `{ name, object, viewKind, … }` (omit `scope`, or write `shared` for a runtime-authored view). `list: { …, sharing: { type, lockedBy } }` (and `listViews.<key>`, an object's `listViews.<key>`, a list view item's `config`) → `list: { …, sharing: { lockedBy } }`.
- **The one-line fix.** Delete `scope: 'personal'` and delete `sharing.type`, whatever value it holds. `os migrate meta --from 17` lists the edits for existing sources, and `--write` applies them. A stored `sys_metadata` row and an assembled artifact are converted when they are read (the `view-personal-declarations-removed` conversion), so a view saved with either declaration keeps loading and nothing a reader sees changes.
- **What the parse says.** "`view.scope: 'personal'` was removed in @objectstack/spec 18.3.0 (ADR-0049 enforce-or-remove) — nothing ever restricted a `personal` view item to one user: …" at every door that reads a view item's `scope`, and "`view.list.sharing.type` was removed in @objectstack/spec 18.3.0 (ADR-0049 enforce-or-remove) — nothing enforced it: …" at every list-view door and at `defineStack` as `STACK_SCHEMA_INVALID` / 422. TypeScript rejects both at the authoring site.
- **Residue.** `type: 'collaborative'`, the default a released toolchain wrote into every parsed `sharing` block, is accepted and stripped, so a view built before this release parses without an edit; `personal` is refused.
- **Unchanged.** `scope: 'package'` and `scope: 'shared'`; `sharing.lockedBy`; a form view's public-link `sharing` block.
- **Console.** The list toolbar no longer labels any view personal or shared; a view with `sharing.lockedBy` still shows "Locked by …". `normalizeListViewSchema` drops the legacy `sharing: { visibility, enabled }` pair instead of folding it onto the retired `type`, and the `list.sharingPersonal` / `list.sharingCollaborative` strings are gone from every locale.
