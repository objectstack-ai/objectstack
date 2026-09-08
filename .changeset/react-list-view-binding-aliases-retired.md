---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/example-showcase": patch
---

feat(spec)!: `<ListView objectName>` / `<ListView viewType>` are retired from the react-tier component contract — `data={{ provider: 'object', object }}` / `type` are the only spellings (#14791)

<!-- adr-0087: registered ui-react-list-view-binding-aliases-retired -->

**BREAKING** — an accept-set narrowing on a published contract. The `REACT_BLOCKS`
ListView entry no longer publishes the `objectName` and `viewType` overlay props that
#11284 had deprecated in favour of ListViewSchema's own `data` / `type`: the generated
contract (`skills/objectstack-ui/references/react-blocks.md`) drops both rows, and
`@objectstack/lint`'s `validate-react-page-props` now REFUSES either spelling on a
`kind:'react'` page with a new `react-prop-retired` error that carries the fix, where it
used to warn and accept. Shipped as `minor` under the repo's launch-window convention for
breaking changes; the hand-migration prescription is registered under protocol major 18
(`ui-react-list-view-binding-aliases-retired`). Maintainer ruling on #14791 (2026-09-07,
director seat summon #17, decision batch #1, option B — retire now, no deprecation window,
「同意」).

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `<ListView objectName="account" … />` | `<ListView data={{ provider: 'object', object: 'account' }} … />` |
| `<ListView viewType="kanban" … />` | `<ListView type="kanban" … />` |
| `<ListView … />` with no binding at all | add `data={{ provider: 'object', object: '…' }}` — it is the required binding on a react page |

One-line fix: on every `<ListView>` in react page source replace `objectName="X"` with
`data={{ provider: 'object', object: 'X' }}` and `viewType="K"` with `type="K"`, then re-run
`objectstack validate` — a leftover alias is reported as `react-prop-retired` with this
same prescription, and a list with no data source as `react-prop-missing-required`.

## Why now, and why no window

The contract deprecated both aliases (#11284) while objectui's ListView still read only
`objectName`, so a page written the canonical way validated green and rendered an empty
list. That consumer half has landed and ships in the console this repo pins
(`normalizeListViewSchema` at `a472b071` folds `data.provider === 'object'` onto the key
the renderer reads and takes the author's `type` for the view kind), so both spellings
render today — and the maintainer's standing rule for a spelling with zero external
authors is to retire it at once rather than keep two vocabularies alive.

## What else moved

- `REACT_RETIRED_OVERLAY_PROPS` is a new export of `@objectstack/spec/ui`: the tombstone
  ledger (prop → replacement + one-line fix) the lint quotes, the react-tier twin of a
  metadata schema's `retiredKey()`.
- `data` is restated on the ListView overlay as its **required** binding (ledgered in
  `REACT_OVERLAY_SHADOWS`), so the generated contract marks it ✓ and a `<ListView>` with no
  data source is refused — the check the required `objectName` used to carry.
- `REACT_RECORD_BLOCK_ALTERNATIVES['record:related_list']` prescribes the canonical spelling.
- The showcase pages (`crm-workbench`, `renewals-pipeline`, `task-desk`), the published
  `objectstack-ui` skill and the react-pages / validating-metadata guides write the
  canonical spelling; `@objectstack/lint` exports `REACT_PROP_RETIRED`.
