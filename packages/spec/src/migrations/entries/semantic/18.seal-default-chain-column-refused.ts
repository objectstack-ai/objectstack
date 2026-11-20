// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'seal-default-chain-column-refused',
  surface:
    'data.Object.lifecycle.seal with no chainField (ObjectSchema; os validate, os build and the metadata save door): '
    + 'an audit-class object whose default chain column tenant_id is not a field of the object, has a value that is '
    + 'not one text on every store, or is listed in lifecycle.seal.valueFields',
  replacement:
    'Declare a text or lookup tenant_id field that holds each row\'s organization id, or name the chain column with '
    + 'lifecycle.seal.chainField, such as the tenant column the platform injects: '
    + 'seal: { valueFields: [...], chainField: \'organization_id\' }',
  reason:
    'A seal that names no chainField chains each row by tenant_id (ADR-0154 D10, note on chainField). That default '
    + 'was never judged at authoring: an object without a usable tenant_id parsed, and the sealer reported it at '
    + 'error and sealed none of its rows, or, for a non-text tenant_id, sealed them into the deployment chain. The '
    + 'parse now holds the default to the rules a named chainField meets and refuses the object at lifecycle.seal. '
    + 'The registry injects organization_id, never tenant_id. A definition that skips the parse (a stored row loaded '
    + 'at boot, a raw registration) still registers, and the sealer still reports it. There is no mechanical rewrite: '
    + 'which column holds each row\'s organization is the author\'s choice, and changing the chain column of an '
    + 'object that already has checkpoints re-seals its last sealed window.',
  acceptanceCriteria:
    'os validate passes for every sealed object; each one names a chainField it has, or declares a text or lookup '
    + 'tenant_id outside valueFields; os audit verify still reports ok for objects that already had checkpoints.',
};
