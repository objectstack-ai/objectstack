// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'enhanced-api-error-field-errors-renamed',
  surface: 'api.enhancedApiError.fieldErrors',
  replacement: 'fields',
  reason:
    'The wire has always carried `fields` — the validators, import coercion, ' +
    'validation-failure.ts, @objectstack/client and the console\'s field-error extractor ' +
    'all say `fields`, and nothing ever emitted `fieldErrors`, so a reader keying on it ' +
    'was reading a field no server sent (ADR-0078\'s silently-inert declaration, on the ' +
    'error envelope). This is a RESPONSE surface: no stack, example or template carries ' +
    'the key, so there is no source for the chain to rewrite — the schema tombstones it ' +
    'via retiredKey() and consumers move their read themselves. ADR-0114 D4, #3977.',
  acceptanceCriteria:
    'No consumer reads `error.fieldErrors`; per-field validation detail is read from ' +
    '`error.fields`, and constructing an EnhancedApiError with `fieldErrors` fails to parse ' +
    'with the rename prescription instead of silently losing the array.',
};
