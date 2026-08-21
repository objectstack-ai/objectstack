// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { AnalyticsQuerySchema } from '../data/analytics.zod';
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
 * A measure or dimension as `GET /analytics/meta` publishes it — the discovery
 * projection, not the authoring definition.
 *
 * `name` is CUBE-QUALIFIED (`"<cube>.<key>"`), which is the form
 * `/analytics/query` expects back in `measures[]` / `dimensions[]`; the
 * unqualified key it was defined under is not published. `title` carries the
 * definition's `label`, so it is the display name a dashboard renders.
 *
 * Deliberately narrower than the authoring definitions (`MetricSchema` /
 * `DimensionSchema` in `data/analytics.zod.ts`): `sql`, `description`,
 * `granularities` and `format` are dropped by the projection and are NOT
 * reachable through this endpoint (#6442). (`filters` used to head this list;
 * #10414 removed it from the authoring definition itself.)
 *
 * Module-local, and NOT exported as its own named schema: `CubeMeta` in
 * `contracts/analytics-service.ts` is already THE name for this shape, so a
 * second exported name would be the permanent synonym ADR-0122 D3 forbids AND a
 * new dual-source export. `analytics.test.ts` binds the two at compile time.
 */
const cubeMetaMemberShape = () => z.object({
  name: z.string().describe('Cube-qualified member name, `"<cube>.<key>"` — the spelling `/analytics/query` accepts'),
  type: z.string().describe(
    'Aggregation type for a measure (`AggregationMetricType`) or data type for a '
    + 'dimension (`DimensionType`). Declared as a string rather than either enum '
    + 'because the projection copies the value through verbatim and this one '
    + 'shape serves both member kinds.',
  ),
  title: z.string().optional().describe('Display label, projected from the definition\'s `label`'),
});

/**
 * Meta Response
 *
 * Describes the body `GET /api/v1/analytics/meta` actually returns: `data` is a
 * BARE ARRAY of the `CubeMeta` discovery projection — not `{ cubes: Cube[] }`
 * (#6442, ruled by the maintainer 2026-08-08 as "narrow the declaration").
 *
 * The previous declaration described a shape the endpoint has never served, in
 * either implementation: `AnalyticsService.getMeta`
 * (`service-analytics/src/analytics-service.ts`) and its `driver-memory` twin
 * (`memory-analytics.ts`) both answer `Promise< CubeMeta[] >`, and
 * `runtime/src/domains/analytics.ts` hands that array to `success()` verbatim,
 * so it lands directly under `data`. A client written against the old
 * declaration read `data.cubes` and got `undefined`; a client that validated a
 * live response against this schema failed outright. `packages/spec` stated
 * both shapes itself — the TS contract
 * (`contracts/analytics-service.ts`, `getMeta(): Promise< CubeMeta[] >`) already
 * agreed with the runtime, and this schema was the lone outlier.
 *
 * Zero runtime change: the wire body is untouched, only its declaration moves.
 *
 * **Return path if more keys are ever needed** (recorded with the ruling): add
 * the key to the projection above — additive and backwards compatible. ⛔ Do NOT
 * widen this endpoint back to full `CubeSchema` definitions: that would publish
 * each cube's `sql` to every client, a capability expansion with no measured
 * consumer pulling it.
 */
export const AnalyticsMetadataResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.array(z.object({
    name: z.string().describe('Cube name'),
    title: z.string().optional().describe('Human-readable cube title'),
    measures: z.array(cubeMetaMemberShape()).describe('Measures this cube accepts in `/analytics/query`'),
    dimensions: z.array(cubeMetaMemberShape()).describe('Dimensions this cube accepts in `/analytics/query`'),
  })).describe(
    'Available cubes, each as the `CubeMeta` discovery projection — the cube name, '
    + 'its title, and the measures/dimensions a client may name in a query. A bare '
    + 'array: there is no `cubes` wrapper object, and no cube `sql` is published.',
  ),
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

export type AnalyticsEndpoint = z.input<typeof AnalyticsEndpoint>;
export type AnalyticsQueryRequest = z.input<typeof AnalyticsQueryRequestSchema>;
export type AnalyticsMetadataResponse = z.input<typeof AnalyticsMetadataResponseSchema>;
/** Post-parse shape of {@link AnalyticsMetadataResponse} — defaults applied, transforms run (ADR-0122). */
export type AnalyticsMetadataResponseParsed = z.infer<typeof AnalyticsMetadataResponseSchema>;
export type AnalyticsSqlResponse = z.input<typeof AnalyticsSqlResponseSchema>;
/** Post-parse shape of {@link AnalyticsSqlResponse} — defaults applied, transforms run (ADR-0122). */
export type AnalyticsSqlResponseParsed = z.infer<typeof AnalyticsSqlResponseSchema>;
export type GetAnalyticsMetaRequest = z.input<typeof GetAnalyticsMetaRequestSchema>;
