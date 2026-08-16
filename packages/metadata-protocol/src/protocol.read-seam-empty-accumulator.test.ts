// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8896] Two protocol read seams that answered a FAILED read out of an empty
 * accumulator, with no log and no field saying the answer was incomplete.
 *
 * Both have the shape ADR-0110 D3 forbids: the caller receives an answer
 * indistinguishable from a legitimate one, and acts on it.
 *
 *   - `searchAll` — a per-object `catch { continue; }`, while the response kept
 *     reporting `totalObjects` / `totalHits` / `truncated` as though the sweep
 *     had been complete. A partial scan wearing a whole one's numbers.
 *   - `findReferencesToMeta` — a per-matcher `catch { return; }` inside a
 *     `Promise.all`, silently shortening the list that answers "what would
 *     break if I delete this". A short list reads as "nothing depends on it".
 *
 * The repairs are not symmetric, and that is the point of measuring per seam
 * rather than stamping one template on both:
 *
 *   - `searchAll` reads the DATA store directly, so it asks the shared
 *     `isMissingTableError` predicate itself: a registered object whose table
 *     was never provisioned can hold no rows, so contributing no hits is the
 *     truth; everything else propagates.
 *   - `findReferencesToMeta` reads through `getMetaItems`, which ALREADY does
 *     that discrimination (`rethrowUnlessMetadataStoreUnprovisioned`, #5532):
 *     the benign case returns normally, and a real outage is raised as a 503.
 *     So this seam gets NO predicate of its own — the only thing its `catch`
 *     could swallow was the 503 raised deliberately one line below it. A second
 *     discrimination here would be a second vocabulary of "benign", which is
 *     exactly the debt `@objectstack/metadata/errors` exists to retire.
 *
 * Every expectation is written against LITERALS — the exact injected error
 * object, its literal message and code, the literal 503 / `SERVICE_UNAVAILABLE`
 * envelope, literal hit and reference counts. Each failure assertion is paired
 * with a positive control in the same describe (the read SUCCEEDING and
 * producing hits/references) and, for the benign branch, with proof that the
 * injected throw actually fired — so a harness that had stopped exercising the
 * seam could not pass vacuously.
 */

import { describe, it, expect, vi } from 'vitest';
import { ErrorCode } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

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

/**
 * A registry carrying `objects` (what `searchAll` sweeps) and `items` (what
 * `getMetaItems` folds the `sys_metadata` overlay onto).
 */
function fixtureRegistry(objects: FixtureObject[], items: Record<string, unknown[]> = {}) {
    return {
        getObject: (n: string) => objects.find((o) => o.name === n),
        getAllObjects: () => objects,
        getItem: () => undefined,
        listItems: (type: string) => items[type] ?? [],
        applyNavContributions: (x: unknown) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
        getPackage: () => undefined,
    };
}

/** The real driver phrasings, verbatim. */
const connectionDropped = () =>
    Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
const tableNotProvisioned = (table: string) =>
    Object.assign(new Error(`SQLITE_ERROR: no such table: ${table}`), { code: 'SQLITE_ERROR' });

/** Capture a rejection without letting a resolve pass silently. */
async function rejection(run: () => Promise<unknown>): Promise<Record<string, unknown> & { message?: string }> {
    let caught: unknown;
    let resolved: unknown;
    let didResolve = false;
    try {
        resolved = await run();
        didResolve = true;
    } catch (e) {
        caught = e;
    }
    expect(
        didResolve,
        `expected a rejection, but the call resolved with ${JSON.stringify(resolved)}`,
    ).toBe(false);
    return caught as Record<string, unknown> & { message?: string };
}

// ═══════════════════════════════════════════════════════════════════════════
// searchAll
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8896] searchAll — an object that could not be READ is not an object with no matches', () => {
    const acct = objectFixture('acct');
    const lead = objectFixture('lead');

    /** `acct` always answers with one matching row; `lead`'s read is the variable. */
    function engineWhereLeadFails(error: unknown) {
        const readCalls: string[] = [];
        const engine = {
            registry: fixtureRegistry([acct, lead]),
            find: vi.fn(async (object: string) => {
                readCalls.push(object);
                if (object === 'lead') throw error;
                return [{ id: 'a1', name: 'Acme' }];
            }),
            findOne: vi.fn(async () => null),
        };
        return { engine, readCalls };
    }

    it('control: a sweep whose reads all RUN returns the hits and counts them', async () => {
        const engine = {
            registry: fixtureRegistry([acct, lead]),
            find: vi.fn(async (object: string) => (
                object === 'acct' ? [{ id: 'a1', name: 'Acme' }] : [{ id: 'l1', name: 'Acme Lead' }]
            )),
            findOne: vi.fn(async () => null),
        };
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.searchAll({ q: 'Acme' });

        expect(result.totalObjects).toBe(2);
        expect(result.totalHits).toBe(2);
        expect(result.truncated).toBe(false);
        expect(result.hits.map((h) => h.object)).toEqual(['acct', 'lead']);
    });

    it('a swept object whose read FAILS surfaces that error instead of shrinking the answer', async () => {
        const injected = connectionDropped();
        const { engine, readCalls } = engineWhereLeadFails(injected);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const caught = await rejection(() => protocol.searchAll({ q: 'Acme' }));

        // The caller receives the READ's own failure, envelope intact — this
        // fix mints no new code and no new response field.
        expect(caught).toBe(injected);
        expect(caught.message).toBe('connection terminated unexpectedly');
        expect(caught.code).toBe('ECONNRESET');
        // Proof the failing object really was swept.
        expect(readCalls).toContain('lead');
        // Pre-fix this resolved with `{ totalObjects: 2, totalHits: 1,
        // truncated: false }` — a scan of one object, reported as a complete
        // scan of two.
    });

    it('a missing COLUMN on a provisioned table stays loud (the superstring case)', async () => {
        // Postgres phrases this as `column "x" of relation "y" does not exist`,
        // which CONTAINS a complete, legal missing-table phrase. The table is
        // there; the read still did not happen. `isMissingTableError`'s
        // front-exclusion is what keeps this loud, and this pin is what stops a
        // future hand-rolled code test from reading it as benign.
        const injected = Object.assign(
            new Error('column "name" of relation "lead" does not exist'),
            { code: '42703' },
        );
        const { engine } = engineWhereLeadFails(injected);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const caught = await rejection(() => protocol.searchAll({ q: 'Acme' }));

        expect(caught).toBe(injected);
        expect(caught.message).toBe('column "name" of relation "lead" does not exist');
    });

    it('an UNPROVISIONED table is truthful emptiness: the sweep continues', async () => {
        // Routine, not exotic: the registry lists every DECLARED object whether
        // or not this deployment provisioned its table, and such an object can
        // hold no rows — so contributing no hits IS the truth.
        const { engine, readCalls } = engineWhereLeadFails(tableNotProvisioned('lead'));
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.searchAll({ q: 'Acme' });

        expect(result.totalHits).toBe(1);
        expect(result.hits.map((h) => h.object)).toEqual(['acct']);
        // Proof the benign branch was actually EXERCISED — the read ran and
        // threw. Without this, the passing search above would be consistent
        // with a harness that never sweeps `lead` at all.
        expect(readCalls).toContain('lead');
    });

    it('an UNPROVISIONED table in the postgres phrasing (42P01) is benign too', async () => {
        const { engine, readCalls } = engineWhereLeadFails(
            Object.assign(new Error('relation "lead" does not exist'), { code: '42P01' }),
        );
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.searchAll({ q: 'Acme' });

        expect(result.totalHits).toBe(1);
        expect(readCalls).toContain('lead');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// findReferencesToMeta
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8896] findReferencesToMeta — a source type that could not be READ is not a source type with no references', () => {
    /**
     * `view` has three matchers (`dashboard`, `app`, `page`), so a single
     * failing source type leaves the other two answering — which is exactly the
     * pre-fix trap: a SHORT list that looks complete. `page` carries a real
     * reference to `my_view`, so the healthy half is observable.
     */
    const pageReferencingTheView = { name: 'home_page', label: 'Home', viewName: 'my_view' };

    function engineWhereTypeFails(failingType: string | null, error?: unknown) {
        const typeReads: string[] = [];
        const engine = {
            registry: fixtureRegistry([], { page: [pageReferencingTheView] }),
            find: vi.fn(async (_table: string, query?: { where?: { type?: string } }) => {
                const type = query?.where?.type;
                if (typeof type === 'string') typeReads.push(type);
                if (failingType !== null && type === failingType) throw error;
                return [];
            }),
            findOne: vi.fn(async () => null),
        };
        return { engine, typeReads };
    }

    it('control: a scan whose reads all RUN returns the reference it found', async () => {
        const { engine, typeReads } = engineWhereTypeFails(null);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'my_view' });

        expect(result.references).toEqual([
            { type: 'page', name: 'home_page', label: 'Home', path: 'viewName', kind: 'page' },
        ]);
        // All three source types were really consulted — this is what makes
        // "one of them failed" a meaningful condition below.
        expect(typeReads).toContain('dashboard');
        expect(typeReads).toContain('app');
        expect(typeReads).toContain('page');
    });

    it('a source type whose read FAILS fails the whole scan, envelope intact', async () => {
        const injected = connectionDropped();
        const { engine, typeReads } = engineWhereTypeFails('dashboard', injected);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const caught = await rejection(
            () => protocol.findReferencesToMeta({ type: 'view', name: 'my_view' }),
        );

        // The 503 `getMetaItems` already raises for an unreadable store — NOT a
        // new code minted here, and not the driver error raw (unwrapped it has
        // no status, and `mapDataError` guesses `no such table` into a 404).
        expect(caught.status).toBe(503);
        expect(caught.code).toBe('SERVICE_UNAVAILABLE');
        // ADR-0112: the wire code must be in the declared vocabulary, or the
        // envelope fails `ApiErrorSchema.parse` at the boundary that ships it.
        expect(ErrorCode.safeParse(caught.code).success).toBe(true);
        // The driver's own error is not lost — it rides as `cause`.
        expect(caught.cause).toBe(injected);
        expect(typeReads).toContain('dashboard');
        // Pre-fix this resolved `{ references: [ …the page hit… ] }` — one real
        // reference presented as the complete dependency list, which an admin
        // reads as "safe to delete".
    });

    it('a source type this deployment does not declare is NOT an error — it simply has no hits', async () => {
        // The seam's benign case is structural, not an error class: `listItems`
        // answers `[]` for an unknown type and the overlay read finds nothing,
        // so nothing is thrown in the first place. This pin is what keeps the
        // repair from over-reaching into "any absent source type is an outage".
        const { engine } = engineWhereTypeFails(null);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.findReferencesToMeta({ type: 'tool', name: 'no_such_tool' });

        expect(result.references).toEqual([]);
    });

    it('a target type absent from REFERENCE_PATHS still returns an empty list without reading anything', async () => {
        const { engine, typeReads } = engineWhereTypeFails(null);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.findReferencesToMeta({ type: 'not_a_tracked_type', name: 'x' });

        expect(result.references).toEqual([]);
        expect(typeReads).toEqual([]);
    });

    it('an UNPROVISIONED sys_metadata is truthful emptiness: the scan answers from the registry', async () => {
        // The benign discrimination lives in `getMetaItems`, one layer down —
        // this seam inherits it rather than repeating it, and this pin is what
        // proves the inheritance still holds through the removed `catch`.
        const { engine, typeReads } = engineWhereTypeFails('dashboard', tableNotProvisioned('sys_metadata'));
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'my_view' });

        expect(result.references).toEqual([
            { type: 'page', name: 'home_page', label: 'Home', path: 'viewName', kind: 'page' },
        ]);
        // Proof the benign branch was actually EXERCISED.
        expect(typeReads).toContain('dashboard');
    });
});
