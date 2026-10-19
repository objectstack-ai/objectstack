---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
'@objectstack/metadata-core': patch
---

feat(spec)!: a select option declares its lifecycle `kind` (`open` / `won` / `lost`), and every option of an object's `stageField` must declare it

Clause-②: yes (narrowing)

`SelectOptionSchema` gains one optional key, `kind`, a closed vocabulary of three lifecycle categories that means the same on every object: `open` (a step on the way), `won` (the successful end: a deal's Closed Won, a lead's Converted, a task's Done, a case's Resolved) and `lost` (the unsuccessful end: Closed Lost, Unqualified, Cancelled). It is the spelling `record:path` `stages[].terminal` already takes, so the data layer and the page say one thing one way. Example: `{ label: 'Closed Lost', value: 'closed_lost', kind: 'lost' }`. The exported type `SelectOptionKind` names the three values.

- On a plain single-value `select` / `radio` the key is optional, and an absent kind reads as `open`. Nothing is written in at parse: an option without `kind` parses without it.
- On any other field's options (`multiselect`, `checkboxes`, `tags`, a `multiple: true` select, a lookup's static options) `FieldSchema` refuses it at `options.<i>.kind`: a lifecycle is one value per record.
- A shared `picklist`'s options accept it (the same option shape). A form view's option list does not (`FormSelectOptionSchema`): it is refused there as an unknown key whose message points at the object field's own option.

**BREAKING (authoring):** when an object's `stageField` names a field, every option of that field must declare `kind`. `ObjectSchema` refuses the object otherwise, at every door that parses one (`ObjectSchema.create()`, `defineStack`, `os validate`, `os build`, the metadata save door), with one issue per option at `fields.<field>.options.<i>.kind` naming the field and the option. There is no default under `stageField`. Also refused, at `stageField`: a stage field that takes its options from a `picklist` (the object cannot see them to check), and a stage field carrying options that holds no single option code per record (`multiselect`, a `multiple: true` select). Unchanged: `stageField: false`, a `stageField` naming no declared field, and one naming a field with no options.

Migration: add `kind` to each option of the stage field, marking each terminal state `won` or `lost` and every other state `open`:

- `status: Field.select({ options: [{ label: 'New', value: 'new' }, { label: 'Converted', value: 'converted' }, { label: 'Unqualified', value: 'unqualified' }] })` with `stageField: 'status'` → the same options with `kind: 'open'`, `kind: 'won'` and `kind: 'lost'`.
- A picklist-backed stage field → declare its options inline on the field.
- An object with no linear lifecycle → `stageField: false`.

No conversion makes this edit, because which option ends a record's life successfully is the author's to say. `os migrate meta` lists the D3 entry `stage-field-option-kind-required` with the prescription.

The Studio object designer's options repeater offers `kind`; the field form's options repeater lists it.

The other packages follow the new key:

- **`@objectstack/platform-objects`.** The metadata-form translation bundles (`./metadata-translations`) carry the options repeater's new `kind` row, with its label and help text in zh-CN, ja-JP and es-ES.
- **`@objectstack/metadata-core`.** The published contract fixture `FLS_CONTRACT_OBJECT` (`@objectstack/metadata-core/testing`) names `salary_grade` as its `stageField`, so its two options now declare `kind: 'open'`, and the fixture meets the stage-field rule: `ObjectSchema` raises no issue at `stageField` or under `fields.salary_grade.options`. The fixture is not otherwise a spec-valid object (its `script` actions carry no `body` or `target`), and this change leaves that as it was.

<!-- adr-0087: registered stage-field-option-kind-required -->
