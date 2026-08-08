// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod, RateLimitConfigSchema } from '../shared/http.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

/**
 * API Mapping Schema
 * Transform input/output data.
 */
import { lazySchema } from '../shared/lazy-schema';
export const ApiMappingSchema = lazySchema(() => z.object({
  source: z.string().describe('Source field/path'),
  target: z.string().describe('Target field/path'),
  transform: z.string().optional().describe('Transformation function name — NOT EXECUTED in 17.x, and publish REJECTS the key: there is no transformation-function registry anywhere in the platform, so it stays in the frozen vocabulary and is refused rather than parsed and ignored (#5040 E7). A mapping entry moves and renames fields by dot path and nothing more — shape the value where it is produced instead (a flow endpoint whose flow computes it, or a formula field on the object)'),
}));
export type ApiMapping = z.input<typeof ApiMappingSchema>;

/**
 * API Endpoint Schema
 * Defines an external facing API contract.
 *
 * ## Registered kind: envelope DECLARED, unknown keys still STRIPPED (#5271)
 *
 * `api` became a REGISTERED metadata kind in #5271 (part of #5206), which puts
 * this schema under the two invariants every registered kind is held to
 * (`kernel/metadata-type-schemas.test.ts`). It satisfies one and is a measured
 * exception to the other — and the reason is worth stating, because "close it
 * like the other 23" is the obvious next edit and it does not work:
 *
 *  - **The ADR-0010 protection envelope IS declared** (the spread at the bottom
 *    of the shape). The artifact loader stamps `_packageId` / `_provenance` on
 *    every registered item (`applyProtection`), and undeclared they were
 *    dropped on every parse — protection metadata lost on round-trip.
 *
 *  - **Unknown keys are still stripped**, so `api` joins `view` on the #4001
 *    campaign's `STILL_STRIP` list. This schema is not only an authoring
 *    surface: it is also what STORED rows are parsed with, by
 *    `buildEndpointIndex` (`packages/metadata/src/endpoint-matcher.ts`) and by
 *    `gateApiItemsForPublish` (`MetadataManager.publishPackage`). A stored row
 *    carries the metadata layer's own bookkeeping — `packageId` and `state`,
 *    written by `MetadataManager.register` / `publishPackage` and read back by
 *    `publishPackage`'s own package filter — which are NOT endpoint vocabulary.
 *    Closing this shape was tried and measured: every stored row fails with
 *    `unrecognized_keys: ['packageId', 'state']`, so the load-time backstop
 *    excludes it (its route answers 404) and the publish gate reports a schema
 *    error instead of the D6 verdict it exists to give. Exactly `view`'s shape
 *    of exception — one type name worn by both an authored document and a wire
 *    row — and the fix is to separate the stored envelope from the body at the
 *    metadata layer, not to teach this vocabulary two bookkeeping keys.
 *
 * The cost of leaving it open is real and is filed rather than hidden: a
 * `cacheTTL` / `outputMappings` / `objectParam` typo parses green, publishes
 * green, and the endpoint then serves without the policy or projection its
 * author wrote.
 */
export const ApiEndpointSchema = z.object({
  /** Identity */
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique endpoint ID'),
  path: z.string().regex(/^\//).describe(
    'URL Path — must be inside this stack\'s endpoint carve-out: '
    + '`/api/v1/apps/<manifest.namespace>/<subpath>` with a non-empty subpath (ADR-0121 D1), '
    + 'e.g. `/api/v1/apps/crm/leads` for a stack whose `manifest.namespace` is `crm`. '
    + 'Only the subpath is yours to name; the namespace segment is derived from '
    + '`manifest.namespace` (ADR-0121 D2), never authored here. A path outside the carve-out '
    + 'is rejected at publish and would match NOTHING at runtime.',
  ),
  method: HttpMethod.describe('HTTP Method'),

  /** Documentation */
  summary: z.string().optional(),
  description: z.string().optional(),

  /** Execution Logic */
  type: z.enum(['flow', 'script', 'object_operation', 'proxy']).describe("Implementation type — only 'object_operation' and 'flow' EXECUTE in 17.x. 'script' and 'proxy' stay in the frozen vocabulary (#5040) and are rejected at publish, not parsed and ignored: express script logic as a flow whose script node runs your registered function, and an outbound call as a flow using a declared connector"),
  target: z.string().describe("Target Flow ID or Script Name or Proxy URL, per `type` — but only the Flow ID is reachable in 17.x, since publish rejects `type: 'script'` and `type: 'proxy'` (an `object_operation` endpoint is addressed by `objectParams.object` / `.operation`; neither the publish gate nor the executor reads `target` for that type)"),

  /** Logic Config */
  objectParams: z.object({
    object: z.string().optional(),
    operation: z.enum(['find', 'get', 'create', 'update', 'delete']).optional(),
  }).optional().describe('For object_operation type'),

  /** Data Transformation */
  inputMapping: z.array(ApiMappingSchema).optional().describe('Map Request Body to Internal Params'),
  outputMapping: z.array(ApiMappingSchema).optional().describe('Map Internal Result to Response Body'),

  /** Policies */
  authRequired: z.boolean().default(true).describe('Require authentication'),
  rateLimit: RateLimitConfigSchema.optional().describe('Rate limiting policy'),
  cacheTtl: z.number().optional().describe('Response cache TTL in seconds'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `api` is a registered metadata kind as of #5271, so the artifact loader
  // stamps these on every item; undeclared they were dropped on every parse.
  ...MetadataProtectionFields,
});

/**
 * The canonical form of an endpoint `path` — exactly ONE trailing slash
 * trimmed, never from a lone `/`.
 *
 * Declared here, with the vocabulary, because two independent consumers must
 * agree on it byte for byte or a declaration passes one and fails the other:
 *
 *  - the **matcher** (`packages/metadata/src/endpoint-matcher.ts`) normalizes
 *    both the stored declaration and the request path with it, so a request for
 *    `/x/` reaches an endpoint declared as `/x`;
 *  - the **publish gate** (#5040 E7) compares declarations with it to reject
 *    two endpoints in one stack claiming the same METHOD + path.
 *
 * Were the gate to normalize differently, a stack could publish two endpoints
 * the matcher then treats as one — and the loser would be dead metadata that
 * passed validation. Trimming ONE (not all) keeps `/x//` and `/x/` distinct,
 * matching how every router in this stack treats an empty path segment; keeping
 * a lone `/` whole means the normalized form is still a legal
 * `ApiEndpointSchema.path`. Nothing else happens: no percent-decoding, no
 * Unicode normalization, no case folding (an open vocabulary question, #5040
 * §7-5 — not something for an implementation to settle).
 */
export function normalizeEndpointPath(path: string): string {
  const raw = String(path ?? '');
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1);
  return raw;
}

export const ApiEndpoint = Object.assign(ApiEndpointSchema, {
  create: <T extends z.input<typeof ApiEndpointSchema>>(config: T) => config,
});

export type ApiEndpoint = z.input<typeof ApiEndpointSchema>;
/** Post-parse shape of {@link ApiEndpoint} — defaults applied, transforms run (ADR-0122). */
export type ApiEndpointParsed = z.infer<typeof ApiEndpointSchema>;
