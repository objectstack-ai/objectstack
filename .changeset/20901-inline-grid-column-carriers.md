---
'@objectstack/spec': minor
---

feat(spec)!: a form view's subform columns are the inline grid column contract, and a column that declares no `type` is judged as the type it renders (#20901)

Clause-②: yes (narrowing)

<!-- adr-0087: registered form-view-subform-columns-closed, inline-grid-column-identity-only-currency-scale-refused -->

**BREAKING** — an accept-set narrowing on two published authoring surfaces, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. The console's master-detail grid reads one column shape from two carriers: a relationship field's `inlineColumns` and a form view's `subforms[].columns`. Only the first was judged, and only by the type a column declares.

**`@objectstack/spec`**

- **`FormViewSchema.subforms[].columns`** now references `InlineGridColumnSchema`, the strict, name-keyed column a relationship field's `inlineColumns` already takes. It was `z.array(z.any())`, so every column published clean, including a key the grid never reads and a key the other carrier refuses. Every rule the column schema holds now applies on the form view too, with its own message: an unknown key is named; the retired `field` spelling (and `fieldName`, `key`) is refused with the prescription naming `name`; a column without `name` is refused; `scale` on a column declaring `type: 'currency'` is refused with the currency ruling's remedy. This reaches `view.form` and every `view.formViews` entry, wherever a view is parsed against the spec: `defineStack`, `objectstack validate`, and the `view` metadata type's registered schema (`ViewMetadataSchema`).
- **`defineStack`'s cross-reference check** now judges a column that declares no `type` as the type it renders. The console fills such a column's type from the child field, so an identity-only column over a `currency` field renders as a currency column. The check resolves the child field, re-parses the column with that type through `InlineGridColumnSchema`, and reports that schema's own refusal (`STACK_CROSS_REFERENCE_INVALID`, 422). Today that means `scale` on an identity-only column over a `currency` child field. Both carriers are walked: `inlineColumns` resolves against the object that owns the relationship field, and `subforms[].columns` against the subform's `childObject`. A child object the stack does not declare, or a column naming no field of it, is not judged.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `subforms: [{ childObject: 'invoice_line', columns: [{ field: 'quantity' }] }]` | `subforms: [{ childObject: 'invoice_line', columns: [{ name: 'quantity' }] }]` |
| `subforms: [{ childObject: 'invoice_line', columns: [{ name: 'amount', type: 'currency', scale: 2 }] }]` | `subforms: [{ childObject: 'invoice_line', columns: [{ name: 'amount', type: 'currency' }] }]` |
| `columns: [{ name: 'amount', scale: 2 }]` where `amount` is a `currency` field of the child object (either carrier) | `columns: [{ name: 'amount' }]` |
| a column carrying a key the column schema does not declare | the column without that key |

The one-line fix: write each form-view subform column as `{ name, … }` using only the keys a relationship field's `inlineColumns` accepts, and delete `scale` from any column that renders as a currency column, whether it declares `type: 'currency'` or takes it from a `currency` child field. Nothing replaces `scale` there: the currency's ISO 4217 minor unit decides the displayed decimals.

## Who is affected, measured

On `origin/main` `cb4c31dd52`: zero authored `subforms` in the repository, and one authored `inlineColumns` block (the showcase invoice, seven identity-only columns, none carrying `scale`). No example, template or test fixture outside this change's own pins changes verdict. Deployed metadata was not measured.
