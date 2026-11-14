// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #33217: an accept-set narrowing of `os build`, `os validate` and the runtime
// `object_extension` publish door. The two `@objectstack/lint` rules that judge
// a validation rule's static artifact (`validateRuleCompilability`: a `format`
// rule's `regex`, a `json_schema` rule's `schema`; `validateRuleSchemaFormats`:
// a format NAME inside that schema) walked only the rules an object declares,
// and ran on the object door only. They now walk each rule an
// `objectExtensions` entry adds too, and run on the `object_extension` door. No
// D2 conversion: the pattern or schema the author meant is a fact only the
// author holds, and a stored row is not re-judged until it is published again.
export const entry: SemanticMigration = {
  id: 'object-extension-validation-rule-artifacts-judged',
  surface:
    'a `format` validation rule whose `regex` does not compile, or a `json_schema` validation rule whose `schema` '
    + 'ajv cannot compile or that names an unregistered `format`, added by an `objectExtensions` entry '
    + '(`defineObjectExtension({ extend, validations })`, or an `object_extension` item published at runtime '
    + 'through Studio, `PUT /api/v1/meta/object_extension/TARGET` or the MCP and AI authoring doors), a nested '
    + '`then` / `otherwise` branch included, e.g. `{ extend: \'crm_account\', validations: [{ name: \'code_shape\', '
    + 'type: \'format\', field: \'code__c\', regex: \'([\', message: \'Bad code.\' }] }`.',
  replacement:
    'A rule the two checks accept on a declared rule of the same object: a `regex` that `new RegExp(...)` '
    + 'compiles (or a named `format` instead), and a `schema` that ajv compiles in the runtime\'s environment, '
    + 'naming only registered formats.',
  reason:
    'The registry merges an extension\'s rules onto the target, so every save of the target runs them, but a '
    + 'regex or schema the runtime cannot compile is logged and skipped on every write, and a misspelt format '
    + 'name is dropped: the rule protects nothing. The build and the door judged that on an object\'s own rules '
    + 'only. Each rule an extension adds is now judged by the same two checks, with the same rule ids '
    + '(`validation-rule-regex-uncompilable`, `validation-rule-json-schema-uncompilable`, '
    + '`validation-rule-json-schema-unknown-format`; at the door `422 INVALID_METADATA`), located at the entry: '
    + '`object \'TARGET\' · objectExtensions[N] · validation \'RULE\'`, key path '
    + '`objectExtensions[N].validations.RULE.regex` (or `.schema`), prefixed `packages[J].manifest.` in a built '
    + 'artifact, and `objectExtensions[0]` at the door, which judges the one entry it writes.',
  acceptanceCriteria:
    '`os build` reports none of the three rule ids located at an `objectExtensions[N] · validation` site, and '
    + 'publishing each extension that adds such a rule again answers 200 with no such issue. A value the rule '
    + 'should refuse is refused on save with the rule\'s message.',
};
