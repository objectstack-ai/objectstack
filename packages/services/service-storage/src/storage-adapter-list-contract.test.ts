// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shape pin — `list(prefix, { cursor, limit })` on the shipped storage adapters.
 *
 * This file was `storage-adapter-list-retirement.test.ts` and it is the SAME
 * pin flipped, not a new one (#6781). It used to hold "the retired
 * `list(prefix)` has not crept back into either adapter"; it now holds "both
 * adapters implement the restored member, and they implement the CURSOR shape
 * rather than the retired array one". The load it bears did not go away when
 * `list` came back — it moved, and deleting the file would have dropped it.
 *
 * **Why a runtime pin and not `@ts-expect-error`.** On the *contract* side tsc
 * is the enforced channel and
 * `packages/spec/src/contracts/storage-service.test.ts` carries the directives
 * there. Neither reaches an adapter: a **class** that `implements` an interface
 * is only checked for the members the interface requires, and `list` is
 * OPTIONAL, so an adapter that quietly drops it — or reintroduces the
 * single-argument array version alongside — compiles perfectly. That is the
 * same tsc blind spot #5541 documented, in mirror image: it could not see the
 * method coming back, and it cannot see it going away either.
 *
 * `SwappableStorageService` gets no pin here: it forwards through an `inner`
 * typed as `IStorageService`, so a passthrough whose signature drifts from the
 * contract fails to compile. tsc holds that line already.
 *
 * Behaviour — pagination, ordering, prefix semantics, both backends agreeing —
 * is pinned next door in `storage-adapter-list.conformance.test.ts`. This file
 * only answers "is the member there, on both, in the right shape".
 */

import { describe, it, expect } from 'vitest';
import { LocalStorageAdapter } from './local-storage-adapter';
import { S3StorageAdapter } from './s3-storage-adapter';

/** Every method name reachable on an instance, own + prototype chain. */
function reachableMethodNames(instance: object): string[] {
  const names = new Set<string>();
  for (
    let cursor: object | null = instance;
    cursor && cursor !== Object.prototype;
    cursor = Object.getPrototypeOf(cursor)
  ) {
    for (const name of Object.getOwnPropertyNames(cursor)) names.add(name);
  }
  return [...names];
}

const adapters = [
  {
    name: 'LocalStorageAdapter',
    make: () => new LocalStorageAdapter({ rootDir: '/tmp/os-storage-pin-not-created' }),
  },
  {
    // The constructor only records options; the AWS SDK is imported lazily on
    // first use, so this never touches the network or the peer dependency.
    name: 'S3StorageAdapter',
    make: () => new S3StorageAdapter({ bucket: 'pin-bucket', region: 'us-east-1' }),
  },
] as const;

describe('storage adapters implement cursor-shaped list(prefix, opts) (#6781)', () => {
  it.each(adapters)('$name exposes list as a method', ({ make }) => {
    const adapter = make();

    expect(reachableMethodNames(adapter)).toContain('list');
    expect('list' in adapter).toBe(true);
    expect(typeof (adapter as unknown as Record<string, unknown>).list).toBe('function');
  });

  it.each(adapters)('$name declares list with the cursor arity (prefix, options)', ({ make }) => {
    // MEASURED, not assumed: a TypeScript `options?` compiles to a plain
    // parameter with no default, so `Function.length` counts it — the cursor
    // shape reports 2 where the retired `list(prefix)` reported 1. (The first
    // draft of this case asserted 1 on the reasoning that `length` stops at the
    // first optional parameter; that rule is about DEFAULTED parameters, and
    // the test said so.) Arity is a cheap discriminator, not a sufficient one:
    // the return VALUE is asserted below and exhaustively in the conformance
    // suite.
    const list = (make() as unknown as Record<string, (...args: unknown[]) => unknown>).list!;
    expect(list.length).toBe(2);
  });

  it('LocalStorageAdapter.list answers a page object, never the retired array', async () => {
    // Runs against a root that does not exist: an empty bucket enumerates
    // empty, and the SHAPE of "empty" is the thing under test. The retired
    // implementation would have answered `[]` here — truthy-empty and
    // indistinguishable from a complete listing.
    const adapter = new LocalStorageAdapter({ rootDir: '/tmp/os-storage-pin-not-created' });

    const page = await adapter.list('');

    expect(Array.isArray(page)).toBe(false);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
    expect(Object.keys(page)).toEqual(['items']);
  });

  it('still exposes the per-key contract members the retirement kept', () => {
    // Guards the pin against the mirror failure: a pin that passes because the
    // adapter has no methods at all would be green and meaningless.
    for (const { make } of adapters) {
      const adapter = make();
      for (const member of ['upload', 'download', 'delete', 'exists', 'getInfo'] as const) {
        expect(typeof (adapter as unknown as Record<string, unknown>)[member]).toBe('function');
      }
    }
  });
});
