// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-block-variant-destructive-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface: "variant: 'destructive' on an action block: an action:button, action:icon, action:group or action:menu "
    + 'node, or an action:group / action:menu member',
  replacement: "`variant: 'danger'`, the spelling `ActionSchema.variant` and the action runner use. The rename is "
    + 'lossless on a block: it draws the same destructive button, and a `confirmText` question asks through the '
    + 'destructive confirm button as before.',
  reason:
    "An action's variant was spelled in two dialects. `ActionSchema.variant`, the declaration the action runner "
    + "dispatches, says `danger`; the action block rows took the Button primitive's word, `destructive`, and "
    + 'refused `danger`, so one destructive action changed spelling between a declaration and a block, and each '
    + 'block renderer translated between the two at its forward to the runner. The blocks now take `danger` and '
    + 'refuse `destructive` with the rename. Other components that draw the Button primitive directly '
    + "(`element:button` and the like) keep `destructive`, the primitive's own word, and are not touched. A page's "
    + '`properties` is not parsed on the metadata load path, and the next save of the page meets the '
    + 'component-props gate at the metadata save door; `os validate` reports the old value as a '
    + '`component-props-invalid` finding. The D2 conversion `page-action-block-variant-destructive-to-danger` '
    + 'performs the rename, retired from the load path, so an author meets the refusal while stored rows, built '
    + 'artifacts and `os migrate meta --write` are rewritten.',
  acceptanceCriteria:
    "No `action:button` / `action:icon` / `action:group` / `action:menu` `properties.variant` and no "
    + "`action:group` / `action:menu` member `variant` reads `'destructive'`; `os validate` reports no "
    + '`component-props-invalid` finding at `properties.variant` or `properties.actions.N.variant`, and each such '
    + 'block still draws the destructive button and confirms through the destructive confirm button.',
  conversionIds: ['page-action-block-variant-destructive-to-danger'],
};
