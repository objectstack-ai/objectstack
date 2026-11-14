// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #33216: an accept-set narrowing of `os build`, `os validate` and the runtime
// `object_extension` publish door. The expression rule of `@objectstack/lint`
// (`validateStackExpressions`) judged the leaf of a one-hop read
// (`record.REF.LEAF`) only when the reference was declared on the object: it
// read the declared objects for the reference, so a lookup an
// `objectExtensions` entry adds let a misspelt leaf through. The hop is now
// judged on the object as served, the reference an extension adds included,
// at the build and the door. No D2 conversion: which field the author meant
// is a fact only the author holds, and a stored row is not re-judged until it
// is published again.
export const entry: SemanticMigration = {
  id: 'object-extension-added-lookup-hop-leaf-judged',
  surface:
    'a validation rule or a formula that reads one hop (`record.REF.LEAF`) through a lookup an `objectExtensions` '
    + 'entry adds (`defineObjectExtension({ extend, fields })`, or an `object_extension` item published at runtime '
    + 'through Studio, `PUT /api/v1/meta/object_extension/TARGET` or the MCP and AI authoring doors), where LEAF is '
    + 'a field the lookup\'s target does not serve, e.g. `{ extend: \'crm_account\', fields: { manager__c: { type: '
    + '\'lookup\', reference: \'crm_contact\' }, hours__c: { type: \'formula\', expression: '
    + '\'record.manager__c.daly_hours\' } } }`.',
  replacement:
    'A one-hop read whose LEAF is a field the lookup\'s target serves (its own fields, the columns the platform '
    + 'injects on it, every field an extension adds to it, or `id`), as a hop through a lookup the object declares '
    + 'must already read.',
  reason:
    'The engine plans a one-hop read over the registered schema, where a lookup an extension adds is a field like '
    + 'any other, but the build and the door looked the reference up on the declared object only. So a misspelt '
    + 'leaf behind an extension-added lookup was accepted: a formula read null on every row, and a validation rule '
    + 'had no verdict and refused every save of the object. The hop is now judged on the object as served and '
    + 'refused with the verdict a hop through a declared lookup gets (`expression-invalid`; at the door `422 '
    + 'INVALID_METADATA`), located where the rule or formula is written. A hop through an added lookup into a '
    + 'stored-metadata-body table is refused as through a declared one. A lookup two packages add at the same '
    + 'priority is not judged, since which definition is served is registration order.',
  acceptanceCriteria:
    '`os build` reports no `expression-invalid` finding naming an unknown field read through a reference an '
    + 'extension adds, and publishing each such extension again answers 200 with no such issue. The formula reads '
    + 'the target\'s value, and a record the rule should refuse is refused on save with the rule\'s message.',
};
