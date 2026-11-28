// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the publish door's object re-parse (#35924): the
// per-item and package publish now judge a stored object draft by the current
// `ObjectSchema`, as the save door judges the same body. Notice only: no key
// is removed and no D2 conversion exists. A draft the ADR-0087 chain converts
// is judged as served and keeps publishing; what is refused is a draft the
// current schema refuses after the chain, and its fix is the author's.
export const entry: SemanticMigration = {
  id: 'publish-refuses-object-draft-the-current-schema-refuses',
  surface:
    'The per-item publish (`POST /api/v1/meta/object/:name/publish`) and the package publish (`POST /api/v1/packages/:id/publish-drafts`) of an '
    + '`object` draft: the draft is parsed against the current `ObjectSchema`, as served (the stored-row conversion '
    + 'chain applied), before it is promoted, and refused `422 INVALID_METADATA` with the save door\'s `issues[]`',
  replacement:
    'Fix the keys the refusal\'s `issues[]` names, save the draft again (the save answers the same refusal until '
    + 'the body parses), then publish',
  reason:
    'A draft saved before a stricter `ObjectSchema` rule landed (for example a sealed audit object with no '
    + '`tenant_id` chain column, ADR-0154 D10) was promoted live at publish, unjudged by that rule, while a save of '
    + 'the same body is refused. Stored metadata is not rewritten or refused at boot; an active row is unchanged. '
    + 'The next publish of such a draft is refused, the draft stays a draft, and a package publish refuses its '
    + 'whole batch with nothing promoted.',
  acceptanceCriteria:
    'Every pending object draft reads `_diagnostics.valid: true`; a publish of every object draft the package carries succeeds.',
};
