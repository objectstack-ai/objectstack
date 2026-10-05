// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `searchAll` skips an object the caller may not READ, instead of failing the
 * whole search.
 *
 * The REST search door checks authentication only. Each swept object reached
 * `engine.find`, whose security middleware refuses an object the caller holds
 * no read grant on — and that refusal propagated out of the sweep, so a member
 * whose scope included ANY unreadable object got `403 PERMISSION_DENIED` for
 * the whole request, whatever the query (the console palette then showed
 * "No results found.").
 *
 * The sweep now asks the `security` service's `canReadObject` — the
 * middleware's own read gate — before it queries an object, and skips one it
 * refuses. What these pins hold:
 *
 *   - a mixed scope answers the readable objects' hits, and the unreadable
 *     object is never queried, never named, never counted;
 *   - an explicit `objects=` naming an unreadable object answers exactly as
 *     one naming an object that does not exist;
 *   - nothing about the skipped object's rows can shape the answer — it is
 *     identical whether or not its rows would have matched;
 *   - an all-access caller's answer is unchanged;
 *   - every other failure still fails the request: a read error on a readable
 *     object, and an admission check that itself throws;
 *   - no context means no pre-filter (the reads pose no principal).
 *
 * The engine double here stands in for the middleware: it THROWS the typed
 * denial for an object the fake security service refuses, so a sweep that
 * stopped consulting `canReadObject` turns these pins red with that 403.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

interface FixtureObject {
    name: string;
    label: string;
    fields: Record<string, { name: string; label: string; type: string }>;
}

const objectFixture = (name: string): FixtureObject => ({
    name,
    label: name,
    fields: { name: { name: 'name', label: 'Name', type: 'text' } },
});

function fixtureRegistry(objects: FixtureObject[]) {
    return {
        getObject: (n: string) => objects.find((o) => o.name === n),
        getAllObjects: () => objects,
        getItem: () => undefined,
        listItems: () => [],
        applyNavContributions: (x: unknown) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
        getPackage: () => undefined,
    };
}

/** The engine middleware's typed object-level denial, as `PermissionDeniedError` carries it. */
const objectReadDenied = () =>
    Object.assign(new Error('You do not have permission to perform this action.'), {
        name: 'PermissionDeniedError',
        code: 'PERMISSION_DENIED',
        status: 403,
        statusCode: 403,
    });

const acct = objectFixture('acct');
const lead = objectFixture('lead');
const secret = objectFixture('secret_ledger');

const ROWS: Record<string, Array<Record<string, unknown>>> = {
    acct: [{ id: 'a1', name: 'Acme' }],
    lead: [{ id: 'l1', name: 'Acme Lead' }],
    secret_ledger: [{ id: 's1', name: 'Acme Secret' }],
};

const MEMBER = { userId: 'usr_member', tenantId: 'org_1' };

/**
 * An engine whose `find` enforces `readable` the way the middleware does
 * (typed throw for anything else), and a security service answering the same
 * set. `rows` lets a case vary what the unreadable object WOULD hold.
 */
function harness(opts: {
    readable: Set<string> | 'all';
    withSecurity?: boolean;
    rows?: Record<string, Array<Record<string, unknown>>>;
    canReadObject?: (object: string, context?: unknown) => Promise<boolean>;
    failRead?: { object: string; error: unknown };
}) {
    const rows = opts.rows ?? ROWS;
    const readCalls: string[] = [];
    const admits = (o: string) => opts.readable === 'all' || opts.readable.has(o);
    const engine = {
        registry: fixtureRegistry([acct, lead, secret]),
        find: vi.fn(async (object: string) => {
            if (object === 'sys_metadata') return [];
            readCalls.push(object);
            if (!admits(object)) throw objectReadDenied();
            if (opts.failRead && opts.failRead.object === object) throw opts.failRead.error;
            return rows[object] ?? [];
        }),
        findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
            assertEngineFindOnePredicate(object, query);
            return null;
        }),
    };
    const canReadObject = vi.fn(opts.canReadObject ?? (async (o: string) => admits(o)));
    const services = new Map<string, unknown>();
    if (opts.withSecurity !== false) services.set('security', { canReadObject });
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services as Map<string, any>);
    return { protocol, readCalls, canReadObject };
}

async function rejection(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
    let caught: unknown;
    let didResolve = false;
    try {
        await run();
        didResolve = true;
    } catch (e) {
        caught = e;
    }
    expect(didResolve, 'expected a rejection, but the call resolved').toBe(false);
    return caught as Record<string, unknown>;
}

describe('searchAll — an object the caller may not read is skipped, not fatal', () => {
    it('control: without the pre-filter the middleware denial fails the whole search with 403', async () => {
        // The defect, reproduced on this harness: no security service to ask,
        // so the sweep reaches `find` on `lead` and the typed denial escapes.
        const { protocol } = harness({ readable: new Set(['acct']), withSecurity: false });
        const caught = await rejection(() => protocol.searchAll({ q: 'Acme', context: MEMBER }));
        expect(caught.code).toBe('PERMISSION_DENIED');
        expect(caught.status).toBe(403);
    });

    it('a mixed scope answers the readable objects and never queries, names or counts the rest', async () => {
        const { protocol, readCalls, canReadObject } = harness({ readable: new Set(['acct']) });

        const result = await protocol.searchAll({ q: 'Acme', context: MEMBER });

        expect(result.hits.map((h) => [h.object, h.id])).toEqual([['acct', 'a1']]);
        expect(result.totalObjects).toBe(1);
        expect(result.totalHits).toBe(1);
        expect(result.truncated).toBe(false);
        // Never queried — so nothing about its rows can reach the answer.
        expect(readCalls).toEqual(['acct']);
        // Asked with the caller's own context, for every swept object.
        expect(canReadObject.mock.calls).toEqual([
            ['acct', MEMBER],
            ['lead', MEMBER],
            ['secret_ledger', MEMBER],
        ]);
        // Never named, anywhere in the response.
        const wire = JSON.stringify(result);
        expect(wire).not.toContain('lead');
        expect(wire).not.toContain('secret_ledger');
        expect(Object.keys(result).sort()).toEqual(
            ['hits', 'pages', 'query', 'totalHits', 'totalObjects', 'truncated'],
        );
    });

    it('the answer does not depend on what a skipped object holds', async () => {
        const matching = harness({ readable: new Set(['acct']) });
        const empty = harness({
            readable: new Set(['acct']),
            rows: { acct: ROWS.acct, lead: [], secret_ledger: [] },
        });

        const a = await matching.protocol.searchAll({ q: 'Acme', context: MEMBER });
        const b = await empty.protocol.searchAll({ q: 'Acme', context: MEMBER });

        expect(a).toEqual(b);
    });

    it('an explicit objects= naming an unreadable object answers like one naming no such object', async () => {
        const { protocol, readCalls } = harness({ readable: new Set(['acct']) });

        const mixed = await protocol.searchAll({ q: 'Acme', objects: ['acct', 'secret_ledger'], context: MEMBER });
        expect(mixed.hits.map((h) => h.object)).toEqual(['acct']);
        expect(mixed.totalObjects).toBe(1);
        expect(JSON.stringify(mixed)).not.toContain('secret_ledger');

        const unreadable = await protocol.searchAll({ q: 'Acme', objects: ['secret_ledger'], context: MEMBER });
        const nonexistent = await protocol.searchAll({ q: 'Acme', objects: ['no_such_object'], context: MEMBER });
        expect(unreadable).toEqual(nonexistent);
        expect(unreadable).toEqual({
            query: 'Acme', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false,
        });
        expect(readCalls).toEqual(['acct']);
    });

    it('an all-access caller gets exactly what the sweep answered without a security service', async () => {
        const admin = harness({ readable: 'all' });
        const bare = harness({ readable: 'all', withSecurity: false });

        const withService = await admin.protocol.searchAll({ q: 'Acme', context: { userId: 'usr_admin' } });
        const without = await bare.protocol.searchAll({ q: 'Acme', context: { userId: 'usr_admin' } });

        expect(withService).toEqual(without);
        expect(withService.hits.map((h) => h.object)).toEqual(['acct', 'lead', 'secret_ledger']);
        expect(withService.totalObjects).toBe(3);
        expect(admin.readCalls).toEqual(['acct', 'lead', 'secret_ledger']);
    });

    it('a read failure on a READABLE object still fails the search, envelope intact', async () => {
        const injected = Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
        const { protocol } = harness({
            readable: new Set(['acct', 'lead']),
            failRead: { object: 'lead', error: injected },
        });

        const caught = await rejection(() => protocol.searchAll({ q: 'Acme', context: MEMBER }));
        expect(caught).toBe(injected);
    });

    it('an admission check that THROWS fails the search instead of shrinking it', async () => {
        const injected = Object.assign(new Error('permission store unreachable'), { code: 'ECONNREFUSED' });
        const { protocol, readCalls } = harness({
            readable: new Set(['acct']),
            canReadObject: async (o) => {
                if (o === 'lead') throw injected;
                return o === 'acct';
            },
        });

        const caught = await rejection(() => protocol.searchAll({ q: 'Acme', context: MEMBER }));
        expect(caught).toBe(injected);
        expect(readCalls).not.toContain('lead');
    });

    it('a context-less call is not pre-filtered: its reads carry no principal to ask about', async () => {
        const { protocol, canReadObject } = harness({ readable: 'all' });

        const result = await protocol.searchAll({ q: 'Acme' });

        expect(canReadObject).not.toHaveBeenCalled();
        expect(result.totalObjects).toBe(3);
    });
});
