// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the `field-group-shadowed` warning moving from the
// first four highlightFields to six (RECORD_HIGHLIGHTS_MAX, `@objectstack/spec/ui`).
// The default record page has since stopped drawing a key-field strip, so the
// warning now judges the record title alone and this step owes the author
// nothing. Notice only: no key is removed and no D2 conversion exists.
export const entry: SemanticMigration = {
  id: 'field-group-shadowed-six-highlights',
  surface:
    'The `field-group-shadowed` warning of `os validate` / `lint` / `compile` / `build`: a field group of an object '
    + 'whose every visible member is the record title or one of the first six `highlightFields` (after the title '
    + 'leaves the list). It judged the first four before',
  replacement:
    'No action is owed. The warning now fires only for a group whose every visible member is the record title; if '
    + 'one does, add another field to the group or remove the group',
  reason:
    'In this release line the warning first judged the first six highlights instead of four, because the default '
    + 'record page drew them in a header strip and left them out of the Details body. The default record page now '
    + 'draws no key-field strip and keeps every grouped field in its group, so the warning judges the record title '
    + 'alone: a group emptied by highlights alone no longer warns, and moving highlights to quiet it is not needed. '
    + 'Stored items are not rewritten or refused at publish; like any warning, it makes `os validate --strict` exit 1.',
  acceptanceCriteria:
    'os validate reports no `field-group-shadowed` warning; one that remains names a group whose only visible '
    + 'member is the record title.',
};
