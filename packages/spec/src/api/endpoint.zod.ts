// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { HttpMethod, RateLimitConfigSchema } from '../shared/http.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { strictObject } from '../shared/strict-object';

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
 * One prescription for every key of the metadata layer's STORED envelope.
 *
 * These are written by `MetadataManager.register` / `publishPackage` onto the
 * stored ROW, never onto an authored declaration, and #5309 (PR #6576) made
 * that separation explicit: `peelStoredEnvelope` takes them off before the body
 * reaches this schema. So an author who meets this message wrote one by hand
 * into a declaration — where it has never configured anything.
 *
 * Kept in sync by name with `STORED_ENVELOPE_KEYS`
 * (`packages/metadata/src/stored-envelope.ts`). `packages/spec` holds no
 * business logic and must not import from the metadata layer (Prime Directive
 * #2), so the two lists are pinned equal from the metadata side
 * (`stored-envelope.test.ts`) rather than shared as a value.
 */
const STORED_BOOKKEEPING_GUIDANCE =
  'This is the metadata layer\'s own storage bookkeeping, not endpoint vocabulary. It is written onto '
  + 'the stored ROW by `register` / `publishPackage` and peeled off before this schema sees a body '
  + '(#5309), so writing it on a declaration configures nothing. Remove it — publication state is '
  + 'managed by `objectstack publish`, not authored.';

/**
 * API Endpoint Schema
 * Defines an external facing API contract.
 *
 * ## Registered kind, CLOSED — and the ORDER it closed in is the record (#5384)
 *
 * `api` became a REGISTERED metadata kind in #5271 (part of #5206), which puts
 * this schema under the two invariants every registered kind is held to
 * (`kernel/metadata-type-schemas.test.ts`). It now satisfies both, and it took
 * two steps in a deliberate order — kept here because a later sweep meeting a
 * "cannot close, it parses stored rows" verdict elsewhere needs the refusal's
 * reasoning, not just the result.
 *
 *  - **The ADR-0010 protection envelope IS declared** (the spread at the bottom
 *    of the shape, #5271). The artifact loader stamps `_packageId` /
 *    `_provenance` on every registered item (`applyProtection`), and undeclared
 *    they were dropped on every parse — protection metadata lost on round-trip.
 *
 *  - **Unknown keys are REJECTED as of #5384.** Until then `api` sat beside
 *    `view` on the #4001 campaign's `STILL_STRIP` list, and the blocker was not
 *    this vocabulary: this schema is also what STORED rows were parsed with, by
 *    `buildEndpointIndex` (`packages/metadata/src/endpoint-matcher.ts`) and by
 *    `gateApiItemsForPublish` (`MetadataManager.publishPackage`). A stored row
 *    carries the metadata layer's own bookkeeping — `packageId`, `state`,
 *    `version`, `published*` — which is NOT endpoint vocabulary. Closing the
 *    shape was tried and MEASURED at that point: every stored row failed with
 *    `unrecognized_keys: ['packageId', 'state']`, the load-time backstop
 *    excluded the endpoint (its route answered 404) and the publish gate
 *    reported a schema error in place of the ADR-0121 D6 verdict it exists to
 *    give — 11 tests in `packages/metadata` red. So the fix was made where the
 *    defect was: **#5309 / PR #6576 peeled the stored envelope off before the
 *    body parse** (`peelStoredEnvelope`, `packages/metadata/src/stored-envelope.ts`),
 *    which left exactly ONE red under a strict probe and made this closure a
 *    vocabulary change rather than a storage-layer compromise. Teaching this
 *    schema two bookkeeping keys to buy strictness would have made the
 *    authoring contract describe the storage layer — the trade this campaign
 *    refuses.
 *
 * What the strip was costing, now that it is gone: a `cacheTTL` /
 * `outputMappings` / `objectParam` typo parsed green, published green, and the
 * endpoint then served without the policy or projection its author wrote. That
 * direction is fail-safe for `authRequired` alone (an unrecognized spelling
 * left the default `true` standing); it was never fail-safe for the mapping,
 * cache and rate-limit blocks, and AI-authored endpoint declarations are
 * exactly where that class of typo is produced in bulk.
 *
 * ## Author state vs parsed state (#5227)
 *
 * `authRequired` is `.default(true)`, so the two shapes of this schema differ
 * and both are named, per ADR-0122: **`ApiEndpoint` is the AUTHOR state** —
 * omitting `authRequired` is expressible and is the SAFE spelling the protocol
 * upgrade guide prescribes — while `ApiEndpointParsed` is the post-parse shape
 * where the default has been materialized and the key is required. An author
 * writing `const e: ApiEndpoint = { … }` can leave the key out; a consumer
 * holding `ApiEndpointSchema.parse(...)` gets `ApiEndpointParsed`. Do NOT add
 * an `ApiEndpointInput` alias: after ADR-0122 phase 2 it would denote exactly
 * what `ApiEndpoint` denotes, which D3 forbids and `check:spec-parsed-alias`
 * rule 4 rejects.
 */
export const ApiEndpointSchema = strictObject({
  surface: 'this API endpoint',
  history:
    'Until #5384 closed this shape these were dropped silently — the endpoint still published and '
    + 'served, minus whatever the key was meant to configure (a `cacheTTL` / `objectParam` typo cost '
    + 'the whole policy or projection, with `os validate` green).',
  aliases: {
    // Policy block — the highest-consequence misses on this surface.
    auth: 'authRequired', authentication: 'authRequired', requiresAuth: 'authRequired',
    cacheTTL: 'cacheTtl', ttl: 'cacheTtl', cache: 'cacheTtl',
    rateLimiting: 'rateLimit', throttle: 'rateLimit',
    // Identity / routing.
    id: 'name', url: 'path', route: 'path', endpoint: 'path', uri: 'path',
    verb: 'method', httpMethod: 'method',
    // Execution + projection.
    handler: 'target', objectParam: 'objectParams',
    inputMappings: 'inputMapping', outputMappings: 'outputMapping',
    requestMapping: 'inputMapping', responseMapping: 'outputMapping',
    title: 'summary',
  },
  guidance: {
    // [#5384] The wrong-layer pointer this closure exists to give. ADR-0121 D2:
    // the namespace segment of a declared `path` is DERIVED from the stack's
    // `manifest.namespace` and is never authored on the endpoint. A `namespace`
    // key here parsed green and gated nothing, while the publish gate went on
    // reading the manifest — so an author who "fixed" a namespace mismatch here
    // changed nothing at all. `publish-endpoint-gate.test.ts` pins that the gate
    // does not believe this key; it is now refused by name before the gate runs.
    namespace:
      '`namespace` is not an endpoint key. Under ADR-0121 D2 the namespace segment of `path` comes '
      + "from the stack's `manifest.namespace` and has no per-endpoint override — declare it there. "
      + 'Only the subpath of `/api/v1/apps/<manifest.namespace>/<subpath>` is yours to name here.',
    // [#5309 / PR #6576] The metadata layer's own storage bookkeeping. These
    // reach this schema on the STORED-row paths and are peeled by
    // `peelStoredEnvelope` before the body parse, so meeting one here means it
    // was hand-authored into a declaration — where it configures nothing.
    //
    // ⚠️ All SEVEN of `STORED_ENVELOPE_KEYS`, and the completeness is pinned
    // rather than eyeballed: `stored-envelope.test.ts` walks that exported list
    // and asserts each key gets this prescription. The first run of that pin
    // caught `package` missing from this table — the drift is silent in the
    // direction that matters (a key peeled correctly on the stored paths, so
    // every other test stays green, while a hand-authoring author gets the
    // generic "unrecognized key" instead of the upgrade).
    package: STORED_BOOKKEEPING_GUIDANCE,
    packageId: STORED_BOOKKEEPING_GUIDANCE,
    state: STORED_BOOKKEEPING_GUIDANCE,
    version: STORED_BOOKKEEPING_GUIDANCE,
    publishedAt: STORED_BOOKKEEPING_GUIDANCE,
    publishedBy: STORED_BOOKKEEPING_GUIDANCE,
    publishedDefinition: STORED_BOOKKEEPING_GUIDANCE,
  },
}, {
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
  // Load-bearing twice over since #5384: with the shape closed, an undeclared
  // protection key would now be REJECTED rather than dropped, so the spread is
  // what keeps a loader-stamped item parsing at all.
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
