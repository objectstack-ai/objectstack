// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Class head: units, hooks, functions, body runners, hook dispatch" section of
 * `ObjectQL`: the bodies of `recordResidualOwner`, `residualOwnerSource`,
 * `unregisterHooksByPackage`, `registerFunction`, `resolveFunction`,
 * `resolveFunctionEntry`, `unregisterFunctionsByPackage`,
 * `setDefaultBodyRunner`, `getDefaultBodyRunner`, `setDefaultActionRunner`,
 * `getDefaultActionRunner`, `hasHooksFor`, `opensAfterAbortUnit`,
 * `dispatchUnscopedMultiWriteHooks` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. {@link HooksAndFunctionsFacet} is a stateless facet of `ObjectQL`
 * (ruling 6624345766): each static method of it is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class as a one-call stub with
 * its signature, so the published surface, an instance spy and a subclass
 * override are what they were. A public or protected method keeps its
 * docblock on the class, the contract; a private method's docblock moved here
 * with its body. The state stays on `ObjectQL`.
 *
 * The bodies reach the class through {@link HooksAndFunctionsHost}: exactly the
 * `ObjectQL` members they read, private ones included. Every stub hands its
 * body, by a `.call`, the same host: `hooksAndFunctionsHost` in `engine-facet-hosts.ts`, built
 * once per engine by the class's static block. Methods go as closures that
 * call them on the engine at call time, so a subclass override or an instance
 * spy is still the one reached; fields and accessors go as GETTERS, read when
 * the body reads them, as they were on the class, and a field a body assigns
 * goes with a SETTER that assigns it on the engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { driverSupportsTransactions } from '@objectstack/spec/data';
import type { HookContext } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { hookStoppedRefusal } from './summary-errors.js';
import { HookTargetRebindError } from './hook-target-rebind-errors.js';
import { declaredHookCondition } from './hook-wrappers.js';
import { hookMatchesObject } from './engine-top-level.js';
import type { FunctionEntry, FunctionRegistrationOptions, HookHandler } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the bodies of {@link HooksAndFunctionsFacet} read — every one of
 * them, and no other. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too. `readonly` members are the getters; the others are fields a body
 * assigns.
 */
export interface HooksAndFunctionsHost {
  _defaultActionRunner: ObjectQL['_defaultActionRunner'];
  _defaultBodyRunner: ObjectQL['_defaultBodyRunner'];
  readonly defaultDriver: ObjectQL['defaultDriver'];
  readonly drivers: ObjectQL['drivers'];
  readonly functions: ObjectQL['functions'];
  getDriver: ObjectQL['getDriver'];
  readonly hooks: ObjectQL['hooks'];
  isClosedUnitHandle: ObjectQL['isClosedUnitHandle'];
  readonly logger: ObjectQL['logger'];
  readonly residualOwnerSources: ObjectQL['residualOwnerSources'];
  readonly txStore: ObjectQL['txStore'];
}

/** The bodies of the "Class head: units, hooks, functions, body runners, hook dispatch" section of `ObjectQL`: a stateless facet, called by the class's stubs. */
export class HooksAndFunctionsFacet {
  /** The body of `ObjectQL#recordResidualOwner`; the method's docblock there is its contract. */
  static recordResidualOwner(this: Pick<HooksAndFunctionsHost, 'residualOwnerSources'>, ownerId: string, source: 'code' | 'marketplace'): void {
    if (this.residualOwnerSources.get(ownerId) === 'marketplace') return;
    this.residualOwnerSources.set(ownerId, source);
  }

  /** The body of `ObjectQL#residualOwnerSource`; the method's docblock there is its contract. */
  static residualOwnerSource(this: Pick<HooksAndFunctionsHost, 'residualOwnerSources'>, ownerId: string): 'code' | 'marketplace' | undefined {
    return this.residualOwnerSources.get(ownerId);
  }

  /** The body of `ObjectQL#unregisterHooksByPackage`; the method's docblock there is its contract. */
  static unregisterHooksByPackage(this: Pick<HooksAndFunctionsHost, 'hooks' | 'logger'>, packageId: string): number {
    if (!packageId) return 0;
    let removed = 0;
    for (const [event, entries] of this.hooks.entries()) {
      const before = entries.length;
      const kept = entries.filter((e) => e.packageId !== packageId);
      if (kept.length !== before) {
        this.hooks.set(event, kept);
        removed += before - kept.length;
      }
    }
    if (removed > 0) {
      this.logger.debug('Unregistered hooks by package', { packageId, removed });
    }
    return removed;
  }

  /** The body of `ObjectQL#registerFunction`; the method's docblock there is its contract. */
  static registerFunction(this: Pick<HooksAndFunctionsHost, 'functions' | 'logger'>, name: string, handler: HookHandler, packageIdOrOptions?: string | FunctionRegistrationOptions): void {
    if (!name || typeof handler !== 'function') return;
    const opts: FunctionRegistrationOptions =
      typeof packageIdOrOptions === 'string' ? { packageId: packageIdOrOptions } : (packageIdOrOptions ?? {});
    const { packageId, effect } = opts;
    this.functions.set(name, { handler, packageId, ...(effect ? { effect } : {}) });
    this.logger.debug('Registered function', { name, packageId, effect });
  }

  /** The body of `ObjectQL#resolveFunction`; the method's docblock there is its contract. */
  static resolveFunction(this: Pick<HooksAndFunctionsHost, 'functions'>, name: string): HookHandler | undefined {
    return this.functions.get(name)?.handler;
  }

  /** The body of `ObjectQL#resolveFunctionEntry`; the method's docblock there is its contract. */
  static resolveFunctionEntry(this: Pick<HooksAndFunctionsHost, 'functions'>, name: string): Readonly<FunctionEntry> | undefined {
    return this.functions.get(name);
  }

  /** The body of `ObjectQL#unregisterFunctionsByPackage`; the method's docblock there is its contract. */
  static unregisterFunctionsByPackage(this: Pick<HooksAndFunctionsHost, 'functions' | 'logger'>, packageId: string): number {
    if (!packageId) return 0;
    let removed = 0;
    for (const [name, entry] of this.functions.entries()) {
      if (entry.packageId === packageId) {
        this.functions.delete(name);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.logger.debug('Unregistered functions by package', { packageId, removed });
    }
    return removed;
  }

  /** The body of `ObjectQL#setDefaultBodyRunner`; the method's docblock there is its contract. */
  static setDefaultBodyRunner(this: Pick<HooksAndFunctionsHost, '_defaultBodyRunner' | 'logger'>, runner: any): boolean {
    if (this._defaultBodyRunner) {
      this.logger.debug('Default body runner already installed — keeping the first');
      return false;
    }
    this._defaultBodyRunner = runner;
    return true;
  }

  /** The body of `ObjectQL#getDefaultBodyRunner`; the method's docblock there is its contract. */
  static getDefaultBodyRunner(this: Pick<HooksAndFunctionsHost, '_defaultBodyRunner'>): any {
    return this._defaultBodyRunner;
  }

  /** The body of `ObjectQL#setDefaultActionRunner`; the method's docblock there is its contract. */
  static setDefaultActionRunner(this: Pick<HooksAndFunctionsHost, '_defaultActionRunner' | 'logger'>, runner: (actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined): boolean {
    if (this._defaultActionRunner) {
      this.logger.debug('Default action runner already installed — keeping the first');
      return false;
    }
    this._defaultActionRunner = runner;
    return true;
  }

  /** The body of `ObjectQL#getDefaultActionRunner`; the method's docblock there is its contract. */
  static getDefaultActionRunner(this: Pick<HooksAndFunctionsHost, '_defaultActionRunner'>): ((actionDef: any) => ((ctx: any) => Promise<unknown>) | undefined) | undefined {
    return this._defaultActionRunner;
  }

  /**
   * [#5038] Would `triggerHooks(event, ctx)` reach ANY handler for `object`?
   *
   * Applies the SAME per-object rule the dispatch loop applies — literally the
   * same function, {@link hookMatchesObject}, since #5928 — because this answer
   * gates a READ of the whole matched row set on the bulk write path. Getting
   * it looser than the dispatch loop only costs a wasted query; getting it
   * TIGHTER would silently drop hooks that were going to fire. Until #5928 the
   * two were separate hand-written copies of one semantic and this comment
   * asked the reader to keep them in step; sharing the function is what
   * actually keeps them in step, and the property test in
   * `hook-exclude-objects.test.ts` pins the direction that matters.
   *
   * `session.skipAutomations` is deliberately NOT consulted: it suppresses only
   * metadata-bound entries, and code-registered hooks (audit, sharing) still
   * run, so the row set is still needed. Over-reading in that case is a cost,
   * never a correctness loss — and it is the SAFE side of the asymmetry above,
   * which is why the pin asserts an implication rather than an equality.
   */
  static hasHooksFor(this: Pick<HooksAndFunctionsHost, 'hooks'>, event: string, object: string): boolean {
    const entries = this.hooks.get(event);
    if (!entries || entries.length === 0) return false;
    return entries.some((entry) => hookMatchesObject(entry, object));
  }

  /**
   * [#22782] Does this write need its own unit of work? Yes when its `after*`
   * dispatch can ABORT and no unit is open, so the abort rolls back what
   * `HookSchema.onError` says: the row and every `ctx.api` write the chain made. "Can abort"
   * is a metadata-bound hook (`meta` — the only entries with a declared
   * `onError`) on `event` for `object`, automations not skipped, that either
   * is blocking (not `async`) with `onError` `abort` (the default), or carries
   * a `condition` (#22856): a condition that cannot be evaluated aborts the
   * operation whatever `onError` says, and before an `async` hook detaches
   * (#4775, `HookConditionError`), so it is read by the wrapper's own
   * {@link declaredHookCondition}. Hook count and order are untouched (#7413);
   * only the boundary around them moves.
   *
   * No unit — the pre-#22782 path — when one is open (ambient or threaded: the
   * caller's unit decides; a threaded handle whose unit has closed is not open,
   * #22855 `isClosedUnitHandle`), when `object` is off the default driver
   * (`transaction()` covers that one alone and would refuse the write), or when
   * that driver has no transactions (ADR-0119 D1; asking would only warn).
   * `SummaryRecomputeError` means "the records WERE written": it is rethrown
   * after the commit, never through the rollback. Only the write's OWN refusal
   * arrives here: one a hook's `ctx.api` write raised was already converted
   * where it left the handler (#29422, `hookStoppedRefusal`), so it rolls back.
   */
  static opensAfterAbortUnit(this: Pick<HooksAndFunctionsHost, 'defaultDriver' | 'drivers' | 'getDriver' | 'hooks' | 'isClosedUnitHandle' | 'txStore'>, event: 'afterInsert' | 'afterUpdate' | 'afterDelete', object: string, context: ExecutionContext | undefined): boolean {
    const threaded = context?.transaction;
    if ((threaded !== undefined && !this.isClosedUnitHandle(threaded)) || this.txStore.getStore()?.transaction !== undefined) return false;
    if ((context as { skipAutomations?: unknown } | undefined)?.skipAutomations) return false;
    const aborting = (this.hooks.get(event) ?? []).some((entry) =>
      entry.meta && hookMatchesObject(entry, object)
      && ((!entry.meta.async && (entry.meta.onError ?? 'abort') === 'abort') || declaredHookCondition(entry.meta) !== undefined));
    if (!aborting) return false;
    const defaultDriver = this.defaultDriver ? this.drivers.get(this.defaultDriver) : undefined;
    try {
      return this.getDriver(object) === defaultDriver && driverSupportsTransactions(defaultDriver);
    } catch {
      return false; // the write itself reports an unroutable object
    }
  }

  /**
   * [#9719, widened to `beforeUpdate` by #9974] The whole-operation
   * `beforeUpdate` / `beforeDelete` dispatch for an UNSCOPED predicate write —
   * `multi: true` with no caller predicate at all (`options.where` absent or
   * `null`) — delivered ONLY to registrations that declared
   * {@link HookEntry.dispatchUnscopedMultiWrite} on `event`.
   *
   * ## Why this dispatch exists
   *
   * The per-row contract (#5038 / #5574) made the operation's SHAPE invisible
   * to `before*` handlers on the predicate path: every per-row context arrives
   * with `input.id` bound, and a zero-match predicate dispatches nothing at
   * all ([D1]). A guard whose rule is about the shape — #4757's "refuse a
   * predicate-less multi-delete outright, regardless of what it matches" on
   * `sys_attachment`, and #4630's twin on `sys_comment` — therefore could not
   * fire through the wired engine: with rows matched its by-id branch shadowed
   * the check, and with none matched it never ran. Both limbs need a dispatch
   * that happens BEFORE the matched-row read, keyed on the operation's shape
   * alone.
   *
   * ## Why one helper, both verbs
   *
   * The update half was measured as a PARTIAL guard rather than a total
   * fail-open (#9974): an unscoped `multi: true` update was refused only when
   * it happened to sweep a row the caller lacked rights to — the per-row gate
   * catching the shape by accident — and resolved silently when the caller was
   * entitled to every row, zero-match included. A guard that fires by accident
   * reads as enforcement while enforcing nothing, which is why the ruling
   * closed it rather than narrowing the declaration. `event` is the ONLY thing
   * that differs between the two verbs here, so it is a parameter and not a
   * second copy of this method.
   *
   * ## What the handler receives
   *
   * The whole-operation context: `input.id` undefined, `input.options` the
   * caller's raw options — the contractual upper-bound read `hook.zod.ts`
   * blesses for `before*` handlers (`input.options.where` / `.multi`) — and
   * `session` built by the engine, so the handler's own bypass rules (system
   * context, no identity envelope) apply unchanged. It is a DERIVED context,
   * not the batch-level one (`hook.zod.ts`: no handler is dispatched on that),
   * carrying `dispatch: { mode: 'record', index: 0 }` — this call stands for
   * the caller's whole write, not for one row of it — with the batch `scope`
   * object kept identity-shared so a stash still reaches the after phase.
   *
   * ## Deliberately opt-in
   *
   * Undeclared registrations see NO new dispatch: generalizing an unscoped-
   * multi-write refusal to every guarded object is a product decision this
   * mechanism does not take (#9719 commissions the `sys_attachment`
   * restoration, #9974 the `sys_comment` update half — neither commissions an
   * engine-wide rule). The engine stays neutral; the policy — who is refused,
   * with which error — lives in the declaring handler.
   *
   * ## The id slot is not a lever here either
   *
   * The old batch dispatch's `input.id` was present-but-`undefined`, and
   * binding it rerouted the write onto the by-id branch. The ladder is now
   * resolved before any handler runs, so a handler binding `input.id` on this
   * context would retarget nothing — refused rather than ignored, the same
   * rule as D4 and #6752 (`HookTargetRebindError`, path `'unscoped-multi'`).
   */
  static async dispatchUnscopedMultiWriteHooks(this: Pick<HooksAndFunctionsHost, 'hooks'>, event: 'beforeUpdate' | 'beforeDelete', object: string, batchCtx: HookContext): Promise<void> {
    const entries = this.hooks.get(event);
    if (!entries || entries.length === 0) return;
    const flagged = entries.filter(
      (entry) => entry.dispatchUnscopedMultiWrite && hookMatchesObject(entry, object),
    );
    if (flagged.length === 0) return;
    // Mirrors `triggerHooks`' opt-out rule: `skipAutomations` suppresses only
    // metadata-bound entries. No metadata binding can set the flag today, so
    // this is parity with the dispatch loop rather than a reachable branch —
    // kept so the two rules cannot drift if that ever changes.
    const skipAutomations =
      (batchCtx.session as { skipAutomations?: boolean } | undefined)?.skipAutomations === true;
    const wholeOpCtx = {
      ...batchCtx,
      dispatch: {
        mode: 'record',
        index: 0,
        scope: (batchCtx.dispatch as { scope: Record<string, unknown> }).scope,
      },
    } as unknown as HookContext;
    for (const entry of flagged) {
      if (skipAutomations && entry.meta) continue;
      // [#29422] As in `triggerHooks`.
      try {
        await entry.handler(wholeOpCtx);
      } catch (e) {
        throw hookStoppedRefusal(e, event, object, entry.hookName);
      }
    }
    // `input` is identity-shared with the batch context, so the observation
    // covers everything the handlers touched.
    const observed = (wholeOpCtx.input as { id?: unknown }).id;
    if (observed !== undefined) {
      throw new HookTargetRebindError({
        object,
        event,
        path: 'unscoped-multi',
        expectedId: undefined,
        observedId: observed,
      });
    }
  }
}
