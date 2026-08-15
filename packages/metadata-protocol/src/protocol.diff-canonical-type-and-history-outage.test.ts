// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two independent defects in one method, pinned in one file because they land in
 * one function and were fixed in one PR — `diffMetaItem`.
 *
 * ## #8868 — the canonical fold
 *
 * `diffMetaItem` is the NINTH `/meta` entry point on this URL family and was the
 * last one deriving its type key from `PLURAL_TO_SINGULAR` (the MANIFEST-
 * COLLECTION map) instead of `canonicalizeMetaRequestType` (the #7894 request
 * boundary). #8769 routed `publishMetaItem`, #8819 routed `rollbackMetaItem`.
 *
 * ## #8833 — the swallowed outage
 *
 * The history read's `catch` was empty and fell through, leaving `histRows` at
 * `[]`; the code below read that never-filled accumulator as a real answer, so a
 * `sys_metadata_history` outage was served as a well-formed 200 empty diff.
 * Maintainer ruling (2026-08-15, #8833 comment 5302933802): route it through the
 * platform's existing discrimination — genuinely-absent table stays benign,
 * every other read failure propagates the 503 (ADR-0110 D3).
 *
 * ## ⛔ Why the fixture is `field`/`fields` and not `view`/`views`
 *
 * This is the anti-vacuity property of the whole file, and it is the lesson
 * #8867 paid for: a cross-package pin there spelled its fixture so that the
 * folded and unfolded spellings AGREED, which made the test structurally
 * incapable of failing on the hazard it named.
 *
 * `views` IS in the manifest map, so it folded to `view` before this fix and
 * after it — a pin using it proves nothing about the fold. The four
 * MANIFEST-ABSENT types (`field`, `seed`, `external_catalog`, `translation`) are
 * legitimately absent from that map because they are not stack collections, so
 * `fields` stayed plural all the way into the history `where` and matched no
 * row. `manifestMapStillDoesNotFoldTheFixture` below asserts that asymmetry
 * directly: if `fields` ever enters `PLURAL_TO_SINGULAR`, every fold assertion
 * here silently stops discriminating while staying green. That test going red is
 * the signal to re-pick the fixture, not to delete the assertion.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, hashSpec } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from './index.js';

/** Manifest-ABSENT: `fields` is NOT in `PLURAL_TO_SINGULAR`. The subject. */
const ABSENT_TYPE = 'field';
const ABSENT_PLURAL = 'fields';
/** Manifest-PRESENT: `views` folded through the old map too. The control. */
const PRESENT_TYPE = 'view';
const PRESENT_PLURAL = 'views';
/**
 * An unrecognised spelling whose singular IS a declared type — the one class
 * `metaUrlSpellingRefusal` refuses. Measured against the real contract rather
 * than guessed: `metaUrlSpellingRefusal('viewes')` returns
 * `{ declared: 'view', hint: 'views' }`.
 */
const REFUSED_SPELLING = 'viewes';
/**
 * NOT a plural of anything declared, so it is indistinguishable from a
 * plugin-registered runtime kind and MUST NOT be refused here. The positive
 * control that keeps the refusal narrow instead of blanket.
 */
const PLUGIN_SHAPED_SPELLING = 'fieldz';

/** Reads like a genuine outage to `isMissingTableError`: not benign. */
const OUTAGE_ERROR = () => new Error('connection terminated unexpectedly');
/**
 * The ONE benign reason — the table was never provisioned (minimal deployment).
 * SQLite/libsql phrasing, which `MISSING_TABLE.message` matches.
 */
const MISSING_TABLE_ERROR = () => new Error('no such table: sys_metadata_history');

/**
 * Scalar equality only, and it REFUSES a combinator rather than guessing —
 * `check:where-matcher` shape (b): treating `$or` as a column name silently
 * excludes rows and greens the suite against a query nobody wrote.
 */
function matches(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k.startsWith('$')) {
            throw new Error(
                `stub engine: WHERE combinator '${k}' is not implemented by this double — `
                + 'it matches scalar equality only. Implement it here rather than letting it '
                + 'be read as a field name.',
            );
        }
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

/**
 * Records the `type` every history read was issued under — the fold is a claim
 * about the KEY the query used, and a value-only assertion cannot see it.
 */
function makeStubEngine(opts: { historyError?: () => Error } = {}) {
    const tables: Record<string, Array<Record<string, unknown>>> = {
        sys_metadata: [],
        sys_metadata_history: [],
    };
    const historyTypeKeys: unknown[] = [];
    const engine: any = {
        async find(table: string, o: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                historyTypeKeys.push(o.where.type);
                if (opts.historyError) throw opts.historyError();
            }
            return (tables[table] ?? []).filter((r) => matches(r, o.where));
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            return (tables[table] ?? []).find((r) => matches(r, o.where)) ?? null;
        },
        async insert() { return { id: 'stub' }; },
        async update(_t: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            return { id: null };
        },
        async delete(_t: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            getItem: () => undefined,
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, tables, historyTypeKeys };
}

/** Two versions differing in exactly one top-level key, so the diff is unambiguous. */
function seedTwoVersions(
    tables: Record<string, Array<Record<string, unknown>>>,
    type: string,
    name: string,
) {
    const base = { organization_id: null, type, name };
    [{ name, label: 'A' }, { name, label: 'B' }].forEach((body, i) => {
        tables.sys_metadata_history!.push({
            ...base,
            id: `h_${i + 1}`,
            version: i + 1,
            event_seq: i + 1,
            operation_type: i === 0 ? 'create' : 'update',
            metadata: JSON.stringify(body),
            checksum: hashSpec(body),
            recorded_at: new Date(i + 1).toISOString(),
        });
    });
}

/** The real diff of the seeded pair — an EMPTY diff is the defect's signature. */
const REAL_DIFF_BODY = {
    added: [],
    removed: [],
    changed: [{ path: 'label', from: 'A', to: 'B' }],
};

describe('#8868 — diffMetaItem folds its type at the request boundary', () => {
    it('manifestMapStillDoesNotFoldTheFixture: the anti-vacuity arm', () => {
        // ⛔ Not decoration. This is the property that makes every assertion
        // below capable of failing: the manifest map must NOT already fold
        // `fields`, or folded and raw agree and the pins go vacuous — exactly
        // the shape #8867 shipped. The `views` half is the contrast that proves
        // the map is real and populated rather than empty in this environment.
        expect(PLURAL_TO_SINGULAR[ABSENT_PLURAL]).toBeUndefined();
        expect(PLURAL_TO_SINGULAR[PRESENT_PLURAL]).toBe(PRESENT_TYPE);
    });

    it('THE PIN: a plural of a manifest-ABSENT type answers the same diff as the canonical spelling', async () => {
        // Before the fix the plural reached `sys_metadata_history` unfolded,
        // matched no row, and this returned `{ added: [], removed: [], changed: [] }`
        // for an item that plainly has history.
        const canonical = makeStubEngine();
        seedTwoVersions(canonical.tables, ABSENT_TYPE, 'my_field');
        const plural = makeStubEngine();
        seedTwoVersions(plural.tables, ABSENT_TYPE, 'my_field');

        const viaCanonical: any = await new ObjectStackProtocolImplementation(canonical.engine)
            .diffMetaItem({ type: ABSENT_TYPE, name: 'my_field', fromVersion: 1, toVersion: 2 });
        const viaPlural: any = await new ObjectStackProtocolImplementation(plural.engine)
            .diffMetaItem({ type: ABSENT_PLURAL, name: 'my_field', fromVersion: 1, toVersion: 2 });

        // The real diff, not an empty one — stated positively so a future
        // regression to `[]` cannot pass by both sides being equally empty.
        expect(viaCanonical).toMatchObject(REAL_DIFF_BODY);
        expect(viaPlural).toMatchObject(REAL_DIFF_BODY);
        expect(viaPlural).toEqual(viaCanonical);
        // The KEY the read actually used, which is the fold's real subject.
        expect(plural.historyTypeKeys).toEqual([ABSENT_TYPE]);
    });

    it('the echoed `type` reports the CANONICAL spelling, not the caller`s', async () => {
        // The card's one genuine sub-question. Answered by the precedent the
        // family already set rather than minted here: `saveMetaItem` and
        // `deleteMetaItem` both `return { type: request.type }` AFTER their
        // fold, so the echo names the spelling the read used.
        const { engine, tables } = makeStubEngine();
        seedTwoVersions(tables, ABSENT_TYPE, 'my_field');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({
            type: ABSENT_PLURAL,
            name: 'my_field',
            fromVersion: 1,
            toVersion: 2,
        });

        expect(res.type).toBe(ABSENT_TYPE);
    });

    it('a manifest-PRESENT type already agreed on the DIFF BODY — so the fixture choice is doing the work', async () => {
        // THE CONTROL, and the two halves are asserted separately on purpose.
        //
        // Measured under ablation (fold removed, this file re-run) rather than
        // assumed, because the naive whole-object `toEqual` blurred them:
        //
        //   • the BODY half is genuinely unchanged by this fix — `views` was
        //     already in the manifest map, so both spellings resolved the real
        //     diff before it. That is exactly why `fields` and not `views` is
        //     the subject of the pin above, which fails on its body
        //     (`changed: []`) the moment the fold is removed.
        //   • the ECHO half DOES move for this type too (ablated, it answers
        //     `type: 'views'`), because the echo was never fed by the manifest
        //     map — it read `request.type` raw. So the fold fixes the echo for
        //     every plural spelling, while it fixes the body only for the four
        //     manifest-absent types.
        //
        // Collapsing these into one equality would report "the control also
        // went red" without saying which half moved, which is the opposite of
        // what a control is for.
        const canonical = makeStubEngine();
        seedTwoVersions(canonical.tables, PRESENT_TYPE, 'grid');
        const plural = makeStubEngine();
        seedTwoVersions(plural.tables, PRESENT_TYPE, 'grid');

        const viaCanonical: any = await new ObjectStackProtocolImplementation(canonical.engine)
            .diffMetaItem({ type: PRESENT_TYPE, name: 'grid', fromVersion: 1, toVersion: 2 });
        const viaPlural: any = await new ObjectStackProtocolImplementation(plural.engine)
            .diffMetaItem({ type: PRESENT_PLURAL, name: 'grid', fromVersion: 1, toVersion: 2 });

        // Body: true before AND after the fix — the control's actual claim.
        expect(viaCanonical).toMatchObject(REAL_DIFF_BODY);
        expect(viaPlural).toMatchObject(REAL_DIFF_BODY);
        // Echo: canonical for this type too, same as the manifest-absent one.
        expect(viaCanonical.type).toBe(PRESENT_TYPE);
        expect(viaPlural.type).toBe(PRESENT_TYPE);
    });

    it('refuses an unrecognised spelling of a DECLARED type with the 400 envelope', async () => {
        const { engine, tables } = makeStubEngine();
        seedTwoVersions(tables, PRESENT_TYPE, 'grid');
        const protocol = new ObjectStackProtocolImplementation(engine);

        // ADR-0112 — assert the ENVELOPE (code AND status), not merely that
        // something threw: a bare `Error` from anywhere below would satisfy
        // `.rejects.toThrow()` while proving nothing about the refusal.
        const err: any = await protocol
            .diffMetaItem({ type: REFUSED_SPELLING, name: 'grid', fromVersion: 1, toVersion: 2 })
            .then(() => null, (e: unknown) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('INVALID_REQUEST');
        expect(err.status).toBe(400);
        expect(err.message).toContain(REFUSED_SPELLING);
        expect(err.message).toContain(PRESENT_TYPE);
    });

    it('does NOT refuse a spelling that reaches for no declared type — the refusal stays narrow', async () => {
        // A plugin-registered runtime kind must never be refused by a static
        // rule. `fieldz` is not a plural of anything declared, so the boundary
        // is silent and the request is served (with no rows, truthfully).
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({
            type: PLUGIN_SHAPED_SPELLING,
            name: 'x',
            fromVersion: 1,
            toVersion: 2,
        });

        expect(res.type).toBe(PLUGIN_SHAPED_SPELLING);
        expect(res.changed).toEqual([]);
    });
});

describe('#8833 — a history-store outage stops masquerading as an empty diff', () => {
    it('THE PIN: a non-benign read failure propagates the 503 envelope', async () => {
        const { engine, tables } = makeStubEngine({ historyError: OUTAGE_ERROR });
        seedTwoVersions(tables, PRESENT_TYPE, 'grid');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err: any = await protocol
            .diffMetaItem({ type: PRESENT_TYPE, name: 'grid', fromVersion: 1, toVersion: 2 })
            .then(() => null, (e: unknown) => e);

        // ADR-0112 envelope — code AND status. `.toThrow()` alone would stay
        // green on a driver that threw a bare `Error`, i.e. on the very shape
        // this card is about.
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.status).toBe(503);
        // The driver error rides as `cause` rather than being interpolated.
        expect(err.cause).toBeInstanceOf(Error);
        expect((err.cause as Error).message).toContain('connection terminated');
    });

    it('THE CONTROL: a genuinely-absent table still answers benignly', async () => {
        // Without this arm the pin above cannot show the discrimination is
        // SELECTIVE rather than a blanket "any failure 503s" — which would
        // break first boot on a minimal deployment that never provisioned
        // `sys_metadata_history`.
        const { engine } = makeStubEngine({ historyError: MISSING_TABLE_ERROR });
        const protocol = new ObjectStackProtocolImplementation(engine);

        const res: any = await protocol.diffMetaItem({
            type: PRESENT_TYPE,
            name: 'grid',
            fromVersion: 1,
            toVersion: 2,
        });

        expect(res.added).toEqual([]);
        expect(res.removed).toEqual([]);
        expect(res.changed).toEqual([]);
        expect(res.type).toBe(PRESENT_TYPE);
    });

    it('the 503 does not depend on the type — gated-shut types propagate identically', async () => {
        // Preserves #8798's subject under the new contract: one outage, ONE
        // answer, not an answer decided by an authorization gate that has
        // nothing to do with reading history.
        const { engine, tables } = makeStubEngine({ historyError: OUTAGE_ERROR });
        seedTwoVersions(tables, ABSENT_TYPE, 'my_field');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err: any = await protocol
            .diffMetaItem({ type: ABSENT_TYPE, name: 'my_field', fromVersion: 1, toVersion: 2 })
            .then(() => null, (e: unknown) => e);

        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.status).toBe(503);
    });
});
