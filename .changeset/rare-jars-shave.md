---
'@objectstack/spec': major
---

**BREAKING (authoring gate tightens): `ViewItemSchema` is split into an authoring schema and a wire variant.**

`ViewItemSchema` used to carry two contracts at once — the authoring surface
`defineViewItem()` and Studio's view-create form parse, AND member 1 of the
`ViewMetadataSchema` union that `saveMetaItem` validates every persisted `view`
body against. Because the second role needs Studio's round-trip keys through,
the shape stayed open, and an authoring typo was silently dropped:

```ts
defineViewItem({ name: 'crm_lead.pipeline', object: 'crm_lead', viewKind: 'list', confg: { … } })
// before: parsed clean → a ViewItem with NO view configuration at all
// after:  Unrecognized key(s) on this view item: `confg`. Did you mean `config`?
```

**What changed**

- `ViewItemSchema` is now strict on both arms. It is the authoring gate.
- `ViewItemWireSchema` (new export) is the `.strip()` wire variant and is
  member 1 of `ViewMetadataSchema`. It **declares** `isPinned` and `sortOrder`,
  the Studio switcher keys the console round-trips.
- `ViewFilterRuleSchema` and the `ListView.sort[]` entry are now strict too,
  and `ListView.sort[]` rejects `direction` with a pointer to `order` (the two
  spell the same tuple, and the wrong one reversed the sort silently).
- New exports: `ViewItemWireSchema`, `ViewItemWire`, `stripViewConsoleDecorations`,
  `VIEW_CONSOLE_ROW_DECORATIONS`.

**Migration — authored metadata (`*.view.ts`, `defineViewItem`, published packages)**

| you wrote | on a … | now |
|:---|:---|:---|
| `confg:` / any undeclared key | view item | rejected, with the closest declared key suggested |
| `isPinned:` | view item | remove it — per-user Studio state, written by the console |
| `sortOrder:` | view item | use `order` for the authored default position |
| `id:` | filter rule / sort entry | remove it — a console row key, never authored |
| `direction: 'desc'` | sort entry | `order: 'desc'` |

**Nothing changes for the console/write path.** The `view` metadata write door
still accepts every body the platform itself writes: pinning a saved view, the
column-sort PUT and the filter-save PUT all parse exactly as before. The
console's row `id`s are removed by `stripViewConsoleDecorations` before
validation — the write-path mirror of `stripReadDecorations` — and
`saveMetaItem` still persists the original body verbatim, so those ids
round-trip to the renderer untouched. `id` was deliberately **not** declared:
it is a React list key, and declaring it would put a UI artifact on the
authorable surface.

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
