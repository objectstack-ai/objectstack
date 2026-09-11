// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17411] A route mounted through `IHttpServer.getRawApp()` owes the declared
 * ADR-0112 refusal envelope on an escaped throw — the door #16545 repaired
 * `wrap()` for and named as a known-unreached one.
 *
 * ## The measurement this file exists to move
 *
 * Re-taken on `origin/main` = `7d350a46` (which already carries #16545, closed
 * 2026-09-10 via PR #17412), one `HonoHttpServer`, the raw pair mounted exactly
 * the way `marketplace-install-local-plugin.ts` mounts (`getRawApp().get(...)`)
 * and the wrapped pair through the ordinary `IHttpServer` verb:
 *
 * ```
 * /raw/envelope      -> 500  text/plain; charset=UTF-8   Internal Server Error
 * /raw/plain         -> 500  text/plain; charset=UTF-8   Internal Server Error
 * /wrapped/envelope  -> 503  application/json  {"success":false,"error":{"code":"SERVICE_UNAVAILABLE",…}}
 * /wrapped/plain     -> 500  application/json  {"success":false,"error":{"code":"INTERNAL_ERROR",…}}
 * ```
 *
 * ⭐ The two raw doors were **byte-identical**: a throw that DECLARED `503` /
 * `SERVICE_UNAVAILABLE` and a bare driver error answered the same thing. That
 * is the reading that split this card out of #16545 — #16545's required pin
 * ("a non-envelope throw still answers 500 with no cause in the body") was
 * green on this door before any fix existed, so writing it there measured
 * nothing.
 *
 * ## Why the wrapped pair is in THIS fixture
 *
 * As the lit control. Every raw assertion below has a wrapped twin driven
 * through the same server, so a green run proves the RAW path changed rather
 * than proving the harness booted — and the twins are what make "one rule, not
 * two" checkable rather than asserted: the raw door is pinned to answer the
 * same `code` + `status` the wrapped door answers for the same throw.
 *
 * ## What is NOT pinned here
 *
 * ⛔ Not the raw door's error MESSAGE against the wrapped door's. `wrap()`'s
 * fallback literal ("No response from handler") describes a handler that wrote
 * nothing; the transport seam never observes that state and says
 * `INTERNAL_ERROR_MESSAGE` instead. The `code` and the `status` — what a client
 * branches on — agree exactly, and both arms are pinned to carry no cause.
 */

import { describe, it, expect } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from '@objectstack/spec/contracts';
import type { HttpResponseObservation } from '@objectstack/core';

import { HonoHttpServer } from './adapter';

/** A silent logger — most of this file is about the WIRE, not the diagnosis. */
function quietLogger(): Logger {
    const noop = () => {};
    return { debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as unknown as Logger;
}

function server(logger: Logger = quietLogger()): HonoHttpServer {
    const s = new HonoHttpServer(0);
    s.setLogger(logger);
    return s;
}

const call = (s: HonoHttpServer, path: string, init?: RequestInit) =>
    s.getRawApp().fetch(new Request(`http://localhost${path}`, init));

/** A throw shaped exactly like the platform's declared refusals. */
function declared(status: number, code: string, message: string) {
    return Object.assign(new Error(message), { status, code });
}

/**
 * The four doors of the card's matrix on ONE server: the raw pair mounted on
 * the framework handle, the wrapped pair through the `IHttpServer` verb, both
 * throwing the same two values.
 */
function fourDoors(logger?: Logger): HonoHttpServer {
    const s = server(logger);
    const envelopeThrow = () => {
        throw declared(503, 'SERVICE_UNAVAILABLE', 'The authorization store could not be read.');
    };
    const plainThrow = () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    };

    s.getRawApp().get('/raw/envelope', () => { envelopeThrow(); });
    s.getRawApp().get('/raw/plain', () => { plainThrow(); });
    s.get('/wrapped/envelope', async () => { envelopeThrow(); });
    s.get('/wrapped/plain', async () => { plainThrow(); });
    return s;
}

describe("a raw mount's escaped throw is answered with the declared ADR-0112 envelope", () => {
    it('answers /raw/envelope with the DECLARED status and code, as JSON', async () => {
        const res = await call(fourDoors(), '/raw/envelope');

        // The named acceptance criterion: status + nested code, never "it
        // didn't 200".
        expect(res.status).toBe(503);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.json()).toEqual({
            success: false,
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'The authorization store could not be read.',
            },
        });
    });

    it('answers /raw/plain 500 INTERNAL_ERROR as JSON, with no cause in the body', async () => {
        const res = await call(fourDoors(), '/raw/plain');

        expect(res.status).toBe(500);
        expect(res.headers.get('content-type')).toContain('application/json');
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
        // #16545's invariant, inherited: a non-envelope throw discloses
        // nothing. The driver dump names the backend and its port.
        expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
        expect(JSON.stringify(body)).not.toContain('5432');
    });

    it('STOPS the two raw doors being byte-identical — the reading that split this card', async () => {
        const s = fourDoors();
        const [envelope, plain] = await Promise.all([
            call(s, '/raw/envelope'),
            call(s, '/raw/plain'),
        ]);
        const [envelopeBody, plainBody] = await Promise.all([envelope.text(), plain.text()]);

        expect(envelope.status).not.toBe(plain.status);
        expect(envelopeBody).not.toBe(plainBody);
        // …and neither is Hono's own default answer any more.
        expect(envelopeBody).not.toBe('Internal Server Error');
        expect(plainBody).not.toBe('Internal Server Error');
    });

    it('answers the raw door and the wrapped door with the SAME code and status', async () => {
        const s = fourDoors();
        const [rawEnvelope, wrappedEnvelope, rawPlain, wrappedPlain] = await Promise.all([
            call(s, '/raw/envelope'),
            call(s, '/wrapped/envelope'),
            call(s, '/raw/plain'),
            call(s, '/wrapped/plain'),
        ]);

        const codeOf = async (res: Response) => (await res.json()).error.code;

        expect([rawEnvelope.status, await codeOf(rawEnvelope)])
            .toEqual([wrappedEnvelope.status, await codeOf(wrappedEnvelope)]);
        expect([rawPlain.status, await codeOf(rawPlain)])
            .toEqual([wrappedPlain.status, await codeOf(wrappedPlain)]);
    });

    it('leaves the WRAPPED pair exactly as #16545 left it — the lit control', async () => {
        const s = fourDoors();

        const envelope = await call(s, '/wrapped/envelope');
        expect(envelope.status).toBe(503);
        expect(await envelope.json()).toEqual({
            success: false,
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'The authorization store could not be read.',
            },
        });

        const plain = await call(s, '/wrapped/plain');
        expect(plain.status).toBe(500);
        // Byte-for-byte, the literal `wrap()` has always answered.
        expect(await plain.text()).toBe(
            '{"success":false,"error":{"code":"INTERNAL_ERROR","message":"No response from handler"}}',
        );
    });
});

describe('the raw door reads the ONE rule, not a second one', () => {
    it('reads `statusCode` as well as `status`, exactly as the wrapped door does', async () => {
        const s = server();
        // `plugin-approvals`' lifecycle hooks and `metadata-protocol` throw
        // `statusCode`; both spellings are produced in this repo.
        const thrower = () => {
            throw Object.assign(new Error('locked by another process'), {
                statusCode: 409,
                code: 'LOCK_CONFLICT',
            });
        };
        s.getRawApp().get('/raw/conflict', () => { thrower(); });
        s.get('/wrapped/conflict', async () => { thrower(); });

        const raw = await call(s, '/raw/conflict');
        const wrapped = await call(s, '/wrapped/conflict');

        expect(raw.status).toBe(409);
        expect((await raw.json()).error.code).toBe('LOCK_CONFLICT');
        expect(raw.status).toBe(wrapped.status);
    });

    it('inherits the ValidationError shape-as-declaration limb', async () => {
        const s = server();
        // `resolveThrownHttpError` treats the validation SHAPE as a
        // declaration (#16545 recorded this as its widest limb), so a bare
        // ValidationError answers 400/VALIDATION_FAILED at BOTH doors rather
        // than the raw door inventing its own rule.
        const thrower = () => {
            throw Object.assign(new Error('name is required'), { name: 'ValidationError' });
        };
        s.getRawApp().get('/raw/invalid', () => { thrower(); });
        s.get('/wrapped/invalid', async () => { thrower(); });

        const raw = await call(s, '/raw/invalid');
        const wrapped = await call(s, '/wrapped/invalid');

        expect(raw.status).toBe(400);
        expect((await raw.json()).error.code).toBe('VALIDATION_FAILED');
        expect(raw.status).toBe(wrapped.status);
        expect((await wrapped.json()).error.code).toBe('VALIDATION_FAILED');
    });

    it('takes the fallback arm for an UNREGISTERED code — no code is minted at this door', async () => {
        const s = server();
        s.getRawApp().get('/raw/unregistered', () => {
            throw declared(503, 'MARKETPLACE_OFFLINE', 'the marketplace is down');
        });

        const res = await call(s, '/raw/unregistered');
        expect(res.status).toBe(500);
        expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
    });

    it('takes the fallback arm for a status ADR-0112 does not name', async () => {
        const s = server();
        s.getRawApp().get('/raw/teapot', () => {
            throw declared(418, 'VALIDATION_FAILED', 'short and stout');
        });

        const res = await call(s, '/raw/teapot');
        expect(res.status).toBe(500);
        expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
    });

    it('withholds a leaky message on a DECLARED 5xx, like every other door', async () => {
        const s = server();
        s.getRawApp().get('/raw/leak', () => {
            throw declared(
                500,
                'INTERNAL_ERROR',
                'SQLITE_ERROR: no such table: sys_user_prefs',
            );
        });

        const res = await call(s, '/raw/leak');
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error.code).toBe('INTERNAL_ERROR');
        expect(body.error.message).toBe('Internal server error');
        expect(JSON.stringify(body)).not.toContain('sys_user_prefs');
    });
});

describe('the seam reaches every way a raw consumer mounts', () => {
    it('covers a sub-app mounted through `mount()`', async () => {
        // `HonoServerPlugin` and the console SPA compose this way, so the seam
        // has to survive Hono's route-merge, not only a direct `getRawApp()`
        // registration.
        const s = server();
        const { Hono } = await import('hono');
        const sub = new Hono();
        sub.get('/boom', () => {
            throw declared(503, 'SERVICE_UNAVAILABLE', 'the sub-app refused');
        });
        s.mount('/sub', sub);

        const res = await call(s, '/sub/boom');
        expect(res.status).toBe(503);
        expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('covers a throw out of a `use()` middleware', async () => {
        // Recorded blast radius rather than a carve-out: the seam is the
        // transport's, so a middleware that throws stops answering
        // `text/plain` too. `use()` middleware is outside `getMountedRoutes()`
        // by the same contract clause as a raw mount.
        const s = server();
        s.installMiddlewareSeam();
        s.use(async () => {
            throw declared(503, 'SERVICE_UNAVAILABLE', 'the gate refused');
        });
        s.get('/behind-middleware', async (_req, res) => { res.json({ ok: true }); });

        const res = await call(s, '/behind-middleware');
        expect(res.status).toBe(503);
        expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
    });
});

describe("Hono's own declared-`Response` limb is preserved", () => {
    it('answers an HTTPException with the response IT declared, not a 500', async () => {
        // Hono's default handler honours `getResponse()` before falling back to
        // `text('Internal Server Error', 500)`. An `HTTPException` is a
        // framework-native refusal the producer DECLARED, so overriding it
        // would be this card's own defect with the roles reversed. Measured at
        // `7d350a46`: zero `HTTPException` producers in `packages/`, so this
        // pins preservation, not new behaviour.
        const s = server();
        s.getRawApp().get('/raw/http-exception', () => {
            throw new HTTPException(403, { message: 'no' });
        });

        const res = await call(s, '/raw/http-exception');
        expect(res.status).toBe(403);
        expect(await res.text()).toBe('no');
    });
});

describe('the escaped throw is DIAGNOSABLE, not only well-shaped', () => {
    const records: { level: string; message: string; error?: unknown; meta?: any }[] = [];
    const recordingLogger = () =>
        ({
            debug: () => {},
            info: () => {},
            warn: () => {},
            fatal: () => {},
            error: (message: string, error?: unknown, meta?: any) =>
                records.push({ level: 'error', message, error, meta }),
        }) as unknown as Logger;

    it('reports a raw-mount throw ONCE, at error, with method and path', async () => {
        records.length = 0;
        const s = server(recordingLogger());
        s.getRawApp().post('/raw/reported', () => {
            throw declared(503, 'SERVICE_UNAVAILABLE', 'the store is unreadable');
        });

        const res = await call(s, '/raw/reported', { method: 'POST' });
        expect(res.status).toBe(503);

        expect(records, 'an escaped raw-mount throw produced no error log').toHaveLength(1);
        expect(records[0].level).toBe('error');
        expect((records[0].error as Error).message).toBe('the store is unreadable');
        // Method and path only — never the body (credentials and PII sit there).
        expect(records[0].meta).toEqual({
            method: 'POST',
            path: '/raw/reported',
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
        });
    });

    it('does not double-report a WRAPPED throw — the two reporters are disjoint', async () => {
        records.length = 0;
        const s = server(recordingLogger());
        s.get('/wrapped/reported', async () => {
            throw declared(503, 'SERVICE_UNAVAILABLE', 'the store is unreadable');
        });

        expect((await call(s, '/wrapped/reported')).status).toBe(503);
        expect(records, 'the same throw was reported by both reporters').toHaveLength(1);
    });
});

describe('an observer is told the status that was actually SENT', () => {
    it('observes 503 for a declared raw throw, not the old hard-coded 500', async () => {
        // `HttpResponseObservation.status` is contracted as the status "of the
        // response as sent". The observation middleware defaulted a rejected
        // request to 500 because that was what Hono's error path always sent;
        // with the seam rendering a declared status, that default would newly
        // make the contract false — and `http_requests_total{status}` is armed
        // off this same seam, so an operator would be alerting on a 500 the
        // caller never received.
        const seen: HttpResponseObservation[] = [];
        const s = server();
        s.afterResponse((o) => seen.push(o));
        s.getRawApp().get('/raw/observed', () => {
            throw declared(503, 'SERVICE_UNAVAILABLE', 'the store is unreadable');
        });

        const res = await call(s, '/raw/observed');
        expect(res.status).toBe(503);

        expect(seen).toHaveLength(1);
        expect(seen[0].status).toBe(503);
        expect(seen[0].routePattern).toBe('/raw/observed');
    });

    it('still observes 500 for a throw that declared no envelope', async () => {
        const seen: HttpResponseObservation[] = [];
        const s = server();
        s.afterResponse((o) => seen.push(o));
        s.getRawApp().get('/raw/observed-plain', () => {
            throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
        });

        expect((await call(s, '/raw/observed-plain')).status).toBe(500);
        expect(seen).toHaveLength(1);
        expect(seen[0].status).toBe(500);
    });
});
