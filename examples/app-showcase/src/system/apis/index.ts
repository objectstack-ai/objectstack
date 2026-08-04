// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ApiEndpoint } from '@objectstack/spec/api';

/**
 * Declarative API endpoints (`apis:`) — SUSPENDED in v17 (#4936).
 *
 * ## Why this file is empty
 *
 * The showcase used to declare the two endpoints preserved below, and the
 * metadata side worked perfectly: `defineStack({ apis })` loaded them, and
 * `GET /api/v1/meta/api` returned both with every key intact. The EXECUTION
 * side was zero-hit. On a real boot (showcase, 47 plugins) the declared paths
 * answered a bare `404 {"error":"Not found"}` — not even the dispatcher's
 * semantic 404, because no route was ever mounted for them and the request
 * died at Hono's `notFound`. Behind that, the dispatcher's `handleApiEndpoint`
 * branch called a `matchEndpoint` method that no implementation in the repo
 * ever provided, so it could not have executed anything even if reached.
 *
 * Every key was therefore declared ≠ enforced — `authRequired: true` included,
 * which parsed green while gating nothing at all. Per the maintainer verdict
 * (2026-08-04, #4936) a non-empty `apis:` is now REJECTED at publish/validate
 * with a prescription, so these definitions are commented out rather than
 * shipped: an example must never demo a capability the runtime does not
 * deliver (Prime Directive #10).
 *
 * ## What replaces it today
 *
 * A code-mounted endpoint — see `src/system/server/recalc-endpoint.ts`. That
 * is the honest path until the executor lands.
 *
 * ## Restoring these
 *
 * The `ApiEndpoint` vocabulary is deliberately KEPT: the verdict rejected
 * retiring it, because endpoint shapes are an industry-stable form that would
 * only be re-introduced identically later. When the executor ships (#5040 —
 * mounting + endpoint matching + per-key wiring), the rejection is replaced by
 * real execution and these two come back. They are kept verbatim for that.
 *
 * ⚠️ ONE edit is required when restoring them, and it is not cosmetic:
 * ADR-0121 D1 (accepted 2026-08-04, after these were commented out) namespaces
 * endpoint paths as `<runtime-prefix>/apps/<namespace>/<subpath>`, so that an
 * app can only claim its own namespace and can never collide with a built-in
 * domain or another installed package. The `path` values below predate that
 * rule and would be rejected under it. Per that ADR they return as
 * `/api/v1/apps/showcase/tasks` and `/api/v1/apps/showcase/inquiries/purge`
 * (its §D1 names them explicitly, restored by #5040 E8).
 */

// /** Read-only data projection: GET a filtered task list through a stable URL. */
// export const TaskFeedEndpoint: ApiEndpoint = {
//   name: 'showcase_task_feed',
//   path: '/api/v1/showcase/tasks',
//   method: 'GET',
//   summary: 'Task feed',
//   description: 'Returns tasks via a declarative object_operation endpoint — no handler code.',
//   type: 'object_operation',
//   target: 'showcase_task',
//   objectParams: {
//     object: 'showcase_task',
//     operation: 'find',
//   },
//   authRequired: true,
//   cacheTtl: 30,
// };
//
// /** Flow-typed endpoint: POST triggers the janitor flow (get+delete demo). */
// export const InquiryPurgeEndpoint: ApiEndpoint = {
//   name: 'showcase_inquiry_purge_api',
//   path: '/api/v1/showcase/inquiries/purge',
//   method: 'POST',
//   summary: 'Purge closed inquiries',
//   description: 'Invokes the showcase_inquiry_purge flow (get_record + delete_record janitor) over HTTP.',
//   type: 'flow',
//   target: 'showcase_inquiry_purge',
//   authRequired: true,
// };

/**
 * Empty on purpose (#4936). An empty array and an absent key are both still
 * accepted — only a NON-EMPTY `apis:` is rejected — so the stack keeps
 * exercising the accepted shape rather than dropping the wiring entirely.
 */
export const allApis: ApiEndpoint[] = [];
