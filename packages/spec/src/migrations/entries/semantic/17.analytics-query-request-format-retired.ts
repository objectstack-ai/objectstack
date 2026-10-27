// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'analytics-query-request-format-retired',
  surface: 'api.analyticsQueryRequest.format',
  replacement: '(removed — responses are always the JSON envelope; use the export surface for CSV/XLSX)',
  reason:
    'The `format` key was declared but never implemented (declared ≠ enforced): every ' +
    'response is the JSON envelope regardless of the requested value, so there is no ' +
    'behaviour to preserve and nothing stored to rewrite.',
  acceptanceCriteria:
    'No /analytics/query or /analytics/sql call sends `format`; exports go through the ' +
    'export surface.',
};
