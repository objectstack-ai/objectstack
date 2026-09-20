---
'@objectstack/spec': minor
---

spec(ui): a navigation entry may omit `label` — it then inherits its target's CURRENT label at render time (#19049)

Clause-②: yes (widening)

`BaseNavItemSchema.label` is `.optional()`. An `app.navigation` entry written without a `label` now parses, and the semantic it parses into is declared on the key itself: **absent means the entry inherits, at render time, the current label of whatever it opens** — the view's label when it names a view and that view is labelled, else the object's / dashboard's label. A label the author *did* write renders verbatim and is never overwritten.

This executes the maintainer's cloud#2021 ruling (「2021 可以接受有些修改刷新才生效」) as letter **A** on objectui#9868: sync by render-time inheritance, no stored state. The spec moves first because the console reads its navigation contract from here — until now an unnamed entry was not *representable*, so the promise "an unnamed entry shows its target's name" had nowhere to be declared.

- **Accept-set widening only, on eight branches at once.** `BaseNavItemSchema` is spread (`...BaseNavItemSchema.shape`) into the `object`, `dashboard`, `page`, `url`, `report`, `action`, `component` and `group` nav-item declarations, so the one-line relaxation reaches all eight. The ninth branch, `separator`, spreads nothing and has never carried a `label`. Nothing that parsed before stops parsing: a present `label` is accepted exactly as before, and every other key on the item is untouched.
- **Nothing is stored for the absent case.** There is no new member and no `inherited` flag — the parse adds no key the author did not write. That is the whole point of resolving at render: a target renamed after the entry was authored shows its new name on the next render, where a label materialised at authoring time would be a stale snapshot. Consumers must resolve an absent `label` at render, not at ingest.
- **The rule this relaxes still holds.** *Every real destination must have identity and text* — identity is the target, text is inherited at render. That sentence is recorded in the key's `describe`, so it ships to the reference page and to any tool reading the JSON Schema.
- **The three sibling `label` declarations in this file are unchanged and still required**: `NavigationArea.label`, `AppContextSelector.label` and `App.label`. Each names a container the author is creating rather than a target it could inherit from, so there is nothing for an absent label to resolve against. The ruling covers navigation entries only.

Downstream, in order: objectui#9868 relaxes its own `packages/types` validator to match, resolves the absent label in the nav renderer, and stops writing `label || pageName` for an unnamed entry; then cloud#2021 stops materialising an inherited label in `apply_blueprint`.
