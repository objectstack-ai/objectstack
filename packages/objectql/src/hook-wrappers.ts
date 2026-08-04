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
import type { Expression } from '@objectstack/spec';
import type { HookHandler } from './engine.js';
import { ExpressionEngine, collectCelRootIdentifiers } from '@objectstack/formula';
import { noopHookMetricsRecorder, type HookMetricsRecorder, type HookMetricOutcome } from './hook-metrics.js';
import { materializeDeclaredFields } from './declared-fields.js';
import { describeCelFault, type CelFault } from './cel-fault.js';

export interface WrapDeclarativeOptions {
  /** Logger for declarative-layer diagnostics (timeouts, retries, swallowed errors). */
  logger?: {
    debug: (msg: string, meta?: any) => void;
    info: (msg: string, meta?: any) => void;
    warn: (msg: string, meta?: any) => void;
    error: (msg: string, meta?: any) => void;
  };
  /** Optional per-execution metrics sink. Defaults to no-op. */
  metrics?: HookMetricsRecorder;
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

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
 * Which CURRENT-VERSION platform limitation made the condition unevaluable,
 * when a limitation — rather than the author — is what happened (#5037).
 *
 * The distinction this names is the whole point of the diagnostic: an
 * undeclared key is the AUTHOR's to fix and stays fixed; these two are the
 * PLATFORM's, they contradict the contract ADR-0058's bulk-write addendum
 * records, and they retire when #5038 lands per-row semantics. A caller that
 * wants to tell "your hook is wrong" from "this version cannot do that yet"
 * — a REST layer choosing a status, a test, a Studio surface — reads this
 * field instead of matching on the message text.
 *
 *   - `bulk_write_previous_unbound` — the condition names `previous` on a
 *     predicate (`multi: true`) write, which matches N rows and fires the hook
 *     once, so there is no single prior record to bind;
 *   - `bulk_write_stored_state_unavailable` — the condition names a DECLARED
 *     field this write does not set, and `record` is the bare payload on a bulk
 *     write for the same reason (no single stored row to merge with).
 *
 * ## Why this is not `error.code`
 *
 * Deliberately NOT named `code`. ADR-0112 makes `error.code` a CLOSED wire
 * vocabulary — `StandardErrorCode` ∪ `ERROR_CODE_LEDGER`, both declared in
 * `packages/spec/src/api/` — and `rest-server.ts` promotes a thrown error's
 * `.code` straight onto the response envelope. Putting a `.code` here would
 * therefore mint an unregistered wire code by side effect, which is the exact
 * `declared ≠ enforced` shape this family exists to remove. If this ever needs
 * to travel on the wire it goes through the ledger, as a decision, not as a
 * property that happens to be named `code`.
 */
export type HookConditionLimitation =
  | 'bulk_write_previous_unbound'
  | 'bulk_write_stored_state_unavailable';

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
  /** True when the operation is a predicate (`multi: true`) bulk write, whose
   *  N matched rows have no single prior state to bind (#4800/B1). */
  readonly predicateBulkWrite?: boolean;
  /** The current-version limitation behind the fault, when one is the cause
   *  rather than the authored expression (#5037). See
   *  {@link HookConditionLimitation}. */
  readonly limitation?: HookConditionLimitation;

  constructor(message: string, info: {
    hook: string;
    object?: string;
    event?: string;
    condition: string;
    reason: 'unevaluable' | 'uncompilable';
    fault: string;
    missingKey?: string;
    predicateBulkWrite?: boolean;
    limitation?: HookConditionLimitation;
  }) {
    super(message);
    this.hook = info.hook;
    this.object = info.object;
    this.event = info.event;
    this.condition = info.condition;
    this.reason = info.reason;
    this.fault = info.fault;
    this.missingKey = info.missingKey;
    this.predicateBulkWrite = info.predicateBulkWrite;
    this.limitation = info.limitation;
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
      // Read ONCE, off the parsed AST, whether this condition names `previous`
      // at all (#5037) — see `conditionReadsPrevious`. Wrap time, not call
      // time: the answer is a property of the source, and the call path is on
      // every write of the object.
      const readsPrevious = conditionReadsPrevious(source);
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
            throw unevaluableConditionError(meta, ctx, source, r.error, declaredFieldsFor(ctx), readsPrevious);
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
        logger.error('[hook] condition formula failed to compile; every operation on this hook\'s object will be rejected until it is fixed', {
          hook: meta.name,
          condition: source,
          error: check.error.message,
        });
      }
    }
  }

  const retryMax = Math.max(0, Number(meta.retryPolicy?.maxRetries ?? 0));
  const retryBackoffMs = Math.max(0, Number(meta.retryPolicy?.backoffMs ?? 0));
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
        logger.error('[hook] handler failed (onError=log; suppressing)', {
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
            logger.error('[hook] async handler error (fire-and-forget)', {
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
 * Is this operation a PREDICATE (`multi: true`) bulk write?
 *
 * The engine routes an update/delete to `updateMany`/`deleteMany` when the call
 * carries no `id` and `options.multi` is set, and fires the lifecycle hook
 * ONCE for the whole batch — `hookContext.previous` is never assigned and the
 * payload is never merged with any stored row, because there are N stored rows
 * and no single one of them is "the" prior state.
 *
 * Read off the same two facts the engine branches on (`input.id` absent +
 * `options.multi`), which survive into the after-event context: `input.options`
 * is rebuilt by `buildDriverOptions` as a COPY of the caller's bag, so `multi`
 * is still there.
 */
function isPredicateBulkWrite(ctx: HookContext): boolean {
  const input: any = ctx.input ?? {};
  if (!input || typeof input !== 'object') return false;
  if (input.id !== undefined && input.id !== null && input.id !== '') return false;
  const options: any = input.options;
  return Boolean(options && typeof options === 'object' && options.multi);
}

/**
 * Does this condition NAME `previous` at all? Answered from the parsed CEL AST
 * (#5037), not from the fault text a failed evaluation happened to produce.
 *
 * The diagnostic below has to tell "this hook reads the pre-write state, which
 * a bulk write cannot supply in this version" from "this hook has a typo".
 * Deriving that from cel-js's message (`Unknown variable: previous`) works
 * today and is kept as the fallback, but it makes an author-facing diagnosis
 * depend on an upstream library's prose: reword the fault and the batch silently
 * goes back to reporting a riddle. The AST is the same fact stated by the
 * expression itself, so the diagnosis holds whatever the evaluator says — and it
 * is available even when the fault names something ELSE the same condition also
 * reads.
 *
 * `collectCelRootIdentifiers` is the utility #4972's build gate already uses for
 * "which roots does this expression reference". Its documented caveat: a
 * comprehension bind variable (`[1,2].exists(previous, previous > 1)`) is
 * reported as a root, so a hook that names its bind variable `previous` reads as
 * a `previous` reference here. That false positive is inert by construction —
 * this answer is consulted ONLY on the error path, and such an expression binds
 * its own variable and evaluates fine, so it never reaches one. Paying for a
 * comprehension-aware walk to remove an unreachable case would be the more
 * expensive wrong call.
 *
 * A source that does not parse returns `false`: it never compiled, so it goes
 * down the `uncompilableConditionError` path and never reaches this diagnosis.
 */
function conditionReadsPrevious(source: string): boolean {
  const roots = collectCelRootIdentifiers(source);
  return roots.ok ? roots.roots.includes('previous') : false;
}

/**
 * The rejection a condition that CANNOT BE EVALUATED produces (#4775).
 *
 * Mirrors `unevaluableRuleError` in `validation/rule-validator.ts` — same
 * facts, same two explanatory sentences (both come out of the shared
 * `cel-fault.ts`), so an author who has met one message can read the other.
 *
 * ## The predicate-bulk-write branch (#4800 / B1)
 *
 * A `multi: true` write matches N rows and fires the hook once, so two things
 * the condition may legitimately name are simply not in hand:
 *
 *   - `previous` — unbound, because there is no single prior record;
 *   - a DECLARED field the payload does not set — `record` is the payload
 *     alone here, since merging it with "the" stored row would mean picking one
 *     of N, and materialising declared fields to `null` would state something
 *     false about all N.
 *
 * Both are the SAME situation and neither is an author typo, so the default
 * `No such key: previous` — which reads as "you misspelled something" — is
 * actively misleading. This branch names the batch, says why the binding is
 * missing, and gives the one route that actually works. It does NOT create an
 * exception: the write still fails (maintainer's ruling on #4800 — fail loud,
 * no exemptions), it just fails with a diagnosis instead of a riddle.
 *
 * An UNDECLARED key still routes to the ordinary typo message even on a bulk
 * write: that one IS a typo, and saying "this is a batch" about it would send
 * the author down the wrong path. When the condition reads `previous` AND
 * misspells something, the author gets both sentences — the typo is theirs to
 * fix, and the batch limitation is still waiting behind it.
 *
 * ## The rejection names a LIMITATION, not the contract (#5037, ADR-0058)
 *
 * The 2026-08-04 ruling on #4800/#4862 settled what a bulk write MEANS: after
 * hooks and record-change flow triggers evaluate and fire PER ROW — recorded as
 * an addendum on ADR-0058, implemented by #5038. This rejection is the rc-window
 * stopgap for the gap between that contract and today's engine, so it says so:
 * an author who reads it learns that the transition condition they wrote is
 * legitimate and that the platform, not their metadata, is behind. The earlier
 * wording ("rewrite the condition without `previous`") predates the ruling and
 * read as permanent guidance to abandon a supported shape — worse, silently
 * changing a transition into a state test, which fires on rows that were
 * already done. The single-record route is now the recommended one, with the
 * rewrite named for what it costs.
 *
 * ⚠️ The escape routes named below are deliberately the only ones. "Use a
 * record-change flow trigger instead" was considered and REJECTED on evidence:
 * that trigger subscribes to these very lifecycle hooks
 * (`trigger-record-change/src/record-change-trigger.ts` → `engine.registerHook`),
 * so on a `multi: true` update it also fires once with `ctx.previous`
 * undefined — measured, not assumed (#4862). Naming it here would have made
 * this message the next `declared ≠ delivered`; it converges on the same per-row
 * contract through #5038, not before.
 */
function unevaluableConditionError(
  meta: Hook,
  ctx: HookContext,
  source: string,
  error: CelFault,
  declaredFields: Record<string, unknown> | undefined,
  readsPrevious = false,
): HookConditionError {
  const { summary, missingKey, unknownVariable, detail } = describeCelFault(error, {
    what: 'condition',
    undeclaredKeyFix: "fix the hook's condition, or declare the field",
  });
  const head = `Hook '${meta.name}' could not evaluate its condition (${summary}) — operation aborted.`;

  if (isPredicateBulkWrite(ctx)) {
    const declaredMissingKey = missingKey && declaredFields
      && Object.prototype.hasOwnProperty.call(declaredFields, missingKey)
      ? missingKey
      : undefined;
    // The typo sentence, kept alongside the batch diagnosis when the fault
    // named a key this object does not declare: that half IS the author's.
    const typoDetail = missingKey && !declaredMissingKey ? detail : '';
    // Does the condition read `previous`? The AST says so directly; the fault
    // text (`Unknown variable: previous` — the ROOT is absent) is the fallback
    // for a caller that did not pass the AST answer through.
    const namesPrevious = readsPrevious || unknownVariable === 'previous';

    let limitation: HookConditionLimitation | undefined;
    let bulkDetail: string | undefined;
    if (namesPrevious) {
      limitation = 'bulk_write_previous_unbound';
      bulkDetail =
        ` The condition reads 'previous', but this is a PREDICATE bulk write (multi: true):` +
        ` it matches many rows and fires the hook ONCE, so there is no single prior record to bind.` +
        ` This is a CURRENT-VERSION limitation, not the contract: a bulk write is declared to` +
        ` evaluate and fire after-hooks PER ROW (ADR-0058, bulk-write addendum; ruling on #4800/#4862),` +
        ` and this rejection retires when that lands (#5038).` +
        ` Until then, target the write at one record (update by id) — a single-record write binds` +
        ` 'previous', so this very condition evaluates as authored. Dropping 'previous' from the` +
        ` condition also unblocks the batch, but it changes what the hook MEANS: a transition` +
        ` ("just became done") becomes a state test ("is done"), which fires on rows that were` +
        ` already done.` +
        ` A record-change flow trigger is NOT a way around this — it binds the same lifecycle hook` +
        ` and receives the same unbound 'previous' on a bulk write (#4862).`;
    } else if (declaredMissingKey) {
      limitation = 'bulk_write_stored_state_unavailable';
      bulkDetail =
        ` '${declaredMissingKey}' IS declared on this object, but this is a PREDICATE bulk write (multi: true):` +
        ` the stored state of the matched rows is not in hand, so 'record' carries only this write's` +
        ` payload. Reference only fields this write sets, or target the write at one record (update by id).` +
        ` Same current-version limitation as above: per-row evaluation (#5038) gives 'record' the row's` +
        ` real state.`;
    }
    if (bulkDetail !== undefined) {
      return new HookConditionError(`${head}${typoDetail}${bulkDetail}`, {
        hook: meta.name,
        object: ctx.object,
        event: ctx.event,
        condition: source,
        reason: 'unevaluable',
        fault: summary,
        ...(missingKey ? { missingKey } : {}),
        predicateBulkWrite: true,
        limitation,
      });
    }
  }

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
 * A predicate bulk update carries no prior row, so its payload is left exactly
 * as it is rather than gaining `null`s that contradict N stored rows.
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
 *   - **predicate (`multi: true`) bulk update** — the engine matched N rows
 *     and fires the hook ONCE, so there is no single prior record to bind;
 *     `previous` stays unbound rather than being invented.
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
