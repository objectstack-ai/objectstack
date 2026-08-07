// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/flow-function
 *
 * The contract for a **named handler function a `script` node invokes** —
 * contributed by `defineStack({ functions })` and resolved by name at execute
 * time (#1870).
 *
 * ## The rule, and why it lives here instead of in a comment
 *
 * A flow function is a PURE compute step: it receives its mapped `input`,
 * RETURNS a value, and the node's `outputVariable` exposes that value as a flow
 * variable so a later DECLARATIVE node persists it (`update_record fields: {
 * ai_category: '{aiResult.ai_category}' }`). Data I/O stays on the flow graph.
 *
 * That is not style advice. #4354's per-run summary reports what a run did to
 * the data, and the `script` node reports NO record metrics *because* of this
 * rule: every write a script causes is a downstream `create_record` /
 * `update_record` that counts itself, so "this node touched no records" is the
 * accurate answer rather than a guess. A function that writes anyway makes its
 * run under-report — `selected: 30, acted: 0` on a run that wrote 30 invoices,
 * which reads exactly like the broken sweep #4354 exists to detect, and the
 * durable `sys_automation_run` row says so permanently.
 *
 * Until #4396 that rule lived ONLY in a comment inside the executor, so neither
 * an author, a lint, nor the runtime could see the contract the summary was
 * relying on. It is now declared in two halves:
 *
 *  1. `ActionDescriptor.handlerContract` — `script` publishes `'pure'`, so the
 *     action catalog and the designer palette carry the rule an author reads.
 *  2. {@link FlowFunctionEffectSchema} — a function that legitimately writes
 *     DECLARES it, and its step then reports `unmeasuredEffect`, so the run
 *     says "cannot count" instead of claiming it wrote nothing.
 *
 * ## What is deliberately not here
 *
 * A blanket `unmeasuredEffect` on every `script` step (the escape hatch #4354
 * gave `connector_action`) was rejected: it would suppress the broken-sweep
 * signal on every flow that calls any function, in order to accommodate the
 * flows that break the rule — paying for a rule-breaker with everyone else's
 * signal, and fossilizing the violation as supported behaviour.
 *
 * Nor is this *enforcement*. The runtime hands a function no data reach —
 * {@link FlowFunctionContext} in `@objectstack/service-automation` carries
 * `input` / `variables` / `automation` / `logger` and no engine handle — but a
 * function is ordinary host code and can close over a client at module scope.
 * What the declaration buys is that the honest case is now *expressible*, and
 * the platform's own counters stop being wrong for it.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * What a `script`-node function does to data (#4396).
 *
 *  - `'pure'` (the default, and the contract) — it computes and returns. The
 *    step reports no record metrics, which is exact: the writes it leads to are
 *    downstream declarative nodes that count themselves.
 *  - `'writes'` — it performs writes, or dispatches effects, that the platform
 *    cannot see or count. The step reports
 *    `ExecutionStepMetrics.unmeasuredEffect`, so the run's `unmeasured` tally
 *    keeps the broken-sweep query
 *    (`selected > 0 AND acted = 0 AND unmeasured = 0`) off it — and only off
 *    the flows that actually call such a function.
 *
 * There is deliberately no `'reads'` member: an under-reported `selected` can
 * only make the broken-sweep alert quieter, never wrong, so declaring it would
 * buy nothing the runtime acts on.
 */
export const FlowFunctionEffectSchema = lazySchema(() => z.enum([
  'pure',
  'writes',
]).describe("What a script-node function does to data: 'pure' (computes and returns — the contract) or 'writes' (performs uncountable writes/effects, reported as unmeasured)"));

export type FlowFunctionEffect = z.infer<typeof FlowFunctionEffectSchema>;

/**
 * The effect a function is assumed to have when it declares none — the
 * contract's default, and the reason a bare `functions: { fn }` entry stays
 * exactly as cheap to write as it was.
 */
export const DEFAULT_FLOW_FUNCTION_EFFECT: FlowFunctionEffect = 'pure';

/**
 * The **declared** form of a `defineStack({ functions })` entry: the handler
 * plus what it does.
 *
 * ```ts
 * defineStack({
 *   functions: {
 *     scoreLead: (ctx) => ({ score: 42 }),                       // pure (default)
 *     syncBilling: { handler: syncBilling, effect: 'writes' },   // declared writer
 *   },
 * });
 * ```
 *
 * Both spellings are first-class; the bare-function form IS the declaration
 * `effect: 'pure'`, written the short way. Declaring `'writes'` does not grant
 * a function anything — it changes what the platform *reports* about the runs
 * that call it, which is the whole point: an undeclared writer is counted as
 * having written nothing.
 *
 * ## Where strictness on this shape actually binds (#4001 batch 11)
 *
 * At AUTHORING time, and only there — worth stating precisely, because the
 * campaign's rule is that a tightening claims no reach it does not have.
 * `defineStack({ functions })` parses this through
 * {@link FlowFunctionEntrySchema}, so `{ handler, efect: 'writes' }` is refused
 * where it was written. The BOOT path does not re-parse: `AppPlugin` and
 * `hook-binder` read entries with the hand-written
 * {@link normalizeFlowFunctionEntry} (re-validating a live callable every boot
 * buys nothing), so a stack that never went through `defineStack` is not gated
 * by this.
 *
 * That is exactly why the strictness matters rather than being redundant.
 * `normalizeFlowFunctionEntry` reads TWO keys and ignores the rest by
 * construction, so before this change a misspelled `effect` was dropped at the
 * schema and then *not looked for* by the reader — and the failure is the quiet
 * direction: the function is registered, it runs, and its writes are counted as
 * none, so #4354's broken-sweep query stays silent on the one flow that needed
 * it. (A misspelled `effect` VALUE — `'write'` — already fails loudly-ish:
 * `normalizeFlowFunctionEntry` degrades it to `'writes'` and surfaces the raw
 * string. A misspelled KEY had no such backstop.)
 */
export const FlowFunctionDeclarationSchema = lazySchema(() => strictObject({
  surface: 'this `functions` entry',
  aliases: {
    // A different word for "the callable", from the shapes an author has just
    // been writing: hooks/jobs/endpoints in this repo all name theirs `handler`
    // too, but `fn`/`callback`/`execute`/`run` are what the short forms in
    // other products call it, and none is within edit distance of `handler`.
    fn: 'handler',
    func: 'handler',
    callback: 'handler',
    execute: 'handler',
    run: 'handler',
    // `effects` (plural) is one edit away and the distance fallback gets it;
    // `writes`/`sideEffects` are the concept named instead of the key.
    sideEffects: 'effect',
    writes: 'effect',
  },
  guidance: {
    name:
      'A function is named by its KEY in the `functions` map (`functions: { scoreLead: {…} }`), ' +
      'not by a `name` inside the entry. The array form `functions: [{ name, handler }]` does ' +
      'take one — but that is the array entry\'s own shape, not this record.',
  },
  history:
    'Until #4001 these were dropped silently — and `normalizeFlowFunctionEntry` reads only ' +
    '`handler`/`effect` by construction, so a misspelled `effect` was discarded twice over: ' +
    'the function still registered, still ran, and its writes were still counted as none, ' +
    'which is what keeps #4354\'s broken-sweep alert quiet on the run that needed it.',
}, {
  handler: z.function().describe('The function invoked by name (a `script` node, a string-named Hook/Action handler)'),
  effect: FlowFunctionEffectSchema.default(DEFAULT_FLOW_FUNCTION_EFFECT)
    .describe("What the function does to data — omit for the pure default"),
}).describe('A named handler function plus its declared effect (#4396)'));

export type FlowFunctionDeclaration = z.infer<typeof FlowFunctionDeclarationSchema>;
/** Post-parse shape of {@link FlowFunctionDeclaration} — defaults applied, transforms run (ADR-0122). */
export type FlowFunctionDeclarationParsed = z.infer<typeof FlowFunctionDeclarationSchema>;
export type FlowFunctionDeclarationInput = z.input<typeof FlowFunctionDeclarationSchema>;

/**
 * One entry of the `functions` map: the handler alone (pure), a
 * {@link FlowFunctionDeclarationSchema} that states its effect, or the
 * **lowered handler ref** a built artifact carries.
 *
 * The first two are what an author writes. The third is what `objectstack
 * build` produces and was, until #4343, the reason `defineStack({ functions })`
 * could not survive a build at all: the CLI lowers every inline callable to a
 * serialisable string ref BEFORE the stack is parsed (it must — `z.function()`
 * wraps callables and would break the ref mapping), so the manifest reaching
 * this schema holds `{ myFn: 'myFn' }`, which neither of the other two members
 * accepts. The build failed on a mechanism its own docs call first-class.
 *
 * A string entry carries no callable, and that is correct rather than lossy:
 * the real functions ride in the sibling ESM module esbuild emits, and
 * {@link collectBundleFunctionEntries} merges both sources by name. The string
 * is the artifact's record that the NAME exists — which is why
 * {@link normalizeFlowFunctionEntry} deliberately drops it (see there).
 *
 * Authoring a string by hand therefore registers nothing. It fails loudly, not
 * silently: a `script` node naming it refuses at execute with "no function
 * named '…' is registered" (#1870).
 */
export const FlowFunctionEntrySchema = lazySchema(() => z.union([
  z.function(),
  FlowFunctionDeclarationSchema,
  z.string().min(1).describe('A lowered handler ref (built artifacts) — the callable rides in the sibling ESM module'),
]).describe('A named handler function, a declaration record stating its effect, or a lowered handler ref'));

export type FlowFunctionEntry = z.infer<typeof FlowFunctionEntrySchema>;
/** Post-parse shape of {@link FlowFunctionEntry} — defaults applied, transforms run (ADR-0122). */
export type FlowFunctionEntryParsed = z.infer<typeof FlowFunctionEntrySchema>;

/** Any callable registerable under a name (a hook body, a flow function). */
export type FlowFunctionCallable = (...args: never[]) => unknown;

/** A `functions` entry read back in one shape, whichever way it was written. */
export interface NormalizedFlowFunction {
  readonly handler: FlowFunctionCallable;
  readonly effect: FlowFunctionEffect;
  /**
   * Set to the raw value when `effect` was present but not a member of
   * {@link FlowFunctionEffectSchema} — a typo (`'write'`) on a path that
   * skipped `defineStack`'s parse. `effect` then reads `'writes'`, because a
   * declaration the platform cannot read means "cannot say this ran clean",
   * never "it wrote nothing"; the caller surfaces the raw value so the typo is
   * fixable rather than permanently costing the run its measurement.
   */
  readonly unrecognizedEffect?: unknown;
}

/** True for a member of {@link FlowFunctionEffectSchema}. */
export function isFlowFunctionEffect(value: unknown): value is FlowFunctionEffect {
  return value === 'pure' || value === 'writes';
}

/**
 * Read a `functions` map entry — the bare handler or the declaration record —
 * into one normalized shape. Returns `undefined` when the entry carries no
 * callable at all (the value every collector already drops).
 *
 * Deliberately hand-written rather than a `FlowFunctionEntrySchema.parse()`:
 * the entry holds a live function, and the collectors that call this run on the
 * boot path where re-parsing every handler buys nothing.
 *
 * A lowered string ref (the third member of that schema) returns `undefined`
 * here BY DESIGN — it names a function without carrying one. The callable for
 * that name comes from the built sidecar module, which the same collector
 * merges in; treating the string as an entry would register a name bound to
 * nothing.
 */
export function normalizeFlowFunctionEntry(entry: unknown): NormalizedFlowFunction | undefined {
  if (typeof entry === 'function') {
    return { handler: entry as FlowFunctionCallable, effect: DEFAULT_FLOW_FUNCTION_EFFECT };
  }
  if (!entry || typeof entry !== 'object') return undefined;
  const record = entry as { handler?: unknown; effect?: unknown };
  if (typeof record.handler !== 'function') return undefined;
  const handler = record.handler as FlowFunctionCallable;
  if (record.effect === undefined) return { handler, effect: DEFAULT_FLOW_FUNCTION_EFFECT };
  if (isFlowFunctionEffect(record.effect)) return { handler, effect: record.effect };
  return { handler, effect: 'writes', unrecognizedEffect: record.effect };
}
