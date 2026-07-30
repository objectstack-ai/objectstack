// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { strictUnknownKeyError } from '../shared/suggestions.zod';

/**
 * Capability tokens a script body may request.
 *
 * The runtime sandbox enforces these — if a body uses a `ctx` API that requires
 * a capability it did not declare, the call throws at invocation time.
 *
 * - `api.read`   — `ctx.api.object(...).find / findOne / count / aggregate`
 * - `api.write`  — `ctx.api.object(...).insert / update / delete`
 * - `api.transaction` — `ctx.api.transaction(async () => { … })` — runs the
 *   callback's `ctx.api` writes/reads inside one driver transaction, committed
 *   on return and rolled back if the callback throws. Requires `api.write`
 *   alongside it to be useful (the transaction body still needs write access).
 * - `crypto.uuid` — `ctx.crypto.randomUUID()`
 * - `crypto.hash` — `ctx.crypto.hash(algo, data)`
 * - `log`        — `ctx.log.info / warn / error`
 *
 * `http.fetch` is intentionally absent — outbound calls go through Connector
 * recipes (separate spec) so they remain auditable and replayable.
 */
export const HookBodyCapability = z.enum([
  'api.read',
  'api.write',
  'api.transaction',
  'crypto.uuid',
  'crypto.hash',
  'log',
]);
export type HookBodyCapability = z.infer<typeof HookBodyCapability>;

/*
 * ── Unknown-key strictness (#4001 data step) ────────────────────────────────
 *
 * Both body shapes are `.strict()`. A hook body is the one place where a
 * silently-stripped key is worst-understood by the author: the body still
 * parses, still runs, and the thing they configured simply is not in effect.
 *
 * The two concrete traps this closes:
 *   - `capabilities` misspelt on an L2 body strips to the `[]` default, and the
 *     sandbox then throws at INVOCATION time on the first `ctx.api` call — far
 *     from the typo, and only on the code path that happens to use it.
 *   - `timeoutMs` / `memoryMb` misspelt strip to undefined, so the body runs
 *     under the enclosing hook's limits instead of the tighter ones the author
 *     wrote. Nothing reports the downgrade.
 *
 * The L1 schema additionally PRESCRIBES the L2-only keys rather than guessing a
 * rename: `capabilities` on an `expression` body is not a typo, it is a
 * misunderstanding of which level owns the key.
 *
 * Placement note: this block sits AFTER `HookBodyCapability` on purpose.
 * build-docs.ts takes the file's FIRST JSDoc as the reference page's module
 * blurb, so a `/** … *\/` comment above the capability enum silently replaced
 * the whole capability-token table in content/docs/references/data/hook-body.mdx.
 * Keep declarations that carry JSDoc below the first exported symbol here.
 */

/** Keys {@link ExpressionBodySchema} declares (drift-guarded by hook-body.test.ts). */
const EXPRESSION_BODY_KEYS = ['language', 'source'] as const;

/** Keys {@link ScriptBodySchema} declares (drift-guarded by hook-body.test.ts). */
const SCRIPT_BODY_KEYS = ['language', 'source', 'capabilities', 'timeoutMs', 'memoryMb'] as const;

const L2_ONLY_ON_L1 =
  'is an L2 key — it only applies to `language: "js"`. An expression body is a pure '
  + 'formula: it performs no IO, so it has nothing to grant and no sandbox to bound.';

const expressionBodyUnknownKeyError = strictUnknownKeyError({
  surface: 'this expression (L1) hook body',
  knownKeys: EXPRESSION_BODY_KEYS,
  aliases: { expression: 'source', formula: 'source', code: 'source', script: 'source' },
  guidance: {
    capabilities: `\`capabilities\` ${L2_ONLY_ON_L1}`,
    timeoutMs: `\`timeoutMs\` ${L2_ONLY_ON_L1}`,
    memoryMb: `\`memoryMb\` ${L2_ONLY_ON_L1}`,
  },
  history: 'Until #4001 these were dropped silently.',
});

const scriptBodyUnknownKeyError = strictUnknownKeyError({
  surface: 'this sandboxed JS (L2) hook body',
  knownKeys: SCRIPT_BODY_KEYS,
  aliases: {
    capability: 'capabilities',
    caps: 'capabilities',
    permissions: 'capabilities',
    timeout: 'timeoutMs',
    timeoutms: 'timeoutMs',
    memory: 'memoryMb',
    memorymb: 'memoryMb',
    code: 'source',
    script: 'source',
    body: 'source',
  },
  history:
    'Until #4001 these were dropped silently — the body still ran, just not under the '
    + 'limits or grants that were written.',
});

/**
 * L1 — Pure expression body.
 *
 * Evaluated by the formula engine. No IO, no mutation. Used for predicates
 * (`condition`-style) and simple computed values.
 *
 * @example
 * ```json
 * { "language": "expression", "source": "input.amount > 1000 && input.status == 'open'" }
 * ```
 */
export const ExpressionBodySchema = z.object({
  language: z.literal('expression'),
  /** Formula-engine expression. Pure, side-effect-free. */
  source: z.string().min(1).describe('Formula expression source'),
}, { error: expressionBodyUnknownKeyError }).strict().describe('L1 expression body — pure formula, no IO');
export type ExpressionBody = z.infer<typeof ExpressionBodySchema>;

/**
 * L2 — Sandboxed JavaScript source.
 *
 * The `source` is the **function body only** (not a full module). The runtime
 * wraps it in `new AsyncFunction('ctx', source)` for hooks, or
 * `new AsyncFunction('input', 'ctx', source)` for actions, then executes
 * inside an isolated VM.
 *
 * Forbidden inside `source` (CLI build will reject):
 * - `import` / `require` / dynamic `import()`
 * - `process`, `globalThis`, `eval`, `new Function`
 * - any identifier resolved from a value-only top-level import
 *
 * **Write-set opacity — accepted static-analysis gap.**
 * `source` is opaque to static analysis: no lint verifies that the fields the
 * body writes (`ctx.input.x = …`, `ctx.api.object('y').update(id, { x })`)
 * exist on the target object(s). Only the read side (`hook.condition`) and
 * the capability surface are statically checked. Write-target field existence
 * is the author's responsibility; when the write set is fixed, prefer a flow
 * `update_record` node, whose structural `fields` config IS lint-checked.
 *
 * @example
 * ```json
 * {
 *   "language": "js",
 *   "source": "if (ctx.input.email) ctx.input.email = ctx.input.email.toLowerCase();",
 *   "capabilities": [],
 *   "timeoutMs": 250
 * }
 * ```
 */
export const ScriptBodySchema = z.object({
  language: z.literal('js'),
  /** Function body source (NOT a full module — no top-level imports). */
  source: z.string().min(1).describe('Function body source'),
  /**
   * Capability tokens the body is allowed to use. Default: `[]`.
   * The sandbox throws if the body calls a `ctx` API not covered by these.
   */
  capabilities: z.array(HookBodyCapability).default([]).describe('Granted capability tokens'),
  /**
   * Per-invocation hard timeout in milliseconds.
   * Sandbox kills the script if it exceeds this; smaller of this and the
   * enclosing hook/action `timeout` wins.
   */
  timeoutMs: z.number().int().positive().max(30_000).optional().describe('Per-invocation timeout (ms)'),
  /**
   * Per-invocation memory cap in MB.
   * Subject to engine support (isolated-vm enforces, quickjs approximates).
   */
  memoryMb: z.number().int().positive().max(256).optional().describe('Per-invocation memory cap (MB)'),
}, { error: scriptBodyUnknownKeyError }).strict().describe('L2 sandboxed JS body — runs inside an isolated VM with declared capabilities');
export type ScriptBody = z.infer<typeof ScriptBodySchema>;

/**
 * Hook / Action body — discriminated by `language`.
 *
 * Two and only two forms are accepted:
 * - `expression` — L1, pure formula evaluated by the formula engine.
 * - `js`         — L2, sandboxed JavaScript source string.
 *
 * The compiled-module path (`.mjs` envelope) is intentionally **not** part of
 * this union. All bodies are pure metadata and travel inside the project
 * artifact JSON — no separate runtime module is required.
 *
 * @see content/docs/concepts/north-star.mdx — "Metadata-only runtime"
 */
export const HookBodySchema = z.discriminatedUnion('language', [
  ExpressionBodySchema,
  ScriptBodySchema,
]).describe('Hook/Action body — expression (L1) or sandboxed JS (L2)');
export type HookBody = z.infer<typeof HookBodySchema>;
