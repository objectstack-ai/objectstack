// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { AnalyticsQuerySchema, CubeSchema } from '../data/analytics.zod';
import { BaseResponseSchema } from './contract.zod';
import { retiredKey } from '../shared/retired-key';

/**
 * Analytics API Protocol
 * 
 * Defines the HTTP interface for the Semantic Layer.
 * Provides endpoints for executing analytical queries and discovering metadata.
 */

// ==========================================
// 1. API Endpoints
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
export const AnalyticsEndpoint = z.enum([
  '/api/v1/analytics/query', // Execute analysis
  '/api/v1/analytics/meta',  // Discover cubes/metrics
  '/api/v1/analytics/sql',   // Dry-run SQL generation
]);

// ==========================================
// 2. Query Execution
// ==========================================

/**
 * Query Request Body — the BARE `AnalyticsQuery` shape (#3878).
 *
 * The body IS the `AnalyticsQuery`: `cube` + `measures` at the top level with
 * the optional `dimensions` / `where` / `timeDimensions` / `order` / `limit` /
 * `offset` / `timezone` fields beside them. This is what
 * `AnalyticsService.query` (the domain's one implementation,
 * `@objectstack/service-analytics`) consumes and what every real caller
 * (objectui dashboards, `client.analytics.query`) sends.
 *
 * History: this schema used to describe a `{ cube, query: {...}, format }`
 * ENVELOPE — the dialect of the retired degraded shim (#3891), which the real
 * engine never understood (an envelope body inferred a column-less cube and
 * died as an SQL syntax error instead of a shape error). The envelope is
 * rejected now — `.strict()` — and the dispatcher's `/analytics` entry answers
 * 400 with a migration hint. The unimplemented `format` field went with it
 * (declared ≠ enforced: every response is the JSON envelope).
 */
export const AnalyticsQueryRequestSchema = lazySchema(() =>
  AnalyticsQuerySchema.extend({
    cube: z.string().describe('Target cube name'),
    query: retiredKey(
      '`query` was removed from AnalyticsQueryRequest in @objectstack/spec 17.0.0 (#3878). ' +
      'The { cube, query: {...} } envelope was the dialect of the retired degraded analytics shim (#3891) — ' +
      'the real engine never understood it. Move the query.* fields to the body top level: ' +
      '{ cube, measures, dimensions?, where?, timeDimensions?, order?, limit?, offset?, timezone? }.',
    ),
    format: retiredKey(
      '`format` was removed from AnalyticsQueryRequest in @objectstack/spec 17.0.0 (#3878). ' +
      'It was never implemented — every response is the JSON envelope. Delete the key; ' +
      'for CSV/XLSX use the export surface instead.',
    ),
  }).strict()
);

/**
 * Query Response (JSON)
 */
export const AnalyticsResultResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).describe('Result rows'),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string(),
    })).describe('Column metadata'),
    sql: z.string().optional().describe('Executed SQL (if debug enabled)'),
  }),
}));

// ==========================================
// 3. Metadata Discovery
// ==========================================

/**
 * Meta Request
 */
export const GetAnalyticsMetaRequestSchema = lazySchema(() => z.object({
  cube: z.string().optional().describe('Optional cube name to filter'),
}));

/**
 * Meta Response
 * Returns available cubes, metrics, and dimensions.
 */
export const AnalyticsMetadataResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    cubes: z.array(CubeSchema).describe('Available cubes'),
  }),
}));

// ==========================================
// 4. SQL Dry-Run
// ==========================================

export const AnalyticsSqlResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    sql: z.string(),
    params: z.array(z.unknown()),
  }),
}));

export type AnalyticsEndpoint = z.infer<typeof AnalyticsEndpoint>;
export type AnalyticsQueryRequest = z.infer<typeof AnalyticsQueryRequestSchema>;
export type AnalyticsMetadataResponse = z.infer<typeof AnalyticsMetadataResponseSchema>;
/** Post-parse shape of {@link AnalyticsMetadataResponse} — defaults applied, transforms run (ADR-0122). */
export type AnalyticsMetadataResponseParsed = z.infer<typeof AnalyticsMetadataResponseSchema>;
export type AnalyticsSqlResponse = z.infer<typeof AnalyticsSqlResponseSchema>;
/** Post-parse shape of {@link AnalyticsSqlResponse} — defaults applied, transforms run (ADR-0122). */
export type AnalyticsSqlResponseParsed = z.infer<typeof AnalyticsSqlResponseSchema>;
