// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { assistantBus, emitMetadataRefresh, subscribeMetadataRefresh } from './assistantBus';

// The bus is a module singleton, so tests share state — assertions are
// relative (before/after) rather than absolute where openSeq is involved.

describe('assistantBus — editor channel', () => {
  it('setEditor updates the snapshot and notifies subscribers', () => {
    let notifications = 0;
    const unsub = assistantBus.subscribe(() => {
      notifications += 1;
    });
    assistantBus.setEditor({ type: 'object', name: 'account', label: 'Account' });
    expect(assistantBus.getSnapshot().editor).toMatchObject({ type: 'object', name: 'account' });
    expect(notifications).toBe(1);
    unsub();
  });

  it('setEditor is a no-op when the content is unchanged', () => {
    assistantBus.setEditor({ type: 'object', name: 'a', label: 'A' });
    let notifications = 0;
    const unsub = assistantBus.subscribe(() => {
      notifications += 1;
    });
    assistantBus.setEditor({ type: 'object', name: 'a', label: 'A' }); // identical
    expect(notifications).toBe(0);
    assistantBus.setEditor(null); // different → notifies
    expect(notifications).toBe(1);
    expect(assistantBus.getSnapshot().editor).toBeNull();
    unsub();
  });
});

describe('assistantBus — open channel', () => {
  it('requestOpen bumps openSeq monotonically', () => {
    const before = assistantBus.getSnapshot().openSeq;
    assistantBus.requestOpen();
    assistantBus.requestOpen();
    expect(assistantBus.getSnapshot().openSeq).toBe(before + 2);
  });
});

describe('assistantBus — snapshot stability', () => {
  it('returns a stable reference until a real change (safe for useSyncExternalStore)', () => {
    assistantBus.setEditor(null);
    const s1 = assistantBus.getSnapshot();
    const s2 = assistantBus.getSnapshot();
    expect(s1).toBe(s2);
    assistantBus.requestOpen();
    expect(assistantBus.getSnapshot()).not.toBe(s1);
  });

  it('unsubscribed listeners stop receiving updates', () => {
    let n = 0;
    const unsub = assistantBus.subscribe(() => {
      n += 1;
    });
    assistantBus.requestOpen();
    expect(n).toBe(1);
    unsub();
    assistantBus.requestOpen();
    expect(n).toBe(1);
  });
});


describe('assistantBus — metadata-refresh channel', () => {
  it('emitMetadataRefresh notifies every subscriber', () => {
    let a = 0;
    let b = 0;
    const offA = subscribeMetadataRefresh(() => { a += 1; });
    const offB = subscribeMetadataRefresh(() => { b += 1; });
    emitMetadataRefresh();
    expect(a).toBe(1);
    expect(b).toBe(1);
    emitMetadataRefresh();
    expect(a).toBe(2);
    expect(b).toBe(2);
    offA();
    offB();
  });

  it('unsubscribed listeners stop receiving publish events', () => {
    let n = 0;
    const off = subscribeMetadataRefresh(() => { n += 1; });
    emitMetadataRefresh();
    expect(n).toBe(1);
    off();
    emitMetadataRefresh();
    expect(n).toBe(1);
  });
});
