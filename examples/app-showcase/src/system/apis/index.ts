// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ApiEndpoint } from '@objectstack/spec/api';

/**
 * Declarative API endpoints (`apis:`) — RESTORED and LIVE in v17 (#5040 E8).
 *
 * ## What these are
 *
 * The metadata-authored counterpart of the code-mounted endpoint in
 * `src/system/server/recalc-endpoint.ts`. The runtime matches a declared
 * `path` + `method` against the stored `api` items and executes the target
 * with NO handler code: `object_operation` delegates to the same `callData`
 * the built-in `/data` route uses, `flow` to the same automation pipeline
 * `POST /automation/<name>/trigger` uses. A declared endpoint is a stable URL
 * plus a policy layer over an existing pipeline — never a second execution
 * dialect (#5040 §4).
 *
 * ## Why they were commented out, and what changed
 *
 * #4936 measured this surface on a real boot and found it zero-execution end
 * to end: no route was mounted for a declared `path`, the request died at
 * Hono's `notFound`, and the dispatcher branch behind it called a
 * `matchEndpoint` no implementation in the repo ever provided. Every key was
 * declared ≠ enforced — `authRequired: true` included, a security semantic
 * that parsed green and gated nothing — so a non-empty `apis:` was refused
 * outright and these two definitions were preserved here, commented.
 *
 * #5040's E-series built the executor (mount seam, matcher, policy keys,
 * target delegation, mapping keys, OpenAPI enrichment) and E7 narrowed the
 * blanket refusal to per-endpoint publish gates. So the premise of the comment
 * is gone, and these come back **unchanged in intent** — same names, same
 * targets, same `authRequired`, same `cacheTtl` — with the ONE edit ADR-0121
 * D1 requires: the paths move under this app's namespace carve-out.
 *
 * ## The namespace carve-out (ADR-0121 D1/D2)
 *
 * A declared path must be `<runtime prefix>/apps/<manifest.namespace>/<subpath>`
 * — here `/api/v1/apps/showcase/…`, from the explicit `manifest.namespace:
 * 'showcase'` in `objectstack.config.ts`. That segment is what makes route
 * ownership structural rather than a list somebody maintains: no built-in
 * domain lives under `apps/`, and two packages can never collide because their
 * namespaces differ. Only the subpath is ours to name; publish rejects
 * anything outside the carve-out, and a stack that declares `apis:` without an
 * explicit `manifest.namespace` is rejected too (there is deliberately no
 * derivation from `manifest.id` — an outward URL contract must not move
 * because a package id was rewritten).
 *
 * ## `authRequired` is deliberate here, not incidental
 *
 * Both endpoints are session-gated. `authRequired` DEFAULTS to `true`, so the
 * explicit `true` below is documentation rather than protection — but it is
 * the key whose historical value matters most: an explicit `false` is the only
 * thing that opens an anonymous execution entry point, and ADR-0121 D6 then
 * requires it to carry an ARMED `rateLimit` (`enabled: true`; the key defaults
 * to `false`, so a budget written without it meters nothing). Neither of these
 * endpoints was ever anonymous, and restoring them did not make one anonymous:
 * an example must not demo an anonymous surface it never had.
 *
 * Proven end to end, on a real boot, by
 * `packages/qa/dogfood/test/showcase-declarative-endpoints.dogfood.test.ts`.
 */

/** Read-only data projection: GET a filtered task list through a stable URL. */
export const TaskFeedEndpoint: ApiEndpoint = {
  name: 'showcase_task_feed',
  // ADR-0121 D1: was `/api/v1/showcase/tasks` before #4936; the namespace
  // segment is the only change this restoration makes to the declaration.
  path: '/api/v1/apps/showcase/tasks',
  method: 'GET',
  summary: 'Task feed',
  description: 'Returns tasks via a declarative object_operation endpoint — no handler code.',
  type: 'object_operation',
  // No `target`: an object_operation endpoint is addressed by `objectParams`
  // alone — nothing reads `target` for this type, and #10338 made the key
  // optional so an example stops teaching a dead string (`target` is required
  // at publish only for `type: 'flow'`, as InquiryPurgeEndpoint below shows).
  objectParams: {
    object: 'showcase_task',
    operation: 'find',
  },
  authRequired: true,
  // Seconds. Emitted as `Cache-Control: private, max-age=30` on a SUCCESSFUL
  // answer only — never on a 401/429/5xx, because telling a client to reuse a
  // failure for half a minute is worse than saying nothing. `private` is not
  // this example's tuning choice: the runtime emits it for every positive
  // ttl, on `authRequired: false` endpoints too, because any answer can be
  // RLS-trimmed for its caller and a shared cache must never store one and
  // hand it to somebody else. `computeCacheControl` in
  // `packages/runtime/src/endpoint-policy.ts` states that rule and the rest of
  // the ladder with it — including `cacheTtl: 0`, which is `no-store` rather
  // than "no header": writing 0 says something, and saying nothing is spelled
  // by omitting the key. GET-only by rule: publish rejects `cacheTtl` on any
  // other method rather than parsing it and ignoring it.
  cacheTtl: 30,
};

/** Flow-typed endpoint: POST triggers the janitor flow (get+delete demo). */
export const InquiryPurgeEndpoint: ApiEndpoint = {
  name: 'showcase_inquiry_purge_api',
  path: '/api/v1/apps/showcase/inquiries/purge',
  method: 'POST',
  summary: 'Purge closed inquiries',
  description: 'Invokes the showcase_inquiry_purge flow (get_record + delete_record janitor) over HTTP.',
  type: 'flow',
  target: 'showcase_inquiry_purge',
  authRequired: true,
};

export const allApis: ApiEndpoint[] = [TaskFeedEndpoint, InquiryPurgeEndpoint];
