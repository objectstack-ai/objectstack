/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { MetadataCache } from './MetadataCache';

/**
 * `share` and the in-flight half of `invalidate` (objectui#13044).
 *
 * `share` is the door for a caller whose contract is "ask the server": it
 * joins a request already in flight and is never answered from a settled
 * entry. Since objectui#13057 its landing is stored, so a later `get` may be
 * answered from it. `invalidate` detaches the request in flight, so a
 * request sent before an invalidation neither answers a later caller nor
 * overwrites a newer answer.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('MetadataCache.share (objectui#13044)', () => {
  it('joins a read in flight instead of starting a second one', async () => {
    const cache = new MetadataCache();
    const wire = deferred<string>();
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      return wire.promise;
    };
    const a = cache.get('k', fetcher);
    const b = cache.share('k', fetcher);
    wire.resolve('answer');
    expect(await Promise.all([a, b])).toEqual(['answer', 'answer']);
    expect(calls).toBe(1);
  });

  it('is never answered from the settled entry, and stores what it was answered (objectui#13057)', async () => {
    const cache = new MetadataCache();
    let calls = 0;
    const fetcher = async () => `answer ${(calls += 1)}`;
    expect(await cache.get('k', fetcher)).toBe('answer 1');
    // A settled entry is there; `share` asks the server anyway.
    expect(await cache.share('k', fetcher)).toBe('answer 2');
    // ...and what it was answered is what a later `get` is answered from.
    expect(await cache.get('k', fetcher)).toBe('answer 2');
    expect(await cache.share('fresh', fetcher)).toBe('answer 3');
    expect(cache.has('fresh')).toBe(true);
    expect(await cache.get('fresh', fetcher)).toBe('answer 3');
    expect(calls).toBe(3);
  });

  it('a request detached by an invalidation stores nothing (objectui#13057)', async () => {
    const cache = new MetadataCache();
    const wire = deferred<string>();
    const shared = cache.share('k', () => wire.promise);
    cache.invalidate('k');
    wire.resolve('before the invalidation');
    expect(await shared).toBe('before the invalidation');
    expect(cache.has('k')).toBe(false);
  });
});

describe('MetadataCache.invalidate detaches the read in flight (objectui#13044)', () => {
  it('a read asked after the invalidation sends its own request', async () => {
    const cache = new MetadataCache();
    const before = deferred<string>();
    let calls = 0;
    const first = cache.get('k', () => {
      calls += 1;
      return before.promise;
    });
    cache.invalidate('k');
    const second = cache.get('k', async () => {
      calls += 1;
      return 'after';
    });
    expect(await second).toBe('after');
    before.resolve('before');
    expect(await first).toBe('before');
    expect(calls).toBe(2);
    // The earlier request landed last, and did not overwrite the newer answer.
    expect(await cache.get('k', async () => 'unused')).toBe('after');
  });

  it('the whole-cache invalidation and clear() detach every read in flight', async () => {
    for (const drop of [(c: MetadataCache) => c.invalidate(), (c: MetadataCache) => c.clear()]) {
      const cache = new MetadataCache();
      const before = deferred<string>();
      const first = cache.get('k', () => before.promise);
      drop(cache);
      before.resolve('before');
      await first;
      expect(cache.has('k')).toBe(false);
    }
  });
});
