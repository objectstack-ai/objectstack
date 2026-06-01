// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Public schema subpath: `@objectstack/plugin-webhooks/schema`.
 *
 * Thin re-export barrel kept stable across refactors. The object definition
 * lives in `sys-webhook.object.ts` (matching the `*.object.ts` convention used
 * everywhere else in the monorepo for `sys_*` schemas).
 *
 * `sys_webhook` moved here from `@objectstack/platform-objects` per ADR-0029
 * (K2.a) so this plugin owns its configuration object. Delivery telemetry is no
 * longer a webhook-owned object: post-ADR-0018 M3 deliveries are rows in the
 * shared `sys_http_delivery` outbox owned by `@objectstack/service-messaging`.
 *
 * Note: callers that just need the runtime should import from the package root
 * (`@objectstack/plugin-webhooks`), which auto-registers `sys_webhook` via the
 * plugin manifest. This subpath exists for read-only inspection from a
 * different runtime.
 */

export { SysWebhook } from './sys-webhook.object.js';
