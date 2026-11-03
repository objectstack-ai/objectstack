// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29012 (ADR-0049 enforce-or-remove, triage ruling: retire) — the D3 entry of
// the `form-view-drawer-keys-removed` family. The keys are registered in
// RETIRED_KEYS_BY_MAJOR as `ui/FormView:drawerSide` and `ui/FormView:drawerWidth`.
export const entry: SemanticMigration = {
  id: 'ui-form-view-drawer-keys-retired',
  surface:
    'view.form.drawerSide / view.form.drawerWidth and view.formViews.<key>.drawerSide / '
    + 'view.formViews.<key>.drawerWidth — removed from the form view (the React `ObjectForm` block and '
    + 'the `object-form` page block keep their own)',
  replacement:
    'nothing on the form view: no form view opens in a drawer. Delete the keys. A list opens a clicked '
    + 'record in its drawer (`navigation.mode`) sized by the `navigation.size` bucket, and a React page '
    + 'that opens a form in a drawer writes the props on the block: `ObjectForm` with `formType=\'drawer\'` '
    + 'and its own `drawerSide` / `drawerWidth`',
  reason:
    'ADR-0049: `type: \'drawer\'` left the form view in the same release, so no form view opens in a drawer, '
    + 'and no form-view surface (the console form page, its New and Edit dialogs, the record form page, '
    + 'Studio) read either key — a stored value saved, served and changed nothing. The D2 conversion '
    + '`form-view-drawer-keys-removed` makes each stored or existing source parse by deleting the keys, '
    + 'which changes nothing a reader sees. What it cannot decide is whether a form view that carried them '
    + 'was meant to open in a drawer somewhere: an author who wanted that opens it from a React page through '
    + 'the `ObjectForm` block\'s drawer, or lets a list open the record in its drawer',
  acceptanceCriteria:
    'No form view declares `drawerSide` or `drawerWidth`; each is refused at parse with its prescription, '
    + 'and TypeScript rejects it at a `FormView` position. The React `ObjectForm` block still publishes both '
    + 'props, and the `object-form` page block still accepts them with `formType: \'drawer\'`.',
  conversionIds: ['form-view-drawer-keys-removed'],
};
