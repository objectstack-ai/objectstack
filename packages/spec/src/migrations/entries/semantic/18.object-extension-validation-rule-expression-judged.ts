// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #33154: an accept-set narrowing of `os build`, `os validate` and the runtime
// `object_extension` publish door. The registry merges an extension's
// `validations` onto its target object by name, so every save of the target
// runs them, but the expression rule of `@objectstack/lint`
// (`validateStackExpressions`) judged only the rules an object declares. It now
// judges each rule an `objectExtensions` entry adds by the object's own rule
// pass, against the extended object as served, at the build and the door. No D2
// conversion: how a refused rule is repaired (the field it meant, a registered
// function, a null guard) is a fact only the author holds, and a stored row is
// not re-judged until it is published again.
export const entry: SemanticMigration = {
  id: 'object-extension-validation-rule-expression-judged',
  surface:
    'a validation rule an `objectExtensions` entry adds (`defineObjectExtension({ extend, validations })`, or an '
    + '`object_extension` item published at runtime through Studio, `PUT /api/v1/meta/object_extension/TARGET` or '
    + 'the MCP and AI authoring doors) whose `condition` or `when` (a nested `then` / `otherwise` branch included) '
    + 'is CEL, e.g. `{ extend: \'crm_account\', validations: [{ name: \'no_blocked\', type: \'script\', '
    + 'condition: \'record.nmae == "blocked"\', message: \'Blocked.\' }] }`.',
  replacement:
    'A rule the expression rule accepts on a declared rule of the same object: CEL that reads `record.FIELD` for '
    + 'a field the extended object serves (its own fields and every field an extension adds), calls only '
    + 'registered functions, guards a nullable operand with `!= null` (`record.credit != null && record.credit > '
    + '5000000`, not a bare `record.credit > 5000000` on a field with no `required: true` and no `defaultValue`), '
    + 'and reads one hop through a reference only as a declared rule may.',
  reason:
    'The registry merges an extension\'s rules onto the target, so every save of the target runs them, but '
    + 'neither `os build` nor the `object_extension` publish door judged them: a misspelt field or an '
    + 'unregistered function was accepted and failed only when an end user saved a record, and a rule reading a '
    + 'nullable field with no guard aborted and refused every save where that field was empty. Each rule an '
    + 'extension adds is now judged by the object\'s own rule pass, against the extended object as served '
    + '(at the door, without the package\'s own stored extension, which the write replaces), and refused with '
    + 'the same rule id (`expression-invalid`; at the door `422 INVALID_METADATA`), located at '
    + '`object \'TARGET\' · objectExtensions[0] · validation \'RULE\'`.',
  acceptanceCriteria:
    '`os build` reports no `expression-invalid` finding located at an `objectExtensions[N] · validation` site, '
    + 'and publishing each extension that adds a validation rule again answers 200 with no such issue. A '
    + 'record of the extended object that the rule should refuse is refused on save with the rule\'s message.',
};
