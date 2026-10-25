/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
} from './index';

describe('Connection State Monitoring', () => {
  let adapter: ObjectStackAdapter;

  beforeEach(() => {
    adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: false, // Disable auto-reconnect for testing
    });
  });

  it('should initialize with disconnected state', () => {
    expect(adapter.getConnectionState()).toBe('disconnected');
    expect(adapter.isConnected()).toBe(false);
  });

  it('should allow subscribing to connection state changes', () => {
    const listener = vi.fn();
    const unsubscribe = adapter.onConnectionStateChange(listener);

    expect(typeof unsubscribe).toBe('function');
    expect(listener).not.toHaveBeenCalled();

    // Cleanup
    unsubscribe();
  });

  it('should allow subscribing to batch progress events', () => {
    const listener = vi.fn();
    const unsubscribe = adapter.onBatchProgress(listener);

    expect(typeof unsubscribe).toBe('function');
    expect(listener).not.toHaveBeenCalled();

    // Cleanup
    unsubscribe();
  });

  it('should unsubscribe connection state listener', () => {
    const listener = vi.fn();
    const unsubscribe = adapter.onConnectionStateChange(listener);

    // Unsubscribe
    unsubscribe();

    // Listener should not be called after unsubscribe
    // (We can't easily test this without triggering a connection state change)
  });

  it('should unsubscribe batch progress listener', () => {
    const listener = vi.fn();
    const unsubscribe = adapter.onBatchProgress(listener);

    // Unsubscribe
    unsubscribe();

    // Listener should not be called after unsubscribe
  });

  it('should support auto-reconnect configuration', () => {
    const adapterWithReconnect = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 2000,
    });

    expect(adapterWithReconnect.getConnectionState()).toBe('disconnected');
  });
});

describe('Batch Progress Events', () => {
  let adapter: ObjectStackAdapter;

  beforeEach(() => {
    adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
    });
  });

  it('should allow subscribing to batch progress', () => {
    const listener = vi.fn();
    const unsubscribe = adapter.onBatchProgress(listener);

    expect(typeof unsubscribe).toBe('function');

    // Cleanup
    unsubscribe();
  });
});

describe('getDiscovery', () => {
  beforeEach(() => {
    clearSharedDiscoveryCache();
  });

  it('should return discoveryInfo from the underlying client after connect', async () => {
    const mockDiscovery = {
      name: 'test-server',
      version: '1.0.0',
      services: {
        auth: { enabled: false, status: 'unavailable' },
        data: { enabled: true, status: 'available' },
      },
    };

    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({ success: true, data: mockDiscovery }),
      }) as unknown as Response,
    );

    const adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: false,
      fetch: fetchImpl,
    });

    await adapter.connect();

    const discovery = await adapter.getDiscovery();
    expect(discovery).toEqual(mockDiscovery);
    expect((discovery as any)?.services?.auth?.enabled).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown as unknown[])[0]).toContain('/api/v1/discovery');
  });

  it('should return null when connection fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Connection failed');
    });

    const adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: false,
      fetch: fetchImpl as any,
    });

    await expect(adapter.connect()).rejects.toThrow();

    const discovery = await adapter.getDiscovery();
    expect(discovery).toBeNull();
  });

  it('should share a single discovery fetch across adapters with the same baseUrl', async () => {
    const mockDiscovery = { name: 'shared', version: '1.0.0' };
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({ success: true, data: mockDiscovery }),
      }) as unknown as Response,
    );

    const a1 = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: false,
      fetch: fetchImpl,
    });
    const a2 = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: false,
      fetch: fetchImpl,
    });

    await Promise.all([a1.connect(), a2.connect()]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await a1.getDiscovery()).toEqual(mockDiscovery);
    expect(await a2.getDiscovery()).toEqual(mockDiscovery);
  });
});
