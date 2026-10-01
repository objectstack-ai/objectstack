// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { OtlpHttpMetricsRegistry } from '../metrics-exporters.js';

interface CapturedRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
}

function makeFakeFetch(captured: CapturedRequest[], opts: { ok?: boolean; status?: number } = {}) {
    return (async (input: string | URL | Request, init?: RequestInit) => {
        const headers: Record<string, string> = {};
        if (init?.headers) {
            for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
                headers[k.toLowerCase()] = v;
            }
        }
        captured.push({
            url: typeof input === 'string' ? input : input.toString(),
            method: init?.method,
            headers,
            body: init?.body ? JSON.parse(init.body as string) : undefined,
        });
        return new Response('', { status: opts.status ?? (opts.ok === false ? 500 : 202) });
    }) as unknown as typeof fetch;
}

describe('OtlpHttpMetricsRegistry', () => {
    it('appends /v1/metrics to a bare endpoint', async () => {
        const captured: CapturedRequest[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318',
            fetch: makeFakeFetch(captured),
        });
        reg.counter('x');
        await reg.flush();
        expect(captured[0].url).toBe('http://collector:4318/v1/metrics');
    });

    it('does not duplicate /v1/metrics when already present', async () => {
        const captured: CapturedRequest[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318/v1/metrics',
            fetch: makeFakeFetch(captured),
        });
        reg.counter('x');
        await reg.flush();
        expect(captured[0].url).toBe('http://collector:4318/v1/metrics');
    });

    it('buffers samples until flush() is called', async () => {
        const captured: CapturedRequest[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318',
            fetch: makeFakeFetch(captured),
        });
        reg.counter('x');
        reg.counter('x');
        reg.histogram('y', 5);
        expect(captured).toHaveLength(0);
        expect(reg.peek()).toHaveLength(3);
        await reg.flush();
        expect(captured).toHaveLength(1);
        expect(reg.peek()).toHaveLength(0);
    });

    it('flush() with empty buffer is a no-op', async () => {
        const captured: CapturedRequest[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318',
            fetch: makeFakeFetch(captured),
        });
        await reg.flush();
        expect(captured).toHaveLength(0);
    });

    it('groups samples by metric name in the export body', async () => {
        const captured: CapturedRequest[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318',
            fetch: makeFakeFetch(captured),
            resource: { 'service.name': 'objectos', 'deployment.environment': 'prod' },
        });
        reg.counter('http_requests_total', { status: '200' });
        reg.counter('http_requests_total', { status: '500' });
        reg.histogram('http_request_duration_ms', 42);
        reg.gauge('queue_size', 7);
        await reg.flush();

        const body = captured[0].body as any;
        const metrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
        expect(metrics).toHaveLength(3);
        const counter = metrics.find((m: any) => m.name === 'http_requests_total');
        expect(counter.sum.dataPoints).toHaveLength(2);
        expect(counter.sum.isMonotonic).toBe(true);
        expect(counter.sum.aggregationTemporality).toBe(2);
        const hist = metrics.find((m: any) => m.name === 'http_request_duration_ms');
        expect(hist.histogram.dataPoints[0].sum).toBe(42);
        const gauge = metrics.find((m: any) => m.name === 'queue_size');
        expect(gauge.gauge.dataPoints[0].asDouble).toBe(7);

        // Resource attributes propagate.
        const resource = body.resourceMetrics[0].resource.attributes;
        const names = resource.map((a: any) => a.key).sort();
        expect(names).toEqual(['deployment.environment', 'service.name']);
    });

    it('attaches custom headers on the request', async () => {
        const captured: CapturedRequest[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318',
            fetch: makeFakeFetch(captured),
            headers: { authorization: 'Bearer abc' },
        });
        reg.counter('x');
        await reg.flush();
        expect(captured[0].headers?.authorization).toBe('Bearer abc');
        expect(captured[0].headers?.['content-type']).toBe('application/json');
    });

    it('auto-flushes when buffer reaches maxBufferSize', async () => {
        const captured: CapturedRequest[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318',
            fetch: makeFakeFetch(captured),
            maxBufferSize: 2,
        });
        reg.counter('x');
        reg.counter('x'); // triggers auto-flush
        // Auto-flush is fire-and-forget; await a microtask to let it settle.
        await new Promise(setImmediate);
        expect(captured).toHaveLength(1);
    });

    it('reports network errors via onError instead of throwing', async () => {
        const errors: unknown[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318',
            fetch: (async () => { throw new Error('connection refused'); }) as typeof fetch,
            onError: (e) => errors.push(e),
        });
        reg.counter('x');
        await reg.flush();
        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toBe('connection refused');
    });

    it('reports non-2xx responses via onError', async () => {
        const errors: unknown[] = [];
        const captured: CapturedRequest[] = [];
        const reg = new OtlpHttpMetricsRegistry({
            endpoint: 'http://collector:4318',
            fetch: makeFakeFetch(captured, { status: 500 }),
            onError: (e) => errors.push(e),
        });
        reg.counter('x');
        await reg.flush();
        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toContain('HTTP 500');
    });
});
