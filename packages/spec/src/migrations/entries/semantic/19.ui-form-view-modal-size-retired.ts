// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #36544 (ADR-0049 enforce-or-remove, seat ruling on the card: retire) — the D3
// entry of the `form-view-modal-size-removed` family. The key is registered in
// RETIRED_KEYS_BY_MAJOR as `ui/FormView:modalSize` and `ui/Form:modalSize`.
export const entry: SemanticMigration = {
  id: 'ui-form-view-modal-size-retired',
  surface:
    'view.form.modalSize, view.formViews.<key>.modalSize and form.modalSize — removed from the form view '
    + 'and the `form` item (the React `ObjectForm` block and the `object-form` page block keep their own)',
  replacement:
    'nothing on the form: no form view opens in a dialog. Delete the key. The console\'s New and Edit '
    + 'dialogs lay a record out by the object\'s `fieldGroups` and choose their own size from the number of '
    + 'fields they draw; a form opened by name, or by a public link, gets a page of its own. A React page that opens a form in a modal writes the prop on the block: `ObjectForm` with '
    + '`formType=\'modal\'` and its own `modalSize`',
  reason:
    'ADR-0049: the one form-view reader of `modalSize` was the console\'s New / Edit record dialog, which '
    + 'copied it from the object\'s internal form view. That dialog stopped loading a form view in 18 (the '
    + 'semantic entry `internal-record-forms-not-loaded`), and neither the form page a name or a public '
    + 'link opens nor any server surface reads the key — a stored value saved, served and changed nothing. '
    + 'The D2 conversion `form-view-modal-size-removed` makes each stored or existing source parse by '
    + 'deleting the key, which changes nothing a reader sees. What it cannot decide is whether a form that '
    + 'carried `modalSize` was meant to make a record\'s create or edit dialog wider or narrower: no key '
    + 'an author writes sets that dialog\'s size now. It follows the number of fields the dialog draws, and '
    + 'the person filling it in can maximize it',
  acceptanceCriteria:
    'No form view and no `form` item declares `modalSize`; it is refused at parse with its prescription, '
    + 'and TypeScript rejects it at a `FormView` or `Form` position. The React `ObjectForm` block still '
    + 'publishes the prop, and the `object-form` page block still accepts it with `formType: \'modal\'`.',
  conversionIds: ['form-view-modal-size-removed'],
};
