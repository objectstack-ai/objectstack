// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'memory-persistence-placeholder-refused',
  surface: 'memory driver config `persistence.path` (file persistence and the `auto` ' +
    'override) and `persistence.key` (localStorage and the `auto` override) — values ' +
    'containing `${…}` placeholder syntax',
  replacement: 'the literal path or key. For environment-specific destinations, leave the ' +
    'key unset and let the shared datasource factory scope the default per datasource, or ' +
    'compute the config value in code before it enters `defineStack`',
  reason:
    'The unresolved-placeholder defect one surface over from the datasource connection keys, ' +
    'where it is already refused: a `${…}` placeholder in memory persistence config ' +
    'is resolved by NOTHING — the driver would create and write a literal `./${DATA_DIR}/…` ' +
    'path, or write under the literal placeholder-bearing localStorage key, so the dump ' +
    'lands in a wrongly-named location with no error naming the unresolved placeholder ' +
    '(authored under the same false belief the 2026-08-13 ruling closes: placeholder syntax ' +
    'in connection-material keys is refused at publish, because nothing resolves it). These ' +
    'two keys ' +
    'are config-material like the connection keys, so the parent adjudication applies with ' +
    'its reason intact; the memory driver\'s `initialData` stays deliberately UNJUDGED — it ' +
    'carries arbitrary record values, where a literal `${…}` may be legitimate data. There ' +
    'is no mechanical rewrite: the placeholder names a value that exists only in the ' +
    'author\'s intended deployment environment, which a source-file transform cannot know.',
  acceptanceCriteria:
    'Every memory datasource parses with no `${…}` span in `persistence.path` or ' +
    '`persistence.key`; `initialData` record values containing literal `${…}` keep parsing ' +
    'byte-identically.',
};
