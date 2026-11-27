// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import {
  UNSERVED_KNOWLEDGE_SOURCES_NAMED,
  announceUnservedKnowledgeSources,
  describeSavedUnservedKnowledgeSource,
  describeUnservedKnowledgeSources,
  watchSavedUnservedKnowledgeSources,
} from './knowledge-source-unserved.js';

describe('describeUnservedKnowledgeSources — items with no knowledge service (ADR-0161 K4, ADR-0078)', () => {
  it('says nothing when a knowledge service is registered, or when no item is held', () => {
    expect(describeUnservedKnowledgeSources(['faq'], true)).toBeNull();
    expect(describeUnservedKnowledgeSources([], false)).toBeNull();
  });

  it('names the item, the missing service and both remedies', () => {
    const line = describeUnservedKnowledgeSources(['faq'], false)!;
    expect(line).toContain("1 knowledge_source item ('faq')");
    expect(line).toContain("no 'knowledge' service is registered");
    expect(line).toContain('it is loaded, indexed or searched');
    expect(line).toContain('@objectstack/service-knowledge');
    expect(line).toContain('or remove the item.');
    // [ADR-0161 K8 item 12] The stack's own items mount the service, so the remedy for these is the token.
    expect(line).toContain("Declare requires: ['knowledge'] in the stack and restart");
  });

  it(`names at most ${UNSERVED_KNOWLEDGE_SOURCES_NAMED} items, counts the rest, and says a name two packages hold once`, () => {
    const names = ['g', 'f', 'e', 'd', 'c', 'b', 'a', 'a'];
    const line = describeUnservedKnowledgeSources(names, false)!;
    expect(line).toContain("8 knowledge_source items ('a', 'b', 'c', 'd', 'e', and 2 more)");
    expect(line).toContain('none is loaded');
  });
});

describe('announceUnservedKnowledgeSources — once, at warn, never a refusal', () => {
  const host = (services: Record<string, unknown>) => {
    const warn = vi.fn();
    return {
      warn,
      host: {
        getService: (name: string) => {
          if (name in services) return services[name];
          throw new Error(`no service ${name}`);
        },
        logger: { warn },
      },
    };
  };
  const protocolWith = (items: unknown) => ({ getMetaItemsForExecution: vi.fn(async () => items) });

  it('warns once, naming every published item, when no knowledge service is registered', async () => {
    const protocol = protocolWith({ items: [{ name: 'faq' }, { item: { name: 'notes', _packageId: 'com.acme.kb' } }] });
    const h = host({ protocol });
    await announceUnservedKnowledgeSources(h.host);
    expect(protocol.getMetaItemsForExecution).toHaveBeenCalledWith({ type: 'knowledge_source' });
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(String(h.warn.mock.calls[0][0])).toContain("2 knowledge_source items ('faq', 'notes')");
  });

  it('reads nothing and says nothing when a knowledge service is registered', async () => {
    const protocol = protocolWith([{ name: 'faq' }]);
    const h = host({ protocol, knowledge: {} });
    await announceUnservedKnowledgeSources(h.host);
    expect(protocol.getMetaItemsForExecution).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('says nothing when no item is held, when there is no protocol, and when the listing cannot be read', async () => {
    const empty = host({ protocol: protocolWith({ items: [] }) });
    await announceUnservedKnowledgeSources(empty.host);
    const none = host({});
    await announceUnservedKnowledgeSources(none.host);
    const failing = host({ protocol: { getMetaItemsForExecution: async () => { throw new Error('store offline'); } } });
    await expect(announceUnservedKnowledgeSources(failing.host)).resolves.toBeUndefined();
    for (const h of [empty, none, failing]) expect(h.warn).not.toHaveBeenCalled();
  });

  it('falls back to getMetaItems where the protocol has no execution read', async () => {
    const getMetaItems = vi.fn(async () => [{ name: 'faq' }]);
    const h = host({ protocol: { getMetaItems } });
    await announceUnservedKnowledgeSources(h.host);
    expect(getMetaItems).toHaveBeenCalledWith({ type: 'knowledge_source' });
    expect(h.warn).toHaveBeenCalledTimes(1);
  });
});

/**
 * [ADR-0161 row 3b, item 4] The first `knowledge_source` saved at run time on a
 * deployment that mounted no knowledge service at boot: no service is mounted
 * while the process runs, so the item is kept and not served, and its save is
 * told so once, naming what serves it — `requires: ['knowledge']` and a
 * restart.
 */
describe('watchSavedUnservedKnowledgeSources — the first item saved at run time with no service', () => {
  type Listener = (evt: { type?: string; name?: string; state?: string }) => void;
  const host = (services: Record<string, unknown>) => {
    const warn = vi.fn();
    return {
      warn,
      host: {
        getService: (name: string) => {
          if (name in services) return services[name];
          throw new Error(`no service ${name}`);
        },
        logger: { warn },
      },
    };
  };
  const signal = () => {
    const listeners: Listener[] = [];
    const unsubscribe = vi.fn();
    return {
      listeners,
      unsubscribe,
      protocol: {
        onMetadataMutation: vi.fn((l: Listener) => {
          listeners.push(l);
          return unsubscribe;
        }),
      },
      emit: (evt: { type?: string; name?: string; state?: string }) => listeners.forEach((l) => l(evt)),
    };
  };

  it('a saved source is said once, at warn: kept, not served, and what serves it after a restart', () => {
    const s = signal();
    const h = host({ protocol: s.protocol });
    const unwatch = watchSavedUnservedKnowledgeSources(h.host);
    s.emit({ type: 'knowledge_source', name: 'faq', state: 'active' });
    s.emit({ type: 'knowledge_source', name: 'faq', state: 'active' });
    expect(h.warn).toHaveBeenCalledTimes(1);
    const line = String(h.warn.mock.calls[0][0]);
    expect(line).toBe(describeSavedUnservedKnowledgeSource('faq'));
    expect(line).toContain("knowledge_source 'faq' was saved");
    expect(line).toContain('it is kept and is not loaded, indexed or searched');
    expect(line).toContain("Declare requires: ['knowledge'] in the stack and restart");
    expect(line).toContain('the next boot then loads and builds it');
    unwatch?.();
    expect(s.unsubscribe).toHaveBeenCalledOnce();
  });

  it('says nothing for a draft, a delete or another type', () => {
    const s = signal();
    const h = host({ protocol: s.protocol });
    watchSavedUnservedKnowledgeSources(h.host);
    s.emit({ type: 'knowledge_source', name: 'faq', state: 'draft' });
    s.emit({ type: 'knowledge_source', name: 'faq', state: 'deleted' });
    s.emit({ type: 'object', name: 'faq', state: 'active' });
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('a deployment with a knowledge service watches nothing: the service loads the item itself', () => {
    const s = signal();
    const h = host({ protocol: s.protocol, knowledge: {} });
    expect(watchSavedUnservedKnowledgeSources(h.host)).toBeUndefined();
    expect(s.protocol.onMetadataMutation).not.toHaveBeenCalled();
  });
});
