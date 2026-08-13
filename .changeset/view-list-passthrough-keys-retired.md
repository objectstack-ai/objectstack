---
"@objectstack/spec": major
---

refactor(spec)!: retire the pass-through-only list-view keys `striped` / `bordered` / `virtualScroll` (#7176, ADR-0049)

`ListViewSchema` (and its `ObjectListViewSchema` copy) declared three grid
display keys the liveness ledger graded `live` — and the citations turned out to
be **forwarding copies, not appliers**. The measured chains (objectui
`origin/main@11c1e71`): the react spec-bridge copies each key onto its node,
`plugin-list` copies it onto the grid node, `plugin-view`/`app-shell` copy it
again — and the chain ends at `ObjectGrid.tsx` with **zero** occurrences of any
of the three. `DataTable` reads neither `striped` nor `virtualScroll`; the
table frame is the renderer's own `borderless` constant. So an author who wrote
`striped: true` got a parse-clean no-op — the exact silent-no-op shape ADR-0049
enforce-or-remove exists to end. Maintainer ruling (2026-08-10): copy-without-
apply is dead in effect; retire, and if objectui wants any of the three as real
behavior, that is an implementation card filed first, with the key pending it.

FROM → TO:

| Was | Now |
|:--|:--|
| `list: { striped: true }` | delete the key — there is no authorable striped-rows switch |
| `list: { bordered: true }` | delete the key — the grid frame is the renderer's own constant, not authorable |
| `list: { virtualScroll: true }` | delete the key — large datasets page via the view's `pagination` block |

The retirement kit:

- **Tombstones, not deletions** (`retiredKey()`): authoring any of the three is
  now a `tsc` error (input type `never`) and a parse error carrying the
  prescription itself — why the key never did anything and the one-line fix —
  on both `ListViewSchema` and `ObjectListViewSchema`, whose walked shape
  copies the tombstones. All six `${defKey}:${name}` spellings are registered
  in `RETIRED_KEYS_BY_MAJOR[17]`.
- **ADR-0087 D2 conversion + D3 chain step**
  (`view-list-passthrough-keys-removed`): `os migrate meta --from 16` strips
  the keys from `list` and named `listViews` entries, one notice per stripped
  key. `retiredFromLoadPath` — the tombstone owns the refusal; no alias window.
- **Liveness ledger**: the three `view.json` rows flip from `live` (the
  pass-through citation) to `dead` with the retirement note — the rows stay
  because `retiredKey` keeps the keys in the walked shape.
- The view metadata form loses its `striped`/`bordered` inputs (a form input
  for an unenforced key is the UI half of false compliance); `virtualScroll`
  never had one.
- `content/docs/protocol/objectui/widget-contract.mdx`'s Performance section
  stops pointing at `view.virtualScroll` — the pointer was installed this same
  unreleased major when `widget.performance`'s tombstone was retired, and it
  aimed at a switch nothing read.

**Behaviour that changes:** none at runtime. A view declaring any of the three
rendered identically without it before this change; what changes is that the
declaration is now refused at parse, with the reason, instead of being accepted
and silently ignored.

<!-- adr-0087: registered view-list-passthrough-keys-removed -->
