// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { strictObject } from '../shared/strict-object';

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

export type WebhookTriggerType = z.input<typeof WebhookTriggerType>;

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
 *
 * ## Closed against unknown keys (#4001 batch 11, ADR-0078)
 *
 * The ledger carried this row as `authorable (p)` — provisional, "spec-only
 * (#3461)". Resolving the `(p)` found the opposite of spec-only: this schema is
 * `.parse()`d at THREE doors, one of which is a boot path.
 *
 *  1. {@link defineWebhook} — the authoring factory.
 *  2. `defineStack({ webhooks })` — `StackSchema` holds `z.array(WebhookSchema)`.
 *  3. **Boot** — `plugin-webhooks`' `bootstrapDeclaredWebhooks` re-parses every
 *     declared webhook before materializing it into a `sys_webhook` row
 *     (`bootstrap-declared-webhooks.ts`), and a parse failure there warns and
 *     SKIPS the webhook. So an undeclared key here is not merely stripped — from
 *     this change on it is the difference between a subscription that exists and
 *     one that does not, which is why the rejection has to carry its fix.
 *
 * Door 3 is also why the ADR-0010 envelope below is part of this change rather
 * than a follow-up. `applyProtection` stamps `_packageId` / `_provenance` (and
 * `_lock*` when a `protection` block was authored) onto EVERY metadata item at
 * load, including this one — so the object that reaches the boot parse already
 * carries keys this schema never declared. They were silently stripped while it
 * was `.strip`; closing it without declaring them would have converted every
 * package-loaded webhook into a skipped subscription at boot. That is the
 * "envelope debt" the campaign paid down eight times over on the registered
 * metadata types; `webhook` is not one of those (no
 * `BUILTIN_METADATA_TYPE_SCHEMAS` entry), which is precisely why nothing had
 * caught it here.
 */
export const WebhookSchema = lazySchema(() => strictObject({
  surface: 'this webhook',
  aliases: {
    // Real, in-repo spellings of the same field on the OTHER side of the
    // materialization bridge: `sys_webhook`'s columns are `object_name` /
    // `active` (`mapWebhookToRow` in plugin-webhooks does the remap). An admin
    // or agent reading a row back and re-authoring it from those column names
    // is the concrete path here, and neither word is within edit distance.
    // The column spelling alone covers `objectName` too — `aliasProbe` folds
    // case and separators, so both spellings share one probe (#5481).
    object_name: 'object',
    active: 'isActive',
    enabled: 'isActive',
    // The trigger list, named as the neighbouring surfaces name it.
    events: 'triggers',
    on: 'triggers',
    endpoint: 'url',
    target: 'url',
    signingSecret: 'secret',
  },
  guidance: {
    // #3494 removed these five and `retryPolicy` — the tombstone has to carry
    // the reason, or an author just writes them again one release later.
    body: '`body` was removed in 17 (#3494) — the delivery path always sends its own fixed envelope, so a custom body was never sent. There is no replacement.',
    payloadFields: '`payloadFields` was removed in 17 (#3494) — the delivery envelope is fixed and was never trimmed to a field list. There is no replacement.',
    includeSession: '`includeSession` was removed in 17 (#3494) — session context was never included in a delivery. There is no replacement.',
    authentication: '`authentication` was removed in 17 (#3494) — only HMAC signing via `secret` is applied to a delivery. Use `secret`.',
    retryPolicy: '`retryPolicy` was removed in 17 (#3494) — delivery retries are owned by the messaging outbox on a fixed schedule, and the authored policy was never read. There is no replacement.',
    tags: '`tags` was removed in 17 (#3494) — nothing read them. There is no replacement.',
  },
  history:
    'Until #4001 these were dropped silently — the webhook still parsed and still ' +
    'materialized, so a subscription scoped or secured with a key we do not declare ' +
    'shipped listening to the wrong thing, or to everything.',
  // `WebhookConfigSchema` (integration/connector.zod.ts) is this shape
  // `.extend()`ed, and zod carries BOTH the strictness and this error map onto
  // the extension — verified against real zod, not assumed. Naming the
  // extension's own key keeps a typo of it fixable on that surface.
  //
  // Its SIBLING key `events` is deliberately NOT listed here even though the
  // extension declares it, because it is an alias target above: listing it
  // would make a base-surface typo suggest `events`, and writing `events` would
  // then suggest `triggers` — an author walked through two rejections to a key
  // the base does not accept. That is finding 7 (the `triggerPhrase` →
  // `triggerPhrases` → tombstone chain) arriving from a new direction:
  // `acceptsNothing` guards the shape-derived candidates, and nothing guards
  // hand-written `extraKeys`. On the connector surface `events` is declared, so
  // it is never the unrecognized key there anyway.
  extraKeys: ['signatureAlgorithm'],
}, {
  // [#8554] "unique per organization", not bare "unique". This `describe()` is
  // the SOURCE of the generated reference page
  // (`content/docs/references/automation/webhook.mdx`), so the bare wording had
  // already reached authors as published contract. `sys_webhook` is
  // tenant-scoped and the declared index is now `unique: 'organization'`.
  name: SnakeCaseIdentifierSchema.describe('Webhook name, unique per organization (lowercase snake_case)'),
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

  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package authors declare
   * lock policy here; the loader translates it into the private `_lock`
   * envelope at registration time and strips this block before persistence.
   * See `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this webhook.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  //
  // Declared in #4001 batch 11 for the reason the module header states: both
  // metadata load paths call `applyProtection` on EVERY type, so a
  // package-loaded webhook has always carried these keys by the time
  // `bootstrapDeclaredWebhooks` re-parses it. `.strip` discarded them; the
  // `.strict()` gate above would have rejected them, and the observable failure
  // would not have looked like a validation problem at all — just a webhook
  // that stopped existing after a redeploy, with one `warn` to say so.
  ...MetadataProtectionFields,
}));

export type Webhook = z.input<typeof WebhookSchema>;
/** Post-parse shape of {@link Webhook} — defaults applied, transforms run (ADR-0122). */
export type WebhookParsed = z.infer<typeof WebhookSchema>;

/**
 * Type-safe factory for an outbound webhook. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Webhook` literal.
 */
export function defineWebhook(config: z.input<typeof WebhookSchema>): WebhookParsed {
  return WebhookSchema.parse(config);
}
