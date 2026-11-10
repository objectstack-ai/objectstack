// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30052 codemod] The "Scoped execution context: repositories, elevation,
 * transactions" section: the bodies of `ScopedContext`'s methods `object`,
 * `sudo`, `withRunAs`, `[SEED_USER_GRANTS]`, `transaction`,
 * `releaseJoinedHandle`, `txDriver`, `beginTransaction`, `commitTransaction`,
 * `rollbackTransaction`, `serveFormulaField` moved out of `engine.ts` whole by
 * `scripts/codemod-split-engine.mjs` (its second pass).
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
import { appAutomationElevationOf, markAppAutomationElevation, resolveUserAuthzGrants } from '@objectstack/core';
import type { EngineTransactionInfo, EngineTransactionOptions } from '@objectstack/core';
import { rolledBackRefusal } from './summary-errors.js';
import { TransactionUnsupportedError } from './transaction-errors.js';
import { redactPropagatedDriverFault } from '@objectstack/types';
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
  /** The instance itself: a moved body reads `this.facade` where the method read a bare `this` (#30020). */
  readonly facade: ScopedContext;
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

  /** The body of `ScopedContext#[SEED_USER_GRANTS]`; the method's docblock there is its contract. */
  static async seedUserGrants(this: Pick<ScopedContextHost, 'derive' | 'engine' | 'executionContext' | 'facade'>): Promise<ScopedContext> {
    const ctx = this.executionContext;
    if (!ctx.userId) return this.facade;
    const needsGrants = !Array.isArray(ctx.permissions);
    const needsPeers = !Array.isArray(ctx.org_user_ids);
    const needsEmail = !ctx.email;
    if (!needsGrants && !needsPeers && !needsEmail) return this.facade;
    const grants = await resolveUserAuthzGrants(
      this.engine,
      ctx.userId,
      ctx.tenantId ? { tenantId: ctx.tenantId } : {},
    );
    return this.derive({
      ...ctx,
      ...(needsGrants ? { positions: grants.positions, permissions: grants.permissions } : {}),
      // [ADR-0150 D3] Which package's set each of those names is, carried with
      // them and only with them.
      ...(needsGrants && grants.permissionSetAddresses ? { permissionSetAddresses: grants.permissionSetAddresses } : {}),
      // [ADR-0151 D3] An AI service account is the agent principal of its own
      // calls, holding no system permission.
      ...(needsGrants && grants.principalKind ? { principalKind: grants.principalKind, systemPermissions: [] } : {}),
      ...(needsPeers ? { org_user_ids: grants.org_user_ids } : {}),
      ...(needsEmail && grants.email ? { email: grants.email } : {}),
    });
  }

  /** The body of `ScopedContext#transaction`; the method's docblock there is its contract. */
  static async transaction(this: Pick<ScopedContextHost, 'derive' | 'engine' | 'executionContext' | 'facade'>, callback: (trxCtx: ScopedContext, info: EngineTransactionInfo) => Promise<any>, opts?: EngineTransactionOptions): Promise<any> {
    const engine = this.engine as any;
    // The engine's ambient transaction store (ADR-0034), reached the `as any`
    // way this whole class reaches engine internals, for the D2 join below. A
    // transaction this call opens is published by the engine's own helper.
    const txStore = engine?.txStore as
      | { getStore(): { transaction: unknown } | undefined }
      | undefined;

    // ADR-0067 D2 — JOIN an already-open ambient transaction instead of opening
    // a nested driver one (#6168). Same first move, same reasons and the same
    // shape as `ObjectQL.transaction`: a nested begin would take a second
    // connection AND would not be covered by the outer rollback, so the outer
    // caller would stop owning the one-and-only commit/rollback.
    //
    // BEFORE the driver/`require` handling on purpose, mirroring the engine:
    // when there is an ambient transaction there IS a transaction, so
    // `require: true` is satisfied by joining it and the degrade is not
    // reachable.
    const ambient = txStore?.getStore();
    if (ambient?.transaction) {
      // The handle is threaded EXPLICITLY into the child context, not left to
      // the ambient store, for the same reason the engine surface threads it:
      // `buildDriverOptions` prefers the explicit handle, and it survives async
      // boundaries the store does not. It is identity-equal to the store's
      // handle, so `transactionCoversDriverFor` still attributes it to the
      // OUTER owner and the #5351 same-origin gate judges it unchanged.
      const joinedCtx = this.derive({ ...this.executionContext, transaction: ambient.transaction });
      // JOINED, not owned: the outer caller decides commit vs rollback (#5696).
      return callback(joinedCtx, { owned: false });
    }

    // Find the default driver for transaction support
    const driver = engine.defaultDriver
      ? engine.drivers?.get(engine.defaultDriver)
      : undefined;

    // [#18063] Declaration, not bare method presence — see the engine surface's
    // gate; one predicate serves both so they cannot answer differently.
    if (!driverSupportsTransactions(driver)) {
      const datasource = engine.defaultDriver ?? driver?.name;
      if (opts?.require === true) {
        // Same fail-closed refusal as the engine surface (#5696 point 1).
        throw new TransactionUnsupportedError(datasource ?? '<no default datasource>');
      }
      // No transaction support — execute directly. Declared (ADR-0119 D1), but
      // said out loud since #4619: the caller asked for atomicity and the
      // callback is about to run without any.
      engine.warnTransactionUnsupported?.(datasource, driver?.supports?.transactionsUnsupported === true);
      return callback(this.facade, { owned: false });
    }

    const trx = await driver.beginTransaction();
    const trxCtx = this.derive({ ...this.executionContext, transaction: trx });
    // Publish this transaction into the engine's ambient store so internal
    // queries during writes reuse its connection (ADR-0034) — and so a nested
    // `transaction()` on either surface can JOIN it. The store entry also
    // carries WHICH driver owns the transaction (#4619) so the write path can
    // report a write routed off it. [#22855] Through the engine's ONE unit
    // helper, `runOpenedUnit`, the one `ObjectQL.transaction` runs its callback
    // in, reached the same `as any` way as `txStore` itself. It closes the unit
    // when the callback settles, so work the callback started and did not await
    // (an `async: true` hook) no longer keeps the finished handle, neither the
    // ambient one nor the `trxCtx` one threaded above.
    const runIn = <R>(fn: () => Promise<R>): Promise<R> =>
      typeof engine.runOpenedUnit === 'function' ? engine.runOpenedUnit(trx, driver, fn) : fn();

    try {
      // Reached only with no ambient transaction to join, so this call really
      // did open one and the callback owns the outcome (#5696 / #6168).
      const result = await runIn(() => callback(trxCtx, { owned: true }));
      if (driver.commit) await driver.commit(trx);
      else if (driver.commitTransaction) await driver.commitTransaction(trx);
      return result;
    } catch (error) {
      if (driver.rollback) await driver.rollback(trx);
      else if (driver.rollbackTransaction) await driver.rollbackTransaction(trx);
      // [#21274] The engine surface's twin (`ObjectQL.transaction`), the
      // stale-roll-up conversion included.
      throw redactPropagatedDriverFault(rolledBackRefusal(error));
    }
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
