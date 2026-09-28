---
"@objectstack/spec": minor
---

feat(spec)!: retire the `inline` and `grid` arms of form `layout` — every renderer folded both to `vertical`, and multi-column is `columns` (ADR-0049)

<!-- adr-0087: registered form-layout-inline-grid-to-vertical, ui-form-layout-inline-grid-retired -->

**BREAKING** — form `layout` accepts exactly `'vertical' | 'horizontal'` on both surfaces
that declared the four-arm enum: the `object-form` page component
(`ObjectFormPropsSchema.layout`) and the form view (`FormViewSchema.layout` — `view.form`,
`view.formViews.*`, a form view item's `config`, and the flattened form overlay, which
spreads the form view's shape). `'inline'` and `'grid'` are refused at parse, each with a
prescription naming what to write instead.

| surface | before | after |
|:--|:--|:--|
| `object-form` `layout: 'grid'` | parsed clean, rendered as `vertical` | refused — write `'vertical'` (or omit `layout`); for multi-column set `columns` |
| `object-form` `layout: 'inline'` | parsed clean, rendered as `vertical` | refused — write `'vertical'` (or omit `layout`) |
| form view `layout: 'grid'` | parsed clean, rendered as `vertical` | refused — write `'vertical'` (or omit `layout`); for multi-column set `columns` |
| form view `layout: 'inline'` | parsed clean, rendered as `vertical` | refused — write `'vertical'` (or omit `layout`) |
| `layout: 'vertical'` / `'horizontal'` | accepted | **unchanged** |
| `columns` | honoured under every layout | **unchanged** — the key multi-column always lived under |

**What was actually wrong.** No renderer ever gave either value a behaviour of its own.
Measured at the `.objectui-sha` pin this repo builds against (`f8a9d0fb0`): the simple
`object-form` arm folds both to `vertical` (`ObjectForm.tsx:1406-1410`, under the comment
"Map 'grid' and 'inline' to 'vertical' as fallback"); the drawer and modal arms
(`ObjectForm.tsx:463`, `:499`) and `DrawerForm.tsx:575` / `ModalForm.tsx:597` pass only
`vertical` / `horizontal` through; `TabbedForm.tsx:556`, `SplitForm.tsx:445` and
`WizardForm.tsx:1075` hard-code `vertical`. So both values were a green parse for a value the
renderer threw away. The spec had admitted them from two declarations — the designer palette
and the registry `inputs` offered all four — never from a read.

Under the maintainer's ADR-0049 family criterion (the capability exists on mainstream
platforms ⇒ build the consumer; it does not ⇒ retire), multi-column — what `grid` would
mean — already exists here under another key, `columns`, which the renderer honours under
every arm; `inline` is a toolbar / filter-row pattern, not a record-form layout. The two arms
are redundant vocabulary, retired with no alias window.

## What to write instead

```ts
// before — parsed clean, rendered single-column 'vertical'
{ type: 'object-form', properties: { objectName: 'crm_lead', layout: 'grid' } }
// after — what it rendered; add `columns` if a multi-column form was the intent
{ type: 'object-form', properties: { objectName: 'crm_lead', layout: 'vertical', columns: 2 } }
```

`'inline'` → `'vertical'` (or delete `layout`: `'vertical'` is the renderer default). A form
that wrote `'grid'` without `columns` always rendered single-column; only its author knows
whether more columns were meant — set `columns` to the count you meant.

Existing sources: `os migrate meta --from 17` lists the mechanical edits; apply them by hand.

The retirement kit:

- both enums narrowed to `'vertical' | 'horizontal'`, each with a per-value error map keyed on
  the input (the `record:chatter` `position` precedent), so only a value that used to be legal
  is told it "was removed"; a never-vocabulary value keeps zod's own enum refusal
- the D2 conversion `form-layout-inline-grid-to-vertical` (protocol 18, retired from the load
  path) rewrites both values to `'vertical'` and leaves `columns` untouched — on `object-form`
  page components, on every form payload a view carries, and on the assembled-manifest
  `viewItems` channel, so stored rows and assembled artifacts replay clean; wired into the
  protocol-18 chain step
- one D3 entry for the family, `ui-form-layout-inline-grid-retired`, carrying the one judgement
  the chain cannot make: whether a form that said `grid` wanted columns it never declared
- pin tests (`ui/form-layout-inline-grid-retired.test.ts`): both values refused with the
  prescription on five doors (`ObjectFormPropsSchema`, the `object-form` props-map row,
  `FormViewSchema`, a view container's `formViews`, the flattened form overlay), `vertical` /
  `horizontal` green on each as controls, the conversion's rewrite parsing green on the door
  that refused its input, and the chain registration
- the `columns` descriptions no longer say "grid layout"; the generated references
  (`content/docs/references/**`, `skills/objectstack-ui/references/react-blocks.md`, the JSON
  Schema) print the two-arm enum; the hand-written `layout-dsl` page and the `form.layout`
  liveness row (still `live`) are updated
- `api-surface/` and `authorable-surface/` are unchanged, correctly: they ratchet export and
  key existence, and no export or key leaves — `layout` is still declared, two values narrower

Clause-②: no (narrowing)
