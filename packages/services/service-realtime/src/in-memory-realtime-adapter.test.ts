// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { InMemoryRealtimeAdapter, DEFAULT_MAX_SUBSCRIPTIONS } from './in-memory-realtime-adapter.js';
import type { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';

describe('InMemoryRealtimeAdapter', () => {
  it('should implement IRealtimeService contract', () => {
    const realtime: IRealtimeService = new InMemoryRealtimeAdapter();
    expect(typeof realtime.publish).toBe('function');
    expect(typeof realtime.subscribe).toBe('function');
    expect(typeof realtime.unsubscribe).toBe('function');
  });

  it('should start with zero subscriptions', () => {
    const realtime = new InMemoryRealtimeAdapter();
    expect(realtime.getSubscriptionCount()).toBe(0);
    expect(realtime.getChannels()).toEqual([]);
  });

  it('should subscribe and receive published events', async () => {
    const realtime = new InMemoryRealtimeAdapter();
    const received: RealtimeEventPayload[] = [];

    await realtime.subscribe('records', (event) => {
      received.push(event);
    });

    await realtime.publish({
      type: 'record.created',
      object: 'account',
      payload: { id: 'acc-1', name: 'Acme' },
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('record.created');
    expect(received[0].object).toBe('account');
  });

  it('should deliver events to multiple subscribers', async () => {
    const realtime = new InMemoryRealtimeAdapter();
    const received1: RealtimeEventPayload[] = [];
    const received2: RealtimeEventPayload[] = [];

    await realtime.subscribe('records', (event) => { received1.push(event); });
    await realtime.subscribe('records', (event) => { received2.push(event); });

    await realtime.publish({
      type: 'record.created',
      object: 'account',
      payload: { id: 'acc-1' },
      timestamp: new Date().toISOString(),
    });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('should unsubscribe and stop receiving events', async () => {
    const realtime = new InMemoryRealtimeAdapter();
    const received: RealtimeEventPayload[] = [];

    const subId = await realtime.subscribe('records', (event) => {
      received.push(event);
    });

    await realtime.publish({
      type: 'record.created',
      payload: { id: '1' },
      timestamp: new Date().toISOString(),
    });
    expect(received).toHaveLength(1);

    await realtime.unsubscribe(subId);

    await realtime.publish({
      type: 'record.updated',
      payload: { id: '2' },
      timestamp: new Date().toISOString(),
    });
    expect(received).toHaveLength(1); // No new events
  });

  it('should handle unsubscribing an unknown subscription gracefully', async () => {
    const realtime = new InMemoryRealtimeAdapter();
    await expect(realtime.unsubscribe('nonexistent')).resolves.toBeUndefined();
  });

  it('should filter events by object name', async () => {
    const realtime = new InMemoryRealtimeAdapter();
    const received: RealtimeEventPayload[] = [];

    await realtime.subscribe('records', (event) => {
      received.push(event);
    }, { object: 'account' });

    await realtime.publish({
      type: 'record.created',
      object: 'account',
      payload: { id: '1' },
      timestamp: new Date().toISOString(),
    });

    await realtime.publish({
      type: 'record.created',
      object: 'contact',
      payload: { id: '2' },
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].object).toBe('account');
  });

  it('should filter events by event type', async () => {
    const realtime = new InMemoryRealtimeAdapter();
    const received: RealtimeEventPayload[] = [];

    await realtime.subscribe('records', (event) => {
      received.push(event);
    }, { eventTypes: ['record.created'] });

    await realtime.publish({
      type: 'record.created',
      payload: { id: '1' },
      timestamp: new Date().toISOString(),
    });

    await realtime.publish({
      type: 'record.updated',
      payload: { id: '2' },
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('record.created');
  });

  it('should filter by both object and event type', async () => {
    const realtime = new InMemoryRealtimeAdapter();
    const received: RealtimeEventPayload[] = [];

    await realtime.subscribe('records', (event) => {
      received.push(event);
    }, { object: 'account', eventTypes: ['record.created'] });

    // Match: correct object + correct type
    await realtime.publish({
      type: 'record.created',
      object: 'account',
      payload: { id: '1' },
      timestamp: new Date().toISOString(),
    });

    // No match: wrong object
    await realtime.publish({
      type: 'record.created',
      object: 'contact',
      payload: { id: '2' },
      timestamp: new Date().toISOString(),
    });

    // No match: wrong type
    await realtime.publish({
      type: 'record.updated',
      object: 'account',
      payload: { id: '3' },
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ id: '1' });
  });

  it('should track subscription count and channels', async () => {
    const realtime = new InMemoryRealtimeAdapter();

    const sub1 = await realtime.subscribe('records', () => {});
    await realtime.subscribe('events', () => {});

    expect(realtime.getSubscriptionCount()).toBe(2);
    expect(realtime.getChannels().sort()).toEqual(['events', 'records']);

    await realtime.unsubscribe(sub1);
    expect(realtime.getSubscriptionCount()).toBe(1);
    expect(realtime.getChannels()).toEqual(['events']);
  });

  it('should enforce maxSubscriptions limit', async () => {
    const realtime = new InMemoryRealtimeAdapter({ maxSubscriptions: 2 });

    await realtime.subscribe('ch1', () => {});
    await realtime.subscribe('ch2', () => {});

    await expect(realtime.subscribe('ch3', () => {})).rejects.toThrow(
      /Maximum subscription limit reached/,
    );
  });

  it('enforces a default maxSubscriptions cap when none is configured (P0-5 backstop)', () => {
    const realtime = new InMemoryRealtimeAdapter();
    expect(DEFAULT_MAX_SUBSCRIPTIONS).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_MAX_SUBSCRIPTIONS)).toBe(true);
    expect((realtime as unknown as { maxSubscriptions: number }).maxSubscriptions).toBe(
      DEFAULT_MAX_SUBSCRIPTIONS,
    );
  });

  it('treats maxSubscriptions: 0 as an explicit unbounded opt-out', async () => {
    const realtime = new InMemoryRealtimeAdapter({ maxSubscriptions: 0 });
    expect((realtime as unknown as { maxSubscriptions: number }).maxSubscriptions).toBe(0);
    for (let i = 0; i < 5; i++) {
      await realtime.subscribe(`ch${i}`, () => {});
    }
    expect(realtime.getSubscriptionCount()).toBe(5);
  });

  it('should not break publish loop on handler error', async () => {
    const realtime = new InMemoryRealtimeAdapter();
    const received: RealtimeEventPayload[] = [];

    await realtime.subscribe('records', () => {
      throw new Error('handler error');
    });
    await realtime.subscribe('records', (event) => {
      received.push(event);
    });

    await realtime.publish({
      type: 'record.created',
      payload: { id: '1' },
      timestamp: new Date().toISOString(),
    });

    // Second handler should still receive the event
    expect(received).toHaveLength(1);
  });

  it('should return unique subscription IDs', async () => {
    const realtime = new InMemoryRealtimeAdapter();

    const id1 = await realtime.subscribe('ch1', () => {});
    const id2 = await realtime.subscribe('ch1', () => {});
    const id3 = await realtime.subscribe('ch2', () => {});

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
  });

  it('should clean up channel index on last subscription removal', async () => {
    const realtime = new InMemoryRealtimeAdapter();

    const sub1 = await realtime.subscribe('records', () => {});
    expect(realtime.getChannels()).toContain('records');

    await realtime.unsubscribe(sub1);
    expect(realtime.getChannels()).not.toContain('records');
  });
});
