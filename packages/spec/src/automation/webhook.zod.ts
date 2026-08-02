// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

/**
 * Webhook Trigger Event
 * When should this webhook fire?
 *
 * These mirror the record events the engine actually emits
 * (`data.record.created` / `updated` / `deleted`), which the webhook
 * auto-enqueuer maps to `create` / `update` / `delete`. Only events with a real
 * producer are declared here — an author can't subscribe to something that
 * never fires.
 *
 * **Bulk triggers (#4639).** `bulk_update` / `bulk_delete` map to the engine's
 * aggregate `data.records.updated` / `data.records.deleted`, emitted when a
 * predicate write (`multi: true` → `IDataDriver.updateMany`/`deleteMany`)
 * affects a set of rows the driver reports only as a count. They are separate
 * trigger values, not extra sources for `update` / `delete`, because their
 * delivery has a different SHAPE: no `recordId`, no record body, just
 * `object` + `matched`. Folding them into the per-record triggers would send
 * every existing subscriber a body missing the fields it reads — the same
 * class of breakage as the pre-#4626 `recordId: ''` fabrication, arriving from
 * the other direction. A webhook that wants both subscribes to both.
 *
 * Deliberately NOT triggers (#3196):
 * - `undelete` — there is no soft-delete / restore capability in the engine
 *   (`delete` is a hard delete; no `deleted_at` convention, no restore
 *   operation, no `data.record.undeleted` emit), so it had no event source.
 *   Reintroduce it only alongside a real restore subsystem that emits an
 *   undelete event.
 * - `api` (manual/programmatic fire) — no manual fire path exists (the only
 *   webhook HTTP surface re-queues already-failed deliveries). Reintroduce it
 *   with a real "fire this webhook now" endpoint/service, not as a bare enum
 *   value that silently never fires.
 */
import { lazySchema } from '../shared/lazy-schema';
export const WebhookTriggerType = z.enum([
  'create',
  'update',
  'delete',
  'bulk_update',
  'bulk_delete',
]);

export type WebhookTriggerType = z.infer<typeof WebhookTriggerType>;

/**
 * CANONICAL WEBHOOK DEFINITION
 *
 * This is the single source of truth for webhook configuration across ObjectStack.
 * All other protocols (workflow, connector, etc.) should import and reference this schema.
 *
 * Webhook Protocol - Outbound HTTP Integration
 * Push data to external URLs when events occur in the system.
 *
 * **RUNTIME MATERIALIZATION (#3461):**
 * A webhook authored on a stack (`defineStack({ webhooks })`) is not dispatched
 * directly from this envelope. On boot, `@objectstack/plugin-webhooks`
 * materializes each declared webhook into a `sys_webhook` data row (mapping
 * `object → object_name`, `isActive → active`, and stashing the full envelope
 * in `definition_json`); the auto-enqueuer dispatches off those rows. Declared
 * webhooks re-seed every boot as `managed_by: 'package'`, but a row an admin has
 * edited in Setup (`customized: true`) is never clobbered — a deactivated noisy
 * webhook survives redeploys. Authoring `webhooks:` is therefore live, not a
 * no-op. (Connector `webhooks` remain NOT-yet-enforced — see #3197.)
 *
 * **NAMING CONVENTION:**
 * Webhook names are machine identifiers and must be lowercase snake_case.
 * 
 * @example Good webhook names
 * - 'stripe_payment_sync'
 * - 'slack_notification'
 * - 'crm_lead_export'
 * 
 * @example Bad webhook names (will be rejected)
 * - 'StripePaymentSync' (PascalCase)
 * - 'slackNotification' (camelCase)
 * 
 * @example Basic webhook configuration
 * ```typescript
 * const webhook: Webhook = {
 *   name: 'slack_notification',
 *   label: 'Slack Order Notification',
 *   object: 'order',
 *   triggers: ['create', 'update'],
 *   url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX',
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   secret: process.env.WEBHOOK_SIGNING_SECRET,
 * }
 * ```
 *
 * #3494: the aspirational props `body`, `payloadFields`, `includeSession`,
 * `authentication` and `tags` were removed — the delivery path always sends its
 * own fixed envelope, only HMAC signing via `secret` is applied, and none of
 * them had a sink anywhere (liveness audit #1878/#1893). `retryPolicy` was
 * removed too: delivery retries are owned by the messaging outbox's fixed
 * schedule, which never read the authored policy. The inbound
 * `WebhookReceiverSchema` (never consumed by any runtime) was removed as well.
 */
export const WebhookSchema = lazySchema(() => z.object({
  name: SnakeCaseIdentifierSchema.describe('Webhook unique name (lowercase snake_case)'),
  label: z.string().optional().describe('Human-readable webhook label'),
  
  /** Scope */
  object: z.string().optional().describe('Object whose record events (create/update/delete, bulk_update/bulk_delete) trigger this webhook'),
  triggers: z.array(WebhookTriggerType).optional().describe('Events that trigger execution'),
  
  /** Target */
  url: z.string().url().describe('External webhook endpoint URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST').describe('HTTP method'),
  
  /** Headers */
  headers: z.record(z.string(), z.string()).optional().describe('Custom HTTP headers'),

  /** Timeout */
  timeoutMs: z.number().int().min(1000).max(300000).default(30000).describe('Request timeout in milliseconds'),
  
  /** Security */
  secret: z.string().optional().describe('Signing secret for HMAC signature verification'),
  
  /** Status */
  isActive: z.boolean().default(true).describe('Whether webhook is active'),
  
  /** Metadata */
  description: z.string().optional().describe('Webhook description'),
}));

export type Webhook = z.infer<typeof WebhookSchema>;
/** Authoring input for {@link Webhook} — defaulted fields are optional. */
export type WebhookInput = z.input<typeof WebhookSchema>;

/**
 * Type-safe factory for an outbound webhook. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Webhook` literal.
 */
export function defineWebhook(config: z.input<typeof WebhookSchema>): Webhook {
  return WebhookSchema.parse(config);
}
