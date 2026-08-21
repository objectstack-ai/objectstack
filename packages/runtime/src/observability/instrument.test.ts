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

/**
 * The retired name (#9834, ADR-0049 enforce-or-remove). Kept as a LITERAL
 * rather than a `RUNTIME_METRICS` member on purpose: the constant is gone, so
 * a member read would not compile, and the thing worth pinning is that nothing
 * writes this SERIES — which is what an external dashboard keyed on the string
 * would look for. Any sample under this name is the retirement coming undone.
 */
const RETIRED_ERROR_COUNTER = 'http_request_errors_total';

function retiredErrorCounterSamples(m: InMemoryMetricsRegistry) {
    return m.samples.filter((s) => s.name === RETIRED_ERROR_COUNTER);
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

        it('emitHttpRequestsTotal: false suppresses ONLY the request counter — histogram, reporter and request-id stay on (#9835)', async () => {
            // The dispatcher passes this when the transport implements the
            // `IHttpServer.afterResponse` seam, which then owns the counter
            // (#9833's duplicate). Everything else the wrapper emits is NOT
            // emitted by the transport seam and must survive the gate.
            const clock = makeClock();
            const wrapped = instrumentRouteHandler(
                'GET',
                '/health',
                async () => {
                    clock.advance(15);
                },
                { metrics, now: clock.now, emitHttpRequestsTotal: false },
            );
            const res = makeRes();
            await wrapped({ headers: {} }, res);
            expect(
                metrics.totalCounter('http_requests_total', { route: '/health' }),
            ).toBe(0);
            expect(
                metrics.histogramValues('http_request_duration_ms', {
                    method: 'GET',
                    route: '/health',
                }),
            ).toEqual([15]);
            expect(res.headers['X-Request-Id']).toBeTruthy();

            // A throw under the gate: the REPORTER is what survives it. The
            // error counter used to be asserted here; #9834 retired it, so the
            // assertion is now that nothing writes that series.
            const throwing = instrumentRouteHandler(
                'POST',
                '/boom',
                async () => {
                    throw new Error('kaboom');
                },
                { metrics, errorReporter, emitHttpRequestsTotal: false },
            );
            await expect(throwing({ headers: {} }, makeRes())).rejects.toThrow('kaboom');
            expect(errorReporter.captured).toHaveLength(1);
            expect(retiredErrorCounterSamples(metrics)).toEqual([]);
            expect(
                metrics.totalCounter('http_requests_total', { route: '/boom' }),
            ).toBe(0);
        });

        it('emitHttpRequestsTotal defaults to true — the legacy behavior for hook-less transports', async () => {
            const wrapped = instrumentRouteHandler(
                'GET',
                '/legacy',
                async () => {},
                { metrics },
            );
            await wrapped({ headers: {} }, makeRes());
            expect(
                metrics.totalCounter('http_requests_total', { route: '/legacy' }),
            ).toBe(1);
        });

        it('emitHttpRequestDurationMs: false suppresses ONLY the histogram — counter, reporter and request-id stay on (#9834)', async () => {
            // The dispatcher passes this once the transport's afterResponse
            // seam has the duration histogram armed on it. The counter is
            // gated by its OWN flag, so a transport that owns one family and
            // not the other is expressible — which is the whole reason the
            // two flags are separate.
            const clock = makeClock();
            const wrapped = instrumentRouteHandler(
                'GET',
                '/health',
                async () => {
                    clock.advance(15);
                },
                { metrics, now: clock.now, emitHttpRequestDurationMs: false },
            );
            const res = makeRes();
            await wrapped({ headers: {} }, res);
            expect(
                metrics.histogramValues('http_request_duration_ms', { route: '/health' }),
            ).toEqual([]);
            // Everything the transport seam does NOT emit survives the gate.
            expect(
                metrics.totalCounter('http_requests_total', { route: '/health' }),
            ).toBe(1);
            expect(res.headers['X-Request-Id']).toBeTruthy();

            const throwing = instrumentRouteHandler(
                'POST',
                '/boom',
                async () => {
                    throw new Error('kaboom');
                },
                { metrics, errorReporter, emitHttpRequestDurationMs: false },
            );
            await expect(throwing({ headers: {} }, makeRes())).rejects.toThrow('kaboom');
            // The error counter had NO transport-side emitter to defer to — the
            // observation carries no throw signal — and #9834's fork was ruled
            // RETIRE rather than move, so no emitter is left on any transport.
            expect(retiredErrorCounterSamples(metrics)).toEqual([]);
            expect(errorReporter.captured).toHaveLength(1);
        });

        it('emitHttpRequestDurationMs defaults to true — the legacy behavior for hook-less transports', async () => {
            const clock = makeClock();
            const wrapped = instrumentRouteHandler(
                'GET',
                '/legacy-timing',
                async () => {
                    clock.advance(4);
                },
                { metrics, now: clock.now },
            );
            await wrapped({ headers: {} }, makeRes());
            expect(
                metrics.histogramValues('http_request_duration_ms', { route: '/legacy-timing' }),
            ).toEqual([4]);
        });

        it('the two gates are INDEPENDENT — both off leaves request-id and the reporter', async () => {
            const clock = makeClock();
            const wrapped = instrumentRouteHandler(
                'POST',
                '/both-off',
                async () => {
                    clock.advance(3);
                    throw new Error('still reported');
                },
                {
                    metrics,
                    errorReporter,
                    now: clock.now,
                    emitHttpRequestsTotal: false,
                    emitHttpRequestDurationMs: false,
                },
            );
            const res = makeRes();
            await expect(wrapped({ headers: {} }, res)).rejects.toThrow('still reported');
            expect(metrics.totalCounter('http_requests_total', { route: '/both-off' })).toBe(0);
            expect(
                metrics.histogramValues('http_request_duration_ms', { route: '/both-off' }),
            ).toEqual([]);
            expect(retiredErrorCounterSamples(metrics)).toEqual([]);
            expect(res.headers['X-Request-Id']).toBeTruthy();
            expect(errorReporter.captured).toHaveLength(1);
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

        it('records 5xx status on thrown errors — and emits NO error counter (#9834 retired it)', async () => {
            const wrapped = instrumentRouteHandler(
                'POST',
                '/boom',
                async () => {
                    throw new Error('kaboom');
                },
                { metrics, errorReporter },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow('kaboom');
            // The tombstone, on the emission path that used to write it: the
            // wrapper's own default composition, no gate flags set. This is the
            // assertion that fails if the emission is ever restored.
            expect(retiredErrorCounterSamples(metrics)).toEqual([]);
            // What replaced it as the 5xx signal — same throw, on the family the
            // TRANSPORT emits for every inbound surface.
            expect(
                metrics.totalCounter('http_requests_total', { status: '500' }),
            ).toBe(1);
            expect(errorReporter.captured).toHaveLength(1);
        });

        it('a THROWN 4xx writes no error counter either — the retired series had no status filter (#9834)', async () => {
            // Recorded because it is the half of the old population a status-class
            // replacement would have dropped: the retired counter incremented
            // unconditionally in the `catch`, so a thrown 400 WAS counted by it.
            // Nothing counts it now; `http_requests_total{status="400"}` carries
            // the request, and the reporter deliberately stays out of 4xx.
            const wrapped = instrumentRouteHandler(
                'POST',
                '/validate',
                async () => {
                    const err: any = new Error('bad input');
                    err.statusCode = 400;
                    throw err;
                },
                { metrics, errorReporter },
            );
            await expect(wrapped({ headers: {} }, makeRes())).rejects.toThrow('bad input');
            expect(retiredErrorCounterSamples(metrics)).toEqual([]);
            expect(
                metrics.totalCounter('http_requests_total', { status: '400' }),
            ).toBe(1);
            expect(errorReporter.captured).toHaveLength(0);
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
