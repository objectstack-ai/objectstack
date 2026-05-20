// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    instrumentRouteHandler,
    InMemoryMetricsRegistry,
    InMemoryErrorReporter,
} from './index.js';

interface FakeRes {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
    status(code: number): FakeRes;
    header(k: string, v: string): FakeRes;
    json(body: unknown): FakeRes;
    end(): FakeRes;
    __obsRecordedError?: unknown;
}

function makeRes(): FakeRes {
    const res: FakeRes = {
        statusCode: 200,
        headers: {},
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        header(k, v) {
            this.headers[k] = v;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        end() {
            return this;
        },
    };
    return res;
}

/**
 * Drive a fake monotonic clock so duration assertions are exact.
 */
function makeClock() {
    let t = 1_000_000;
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms;
        },
    };
}

describe('instrumentRouteHandler', () => {
    let metrics: InMemoryMetricsRegistry;
    let errorReporter: InMemoryErrorReporter;

    beforeEach(() => {
        metrics = new InMemoryMetricsRegistry();
        errorReporter = new InMemoryErrorReporter();
    });

    describe('request id propagation', () => {
        it('echoes a valid incoming X-Request-Id on the response header', async () => {
            const wrapped = instrumentRouteHandler('GET', '/health', async () => {}, {
                metrics,
            });
            const res = makeRes();
            await wrapped({ headers: { 'x-request-id': 'caller-42' } }, res);
            expect(res.headers['X-Request-Id']).toBe('caller-42');
        });

        it('mints a fresh id when none present, exposes on req.requestId', async () => {
            let observedId: string | undefined;
            const wrapped = instrumentRouteHandler(
                'GET',
                '/x',
                async (req: any) => {
                    observedId = req.requestId;
                },
                { metrics, generateRequestId: () => 'fixed-id' },
            );
            const res = makeRes();
            await wrapped({ headers: {} }, res);
            expect(observedId).toBe('fixed-id');
            expect(res.headers['X-Request-Id']).toBe('fixed-id');
        });

        it('mints a fresh id when incoming is malformed (header injection attempt)', async () => {
            const wrapped = instrumentRouteHandler(
                'GET',
                '/x',
                async () => {},
                { metrics, generateRequestId: () => 'safe-id' },
            );
            const res = makeRes();
            await wrapped(
                { headers: { 'x-request-id': 'evil\r\nset-cookie: x=y' } },
                res,
            );
            expect(res.headers['X-Request-Id']).toBe('safe-id');
        });

        it('honors a custom requestIdHeader name', async () => {
            const wrapped = instrumentRouteHandler(
                'GET',
                '/x',
                async () => {},
                { metrics, generateRequestId: () => 'id-1', requestIdHeader: 'X-Trace' },
            );
            const res = makeRes();
            await wrapped({ headers: {} }, res);
            expect(res.headers['X-Trace']).toBe('id-1');
            expect(res.headers['X-Request-Id']).toBeUndefined();
        });
    });

    describe('metrics emission', () => {
        it('records counter and histogram on success (default 200 status)', async () => {
            const clock = makeClock();
            const wrapped = instrumentRouteHandler(
                'GET',
                '/health',
                async () => {
                    clock.advance(15);
                },
                { metrics, now: clock.now },
            );
            await wrapped({ headers: {} }, makeRes());
            expect(
                metrics.totalCounter('http_requests_total', {
                    method: 'GET',
                    route: '/health',
                    status: '200',
                }),
            ).toBe(1);
            expect(
                metrics.histogramValues('http_request_duration_ms', {
                    method: 'GET',
                    route: '/health',
                }),
            ).toEqual([15]);
        });

        it('records the status as set by res.status() (e.g. 404)', async () => {
            const wrapped = instrumentRouteHandler(
                'GET',
                '/missing',
                async (_req, res) => {
                    res.status(404).json({ error: 'not found' });
                },
                { metrics },
            );
            const res = makeRes();
            await wrapped({ headers: {} }, res);
            expect(res.statusCode).toBe(404);
            expect(
                metrics.totalCounter('http_requests_total', { status: '404' }),
            ).toBe(1);
        });

        it('records errors counter and 5xx status on thrown errors', async () => {
            const wrapped = instrumentRouteHandler(
                'POST',
                '/boom',
                async () => {
                    throw new Error('kaboom');
                },
                { metrics, errorReporter },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow('kaboom');
            expect(
                metrics.totalCounter('http_request_errors_total', {
                    method: 'POST',
                    route: '/boom',
                }),
            ).toBe(1);
            expect(
                metrics.totalCounter('http_requests_total', { status: '500' }),
            ).toBe(1);
        });

        it('uses err.statusCode when present (e.g. 400 from validation)', async () => {
            const wrapped = instrumentRouteHandler(
                'POST',
                '/x',
                async () => {
                    const err: any = new Error('bad input');
                    err.statusCode = 400;
                    throw err;
                },
                { metrics, errorReporter },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow();
            expect(metrics.totalCounter('http_requests_total', { status: '400' })).toBe(1);
        });

        it('emits histogram even when the handler throws (finally block)', async () => {
            const clock = makeClock();
            const wrapped = instrumentRouteHandler(
                'GET',
                '/x',
                async () => {
                    clock.advance(7);
                    throw new Error('x');
                },
                { metrics, now: clock.now },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow();
            expect(metrics.histogramValues('http_request_duration_ms')).toEqual([7]);
        });
    });

    describe('error reporting policy', () => {
        it('captures 5xx thrown errors', async () => {
            const wrapped = instrumentRouteHandler(
                'GET',
                '/x',
                async () => {
                    throw new Error('boom');
                },
                { metrics, errorReporter },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow();
            expect(errorReporter.captured).toHaveLength(1);
            expect((errorReporter.captured[0].error as Error).message).toBe('boom');
            expect(errorReporter.captured[0].context).toMatchObject({
                method: 'GET',
                route: '/x',
            });
            expect(errorReporter.captured[0].context.requestId).toBeTypeOf('string');
        });

        it('does NOT capture 4xx errors (client errors are not bugs)', async () => {
            const wrapped = instrumentRouteHandler(
                'POST',
                '/x',
                async () => {
                    const err: any = new Error('bad');
                    err.statusCode = 422;
                    throw err;
                },
                { metrics, errorReporter },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow();
            expect(errorReporter.captured).toHaveLength(0);
        });

        it('captures via side-channel when handler swallowed the error', async () => {
            const originalErr = new Error('caught-by-handler');
            // Handler catches and writes to res.__obsRecordedError —
            // this models what errorResponseBase does.
            const wrapped = instrumentRouteHandler(
                'POST',
                '/x',
                async (_req, res) => {
                    res.status(500);
                    (res as any).__obsRecordedError = originalErr;
                    res.json({ error: 'oops' });
                },
                { metrics, errorReporter },
            );
            await wrapped({ headers: {} }, makeRes());
            expect(errorReporter.captured).toHaveLength(1);
            expect(errorReporter.captured[0].error).toBe(originalErr);
        });

        it('does not double-capture when handler threw AND set the side channel', async () => {
            const wrapped = instrumentRouteHandler(
                'GET',
                '/x',
                async (_req, res) => {
                    (res as any).__obsRecordedError = new Error('side-channel');
                    throw new Error('thrown');
                },
                { metrics, errorReporter },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow();
            expect(errorReporter.captured).toHaveLength(1);
            expect((errorReporter.captured[0].error as Error).message).toBe('thrown');
        });

        it('reporter exceptions never mask the original error', async () => {
            const throwingReporter = {
                captureException: () => {
                    throw new Error('reporter exploded');
                },
            };
            const wrapped = instrumentRouteHandler(
                'GET',
                '/x',
                async () => {
                    throw new Error('original');
                },
                { metrics, errorReporter: throwingReporter },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow('original');
        });
    });

    describe('edge cases', () => {
        it('handles a response object with no .header() (does not throw)', async () => {
            const headerless: any = {
                status(c: number) {
                    this.statusCode = c;
                    return this;
                },
                json() {
                    return this;
                },
                end() {
                    return this;
                },
            };
            const wrapped = instrumentRouteHandler('GET', '/x', async () => {}, {
                metrics,
            });
            await expect(wrapped({ headers: {} }, headerless)).resolves.toBeUndefined();
            expect(metrics.totalCounter('http_requests_total')).toBe(1);
        });

        it('handles req without headers', async () => {
            const wrapped = instrumentRouteHandler('GET', '/x', async () => {}, {
                metrics,
                generateRequestId: () => 'gen',
            });
            const res = makeRes();
            await wrapped({}, res);
            expect(res.headers['X-Request-Id']).toBe('gen');
        });
    });
});
