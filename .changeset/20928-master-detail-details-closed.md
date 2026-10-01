---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

feat(spec)!: an `object-master-detail-form` block's detail entries are a strict shape, and their columns are the inline grid column contract (#20928)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-master-detail-form-details-closed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. The console's master-detail grid reads one column shape from three carriers: a relationship field's `inlineColumns`, a form view's `subforms[].columns`, and an `object-master-detail-form` page block's `details[].columns`. The first two were judged; the third was `z.array(z.unknown())`.

**`@objectstack/spec`**

- **`ComponentPropsMap['object-master-detail-form'].details`** is now an array of strict detail entries: `childObject` (required), `relationshipField`, `columns`, `formFields`, `inlineMode` (`grid` | `form`), `amountField`, `sortField`, `totalField`, `title`, `minRows`, `maxRows` and `addLabel` — the keys the console's `MasterDetailForm` reads off an entry. An unknown key is named, with a rename for the near-misses a form view's `subforms[]` entry also answers (`foreignKey` → `relationshipField`, `object` → `childObject`, …).
- **`details[].columns`** references `InlineGridColumnSchema`, the strict, name-keyed column the other two carriers take. Every rule the column schema holds applies here too, with its own message: an unknown key is named; the retired `field` spelling (and `fieldName`, `key`) is refused with the prescription naming `name`; a column without `name` is refused; `scale` on a column declaring `type: 'currency'` is refused with the currency ruling's remedy. Page-component `properties` is read by the component-props gate, so `objectstack validate`, `build` and `lint` report these as advisory `component-props-unknown-key` / `component-props-invalid` findings; a stored page still saves and loads, because `properties` is not parsed on the metadata save or load path.
- **`defineStack`'s cross-reference check** now reaches the block wherever a page carries it (a region, a container's children, a slot) and judges a detail column that declares no `type` as the type it renders, as it already does on the other two carriers: an identity-only column over a `currency` field of the entry's `childObject` that carries `scale` is refused with the column schema's own message (`STACK_CROSS_REFERENCE_INVALID`, 422). A child object the stack does not declare, a column naming no field of it, and a column the column schema refuses on its own (left to the component-props gate) are not judged there.
- **New type `ObjectMasterDetailFormPropsParsed`** — the post-parse shape of `ObjectMasterDetailFormProps`. The two now differ, because a column's `readonlyWhen` / `requiredWhen` bare-string predicate normalizes to an Expression envelope at parse.

**`@objectstack/lint`**

- **`field-no-consumers`** reads an `object-master-detail-form` detail entry as the child collection it is: a column `name`, `amountField` and `relationshipField` credit the field of the entry's `childObject`, `totalField` the parent's, and an entry with no `columns` credits the columns the child derives. A child field drawn only by a master-detail block's grid was reported inert.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `details: [{ title: 'Lines' }]` | `details: [{ title: 'Lines', childObject: 'invoice_line' }]` |
| `details: [{ childObject: 'invoice_line', columns: ['product', 'quantity'] }]` | `details: [{ childObject: 'invoice_line', columns: [{ name: 'product' }, { name: 'quantity' }] }]` |
| `details: [{ childObject: 'invoice_line', columns: [{ field: 'quantity' }] }]` | `details: [{ childObject: 'invoice_line', columns: [{ name: 'quantity' }] }]` |
| `details: [{ childObject: 'invoice_line', columns: [{ name: 'amount', type: 'currency', scale: 2 }] }]` | `details: [{ childObject: 'invoice_line', columns: [{ name: 'amount', type: 'currency' }] }]` |
| `columns: [{ name: 'amount', scale: 2 }]` where `amount` is a `currency` field of the entry's `childObject` | `columns: [{ name: 'amount' }]` |
| a detail entry or column carrying a key its shape does not declare | the entry or column without that key |

The one-line fix: give every detail entry its `childObject`, write each column as `{ name, … }` using only the keys a relationship field's `inlineColumns` accepts, and delete `scale` from any column that renders as a currency column, whether it declares `type: 'currency'` or takes it from a `currency` child field. Nothing replaces `scale` there: the currency's ISO 4217 minor unit decides the displayed decimals.

## Who is affected, measured

On `origin/main` `ebdb6f2aca`: one authored `object-master-detail-form` block in the examples (the showcase project workspace, one entry `{ title, childObject, addLabel }`, no columns), which parses unchanged, and one documentation example whose three bare-string columns are rewritten as `{ name }` columns in this change. Zero `field`-keyed detail columns. Deployed metadata was not measured.
