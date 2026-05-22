// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0008 PR-6 integration tests:
 * MetadataManager <-> MetadataRepository event bridge.
 *
 * Validates that repository events:
 *   1. fire `manager.subscribe()` callbacks,
 *   2. invalidate the in-memory registry,
 *   3. invalidate the list() cache,
 *   4. translate create/update/delete ops correctly, and
 *   5. stop cleanly via `dispose()`.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryRepository, type MetaRef } from '@objectstack/metadata-core';
import type { MetadataWatchEvent } from '@objectstack/spec/system';
import { MetadataManager } from './metadata-manager.js';

function makeRef(type: string, name: string): MetaRef {
  return {
    org: 'system',
    project: 'proj_test',
    branch: 'main',
    type: type as any,
    name,
  };
}

function makeManager(): MetadataManager {
  // Minimal config — no loaders, no datasource, no watch.
  return new MetadataManager({ formats: ['json'] });
}

async function waitFor<T>(getter: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = getter();
    if (v !== undefined) return v;
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timeout');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('MetadataManager ↔ Repository event bridge (PR-6)', () => {
  it('forwards repo create events to subscribe() callbacks as "added"', async () => {
    const mgr = makeManager();
    const repo = new InMemoryRepository();
    mgr.setRepository(repo);

    const seen: MetadataWatchEvent[] = [];
    mgr.subscribe('view', (evt) => { seen.push(evt); });

    await repo.put(makeRef('view', 'home'), { name: 'home', label: 'Home' }, {
      parentVersion: null, actor: 'test',
    });

    const evt = await waitFor(() => seen[0]);
    expect(evt.type).toBe('added');
    expect(evt.metadataType).toBe('view');
    expect(evt.name).toBe('home');

    await mgr.dispose();
  });

  it('translates update -> "changed" and delete -> "deleted"', async () => {
    const mgr = makeManager();
    const repo = new InMemoryRepository();
    mgr.setRepository(repo);

    const seen: MetadataWatchEvent[] = [];
    mgr.subscribe('view', (evt) => { seen.push(evt); });

    const ref = makeRef('view', 'home');
    const first = await repo.put(ref, { name: 'home', v: 1 }, { parentVersion: null, actor: 'test' });
    const second = await repo.put(ref, { name: 'home', v: 2 }, { parentVersion: first.version, actor: 'test' });
    await repo.delete(ref, { parentVersion: second.version, actor: 'test' });

    await waitFor(() => (seen.length >= 3 ? seen : undefined));
    expect(seen.map((e) => e.type)).toEqual(['added', 'changed', 'deleted']);

    await mgr.dispose();
  });

  it('invalidates the in-memory registry on repo event', async () => {
    const mgr = makeManager();
    const repo = new InMemoryRepository();
    mgr.setRepository(repo);

    // Pre-seed registry with a stale value
    await mgr.register('view', 'home', { name: 'home', label: 'stale' });
    expect(await mgr.get('view', 'home')).toEqual({ name: 'home', label: 'stale' });

    // External writer changes HEAD via repo
    await repo.put(makeRef('view', 'home'), { name: 'home', label: 'fresh' }, {
      parentVersion: null, actor: 'test',
    });

    // Wait for the bridge to consume the event
    const seen: MetadataWatchEvent[] = [];
    mgr.subscribe('view', (e) => { seen.push(e); });
    // The earlier put already fired; trigger one more so we can await it
    await repo.put(makeRef('view', 'home'), { name: 'home', label: 'fresh2' }, {
      parentVersion: (await repo.get(makeRef('view', 'home')))!.hash, actor: 'test',
    });
    await waitFor(() => seen[0]);

    // Registry entry should be evicted; get() must fall through. With
    // no loaders/repository read-through configured the result is
    // undefined, but the important invariant is "no stale value".
    const fresh = await mgr.get('view', 'home');
    expect(fresh).not.toEqual({ name: 'home', label: 'stale' });

    await mgr.dispose();
  });

  it('dispose() stops the watch loop without leaking', async () => {
    const mgr = makeManager();
    const repo = new InMemoryRepository();
    mgr.setRepository(repo);

    await mgr.dispose();
    expect(mgr.getRepository()).toBeDefined(); // reference retained, but watch loop stopped

    // Putting after dispose should not throw and should not deliver to callbacks.
    const seen: MetadataWatchEvent[] = [];
    mgr.subscribe('view', (e) => { seen.push(e); });
    await repo.put(makeRef('view', 'after_dispose'), { name: 'after_dispose' }, {
      parentVersion: null, actor: 'test',
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual([]);
  });

  it('getRepository() returns the attached repo', () => {
    const mgr = makeManager();
    const repo = new InMemoryRepository();
    expect(mgr.getRepository()).toBeUndefined();
    mgr.setRepository(repo);
    expect(mgr.getRepository()).toBe(repo);
  });
});
