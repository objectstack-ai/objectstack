// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12010] The seam pin for `ConnectionEngineLike`.
 *
 * `ConnectionEngineLike` is the exported view `DatasourceConnectionService`
 * drives the ObjectQL `'data'` engine through. It used to re-declare seven
 * engine members by hand; it is now derived from {@link IObjectQLEngine}. The
 * assertions below are the ones that FAIL if it is ever hand-written back.
 *
 * Enforced by `tsc --noEmit` (this package's `typecheck` includes `src`, and
 * `src/__tests__` is inside it), not by the vitest run: vitest strips types.
 * The `expect`s exist so the file is also a real, running test — but the
 * measurement that matters here is the typecheck.
 */

import { describe, expect, it } from 'vitest';
import type { IDataDriver, IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ConnectionEngineLike } from '../datasource-connection-service.js';

describe('ConnectionEngineLike is the contract, not a fork of it (#12010)', () => {
  it('unregisterDriver answers a boolean — a no-op is distinguishable from a removal', () => {
    // #13578. `void` would have made "evicted it" and "there was nothing to
    // evict" indistinguishable to an idempotent caller (a retried DELETE, a
    // teardown sweep after a partial one), which is the same
    // exit-0-and-did-nothing shape the eviction fix exists to remove.
    type Answer = ReturnType<NonNullable<ConnectionEngineLike['unregisterDriver']>>;
    const exact: [Answer] extends [boolean] ? ([boolean] extends [Answer] ? 'exact' : never) : never =
      'exact';
    expect(exact).toBe('exact');
  });

  it('the real engine contract is assignable to this view', () => {
    // The defect this card measured, stated as a compile: with
    // `registerDriver?: (driver: unknown, …)` the engine was NOT assignable
    // here, because `unknown` is not assignable to the parameter's
    // `IDataDriver` under `strictFunctionTypes`. Cast-free by construction.
    const asConnectionEngine = (engine: IObjectQLEngine): ConnectionEngineLike => engine;
    expect(typeof asConnectionEngine).toBe('function');
  });

  it('registerDriver takes a DRIVER, not any value', () => {
    type RegisterDriver = NonNullable<ConnectionEngineLike['registerDriver']>;
    type DriverParam = Parameters<RegisterDriver>[0];
    // Exactly the contract's parameter — not a supertype of it. A widening
    // back to `unknown` collapses the second leg.
    const exact: [DriverParam] extends [IDataDriver]
      ? [IDataDriver] extends [DriverParam]
        ? 'exact'
        : never
      : never = 'exact';
    expect(exact).toBe('exact');
  });

  it('refuses a value that is not a driver, at the call site', () => {
    const engine = {} as ConnectionEngineLike;
    // @ts-expect-error - a bare `{ name }` is not an `IDataDriver`. This call
    // compiled before #12010, which is precisely the hole: the seam promised
    // the engine accepts any value as a driver, and it does not.
    engine.registerDriver?.({ name: 'com.example.not-a-driver' });
    expect(engine).toBeTruthy();
  });

  it('getDriverByName answers the contract driver, not `unknown`', () => {
    type Answer = ReturnType<NonNullable<ConnectionEngineLike['getDriverByName']>>;
    // `unknown` would satisfy neither leg; this is what lets `disconnect()`
    // reach `driver.disconnect` without the local re-derivation it used to
    // cast through.
    const exact: [Answer] extends [IDataDriver | undefined]
      ? [IDataDriver | undefined] extends [Answer]
        ? 'exact'
        : never
      : never = 'exact';
    expect(exact).toBe('exact');
  });

  it('declares exactly the eight derived members, each identical to its contract member', () => {
    // #13578 added `unregisterDriver`, taking the roster from seven to eight.
    // The roster is deliberately restated rather than derived from the seam:
    // its whole purpose is that widening the view is a decision someone writes
    // down here, not a side effect of editing the type. The eighth member is
    // `registerDriver`'s removal counterpart — the service needs it because
    // `disconnect()` has to evict the driver it just closed, and a datasource
    // deleted from the admin door was otherwise left in the engine registry
    // where the readiness probe kept reporting it.
    type Declared = keyof ConnectionEngineLike;
    type Expected =
      | 'registerDriver'
      | 'unregisterDriver'
      | 'registerDatasourceDef'
      | 'getDriverByName'
      | 'syncObjectSchema'
      | 'getDefaultDriverName'
      | 'markDatasourceUnavailable'
      | 'clearDatasourceUnavailable';
    // Both directions: a member added by hand fails the first leg, a member
    // dropped fails the second.
    const roster: [Declared] extends [Expected]
      ? [Expected] extends [Declared]
        ? 'exact'
        : never
      : never = 'exact';

    type Same<K extends Expected> =
      NonNullable<ConnectionEngineLike[K]> extends NonNullable<IObjectQLEngine[K]>
        ? NonNullable<IObjectQLEngine[K]> extends NonNullable<ConnectionEngineLike[K]>
          ? 'same'
          : never
        : never;
    const members: { [K in Expected]: Same<K> } = {
      registerDriver: 'same',
      unregisterDriver: 'same',
      registerDatasourceDef: 'same',
      getDriverByName: 'same',
      syncObjectSchema: 'same',
      getDefaultDriverName: 'same',
      markDatasourceUnavailable: 'same',
      clearDatasourceUnavailable: 'same',
    };

    expect(roster).toBe('exact');
    expect(Object.keys(members)).toHaveLength(8);
  });

  it('every member stays OPTIONAL — the graceful-degradation seam', () => {
    // `registerDriver` is REQUIRED on the contract; `Partial<…>` is what keeps
    // `if (!factory || !engine?.registerDriver) → 'skipped-no-infra'` a live
    // runtime branch rather than dead code.
    type AllOptional = {
      [K in keyof ConnectionEngineLike]-?: undefined extends ConnectionEngineLike[K] ? true : false;
    }[keyof ConnectionEngineLike];
    const optional: AllOptional extends true ? 'optional' : never = 'optional';
    expect(optional).toBe('optional');
  });
});
