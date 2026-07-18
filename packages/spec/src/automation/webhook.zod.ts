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
]);

/**
 * CANONICAL WEBHOOK DEFINITION
 * 
 * This is the single source of truth for webhook configuration across ObjectStack.
 * All other protocols (workflow, connector, etc.) should import and reference this schema.
 * 
 * Webhook Protocol - Outbound HTTP Integration
 * Push data to external URLs when events occur in the system.
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
 *   authentication: {
 *     type: 'bearer',
 *     credentials: { token: process.env.SLACK_TOKEN }
 *   },
 *   retryPolicy: {
 *     maxRetries: 3,
 *     backoffStrategy: 'exponential'
 *   }
 * }
 * ```
 */
export const WebhookSchema = lazySchema(() => z.object({
  name: SnakeCaseIdentifierSchema.describe('Webhook unique name (lowercase snake_case)'),
  label: z.string().optional().describe('Human-readable webhook label'),
  
  /** Scope */
  object: z.string().optional().describe('Object whose record events (create/update/delete) trigger this webhook'),
  triggers: z.array(WebhookTriggerType).optional().describe('Events that trigger execution'),
  
  /** Target */
  url: z.string().url().describe('External webhook endpoint URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST').describe('HTTP method'),
  
  /** Headers */
  headers: z.record(z.string(), z.string()).optional().describe('Custom HTTP headers'),
  
  /** Body/Payload */
  body: z.unknown().optional().describe('Request body payload (if not using default record data)'),
  
  /** Payload Configuration */
  payloadFields: z.array(z.string()).optional().describe('Fields to include. Empty = All'),
  includeSession: z.boolean().default(false).describe('Include user session info'),
  
  /** Authentication */
  authentication: z.object({
    type: z.enum(['none', 'bearer', 'basic', 'api-key']).describe('Authentication type'),
    credentials: z.record(z.string(), z.string()).optional().describe('Authentication credentials'),
  }).optional().describe("Authentication configuration. [EXPERIMENTAL — not enforced] The webhook delivery path only applies HMAC signing via `secret`; bearer/basic/api-key credentials are not attached to outbound requests yet (liveness audit #1878/#1893)."),
  
  /** Retry Policy */
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(10).default(3).describe('Maximum retry attempts'),
    backoffStrategy: z.enum(['exponential', 'linear', 'fixed']).default('exponential').describe('Backoff strategy'),
    initialDelayMs: z.number().int().min(100).default(1000).describe('Initial retry delay in milliseconds'),
    maxDelayMs: z.number().int().min(1000).default(60000).describe('Maximum retry delay in milliseconds'),
  }).optional().describe('Retry policy configuration'),
  
  /** Timeout */
  timeoutMs: z.number().int().min(1000).max(300000).default(30000).describe('Request timeout in milliseconds'),
  
  /** Security */
  secret: z.string().optional().describe('Signing secret for HMAC signature verification'),
  
  /** Status */
  isActive: z.boolean().default(true).describe('Whether webhook is active'),
  
  /** Metadata */
  description: z.string().optional().describe('Webhook description'),
  tags: z.array(z.string()).optional().describe('Tags for organization'),
}));

/**
 * Webhook Receiver Schema (Inbound)
 * Handling incoming HTTP hooks from Stripe, Slack, etc.
 * 
 * **NAMING CONVENTION:**
 * Webhook receiver names are machine identifiers and must be lowercase snake_case.
 * 
 * @example Good names
 * - 'stripe_webhook_handler'
 * - 'github_events'
 * - 'twilio_status_callback'
 * 
 * @example Bad names (will be rejected)
 * - 'StripeWebhookHandler' (PascalCase)
 */
export const WebhookReceiverSchema = lazySchema(() => z.object({
  name: SnakeCaseIdentifierSchema.describe('Webhook receiver unique name (lowercase snake_case)'),
  path: z.string().describe('URL Path (e.g. /webhooks/stripe)'),
  
  /** Verification */
  verificationType: z.enum(['none', 'header_token', 'hmac', 'ip_whitelist']).default('none'),
  verificationParams: z.object({
    header: z.string().optional(),
    secret: z.string().optional(),
    ips: z.array(z.string()).optional()
  }).optional(),
  
  /** Action */
  action: z.enum(['trigger_flow', 'script', 'upsert_record']).default('trigger_flow'),
  target: z.string().describe('Flow ID or Script name'),
}));

export type Webhook = z.infer<typeof WebhookSchema>;
/** Authoring input for {@link Webhook} — defaulted fields are optional. */
export type WebhookInput = z.input<typeof WebhookSchema>;
export type WebhookReceiver = z.infer<typeof WebhookReceiverSchema>;

/**
 * Type-safe factory for an outbound webhook. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Webhook` literal.
 */
export function defineWebhook(config: z.input<typeof WebhookSchema>): Webhook {
  return WebhookSchema.parse(config);
}
