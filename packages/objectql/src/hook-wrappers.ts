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
import { ExpressionEngine } from '@objectstack/formula';
import { noopHookMetricsRecorder, type HookMetricsRecorder, type HookMetricOutcome } from './hook-metrics.js';
import { materializeDeclaredFields } from './declared-fields.js';

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
 * Wrap a hook handler so it honours the declarative fields defined on
 * `HookSchema`. The wrapping order, from outermost to innermost, is:
 *
 *   1. condition  → skip when formula evaluates falsy
 *   2. async      → fire-and-forget (after* events only)
 *   3. retry      → repeat on throw with backoff
 *   4. timeout    → abort if handler runs too long
 *   5. onError    → swallow when set to 'log'
 *
 * The condition formula is evaluated against two bindings, the same two a
 * validation predicate reads (#4784):
 *
 *   - `record`   — the record-shaped view built by {@link pickRecordPayload}:
 *     for a write, the stored record overlaid with this write's payload, made
 *     total over the object's declared fields (#4770). Read events typically
 *     have no record yet, so a condition on a `beforeFind` will simply skip
 *     when no data is present.
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
  let conditionFn: ((record: any, previous: Record<string, unknown> | undefined) => boolean) | undefined;
  if (meta.condition) {
    // Accept either string shorthand or full Expression envelope.
    const expr: Expression = typeof meta.condition === 'string'
      ? { dialect: 'cel', source: meta.condition }
      : (meta.condition as Expression);
    if (expr.source && expr.source.trim()) {
      const check = ExpressionEngine.compile(expr);
      if (check.ok) {
        conditionFn = (record: any, previous: Record<string, unknown> | undefined) => {
          // `previous` is passed through as-is: `undefined` means the binding
          // is OMITTED from the CEL scope (see `buildScope` in
          // @objectstack/formula), which is exactly what the validation side
          // does when no prior record is in hand. Binding it to an empty
          // object instead would answer `previous.x == null` with a
          // fabricated "yes" for a record whose prior state is unknown.
          const r = ExpressionEngine.evaluate<boolean>(expr, { record: record ?? {}, previous });
          if (!r.ok) {
            logger.warn('[hook] condition evaluation failed; treating as false', {
              hook: meta.name,
              condition: expr.source,
              error: r.error.message,
            });
            return false;
          }
          return Boolean(r.value);
        };
      } else {
        logger.warn('[hook] condition formula failed to compile; condition ignored', {
          hook: meta.name,
          condition: expr.source,
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
    // 1. Condition gate
    if (conditionFn) {
      const record = pickRecordPayload(ctx);
      if (!conditionFn(record, pickPreviousPayload(ctx))) {
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
