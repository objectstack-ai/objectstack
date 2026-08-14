// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5462] `sys_metadata` being unavailable is an infrastructure fault, not a
// missing object.
//
// `mapDataError`'s `looksLikeUnknownObject` asked only whether the message
// contained `no such table` / `relation … does not exist` — never WHICH table
// was missing. A business object that was never registered and the metadata
// plane collapsing entirely are the same two words to that regex, and they call
// for opposite responses: the first says "check the object name you typed", the
// second says "page whoever owns the database".
//
// The second failure was quieter and worse. 404 is an `isExpectedDataStatus`,
// so `handleRouteError` printed no `[REST] Unhandled error`, and the raw driver
// error — the only evidence the metadata store was gone — reached neither the
// client (correctly) nor the log (a blind spot). A total outage of the metadata
// plane left the server with nothing to show for it.
//
// #5437/#5464 closed the sibling half of this: a producer that DECLARES a 5xx
// now has its message withheld and logged. It deliberately did not touch the
// heuristic, and the path here never reaches that branch — `saveMetaItem`
// rethrows the driver's own `Error` with no `status` and no `code`, so the
// message text is all `mapDataError` has to go on. That is why this needed its
// own fix rather than falling out of the last one.
//
// ---------------------------------------------------------------------------
// The rule this file pins
// ---------------------------------------------------------------------------
// A missing-relation message is an unknown-object verdict ONLY when the
// relation it names is the object the request named. Attribution needs both
// halves — a request object and an extractable relation name — and Prime
// Directive #6 (object name IS table name, no `tableName` mapping) is what
// makes the comparison sound rather than a guess. Anything unattributable is a
// sanitised, logged 500; per the direction on this issue the safe way to be
// wrong is loud, never silently 404.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Restoring the old expression (`looksLikeUnknownObject` starting from the
// three missing-relation limbs unconditionally, and no attribution branch) is
// the ordinary RED direction, not one of the inverted families:
//
//   § 1 + § 2 (the fault cases)      RED   — they assert 500 + a log line on
//                                            responses that revert to a silent
//                                            404 OBJECT_NOT_FOUND
//   § 3 (the genuine unknown object) GREEN — `no such table: ghost` with
//                                            `object: 'ghost'` matched the old
//                                            heuristic and matches the new one
//   § 4 (#5464 / #5436 pins)         GREEN — untouched band; those errors carry
//                                            an explicit `status` and never
//                                            reach the heuristic at all
//
// Measured after predicting it; the run is quoted in the PR.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { mapDataError, RestServer } from './rest-server';

const META_ITEM = '/api/v1/meta/:type/:name';
const OBJ_BATCH = '/api/v1/data/:object/batch';

/** The driver line a missing `sys_metadata` produces on each dialect. */
const SQLITE_NO_TABLE = 'SQLITE_ERROR: no such table: sys_metadata';
const PG_NO_RELATION = 'relation "sys_metadata" does not exist';

// ---------------------------------------------------------------------------
// Harness — #5464's, reused verbatim (the issue was reproduced on it)
// ---------------------------------------------------------------------------

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

function mountRest(protocol: any) {
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false, enableBatch: true } } as any,
    );
    // [#6603] this route now demands `manage_metadata` — an authoring capability, not just a session.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    return rest;
}

async function callRoute(rest: any, method: string, path: string, req: Record<string, unknown> = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    const res = makeRes();
    await route.handler({ method, params: {}, query: {}, body: {}, headers: {}, ...req }, res);
    return res;
}

/** Every access fails the way a missing table does — the outage under test. */
function failingDriver(dbError: string) {
    const boom = () => { throw new Error(dbError); };
    const driver: any = {
        name: 'memory-broken', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find() { boom(); }, async findOne() { boom(); },
        async create() { boom(); }, async update() { boom(); }, async delete() { boom(); },
        async upsert() { boom(); }, async count() { boom(); },
        async bulkCreate() { boom(); }, async bulkUpdate() { boom(); }, async bulkDelete() { boom(); },
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return driver;
}

async function bootRealProtocol(dbError: string) {
    const engine = new ObjectQL();
    engine.registerDriver(failingDriver(dbError), true);
    await engine.init();
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    return mountRest(protocol as any);
}

/**
 * A spec-valid object body, so the PUT reaches persistence rather than a 422.
 * [#8310] Its OWD is authored: the runtime object door refuses an unauthored
 * `sharingModel` (`security-owd-unset`).
 */
const ACCT = { name: 'acct', label: 'Acct', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } };

let logged: unknown[][] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    logged = [];
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args); });
});
afterEach(() => { spy.mockRestore(); });

/** Did ANY log line carry the given text (in its message or its arguments)? */
function loggedText(needle: string): boolean {
    return logged.some((args) => args.some((a) => {
        if (a instanceof Error) return a.message.includes(needle);
        return typeof a === 'string' && a.includes(needle);
    }));
}

// ---------------------------------------------------------------------------
// 1. The reported repro, walked in process on the real engine + protocol
// ---------------------------------------------------------------------------
//
// Nothing is hand-built here: a REAL `ObjectQL`, a REAL
// `ObjectStackProtocolImplementation`, and the route a client actually calls.
// The error `saveMetaItem` lets escape is the driver's own `Error` — verified
// below to carry NEITHER `status` NOR `code`, which is precisely why #5464's
// declared-5xx branch cannot see it and the text heuristic judged it instead.

describe('[#5462] sys_metadata unavailable is a fault, not a missing object', () => {
    it('PUT /meta/object/acct answers 5xx, not 404 OBJECT_NOT_FOUND', async () => {
        const rest = await bootRealProtocol(SQLITE_NO_TABLE);

        const res = await callRoute(rest, 'PUT', META_ITEM, {
            params: { type: 'object', name: 'acct' }, body: ACCT,
        });

        // The reported wire answer, gone: the client is no longer told to go
        // check the spelling of an object name.
        expect(res.statusCode).toBe(500);
        expect(res.body.code).not.toBe('OBJECT_NOT_FOUND');
        expect(String(res.body.error)).not.toContain('not registered');
        expect(String(res.body.error)).not.toContain('Object not found');
    }, 60_000);

    it('the fault leaves exactly one log line, carrying the driver text', async () => {
        // The other half of the defect, and the more dangerous one: 404 is an
        // `isExpectedDataStatus`, so the whole outage used to leave the server
        // with NOTHING. Reproduced as `logged.length === 0` before this change.
        const rest = await bootRealProtocol(SQLITE_NO_TABLE);

        await callRoute(rest, 'PUT', META_ITEM, {
            params: { type: 'object', name: 'acct' }, body: ACCT,
        });

        expect(logged.length).toBe(1);
        expect(loggedText('no such table')).toBe(true);
        expect(loggedText('sys_metadata')).toBe(true);
    }, 60_000);

    it('the driver text still does not reach the client', async () => {
        // Becoming loud must not become leaky: this is the same boundary #3867
        // and #5437 defend, so the 500 is the sanitised envelope, not the raw
        // driver line wearing a new status.
        const rest = await bootRealProtocol(SQLITE_NO_TABLE);

        const res = await callRoute(rest, 'PUT', META_ITEM, {
            params: { type: 'object', name: 'acct' }, body: ACCT,
        });

        const wire = JSON.stringify(res.body);
        expect(wire).not.toContain('sys_metadata');
        expect(wire).not.toContain('no such table');
        expect(wire).not.toContain('SQLITE_ERROR');
        expect(res.body).toEqual({ error: 'Internal data error', code: 'DATABASE_ERROR' });
    }, 60_000);

    it('Postgres phrasing lands identically — this is not a SQLite-shaped guard', async () => {
        // `relation "sys_metadata" does not exist` is the limb the issue named
        // second, and it is also the one that could NOT have been caught by
        // falling through to `looksLikeInternalErrorLeak`: it contains no
        // `sqlite_`, no SQLSTATE, no statement prefix and no constraint dump,
        // so the terminal fallback would have shipped it verbatim as a 400.
        // ([#5489] that fallback is a sanitised 500 now, so today the same
        // message would at least land in the right band — but un-attributed,
        // as `INTERNAL_ERROR` rather than this branch's `DATABASE_ERROR`. The
        // limb below is what makes the verdict say "database".)
        const rest = await bootRealProtocol(PG_NO_RELATION);

        const res = await callRoute(rest, 'PUT', META_ITEM, {
            params: { type: 'object', name: 'acct' }, body: ACCT,
        });

        expect(res.statusCode).toBe(500);
        expect(res.body.code).toBe('DATABASE_ERROR');
        expect(JSON.stringify(res.body)).not.toContain('does not exist');
        expect(loggedText('does not exist')).toBe(true);
    }, 60_000);

    it('the escaping error really does carry no status and no code (premise guard)', async () => {
        // If `saveMetaItem` ever starts declaring a status, this path moves to
        // #5464's branch and the cases above stop proving anything about the
        // heuristic. Pinned so that migration is a red test, not a silent
        // change of meaning.
        const engine = new ObjectQL();
        engine.registerDriver(failingDriver(SQLITE_NO_TABLE), true);
        await engine.init();
        const protocol: any = new ObjectStackProtocolImplementation(engine as any);

        let seen: any;
        const traced = new Proxy(protocol, {
            get(target, key) {
                const value = (target as any)[key];
                if (key !== 'saveMetaItem' || typeof value !== 'function') return value;
                return (...args: any[]) => (value.apply(target, args) as Promise<unknown>)
                    .catch((e: unknown) => { seen = e; throw e; });
            },
        });

        await callRoute(mountRest(traced), 'PUT', META_ITEM, {
            params: { type: 'object', name: 'acct' }, body: ACCT,
        });

        expect(seen).toBeInstanceOf(Error);
        expect(seen.message).toContain('no such table: sys_metadata');
        expect(seen.status).toBeUndefined();
        expect(seen.code).toBeUndefined();
    }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. The rule at the unit boundary
// ---------------------------------------------------------------------------

const driverError = (message: string) => Object.assign(new Error(message), { code: 'SQLITE_ERROR' });

describe('[#5462] a missing relation is attributed, or it is a fault', () => {
    it('no request object at all → fault (every metadata / UI / discovery route)', () => {
        // These routes call `handleRouteError(res, error)` with no object, so
        // there is nothing to attribute the missing table to. This is the exact
        // shape the issue was raised on.
        for (const message of [SQLITE_NO_TABLE, PG_NO_RELATION]) {
            const r = mapDataError(driverError(message));
            expect(r.status, message).toBe(500);
            expect(r.body.code, message).toBe('DATABASE_ERROR');
        }
    });

    it('a DIFFERENT table than the requested object → fault', () => {
        // The data-route form: the caller asked for `acct`, which exists; what
        // is missing is the metadata plane underneath it.
        const r = mapDataError(driverError(SQLITE_NO_TABLE), 'acct');
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('DATABASE_ERROR');
    });

    it('an auxiliary table of the requested object is still a fault, not a 404', () => {
        // `acct` is registered and its own table is fine; a join/aux table has
        // drifted. Answering "Object 'acct' is not registered" would be a lie
        // about an object the caller can see working elsewhere.
        const r = mapDataError(driverError('no such table: acct_shares'), 'acct');
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('DATABASE_ERROR');
    });

    it('an empty-string object cannot be attributed to → fault', () => {
        // Several routes pass `String(req.params?.object || '')`. An empty
        // string is not a name; it must not act as a wildcard match.
        const r = mapDataError(driverError(SQLITE_NO_TABLE), '');
        expect(r.status).toBe(500);
    });

    it('a phrasing that names no relation cannot be attributed to → fault', () => {
        // `table not found` carries no name on any dialect this repo produces
        // (nothing in the repo produces it at all — it is a third-party-driver
        // net). Unattributable, so it takes the loud side by construction.
        const r = mapDataError(driverError('table not found'), 'acct');
        expect(r.status).toBe(500);
        expect(r.body.code).toBe('DATABASE_ERROR');
    });

    it('a qualified relation name still attributes: schema prefixes are stripped', () => {
        // Prime Directive #6 — object name IS table name — is what makes the
        // comparison sound; the schema/catalog qualifier is not part of it.
        for (const message of [
            'no such table: main.acct',
            'relation "public.acct" does not exist',
            'SQLITE_ERROR: no such table: "acct"',
        ]) {
            const r = mapDataError(driverError(message), 'acct');
            expect(r.status, message).toBe(404);
            expect(r.body.code, message).toBe('OBJECT_NOT_FOUND');
        }
    });

    it('attribution is case-insensitive, matching object-name resolution', () => {
        const r = mapDataError(driverError('no such table: ACCT'), 'acct');
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('OBJECT_NOT_FOUND');
    });
});

// ---------------------------------------------------------------------------
// 3. The genuine unknown object must stay a quiet 404 (③)
// ---------------------------------------------------------------------------
//
// The half of the semantics this change is not allowed to break. Both producers
// of the verdict are checked, because #3770's whole point is that they land on
// ONE wire envelope.

describe('[#5462] a real unknown object is still 404 OBJECT_NOT_FOUND, still silent', () => {
    const registryGate = (object: string) =>
        Object.assign(new Error(`Object '${object}' not found`), {
            code: 'OBJECT_NOT_FOUND', status: 404, object,
        });

    it('the driver limb: the missing table IS the object asked for', () => {
        const r = mapDataError(driverError('no such table: ghost'), 'ghost');
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('OBJECT_NOT_FOUND');
        expect(r.body.error).toBe("Object 'ghost' is not registered");
    });

    it('gate and driver still produce the identical envelope (#3770)', () => {
        expect(mapDataError(registryGate('ghost'), 'ghost'))
            .toEqual(mapDataError(driverError('no such table: ghost'), 'ghost'));
    });

    it('the Postgres spelling of the same condition also stays 404', () => {
        const r = mapDataError(driverError('relation "ghost" does not exist'), 'ghost');
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('OBJECT_NOT_FOUND');
    });

    it('the engine-authored limbs are untouched', () => {
        // Our own vocabulary about a named object — these mean what they say,
        // so they keep the old reading. Only the DATABASE-authored limbs, which
        // cannot know which table the caller wanted, needed attribution.
        for (const message of [
            "[ObjectQL] No driver available for object 'ghost'",
            'unknown object ghost',
            'object not found',
        ]) {
            const r = mapDataError(driverError(message), 'ghost');
            expect(r.status, message).toBe(404);
            expect(r.body.code, message).toBe('OBJECT_NOT_FOUND');
        }
    });

    it('404 stays an expected status: an unknown object logs nothing', async () => {
        // "Do not make the real 404 loud" is a requirement in its own right —
        // an unknown object is a client mistake and must not print a stack
        // trace per request (#4886).
        const rest = mountRest({
            getDiscovery: vi.fn().mockResolvedValue({
                version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
            }),
            getMetaTypes: vi.fn().mockResolvedValue([]),
            findData: vi.fn().mockRejectedValue(driverError('no such table: ghost')),
        });

        const res = await callRoute(rest, 'GET', '/api/v1/data/:object', { params: { object: 'ghost' } });

        expect(res.statusCode).toBe(404);
        expect(res.body.code).toBe('OBJECT_NOT_FOUND');
        expect(logged).toHaveLength(0);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// 4. #5464 and #5436 must not regress (③, the declared-status band)
// ---------------------------------------------------------------------------
//
// Those errors carry an explicit `status` and are answered by
// `resolveErrorResponse` before the heuristic is reached at all — so the claim
// under test is that this change did not disturb that ordering. Full coverage
// stays in `rest-5xx-message-sanitization.test.ts` /
// `rest-4xx-message-truncation.test.ts`.

describe('[#5462] the declared-status band is untouched', () => {
    // The specimen used to be `saveMetaItem`'s `OVERLAY_PERSISTENCE_FAILED`
    // 500. #5264 deleted that producer and #5783 unregistered the code, so the
    // case was pinning a `code` nothing could emit — a #4984-family phantom.
    // Re-coded onto `batchData`'s atomic refusal, which is live
    // (`metadata-protocol`'s `batchData`: `status = 501`, `code =
    // 'NOT_IMPLEMENTED'`) and exercises this ordering harder than the old one
    // did: it does not merely CONTAIN a heuristic trigger, it is re-labelled by
    // the same last limb this file was written about — the message quotes the
    // request's own object name and says "cannot", so `looksLikeUnknownObject`
    // claims it. The `mapDataError` call below is that claim, measured, and it
    // is what makes the route assertion non-vacuous.
    it('a declared 5xx that the heuristic WOULD claim keeps its status and its code', async () => {
        const err = Object.assign(
            new Error(
                `Atomic batch on 'showcase_account' requires engine transaction support; this runtime cannot roll back. `
                + `Retry without options.atomic, or probe capabilities.transactionalBatch on /discovery first.`,
            ),
            { code: 'NOT_IMPLEMENTED', status: 501 },
        );

        // Direction, established first: strip the declared status and this text
        // IS an unknown-object verdict to `mapDataError`. That is the answer
        // `resolveErrorResponse` has to get in front of.
        const { status, code, ...rest501 } = err as any;
        const fallThrough = mapDataError(Object.assign(new Error(err.message), rest501), 'showcase_account');
        expect(fallThrough.status).toBe(404);
        expect(fallThrough.body.code).toBe('OBJECT_NOT_FOUND');

        const rest = mountRest({
            getDiscovery: vi.fn().mockResolvedValue({
                version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
            }),
            getMetaTypes: vi.fn().mockResolvedValue([]),
            getMetaItems: vi.fn().mockResolvedValue([{ name: 'showcase_account' }]),
            batchData: vi.fn().mockRejectedValue(err),
        });

        const res = await callRoute(rest, 'POST', OBJ_BATCH, {
            params: { object: 'showcase_account' },
            body: { operation: 'update', records: [{ id: 'r1', data: { name: 'r1' } }] },
        });

        expect(res.statusCode).toBe(501);
        expect(res.body.code).toBe('NOT_IMPLEMENTED');
        expect(res.body.error).toBe('Internal server error');
    }, 60_000);

    it('a declared 4xx is still verbatim even when its text trips the relation limbs', () => {
        const msg = 'no such table: pick one that exists';
        const r = mapDataError(Object.assign(new Error(msg), { status: 400, code: 'INVALID_QUERY' }), 'acct');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe(msg);
    });

    it('the SQL-leak branch below still answers with the same fault envelope', () => {
        // Routed through one helper by this change, so the two spellings cannot
        // drift. `UNIQUE constraint` keeps its own 409 above it, untouched.
        const leak = mapDataError(driverError('SQLITE_IOERR: disk I/O error'), 'acct');
        expect(leak).toEqual({ status: 500, body: { error: 'Internal data error', code: 'DATABASE_ERROR' } });

        const unique = mapDataError(driverError('UNIQUE constraint failed: acct.name'), 'acct');
        expect(unique.status).toBe(409);
        expect(unique.body.code).toBe('UNIQUE_VIOLATION');
    });

    it('the column-level branches still win over the relation limbs', () => {
        // Postgres spells an unknown column with `relation … does not exist`
        // inside it. That branch is matched earlier and must stay that way, or
        // a fixable client mistake would become a 500.
        const r = mapDataError(
            driverError('column "label" of relation "acct" does not exist'), 'acct',
        );
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('INVALID_FIELD');
        expect(r.body.field).toBe('label');
    });
});

// ---------------------------------------------------------------------------
// 5. [#8264] The Postgres limb is anchored on the quoted template — both
//    decision paths this one const feeds
// ---------------------------------------------------------------------------
//
// `looksLikeMissingRelation` used to read `relation` and `does not exist`
// anywhere in the message, not necessarily the same sentence, so ordinary
// business prose using both words matched — `error-leak.test.ts` pins the
// identical negative case (`'This relation does not exist in the diagram'`)
// for the shared #8132 leak predicate this heuristic was never wired to.
// This section pins the same anchor here, for BOTH of this file's readers of
// the const: the 500 gate right where it is defined, and the
// `looksLikeUnknownObject` 404 limb a few lines below it.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Restoring the old `(lower.includes('relation') && lower.includes('does not
// exist'))` conjunction:
//
//   §5a (decision 1, the 500 gate)   RED — the business message reverts to
//                                          `DATABASE_ERROR`/500 instead of the
//                                          generic terminal `INTERNAL_ERROR`
//   §5b (decision 2, the 404 limb)   RED — the crafted unattributed-but-
//                                          word-matching message reverts to a
//                                          SILENT 404 `OBJECT_NOT_FOUND`
//   §5c/§5d (real driver phrasings)  GREEN — untouched; every case here is
//                                          already quoted, matching both the
//                                          old and the new predicate
//
// Both are the ordinary RED direction, not one of the inverted families.
// Measured after predicting it; the run is quoted in the PR.

describe('[#8264] anchored on the driver quoted template, not a bare conjunction', () => {
    it('§5a decision 1 (the 500 gate): business prose using both words is no longer DATA_STORE_FAULT', () => {
        // The card's own counter-example. No `object`, so it could never be
        // attributed either way — the fixed predicate simply stops calling it
        // a missing-relation condition at all, and it falls through to the
        // generic terminal fault instead of the DATABASE-flavoured one.
        const r = mapDataError(driverError('This relation does not exist in the diagram'));
        expect(r.status).toBe(500);
        expect(r.body.code).not.toBe('DATABASE_ERROR');
        expect(r.body.code).toBe('INTERNAL_ERROR');
    });

    it('§5a holds with an object present too, and does not spill into the 404 limb either', () => {
        const r = mapDataError(driverError('This relation does not exist in the diagram'), 'diagram');
        expect(r.body.code).not.toBe('DATABASE_ERROR');
        expect(r.body.code).not.toBe('OBJECT_NOT_FOUND');
    });

    it('§5b decision 2 (the 404 limb): an unquoted "relation <name> does not exist" no longer silently 404s', () => {
        // Crafted to isolate decision 2, which the card's own example cannot
        // reach: `missingRelationIsObject`'s Postgres branch tolerates
        // UNQUOTED names (it answers a different, narrower question — which
        // relation, once one is already suspected), so it still extracts
        // `acct` and matches it to the object. Under the OLD predicate this
        // fell through to the `looksLikeMissingRelation` OR-limb of
        // `looksLikeUnknownObject` and silently answered 404 — the exact
        // second consequence the card's own text never measured.
        const r = mapDataError(driverError('Sorry, relation acct does not exist in our records'), 'acct');
        expect(r.status).not.toBe(404);
        expect(r.body.code).not.toBe('OBJECT_NOT_FOUND');
    });

    it('§5c quoted forms — every quote style Postgres could use — still trip the 500 gate', () => {
        for (const quote of ['"', "'", '`']) {
            const msg = `relation ${quote}sys_metadata${quote} does not exist`;
            const r = mapDataError(driverError(msg));
            expect(r.status, msg).toBe(500);
            expect(r.body.code, msg).toBe('DATABASE_ERROR');
        }
    });

    it('§5d the quoted form still attributes to 404 when the relation IS the object — decision 2, real case, unchanged', () => {
        const r = mapDataError(driverError('relation "ghost" does not exist'), 'ghost');
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('OBJECT_NOT_FOUND');
    });
});
