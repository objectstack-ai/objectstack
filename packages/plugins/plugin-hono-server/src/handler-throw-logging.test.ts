// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A throw that ESCAPES a `RouteHandler` must leave a diagnosis behind (#5848),
 * exercised through the real Hono app (`app.fetch`), never a mock.
 *
 * ## What was wrong
 *
 * `runHandler()`'s rejection path read `.catch((_err) => …)` — the parameter
 * name says it: the error was explicitly discarded. `wrap()` then answered
 * `c.json({ error: 'No response from handler' }, 500)`. Net effect on every
 * host using this adapter as its transport: a bare 500 whose body names no
 * cause, and **no log anywhere** — not even a stack.
 *
 * #4264 diagnosed exactly this code and its wording still holds, but its fix
 * added a `catch` to three datasource ROUTES; the seam itself was untouched,
 * so every route added since had to remember to re-wrap. `check-route-envelope.mjs`
 * structurally cannot see this class — it audits response WRITE points, and an
 * uncaught throw never writes one.
 *
 * ## What this file pins
 *
 *  1. the diagnosis exists, at `error`, once per escaped throw;
 *  2. it carries the ORIGINAL `message` and `stack` — the non-enumerable trap
 *     that turns a naively-serialized `Error` into `{}` (see `toLoggableError`);
 *  3. it carries enough request context (method + path) to locate the failure,
 *     and NOTHING from the body;
 *  4. the response is **byte-identical** to before. Folding the fallback body
 *     into a declared envelope is a separate, undecided contract question and
 *     was explicitly ruled OUT of #5848 — so the old bytes are pinned here, on
 *     purpose, to keep that decision from drifting in as a rider;
 *  5. a successful handler adds no log noise at all.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@objectstack/spec/contracts';

import { HonoHttpServer } from './adapter';

/** One captured log call, with the contract's `error` slot kept separate. */
interface LogRecord {
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    message: string;
    error?: unknown;
    meta?: Record<string, any>;
}

/**
 * A `Logger` that records instead of writing, keeping the `error(message,
 * error, meta)` slots distinct — the whole point is to prove the `Error` is
 * handed to the slot built for it rather than flattened into `meta`.
 */
function recordingLogger() {
    const records: LogRecord[] = [];
    const plain = (level: 'debug' | 'info' | 'warn') =>
        (message: string, meta?: Record<string, any>) => { records.push({ level, message, meta }); };
    const withError = (level: 'error' | 'fatal') =>
        (message: string, error?: unknown, meta?: Record<string, any>) => {
            records.push({ level, message, error, meta });
        };
    const logger: Logger = {
        debug: plain('debug'),
        info: plain('info'),
        warn: plain('warn'),
        error: withError('error'),
        fatal: withError('fatal'),
    };
    return { logger, records, errors: () => records.filter((r) => r.level === 'error') };
}

function serverWithLogger() {
    const server = new HonoHttpServer(0);
    const rec = recordingLogger();
    server.setLogger(rec.logger);
    return { server, ...rec };
}

const call = (server: HonoHttpServer, path: string, init?: RequestInit) =>
    server.getRawApp().fetch(new Request(`http://localhost${path}`, init));

/**
 * The exact bytes `wrap()` answers when a handler produced no response.
 *
 * The declared `BaseResponseSchema` refusal envelope since #9364 — it was the
 * bare `{"error":"No response from handler"}` (the pre-#3675 dialect) while
 * that conversion was still undecided. The MESSAGE is unchanged; what moved is
 * the shape around it and the ADR-0112 code beside it.
 */
const FALLBACK_BODY =
    '{"success":false,"error":{"code":"INTERNAL_ERROR","message":"No response from handler"}}';

describe('an escaped handler throw is reported', () => {
    it('logs the original Error — message AND stack — for an async rejection', async () => {
        const { server, errors } = serverWithLogger();
        const boom = new Error('datasource exploded');
        server.get('/api/v1/boom', async () => { throw boom; });

        const res = await call(server, '/api/v1/boom');
        expect(res.status).toBe(500);

        const [record, ...rest] = errors();
        expect(record, 'an escaped throw produced no error log').toBeDefined();
        expect(rest, 'the same throw was reported more than once').toEqual([]);

        // Handed to the contract's `Error` slot, not flattened into meta.
        expect(record!.error).toBe(boom);
        expect((record!.error as Error).message).toBe('datasource exploded');
        expect((record!.error as Error).stack).toContain('datasource exploded');

        // WHY that slot exists, demonstrated on this very error: `message` and
        // `stack` are non-enumerable, so an `Error` put in a structured meta
        // field serializes to `{}` — a log line that reports success and
        // carries nothing.
        expect(JSON.stringify({ err: boom })).toBe('{"err":{}}');
    });

    it('logs a SYNCHRONOUS throw the same way', async () => {
        // `runHandler` is `Promise.try`-shaped precisely so a sync throw and an
        // async rejection land on one path; the diagnosis must not depend on
        // whether the handler happened to be `async`.
        const { server, errors } = serverWithLogger();
        server.get('/api/v1/sync-boom', () => { throw new Error('sync exploded'); });

        expect((await call(server, '/api/v1/sync-boom')).status).toBe(500);
        expect((errors()[0]?.error as Error)?.message).toBe('sync exploded');
    });

    it('logs at `error`, never `warn`', async () => {
        // AGENTS.md "Degradation log levels": the "failure handed to the
        // CALLER" answer does not apply — the caller gets a 500 naming no
        // cause, no code and no message, so the log IS the only record.
        const { server, records } = serverWithLogger();
        server.get('/api/v1/level', async () => { throw new Error('x'); });

        await call(server, '/api/v1/level');
        expect(records.map((r) => r.level)).toEqual(['error']);
    });

    it('carries method + path, and nothing from the request body', async () => {
        const { server, errors } = serverWithLogger();
        server.post('/api/v1/records', async () => { throw new Error('write failed'); });

        await call(server, '/api/v1/records', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'hunter2', ssn: '123-45-6789' }),
        });

        const meta = errors()[0]!.meta!;
        expect(meta).toEqual({ method: 'POST', path: '/api/v1/records' });
        // Not merely "redacted" — the body never reaches the record at all.
        expect(JSON.stringify(meta)).not.toContain('hunter2');
        expect(JSON.stringify(meta)).not.toContain('123-45-6789');
    });
});

describe('non-Error throws keep their information', () => {
    it('describes a primitive throw instead of dropping it', async () => {
        const { server, errors } = serverWithLogger();
        server.get('/api/v1/string-throw', async () => { throw 'plain string boom'; });

        expect((await call(server, '/api/v1/string-throw')).status).toBe(500);
        const err = errors()[0]!.error as Error;
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain('plain string boom');
        // Labelled, so the synthesized stack is not read as the thrower's.
        expect(err.message).toContain('Non-Error value thrown');
    });

    it('rebuilds an error-like object that fails `instanceof` (cross-realm Error)', async () => {
        // This is the shape the trap actually bites on: an `Error` from another
        // realm (a `vm` context, a worker) is not `instanceof Error` here, and
        // its `message`/`stack` are still non-enumerable — spread it and you
        // get `{}` while believing you logged the cause.
        const { server, errors } = serverWithLogger();
        const crossRealm = Object.create(null) as Record<string, unknown>;
        Object.defineProperty(crossRealm, 'name', { value: 'TypeError', enumerable: false });
        Object.defineProperty(crossRealm, 'message', { value: 'x is not a function', enumerable: false });
        Object.defineProperty(crossRealm, 'stack', { value: 'TypeError: x is not a function\n    at foo (bar.js:1:1)', enumerable: false });
        expect(JSON.stringify(crossRealm), 'fixture is not the trap it claims to be').toBe('{}');

        server.get('/api/v1/cross-realm', async () => { throw crossRealm; });
        await call(server, '/api/v1/cross-realm');

        const err = errors()[0]!.error as Error;
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('TypeError');
        expect(err.message).toBe('x is not a function');
        expect(err.stack).toContain('at foo (bar.js:1:1)');
    });

    it('survives a throw that cannot be JSON-serialized', async () => {
        const { server, errors } = serverWithLogger();
        const circular: any = { code: 1 };
        circular.self = circular;

        server.get('/api/v1/circular', async () => { throw circular; });
        expect((await call(server, '/api/v1/circular')).status).toBe(500);
        expect(errors()[0]!.error).toBeInstanceOf(Error);
    });
});

describe('the fallback (notFound) seam reports too', () => {
    it('logs a throwing fallback handler', async () => {
        // Same seam, second caller: `installNotFoundSeam` answers a failed
        // fallback with its own 500, which likewise names no cause.
        const { server, errors } = serverWithLogger();
        server.setFallbackHandler(() => { throw new Error('fallback exploded'); });

        const res = await call(server, '/nothing/here');
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Fallback handler failed' },
        });
        expect((errors()[0]!.error as Error).message).toBe('fallback exploded');
        expect(errors()[0]!.meta).toEqual({ method: 'GET', path: '/nothing/here' });
    });
});

describe('the response shape is the declared envelope (decided by #9364)', () => {
    it('answers the byte-identical enveloped 500 body', async () => {
        // #5848 deliberately left this body alone — folding it into a declared
        // envelope was a live wire change and an undecided contract question,
        // so it was pinned here to stop the conversion arriving as a rider on
        // a logging fix. #9364 is where that question was answered; the pin
        // survives with its new bytes, and still holds the shape against an
        // unrelated change drifting it again.
        const { server } = serverWithLogger();
        server.get('/api/v1/shape', async () => { throw new Error('boom'); });

        const res = await call(server, '/api/v1/shape');
        expect(res.status).toBe(500);
        expect(await res.text()).toBe(FALLBACK_BODY);
    });

    it('a handler that simply writes nothing is unaffected', async () => {
        // Not a throw — the OTHER way to reach the same fallback body. It has
        // no error to report, so it must stay silent.
        const { server, records } = serverWithLogger();
        server.get('/api/v1/silent', async () => { /* writes nothing */ });

        const res = await call(server, '/api/v1/silent');
        expect(res.status).toBe(500);
        expect(await res.text()).toBe(FALLBACK_BODY);
        expect(records).toEqual([]);
    });
});

describe('no new noise on the happy path', () => {
    it('logs nothing at all when handlers succeed', async () => {
        const { server, records } = serverWithLogger();
        server.get('/api/v1/ok', (_req, res) => { res.status(200); res.json({ ok: true }); });
        server.post('/api/v1/ok', (_req, res) => { res.status(201); res.json({ created: true }); });

        expect(await (await call(server, '/api/v1/ok')).json()).toEqual({ ok: true });
        await call(server, '/api/v1/ok', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ a: 1 }),
        });

        expect(records).toEqual([]);
    });

    it('stays silent for a 404 and a 405', async () => {
        const { server, records } = serverWithLogger();
        server.put('/api/v1/only-put', (_req, res) => { res.status(200); res.json({ ok: true }); });
        server.installNotFoundSeam();

        expect((await call(server, '/api/v1/missing')).status).toBe(404);
        expect((await call(server, '/api/v1/only-put')).status).toBe(405);
        expect(records).toEqual([]);
    });
});

describe('a host that wires nothing is still not silent', () => {
    it('reports through the default logger (the bare-adapter path)', async () => {
        // The motivating production report came from a control plane built on
        // the BARE adapter — no plugin, so no `ctx.logger`. A no-op default
        // would have reproduced #5848 exactly for that host.
        const server = new HonoHttpServer(0);
        server.get('/api/v1/bare', async () => { throw new Error('bare adapter boom'); });

        const written: string[] = [];
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
            written.push(String(chunk));
            return true;
        });
        try {
            expect((await call(server, '/api/v1/bare')).status).toBe(500);
        } finally {
            spy.mockRestore();
        }

        const output = written.join('');
        expect(output).toContain('bare adapter boom');
        expect(output).toContain('ERROR');
        // The stack, not just the message — that is the half that disappears
        // when an `Error` is serialized naively.
        expect(output).toContain('handler-throw-logging.test.ts');
    });

    it('a logger that itself throws cannot turn the 500 into something worse', async () => {
        const server = new HonoHttpServer(0);
        server.setLogger({
            debug() {}, info() {}, warn() {},
            error() { throw new Error('log sink is down'); },
        } as Logger);
        server.get('/api/v1/bad-logger', async () => { throw new Error('boom'); });

        const res = await call(server, '/api/v1/bad-logger');
        expect(res.status).toBe(500);
        expect(await res.text()).toBe(FALLBACK_BODY);
    });
});
