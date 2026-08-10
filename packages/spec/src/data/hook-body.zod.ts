// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { strictObject } from '../shared/strict-object';

// Retired token prescription. Declared with `//` (never `/** */`) and ABOVE the
// capability enum's JSDoc on purpose — see the placement note below: build-docs
// takes the file's FIRST JSDoc as the reference page's module blurb, so a doc
// comment here would replace the whole capability-token table.
const CRYPTO_HASH_RETIRED =
  "`crypto.hash` was removed from `HookBodyCapability` in @objectstack/spec 17 (#4391, "
  + 'ADR-0049 enforce-or-remove) — the sandbox never implemented it. `installCtx` wired only '
  + '`ctx.crypto.randomUUID`, so `ctx.crypto.hash(...)` threw inside the VM on every call the '
  + 'token ever "granted", while the build-time extractor inferred the token from that very '
  + 'call and let `os build` pass. Delete the capability from `capabilities` AND delete the '
  + '`ctx.crypto.hash(...)` call it was declared for — the call has never returned a value, so '
  + 'nothing that works today depends on it. There is no replacement inside the sandbox: hash '
  + 'in the host (a Connector recipe, or an engine-side hook) instead. If you need hashing in '
  + 'a body, reopen it through the capability admission process — implementation first, the '
  + 'declaration lands with the implementation. '
  + 'Run `os migrate meta --from 16` to rewrite existing sources automatically.';

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
 * - `log`        — `ctx.log.info / warn / error`
 *
 * `http.fetch` is intentionally absent — outbound calls go through Connector
 * recipes (separate spec) so they remain auditable and replayable.
 *
 * `crypto.hash` was REMOVED in 17 (#4391): declared here, inferred by the CLI
 * extractor and typed on `ScriptContext`, but never installed on the VM's
 * `ctx.crypto` — so the one thing it authorised always threw. Every layer that
 * advertised it is gone in the same change; a body that still declares it is
 * rejected at parse with {@link CRYPTO_HASH_RETIRED}. It comes back only WITH
 * an implementation (ADR-0049's enforce leg), not ahead of one.
 */
export const HookBodyCapability = z.enum([
  'api.read',
  'api.write',
  'api.transaction',
  'crypto.uuid',
  'log',
], {
  // Only the value that USED to be legal gets the retirement prescription —
  // telling the author of `crypto.hsah` that their value "was removed" would
  // misinform. Everything else keeps zod's own enum message, which already
  // lists the legal tokens. (The `managedBy: 'system'` precedent, object.zod.ts.)
  error: (issue) => (issue.input === 'crypto.hash' ? CRYPTO_HASH_RETIRED : undefined),
});
export type HookBodyCapability = z.input<typeof HookBodyCapability>;

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

const L2_ONLY_ON_L1 =
  'is an L2 key — it only applies to `language: "js"`. An expression body is a pure '
  + 'formula: it performs no IO, so it has nothing to grant and no sandbox to bound.';

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
export const ExpressionBodySchema = strictObject(
  {
    surface: 'this expression (L1) hook body',
    aliases: { expression: 'source', formula: 'source', code: 'source', script: 'source' },
    guidance: {
      capabilities: `\`capabilities\` ${L2_ONLY_ON_L1}`,
      timeoutMs: `\`timeoutMs\` ${L2_ONLY_ON_L1}`,
      memoryMb: `\`memoryMb\` ${L2_ONLY_ON_L1}`,
    },
    history: 'Until #4001 these were dropped silently.',
  },
  {
  language: z.literal('expression'),
  /** Formula-engine expression. Pure, side-effect-free. */
  source: z.string().min(1).describe('Formula expression source'),
}).describe('L1 expression body — pure formula, no IO');
export type ExpressionBody = z.input<typeof ExpressionBodySchema>;

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
 * **Write-set lint — author-time, advisory (#4271).**
 * The fields the body writes are statically checked by
 * `validateHookBodyWrites` in `@objectstack/lint` (run by `os validate` /
 * `os lint` / `os build`): the literal write patterns its
 * `HOOK_BODY_WRITE_PATTERNS` ledger declares (`ctx.input.x = …`,
 * `Object.assign(ctx.input, { x })`, `ctx.api.object('y').update({ x })`)
 * are resolved against the target object's declared + system fields, and an
 * unknown field warns with a did-you-mean. Nothing downstream catches what the
 * lint misses: the payload reaches the driver unfiltered, so a SQL driver
 * fails the WHOLE write with a driver-level error far from the authoring site,
 * while a schemaless driver (memory, MongoDB) persists the stray key.
 * Statically unknowable writes — computed keys, spreads, aliased `ctx.input`,
 * dynamic object names, wildcard-target hooks — remain opaque and are skipped
 * silently, so the warning's absence is not proof of correctness. When the
 * write set is fixed, still prefer a flow `update_record` node:
 * `validateFlowNodeWrites` resolves its `config.fields` keys with no parser in
 * between, so that surface gates (`flow-node-write-unknown-field`, `error`)
 * where this one advises.
 *
 * An **action** body carrying this same schema is checked by the sibling rule
 * `validateActionBodyWrites`, over the subset of that ledger which survives the
 * context change — `ctx.api.object('y').insert|create|update|updateById({ x })`
 * and nothing else. An action's `ctx.input` is its PARAMS bag, not a record, so
 * it is never resolved against object fields.
 *
 * `ctx.record` is not a write surface at all: the runner passes a snapshot and
 * never writes it back, so an assignment to it is discarded whether or not the
 * field is declared. That gets its own warning
 * (`action-record-write-discarded`, #4345), reported only when `ctx.record`
 * never leaves the body as a value — mutating the snapshot and then handing it
 * to an API write is a payload under construction, and is not flagged.
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
export const ScriptBodySchema = strictObject(
  {
    surface: 'this sandboxed JS (L2) hook body',
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
  },
  {
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
}).describe('L2 sandboxed JS body — runs inside an isolated VM with declared capabilities');
export type ScriptBody = z.input<typeof ScriptBodySchema>;
/** Post-parse shape of {@link ScriptBody} — defaults applied, transforms run (ADR-0122). */
export type ScriptBodyParsed = z.infer<typeof ScriptBodySchema>;

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
export type HookBody = z.input<typeof HookBodySchema>;
/** Post-parse shape of {@link HookBody} — defaults applied, transforms run (ADR-0122). */
export type HookBodyParsed = z.infer<typeof HookBodySchema>;
