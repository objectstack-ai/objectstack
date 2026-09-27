---
'@objectstack/spec': minor
---

feat(spec)!: retire the flattened view overlay's `owner` and `hidden` keys — accepted at the save door, stored, and read by nothing (#20230)

**BREAKING** — `owner` and `hidden` are removed from the flattened view overlay:
the lean `view` body with no `config` that `PUT /api/v1/meta/view/:name` (the
Studio and MCP save) accepts, members 3 and 4 of the `view` metadata door, and
the same members in the assembled-manifest `viewItems:` channel. ADR-0049
enforce-or-remove; triage direction, verbatim: 「follow #20085's disposition for
the same key pair」. This completes the family: the view item record's `owner` /
`hidden` are retired in this same release by its own entry, with the same texts.

⚠️ **This supersedes one sentence of the view item retirement's note in this same
release.** That note says the flattened overlay's own `owner` / `hidden` are
untouched and that a `{ object, viewKind, hidden: true }` overlay still parses.
True of that change alone; after this one, such an overlay is refused too. Read the
two notes together: after this release, neither door accepts either key.

Clause-②: no (narrowing)

The overlay door declared both keys separately from the view item's pair. A bound
overlay such as `{ object, viewKind, hidden: true }` saved clean and one row was
stored with the key, and nothing ever read it. Both view-switcher read paths
(`GET /meta/view?object=` and `getViewsByObject`) filter on `viewKind` + `object`
and sort on `order`, so `hidden: true` hid nothing, and a view with `owner` set
was listed for every user who can read the object.

Writer census, taken before removal: no writer of either overlay key in this
framework or its examples, in objectui at its pinned commit and at `main` (the
toolbar writes only `rowHeight`, `sort`, `hiddenFields`, `columnState` and
`inlineEdit`; the switcher only `label`, `isPinned`, `isDefault` and `sortOrder`),
or in the HotCRM app. The cloud repository was not reachable from the census.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| flattened overlay `owner` | delete the key. Nothing restricts a view to one user today; a view is visible to everyone who can read its object. |
| flattened overlay `hidden` | delete the key. To take a view out of the switcher, delete the view item (or stop shipping it from source). |

**The one-line fix: delete `owner:` and `hidden:` from every view body you save.**
`os migrate meta --from 17` lists the mechanical edits for existing sources.

⚠️ Runtime behaviour is deliberately **unchanged**. Neither key ever changed what
a view showed or to whom. What changes is the answer an author gets: a save that
carries either key is refused `422 INVALID_METADATA`, with the prescription
located at the key, instead of being stored with no effect. The prescriptions are
the view item's own texts, so the family answers with one voice on both doors.

### Stored rows

A stored overlay row that already holds either key keeps working. Every read of
a stored `view` row replays the conversion chain before the row is served or
badged, and the D2 conversion strips both keys there. So the row is served
without them, badged valid, and the console's next read-merge-write of it (a
toolbar toggle re-sends the row it read) saves.
`os migrate meta --stored --apply` persists the stripped shape.

### The retirement kit

- **Tombstones on both overlay members.** `retiredKey()` in
  `flattenedViewOverlayFields()`, with the view item's prescription texts. Both
  members `.strip()`, so a bare deletion would have dropped the key in silence
  (ADR-0104).
- **D2 conversion `view-overlay-owner-hidden-removed`** (step 18, retired from the
  load path). A lossless delete from the flattened spelling (no `config`, no
  container slot) in `views` (stack sources and stored rows) and `viewItems`
  (assembled artifacts). It is disjoint from `view-item-owner-hidden-removed` by
  `config`, so no row is judged by both.
- **D3 semantic entry `view-overlay-owner-hidden-retired`**: the family's one D3
  record, naming its D2 conversion. The view item record's pair is a separate
  family with its own conversion and its own D3 entry; the two share the
  prescription texts.
- **`RETIRED_KEYS_BY_MAJOR[18]`**: `ui/ViewMetadata:owner`, `ui/ViewMetadata:hidden`.
  `ui/ViewMetadata` is unemitted (its `z.undefined()` guards have no JSON Schema
  form), so no build gate judges these rows and the four surface ratchets are
  byte-identical on this retirement. The rows are pinned by the retirement test.
- **No liveness row**: the `view` ledger walks the container keys only.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo population is NOT MEASURED.** `@objectstack/spec` is published,
and production `sys_metadata` rows are not reachable from the repository. Stored
rows are covered by the conversion above; a client that still sends either key is
refused at its next save.

<!-- adr-0087: registered view-overlay-owner-hidden-removed, view-overlay-owner-hidden-retired -->
