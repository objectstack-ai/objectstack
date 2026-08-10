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
 * ## What these schemas are wired to (#4277)
 *
 * Like `LoopConfigSchema` / `ParallelConfigSchema` / `TryCatchConfigSchema`,
 * these are **live execute-time contracts**: each executor `parse()`s its
 * config against its schema before running (`service-automation`'s
 * `parse-config.ts`), so type and `required` violations refuse the node as a
 * guard (not routable via `fault` edges). `notify` parses the RAW stored
 * config — its slots are string-typed, so `{token}` templates pass and the
 * post-interpolation guards still own "resolved to nothing". `http` parses
 * the INTERPOLATED config, because that is the shape its executor reads —
 * a `{token}` in a typed slot (`timeoutMs`, `durable`) resolves to its real
 * type first.
 *
 * ## Unknown keys — closed here too, as of #4001 批 9
 *
 * These contracts used to say "unknown keys are the registration layer's job":
 * `registerFlow()` rejects keys the descriptor `configSchema` does not declare
 * (the tightened #4059 check), and this parse merely stripped them. That is one
 * door, and the #4001 campaign's second recurring finding is that a schema
 * which strips by default leaves every OTHER door open — whoever writes the
 * guard is fixing the bug in front of them, not auditing the surface.
 *
 * The registration check remains the first door a stored flow meets and the
 * more informative one (it walks NESTED config against the descriptor's JSON
 * Schema and prints the declared set per path, which a flat key list cannot).
 * What changes is that a config reaching `parse()` by any OTHER route — a
 * direct `NotifyConfigSchema.parse()` in tooling, a host that composes the
 * engine without `registerFlow`, a future executor seam — no longer has its
 * undeclared keys silently deleted. The two doors are kept in agreement by
 * `io-node-form-zod-ledger.test.ts`, which reconciles this key set against the
 * descriptor's in both directions.
 *
 * `connector_action` has no schema here on purpose: its config contract is
 * empty. The executor reads only the declared `FlowNodeSchema.connectorConfig`
 * sibling block — see the descriptor note in
 * `service-automation/builtin/connector-nodes.ts`.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * What a rejected key on these contracts silently did before #4001 批 9.
 *
 * Shared by both schemas because the failure was identical: the step ran, the
 * notification went out or the request was made, and the run reported success
 * minus whatever the key was meant to configure.
 */
const IO_NODE_CONFIG_HISTORY =
  'Until #4001 an undeclared key here was dropped at the execute-time parse — the step still ran and '
  + 'the run still reported success, minus whatever the key was meant to configure.';

/**
 * `notify` prescriptions for the four ADR-0087 D2 aliases and the nested
 * `source` shape (#3796 / #4045).
 *
 * Each is a RETIRED SPELLING, not a typo, so a bare "did you mean" would
 * under-serve it: `flow-node-notify-config-aliases` rewrites all five at load
 * (including the `registerFlow` rehydration seam). Since #4923 that rewrite
 * also DELETES a retired spelling that merely repeats the canonical key's
 * value, which sharpens what a surviving one means: it survived because the
 * canonical key is also present and says something DIFFERENT, and the
 * conversion will not pick between two values the author wrote.
 *
 * So each prescription answers both readings — the rename, for whoever parses
 * this contract directly, and a reconciliation naming BOTH keys, for whoever
 * came through the load path.
 */
const NOTIFY_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  to:
    'The recipient slot is `recipients`. `to` is the pre-17 spelling, rewritten at load by the ADR-0087 D2 '
    + 'conversion `flow-node-notify-config-aliases` — so if `recipients` is also present, the two name DIFFERENT '
    + 'recipients and the conversion kept both rather than choosing who gets notified (#4923). Decide the '
    + 'recipients, put them on `recipients`, and delete `to`.',
  subject:
    'The heading slot is `title`. `subject` is the pre-17 spelling rewritten at load by '
    + '`flow-node-notify-config-aliases`; delete it once `title` carries the text. If `title` is also present with '
    + 'DIFFERENT text, the conversion kept both rather than choosing (#4923) — reconcile them onto `title`.',
  body:
    'The body slot is `message`. `body` is the pre-17 spelling rewritten at load by '
    + '`flow-node-notify-config-aliases`; delete it once `message` carries the text. If `message` is also present '
    + 'with DIFFERENT text, the conversion kept both rather than choosing (#4923) — reconcile them onto `message`. '
    + '(`body` IS canonical on an `http` node — the key is wrong only here.)',
  url:
    'The click-through slot is `actionUrl`. It was renamed at 17 because `url` elsewhere on the platform means '
    + '"HTTP endpoint to call" (`http` node, webhooks), a different concept from an in-app click target. '
    + '`flow-node-notify-config-aliases` rewrites it at load; delete it once `actionUrl` carries the link. If '
    + '`actionUrl` is also present with a DIFFERENT link, the conversion kept both rather than choosing where the '
    + 'notification points (#4923) — reconcile them onto `actionUrl`.',
  source:
    'The click-through target is the flat PAIR `sourceObject` + `sourceId`, never a nested `source: { object, id }`. '
    + '`flow-node-notify-config-aliases` lifts the nested shape at load and drops it once every part is accounted '
    + 'for, so a surviving `source` means a part of it holds a DIFFERENT value from the flat `sourceObject` / '
    + '`sourceId` already in that slot, and the conversion declined to pick (#4923) — reconcile onto the flat pair '
    + 'and delete `source`. '
    + 'Note the pair only takes effect together: a half-specified target is dropped so the inbox never renders a '
    + 'dead link.',
};

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
 *  - `recipients`, `title`, `message`, `actionUrl` and `payload` pass through
 *    `interpolate()`, so `{record.x}` templates are legal in them. `channels`,
 *    `topic` and `severity` are read RAW — a `{token}` in those three is
 *    forwarded verbatim, never resolved (channel ids are static routing and
 *    `severity` is a closed vocabulary, not per-record data). Re-measured
 *    against `notify-node.ts` for #7086: the previous wording ("every
 *    string-ish value except `channels`") was stale for `topic` and `severity`,
 *    and it is what makes closing the `severity` gate below safe.
 *  - `sourceObject`/`sourceId` only take effect as a PAIR — a half-specified
 *    click-through target is dropped so the inbox never renders a dead link.
 *    The schema keeps both optional rather than refining, because the executor
 *    tolerates (drops) the half-specified shape rather than rejecting it.
 *  - The historical aliases (`to`/`subject`/`body`/`url`, nested
 *    `source: { object, id }`) are NOT part of this contract: the ADR-0087 D2
 *    conversion `flow-node-notify-config-aliases` rewrites them at load, so the
 *    executor only ever sees the canonical keys below (#3796, #4045).
 */
export const NotifyConfigSchema = lazySchema(() => strictObject({
  surface: 'this notify node config',
  history: IO_NODE_CONFIG_HISTORY,
  guidance: NOTIFY_KEY_GUIDANCE,
}, {
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
  /**
   * Severity forwarded to the messaging service — a CLOSED vocabulary (#7086).
   *
   * Was a bare `z.string()` whose `.describe()` read `'info | warning | critical'`,
   * so the enumeration existed only in the sentence: `'urgent'`, `'INFO'` and `''`
   * all parsed green, then rode the dispatcher's blind cast
   * (`severity: (p.severity as Notification['severity']) ?? 'info'`) into
   * `sys_inbox_message.severity` under a TypeScript union that says those values
   * cannot exist — every downstream `switch` on the three names fell through.
   * The gate is the last surface that was open: the describe, the
   * `Notification['severity']` type, and the `sys_inbox_message.severity` select
   * field all already declared exactly these three.
   *
   * Safe to close because the executor reads this key RAW — see the
   * interpolation note above — so a `{token}` template here never resolved and
   * a rejection removes no working authoring shape.
   */
  severity: z.enum(['info', 'warning', 'critical']).optional()
    .describe('Severity forwarded to the messaging service'),
  /** Click-through target object — only effective together with `sourceId` (#2675). */
  sourceObject: z.string().optional()
    .describe('Object name of the record the notification links to (writes sys_notification.source_object). Only takes effect together with sourceId — a half-specified click-through target is dropped at execute time, so the inbox never renders a dead link.'),
  /** Click-through target record id — only effective together with `sourceObject`. */
  sourceId: z.string().optional()
    .describe('Record id the notification links to (writes sys_notification.source_id). Only takes effect together with sourceObject — a half-specified click-through target is dropped at execute time, so the inbox never renders a dead link.'),
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
export const HttpConfigSchema = lazySchema(() => strictObject({
  surface: 'this http node config',
  history: IO_NODE_CONFIG_HISTORY,
  // No curated table: `http` has no retired spelling and no cross-surface
  // near-miss this campaign's payload scan could attest. The two plausible
  // typos are already reachable by edit distance (`timeout` → `timeoutMs`,
  // `header` → `headers`), and inventing entries nothing refutes is how this
  // campaign shipped four confidently-wrong prescriptions in one batch.
}, {
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
