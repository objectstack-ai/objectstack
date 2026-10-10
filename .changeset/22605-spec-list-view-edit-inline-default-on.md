---
'@objectstack/spec': minor
---

`ListView.userActions.editInline` defaults to `true` on the v18 line: a list view is editable in place by default, under the permission gate that already exists, and `userActions: { editInline: false }` is the opt-out.

Clause-②: yes (widening)

<!-- adr-0087: registered list-view-edit-inline-default-on -->

**BREAKING** — a declared default moves, shipped as `minor` under the launch-window convention. The author who relied on the documented default (`false`, "the list is read-only unless the author opts in") for a list that is read-only by nature — a log, an audit trail, a history, a report roll-up — now gets an inline-edit toggle on it, for every user who may `update` the object. The remedy is one key on that view: `userActions: { editInline: false }`.

**The ruling.** Maintainer, 2026-10-10, verbatim: 「乙 v18 把 spec 默认翻成 true,editInline: false 变成关法。」 The rule of objectui#5144 stands — one vocabulary (`editInline`), a boolean view-level `inlineEdit` folds into it, an explicit `editInline` wins, declared = enforced; only the default's value changes. Not taken: declaring `editInline: true` on every existing view, and an app-level default between the spec default and the view.

**What moves.** `UserActionsConfigSchema.editInline` is `z.boolean().default(true)` where it was `.default(false)`, with the `describe` rewritten: on by default; a user who may update the object edits a cell in place with the field's type-aware widget; declare `editInline: false` to make the list read-only in place. A list view's `userActions` block, and a page's `interfaceConfig.userActions` block (the same schema), that omits `editInline` now parses to `true` where it parsed to `false`; the published JSON Schema and the reference pages (`content/docs/references/ui/view.mdx`, `page.mdx`) say so. A view with no `userActions` block at all parses with none on either side; the renderer reads an absent key as this default. The accept set is unchanged: `editInline` is still a boolean, and every authored value parses exactly as before. The permission gate is untouched: the renderer offers the toggle only where the object is editable in place and the current principal may `update` it.

**The consumer half** is objectui's (objectstack-ai/objectui#12086): `ListView.tsx` and `InterfaceListPage.tsx` read an absent key as `editInline !== false`. Until that lands, the console at the pinned objectui still reads an absent key as off, so nothing regresses against today in the window.

## FROM → TO

| you wrote | what it means now | write instead, to keep the old behaviour |
|:--|:--|:--|
| nothing (no `editInline`) on a list view or a page list | editable in place by a user who may `update` the object | `userActions: { editInline: false }` |
| `editInline: false` | unchanged: read-only in place | nothing |
| `editInline: true` | unchanged: editable in place | nothing |
| a view-level `inlineEdit: true` | unchanged: folds to on and opens the grid in edit mode | nothing |

**The one-line fix: on a list that must stay read-only in place, write `userActions: { editInline: false }`.** An `os compile` artifact that serialised an earlier parse carries a written `editInline: false` and stays read-only in place: recompile it, or delete the key.

**Who is affected, measured** at `e11ef3a7bd`. No metadata in this repository declares `editInline` at all (0 `editInline: false`, 0 `editInline: true` across `examples/**` and `packages/**`, tests and changelogs excluded). Every list view that declares nothing gains the toggle: 38 list-kind views declared with an explicit `type` across 10 example `*.view.ts` files (entries with no `type` are grid by default and count the same way), 12 `interfaceConfig` page lists across 5 showcase page files (11 declare a `userActions` block, none naming `editInline`), and 105 list-kind views across 40 platform `*.object.ts` files in `packages/**`. One list view declares the view-level `inlineEdit: true` (the showcase `task` grid saved view) and keeps opening in edit mode. The card's readings outside this repository: cloud's `sys-package.page.ts` already declares `editInline: false` explicitly; HotCRM's 41 undeclared views regain cell editing after both packages upgrade, with no metadata change there.

### The kit

- **The default and its describe.** `packages/spec/src/ui/view.zod.ts`, `UserActionsConfigSchema.editInline`; the schema docblock records the ruling beside the group/hideFields/rowColor asymmetry it already explains.
- **The declared default change.** `DEFAULT_CHANGES_BY_MAJOR[17]` (`packages/spec/scripts/lib/default-changes.ts`) carries `ui/UserActionsConfig:editInline` `false` → `true`, which is what lets `check:authorable-surface` authorise the moved fingerprint in `authorable-defaults/ui.json`; `CURRENT_MAJOR` is the package major (17) until the version pass takes the group to 18.
- **The ledger.** The D3 semantic entry `list-view-edit-inline-default-on` (protocol 18), one file under `src/migrations/entries/semantic/`, concatenated into `registry.ts` by `gen:migration-registry`, projected into `spec-changes.json` and `docs/protocol-upgrade-guide.md`. No key is removed, so there is no tombstone and no `RETIRED_KEYS_BY_MAJOR` row; no D2 conversion exists, because a mechanical pass writing `editInline: false` into every silent view would preserve the old posture and defeat the ruling, and one writing `true` would add nothing the default does not already do. The same class as `view-pagination-page-size-default-50` and protocol 12's `rest-requireauth-default-flip`.
- **The pins.** `packages/spec/src/ui/view.test.ts`: an absent key parses to `true` (on `UserActionsConfigSchema` and through `ListViewSchema`), an explicit `false` stays `false`, an explicit `true` stays `true`, and the view-level `inlineEdit: true` still parses as before with no `userActions` block materialised.
- **The skill.** `skills/objectstack-ui/rules/list-views.md` gains its paragraph in a separate pull request, because `skills/**` is Tier H.
