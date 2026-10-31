// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #27153 (ADR-0049 enforce-or-remove, ruled retire on the card) — the D3 entry
// of the `form-view-buttons-reset-removed` family. The key is registered in
// RETIRED_KEYS_BY_MAJOR as `ui/FormView:buttons.reset`.
export const entry: SemanticMigration = {
  id: 'ui-form-view-buttons-reset-retired',
  surface:
    'view.form.buttons.reset and view.formViews.<key>.buttons.reset — removed from the form view '
    + 'buttons block (submit and cancel are unchanged)',
  replacement:
    'nothing to draw instead: a form has `submit` and `cancel` buttons only, and Cancel leaves the form '
    + 'without saving. Delete the key. `reset.show: true` used to clear the form after each save on '
    + 'ObjectView and the record form page; a converted form no longer does, and a form that should '
    + 'declares `submitBehavior: { kind: \'continue\' }`',
  reason:
    'ADR-0049: no form ever drew a reset button and `reset.label` was never read, while the one renderer '
    + 'fold that read `reset.show` mapped it onto clearing the form after a successful save. The D2 '
    + 'conversion `form-view-buttons-reset-removed` makes each stored or existing source parse by '
    + 'deleting the key, so a converted form that cleared after a save stops clearing. What it cannot '
    + 'decide is whether that form wanted the clear: an author who did writes `submitBehavior: { kind: '
    + '\'continue\' }`, which ObjectForm and the console form page honour',
  acceptanceCriteria:
    'No form view declares `buttons.reset`; it is refused at parse with its prescription, and TypeScript '
    + 'rejects it at a `FormView` position. `buttons.submit` and `buttons.cancel` still parse and still '
    + 'render on every console form entry point.',
  conversionIds: ['form-view-buttons-reset-removed'],
};
