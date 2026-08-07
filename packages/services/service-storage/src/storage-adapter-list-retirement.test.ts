// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Retirement pin — `list(prefix)` on the shipped storage adapters.
 *
 * `IStorageService.list?(prefix)` was removed from the contract in #5540
 * (ADR-0049 enforce-or-remove; analysis #5266), and the two shipped adapters'
 * own implementations were removed in #5541. This file keeps the retired
 * surface retired.
 *
 * **Why a runtime pin and not `@ts-expect-error`.** On the *contract* side tsc
 * is the enforced channel and `packages/spec/src/contracts/storage-service.test.ts`
 * already carries both directives — reading `storage.list` is a type error, and
 * an object literal typed `IStorageService` that declares `list` is an excess
 * property. Neither reaches an adapter: a **class** that `implements` an
 * interface is only checked for the members the interface requires, so a class
 * may carry any number of extra methods without a single type error. That is
 * exactly what the retirement changeset promises adapter authors ("an
 * implementation left in place still compiles"), and it is also why tsc cannot
 * notice these two coming back. The pin has to read the shape at runtime.
 *
 * `SwappableStorageService` deliberately gets no pin here: it forwards to an
 * `inner` typed as `IStorageService`, so a re-added `list` passthrough fails to
 * compile — which is how #5540 found it in the first place. tsc holds that line
 * already; duplicating it here would pin nothing new.
 *
 * If prefix enumeration ever comes back it comes back cursor-shaped —
 * `list(prefix, { cursor, limit })` returning a page plus a continuation token,
 * with adapter-conformance cases (nested keys, directory entries, more than
 * 1000 objects) proving both backends agree. Restoring the old single-argument
 * shape to satisfy this file is the one fix that is not a fix.
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

describe('storage adapters no longer implement list(prefix) (#5540 / #5541)', () => {
  it('LocalStorageAdapter exposes no list member', () => {
    const adapter = new LocalStorageAdapter({ rootDir: '/tmp/os-storage-pin-not-created' });

    expect(reachableMethodNames(adapter)).not.toContain('list');
    expect('list' in adapter).toBe(false);
    expect((adapter as unknown as Record<string, unknown>).list).toBeUndefined();
  });

  it('S3StorageAdapter exposes no list member', () => {
    // The constructor only records options; the AWS SDK is imported lazily on
    // first use, so this never touches the network or the peer dependency.
    const adapter = new S3StorageAdapter({ bucket: 'pin-bucket', region: 'us-east-1' });

    expect(reachableMethodNames(adapter)).not.toContain('list');
    expect('list' in adapter).toBe(false);
    expect((adapter as unknown as Record<string, unknown>).list).toBeUndefined();
  });

  it('still exposes the per-key contract members the retirement kept', () => {
    // Guards the pin against the mirror failure: a pin that passes because the
    // adapter has no methods at all would be green and meaningless.
    const local = new LocalStorageAdapter({ rootDir: '/tmp/os-storage-pin-not-created' });
    const s3 = new S3StorageAdapter({ bucket: 'pin-bucket', region: 'us-east-1' });

    for (const adapter of [local, s3]) {
      for (const member of ['upload', 'download', 'delete', 'exists', 'getInfo'] as const) {
        expect(typeof (adapter as unknown as Record<string, unknown>)[member]).toBe('function');
      }
    }
  });
});
