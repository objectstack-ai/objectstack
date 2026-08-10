// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type {
  IStorageService,
  StorageFileInfo,
  StorageListOptions,
  StorageListPage,
} from '@objectstack/spec/contracts';
import {
  decodeStorageListCursor,
  encodeStorageListCursor,
  resolveStorageListLimit,
} from '@objectstack/spec/contracts';
import { SwappableStorageService } from './swappable-storage-service';

class FakeAdapter implements IStorageService {
  public name: string;
  public store = new Map<string, Buffer>();
  constructor(name: string) { this.name = name; }
  async upload(key: string, data: Buffer | ReadableStream): Promise<void> {
    if (!Buffer.isBuffer(data)) throw new Error('stream not supported in fake');
    this.store.set(key, data);
  }
  async download(key: string): Promise<Buffer> {
    const b = this.store.get(key);
    if (!b) throw new Error('not found');
    return b;
  }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async exists(key: string): Promise<boolean> { return this.store.has(key); }
  async getInfo(key: string): Promise<StorageFileInfo> {
    const b = this.store.get(key);
    if (!b) throw new Error('not found');
    return { key, size: b.length, lastModified: new Date(), contentType: 'application/octet-stream' };
  }
  /**
   * Cursor-shaped `list` (#6781), built on the contract's own helpers — the
   * same ones both shipped adapters use, so this fake cannot model a cursor
   * dialect no real adapter has.
   */
  async list(prefix: string, options?: StorageListOptions): Promise<StorageListPage> {
    const limit = resolveStorageListLimit(options?.limit);
    const after = options?.cursor === undefined ? undefined : decodeStorageListCursor(options.cursor);
    const matched = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .filter((key) => after === undefined || key > after)
      .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    const page = matched.slice(0, limit);
    const items = page.map((key) => ({
      key,
      size: this.store.get(key)!.length,
      lastModified: new Date(0),
    }));
    return matched.length > limit
      ? { items, nextCursor: encodeStorageListCursor(page[page.length - 1]!) }
      : { items };
  }
}

/** Adapter that omits the optional methods to exercise the proxy's
 *  "not supported" branch. */
class MinimalAdapter implements IStorageService {
  async upload(): Promise<void> { /* noop */ }
  async download(): Promise<Buffer> { return Buffer.alloc(0); }
  async delete(): Promise<void> { /* noop */ }
  async exists(): Promise<boolean> { return false; }
  async getInfo(): Promise<StorageFileInfo> { return { key: '', size: 0, lastModified: new Date() }; }
}

describe('SwappableStorageService', () => {
  it('delegates required methods to the initial adapter', async () => {
    const a = new FakeAdapter('A');
    const proxy = new SwappableStorageService(a);
    await proxy.upload('k', Buffer.from('hello'));
    expect(await proxy.exists('k')).toBe(true);
    expect((await proxy.download('k')).toString()).toBe('hello');
    const info = await proxy.getInfo('k');
    expect(info.size).toBe(5);
    await proxy.delete('k');
    expect(await proxy.exists('k')).toBe(false);
  });

  it('routes calls to the new adapter after swap()', async () => {
    const a = new FakeAdapter('A');
    const b = new FakeAdapter('B');
    await a.upload('only-on-a', Buffer.from('A'));
    await b.upload('only-on-b', Buffer.from('B'));

    const proxy = new SwappableStorageService(a);
    expect(await proxy.exists('only-on-a')).toBe(true);
    expect(await proxy.exists('only-on-b')).toBe(false);

    proxy.swap(b);
    expect(await proxy.exists('only-on-a')).toBe(false);
    expect(await proxy.exists('only-on-b')).toBe(true);
    expect(proxy.getInner()).toBe(b);
  });

  it('invokes the onSwap callback with previous + next', () => {
    const a = new FakeAdapter('A');
    const b = new FakeAdapter('B');
    const calls: Array<[string, string]> = [];
    const proxy = new SwappableStorageService(a, (prev, next) => {
      calls.push([(prev as any).name, (next as any).name]);
    });
    proxy.swap(b);
    expect(calls).toEqual([['A', 'B']]);
  });

  it('rejects optional methods when the active adapter omits them', async () => {
    const proxy = new SwappableStorageService(new MinimalAdapter());
    await expect(proxy.getSignedUrl('k', 60)).rejects.toThrow(/does not support getSignedUrl/);
    await expect(proxy.getPresignedUpload('k', 60)).rejects.toThrow(/does not support getPresignedUpload/);
    await expect(proxy.initiateChunkedUpload('k')).rejects.toThrow(/does not support initiateChunkedUpload/);
    await expect(proxy.list('k')).rejects.toThrow(/does not support list/);
  });

  // The `forwards list() to the active adapter when supported` case was deleted
  // with the proxy method it exercised in #5540 and is restored here with the
  // cursor shape (#6781).
  it('forwards list() to the active adapter, cursor and all', async () => {
    const a = new FakeAdapter('A');
    for (const key of ['docs/a.txt', 'docs/b.txt', 'docs/c.txt', 'images/x.png']) {
      await a.upload(key, Buffer.from(key));
    }
    const proxy = new SwappableStorageService(a);

    const first = await proxy.list('docs/', { limit: 2 });
    expect(first.items.map((i) => i.key)).toEqual(['docs/a.txt', 'docs/b.txt']);
    expect(first.nextCursor).toBeDefined();

    const second = await proxy.list('docs/', { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((i) => i.key)).toEqual(['docs/c.txt']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('a cursor issued before swap() still resumes after it', async () => {
    // Only true because the cursor codec lives on the CONTRACT rather than in
    // each adapter. A per-adapter token would either be refused here or —
    // worse — silently restart the sweep at key zero.
    const a = new FakeAdapter('A');
    const b = new FakeAdapter('B');
    for (const key of ['k/1', 'k/2', 'k/3', 'k/4']) {
      await a.upload(key, Buffer.from(key));
      await b.upload(key, Buffer.from(key));
    }

    const proxy = new SwappableStorageService(a);
    const first = await proxy.list('k/', { limit: 2 });
    proxy.swap(b);
    const second = await proxy.list('k/', { limit: 2, cursor: first.nextCursor });

    expect(first.items.map((i) => i.key)).toEqual(['k/1', 'k/2']);
    expect(second.items.map((i) => i.key)).toEqual(['k/3', 'k/4']);
  });
});
