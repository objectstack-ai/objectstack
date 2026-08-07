// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryMetricsRegistry, SEMCONV } from '@objectstack/observability';
import { LocalStorageAdapter } from './local-storage-adapter';

describe('LocalStorageAdapter instrumentation', () => {
    let rootDir: string;

    beforeEach(async () => {
        rootDir = await mkdtemp(join(tmpdir(), 'obs-storage-'));
    });

    afterEach(async () => {
        await rm(rootDir, { recursive: true, force: true });
    });

    it('records storage_operations_total{op=put,result=ok} + duration on upload', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const storage = new LocalStorageAdapter({ rootDir, metrics });
        await storage.upload('foo.txt', Buffer.from('hello'));

        expect(metrics.totalCounter(SEMCONV.storageOperationsTotal, { adapter: 'local', op: 'put', result: 'ok' })).toBe(1);
        const durations = metrics.histogramValues(SEMCONV.storageOperationDurationMs, { adapter: 'local', op: 'put' });
        expect(durations).toHaveLength(1);
        expect(durations[0]).toBeGreaterThanOrEqual(0);
    });

    it('records ok for get / head when the object is present', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const storage = new LocalStorageAdapter({ rootDir, metrics });
        await storage.upload('a/b.txt', Buffer.from('x'));
        await storage.download('a/b.txt');
        await storage.exists('a/b.txt');
        await storage.getInfo('a/b.txt');

        expect(metrics.totalCounter(SEMCONV.storageOperationsTotal, { adapter: 'local', op: 'get', result: 'ok' })).toBe(1);
        expect(metrics.totalCounter(SEMCONV.storageOperationsTotal, { adapter: 'local', op: 'head', result: 'ok' })).toBe(2);
    });

    // The `list() does not double-count head per entry` case was deleted with the
    // method it exercised (#5541). It pinned an internal detail of the removed
    // implementation (inline `stat` instead of `getInfo`), so with `list` gone it
    // could only have stayed green by asserting nothing. `op: 'list'` is no longer
    // in the adapter's `track()` vocabulary either, so no sample can carry it.

    it('records errors_total{errorClass} on path-traversal rejection', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const storage = new LocalStorageAdapter({ rootDir, metrics });
        await expect(storage.download('../escape')).rejects.toThrow(/path traversal/);
        expect(metrics.totalCounter(SEMCONV.storageOperationsTotal, { adapter: 'local', op: 'get', result: 'error' })).toBe(1);
        expect(metrics.totalCounter(SEMCONV.storageErrorsTotal, { adapter: 'local', op: 'get', errorClass: 'Error' })).toBe(1);
    });

    it('records no metrics when no registry is provided (backwards-compat)', async () => {
        const storage = new LocalStorageAdapter({ rootDir });
        await storage.upload('x.txt', Buffer.from('y'));
        expect((await storage.download('x.txt')).toString()).toBe('y');
    });
});
