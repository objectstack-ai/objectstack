---
'@objectstack/spec': minor
---

fix(spec)!: `defineStack` judges a `record:line_items` column that declares no `type` as the type it renders, as it already does on the master-detail carriers (#24190)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (already-registered ui-record-line-items-props-closed) The step-18 entry for this block's columns now carries the identity-only reach in its surface, replacement, reason and acceptance criteria, as the master-detail block's entry does. No key, stored shape or authorable spelling is added, removed or renamed, and nothing stored changes, so `objectstack migrate meta` rewrites exactly what it rewrote before. -->

**BREAKING** — an accept-set narrowing of what `defineStack` and `objectstack validate` publish, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. The console's `record:line_items` panel fills a column that declares no `type` from the child object's field, with the same rule as the master-detail grid. `defineStack`'s cross-reference check judged that resolved type on the three master-detail carriers and not on this block, so the same column got two answers.

**`@objectstack/spec`**

- **`defineStack`'s cross-reference check** now reaches a `record:line_items` block wherever a page carries it (a region, a container's children, a slot). It judges a column that declares no `type` as the type it renders, and reports the column schema's own refusal (`STACK_CROSS_REFERENCE_INVALID`, 422). Today that means `scale` on an identity-only column over a `currency` field of the child object. The child object is the one the panel lists: the object `dataSource` binding's `object` when the node carries one, else `childObject`. A child object the stack does not declare, a column naming no field of it, and a column the column schema refuses on its own (left to the component-props gate) are not judged.
- The step-18 migration entry `ui-record-line-items-props-closed` now says so, and no longer says that this block draws a column exactly as declared.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ type: 'record:line_items', properties: { childObject: 'invoice_line', relationshipField: 'invoice', columns: [{ name: 'amount', scale: 2 }] } }` where `amount` is a `currency` field of `invoice_line` | the same block with `columns: [{ name: 'amount' }]` |

The one-line fix: delete `scale` from a `record:line_items` column that renders as a currency column, whether it declares `type: 'currency'` or takes it from a `currency` child field. Nothing replaces `scale` there: the currency's ISO 4217 minor unit decides the displayed decimals.

## Who is affected, measured

On `origin/main` `ec749fbb44`: two authored `record:line_items` blocks in the examples (the showcase project detail page, five typed columns; the showcase invoice document page, four `{ name, label }` columns, two of them over `currency` fields) and one in the published skills (four `{ name }` columns). None carries `scale`, so no example, skill or fixture outside this change's own pins changes verdict. Deployed metadata was not measured.
