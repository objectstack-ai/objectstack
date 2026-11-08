// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30052 codemod] The "Scoped execution context: repositories, elevation,
 * transactions" section: the bodies of `ScopedContext`'s methods `object`,
 * `sudo`, `withRunAs`, `releaseJoinedHandle`, `txDriver`, `beginTransaction`,
 * `commitTransaction`, `rollbackTransaction`, `serveFormulaField` moved out of
 * `engine.ts` whole by `scripts/codemod-split-engine.mjs` (its second pass).
 * The bodies of `derive` and `[APP_AUTHORED_HOOK_API]` moved by hand
 * (#30975): each writes the private `appAuthored` of the instance it builds,
 * which the codemod refuses to move (`foreign-private`), so each writes it
 * through that instance's own host setter.
 *
 * A MOVE, not a redesign. {@link ScopedContextFacet} is a stateless facet of
 * `ScopedContext`: each static method of it is the body of the `ScopedContext`
 * method of the same name exactly as it stood: not re-indented, not formatted,
 * not edited. The method stays on the class as a one-call stub with its
 * signature, so the published surface, an instance spy and a subclass override
 * are what they were. A public method keeps its docblock on the class, the
 * contract; a private method's docblock moved here with its body. The state
 * stays on `ScopedContext`.
 *
 * The bodies reach the instance through {@link ScopedContextHost}: exactly the
 * `ScopedContext` members they read, private ones included. Every stub hands
 * its body, by a `.call`, the same host: `scopedContextHost` in
 * `engine-scoped-hosts.ts`, built once per instance by the class's static
 * block. Methods go as closures that call them on the instance at call time;
 * fields and accessors go as GETTERS, read when the body reads them, and a
 * field a body assigns goes with a SETTER that assigns it on the instance.
 *
 * Values declared in `engine.ts` are imported from it (lever (a) of
 * ruling 6591753301); every use is inside a function body, so the import
 * cycle is never read at evaluation time. `index.ts` re-exports nothing from
 * this module.
 */

import { driverSupportsTransactions } from '@objectstack/spec/data';
import type { IScopedContext } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { appAutomationElevationOf, markAppAutomationElevation } from '@objectstack/core';
import { UnscopedHookApi } from './hook-run-as.js';
import { refuseAppAuthoredPermanentDelete } from './recycle-bin/app-authored-delete.js';
import type { HookRunAs, HookRunAsRef } from './hook-run-as.js';
import { scopedContextHost } from './engine-scoped-hosts.js';
import { ObjectRepository, ScopedContext } from './engine.js';
import type { ObjectQL } from './engine.js';

/**
 * The `ScopedContext` members the bodies of {@link ScopedContextFacet} read —
 * every one of them, and no other. Each is typed AS the class member (an
 * indexed access on the class), so a change to a member's signature on the
 * class is a change here too. `readonly` members are the getters; the others
 * are fields a body assigns.
 */
export interface ScopedContextHost {
  appAuthored: ScopedContext['appAuthored'];
  derive: ScopedContext['derive'];
  readonly engine: ScopedContext['engine'];
  readonly executionContext: ScopedContext['executionContext'];
  readonly joinedHandles: ScopedContext['joinedHandles'];
  releaseJoinedHandle: ScopedContext['releaseJoinedHandle'];
  txDriver: ScopedContext['txDriver'];
}

/** The bodies of `ScopedContext`'s methods: a stateless facet, called by the class's stubs. */
export class ScopedContextFacet {
  /**
   * A child over `executionContext` that keeps this api's provenance.
   *
   * The child's private `appAuthored` is written through the child's own host
   * (`scopedContextHost.of(child)`), the port its class's static block fills:
   * a module function cannot write another instance's private field directly.
   */
  static derive(this: Pick<ScopedContextHost, 'appAuthored' | 'engine'>, executionContext: ExecutionContext): ScopedContext {
    const child = new ScopedContext(executionContext, this.engine);
    scopedContextHost.of(child).appAuthored = this.appAuthored;
    return child;
  }

  /**
   * The body of `ScopedContext#[APP_AUTHORED_HOOK_API]`; the method's docblock
   * there is its contract. The new api's private `appAuthored` is written
   * through its own host, as in {@link ScopedContextFacet.derive}.
   */
  static appAuthoredHookApi(this: Pick<ScopedContextHost, 'engine' | 'executionContext'>): ScopedContext {
    const ctx = this.executionContext;
    const inheritsElevation = ctx.isSystem && !ctx.flowRunId && !appAutomationElevationOf(ctx);
    const api = new ScopedContext(inheritsElevation ? markAppAutomationElevation(ctx, 'hook') : ctx, this.engine);
    scopedContextHost.of(api).appAuthored = true;
    return api;
  }

  /** The body of `ScopedContext#object`; the method's docblock there is its contract. */
  static object(this: Pick<ScopedContextHost, 'appAuthored' | 'engine' | 'executionContext'>, name: string): ObjectRepository {
    const repo = new ObjectRepository(name, this.executionContext, this.engine as any);
    // [ADR-0148 D3, ruling A recorded in 6691358077] An app-authored hook's
    // api (and every api derived from it) refuses a permanent delete: the same
    // refusal a sandboxed body's api applies, here for the hook's in-process
    // `handler`, whatever its `runAs`.
    return this.appAuthored ? refuseAppAuthoredPermanentDelete(name, repo, 'hook handler') : repo;
  }

  /** The body of `ScopedContext#sudo`; the method's docblock there is its contract. */
  static sudo(this: Pick<ScopedContextHost, 'appAuthored' | 'derive' | 'executionContext'>): ScopedContext {
    const elevated = { ...this.executionContext, isSystem: true };
    return this.derive(
      this.appAuthored && !appAutomationElevationOf(elevated)
        ? markAppAutomationElevation(elevated, 'hook')
        : elevated,
    );
  }

  /** The body of `ScopedContext#withRunAs`; the method's docblock there is its contract. */
  static withRunAs(this: Pick<ScopedContextHost, 'derive' | 'executionContext'>, runAs: Exclude<HookRunAs, 'inherit'>, ref: HookRunAsRef): IScopedContext {
    if (runAs === 'system') {
      return this.derive(
        markAppAutomationElevation({ ...this.executionContext, isSystem: true }, 'hook'),
      );
    }
    if (!this.executionContext.userId) return new UnscopedHookApi(ref);
    return this.derive({ ...this.executionContext, isSystem: false });
  }

  /**
   * Was `handle` JOINED by this context rather than opened by it? Consumes the
   * record, so the trio's terminal call is also what forgets the handle.
   *
   * Two independent signals, because the trio's callers are exactly the ones
   * that cannot keep a closure on the stack and may not close on the same
   * object they opened on:
   *
   *   1. this context's own {@link joinedHandles} record, and
   *   2. identity with the CURRENT ambient handle — a handle the engine is
   *      holding open right now is, by construction, not one the trio opened
   *      (the trio never publishes into `txStore`, so a trio-owned handle is
   *      never the ambient one).
   *
   * Both point the same way and both fail SAFE: the ambiguous answer is
   * "abstain", never "commit a transaction we do not own".
   */
  static releaseJoinedHandle(this: Pick<ScopedContextHost, 'engine' | 'joinedHandles'>, handle: unknown): boolean {
    if (this.joinedHandles.delete(handle)) return true;
    if (handle == null) return false;
    const ambient = (this.engine as any)?.txStore?.getStore?.() as
      | { transaction?: unknown }
      | undefined;
    return ambient?.transaction === handle;
  }

  /**
   * Resolve the default driver, if it exposes transaction primitives.
   * Shared by {@link transaction} and the discrete begin/commit/rollback trio.
   */
  static txDriver(this: Pick<ScopedContextHost, 'engine'>): any | undefined {
    const engine = this.engine as any;
    const driver = engine.defaultDriver
      ? engine.drivers?.get(engine.defaultDriver)
      : undefined;
    // [#18063] Declaration, not bare method presence — the trio's `begin`
    // returns `null` and `commit`/`rollback` abstain for a transport that
    // declared it cannot honour a handle, which is the same graceful degrade a
    // driver with no `beginTransaction` already gets.
    return driverSupportsTransactions(driver) ? driver : undefined;
  }

  /** The body of `ScopedContext#beginTransaction`; the method's docblock there is its contract. */
  static async beginTransaction(this: Pick<ScopedContextHost, 'derive' | 'engine' | 'executionContext' | 'joinedHandles' | 'txDriver'>): Promise<{ ctx: ScopedContext; handle: unknown; owned: boolean } | null> {
    // ADR-0067 D2 — JOIN before the driver lookup, the same first move and the
    // same position as both callback faces (#6168 / #6406). An ambient
    // transaction IS a transaction, so there is nothing to look a driver up for.
    const ambient = (this.engine as any)?.txStore?.getStore?.() as
      | { transaction?: unknown }
      | undefined;
    if (ambient?.transaction) {
      // Threaded explicitly into the child context, identity-equal to the
      // store's handle — so `buildDriverOptions` binds every op on it to the
      // outer connection and `transactionCoversDriverFor` still attributes the
      // handle to the OUTER owner (#5351 unchanged).
      const ctx = this.derive({ ...this.executionContext, transaction: ambient.transaction });
      this.joinedHandles.add(ambient.transaction);
      return { ctx, handle: ambient.transaction, owned: false };
    }
    const driver = this.txDriver();
    if (!driver) return null;
    const trx = await driver.beginTransaction();
    const ctx = this.derive({ ...this.executionContext, transaction: trx });
    return { ctx, handle: trx, owned: true };
  }

  /** The body of `ScopedContext#commitTransaction`; the method's docblock there is its contract. */
  static async commitTransaction(this: Pick<ScopedContextHost, 'releaseJoinedHandle' | 'txDriver'>, handle: unknown): Promise<void> {
    if (this.releaseJoinedHandle(handle)) return;
    const driver = this.txDriver();
    if (!driver) return;
    if (driver.commit) await driver.commit(handle);
    else if (driver.commitTransaction) await driver.commitTransaction(handle);
  }

  /** The body of `ScopedContext#rollbackTransaction`; the method's docblock there is its contract. */
  static async rollbackTransaction(this: Pick<ScopedContextHost, 'releaseJoinedHandle' | 'txDriver'>, handle: unknown): Promise<void> {
    if (this.releaseJoinedHandle(handle)) return;
    const driver = this.txDriver();
    if (!driver) return;
    if (driver.rollback) await driver.rollback(handle);
    else if (driver.rollbackTransaction) await driver.rollbackTransaction(handle);
  }

  /** The body of `ScopedContext#serveFormulaField`; the method's docblock there is its contract. */
  static async serveFormulaField(this: Pick<ScopedContextHost, 'engine' | 'executionContext'>, objectName: string, record: Record<string, unknown>, field: string): Promise<unknown> {
    return (this.engine as unknown as ObjectQL).serveFormulaField(objectName, record, field, this.executionContext);
  }
}
