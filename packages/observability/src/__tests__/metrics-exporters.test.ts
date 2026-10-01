// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { MetricsRegistry } from '../contracts.js';
import {
    NoopMetricsRegistry,
    InMemoryMetricsRegistry,
    ConsoleMetricsRegistry,
} from '../metrics-exporters.js';

describe('NoopMetricsRegistry', () => {
    it('discards observations without throwing', () => {
        const m: MetricsRegistry = new NoopMetricsRegistry();
        expect(() => {
            m.counter('x');
            m.histogram('y', 42);
            m.gauge('z', 1);
        }).not.toThrow();
    });
});

describe('InMemoryMetricsRegistry', () => {
    it('records counters with default value of 1', () => {
        const m = new InMemoryMetricsRegistry();
        m.counter('hits');
        m.counter('hits');
        m.counter('hits', {}, 5);
        expect(m.totalCounter('hits')).toBe(7);
    });

    it('partitions counters by label match', () => {
        const m = new InMemoryMetricsRegistry();
        m.counter('req', { status: '200' });
        m.counter('req', { status: '200' });
        m.counter('req', { status: '500' });
        expect(m.totalCounter('req', { status: '200' })).toBe(2);
        expect(m.totalCounter('req', { status: '500' })).toBe(1);
        expect(m.totalCounter('req')).toBe(3);
    });

    it('records histogram values in observation order', () => {
        const m = new InMemoryMetricsRegistry();
        m.histogram('lat', 5);
        m.histogram('lat', 7);
        m.histogram('lat', 3, { route: '/a' });
        expect(m.histogramValues('lat')).toEqual([5, 7, 3]);
        expect(m.histogramValues('lat', { route: '/a' })).toEqual([3]);
    });

    it('lastGauge returns the most recent matching observation', () => {
        const m = new InMemoryMetricsRegistry();
        m.gauge('q', 1, { shard: '0' });
        m.gauge('q', 2, { shard: '0' });
        m.gauge('q', 9, { shard: '1' });
        expect(m.lastGauge('q', { shard: '0' })).toBe(2);
        expect(m.lastGauge('q', { shard: '1' })).toBe(9);
        expect(m.lastGauge('q', { shard: '2' })).toBeUndefined();
    });

    it('reset() clears all samples', () => {
        const m = new InMemoryMetricsRegistry();
        m.counter('x');
        m.reset();
        expect(m.samples).toHaveLength(0);
    });
});

describe('ConsoleMetricsRegistry', () => {
    it('emits one line per observation through the sink', () => {
        const lines: string[] = [];
        const m = new ConsoleMetricsRegistry({ sink: (s) => lines.push(s) });
        m.counter('hits', { route: '/a' });
        m.histogram('lat_ms', 42, { route: '/a' });
        m.gauge('queue', 7);
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('counter hits 1');
        expect(lines[0]).toContain('route="/a"');
        expect(lines[1]).toContain('histogram lat_ms 42');
        expect(lines[2]).toContain('gauge queue 7');
    });

    it('never throws when the sink throws', () => {
        const m = new ConsoleMetricsRegistry({ sink: () => { throw new Error('sink broken'); } });
        expect(() => m.counter('x')).not.toThrow();
    });

    it('honours custom prefix', () => {
        const lines: string[] = [];
        const m = new ConsoleMetricsRegistry({ sink: (s) => lines.push(s), prefix: '<metric>' });
        m.counter('x');
        expect(lines[0].startsWith('<metric> ')).toBe(true);
    });
});
