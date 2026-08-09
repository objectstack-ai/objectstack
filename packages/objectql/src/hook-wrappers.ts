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
 */
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
    set(target, prop, value) {
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        (target as any)[prop] = value;
        return true;
      }
      ensureData()[prop as string] = value;
      return true;
    },
    has(target, prop) {
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        return prop in target;
      }
      const data = target.data;
      if (data && typeof data === 'object' && prop in data) return true;
      return prop in target;
    },
    ownKeys(target) {
      // Only enumerate the flat record fields. Wrapper keys
      // (id/options/ast/data) remain accessible via dot/bracket notation
      // but are hidden from Object.keys/for-in so user code that does
      // `Object.keys(input).filter(k => input[k] !== previous[k])` only
      // sees actual record fields.
      const dataKeys = target.data && typeof target.data === 'object'
        ? Object.keys(target.data)
        : [];
      return Array.from(new Set(dataKeys));
    },
    getOwnPropertyDescriptor(target, prop) {
      const data = target.data;
      if (data && typeof data === 'object' && prop in data) {
        return { configurable: true, enumerable: true, writable: true, value: (data as any)[prop] };
      }
      // Wrapper keys: still descriptors so `prop in input` works, but
      // marked non-enumerable so they don't appear in Object.keys().
      if (prop === 'id' || prop === 'options' || prop === 'ast' || prop === 'data') {
        const desc = Object.getOwnPropertyDescriptor(target, prop);
        return desc ? { ...desc, enumerable: false } : undefined;
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
