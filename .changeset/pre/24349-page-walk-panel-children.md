---
'@objectstack/spec': minor
---

fix(spec)!: `defineStack`'s page cross-reference checks judge a component inside a `page:tabs` or `page:accordion` item's `children`, as they judge one at region level (#24349)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-page-panel-children-cross-references-judged -->

**BREAKING** — an accept-set narrowing of what `defineStack` and `objectstack validate` publish, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. `defineStack` reads a page's components through one traversal, shared by its inline-action target check and its inline grid column check. A tab or accordion item is a panel record (`{ label, value?, children }`), not a component, and the traversal stopped at it, so nothing inside a tab or an accordion panel was judged: a button whose modal target names no page built green in a tab and was refused one level up.

**`@objectstack/spec`**

- **`defineStack`'s page cross-reference checks** now reach a component in a `page:tabs` or `page:accordion` item's `children`, at any depth (tabs in an accordion panel, a panel in a container or under a slot). The traversal descends the panel positions the component rows declare (`pageComponentSlotPositions`), the list the other page walks already read, so it follows the declared shapes rather than naming tabs. A record under a key no row declares a panel list is not descended.
- A component in a panel gets the region-level verdict and message, located through the panel: `STACK_CROSS_REFERENCE_INVALID` (422), for example `Inline action 'open_detail' on page 'invoice_record' (regions.0.components.0.properties.items.1.children.0) references page 'no_such_modal' (via modal target) which is not defined in pages.`
- Two checks reach further: an inline action's `type: 'modal'` / `type: 'flow'` `target`, and an identity-only column (one that declares no `type`) carrying `scale` over a `currency` child field, on an `object-master-detail-form` block's `details[].columns` or a `record:line_items` block's `columns`. That includes a `record:line_items` block in a tab or accordion panel, a position the block's identity-only check did not reach before this change.
- New step-18 migration entry `ui-page-panel-children-cross-references-judged`; the entry `ui-record-line-items-props-closed` now names the panel positions in its reach.

## FROM → TO

| you wrote, inside a `page:tabs` or `page:accordion` item's `children` | write instead |
|:--|:--|
| `{ type: 'element:button', properties: { action: { type: 'modal', target: 'no_such_page' } } }` | a `target` naming a page the stack declares (or a declared flow, for `type: 'flow'`) |
| `{ type: 'record:line_items', properties: { childObject: 'invoice_line', relationshipField: 'invoice', columns: [{ name: 'amount', scale: 2 }] } }` where `amount` is a `currency` field of `invoice_line` | the same block with `columns: [{ name: 'amount' }]` |

The one-line fix: give the component inside the panel the same fix it would need at region level. Nothing about the panel or its items changes.

## Who is affected, measured

On `origin/main` `31e7d0ba2`: four authored pages nest components under a panel item (the showcase project detail page, whose `record:line_items` block declares a `type` on all five columns; the platform user and organization record pages; the approval request record page), one documentation example does (three tabs of record blocks), and the published skills carry none. None holds an inline action target or an identity-only column under a panel, so no example, skill or fixture outside this change's own pins changes verdict. Deployed metadata was not measured.
