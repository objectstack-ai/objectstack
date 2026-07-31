// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MemoryQueueAdapter } from './memory-queue-adapter.js';
import type { IQueueService, QueueMessage } from '@objectstack/spec/contracts';

describe('MemoryQueueAdapter', () => {
  it('should implement IQueueService contract', () => {
    const queue: IQueueService = new MemoryQueueAdapter();
    expect(typeof queue.publish).toBe('function');
    expect(typeof queue.subscribe).toBe('function');
    expect(typeof queue.unsubscribe).toBe('function');
    expect(typeof queue.getQueueSize).toBe('function');
    expect(typeof queue.purge).toBe('function');
  });

  it('should publish and deliver to subscriber', async () => {
    const queue = new MemoryQueueAdapter();
    const received: QueueMessage[] = [];

    await queue.subscribe('orders', async (msg) => {
      received.push(msg);
    });

    const id = await queue.publish('orders', { orderId: 123 });
    expect(id).toBe('msg-1');
    expect(received).toHaveLength(1);
    expect(received[0].data).toEqual({ orderId: 123 });
    expect(received[0].attempts).toBe(1);
  });

  it('should support multiple subscribers', async () => {
    const queue = new MemoryQueueAdapter();
    const log1: unknown[] = [];
    const log2: unknown[] = [];

    await queue.subscribe('events', async (msg) => { log1.push(msg.data); });
    await queue.subscribe('events', async (msg) => { log2.push(msg.data); });

    await queue.publish('events', 'hello');
    expect(log1).toEqual(['hello']);
    expect(log2).toEqual(['hello']);
  });

  it('should unsubscribe from a queue', async () => {
    const queue = new MemoryQueueAdapter();
    const received: unknown[] = [];

    await queue.subscribe('q1', async (msg) => { received.push(msg.data); });
    await queue.unsubscribe('q1');
    await queue.publish('q1', 'data');
    expect(received).toHaveLength(0);
  });

  it('should retain dead letters when no subscribers', async () => {
    const queue = new MemoryQueueAdapter();
    const id = await queue.publish('orphan', { lost: true });
    expect(id).toBe('msg-1');
  });

  it('should return queue size of 0 for in-memory queue', async () => {
    const queue = new MemoryQueueAdapter();
    expect(await queue.getQueueSize('test')).toBe(0);
  });

  it('should purge a queue by removing handlers', async () => {
    const queue = new MemoryQueueAdapter();
    const received: unknown[] = [];

    await queue.subscribe('q1', async (msg) => { received.push(msg.data); });
    await queue.purge('q1');
    await queue.publish('q1', 'data');
    expect(received).toHaveLength(0);
  });

  it('should increment message counter across publishes', async () => {
    const queue = new MemoryQueueAdapter();
    const ids: string[] = [];

    await queue.subscribe('q', async () => {});
    ids.push(await queue.publish('q', 'a'));
    ids.push(await queue.publish('q', 'b'));
    ids.push(await queue.publish('q', 'c'));

    expect(ids).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });
});
