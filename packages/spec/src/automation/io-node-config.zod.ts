// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/io-node-config
 *
 * Config contracts for the flat IO builtins — `notify` and `http` (#4045).
 *
 * ## Provenance — written from the executors, not from the forms
 *
 * Each schema here was derived by reading what the executor actually does with
 * `node.config` (`service-automation/builtin/notify-node.ts`, `http-nodes.ts`),
 * **not** by transcribing the hand-written `configSchema` literal on the node's
 * descriptor. That independence is the point: the two artifacts are reconciled
 * bidirectionally by `io-node-form-zod-ledger.test.ts` in `service-automation`,
 * and a Zod copied from the form would make that reconciliation a tautology —
 * it would pass by construction and prove nothing (#4045).
 *
 * ## What these schemas are (and are not) wired to
 *
 * Like `LoopConfigSchema` / `ParallelConfigSchema` / `TryCatchConfigSchema`,
 * these are **contract exports**: no engine path `parse()`s a node config with
 * them today, so registering a flow behaves exactly as before. Wiring the
 * executors to parse — which would finally give node configs the type /
 * `required` / unknown-key enforcement the descriptor `configSchema` never
 * provided — is deliberately deferred until the #4059 undeclared-key warning
 * has measured a release's worth of real metadata (#4045 step 3b).
 *
 * `connector_action` has no schema here on purpose: its config contract is
 * empty. The executor reads only the declared `FlowNodeSchema.connectorConfig`
 * sibling block — see the descriptor note in
 * `service-automation/builtin/connector-nodes.ts`.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

// ─── notify ──────────────────────────────────────────────────────────

/**
 * `notify` node config — what the executor reads (ADR-0012 outbound
 * notification via the `messaging` service).
 *
 * Executor semantics worth knowing beyond the key set:
 *
 *  - `recipients` and `title` are **required at execute time** (the step fails
 *    without them). The descriptor's form deliberately publishes no `required`
 *    array — see the comment on the `configSchema` literal — so requiredness
 *    lives here and in the execute-time guard, not in the form.
 *  - Every string-ish value except `channels` passes through `interpolate()`,
 *    so `{record.x}` templates are legal anywhere they are; `channels` is read
 *    raw (channel ids are static routing, not per-record data).
 *  - `sourceObject`/`sourceId` only take effect as a PAIR — a half-specified
 *    click-through target is dropped so the inbox never renders a dead link.
 *    The schema keeps both optional rather than refining, because the executor
 *    tolerates (drops) the half-specified shape rather than rejecting it.
 *  - The historical aliases (`to`/`subject`/`body`/`url`, nested
 *    `source: { object, id }`) are NOT part of this contract: the ADR-0087 D2
 *    conversion `flow-node-notify-config-aliases` rewrites them at load, so the
 *    executor only ever sees the canonical keys below (#3796, #4045).
 */
export const NotifyConfigSchema = lazySchema(() => z.object({
  /** Who gets the notification — user id(s) / audience selector(s). */
  recipients: z.union([z.string(), z.array(z.string())])
    .describe('Recipient user id(s) / audience selector(s); `{token}` templates resolve per run'),
  /** Notification title (execute-time required). */
  title: z.string().describe('Notification title'),
  /** Notification body. */
  message: z.string().optional().describe('Notification body'),
  /** Channels to fan out to (default: inbox). Read raw — no template interpolation. */
  channels: z.union([z.string(), z.array(z.string())]).optional()
    .describe('Channels to fan out to (default: inbox)'),
  /** Event topic handed to the messaging service (default: "notify"). */
  topic: z.string().optional().describe('Event topic (default: "notify")'),
  /** Severity forwarded to the messaging service. */
  severity: z.string().optional().describe('info | warning | critical'),
  /** Click-through target object — only effective together with `sourceId` (#2675). */
  sourceObject: z.string().optional()
    .describe('Object name of the record the notification links to (writes sys_notification.source_object). Requires sourceId.'),
  /** Click-through target record id — only effective together with `sourceObject`. */
  sourceId: z.string().optional()
    .describe('Record id the notification links to (writes sys_notification.source_id). Requires sourceObject.'),
  /** User id that caused the event. */
  actorId: z.string().optional().describe('User id that caused the event (writes sys_notification.actor_id)'),
  /** Explicit click-through URL; overrides the sourceObject/sourceId link. */
  actionUrl: z.string().optional()
    .describe('Explicit click-through URL; overrides the link synthesized from sourceObject/sourceId'),
  /** Extra template inputs merged into the notification payload. */
  payload: z.record(z.string(), z.unknown()).optional()
    .describe('Extra template inputs merged into the notification payload'),
}));

export type NotifyConfig = z.input<typeof NotifyConfigSchema>;
export type NotifyConfigParsed = z.infer<typeof NotifyConfigSchema>;

// ─── http ────────────────────────────────────────────────────────────

/**
 * `http` node config — what the executor reads (ADR-0018 M3 outbound callout).
 *
 * Executor semantics worth knowing beyond the key set:
 *
 *  - `url` is **required at execute time** (the step is refused without it) —
 *    the one key the descriptor's form also marks `required`.
 *  - The whole config is `interpolate()`d before reading, so every value may
 *    carry `{token}` templates.
 *  - `method` defaults per mode — GET inline, POST durable — which is why the
 *    schema declares no static `.default()`.
 *  - `durable: true` routes through the messaging HTTP outbox
 *    (retry / dead-letter) and returns `{ deliveryId }` instead of the
 *    response; without an outbox it degrades to the inline call.
 */
export const HttpConfigSchema = lazySchema(() => z.object({
  /** Target URL (execute-time required). */
  url: z.string().describe('Target URL'),
  /** HTTP method — default GET inline, POST when durable. */
  method: z.string().optional().describe('HTTP method (default GET; POST when durable)'),
  /** Request headers. */
  headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
  /** Request body — JSON-serialised before sending. */
  body: z.unknown().optional().describe('Request body (JSON-serialised)'),
  /** Fire-and-forget via the durable outbox instead of inline request/response. */
  durable: z.boolean().optional()
    .describe('Fire-and-forget via the durable outbox (retry/dead-letter) instead of inline request/response'),
  /** Per-request timeout in milliseconds (both modes). */
  timeoutMs: z.number().optional().describe('Per-request timeout (ms)'),
  /** HMAC-SHA256 signing secret → X-Objectstack-Signature. */
  signingSecret: z.string().optional().describe('HMAC-SHA256 secret → X-Objectstack-Signature'),
}));

export type HttpConfig = z.input<typeof HttpConfigSchema>;
export type HttpConfigParsed = z.infer<typeof HttpConfigSchema>;
