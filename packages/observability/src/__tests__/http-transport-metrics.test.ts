// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IHttpServer, HttpResponseObserver } from '@objectstack/spec/contracts';
import { armHttpRequestCounter } from '../http-transport-metrics.js';
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
    const deliver = (routePattern: string, status: number) => {
        for (const observer of observers) {
            observer({ method: 'GET', routePattern, status, elapsedMs: 1 });
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
