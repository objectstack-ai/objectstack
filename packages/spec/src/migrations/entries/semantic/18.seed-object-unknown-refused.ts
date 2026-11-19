// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'seed-object-unknown-refused',
  surface:
    'data.Seed.object on a seed saved through the metadata save door (PUT /api/v1/meta/seed/NAME in draft or '
    + 'publish mode, the MCP draft save): a seed whose object no package registers and no stored or code-defined '
    + 'object carries',
  replacement:
    'Name the object by its full name (crm_lead, not lead), or create the object first: a draft of it is enough '
    + 'for a draft seed, and a live seed needs it published',
  reason:
    'A seed loads its records into the object it names. The save door stored a seed naming an object that does '
    + 'not exist (200); its publish then answered published while the load wrote nothing, and the post-publish '
    + 'probe asked the author to publish again, which could never work. The save door now refuses it 422 '
    + 'INVALID_METADATA at object, naming the object. The publish promotion and the restore doors are unchanged: '
    + 'a seed stored before this refusal still publishes, and its load reports the missing object. There is no '
    + 'mechanical rewrite: whether the author meant another object or one still to be created is a judgement '
    + 'about the seed.',
  acceptanceCriteria:
    'PUT /api/v1/meta/seed/NAME?mode=draft&package=PKG with object naming an object the package has published, '
    + 'or drafted, answers 200; POST /api/v1/packages/PKG/publish-drafts publishes it and its seedApplied.success '
    + 'is true.',
};
