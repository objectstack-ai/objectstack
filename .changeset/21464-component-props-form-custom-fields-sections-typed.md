---
'@objectstack/spec': minor
---

feat(spec)!: an `object-form` page block's `customFields` takes a closed runtime form field, and the `sections` of `object-form` and `object-master-detail-form` take a page-block section shape, instead of any value (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-form-custom-fields-typed ui-object-form-sections-typed -->

**BREAKING** — two accept-set narrowings on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the rows: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **`object-form` `customFields` is a list of closed runtime form fields.** It was `z.unknown()`. Each member is the field the form merges over the fields it generates from the object's metadata and draws as written, and the spec now declares it: `name` (its identity), `label`, `description`, `type`, `inputType`, `widget`, `required`, `disabled`, `readonly`, `hidden`, `placeholder`, `options`, `validation`, `dependsOn`, `visibleWhen`, `readonlyWhen`, `requiredWhen`, `colSpan`, `span`, `group`, and the metadata a field widget reads off it — `multiple`, `rows`, `accept`, `dimensions`, `reference`, `min`, `max`, `minLength`, `maxLength`, `pattern`, `returnType`, `summaryOperations`, `columns`. Members this package already declares take that declaration by reference (the object field's own, the form view's option, the evaluated predicates); `label`, `description` and `placeholder` are plain strings.
- **The `sections` of `object-form` and `object-master-detail-form` are one page-block section shape.** They were `z.array(z.unknown())`. A section takes the form view's section keys — `name`, `label`, `description`, `collapsible`, `collapsed`, `visibleWhen`, `columns`, `pane`, `group`, `fields` — and the form view's group-reference rule; each `fields` entry is a field name, the form view's `{ field, … }` entry, or an inline runtime form field (the `customFields` member). The stored form view's `FormSectionSchema` is unchanged.
- **Canonical spellings only.** A page block's `properties` is never parsed on the way to the form, so a form view's parse-time folds do not run there: a section `visibleOn` and a string `columns` reached the form raw and were dropped. Both are refused with the canonical spelling, and so is a `{ field }` entry's or an inline field's `visibleOn`.
- **Refused with what to write instead:** an inline field's legacy `condition`, its `defaultValue` (which seeds nothing), `id`, a `fields` member claim, the `grid` widget's eight snake_case keys (`min_rows`, `max_rows`, `allow_add`, `allow_delete`, `allow_reorder`, `total_field`, `add_label`, `sort_field` — they come in once the widget reads a camelCase spelling), a boolean `validation.required`, a `validation.pattern` / `validate` rule, and a locale map where the form draws a plain string.
- **`ObjectFormProps`, `ObjectMasterDetailFormProps`** and their parsed types carry the field and section types on these members instead of `unknown`; the shapes themselves are module-private. A bare CEL `visibleWhen` parses to its `{ dialect, source }` envelope, as on every evaluated slot, so the `object-form` row's input and parsed types now differ and it gains the one new export, the type `ObjectFormPropsParsed` (ADR-0122), as `ObjectMasterDetailFormPropsParsed` already is.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `customFields: [{ name: 'b', visibleOn: "record.a != ''" }]` | `customFields: [{ name: 'b', visibleWhen: "record.a != ''" }]` |
| `customFields: [{ name: 'b', condition: { field: 'a', equals: 'x' } }]` | `customFields: [{ name: 'b', visibleWhen: "record.a == 'x'" }]` (`notEquals` is `!=`, `in: [ … ]` is `record.a in [ … ]`) |
| `customFields: [{ name: 'memo', defaultValue: 'X' }]` | `customFields: [{ name: 'memo' }], initialValues: { memo: 'X' }` |
| `customFields: [{ name: 'a', validation: { required: true } }]` | `customFields: [{ name: 'a', required: true }]` (a string `validation.required` is the message) |
| `customFields: [{ name: 'a', validation: { pattern: { value, message } } }]` | `customFields: [{ name: 'a', pattern: '^[A-Z]+$' }]` |
| `customFields: [{ name: 'items', type: 'grid', min_rows: 1 }]` | `customFields: [{ name: 'items', type: 'grid', columns: [ … ] }]` — the widget's defaults until it reads a camelCase key |
| `sections: [{ fields: ['a'], visibleOn: 'record.b == 1' }]` | `sections: [{ fields: ['a'], visibleWhen: 'record.b == 1' }]` |
| `sections: [{ fields: ['a'], columns: '2' }]` | `sections: [{ fields: ['a'], columns: 2 }]` |
| `sections: [{ fields: [{ field: 'a', visibleOn: '…' }] }]` | `sections: [{ fields: [{ field: 'a', visibleWhen: '…' }] }]` |
| `sections: [{ label: { en: 'Basics' }, fields: ['a'] }]` | `sections: [{ name: 'basics', label: 'Basics', fields: ['a'] }]` — the heading translates through `objects.<object>._sections.basics.label` |

The one-line fix: write each inline field in camelCase with the members the form draws and each section in its canonical spelling. No conversion is registered: nothing on the load path refuses either shape, and the census below found no working value to respell — the D3 entries `ui-object-form-custom-fields-typed` and `ui-object-form-sections-typed` carry that judgment.

## Who is affected, measured

A writer is a value written on the block: a page-component node (an object literal naming `object-form` or `object-master-detail-form`, flat or in its `properties` bag, or a literal annotated as one), a direct parse through the row, the block's React component inside `schema={{…}}`, or — the second pass — any object literal carrying `customFields` or `sections` in a file that names a form block, which reaches a local helper's arguments. Values resolve through same-file constants and spreads, every static value was parsed through this branch's rows, and each value with a non-static part, and each refusal, was read by hand.

- **objectstack** at `316be321ef`: three `object-form` `sections` writers (the showcase's new-project wizard, and one test each in `lint` and `spec`), field names only — all parse. No `customFields` writer. The other `sections` the second pass finds are form views and `record:details` sections, which these rows do not judge.
- **objectui** at the `.objectui-sha` pin `2e818d0b51ec` and at `main` `b92329c894` (identical results; every cited reader file is byte-identical between the two): **`customFields`** — 31 values parse (four block literals, the designer's object manager, 26 helper and embeddable-form arguments) and two are refused, both probes: a type-level test's `visibleOn` (never drawn) and the fixture pinning that an inline `defaultValue` seeds nothing; the 11 fully non-static values are run-time hand-offs and helper parameters, read by hand. **`sections`** — every block writer parses: 85 `object-form` values with a static part (the field designer's inline fields and the plugin-form README's inline-field wizard among them) and four `object-master-detail-form` values; the 19 fully non-static values are run-time hand-offs and helper parameters, read by hand, and use declared keys only. The refused section values are objectui's probe that a retired `className` / `gridClassName` reaches nothing, and `record:details`, detail-view or object-view form-slot sections, which these rows do not judge.
- **hotcrm** at `4054ec2680` and **cloud** at `2205b53010`: no writer of either member.
- **Deployed metadata** was not measured.
