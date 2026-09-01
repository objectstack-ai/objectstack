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

    /** `acct` always answers with one matching row; `lead`'s read is the variable.
     *  ([#13216] `sys_metadata` — the page sweep's overlay read — answers
     *  empty, so the record seam stays the only variable.) */
    function engineWhereLeadFails(error: unknown) {
        const readCalls: string[] = [];
        const engine = {
            registry: fixtureRegistry([acct, lead]),
            find: vi.fn(async (object: string) => {
                readCalls.push(object);
                if (object === 'sys_metadata') return [];
                if (object === 'lead') throw error;
                return [{ id: 'a1', name: 'Acme' }];
            }),
            findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
        };
        return { engine, readCalls };
    }

    it('control: a sweep whose reads all RUN returns the hits and counts them', async () => {
        const engine = {
            registry: fixtureRegistry([acct, lead]),
            find: vi.fn(async (object: string) => (
                object === 'sys_metadata' ? []
                    : object === 'acct' ? [{ id: 'a1', name: 'Acme' }] : [{ id: 'l1', name: 'Acme Lead' }]
            )),
            findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
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

describe('[#11754] searchAll — a registry that cannot ENUMERATE is not a registry with no objects', () => {
    const acct = objectFixture('acct');

    /**
     * The seam this pins: `searchAll` used to read the registry as
     * `(engine as any).registry?.getAllObjects?.() ?? []`. Neither guard could
     * ever fire on an outage — `SchemaRegistry.getAllObjects()` walks in-memory
     * Maps and has no throwing path — so what they absorbed was only the
     * STRUCTURAL omission: a host whose registry does not implement
     * `getAllObjects` at all. That omission never throws, so pre-fix the whole
     * sweep was a silent no-op: `{ hits: [], totalObjects: 0, totalHits: 0,
     * truncated: false }` under a successful response, indistinguishable from
     * a deployment with genuinely nothing registered (ADR-0110 D3).
     *
     * No new code and no new envelope are minted here on purpose — the ruled
     * disposition (#9284, the engine's own registry sweeps) is to drop both
     * halves of the swallow and let the omission surface as the read's own
     * failure, which for a missing method is the runtime's TypeError.
     */

    it('a registry WITHOUT getAllObjects rejects instead of inventing an empty sweep', async () => {
        const find = vi.fn(async () => [{ id: 'a1', name: 'Acme' }]);
        const engine = {
            // Everything a registry needs EXCEPT enumeration — the structural
            // omission, not an error class.
            registry: {
                getObject: (n: string) => (n === 'acct' ? acct : undefined),
                getItem: () => undefined,
                listItems: () => [],
            },
            find,
            findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
        };
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const caught = await rejection(() => protocol.searchAll({ q: 'Acme' }));

        // The omission surfaces as itself — the runtime's own TypeError naming
        // the missing member — never a minted code, never an invented answer.
        expect(caught).toBeInstanceOf(TypeError);
        expect(caught.message).toContain('getAllObjects');
        // The sweep never ran: no data read was issued for an enumeration that
        // did not happen.
        expect(find).not.toHaveBeenCalled();
        // Pre-fix this resolved with `{ query: 'Acme', hits: [],
        // totalObjects: 0, totalHits: 0, truncated: false }` — "nothing
        // matched", reported for a registry that was never asked.
    });

    it('an engine with NO registry rejects too (the other dropped `?.`)', async () => {
        const engine = {
            find: vi.fn(async () => []),
            findOne: vi.fn(async () => null),
        };
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const caught = await rejection(() => protocol.searchAll({ q: 'Acme' }));

        expect(caught).toBeInstanceOf(TypeError);
    });

    it('control: a registry that truthfully answers "no objects" still resolves the empty response', async () => {
        // The one benign emptiness: the registry ENUMERATED and the answer was
        // empty. This is the neighbouring shape the fix must not move.
        const engine = {
            registry: { ...fixtureRegistry([]), getAllObjects: vi.fn(() => []) },
            find: vi.fn(async () => []),
            findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
        };
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.searchAll({ q: 'Acme' });

        // [#13216] `pages: []` joined the body when the published-page sweep
        // landed — updated in place, the emptiness claims are unchanged.
        expect(result).toEqual({ query: 'Acme', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false });
        // Proof the emptiness was SAID by the registry, not invented past it.
        expect(engine.registry.getAllObjects).toHaveBeenCalledTimes(1);
    });

    it('control: a blank query still short-circuits BEFORE the registry is consulted', async () => {
        // The early return for an empty `q` sits above the enumeration read.
        // Pinned so the propagate change cannot drift it: a registry-less host
        // asked nothing must keep getting the empty-query answer, not a throw.
        const engine = {
            registry: {
                getObject: () => undefined,
                getItem: () => undefined,
                listItems: () => [],
            },
            find: vi.fn(async () => []),
            findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
        };
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.searchAll({ q: '   ' });

        // [#13216] `pages: []` joined the short-circuit body too — same
        // no-scan claim, one more empty member.
        expect(result).toEqual({ query: '', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// findReferencesToMeta
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8896] findReferencesToMeta — a source type that could not be READ is not a source type with no references', () => {
    /**
     * `view` is reachable from four source types (`app`, `object`, `page`,
     * `view`), so a single failing source type leaves the others answering —
     * which is exactly the pre-fix trap: a SHORT list that looks complete.
     * `page` carries a real reference to `my_view`, so the healthy half is
     * observable.
     *
     * [#9190] The fixture used to spell that reference `page.viewName`, which
     * `PageSchema` does not declare — it agreed with the hand-curated path
     * table, and the table was wrong. The real site is `view`, reached through
     * a `dataSource`, and the derived walk finds it wherever the document puts
     * it rather than at one memorised path.
     */
    const pageReferencingTheView = {
        name: 'home_page',
        label: 'Home',
        slots: { header: { dataSource: { view: 'my_view' } } },
    };

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
            findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
        };
        return { engine, typeReads };
    }

    it('control: a scan whose reads all RUN returns the reference it found', async () => {
        const { engine, typeReads } = engineWhereTypeFails(null);
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'my_view' });

        expect(result.references).toEqual([
            {
                type: 'page',
                name: 'home_page',
                label: 'Home',
                path: 'slots.header.dataSource.view',
                kind: 'page view',
            },
        ]);
        // Every source type that can name a view was really consulted — this is
        // what makes "one of them failed" a meaningful condition below.
        expect(typeReads).toContain('app');
        expect(typeReads).toContain('object');
        expect(typeReads).toContain('page');
    });

    it('a source type whose read FAILS fails the whole scan, envelope intact', async () => {
        const injected = connectionDropped();
        const { engine, typeReads } = engineWhereTypeFails('app', injected);
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
        expect(typeReads).toContain('app');
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

    it('a target type with no derived reference site still returns an empty list without reading anything', async () => {
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
        const { engine, typeReads } = engineWhereTypeFails('app', tableNotProvisioned('sys_metadata'));
        const protocol = new ObjectStackProtocolImplementation(engine as never);

        const result = await protocol.findReferencesToMeta({ type: 'view', name: 'my_view' });

        expect(result.references).toEqual([
            {
                type: 'page',
                name: 'home_page',
                label: 'Home',
                path: 'slots.header.dataSource.view',
                kind: 'page view',
            },
        ]);
        // Proof the benign branch was actually EXERCISED.
        expect(typeReads).toContain('app');
    });
});
