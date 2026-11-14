// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #33153: an accept-set narrowing of `os build`, `os validate` and the runtime
// `object_extension` publish door. The expression rule of `@objectstack/lint`
// (`validateStackExpressions`) refused a formula on a cycle (one that reads
// its own value, itself or through the formulas it reads) only when the
// object declared it: the formula-cycle pass ran on the object walk and named
// the object's declared fields only, so a cycle among the formulas an
// `objectExtensions` entry adds was accepted. The cycle is now found on the
// object as served, at the build and the door, and each member an extension
// adds is refused at its entry. No D2 conversion: which read breaks the cycle
// is a fact only the author holds, and a stored row is not re-judged until it
// is published again.
export const entry: SemanticMigration = {
  id: 'object-extension-formula-cycle-refused',
  surface:
    'a `formula` field an `objectExtensions` entry adds (`defineObjectExtension({ extend, fields })`, or an '
    + '`object_extension` item published at runtime through Studio, `PUT /api/v1/meta/object_extension/TARGET` or '
    + 'the MCP and AI authoring doors) that reads its own value, itself or through the formulas it reads, the '
    + 'target\'s own formulas included, e.g. `{ extend: \'crm_account\', fields: { a__c: { type: \'formula\', '
    + 'expression: \'record.b__c + 1\' }, b__c: { type: \'formula\', expression: \'record.a__c + 1\' } } }`.',
  replacement:
    'Formulas whose reads have an order: each formula an extension adds reads stored fields, or formulas that do '
    + 'not read it back, as a formula the object declares must already.',
  reason:
    'The engine computes an object\'s formulas, an extension\'s included, in dependency order, and a formula on a '
    + 'cycle has no such order: it is never evaluated and reads null on every row. The build and the door refused '
    + 'such a cycle among an object\'s declared formulas only, so one an extension adds was accepted and showed only '
    + 'when records were read. It is now refused with the verdict and the sentence the object\'s own cycle gets '
    + '(`expression-invalid`; at the door `422 INVALID_METADATA`), on each member the extension adds, located at the '
    + 'entry; a member the object declares keeps its location at the object. One exception: a field two packages\' '
    + 'extensions add at the same priority is not judged, since which definition the registry serves is registration '
    + 'order, so a cycle through such a field is not found.',
  acceptanceCriteria:
    '`os build` reports no `expression-invalid` finding naming a formula cycle at an `objectExtensions` entry, and '
    + 'publishing each such extension again answers 200 with no such issue. Each of its formulas reads a computed '
    + 'value on every row, save a cycle through a field two packages add at the same priority, which neither door '
    + 'judges.',
};
