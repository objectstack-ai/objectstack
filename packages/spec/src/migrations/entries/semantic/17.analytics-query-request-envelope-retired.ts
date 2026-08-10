// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'analytics-query-request-envelope-retired',
  surface: 'api.analyticsQueryRequest.query',
  replacement: 'bare AnalyticsQuery body (top-level cube/measures/dimensions/where/...)',
  reason:
    'The { cube, query: {...} } envelope was an HTTP-wire dialect of the retired degraded ' +
    'analytics shim (#3891), never stored in stack metadata — there is no source for the ' +
    'chain to rewrite. Callers of POST /analytics/query and /analytics/sql must move the ' +
    'query.* fields to the body top level themselves.',
  acceptanceCriteria:
    'Every /analytics/query and /analytics/sql call sends the bare AnalyticsQuery shape and ' +
    'succeeds; no request answers 400 VALIDATION_FAILED with the envelope prescription.',
};
