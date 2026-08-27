// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declarative Hook Wrappers
 *
 * Turns a raw `HookHandler` into one that honours the declarative metadata
 * fields defined on `HookSchema` (`condition`, `async`, `retryPolicy`,
 * `timeout`, `onError`). This lives outside the engine's `triggerHooks`
 * loop so the engine stays minimal and the semantics are unit-testable in
 * isolation.
 *
 * The resulting wrapped handler keeps the original `(ctx) => Promise<void>`
 * signature, so `engine.registerHook` does not need to know anything about
 * the metadata-driven behaviours.
 */
import type { Hook, HookContext } from '@objectstack/spec/data';
import { HookSchema } from '@objectstack/spec/data';
import type { Expression } from '@objectstack/spec';
import type { Logger } from '@objectstack/spec/contracts';
import type { HookHandler } from './engine.js';
import { ExpressionEngine } from '@objectstack/formula';
import { noopHookMetricsRecorder, type HookMetricsRecorder, type HookMetricOutcome } from './hook-metrics.js';
import { materializeDeclaredFields } from './declared-fields.js';
import { describeCelFault, type CelFault } from './cel-fault.js';

/**
 * The logger the hook layer writes its diagnostics to — the `Logger` CONTRACT
 * (`@objectstack/spec/contracts`), narrowed to the four levels this layer uses.
 *
 * ## Why this is a `Pick` of the contract and not a local shape (#5637)
 *
 * Both hook modules used to declare their own four-method logger shape, and
 * that local shape spelled `error` as `(msg, meta?)` — the OPPOSITE of the
 * contract, whose second parameter is an `Error` and whose `meta` is THIRD.
 * The contract's type satisfies the local shape structurally (a function of
 * fewer parameters is assignable, and `any` is compatible in both directions),
 * so `tsc` never said a word: the conflict lived only at runtime.
 *
 * It stayed invisible because the injected implementation happened to be
 * `ObjectLogger`, which dispatches its second argument BY SHAPE
 * (`errorOrMeta instanceof Error`) and so recorded a meta object in the `Error`
 * slot anyway. The contract's other two implementations —
 * `ConsoleLogger` / `JsonLogger` in `@objectstack/observability` — follow the
 * contract literally: the meta object lands in the `error` slot, `error.message`
 * and `error.stack` read `undefined`, `meta` IS `undefined`, and every field of
 * the diagnostic disappears, leaving a bare sentence. The symptom ("the log
 * lost its fields") is close to unattributable at the host that first hits it.
 *
 * So the shape is taken from the contract rather than re-typed here (Prime
 * Directive #12: one contract, no consumer-side dialects) — a `Pick` of exactly
 * what this layer calls, so a caller owes these four methods and nothing more.
 * A full `Logger` satisfies it unchanged, which is what every production caller
 * passes (`ctx.logger` / `engine.logger`).
 */
export type HookDiagnosticsLogger = Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;

export interface WrapDeclarativeOptions {
  /** Logger for declarative-layer diagnostics (timeouts, retries, swallowed errors). */
  logger?: HookDiagnosticsLogger;
  /** Optional per-execution metrics sink. Defaults to no-op. */
  metrics?: HookMetricsRecorder;
}

const noopLogger: HookDiagnosticsLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The values `HookSchema` declares for an omitted `retryPolicy` key — READ from
 * the declaration, never restated here (#6832).
 *
 * `wrapDeclarativeHook` used to answer "how many times does an under-specified
 * hook retry?" with a hand-written `?? 0`, while `hook.zod.ts` answered `3` (and
 * `1000` for the backoff). Which number you got depended on whether the metadata
 * had been through `HookSchema` — `defineStack` / `PUT /meta` / Studio parse and
 * got 3, this public export and `hook-binder.ts`'s own call did not and got 0.
 * That is verbatim the divergence #4247 removed from flow `errorHandling`, whose
 * ruling `flow.zod.ts` still carries: **one contract, one number**. Reading the
 * numbers out of the schema is what makes there be only one — a third key added
 * to `hook.retryPolicy` needs no edit on this side.
 *
 * The value is resolved on first use, not at module load: `HookSchema` is a
 * `lazySchema` precisely so its closures are never allocated in a process that
 * binds no hooks.
 */
let declaredRetryPolicy: { maxRetries: number; backoffMs: number } | undefined;
function retryPolicyDefaults(): { maxRetries: number; backoffMs: number } {
  // Parsing `{}` asks the schema what an empty-but-present block means, which is
  // exactly the question the executor has to answer. `.unwrap()` steps past the
  // `.optional()`; the ABSENCE of the block is a different question, answered at
  // the call site.
  declaredRetryPolicy ??= HookSchema.shape.retryPolicy.unwrap().parse({});
  return declaredRetryPolicy;
}

/**
 * A hook declared a `condition` and the platform could not work out its value
 * (#4775). Thrown from the condition gate, which aborts the operation.
 *
 * ## Why an unevaluable condition is not `false`
 *
 * "The expression said no" and "the platform could not work out what the
 * expression says" used to collapse into the same outcome — `logger.warn` and
 * `return false` — and that single result carries OPPOSITE risks depending on
 * the hook:
 *
 *   - a `before*` guard ("hold this write when the condition is met") swallowed
 *     into `false` LETS THROUGH a write it was declared to stop;
 *   - an `after*` audit ("leave a trace when the condition is met") swallowed
 *     into `false` DROPS a record that was supposed to exist — an invisible
 *     absence, since nobody goes looking for a row they don't know should be
 *     there.
 *
 * So a declared condition the platform cannot evaluate is `declared ≠
 * enforced`, and the resolution is the one #4649 already chose for validation
 * predicates one module over: reject loudly, naming the hook and the key that
 * would not resolve. `before*` and `after*` take the SAME direction —
 * deliberately, and knowing the cost: a typo in an `afterUpdate` audit
 * condition fails the write it was only watching. One rule, one answer; the
 * platform does not grow a hidden second rule that says "which way this fails
 * depends on the event name".
 *
 * ## It is NOT an `onError` case
 *
 * `onError` (`abort` | `log`) governs a HANDLER that threw. The condition gate
 * runs BEFORE the handler is ever reached, so this error is raised outside its
 * reach on purpose: routing it through `onError` would let `onError: 'log'`
 * resurrect exactly the silent skip this error exists to abolish, and would
 * mint a third set of semantics for the same word.
 */
/**
 * ⛔ RETIRED — `HookConditionLimitation` and its two members
 * (`bulk_write_previous_unbound`, `bulk_write_stored_state_unavailable`), with
 * the `isPredicateBulkWrite` predicate and the `predicateBulkWrite` flag that
 * produced them. #5574's engine half, ADR-0049 enforce-or-remove. Do not
 * reintroduce any of them.
 *
 * ## Why they existed
 *
 * #5037 shipped them for a real gap: on a predicate (`multi: true`) write the
 * `before*` phase was dispatched ONCE for the whole batch, on a context with no
 * `input.id` and no `previous`. A condition reading `previous` was therefore
 * unevaluable, and since #4775 unevaluable ABORTS the write — so the author got
 * a rejection that read like a typo report for an expression that was
 * perfectly well formed. The `limitation` discriminator existed so a caller
 * could tell "your hook is wrong" from "this event cannot do that" without
 * matching on message text.
 *
 * #5038 retired them for the `after*` phase by making it per row. Addendum I
 * kept them alive for `before*`, arguing the batch dispatch was not a version
 * gap but what the phase IS.
 *
 * ## Why they are gone
 *
 * ADR-0058 Addendum II (#5574 ruling B) reversed that argument on measured
 * evidence and made the `before*` phase per row too. Both ends of the
 * declaration are now empty, and this is what that was verified against on the
 * delivering tree:
 *
 *  - **No producer.** `isPredicateBulkWrite`'s whole test was "no `input.id`
 *    and `options.multi`". Every context the engine now dispatches on a
 *    predicate write — both phases — arrives with `input.id` bound to its row,
 *    so the predicate answered `false` everywhere and the branch that set both
 *    members was unreachable. The batch-scoped `hookContext` still exists
 *    inside `update()`/`delete()`, but it is never handed to `triggerHooks`:
 *    the per-row loop runs whenever `hasHooksFor` is true, and when it is false
 *    no handler runs at all. So no handler can observe one.
 *  - **No reachable consumer.** Nothing outside this file and its own tests
 *    ever read `.limitation` or `.predicateBulkWrite`.
 *
 * A discriminator with neither is not a diagnostic, it is a promise the
 * platform has stopped keeping — the exact `declared ≠ enforced` shape
 * ADR-0049 exists to remove. What replaced it is not a better message but the
 * absence of the condition it described: a `previous`-reading `before*`
 * condition on a bulk write now EVALUATES, per row, as authored. The pins live
 * in `hook-condition-bulk-previous.test.ts`.
 *
 * The `HookConditionError` that carried them is NOT retired — an unevaluable
 * or uncompilable condition still aborts the operation (#4775). Only the
 * bulk-write branch of its diagnosis is gone.
 *
 * ## What did NOT change with them: no discriminator here is ever `error.code`
 *
 * `limitation` was deliberately not named `code`, and that rule OUTLIVES it —
 * it governs every field this class carries now (`reason`, `fault`,
 * `missingKey`) and any future one. ADR-0112 makes `error.code` a CLOSED wire
 * vocabulary (`StandardErrorCode` ∪ `ERROR_CODE_LEDGER`, both declared in
 * `packages/spec/src/api/`), and `rest-server.ts` promotes a thrown error's
 * `.code` straight onto the response envelope. A `.code` added here would
 * therefore mint an unregistered wire code by SIDE EFFECT — the exact
 * `declared ≠ enforced` shape that vocabulary exists to prevent. If one of
 * these facts ever needs to travel on the wire it goes through the ledger, as a
 * decision, not as a property that happens to be named `code`.
 */
export class HookConditionError extends Error {
  override readonly name = 'HookConditionError';
  /** The hook whose declared condition could not be evaluated. */
  readonly hook: string;
  readonly object?: string;
  readonly event?: string;
  /** The condition source, verbatim as authored. */
  readonly condition: string;
  /** `unevaluable` — compiled, but faulted on this record;
   *  `uncompilable` — never compiled at all. */
  readonly reason: 'unevaluable' | 'uncompilable';
  /** One-line CEL fault summary (`kind: message`). */
  readonly fault: string;
  /** The key the expression read that the record does not carry, when known. */
  readonly missingKey?: string;

  constructor(message: string, info: {
    hook: string;
    object?: string;
    event?: string;
    condition: string;
    reason: 'unevaluable' | 'uncompilable';
    fault: string;
    missingKey?: string;
  }) {
    super(message);
    this.hook = info.hook;
    this.object = info.object;
    this.event = info.event;
    this.condition = info.condition;
    this.reason = info.reason;
    this.fault = info.fault;
    this.missingKey = info.missingKey;
  }
}

/**
 * Wrap a hook handler so it honours the declarative fields defined on
 * `HookSchema`. The wrapping order, from outermost to innermost, is:
 *
 *   1. condition  → skip when the formula evaluates FALSE; abort the operation
 *                   when it cannot be evaluated at all (#4775)
 *   2. async      → fire-and-forget (after* events only)
 *   3. retry      → repeat on throw with backoff
 *   4. timeout    → abort if handler runs too long
 *   5. onError    → swallow when set to 'log'
 *
 * Step 1 sits OUTSIDE steps 2–5 on purpose. `async`, `retryPolicy`, `timeout`
 * and `onError` are all about running the HANDLER; the condition decides
 * whether there is a handler run at all. So a `HookConditionError` is not
 * retried, is not fire-and-forgotten, and is never softened by
 * `onError: 'log'` — see that class for why routing it through `onError` was
 * refused.
 *
 * The condition formula is evaluated against two bindings, the same two a
 * validation predicate reads (#4784):
 *
 *   - `record`   — the record-shaped view built by {@link pickRecordPayload}:
 *     for a write, the stored record overlaid with this write's payload, made
 *     total over the object's declared fields (#4770). Read events carry no
 *     record at all, so since #4775 a `record.*` condition on a `beforeFind`
 *     REJECTS the read rather than quietly skipping — the hook was declared to
 *     gate on a field the event does not have, and that is an authoring error
 *     the platform can no longer paper over.
 *   - `previous` — the record's pre-write state, built by
 *     {@link pickPreviousPayload}: `ctx.previous`, made total over the same
 *     declared fields. Absent (an unbound CEL identifier) whenever the prior
 *     state is not in hand, exactly as on the validation side.
 *
 * `previous` is what makes a TRANSITION expressible. Since #4770 `record` is
 * the record's STATE, so `record.done == true` is true on every update of an
 * already-done row; "just became done" is `previous.done != true &&
 * record.done == true`.
 */
export function wrapDeclarativeHook(
  meta: Hook,
  handler: HookHandler,
  opts: WrapDeclarativeOptions = {},
): HookHandler {
  const logger = opts.logger ?? noopLogger;
  const metrics = opts.metrics ?? noopHookMetricsRecorder;
  const isAfterEvent = meta.events?.some((e) => typeof e === 'string' && e.startsWith('after')) ?? false;
  const hasBody = Boolean((meta as any).body);
  const labelFor = (ctx: HookContext) => ({
    hook: meta.name,
    object: ctx.object ?? (typeof (meta as any).object === 'string' ? (meta as any).object : undefined),
    event: ctx.event,
    body: hasBody,
  });

  // Pre-compile condition once so each invocation is cheap.
  let conditionFn: ((ctx: HookContext) => boolean) | undefined;
  if (meta.condition) {
    // Accept either string shorthand or full Expression envelope.
    const expr: Expression = typeof meta.condition === 'string'
      ? { dialect: 'cel', source: meta.condition }
      : (meta.condition as Expression);
    if (expr.source && expr.source.trim()) {
      const source = expr.source;
      const check = ExpressionEngine.compile(expr);
      if (check.ok) {
        conditionFn = (ctx: HookContext) => {
          // `previous` is passed through as-is: `undefined` means the binding
          // is OMITTED from the CEL scope (see `buildScope` in
          // @objectstack/formula), which is exactly what the validation side
          // does when no prior record is in hand. Binding it to an empty
          // object instead would answer `previous.x == null` with a
          // fabricated "yes" for a record whose prior state is unknown.
          const record = pickRecordPayload(ctx);
          const previous = pickPreviousPayload(ctx);
          const r = ExpressionEngine.evaluate<boolean>(expr, { record: record ?? {}, previous });
          if (!r.ok) {
            // [#4775] Fail LOUD. Not `false` — see `HookConditionError`.
            throw unevaluableConditionError(meta, ctx, source, r.error);
          }
          return Boolean(r.value);
        };
      } else {
        // [#4775] A condition that never compiled is the same defect one step
        // earlier, and its old treatment ("condition ignored") was the WORSE
        // half of the swallow: the gate disappeared entirely, so the hook fired
        // on every write as though no condition had been declared. Reported at
        // invocation rather than at bind time — a throw here would wedge boot
        // for an app whose object nobody is even writing, and #4775's remit is
        // to abort THE OPERATION that runs a broken hook.
        const fault = check.error;
        conditionFn = (ctx: HookContext) => {
          throw uncompilableConditionError(meta, ctx, source, fault);
        };
        // Contract arg order (#5637): `error(message, error?: Error, meta?)`.
        // The fault in hand is a `CelFault` (`{ kind, message }`), not an
        // `Error`, so the Error slot is genuinely empty and the diagnostic
        // travels as meta — where every implementation of the contract reads it.
        logger.error('[hook] condition formula failed to compile; every operation on this hook\'s object will be rejected until it is fixed', undefined, {
          hook: meta.name,
          condition: source,
          error: check.error.message,
        });
      }
    }
  }

  // `retryPolicy` is `.optional()` with NO `.default({})`, so the block's ABSENCE
  // and its EMPTINESS are two different declarations and stay two different
  // answers (#6832):
  //
  //   - no `retryPolicy` at all      → no retry policy was declared → 0 / 0, and
  //     the parsed path agrees: `HookSchema` leaves the key `undefined`.
  //   - `retryPolicy: {}`, or a block with only one key set → the author DID ask
  //     for retries; each omitted key takes the value the schema declares for it.
  //
  // Only the second case was broken. #4247's answer — delete the executor's
  // fallback and let the parsed default stand — does not transplant here, because
  // the whole point is a path that never parses; and its mirror image, a bare
  // `?? 3`, would be worse than the defect: every hook that never wrote a
  // `retryPolicy` would start retrying three times.
  const declaredRetry = meta.retryPolicy ? retryPolicyDefaults() : undefined;
  const retryMax = Math.max(0, Number(meta.retryPolicy?.maxRetries ?? declaredRetry?.maxRetries ?? 0));
  const retryBackoffMs = Math.max(0, Number(meta.retryPolicy?.backoffMs ?? declaredRetry?.backoffMs ?? 0));
  const timeoutMs = typeof meta.timeout === 'number' && meta.timeout > 0 ? meta.timeout : undefined;
  const onError = meta.onError ?? 'abort';
  // `async` is only meaningful for after* events; ignore on before* (we must
  // wait for the handler to potentially mutate ctx.input).
  const fireAndForget = Boolean(meta.async) && isAfterEvent;

  const runWithTimeout = async (ctx: HookContext): Promise<void> => {
    if (!timeoutMs) {
      await handler(ctx);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => handler(ctx)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Hook '${meta.name}' timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const runWithRetry = async (ctx: HookContext): Promise<void> => {
    let attempt = 0;
    let lastErr: unknown;
    // attempts = 1 + retryMax
    while (attempt <= retryMax) {
      try {
        await runWithTimeout(ctx);
        return;
      } catch (err) {
        lastErr = err;
        attempt += 1;
        if (attempt > retryMax) break;
        if (retryBackoffMs > 0) {
          await new Promise((r) => setTimeout(r, retryBackoffMs * attempt));
        }
        try { metrics.recordRetry(labelFor(ctx), attempt); } catch { /* noop */ }
        logger.warn('[hook] retrying after failure', {
          hook: meta.name,
          attempt,
          maxRetries: retryMax,
          error: (err as any)?.message,
        });
      }
    }
    throw lastErr;
  };

  const runWithErrorPolicy = async (ctx: HookContext): Promise<void> => {
    try {
      await runWithRetry(ctx);
    } catch (err) {
      if (onError === 'log') {
        // Contract arg order (#5637). `err` is `unknown` — a hook handler may
        // throw anything — so it is not put in the `Error` slot; its message
        // is already carried in the meta bag, which is the third parameter.
        logger.error('[hook] handler failed (onError=log; suppressing)', undefined, {
          hook: meta.name,
          object: ctx.object,
          event: ctx.event,
          error: (err as any)?.message,
        });
        return;
      }
      throw err;
    }
  };

  return async (ctx: HookContext): Promise<void> => {
    // 1. Condition gate. Throws (#4775) when the condition cannot be
    //    evaluated — deliberately OUTSIDE `runWithErrorPolicy`, so `onError`
    //    never sees it and cannot soften it back into a silent skip.
    if (conditionFn) {
      if (!conditionFn(ctx)) {
        logger.debug('[hook] skipped by condition', {
          hook: meta.name,
          object: ctx.object,
          event: ctx.event,
        });
        try { metrics.recordSkip(labelFor(ctx), 'condition'); } catch { /* noop */ }
        return;
      }
    }

    const restore = installFlatInput(ctx);
    const startedAt = Date.now();

    const recordOutcome = (err?: any) => {
      const elapsed = Date.now() - startedAt;
      let outcome: HookMetricOutcome = 'success';
      if (err) {
        const msg = String(err?.message ?? err ?? '');
        if (/timed out after/i.test(msg)) outcome = 'timeout';
        else if (/capability|cap-rejection|capability_rejected/i.test(msg)) outcome = 'capability_rejected';
        else outcome = 'error';
      }
      try { metrics.recordExecution(labelFor(ctx), outcome, elapsed); } catch { /* noop */ }
    };

    try {
      // 2. Fire-and-forget for declarative async after* hooks
      if (fireAndForget) {
        try { metrics.recordSkip(labelFor(ctx), 'fire_and_forget'); } catch { /* noop */ }
        // For fire-and-forget we can't keep ctx.input swapped while the
        // engine moves on — copy what we need, restore, and run async.
        void runWithErrorPolicy(ctx)
          .then(() => recordOutcome())
          .catch((err) => {
            recordOutcome(err);
            // Contract arg order (#5637) — see the `onError=log` site above.
            logger.error('[hook] async handler error (fire-and-forget)', undefined, {
              hook: meta.name,
              error: (err as any)?.message,
            });
          });
        return;
      }

      try {
        await runWithErrorPolicy(ctx);
        recordOutcome();
      } catch (err) {
        recordOutcome(err);
        throw err;
      }
    } finally {
      restore();
    }
  };
}

/**
 * Swap `ctx.input` in place for a Proxy that exposes a flat record view
 * over the engine's `{ data, options, id? }` wrapper. Returns a function
 * that restores the original `ctx.input` reference. Reads of
 * `id` / `options` / `ast` / `data` fall through to the wrapper; reads
 * of any other key fall through to `data`. Writes always go to `data`
 * (creating it if missing) so the engine's downstream `input.data`
 * read picks up mutations made by user code as `input.field = value`.
 * "Writes" means every mutation JS has, not assignment alone: `delete` and
 * `Object.defineProperty` route into `data` too (#12277).
 *
 * [#12601] ⚠️ `id` / `options` / `ast` / `data` are RESERVED on this flat
 * face — EVERY instrument (`get`, `getOwnPropertyDescriptor`, `ownKeys`,
 * `has`, spread, `Object.entries`) resolves one of these four names against
 * the WRAPPER, never the payload, even when the payload itself declares a
 * field sharing the name. That field does not vanish — it still round-trips
 * through storage exactly as declared — it is simply not reachable through
 * `ctx.input.<name>`; reach it at `ctx.input.data.<name>` instead. See the
 * `get` and `getOwnPropertyDescriptor` traps below for the instrument-by-
 * instrument account, and `content/docs/automation/hooks.mdx` (Hook Context)
 * for the author-facing statement of the same rule.
 *
 * [#12603] ⛔ SYMBOL keys are REFUSED, not routed. `set` and `defineProperty`
 * throw a `TypeError` for a symbol-keyed write instead of letting it reach
 * `data` — see those two traps below for the refusal and
 * `refuseSymbolPayloadKey` for the error text. See "Symbol keys" below the
 * reserved-name callout in `content/docs/automation/hooks.mdx`.
 */

/**
 * [#12603] Maintainer ruling, 2026-08-27, Option C refusal arm: a record
 * payload is a declarable, string-keyed field set — no metadata schema can
 * declare a symbol field, so a symbol key on this flat `ctx.input` face is a
 * JS-runtime artifact leaking toward storage, not a legal payload field.
 *
 * Thrown from the `set` and `defineProperty` traps, BEFORE either touches
 * `data` — so a refused write never persists and never needs hiding from
 * enumeration. That is the shape change from the pre-#12603 state: a
 * symbol-keyed write used to succeed silently, reach `data`, and persist,
 * while only `Object.getOwnPropertySymbols` / `Reflect.ownKeys` omitted it
 * (pinned open in `hook-input-ownkeys-agreement.test.ts` under #12578). Hiding
 * a key the engine nonetheless persisted is exactly the shape #12277, #12397
 * and #12578 exist to abolish; refusing the write outright is the other way
 * to close that gap, and the one this ruling chose (Option B — publish
 * symbols via `Reflect.ownKeys` — was declined for minting an undeclarable
 * key kind as contract).
 *
 * A plain `TypeError`, not a new subclass: this fires from INSIDE the hook
 * BODY (an author wrote `input[sym] = …`), the same category as the native
 * `TypeError` the `defineProperty` trap already lets through for a
 * non-configurable descriptor the target does not carry (see that trap's own
 * comment) — an author-code defect, not a declarative-layer diagnostic like
 * `HookConditionError`. It is therefore subject to the ordinary handler error
 * path: `onError: 'log'` can swallow it, `retryPolicy` can retry it, exactly
 * as any other throw from the handler body (unlike `HookConditionError`,
 * which is deliberately raised OUTSIDE that path — see the comment on that
 * class for why the two are not the same shape).
 *
 * The message names the key kind (a symbol, not "a bad key"), the surface
 * (hook input), and the fix (a string key, or keep the value off the payload)
 * — written for the accidental case the ruling calls out: an author spreading
 * an object that happens to carry a symbol-keyed cache entry onto `ctx.input`.
 */
function refuseSymbolPayloadKey(prop: symbol, trap: 'set' | 'defineProperty'): never {
  const verb = trap === 'set' ? 'Cannot set' : 'Cannot define';
  throw new TypeError(
    `${verb} ${String(prop)} on hook input: a symbol key is not a valid record-payload field. ` +
    'A record payload is a declarable, string-keyed field set — no metadata schema can declare ' +
    'a symbol field, so a symbol key here would be a JS-runtime artifact leaking toward storage. ' +
    'Use a string key, or keep the value off the payload entirely (e.g. a local variable) if it ' +
    'is not meant to be stored. This often happens by accident, such as spreading an object that ' +
    'carries a symbol-keyed cache entry onto ctx.input.'
  );
}

function installFlatInput(ctx: HookContext): () => void {
  const raw: any = ctx.input ?? {};
  const looksWrapped =
    raw && typeof raw === 'object' &&
    ('data' in raw || 'options' in raw || 'id' in raw || 'ast' in raw);
  if (!looksWrapped) return () => {};

  const ensureData = (): Record<string, unknown> => {
    if (!raw.data || typeof raw.data !== 'object') {
      raw.data = {};
    }
    return raw.data as Record<string, unknown>;
  };

  const proxy = new Proxy(raw, {
    // [#12601] Reserved-name precedence STARTS here: an unconditional,
    // wrapper-only read for the four names, never falling through to `data`
    // even when `data` owns a same-named field, and even when the WRAPPER
    // itself does not (an insert-shaped envelope with no `id` reads
    // `undefined`, not the payload's `id`). Every other trap that touches
    // these four names (`getOwnPropertyDescriptor`, `has`) is written to
    // agree with this one — this is the trap the others were made to match,
    // not a peer that could equally have been changed instead.
    get(target, prop, receiver) {
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        return Reflect.get(target, prop, receiver);
      }
      const data = target.data;
      if (data && typeof data === 'object' && prop in data) {
        return (data as any)[prop];
      }
      return Reflect.get(target, prop, receiver);
    },
    // [#12603] Symbol keys are REFUSED here, before anything else runs — a
    // symbol can never equal one of the four reserved (string) names, so the
    // check can sit first without disturbing that branch below. See
    // `refuseSymbolPayloadKey` for why this throws instead of routing.
    set(target, prop, value) {
      if (typeof prop === 'symbol') {
        refuseSymbolPayloadKey(prop, 'set');
      }
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        (target as any)[prop] = value;
        return true;
      }
      ensureData()[prop as string] = value;
      return true;
    },
    // [#12277] The mutation traps are a SET, not a list: every operation JS
    // offers for changing a property has to land in `data`, because `data` is
    // the object the engine persists. `set` alone was trapped, so
    // `delete input.x` and `Object.defineProperty(input, 'x', …)` fell through
    // to `Reflect.*` on the WRAPPER — one level above the record — and did
    // nothing to the row while reporting success.
    //
    // The two gaps had different shapes, and the worse-shaped one is the one
    // nobody reported:
    //
    //   - `delete input.x` returned `true` and changed nothing. The other
    //     read-backs stayed HONEST (`'x' in input`, `input.x`,
    //     `Object.keys(input)` all still showed the key), so the lie was
    //     confined to `delete`'s own return value.
    //   - `Object.defineProperty(input, 'x', …)` defined on the wrapper, and
    //     the `get` trap's fall-through to the wrapper then READ IT BACK — so
    //     `input.x` confirmed a write that never reached `data`. That is the
    //     shape with no instrument to catch it from inside a hook.
    //
    // Measured cost of the `delete` half before this landed: a guest-intake
    // app stripped the fields an anonymous submitter must not write with 15
    // `delete` statements, every one inert, and its unit tests stayed green
    // because they drive the handler with a plain object.
    //
    // `deleteProperty` deliberately does NOT call `ensureData()`: with no
    // `data` on the wrapper, `get` reads fall through to the wrapper itself,
    // so that is where the key would live and where the delete belongs.
    // Materialising an empty `data` just to delete out of it would be a write
    // performed by a removal.
    deleteProperty(target, prop) {
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        return Reflect.deleteProperty(target, prop);
      }
      const data = target.data;
      if (data && typeof data === 'object') {
        return Reflect.deleteProperty(data as object, prop);
      }
      return Reflect.deleteProperty(target, prop);
    },
    // Routed for the same reason `set` is. One inherited JS invariant is worth
    // naming: a proxy may not report success for an explicitly
    // `configurable: false` descriptor the TARGET does not carry, so
    // `Object.defineProperty(input, 'x', { value: 1, configurable: false })`
    // now throws a TypeError where it used to silently define on the wrapper.
    // A throw is a diagnosis; the silence was not. Omitting `configurable`
    // entirely (the common spelling, and every spelling `Object.assign` and
    // spread produce) is unaffected.
    //
    // [#12603] Symbol keys are refused here too, identically to `set` and for
    // the same reason — see `refuseSymbolPayloadKey`.
    defineProperty(target, prop, desc) {
      if (typeof prop === 'symbol') {
        refuseSymbolPayloadKey(prop, 'defineProperty');
      }
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        return Reflect.defineProperty(target, prop, desc);
      }
      return Reflect.defineProperty(ensureData(), prop, desc);
    },
    // [#12603] `deleteProperty` is deliberately NOT guarded: since `set` and
    // `defineProperty` now refuse every symbol-keyed write before it reaches
    // `data`, a symbol key can never be there to delete. `delete input[sym]`
    // falls through exactly as it always has for any key `data` does not
    // own — a harmless no-op reporting success, not a persistence lie.
    has(target, prop) {
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        return prop in target;
      }
      const data = target.data;
      if (data && typeof data === 'object' && prop in data) return true;
      return prop in target;
    },
    // [#12578] Reports the record payload's OWN key set — not its ENUMERABLE
    // subset. The trap answered from `Object.keys(data)`, which filters by
    // `enumerable`, and that filtering was incidental to what the trap is for:
    // hiding the WRAPPER keys. The two are different exclusions, and reading
    // one through the other cost a key.
    //
    // `[[OwnPropertyKeys]]` is the wrong place to apply an enumerability
    // filter, because every consumer that wants one applies it itself, one
    // layer up and through the descriptor trap: `Object.keys`, spread,
    // `Object.entries`, `for…in` and `JSON.stringify` all walk this list and
    // then drop what is not `enumerable`. Filtering here too does not make
    // those answers cleaner — it only starves the surfaces that ask for the
    // whole set, `Object.getOwnPropertyNames` and `Reflect.ownKeys`, which is
    // exactly what those two are for.
    //
    // #12277 routed `defineProperty` into `data`, so a hook can now put a
    // non-default-attribute key on the payload, and #12397 made the descriptor
    // trap mirror `data` instead of synthesising defaults. Measured on the
    // merged ref, for a key defined `{ enumerable: false }` on a payload the
    // engine then persisted with that key on it:
    //
    //   Object.getOwnPropertyDescriptor(input, 'k')   -> own, enumerable:false
    //   Object.prototype.hasOwnProperty.call(input,'k') -> true
    //   Object.getOwnPropertyNames(input)             -> ['subject']  <- not own?
    //
    // Three instruments, one payload, two answers about own-ness — the same
    // shape #12397 closed one trap over, and legal for a proxy (extensible
    // target, no non-configurable own key) but untrue. The enumerable face is
    // deliberately NOT changed by reporting the full set: `Object.keys`,
    // spread, `Object.entries` and `JSON.stringify` still omit a
    // non-enumerable key, because they filter through the descriptor trap,
    // which mirrors `data`. That is what keeps the sandbox snapshot contract
    // (`unwrapProxyToPlain`, `packages/runtime/src/sandbox/body-runner.ts` —
    // `Object.entries` over this proxy) materialising exactly the fields it
    // materialised before. Both halves are pinned in
    // `hook-input-ownkeys-agreement.test.ts`.
    //
    // WRAPPER KEYS remain excluded, which is what this trap exists for:
    // `id`/`options`/`ast`/`data` stay reachable by dot/bracket notation but
    // out of `Object.keys`/`for-in`, so the payload-diff idiom
    // `Object.keys(input).filter(k => input[k] !== previous[k])` sees record
    // fields only. The exclusion is achieved by reading `data` and never the
    // wrapper — NOT by subtracting those four names, which would hide a
    // genuine payload field that happens to be called `id`.
    //
    // [#12601] That deliberate non-subtraction is why a payload field sharing
    // one of the four names is still LISTED here when it exists — this trap
    // is unchanged by #12601 and stays that way. What #12601 fixed sits one
    // trap down: the descriptor trap used to answer such a listed key's VALUE
    // from `data` (the payload), while `get` and spread already answered it
    // from the wrapper (the envelope) — two instruments, one listed key, two
    // objects. The descriptor trap now checks the reserved names first too,
    // so a key this trap lists under a reserved name always resolves to the
    // SAME value everywhere it is read. See the descriptor trap's own comment
    // for the full account.
    //
    // [#12603] SYMBOL KEYS are absent here for a settled reason now, not an
    // open one: the maintainer ruling (2026-08-27, Option C refusal arm)
    // answered the payload-contract question this trap's comment used to
    // leave open ("may a record payload carry a symbol key at all?") with
    // NO — a record payload is a declarable, string-keyed field set, and no
    // metadata schema can declare a symbol field. `set` and `defineProperty`
    // now REFUSE a symbol-keyed write before it ever reaches `data` (see
    // `refuseSymbolPayloadKey`), so a symbol can no longer BE an own key of
    // `data` for this trap to omit or report.
    //
    // This trap itself is deliberately UNCHANGED by that ruling —
    // `Object.getOwnPropertyNames(target.data)` stays exactly what #12578
    // landed. `Reflect.ownKeys(data)` (Option B) was the alternative the
    // ruling declined: publishing symbols through enumeration would mint an
    // undeclarable key kind as contract, which is the opposite of what was
    // ruled. With the write refused at the boundary, the two spellings would
    // agree anyway — `data` can never carry a symbol key for them to differ
    // on — so there is no remaining reason to touch this line, and #12578's
    // own ruling (this card must not re-litigate `ownKeys`) forbids it.
    //
    // What used to be pinned OPEN in `hook-input-ownkeys-agreement.test.ts`
    // (the instrument disagreement, deliberately left standing) is now
    // pinned as a REFUSAL in the same file: the write throws, so there is no
    // persisted symbol key left for the three instruments to disagree about.
    ownKeys(target) {
      return target.data && typeof target.data === 'object'
        ? Object.getOwnPropertyNames(target.data)
        : [];
    },
    // [#12397] MIRRORS `data`'s own descriptor; it does not synthesise one.
    // The literal that stood here — `{ configurable: true, enumerable: true,
    // writable: true, value: data[prop] }` — happens to be the truth for every
    // key created by ordinary assignment, which is why it cost nothing while
    // assignment was the only way a key could arrive. #12277 routed
    // `defineProperty` into `data`, so a hook can now put a key on the record
    // payload with NON-DEFAULT attributes, and the synthesis kept reporting the
    // defaults: `Object.defineProperty(input, 'k', { enumerable: false, … })`
    // read back `enumerable: true` while `Object.keys(input)` — which reaches
    // the same key through `ownKeys`/`data` — correctly omitted it. Two
    // instruments, one payload, contradicting answers.
    //
    // `configurable` is the one attribute that CANNOT be mirrored. The proxy
    // target is the `{ data, options, id? }` wrapper, which does not carry the
    // record key at all, and a proxy may not report a property its target lacks
    // as non-configurable — so mirroring it verbatim throws `TypeError` on any
    // key `data` holds as `configurable: false`, and takes `Object.keys` and
    // spread down with it, since both reach every listed key through this trap.
    // It is therefore FORCED true and the rest mirrored. That forcing is the
    // proxy's own constraint, not a claim about the payload.
    //
    // Two consequences worth naming, both pinned in
    // `hook-input-descriptor-mirror.test.ts`:
    //
    //   - Reading a descriptor no longer RUNS author code. The synthesis
    //     evaluated `data[prop]` to fill `value`, so asking a payload holding
    //     an accessor for its descriptor invoked the getter; a mirror copies
    //     `get`/`set` across untouched.
    //   - `prop in data` is true for the whole prototype chain, so the
    //     synthesis answered for INHERITED keys too — `toString` reported as an
    //     own, enumerable, writable data property no payload has ever held.
    //     Only an own key has a descriptor to mirror; the rest fall through.
    //
    // What this trap deliberately does NOT decide: whether a record payload may
    // carry an accessor at all, and what the engine should do persisting one
    // (it persists a payload by evaluating it). That is a contract question
    // about the payload, and neither routing nor persistence is touched here —
    // the trap reports what is there, under every answer to it.
    //
    // [#12601] RESERVED-NAME PRECEDENCE mirrors `get`: checked FIRST, not last.
    // `id`/`options`/`ast`/`data` are PLATFORM names on the flat face — a
    // payload field sharing one of them is still a legal record field, but it
    // is not reachable through the flat face at all, `input.data.<name>` is
    // the only route to it. Before this fix the order was reversed (`data`
    // checked first, the reserved-name branch only reached when `data` did
    // not own the key), so a payload that genuinely declared a field called
    // `id` made this trap report the PAYLOAD's descriptor while `get` — which
    // has always checked the reserved names unconditionally, first — reported
    // the WRAPPER's value for the identical property access. Two instruments,
    // one key, two different objects:
    //
    //   const raw = { data: { id: 'PAYLOAD-ID', subject }, options: {}, id: 'WRAPPER-ID' };
    //   input.id                                            -> 'WRAPPER-ID'  (get)
    //   Object.getOwnPropertyDescriptor(input, 'id').value   -> 'PAYLOAD-ID'  (descriptor, PRE-FIX)
    //
    // Reordering costs nothing `ownKeys` does not already pay for: `ownKeys`
    // (#12578) is untouched and keeps listing the payload's own key set
    // unconditionally, INCLUDING a reserved name the payload happens to
    // share — so `enumerable` here still depends on whether `data` owns the
    // name too. That is deliberate, not an oversight: it is what keeps
    // `Object.keys`/spread/`Object.entries` carrying the ENVELOPE's value
    // under the reserved name exactly as before this fix (get already won
    // there, since spread reads a value through `get`), rather than silently
    // dropping a key `ownKeys` just offered. When `data` does NOT own the
    // name, the reserved-name branch still hides it from enumeration exactly
    // as it always did (`enumerable: false`) — unaffected by this fix.
    //
    // A reserved name absent from the WRAPPER (e.g. `id` on an insert-shaped
    // envelope) reports NO descriptor at all here, even when `data` owns a
    // same-named field and `ownKeys` therefore still lists it — matching
    // `get`'s unconditional wrapper-only read, which never falls through to
    // `data` for these four names. A proxy may legally answer `undefined` for
    // a key its OWN `ownKeys` trap listed, as long as the target (extensible,
    // always, here) does not itself carry that key: `Object.keys`/spread
    // silently skip such a key rather than throwing. Pinned, all of it, in
    // `hook-input-envelope-precedence.test.ts` (and the sandbox-snapshot
    // consequence in `packages/runtime/src/sandbox/hook-input-envelope-precedence.integration.test.ts`).
    getOwnPropertyDescriptor(target, prop) {
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        const desc = Object.getOwnPropertyDescriptor(target, prop);
        if (!desc) return undefined;
        const data = target.data;
        const payloadOwnsName =
          !!data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, prop);
        return { ...desc, configurable: true, enumerable: payloadOwnsName };
      }
      const data = target.data;
      if (data && typeof data === 'object') {
        const own = Object.getOwnPropertyDescriptor(data, prop);
        if (own) return { ...own, configurable: true };
      }
      return Object.getOwnPropertyDescriptor(target, prop);
    },
  });

  (ctx as any).input = proxy;
  return () => {
    (ctx as any).input = raw;
  };
}

/** Hook events whose write has no prior state at all — absence of a key on the
 *  payload genuinely means "no value", never "unchanged". */
function isInsertEvent(event: unknown): boolean {
  return event === 'beforeInsert' || event === 'afterInsert';
}

/**
 * ⛔ RETIRED with the batch-dispatch diagnosis (#5574) — see the note above
 * `HookConditionError`. Three helpers existed only to serve it and go with it:
 *
 *  - `isPredicateBulkWrite` — "no `input.id` and `options.multi`", i.e. is this
 *    one hook call standing for N matched rows? No dispatch is batch-scoped
 *    any more, so it answered `false` everywhere.
 *  - `afterCounterpartEvent` — named the `after*` event a batch-scoped
 *    `before*` condition should move to. That was the route out of a
 *    limitation that no longer exists.
 *  - `isBeforeEvent` / `conditionReadsPrevious` — the phase test and the
 *    AST-based "does this condition name `previous`?" detection (#5037), both
 *    consulted only inside that branch. The AST detection is worth remembering
 *    rather than just deleting: it existed because deriving the diagnosis from
 *    cel-js's prose (`Unknown variable: previous`) made an author-facing
 *    message depend on an upstream library's wording. If a future diagnosis
 *    ever needs the same fact, `collectCelRootIdentifiers`
 *    (`@objectstack/formula`, the utility #4972's build gate uses) is the
 *    seam — with its documented caveat that a comprehension bind variable
 *    named `previous` reads as a reference.
 */

/**
 * The rejection a condition that CANNOT BE EVALUATED produces (#4775).
 *
 * Mirrors `unevaluableRuleError` in `validation/rule-validator.ts` — same
 * facts, same two explanatory sentences (both come out of the shared
 * `cel-fault.ts`), so an author who has met one message can read the other.
 *
 * ## What used to branch here, and why nothing does now (#5574)
 *
 * Between #5037 and #5574 this function carried a second diagnosis for the
 * BATCH dispatch of a predicate (`multi: true`) write: that dispatch had no
 * `input.id` and no `previous`, so a `previous`-reading condition faulted
 * through no fault of the author's, and the message said so — naming the
 * limitation, the phase as the reason, and the matching `after*` event as the
 * route out.
 *
 * ADR-0058 Addendum II removed the condition being diagnosed rather than the
 * diagnosis: a predicate write dispatches `before*` once per matched row now,
 * each context carrying that row's `id` and `previous`, so the very expression
 * that used to abort the batch evaluates as authored. With no dispatch left
 * that lacks a bound `previous`, the branch had no reachable input and its two
 * `HookConditionLimitation` members had no producer — retired under ADR-0049,
 * see the note above `HookConditionError`.
 *
 * What remains is the plain diagnosis, which was always the right answer for
 * the case that is genuinely the author's: a condition naming a key the record
 * does not carry.
 */
function unevaluableConditionError(
  meta: Hook,
  ctx: HookContext,
  source: string,
  error: CelFault,
): HookConditionError {
  const { summary, missingKey, detail } = describeCelFault(error, {
    what: 'condition',
    undeclaredKeyFix: "fix the hook's condition, or declare the field",
  });
  const head = `Hook '${meta.name}' could not evaluate its condition (${summary}) — operation aborted.`;
  return new HookConditionError(`${head}${detail}`, {
    hook: meta.name,
    object: ctx.object,
    event: ctx.event,
    condition: source,
    reason: 'unevaluable',
    fault: summary,
    ...(missingKey ? { missingKey } : {}),
  });
}

/**
 * The rejection a condition that never COMPILED produces (#4775).
 *
 * Kept distinct from the unevaluable case because the fix is different: this
 * one is broken for every record, on every object, forever — there is no input
 * that makes it work. Its previous treatment (`condition ignored`) silently
 * DELETED the gate, so a guard that was declared to hold writes back let all of
 * them through and an audit fired on every write.
 */
function uncompilableConditionError(
  meta: Hook,
  ctx: HookContext,
  source: string,
  error: CelFault,
): HookConditionError {
  const { summary } = describeCelFault(error, {
    what: 'condition',
    undeclaredKeyFix: "fix the hook's condition",
  });
  return new HookConditionError(
    `Hook '${meta.name}' declares a condition that does not compile (${summary}) — operation aborted.` +
      ` The condition can never be evaluated, so the hook can neither run nor be skipped honestly;` +
      ` fix the expression: ${source}`,
    {
      hook: meta.name,
      object: ctx.object,
      event: ctx.event,
      condition: source,
      reason: 'uncompilable',
      fault: summary,
    },
  );
}

/**
 * The object's DECLARED fields, if this context can reach them.
 *
 * `ctx.ql` is the engine and `getObject` is an in-memory registry read — no
 * I/O, no extra row fetched, nothing loaded that the write path did not
 * already have. When the context carries no engine (unit harnesses, embedders
 * that hand-build a context) the record is simply merged without
 * materialisation: the merge alone already fixes the common case, and a
 * missing key then behaves exactly as it did before.
 */
function declaredFieldsFor(ctx: HookContext): Record<string, unknown> | undefined {
  const ql: any = (ctx as any).ql;
  if (!ql || typeof ql.getObject !== 'function' || typeof ctx.object !== 'string') return undefined;
  try {
    const fields = ql.getObject(ctx.object)?.fields;
    return fields && typeof fields === 'object' && !Array.isArray(fields)
      ? (fields as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Choose the record-shaped object the condition formula evaluates against.
 *
 * ## The record is the RECORD, not the patch (#4770)
 *
 * This used to return `ctx.input.data` — the fields the current write happens
 * to carry — and `ctx.previous` was unreachable behind it, the two never
 * merged. A condition could therefore only reference a field the update
 * *happened* to touch; anything else aborted the CEL expression with
 * `No such key` and was swallowed into `false` (see the condition gate above).
 * For an audit-style hook (`record.done == true`) that meant the audit silently
 * did not happen on exactly the ordinary updates — change the status, change
 * the assignee — that leave `done` out of the payload.
 *
 * So the record is now **stored ⊕ payload**, made total over the object's
 * declared fields — the same shape a validation predicate reads
 * ({@link materializeDeclaredFields}, #1871/#4649). The two surfaces share one
 * helper on purpose: `record.done == true` must not mean two different things
 * depending on which of them evaluates it.
 *
 * Order, unchanged for shapes that are not write-like:
 *   1. `ctx.input.data` (⊕ `ctx.previous`) — write operations carry the patch
 *      here and the pre-image there
 *   2. `ctx.previous`   — delete-shaped contexts carry only the pre-image
 *   3. `ctx.input`      — flat input bag (read ops, custom shapes)
 *
 * Materialisation is applied only when the record's persisted state is in hand
 * — an insert (nothing to know) or an update whose prior row was fetched.
 *
 * Since #5038 a predicate bulk update's AFTER dispatch is per row and DOES
 * carry the row's prior state, so it merges and materialises like any
 * single-record write — which is exactly what "`record` is the row's real state,
 * not the bare payload" means (#4862). Its `before*` dispatch still fires once
 * for the batch with no prior row, so that payload is left exactly as it is
 * rather than gaining `null`s that contradict N stored rows.
 *
 * Copies, never mutates: `ctx.previous` and `ctx.input.data` are the engine's
 * own objects, observed by the handlers that run after this gate.
 */
/**
 * The record state THIS hook is firing for — stored ⊕ payload, materialized
 * over the object's declared fields (#11293).
 *
 * The public name for {@link pickRecordPayload}, exported so a consumer that
 * has to answer "what record is this?" gets the SAME answer the declarative
 * `condition` gate gets. The runtime's `ctx.title()` seam is the first such
 * consumer: a title composed from a different record state than the one
 * `condition: "record.status == 'closed'"` evaluated would be two meanings of
 * "this record" one line apart in the same hook — the drift PD #12 forbids,
 * and precisely the drift this accessor exists to remove.
 *
 * A copy, never the engine's own object: {@link pickRecordPayload} builds a new
 * record from `ctx.previous` and `ctx.input.data` rather than handing either
 * out, so a caller cannot mutate the write through it.
 */
export function hookRecordState(ctx: HookContext): Record<string, unknown> {
  const record = pickRecordPayload(ctx);
  return record && typeof record === 'object' && !Array.isArray(record)
    ? (record as Record<string, unknown>)
    : {};
}

function pickRecordPayload(ctx: HookContext): any {
  const input: any = ctx.input ?? {};
  const payload: Record<string, unknown> | undefined =
    input && typeof input === 'object' && input.data && typeof input.data === 'object'
      ? (input.data as Record<string, unknown>)
      : undefined;
  const prior: Record<string, unknown> | undefined =
    ctx.previous && typeof ctx.previous === 'object'
      ? (ctx.previous as Record<string, unknown>)
      : undefined;

  if (payload) {
    // No prior row and not an insert → the persisted state is unknown, so
    // neither merging nor materialising is possible without inventing it.
    if (!prior && !isInsertEvent(ctx.event)) return payload;
    return materializeDeclaredFields({ ...prior, ...payload }, declaredFieldsFor(ctx));
  }
  if (prior) {
    return materializeDeclaredFields({ ...prior }, declaredFieldsFor(ctx));
  }
  return input;
}

/**
 * The `previous` CEL binding: the record's state BEFORE this write (#4784).
 *
 * ## Why the binding exists at all
 *
 * #4770 made `record` mean the record's STATE (stored ⊕ payload) rather than
 * this write's diff. That is the right meaning, but it left every TRANSITION
 * inexpressible: `record.done == true` is true on every update of an
 * already-done row, not only on the one that completed it — while the audit
 * hooks that motivated it (`showcase_audit_task_completion`, whose own
 * description says "after a task transitions to done") mean the transition.
 * Comparing against `previous` is the only way to say that, and the surface
 * next door — validation predicates — has bound `previous` all along. Two
 * surfaces evaluating CEL "over the record" with different scopes is a drift
 * an author cannot be expected to hold in their head, so the scopes are the
 * same: `record` + `previous`, built by the same helper.
 *
 * ## Total, and copied
 *
 * Made total over the object's declared fields for the same reason `record`
 * is ({@link materializeDeclaredFields}, #4649/#4770): whether a driver
 * returns a column the write never touched is a storage detail the author
 * cannot see, and `previous.x` on a row missing `x` aborts the WHOLE
 * expression with `No such key` — which #4775 turns into a rejected write.
 * An UNDECLARED key still faults, so a typo stays reportable.
 *
 * The copy is load-bearing: `ctx.previous` is the engine's own pre-image
 * object, handed to every after-hook. Materialising in place would give those
 * handlers columns the row never had (#4649 left the same note on the
 * validation side).
 *
 * ## When it is ABSENT — verbatim the validation side's rule
 *
 * `rule-validator.ts` binds `previous` only for `mode: 'update'` with a prior
 * record actually fetched, and passes `undefined` otherwise, which omits the
 * identifier from the CEL scope. Same here:
 *   - **insert** — there is no prior state, so `previous` is unbound and any
 *     reference to it is an author error, reported as such;
 *   - **the `before*` dispatch of a predicate (`multi: true`) bulk write** —
 *     it fires ONCE for N matched rows, so there is no single prior record to
 *     bind; `previous` stays unbound rather than being invented. The `after*`
 *     dispatch of that same write is per row since #5038 and binds the row's
 *     own pre-image, so a transition condition there reads exactly as it does
 *     on a single-record write.
 * Binding `null`/`{}` instead would make `previous.x == null` answer "yes"
 * for a record whose prior state is simply unknown — a fabricated fact, the
 * one thing materialisation is careful never to do.
 */
function pickPreviousPayload(ctx: HookContext): Record<string, unknown> | undefined {
  if (isInsertEvent(ctx.event)) return undefined;
  const prior = ctx.previous;
  if (!prior || typeof prior !== 'object' || Array.isArray(prior)) return undefined;
  return materializeDeclaredFields({ ...(prior as Record<string, unknown>) }, declaredFieldsFor(ctx));
}
