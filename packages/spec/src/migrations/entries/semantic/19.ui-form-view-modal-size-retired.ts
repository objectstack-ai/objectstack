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
    + 'copied it from the object\'s internal form view. Through 18.6.0 that dialog opened at the authored '
    + 'size. At 19.0.0 it stopped loading a form view (the protocol-18 semantic entry '
    + '`internal-record-forms-not-loaded` records that change), and neither the form page a name or a '
    + 'public link opens nor any server surface reads the key, so from 19.0.0 a stored value saves, is '
    + 'served and changes nothing. The D2 conversion `form-view-modal-size-removed` makes each stored or '
    + 'existing source parse by deleting the key, which changes nothing a reader sees on 19. What it '
    + 'cannot restore is the size: a form that carried `modalSize` on 18.x opens its record\'s create or '
    + 'edit dialog at the size the dialog chooses after the upgrade, and no key an author writes sets '
    + 'that dialog\'s size now. It follows the number of fields the dialog draws, and the person filling '
    + 'it in can maximize it',
  acceptanceCriteria:
    'No form view and no `form` item declares `modalSize`; it is refused at parse with its prescription, '
    + 'and TypeScript rejects it at a `FormView` or `Form` position. The React `ObjectForm` block still '
    + 'publishes the prop, and the `object-form` page block still accepts it with `formType: \'modal\'`. '
    + 'On an app that comes from 18.x, New and Edit on each object whose form carried the key open at a size '
    + 'you accept.',
  conversionIds: ['form-view-modal-size-removed'],
};
