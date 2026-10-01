// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20928 — the third carrier of the inline grid column. An
// `object-master-detail-form` page block's `details` was `z.array(z.unknown())`
// while the other two carriers — a relationship field's `inlineColumns` and a
// form view's `subforms[].columns` (#20901) — were the strict
// `InlineGridColumnSchema`; the entry is now a strict shape of the twelve keys
// objectui's `MasterDetailForm` reads, and its `columns` REFERENCES that schema.
// D3 only: page-component `properties` is not parsed on the metadata save or
// load path, so a stored page is never refused and there is no load-path
// refusal for a conversion to pre-empt; the authored census found no `field`
// spelling to respell. `defineStack`'s identity-only check reaches this carrier
// too, the reach `inline-grid-column-identity-only-currency-scale-refused`
// records for the other two.
export const entry: SemanticMigration = {
  id: 'ui-object-master-detail-form-details-closed',
  surface: 'page `object-master-detail-form` components — `properties.details[]` (each detail '
    + 'entry, which used to accept any value) and `properties.details[].columns[]` (its inline '
    + 'grid columns), including `scale` on a column that declares no `type` and whose `name` is a '
    + '`currency` field of the entry\'s `childObject`',
  replacement: 'each entry is `{ childObject, relationshipField?, columns?, formFields?, '
    + 'inlineMode?, amountField?, sortField?, totalField?, title?, minRows?, maxRows?, addLabel? }` '
    + '— the keys the renderer reads — with `inlineMode` one of `grid` / `form`. Each column is the '
    + 'strict, name-keyed inline grid column a relationship field\'s `inlineColumns` takes — '
    + '`{ name, label?, type?, … }`, where `{ name }` alone hydrates the rest from the child '
    + 'object\'s field. Write `childObject` on every entry; write `name` where a column said '
    + '`field` (or `fieldName`, `key`) or was a bare field-name string; delete `scale` from a '
    + 'column that renders as a currency column, whether it declares `type: \'currency\'` or takes '
    + 'it from a `currency` child field — nothing replaces it, the currency\'s ISO 4217 minor unit '
    + 'decides; delete any key neither shape declares.',
  reason: 'The block draws one inline grid per detail entry, hydrating an authored column list '
    + 'with the same rule and into the same grid as the other two carriers of the inline grid '
    + 'column, but nothing judged its entries: a key the renderer does not read was ignored in '
    + 'silence, and a column carrying a key the grid does not read, or `scale` on a currency '
    + 'column — refused on the other carriers under the maintainer\'s rulings of 2026-09-23 '
    + '(option B, `scale` retired from the currency type) and 2026-09-24 (option 乙 — a currency\'s '
    + 'ISO 4217 minor unit decides its display) — went through `objectstack validate` green. The '
    + 'entry is now a strict shape and its `columns` references the column schema, so every rule '
    + 'that schema holds applies here too, with its own prescription. The entry half is read where '
    + 'every page component\'s props are: the component-props gate reports a failing entry or '
    + 'column as an advisory `component-props-unknown-key` / `component-props-invalid` finding on '
    + '`objectstack validate`, `objectstack build` and `objectstack lint`, and a stored page still '
    + 'saves and loads, because a page component\'s `properties` is not parsed on the metadata save '
    + 'or load path. The identity-only half is `defineStack`\'s cross-reference check, which already '
    + 'judged the other two carriers: it now reaches the block wherever a page carries it and '
    + 'refuses an identity-only column over a `currency` child field that carries `scale`, with the '
    + 'column schema\'s own message; reach: the child object must be declared in the same stack, '
    + 'and a column the column schema refuses on its own is left to the component-props gate. No '
    + 'conversion is registered: nothing on the load path refuses the shape, and the authored '
    + 'census found nothing to respell. Population measured at the change, on origin/main '
    + 'ebdb6f2aca: one authored block in the examples (the showcase project workspace, one entry '
    + '`{ title, childObject, addLabel }`, no columns), one documentation example whose three '
    + 'columns were bare field-name strings (rewritten as `{ name }` columns in the same change), '
    + 'and zero `field`-keyed detail columns, against one authored `inlineColumns` block as the '
    + 'control. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-master-detail-form` node validates: `objectstack validate` '
    + 'reports no `component-props-unknown-key` / `component-props-invalid` finding on a '
    + '`properties.details` path and no cross-reference finding on a `details[].columns[].scale` '
    + 'path. Every detail entry carries `childObject` and only keys the entry shape declares; every '
    + 'column is an object carrying `name`, no column carries `field`, `fieldName` or `key`, and no '
    + 'column that renders as a currency column carries `scale`. The block\'s showcase entry '
    + '`{ title, childObject, addLabel }` parses unchanged, and the master-detail grid renders a '
    + 'value — not a blank cell — in each authored column for a row that has one.',
};
