// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20901 — the form-view carrier of the inline grid column. `subforms[].columns`
// was `z.array(z.any())` while the other carrier, a relationship field's
// `inlineColumns`, has been the strict `InlineGridColumnSchema` since #9227; the
// carrier now REFERENCES that schema, so both carriers are judged by one
// contract. The one mechanical respelling, `field` → `name`, is the D2
// conversion `form-view-subform-columns-canonicalized` (the respelling
// `field-column-lists-canonicalized` makes on `inlineColumns`); every other
// refused shape is a judgment only the author can make. A view saved with a
// failing column is refused with the column schema's own prescription, and a
// stored row carrying one is diagnosed at rehydration; neither is stripped.
export const entry: SemanticMigration = {
  id: 'form-view-subform-columns-closed',
  surface: 'view.form.subforms[].columns[] and view.formViews.<key>.subforms[].columns[] — the '
    + 'form view\'s inline grid columns, which used to accept any value',
  replacement: 'each entry is the strict, name-keyed inline grid column a relationship field\'s '
    + '`inlineColumns` takes — `{ name, label?, type?, … }`, where `{ name }` alone hydrates the rest '
    + 'from the child object\'s field. Write `name` where a column said `field` (or `fieldName`, '
    + '`key`); delete `scale` from a column declaring `type: \'currency\'`; delete any key the '
    + 'column schema does not declare.',
  reason: 'Both carriers feed the one console grid, which reads only the keys the column schema '
    + 'declares and keys a column by `name` alone. On the form view the columns were never judged, '
    + 'so a mis-keyed column published clean and drew a blank grid column, and a key the other '
    + 'carrier refuses — `scale` on a currency column, under the maintainer\'s ruling of 2026-09-23 '
    + '(option B, `scale` retired from the currency type) and the remedy ruled on 2026-09-24 '
    + '(option 乙 — a currency\'s ISO 4217 minor unit decides its display) — published green here. '
    + 'The carrier now references the column schema, so every rule it holds applies here too, with '
    + 'its own prescription. Only the `field` spelling is converted mechanically — by the conversion '
    + '`form-view-subform-columns-canonicalized`, which rewrites stored rows and assembled artifacts '
    + 'and lists the edit under `os migrate meta`, while an author writing `field` meets the refusal. '
    + 'Which column an unknown key or a mixed `field`/`name` entry meant is the author\'s call — a '
    + 'conversion that dropped the key would accept on every load what the parse now refuses. '
    + 'Population measured at the change, on '
    + 'origin/main cb4c31dd52: zero authored `subforms` in the repository (the showcase derives its '
    + 'master-detail grids from the data model instead), against one authored `inlineColumns` block '
    + 'as the control. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every view in the stack parses: `objectstack validate` and a view parse report '
    + 'no issue on a `subforms[].columns[]` path. Every column entry is an object carrying `name`, '
    + 'no entry carries `field`, `fieldName` or `key`, and no column declaring `type: \'currency\'` '
    + 'carries `scale`. Each column `name` names a field of the subform\'s `childObject`, and the '
    + 'master-detail grid renders a value — not a blank cell — in each column for a row that has one.',
};
