// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'seal-default-chain-column-refused',
  surface:
    'data.Object.lifecycle.seal with no chainField (ObjectSchema: ObjectSchema.create() and defineStack() throw when a '
    + 'config module is evaluated; os validate, os build and the metadata save door refuse): '
    + 'an audit-class object whose default chain column tenant_id is not a field of the object, has a value that is '
    + 'not one text on every store, or is listed in lifecycle.seal.valueFields',
  replacement:
    'Declare a text or lookup tenant_id field that holds each row\'s organization id, or name the chain column with '
    + 'lifecycle.seal.chainField, such as the tenant column the platform injects: '
    + 'seal: { valueFields: [...], chainField: \'organization_id\' }',
  reason:
    'A seal that names no chainField chains each row by tenant_id (ADR-0154 D10, note on chainField). That default '
    + 'was never judged at authoring, and such an object parsed. At run time the sealer reported an object with no '
    + 'tenant_id field at error and sealed none of its rows; sealed the rows of one with a non-text tenant_id into '
    + 'the deployment chain with no report; and sealed one that lists tenant_id in valueFields per organization, '
    + 'carrying the committed value in clear as the chain. The '
    + 'parse now holds the default to the rules a named chainField meets and refuses the object at lifecycle.seal. '
    + 'The registry injects organization_id, never tenant_id. A definition that skips the parse (a stored row loaded '
    + 'at boot, a raw registration) still registers, and the sealer treats it as before. The judgement reads the '
    + 'object\'s own fields and the injected columns, so a tenant_id contributed only by an objectExtensions entry '
    + 'does not count. There is no mechanical rewrite: '
    + 'which column holds each row\'s organization is the author\'s choice, and changing the chain column of an '
    + 'object that already has checkpoints re-seals its last sealed window.',
  acceptanceCriteria:
    'os validate passes for every sealed object; each one names a chainField it has, or declares a text or lookup '
    + 'tenant_id outside valueFields. For an object that had no tenant_id field (it had no checkpoints), os audit '
    + 'verify reports ok once it seals. For an object that already had checkpoints under a non-text tenant_id or one '
    + 'listed in valueFields, the fix re-seals the last sealed window: os audit verify reports it listed_twice, and '
    + 'verifying one organization with --org reads the rows sealed before the change as late and unsealed '
    + '(ADR-0154 D10 note); expect those findings for that object only.',
};
