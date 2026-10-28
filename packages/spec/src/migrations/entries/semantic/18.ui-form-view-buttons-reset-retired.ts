// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #27153 (ADR-0049 enforce-or-remove, ruled retire on the card) — the D3 entry
// of the `form-view-buttons-reset-removed` family. The key is registered in
// RETIRED_KEYS_BY_MAJOR as `ui/FormView:buttons.reset`.
export const entry: SemanticMigration = {
  id: 'ui-form-view-buttons-reset-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code span.
  surface:
    'view.form.buttons.reset and view.formViews.<key>.buttons.reset — removed from the form view '
    + 'buttons block (submit and cancel are unchanged)',
  replacement:
    'nothing to write instead: a form has `submit` and `cancel` buttons only, and Cancel leaves the form '
    + 'without saving. Delete the key',
  reason:
    'ADR-0049: no form ever drew a reset button and `reset.label` was never read, while the one renderer '
    + 'fold that read `reset.show` mapped it onto clearing the form after a successful save. The D2 '
    + 'conversion `form-view-buttons-reset-removed` makes each stored or existing source parse by '
    + 'deleting the key. What it cannot decide is whether a form whose author wanted a way back to its '
    + 'opening values needs anything beyond Cancel',
  acceptanceCriteria:
    'No form view declares `buttons.reset`; it is refused at parse with its prescription, and TypeScript '
    + 'rejects it at a `FormView` position. `buttons.submit` and `buttons.cancel` still parse and still '
    + 'render on every console form entry point.',
  conversionIds: ['form-view-buttons-reset-removed'],
};
