// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    NoopMetricsRegistry,
    InMemoryMetricsRegistry,
    RUNTIME_METRICS,
} from './metrics.js';

describe('NoopMetricsRegistry', () => {
    it('discards observations without throwing', () => {
        const m = new NoopMetricsRegistry();
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
        m.histogram('latency', 10);
        m.histogram('latency', 20);
        m.histogram('latency', 30);
        expect(m.histogramValues('latency')).toEqual([10, 20, 30]);
    });

    it('partitions histograms by label match', () => {
        const m = new InMemoryMetricsRegistry();
        m.histogram('latency', 10, { route: '/a' });
        m.histogram('latency', 20, { route: '/b' });
        expect(m.histogramValues('latency', { route: '/a' })).toEqual([10]);
        expect(m.histogramValues('latency', { route: '/b' })).toEqual([20]);
    });

    it('records gauges as raw samples', () => {
        const m = new InMemoryMetricsRegistry();
        m.gauge('queue_depth', 3);
        m.gauge('queue_depth', 7);
        expect(m.samples.filter(s => s.kind === 'gauge').map(s => s.value)).toEqual([3, 7]);
    });

    it('reset() clears recorded samples', () => {
        const m = new InMemoryMetricsRegistry();
        m.counter('x');
        m.histogram('y', 1);
        m.reset();
        expect(m.samples).toEqual([]);
        expect(m.totalCounter('x')).toBe(0);
    });

    it('label-match treats unspecified labels as wildcards', () => {
        const m = new InMemoryMetricsRegistry();
        m.counter('req', { method: 'GET', status: '200' });
        m.counter('req', { method: 'POST', status: '200' });
        // Match only by status — both rows should count.
        expect(m.totalCounter('req', { status: '200' })).toBe(2);
    });
});

describe('RUNTIME_METRICS', () => {
    it('exposes the canonical metric names', () => {
        expect(RUNTIME_METRICS.httpRequestsTotal).toBe('http_requests_total');
        expect(RUNTIME_METRICS.httpRequestDurationMs).toBe('http_request_duration_ms');
        expect(RUNTIME_METRICS.httpRequestErrorsTotal).toBe('http_request_errors_total');
    });
});
