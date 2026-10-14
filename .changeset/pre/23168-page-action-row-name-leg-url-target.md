---
'@objectstack/spec': minor
---

feat(spec)!: a page action row's url `target` is judged on the executor the console's action runner actually runs, so a row with no executor key whose `name` is `url` or `navigation` has its `target` judged by the url scheme set

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-page-action-row-name-leg-url-target-judged -->

**BREAKING**: an accept-set narrowing on one key of four published page component rows, shipped as `minor` under the launch-window convention for accept-set narrowings.

The page action rows are `action:button` and `action:icon` (`properties`), and each member of an `action:group` or `action:menu` (`properties.actions[]`). The console's action runner dispatches a row on `type || actionType || name`, and every row forwards its executor key (`actionType` on a node, `type` on a member) as `type` beside its `name`. So a row with no executor key runs the handler its `name` names, and `name: 'url'` or `name: 'navigation'` runs the url navigator. The rows judged `target` by the url scheme set only when the executor KEY read `'url'`, so such a row parsed with a target the click refuses.

The rows now judge `target` against the row's effective executor: the executor key, or, when that key is omitted or empty, the `name`, exactly as the runner resolves it. When it resolves to the url navigator, `target` is judged by the same url scheme set as an `actionType: 'url'` row, with no second grammar. A declared executor key still outranks the `name`. `name` is not refused as an executor spelling, and a row whose `name` names any other handler (`navigate_edit`, `convert_lead`, …) is untouched. An `actionType: 'url'` row's refusal is unchanged.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `{ name: 'url', target: 'javascript:…' }` with no `actionType` (or no `type` on a member), or `data:…`, `tel:…` or any other scheme | an `https://` page, a `mailto:` address, or an in-app path that starts with `/` or `./`; or, for a button meant to run something, the executor that does the work (`actionType: 'script'`, `'flow'`, `'api'`) |
| the same with `name: 'navigation'` | the same; the `name` is the runner's url alias, so the target is judged as a url |
| `{ name: 'url', target: 'forecast' }`, `'../forecast'`, `'?tab=2'` | the rooted in-app path, `'/forecast'`, or a `./` path; or declare the executor the row was meant to run |
| `{ name: 'url', target: '//cdn.example.com/x' }` | `'https://cdn.example.com/x'`, or `'/x'` for an in-app path |
| `{ name: 'url', target: '' }` | the address the button was meant to open |

**The one-line fix: give every page action row that has no executor key and is named `url` or `navigation` an `http(s)://` URL, a `mailto:` address, an in-app path that starts with `/` or `./`, or a template that opens with `${` as its `target`, or declare the executor key it was meant to run.** `os migrate meta --from 17` lists the D3 entry `ui-page-action-row-name-leg-url-target-judged`; the rewrite is by hand, because which address a refused target meant is the author's call.

**What an author now sees.** `os validate`'s props gate reports the refusal at the row's `target` (`properties.target`, or `properties.actions.N.target` for a member). For example, `{ name: 'url', target: 'javascript:alert(1)' }` on an `action:button` gets: ``An `action:button`'s `target` (`name: 'url'` and no `actionType`, so the runner runs the url navigator) opens with `javascript:`, a scheme a url target never opens.``, followed by the reason and the admitted set. Every admitted target parses unchanged.

**Measured producers: none.** No page action row in this repository, in objectui (at its pin `1fb1ced36243` and its main `866763bd`) or in hotcrm (at `0f84c9c`) is named `url` or `navigation`.
