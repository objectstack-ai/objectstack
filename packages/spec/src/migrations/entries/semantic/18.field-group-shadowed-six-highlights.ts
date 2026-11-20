// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the `field-group-shadowed` warning moving from the
// first four highlightFields to the six the default record page draws
// (RECORD_HIGHLIGHTS_MAX, `@objectstack/spec/ui`). Notice only: no key is
// removed and no D2 conversion exists, because which field leaves the strip, or
// whether the group goes, is a choice only the author can make.
export const entry: SemanticMigration = {
  id: 'field-group-shadowed-six-highlights',
  surface:
    'The `field-group-shadowed` warning of `os validate` / `lint` / `compile` / `build`: a field group of an object '
    + 'whose every visible member is the record title or one of the first six `highlightFields` (after the title '
    + 'leaves the list). It judged the first four before',
  replacement:
    'Keep at least one member of the group out of the first six `highlightFields`, or remove the group if the record '
    + 'header strip already shows its fields',
  reason:
    'The default record page draws the first six highlights in its header strip and leaves those fields out of the '
    + 'Details body, so a group whose only members sit there is empty on the record page while it still shows on '
    + 'forms. The warning judged four of the six, so a group emptied by the fifth or sixth highlight passed. A group '
    + 'it warned before is still warned. Stored items are not rewritten or refused at publish; like any warning, it '
    + 'makes `os validate --strict` exit 1.',
  acceptanceCriteria:
    'os validate reports no `field-group-shadowed` warning, and each declared field group shows at least one field '
    + 'in the Details body of the default record page.',
};
