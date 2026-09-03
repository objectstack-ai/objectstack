// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14010] `Hook.runAs` — the declared execution identity of a hook's `ctx.api`
 * data operations (ruling 2026-09-01: `'system' | 'user' | 'inherit'`, default
 * `'inherit'`).
 *
 * ## What it repairs
 *
 * A hook's `ctx.api` is a `ScopedContext` over the context of the write that
 * fired it (`ObjectQL.buildHookApi(opCtx.context)`), so the hook runs as the
 * operator. A column an app wants COMPUTED and never hand-written is protected
 * by authoring `editable: false` for the persona — and that same field-level
 * check then refuses the hook that maintains the column: the guard and the
 * legitimate writer were the same door. The only elevation a hook had was the
 * in-process `ctx.api.sudo()`, which the sandbox does not carry (a `TypeError`
 * once the build lowers the handler into a body — closed as a trap by #14044)
 * and which rides the L3 bundle path that is being retired. `runAs` is the
 * declared knob, honoured on BOTH surfaces at the one place both are wrapped
 * (`hook-wrappers.ts` `wrapDeclarativeHook`).
 *
 * ## The three values, and why the default is not FlowSchema's
 *
 *  - `'system'` — elevate: the hook's `ctx.api` carries `isSystem: true` over
 *    the triggering context. The security middleware short-circuits on that
 *    flag before every row-level and field-level gate, so the card's symptom is
 *    fixed exactly there. Elevation is not anonymity (#5494): `userId` rides
 *    along, so `updated_by` and the audit row still name the operator.
 *  - `'user'` — pin: `isSystem: false` over the triggering context. A hook
 *    whose trigger resolved NO user has nothing to scope to, so its data
 *    operations are REFUSED ({@link HookUnscopedDataAccessError}) rather than
 *    run unscoped — the hook-side twin of service-automation's #3760 refusal,
 *    same reasoning, same remedy sentence, its own registered code.
 *  - `'inherit'` — the hook-only third value and the default: the engine-built
 *    api is handed through UNTOUCHED (same object reference), which is the
 *    pre-`runAs` behaviour. A flow establishes its run identity from nothing
 *    and so has no such value; only a hook has a context to inherit, which is
 *    why the defaults differ while `'system'` / `'user'` mean the same thing
 *    in both places.
 *
 * ## Scope fence (ruling item 5)
 *
 * `ctx.api` data operations ONLY. The `condition` gate, the `readonly` strip
 * on the hook's own `ctx.input` payload, `ctx.session`, and the `async`
 * semantics all keep reading the TRIGGERING operation's context — this module
 * never touches `opCtx.context`, only the api object the handler is handed.
 */

import type { IScopedContext, IScopedObjectRepository } from '@objectstack/spec/contracts';

/** The declared values, in the schema's order. */
export const HOOK_RUN_AS_VALUES = ['system', 'user', 'inherit'] as const;
export type HookRunAs = (typeof HOOK_RUN_AS_VALUES)[number];

/** ADR-0112 code for the `'user'`-without-a-user refusal (ledger: `@objectstack/objectql`). */
export const HOOK_UNSCOPED_DATA_ACCESS_CODE = 'HOOK_UNSCOPED_DATA_ACCESS' as const;
/**
 * `403`: the operation is refused for lack of an identity to authorize it as,
 * which is an authorization answer, not a malformed request (`400`) — the
 * payload and the predicate are both fine; there is no principal to scope
 * them to.
 */
export const HOOK_UNSCOPED_DATA_ACCESS_STATUS = 403 as const;

/** Where a refusal happened — carried on the error so the message can name it. */
export interface HookRunAsRef {
  /** The hook whose `runAs` produced the refusal. */
  hook: string;
  /** The object the TRIGGERING operation targeted (not the object the hook tried to reach). */
  object?: string;
  /** The lifecycle event that fired the hook. */
  event?: string;
}

/**
 * Thrown from a `runAs: 'user'` hook's `ctx.api` when its trigger resolved no
 * user (#14010; wording mirrors #3760's `UnscopedRunDataAccessError` rather
 * than importing it — the flow engine is not a dependency of the query
 * engine).
 *
 * The refusal is the point: `'user'` is an access-NARROWING declaration, and
 * ADR-0049's standing rule is that failing to resolve a narrowing declaration
 * must never resolve to a grant. Deliberately NOT `{ isSystem: true }` either
 * (see #3760): the middleware's `isSystem` short-circuit precedes gates a
 * principal-less context still has to clear, so re-badging the hook as system
 * would WIDEN it.
 *
 * Thrown at the DATA DOOR (`object()` / `transaction()`), not at dispatch: a
 * `'user'` hook that never touches data still runs, exactly as a `runAs:'user'`
 * flow still runs its non-data nodes.
 */
export class HookUnscopedDataAccessError extends Error {
  override readonly name = 'HookUnscopedDataAccessError';
  readonly code = HOOK_UNSCOPED_DATA_ACCESS_CODE;
  readonly status = HOOK_UNSCOPED_DATA_ACCESS_STATUS;
  readonly hook: string;
  readonly object?: string;
  readonly event?: string;

  constructor(ref: HookRunAsRef) {
    const where = [
      `hook '${ref.hook}'`,
      ref.object ? `object '${ref.object}'` : undefined,
      ref.event ? `event '${ref.event}'` : undefined,
    ]
      .filter(Boolean)
      .join(', ');
    super(
      `[runAs] refusing a data operation (${where}): this hook's runAs is 'user' but no trigger user ` +
        `could be resolved, so the operation would execute UNSCOPED (elevated, RLS-bypassing) rather ` +
        `than restricted to a user. Declare \`runAs: 'system'\` on the hook to make the elevation ` +
        `explicit and intended, or arrange for the trigger to supply a user (a write made with a system ` +
        `context carries none). Branch on \`code === '${HOOK_UNSCOPED_DATA_ACCESS_CODE}'\` (ADR-0112) ` +
        `to detect this. (ADR-0049, #3760, #14010)`,
    );
    this.hook = ref.hook;
    if (ref.object !== undefined) this.object = ref.object;
    if (ref.event !== undefined) this.event = ref.event;
  }
}

/**
 * The `ctx.api` a `runAs: 'user'` hook is handed when its trigger resolved no
 * user: every data door refuses with {@link HookUnscopedDataAccessError}.
 *
 * It implements the same contract the engine's `ScopedContext` does
 * (`IScopedContext`: `object`, `transaction`), so a body's `ctx.api.object(…)`
 * reaches the refusal through the ordinary sandbox plumbing rather than a
 * `TypeError` about a missing member.
 */
export class UnscopedHookApi implements IScopedContext {
  constructor(private readonly ref: HookRunAsRef) {}

  object(_name: string): IScopedObjectRepository {
    throw new HookUnscopedDataAccessError(this.ref);
  }

  transaction<T>(_callback: (tx: IScopedContext) => Promise<T>): Promise<T> {
    return Promise.reject(new HookUnscopedDataAccessError(this.ref));
  }
}

/**
 * What an api must offer for a hook's `runAs` to be applied to it. The
 * engine's `ScopedContext` implements it (`engine.ts` `withRunAs`); it is
 * deliberately NOT on `IScopedContext`, the hook-author contract — a hook
 * never calls this, the wrapper does.
 */
export interface RunAsDerivableApi extends IScopedContext {
  withRunAs(runAs: Exclude<HookRunAs, 'inherit'>, ref: HookRunAsRef): IScopedContext;
}

/**
 * Read a hook's declared `runAs`. An absent key is the schema default
 * (`'inherit'`); any other non-member is refused LOUDLY here rather than
 * tolerated, so a hook bound from a source that skipped `HookSchema` cannot
 * declare an identity the engine then silently ignores (declared ≠ enforced
 * is the defect this key exists to end). Thrown from `wrapDeclarativeHook`,
 * which the binder calls per hook — under `strict` binding the boot fails,
 * otherwise the hook is skipped with the reason logged.
 */
export function hookRunAs(meta: { name?: unknown; runAs?: unknown }): HookRunAs {
  const raw = meta.runAs;
  if (raw === undefined) return 'inherit';
  if (typeof raw === 'string' && (HOOK_RUN_AS_VALUES as readonly string[]).includes(raw)) {
    return raw as HookRunAs;
  }
  throw new Error(
    `[hook] hook '${String(meta.name ?? '<unnamed>')}' declares runAs: ${JSON.stringify(raw)}, which is ` +
      `not one of ${HOOK_RUN_AS_VALUES.map((v) => `'${v}'`).join(' | ')}. HookSchema refuses this at ` +
      `authoring time; the engine refuses it here so the declaration is never silently ignored.`,
  );
}

/**
 * Derive the api a hook runs with from the engine-built one.
 *
 * `'inherit'` returns the SAME object (pinned by reference equality — that is
 * the "byte-identical to today" guarantee). Anything else requires an api that
 * can derive identities; an api that cannot is a loud error, never a silent
 * fall-through to the un-elevated context.
 */
export function deriveHookApi(api: unknown, runAs: HookRunAs, ref: HookRunAsRef): unknown {
  if (runAs === 'inherit') return api;
  const derivable = api as Partial<RunAsDerivableApi> | undefined;
  if (!derivable || typeof derivable.withRunAs !== 'function') {
    throw new Error(
      `[hook] hook '${ref.hook}' declares runAs: '${runAs}' but its ctx.api cannot derive an execution ` +
        `identity (no withRunAs). Only the engine-built ScopedContext can; a hook context assembled ` +
        `by hand must supply one or leave runAs at 'inherit'.`,
    );
  }
  return derivable.withRunAs(runAs, ref);
}
