// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29986 codemod] The
 * "Class head: units, hooks, functions, body runners, hook dispatch" section of
 * `ObjectQL`: the bodies of `unregisterHooksByPackage`,
 * `unregisterFunctionsByPackage`, `dispatchUnscopedMultiWriteHooks` moved out
 * of `engine.ts` whole by `scripts/codemod-split-engine.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `ObjectQL`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link HooksAndFunctionsHost}: exactly the
 * `ObjectQL` members they read, private ones included. Each method hands its
 * body one literal of the members that body reads, plus a `.call`: methods go
 * as closures that call them on the engine at call time, so a subclass
 * override or an instance spy is still the one reached; fields and accessors
 * go as GETTERS, read when the body reads them, as they were on the class.
 *
 * The module imports `engine.ts` for types only, so the two modules form no
 * evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { HookContext } from '@objectstack/spec/data';
import { hookStoppedRefusal } from './summary-errors.js';
import { HookTargetRebindError } from './hook-target-rebind-errors.js';
import { hookMatchesObject } from './engine-top-level.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ObjectQL` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface HooksAndFunctionsHost {
  readonly functions: ObjectQL['functions'];
  readonly hooks: ObjectQL['hooks'];
  readonly logger: ObjectQL['logger'];
}

/** The body of `ObjectQL#unregisterHooksByPackage`; the method's docblock there is its contract. */
export function unregisterHooksByPackage(this: Pick<HooksAndFunctionsHost, 'hooks' | 'logger'>, packageId: string): number {
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

/** The body of `ObjectQL#unregisterFunctionsByPackage`; the method's docblock there is its contract. */
export function unregisterFunctionsByPackage(this: Pick<HooksAndFunctionsHost, 'functions' | 'logger'>, packageId: string): number {
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

/** The body of `ObjectQL#dispatchUnscopedMultiWriteHooks`; the method's docblock there is its contract. */
export async function dispatchUnscopedMultiWriteHooks(this: Pick<HooksAndFunctionsHost, 'hooks'>, event: 'beforeUpdate' | 'beforeDelete', object: string, batchCtx: HookContext): Promise<void> {
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
