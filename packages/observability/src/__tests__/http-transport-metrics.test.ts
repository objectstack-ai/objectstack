// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IHttpServer, HttpResponseObserver } from '@objectstack/spec/contracts';
import {
    armHttpRequestCounter,
    armHttpRequestDurationHistogram,
} from '../http-transport-metrics.js';
import { InMemoryMetricsRegistry } from '../metrics-exporters.js';

/** A minimal `IHttpServer` whose `afterResponse` we can drive by hand. */
function observableServer() {
    const observers: HttpResponseObserver[] = [];
    const server: IHttpServer = {
        get: () => {},
        post: () => {},
        put: () => {},
        delete: () => {},
        patch: () => {},
        use: () => {},
        listen: async () => {},
        afterResponse: (observer) => {
            observers.push(observer);
        },
    };
    const deliver = (routePattern: string, status: number, elapsedMs = 1) => {
        for (const observer of observers) {
            observer({ method: 'GET', routePattern, status, elapsedMs });
        }
    };
    return { server, observers, deliver };
}

describe('armHttpRequestCounter (#9835)', () => {
    it('arms the counter through the afterResponse seam, labelled by PATTERN with stringified status', () => {
        const { server, deliver } = observableServer();
        const metrics = new InMemoryMetricsRegistry();

        expect(armHttpRequestCounter(server, metrics)).toBe('armed');
        deliver('/api/v1/data/:id', 200);
        deliver('/api/v1/data/:id', 503);

        expect(
            metrics.totalCounter('http_requests_total', {
                method: 'GET',
                route: '/api/v1/data/:id',
                status: '200',
            }),
        ).toBe(1);
        expect(
            metrics.totalCounter('http_requests_total', {
                route: '/api/v1/data/:id',
                status: '503',
            }),
        ).toBe(1);
    });

    it('latches per server — a second arming call registers NOTHING, whoever brings the registry', () => {
        // The contract's one-owner rule made structural: the transport plugin
        // (Phase 1) and the dispatcher's registry offer (Phase 2) both route
        // through here; first caller wins and one registry handed to both
        // layers can never double-count (#9833's shape, closed).
        const { server, observers, deliver } = observableServer();
        const first = new InMemoryMetricsRegistry();
        const second = new InMemoryMetricsRegistry();

        expect(armHttpRequestCounter(server, first)).toBe('armed');
        expect(armHttpRequestCounter(server, first)).toBe('already-armed');
        expect(armHttpRequestCounter(server, second)).toBe('already-armed');
        expect(observers).toHaveLength(1);

        deliver('/counted', 200);
        expect(first.totalCounter('http_requests_total', { route: '/counted' })).toBe(1);
        // The later registry was refused, not silently added.
        expect(second.totalCounter('http_requests_total', { route: '/counted' })).toBe(0);
    });

    it('reports "unsupported" for a transport without the seam and registers nothing', () => {
        const server: IHttpServer = {
            get: () => {},
            post: () => {},
            put: () => {},
            delete: () => {},
            patch: () => {},
            use: () => {},
            listen: async () => {},
        };
        const metrics = new InMemoryMetricsRegistry();

        // The documented expectation, surfaced instead of read as coverage:
        // this transport reports NO HTTP metrics; the caller decides how to
        // degrade (the dispatcher falls back to counting its own routes).
        expect(armHttpRequestCounter(server, metrics)).toBe('unsupported');
        expect(metrics.samples).toHaveLength(0);
    });

    it('latches per SERVER, not per process — a second server arms independently', () => {
        const a = observableServer();
        const b = observableServer();
        const metrics = new InMemoryMetricsRegistry();

        expect(armHttpRequestCounter(a.server, metrics)).toBe('armed');
        expect(armHttpRequestCounter(b.server, metrics)).toBe('armed');
        a.deliver('/a', 200);
        b.deliver('/b', 200);
        expect(metrics.totalCounter('http_requests_total', { route: '/a' })).toBe(1);
        expect(metrics.totalCounter('http_requests_total', { route: '/b' })).toBe(1);
    });
});

describe('armHttpRequestDurationHistogram (#9834)', () => {
    it('arms the histogram through the same seam, labelled by PATTERN with the declared {method,route} set', () => {
        const { server, deliver } = observableServer();
        const metrics = new InMemoryMetricsRegistry();

        expect(armHttpRequestDurationHistogram(server, metrics)).toBe('armed');
        deliver('/api/v1/data/:id', 200, 17);
        deliver('/api/v1/data/:id', 503, 42);

        expect(
            metrics.histogramValues('http_request_duration_ms', {
                method: 'GET',
                route: '/api/v1/data/:id',
            }),
        ).toEqual([17, 42]);
        // The observation's OWN elapsedMs, not a re-measurement: the value
        // reaching the registry is the transport's number.
        const rows = metrics.samples.filter(
            (s) => s.kind === 'histogram' && s.name === 'http_request_duration_ms',
        );
        // No `status` label — a latency histogram split by status is a
        // different series shape than the one SEMCONV declares and the docs
        // tell operators to graph.
        expect(rows.map((s) => s.labels)).toEqual([
            { method: 'GET', route: '/api/v1/data/:id' },
            { method: 'GET', route: '/api/v1/data/:id' },
        ]);
    });

    it('latches per server — a second arming call registers NOTHING, whoever brings the registry', () => {
        const { server, observers, deliver } = observableServer();
        const first = new InMemoryMetricsRegistry();
        const second = new InMemoryMetricsRegistry();

        expect(armHttpRequestDurationHistogram(server, first)).toBe('armed');
        expect(armHttpRequestDurationHistogram(server, first)).toBe('already-armed');
        expect(armHttpRequestDurationHistogram(server, second)).toBe('already-armed');
        expect(observers).toHaveLength(1);

        deliver('/timed', 200, 5);
        expect(first.histogramValues('http_request_duration_ms', { route: '/timed' })).toEqual([5]);
        expect(second.histogramValues('http_request_duration_ms', { route: '/timed' })).toEqual([]);
    });

    it('reports "unsupported" for a transport without the seam and registers nothing', () => {
        const server: IHttpServer = {
            get: () => {},
            post: () => {},
            put: () => {},
            delete: () => {},
            patch: () => {},
            use: () => {},
            listen: async () => {},
        };
        const metrics = new InMemoryMetricsRegistry();

        expect(armHttpRequestDurationHistogram(server, metrics)).toBe('unsupported');
        expect(metrics.samples).toHaveLength(0);
    });

    it('the two families latch INDEPENDENTLY — arming one never latches the other away', () => {
        // The reason each family has its own registered symbol. A host that
        // armed only the counter (the #9835 shape) must still be able to arm
        // the histogram, and vice versa — a shared latch would silently
        // swallow the second family and read exactly like "already covered".
        const { server, observers, deliver } = observableServer();
        const metrics = new InMemoryMetricsRegistry();

        expect(armHttpRequestCounter(server, metrics)).toBe('armed');
        expect(armHttpRequestDurationHistogram(server, metrics)).toBe('armed');
        expect(observers).toHaveLength(2);

        deliver('/both', 200, 9);
        expect(metrics.totalCounter('http_requests_total', { route: '/both' })).toBe(1);
        expect(metrics.histogramValues('http_request_duration_ms', { route: '/both' })).toEqual([9]);
    });
});
