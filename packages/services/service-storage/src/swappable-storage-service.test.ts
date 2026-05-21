// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IStorageService, StorageFileInfo } from '@objectstack/spec/contracts';
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
  async list(prefix: string): Promise<StorageFileInfo[]> {
    return Array.from(this.store.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) => ({ key: k, size: this.store.get(k)!.length, lastModified: new Date() }));
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
    await expect(proxy.list('p')).rejects.toThrow(/does not support list/);
    await expect(proxy.getSignedUrl('k', 60)).rejects.toThrow(/does not support getSignedUrl/);
    await expect(proxy.getPresignedUpload('k', 60)).rejects.toThrow(/does not support getPresignedUpload/);
    await expect(proxy.initiateChunkedUpload('k')).rejects.toThrow(/does not support initiateChunkedUpload/);
  });

  it('forwards list() to the active adapter when supported', async () => {
    const a = new FakeAdapter('A');
    await a.upload('p/1', Buffer.from('1'));
    await a.upload('p/2', Buffer.from('22'));
    await a.upload('q/3', Buffer.from('333'));
    const proxy = new SwappableStorageService(a);
    const out = await proxy.list('p/');
    expect(out.map((i) => i.key).sort()).toEqual(['p/1', 'p/2']);
  });
});
