/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import type { DataSource } from '@object-ui/types';
import { createObjectStackAdapter, ObjectStackAdapter } from './index';

/**
 * `createObjectStackAdapter`'s declared return is the adapter, not the shared
 * `DataSource` interface (#7323).
 *
 * The factory declared `DataSource<T>` while returning `new ObjectStackAdapter`.
 * A wider value is assignable to a narrower annotation, so nothing failed to
 * compile — the loss was entirely on the reading side: every adapter-only
 * member was erased from the type the factory handed back, while staying on the
 * object it handed back. Measured on the shipped `dist/index.d.ts` before the
 * fix, nine reads through `ReturnType<typeof createObjectStackAdapter>` failed
 * with TS2339: `getClient`, `getCacheStats`, `invalidateCache`, `clearCache`,
 * `getConnectionState`, `isConnected`, `onConnectionStateChange`,
 * `onBatchProgress`, `setSystemCapabilities`. Eight of those are exactly the
 * members the package README's API Reference documents, and the ninth was the
 * one the factory's own JSDoc linked to — retired since objectui#12504 with the
 * `updateViewConfig` gate it fed, so the eight are what these pins read.
 *
 * ## Where these pins get their colour
 *
 * Most of this file is COMPILE-time, which is the only place this defect is
 * observable: the values were always there, so every runtime test passed
 * against the narrow declaration too. `vitest` transpiles with esbuild and
 * erases types, so the colour comes from
 * `pnpm --filter @object-ui/data-objectstack type-check` — this package's
 * `tsconfig.json` includes its whole `src/**` (tests included), the same
 * property `deleteViewContract.types.test.ts` documents and relies on.
 *
 * ## The controls
 *
 * Two, and they answer different questions.
 *
 *   1. `_NotOnDataSource` — the adapter-only members are ABSENT from the shared
 *      `DataSource` interface. This is what makes the reads below a statement
 *      about the FACTORY's return rather than a statement about every data
 *      source. It also fires on option B of the card (moving caching,
 *      connection state and batch progress onto `DataSource` so every
 *      implementation has to declare them) — the shape #7323 argues against.
 *   2. `_StillADataSource` — the widened return is still assignable to
 *      `DataSource`. The triage's open question was whether the narrow return
 *      was a deliberate swappability guarantee; this states that widening did
 *      not cost it, so a caller who wants the narrow surface still just writes
 *      `const ds: DataSource = createObjectStackAdapter(…)`.
 *
 * Both controls are independent of the return annotation, so a revert of the
 * source change turns the reads below red and leaves these two green.
 */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type FactoryReturn = ReturnType<typeof createObjectStackAdapter>;

describe('createObjectStackAdapter declares the adapter it returns (#7323)', () => {
  it('exposes the adapter-only members the README documents', () => {
    const dataSource = createObjectStackAdapter({ baseUrl: 'http://test.local' });

    // The card's own TS2339 reproduction, inverted into a pin. Each read is a
    // compile error the moment the declared return narrows back. They are real
    // calls rather than a type-only region because every one of them is inert
    // on an adapter that has never connected, so the same eight lines carry the
    // runtime half too.
    expect(dataSource.getClient()).toBeDefined();
    expect(dataSource.getCacheStats()).toBeDefined();
    dataSource.invalidateCache('users');
    dataSource.invalidateCache();
    dataSource.clearCache();
    expect(dataSource.getConnectionState()).toBe('disconnected');
    expect(dataSource.isConnected()).toBe(false);
    expect(typeof dataSource.onConnectionStateChange(() => {})).toBe('function');
    expect(typeof dataSource.onBatchProgress(() => {})).toBe('function');

    // ...and the same eight through the named type, because a consumer who
    // annotates a field or a hook's return writes the type, not the call.
    type _HasHiddenMembers = Assert<
      'getClient' extends keyof FactoryReturn
        ? 'getCacheStats' extends keyof FactoryReturn
          ? 'invalidateCache' extends keyof FactoryReturn
            ? 'clearCache' extends keyof FactoryReturn
              ? 'getConnectionState' extends keyof FactoryReturn
                ? 'isConnected' extends keyof FactoryReturn
                  ? 'onConnectionStateChange' extends keyof FactoryReturn
                    ? 'onBatchProgress' extends keyof FactoryReturn
                      ? true
                      : false
                    : false
                  : false
                : false
              : false
            : false
          : false
        : false
    >;

    // Identity, not mere assignability: two structurally similar declarations
    // are mutually assignable, so only `Equal` can tell "the factory returns
    // THE adapter type" from "the factory returns something adapter-shaped".
    type _IsTheAdapter = Assert<Equal<FactoryReturn, ObjectStackAdapter<unknown>>>;

    expect(true).toBe(true);
  });

  it('CONTROL — the adapter-only members are not on the shared DataSource', () => {
    // Fires if anyone answers #7323 by widening `DataSource` itself (option B).
    type _NotOnDataSource = Assert<
      'getCacheStats' extends keyof DataSource
        ? false
        : 'onConnectionStateChange' extends keyof DataSource
          ? false
          : 'getClient' extends keyof DataSource
            ? false
            : true
    >;

    expect(true).toBe(true);
  });

  it('CONTROL — the widened return is still a DataSource', () => {
    // Swappability, the property the narrow return was suspected of protecting.
    type _StillADataSource = Assert<FactoryReturn extends DataSource<unknown> ? true : false>;

    const dataSource: DataSource = createObjectStackAdapter({ baseUrl: 'http://test.local' });
    expect(typeof dataSource.find).toBe('function');
  });

  it('the value really carries what the declaration now promises', () => {
    // Declared = shipped. Compile-time reachability is worth nothing if the
    // object does not actually have the members, so this half is runtime.
    const dataSource = createObjectStackAdapter({ baseUrl: 'http://test.local' });

    for (const member of [
      'getClient',
      'getCacheStats',
      'invalidateCache',
      'clearCache',
      'getConnectionState',
      'isConnected',
      'onConnectionStateChange',
      'onBatchProgress',
    ] as const) {
      expect(typeof dataSource[member]).toBe('function');
    }

    expect(dataSource).toBeInstanceOf(ObjectStackAdapter);
  });
});
