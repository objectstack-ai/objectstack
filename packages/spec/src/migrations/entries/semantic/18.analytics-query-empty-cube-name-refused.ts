// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The request body of the two analytics query doors admitted an empty cube
// name as "a string" and let the engine answer it with a 500. No D2
// conversion: nothing written can be rewritten into the cube the author meant.
export const entry: SemanticMigration = {
  id: 'analytics-query-empty-cube-name-refused',
  surface:
    'AnalyticsQueryRequestSchema.cube (the body of POST /analytics/query and POST /analytics/sql), '
    + 'sent as the EMPTY string',
  replacement:
    'name the cube to query (`cube: \'orders\'`): a cube `GET /analytics/meta` lists, or a registered '
    + 'object name, which is read as an auto-inferred cube. ⛔ There is no replacement that can be '
    + 'derived from what was written: an empty string names no cube, so the platform must not pick '
    + 'one for the caller.',
  reason:
    'A request body names its cube or it names nothing the engine can serve. Measured against the '
    + 'published @objectstack/spec 18.2.0: POST /api/v1/analytics/query and POST /api/v1/analytics/sql '
    + 'with cube: "" passed the body schema (cube was z.string()) and reached the engine, whose own '
    + 'guard threw a plain Error, which the door mapped to 500 INTERNAL_ERROR — a client input mistake '
    + 'that read as a server fault, paged operators and got retried, while the same body with cube left '
    + 'out answered 400. The schema now refuses the empty string (minLength 1) with one prescriptive '
    + 'sentence ("Name the cube to query …"), 400 VALIDATION_FAILED with a fields[] entry at cube, and '
    + 'the engine is never reached. In the same release the engine\'s in-process guard '
    + '(AnalyticsService.query and generateSql in @objectstack/service-analytics) throws the same typed '
    + 'refusal — code VALIDATION_FAILED, status 400, the schema\'s own sentence — for an absent or '
    + 'empty cube, so a plugin, flow or test that holds the service reads the same answer the door '
    + 'gives. Nothing is stored: a cube name travels in a request, never in stack metadata, so there is '
    + 'no row to rewrite and no D2 conversion — one semantic TODO for API callers. A whitespace-only '
    + 'name is unchanged: it is a name no cube carries and keeps its 404 CUBE_NOT_FOUND. ADR-0087.',
  acceptanceCriteria:
    'Search every caller of POST /analytics/query and POST /analytics/sql (dashboard widgets, '
    + 'client.analytics.query / generateSql, scripts) and every in-process AnalyticsService.query / '
    + 'generateSql call for a cube built from a value that can be empty — an unset selection, a blank '
    + 'form field, a missing config key. Name the cube, or refuse to send the query until one is '
    + 'chosen. The sweep is mechanical at the door: AnalyticsQueryRequestSchema.safeParse answers one '
    + 'issue at the cube path reading "Name the cube to query", and the HTTP doors answer 400 '
    + 'VALIDATION_FAILED with fields[0].field === "cube" and the engine not called. A non-empty cube '
    + 'parses unchanged, and a missing cube keeps the 400 it already had. The repository carried no '
    + 'caller sending an empty cube at the time of the change.',
};
