// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Class head: units, hooks, functions, body runners, hook dispatch" section of
 * `ObjectQL`: the bodies of `recordResidualOwner`, `residualOwnerSource`,
 * `constructLogger`, `construct`, `getStatus`, `registerHook`,
 * `unregisterHooksByPackage`, `registerFunction`, `resolveFunction`,
 * `resolveFunctionEntry`, `unregisterFunctionsByPackage`, `bindHooks`,
 * `setDefaultBodyRunner`, `getDefaultBodyRunner`, `setDefaultActionRunner`,
 * `getDefaultActionRunner`, `triggerHooks`, `hasHooksFor`,
 * `opensAfterAbortUnit`, `dispatchUnscopedMultiWriteHooks` moved out of
 * `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
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
 * body, by a `.call`, the same host: `hooksAndFunctionsHost` in
 * `engine-facet-hosts.ts`, built once per engine by the class's static block.
 * Methods go as closures that call them on the engine at call time, so a
 * subclass override or an instance spy is still the one reached; fields and
 * accessors go as GETTERS, read when the body reads them, as they were on the
 * class, and a field a body assigns goes with a SETTER that assigns it on the
 * engine.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import { driverSupportsTransactions } from '@objectstack/spec/data';
import type { HookContext } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { STORED_METADATA_TYPE_READ_GATE_OBJECTS, storedMetadataTypeReadGate } from './stored-metadata-type-read-gate.js';
import { createLogger } from '@objectstack/core';
import { hookStoppedRefusal } from './summary-errors.js';
import { startSummaryRefreshOnEnable } from './summary-enable-refresh.js';
import { HookTargetRebindError } from './hook-target-rebind-errors.js';
import { declaredHookCondition } from './hook-wrappers.js';
import { CoreServiceName } from '@objectstack/spec/system';
import { bindHookNotice } from './hook-notice.js';
import { bindHooksToEngine } from './hook-binder.js';
import type { BindHooksOptions } from './hook-binder.js';
import {
  DISPATCHABLE_HOOK_EVENTS, assertDispatchableHookEvent, assertHookScopeNotSelfCancelling,
  assertValidHookExcludeObjects, assertValidHookObject, assertValidUnscopedMultiWriteFlag, hookMatchesObject,
} from './engine-top-level.js';
import type { FunctionEntry, FunctionRegistrationOptions, HookEntry, HookHandler } from './engine-top-level.js';
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
  readonly _registry: ObjectQL['_registry'];
  readonly defaultDriver: ObjectQL['defaultDriver'];
  readonly drivers: ObjectQL['drivers'];
  /** The engine itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ObjectQL;
  readonly functions: ObjectQL['functions'];
  getDriver: ObjectQL['getDriver'];
  readonly hooks: ObjectQL['hooks'];
  isClosedUnitHandle: ObjectQL['isClosedUnitHandle'];
  readonly logger: ObjectQL['logger'];
  readonly manifests: ObjectQL['manifests'];
  registerMiddleware: ObjectQL['registerMiddleware'];
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

  /** R8 (#30020): the value `ObjectQL`'s constructor assigns to `logger`, a field only a constructor may assign. */
  static constructLogger(hostContext: Record<string, any> = {}): ObjectQL['logger'] {
    return hostContext.logger || createLogger({ level: 'info', format: 'pretty' });
  }

  /** The body of `ObjectQL`'s constructor; the constructor there keeps its signature and docblock. */
  static construct(this: Pick<HooksAndFunctionsHost, '_registry' | 'facade' | 'logger' | 'manifests' | 'registerMiddleware'>): void {
    // Use provided logger or create a new one
    // [#29986 codemod] R8: `this.logger` is assigned on the class (`constructLogger`).
    // [#30215] `registerApp` writes `manifests`; an uninstall withdraws the
    // package through the registry's own verb, on every door, so the entry goes
    // with the registry's record. Left behind, ADR-0070's `isWritablePackage`
    // (which reads this map first) kept an uninstalled package read-only until
    // a restart.
    this._registry.onPackageUninstalled((packageId) => { this.manifests.delete(packageId); });
    // [#30377] A roll-up a package adds by extension is withheld with it, so
    // the child writes made during a disable recompute nothing: an enable
    // recomputes it (`summary-enable-refresh.ts`), on every enable door.
    this._registry.onPackageEnabled((packageId) => startSummaryRefreshOnEnable(this.facade, this.logger, packageId));
    // Pick up production hardening switches from env so deployers can
    // enforce strict-body without code changes:
    //   OBJECTQL_STRICT_HOOKS=1 → unresolved hooks throw at bind time
    //   OBJECTQL_WARN_LEGACY_HANDLER=1 → log a deprecation per legacy bind
    if (process?.env?.OBJECTQL_STRICT_HOOKS === '1') {
      (this.facade as any)._strictHookBinding = true;
    }
    if (process?.env?.OBJECTQL_WARN_LEGACY_HANDLER === '1') {
      (this.facade as any)._warnLegacyHandler = true;
    }
    // [#27884] The stored-row read gate: a caller-context read of a
    // stored-metadata table serves a capability-gated type's documents only to
    // holders of that capability — the row the `/meta` type gate reads. In the
    // constructor, so no engine serves those tables without it. See
    // `stored-metadata-type-read-gate.ts`.
    for (const object of STORED_METADATA_TYPE_READ_GATE_OBJECTS) {
      this.registerMiddleware(storedMetadataTypeReadGate, { object });
    }
    this.logger.info('ObjectQL Engine Instance Created');
  }

  /** The body of `ObjectQL#getStatus`; the method's docblock there is its contract. */
  static getStatus(): {
    name: "data";
    status: string;
    version: string;
    features: string[];
  } {
      return {
          name: CoreServiceName.enum.data,
          status: 'running',
          version: '0.9.0',
          features: ['crud', 'query', 'aggregate', 'transactions', 'metadata']
      };
  }

  /** The body of `ObjectQL#registerHook`; the method's docblock there is its contract. */
  static registerHook(this: Pick<HooksAndFunctionsHost, 'hooks' | 'logger'>, event: string, handler: HookHandler, options?: {
    object?: string | string[];
    /**
     * [#5928] Object name(s) subtracted from what `object` admits — the way to
     * say "global, except these". See {@link HookEntry.excludeObjects} for why
     * an allow list cannot express it, and
     * {@link assertValidHookExcludeObjects} for the two refused shapes.
     */
    excludeObjects?: string | string[];
    priority?: number;
    packageId?: string;
    /**
     * [#9719, widened by #9974] Opt-in whole-operation dispatch for an
     * UNSCOPED predicate write (`multi: true`, no `where`) — see
     * {@link HookEntry.dispatchUnscopedMultiWrite}. Valid on `beforeUpdate` /
     * `beforeDelete` registrations only.
     */
    dispatchUnscopedMultiWrite?: boolean;
    /** Original metadata Hook definition (set by `bindHooksToEngine`). */
    meta?: any;
    /** Stable name from metadata (set by `bindHooksToEngine`). */
    hookName?: string;
  }): void {
    // Refuse a scope that is statically decidable as meaningless before
    // anything is registered or reported. Each face is checked on its own
    // first, so the combined check below can assume well-formed names.
    // [#5928] An exclusion face that subtracts nothing (`''`) or everything (`'*'`).
    assertValidHookExcludeObjects(options?.excludeObjects, event);
    // [commit 708431313] An allow face that names nothing (`''` → global, `[]`/`['']` → never fires).
    assertValidHookObject(options?.object, event);
    // [commit 708431313] Two well-formed faces that cancel out (`'account'` minus `'account'`).
    assertHookScopeNotSelfCancelling(options?.object, options?.excludeObjects, event);
    // [#9719/#9974] The unscoped-multi-write flag on an event whose dispatch never reads it.
    assertValidUnscopedMultiWriteFlag(options?.dispatchUnscopedMultiWrite, event);
    // [#17713] An event inside the engine's OWN lifecycle namespace that the
    // engine never dispatches — `beforeCount`, `beforeFindOne` and their four
    // siblings. #3195 warned and registered anyway; the handler then never ran,
    // which on a read filter is a guardrail the author believes they armed.
    // Refused at the door, with the per-seam repair named.
    assertDispatchableHookEvent(event);
    // [#3195] Guard against enum-vs-dispatch drift for every OTHER unknown
    // name: a hook on an event the engine never triggers would register
    // "successfully" and then silently never fire. Warn loudly rather than
    // swallow it. Still not a hard reject here — a custom driver/plugin may
    // dispatch its own events via `triggerHooks`, and outside the engine's own
    // vocabulary that is the likely reading (#17713 keeps it intact).
    if (!DISPATCHABLE_HOOK_EVENTS.has(event)) {
      this.logger.warn(
        `Hook registered for '${event}', which the engine never dispatches — it will never fire. ` +
          `Dispatchable events: ${[...DISPATCHABLE_HOOK_EVENTS].join(', ')}. ` +
          `(Read filtering → RLS/permissions; field masking → field metadata; delete guards → beforeDelete.)`,
        { event, object: options?.object, hookName: options?.hookName },
      );
    }
    if (!this.hooks.has(event)) {
        this.hooks.set(event, []);
    }
    const entries = this.hooks.get(event)!;
    entries.push({
      handler,
      object: options?.object,
      excludeObjects: options?.excludeObjects,
      priority: options?.priority ?? 100,
      packageId: options?.packageId,
      dispatchUnscopedMultiWrite: options?.dispatchUnscopedMultiWrite,
      meta: options?.meta,
      hookName: options?.hookName,
    });
    // Sort by priority (lower runs first)
    entries.sort((a, b) => a.priority - b.priority);
    // The exclusion face is reported alongside the allow face: a registration's
    // scope is BOTH halves (#5928), and a log that printed only `object` would
    // describe a global hook for an entry that is global-minus-twenty-tables.
    this.logger.debug('Registered hook', { event, object: options?.object, excludeObjects: options?.excludeObjects, priority: options?.priority ?? 100, totalHandlers: entries.length });
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

  /** The body of `ObjectQL#bindHooks`; the method's docblock there is its contract. */
  static bindHooks(this: Pick<HooksAndFunctionsHost, '_defaultBodyRunner' | 'facade' | 'logger'>, hooks: any[] | undefined, opts?: {
    packageId?: string;
    functions?: Record<string, HookHandler>;
    bodyRunner?: any;
    strict?: boolean;
    warnLegacyHandler?: boolean;
    metrics?: any;
    /** Wraps each in-process handler after its name resolves — see {@link BindHooksOptions.wrapHandler}. */
    wrapHandler?: BindHooksOptions['wrapHandler'];
  }): void {
    const merged = { ...(opts ?? {}), logger: this.logger } as any;
    if (!merged.bodyRunner && this._defaultBodyRunner) {
      merged.bodyRunner = this._defaultBodyRunner;
    }
    if (merged.strict === undefined && (this.facade as any)._strictHookBinding) {
      merged.strict = true;
    }
    if (merged.warnLegacyHandler === undefined && (this.facade as any)._warnLegacyHandler) {
      merged.warnLegacyHandler = true;
    }
    if (!merged.metrics && (this.facade as any)._hookMetricsRecorder) {
      merged.metrics = (this.facade as any)._hookMetricsRecorder;
    }
    bindHooksToEngine(this.facade, hooks, merged);
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

  /** The body of `ObjectQL#triggerHooks`; the method's docblock there is its contract. */
  static async triggerHooks(this: Pick<HooksAndFunctionsHost, 'hooks' | 'logger'>, event: string, context: HookContext): Promise<void> {
    const entries = this.hooks.get(event) || [];
    // [#28251] `ctx.notice` — the write's own `onNotice` listener, bound here
    // so every insert / update dispatch site carries it (see hook-notice.ts).
    bindHookNotice(event, context);

    if (entries.length === 0) {
      this.logger.debug('No hooks registered for event', { event });
      return;
    }

    this.logger.debug('Triggering hooks', { event, count: entries.length });

    // `session.skipAutomations` (set from ExecutionContext.skipAutomations —
    // import with "run automations & triggers" unchecked, import undo)
    // suppresses hooks bound FROM METADATA (`bindHooksToEngine` stamps
    // `entry.meta`). Hooks registered in code by plugins — audit, capability
    // gates, sharing projection — have no `meta` and always run: the opt-out
    // must never bypass security or audit (#2922).
    const skipAutomations =
      (context.session as { skipAutomations?: boolean } | undefined)?.skipAutomations === true;

    for (const entry of entries) {
      // Per-object matching — allow face minus exclusion face, the one shared
      // rule `hasHooksFor` also reads (#5928).
      if (!hookMatchesObject(entry, context.object)) {
        continue; // Skip non-matching hooks
      }
      if (skipAutomations && entry.meta) {
        this.logger.debug('Skipping metadata-bound hook (skipAutomations)', { event, hook: entry.hookName });
        continue;
      }
      // [#29422] A stale-roll-up refusal a hook's own `ctx.api` write raised
      // describes THAT write, not this one: `hookStoppedRefusal`.
      try {
        await entry.handler(context);
      } catch (e) {
        throw hookStoppedRefusal(e, event, context.object, entry.hookName);
      }
    }
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
