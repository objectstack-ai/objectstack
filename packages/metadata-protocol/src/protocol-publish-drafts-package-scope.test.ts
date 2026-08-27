// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, hashSpec, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * Regression for #8907 — `publishPackageDrafts` promotes (and drains) ANOTHER
 * package's draft row.
 *
 * Root cause: `publishPackageDrafts` lists the package's drafts with
 * `repo.listDrafts({ packageId })` — a `package_id = :packageId` filter — then
 * promotes each listed row through `promoteDraftForPublish` →
 * `repo.promoteDraft`. `promoteDraft` re-resolved the row it was about to
 * promote with `whereFor(ref, 'draft')`, which OMITS the `package_id`
 * dimension. ADR-0048 keys overlay rows by `(org, type, name, package_id)`
 * precisely so two installed packages shipping the same name each keep their
 * OWN row, so that lookup cannot distinguish them: publishing `app.demo`
 * promoted whichever `(type, name)` draft the driver returned first.
 *
 * Measured consequence (the card's reproduction): publishing `app.demo`
 * promoted **app.other's** pending draft to active, drained THAT package's
 * draft row, recorded it under app.demo's ADR-0067 commit — and left app.demo's
 * own edit pending, while answering `success: true`.
 *
 * ## Why this fixture pins the defect rather than passing by luck
 *
 * Which of the two rows wins is DRIVER-ORDER DEPENDENT — `findOne` has no
 * defined order without an `ORDER BY` — so a fixture that happened to resolve
 * the right row would prove nothing. The ordering is therefore made
 * deterministic HERE, and the fixture is built so the WRONG row is the one the
 * pre-fix code selects:
 *
 *   - the stub's `findRow` falls back to an insertion-ordered scan exactly when
 *     `package_id` is absent from the `where` (which is the pre-fix promote's
 *     lookup), and returns the FIRST match;
 *   - `app.other`'s draft is therefore saved FIRST, so the package-agnostic
 *     lookup lands on it and not on the package being published.
 *
 * The first case asserts that precondition explicitly, so a future change to
 * insertion order fails loudly instead of silently draining the fixture's
 * discriminating power.
 */

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
    updated_at?: string;
    created_at?: string;
}

interface HistoryRow {
    id: string;
    event_seq: number;
    name: string;
    type: string;
    version: number;
    operation_type: string;
    metadata: string | null;
    checksum: string | null;
    previous_checksum: string | null;
    change_note?: string | null;
    source?: string | null;
    organization_id: string | null;
    recorded_by?: string | null;
    recorded_at: string;
}

// Overlay rows are keyed by (type, name, org, state, package_id) — the ADR-0048
// key — so two packages' drafts for the SAME (type, name) coexist as distinct
// rows. That coexistence is the whole precondition of this defect.
function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/** Does row `r` satisfy `where` (top-level eq + `$or` + `organization_id IS NULL`)? */
function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
        // `undefined` = "dimension not constrained"; `null` = "must be NULL".
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    let nextId = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        // Exact-key lookup when the caller SCOPED the read by package. When
        // `package_id` is absent (the pre-fix promote's "match any package"
        // lookup) fall back to an insertion-ordered scan returning the FIRST
        // match — the deterministic stand-in for a real driver's undefined
        // `findOne` order, and what makes the wrong row win below.
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            return r ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesMetadataWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type) return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts.where));
            }
            return Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h: HistoryRow = { id: `h_${nextId}`, ...(data as any) };
                historyRows.push(h);
                return { id: h.id };
            }
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            // No declared package namespace → publishPackageDrafts skips the
            // ADR-0028 prefix check (legacy-grandfathered path).
            getPackage: () => undefined,
        },
    };
    return { engine, rows, historyRows };
}

/**
 * Two packages ship the SAME object name. `label` is the marker that says which
 * package's body a row is carrying — the fact the assertions turn on.
 *
 * [#8308] Authored OWD: the publish gate refuses an OWD-less custom object
 * (`security-owd-unset`).
 */
const objectBody = (name: string, label: string) => ({
    name,
    label,
    sharingModel: 'private',
    fields: {
        title: { type: 'text', label: 'Title' },
    },
});

const draftRowsOf = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.state === 'draft');
const activeRowsOf = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.state === 'active');
const labelOf = (r: Row) => (JSON.parse(r.metadata) as { label?: string }).label;

/** Save the two colliding drafts, `app.other` FIRST — see the file header. */
async function seedTwoPackageDrafts(protocol: ObjectStackProtocolImplementation) {
    await protocol.saveMetaItem({
        type: 'object',
        name: 'shared_ticket',
        item: objectBody('shared_ticket', 'FROM_OTHER'),
        packageId: 'app.other',
        mode: 'draft',
    });
    await protocol.saveMetaItem({
        type: 'object',
        name: 'shared_ticket',
        item: objectBody('shared_ticket', 'FROM_DEMO'),
        packageId: 'app.demo',
        mode: 'draft',
    });
}

describe('publishPackageDrafts — two packages holding drafts for one (type, name) (#8907)', () => {
    it('parks both drafts as distinct ADR-0048 rows, with the OTHER package first in scan order', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);

        const drafts = draftRowsOf(rows);
        expect(drafts).toHaveLength(2);
        // The precondition the two cases below depend on: a package-agnostic
        // scan hits `app.other` FIRST, so resolving without the package
        // dimension selects the row that is NOT being published.
        expect(drafts.map((r) => r.package_id)).toEqual(['app.other', 'app.demo']);
        expect(drafts.map(labelOf)).toEqual(['FROM_OTHER', 'FROM_DEMO']);
    });

    it('promotes the PUBLISHING package own draft, not the first row that shares the name', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);

        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        expect(res.failed).toEqual([]);
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });

        // Before the fix the active row carried `package_id: 'app.other'` and
        // the body labelled FROM_OTHER — app.other's unreviewed pending change,
        // published under app.demo's commit.
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].package_id).toBe('app.demo');
        expect(labelOf(active[0])).toBe('FROM_DEMO');
    });

    it('drains the published package own draft and leaves the other package draft pending', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);
        await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        // Exactly one draft survives, and it is the one nobody published.
        // Before the fix this was inverted: app.other's row was drained and
        // app.demo's edit stayed pending while the response said "published".
        const drafts = draftRowsOf(rows);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].package_id).toBe('app.other');
        expect(labelOf(drafts[0])).toBe('FROM_OTHER');
    });

    it('still publishes a lone package-bound draft (no regression)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object',
            name: 'solo_ticket',
            item: objectBody('solo_ticket', 'SOLO'),
            packageId: 'app.demo',
            mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({ packageId: 'app.demo' });

        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(draftRowsOf(rows)).toHaveLength(0);
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].package_id).toBe('app.demo');
        expect(labelOf(active[0])).toBe('SOLO');
    });
});

/**
 * [#10350] The PER-ITEM door's half of the same key.
 *
 * `POST /meta/:type/:name/publish?package=PKG_ID` (#10063) made
 * `publishMetaItem` a package-naming caller too, so the narrowing the cases
 * above pin for `publishPackageDrafts` now has a SECOND entry point. The
 * runtime path already carried the value — `publishMetaItem` forwards its
 * whole request object and the one transform in between
 * (`canonicalizeMetaRequestType`) is a spread that drops no key — but nothing
 * pinned it, and the DECLARED request type did not carry `packageId` at all.
 *
 * ⚠️ What these cases ARE, stated so nobody reads more into a green run than
 * it holds: they are REGRESSION PINS on a path that is already correct, NOT a
 * defect control. There is no pre-fix red to show at runtime, and
 * manufacturing one would misrepresent the card. The defect was on the TYPE
 * surface, and its control is the compiler — before the declared shape carried
 * `packageId`, the literal in the first case below did not typecheck
 * (`TS2353`, `'packageId' does not exist in type ...`), which is exactly why
 * the only caller that states one is a REST door reaching it through a cast.
 *
 * What makes these pins able to FAIL is the fixture they inherit: with the
 * package dimension absent from the promote's lookup the first-scanned row
 * (`app.other`) wins, which is the wrong one. A pin that only asserted
 * `success: true` would pass either way — and the failure mode this card names
 * is precisely a future refactor that DESTRUCTURES the request instead of
 * forwarding it wholesale, dropping the key while every existing assertion
 * stays green.
 */
describe('publishMetaItem — the per-item door names a package too (#10350)', () => {
    it('promotes the STATED package draft, not the first row that shares the name', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);

        const res = await protocol.publishMetaItem({
            type: 'object',
            name: 'shared_ticket',
            packageId: 'app.demo',
        });

        expect(res).toMatchObject({ success: true });
        // Drop `packageId` on the way through `publishMetaItem` and the
        // promote's lookup goes package-agnostic, landing on `app.other` —
        // the same inversion the batch door carried before #8907.
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].package_id).toBe('app.demo');
        expect(labelOf(active[0])).toBe('FROM_DEMO');
    });

    it('drains the stated package own draft and leaves the other package draft pending', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);
        await protocol.publishMetaItem({
            type: 'object',
            name: 'shared_ticket',
            packageId: 'app.demo',
        });

        const drafts = draftRowsOf(rows);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].package_id).toBe('app.other');
        expect(labelOf(drafts[0])).toBe('FROM_OTHER');
    });

    it('keeps the historical match-any resolution when the caller states NO package', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedTwoPackageDrafts(protocol);

        await protocol.publishMetaItem({ type: 'object', name: 'shared_ticket' });

        // The contract `promoteDraftForPublish` spells as
        // `...('packageId' in request ? ... : {})`: an ABSENT key means "match
        // any package" (this fixture's first-scanned row), while a
        // present-and-`undefined` key would coerce to `null` downstream and pin
        // the lookup to UNBOUND rows — finding neither draft and answering
        // `no_draft`. Declaring `packageId` optional must not turn the first
        // spelling into the second, so the untouched path is pinned here.
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].package_id).toBe('app.other');
        expect(labelOf(active[0])).toBe('FROM_OTHER');
    });
});

/**
 * [#11003] The ORG-SCOPE probes' half of the same ADR-0048 key — maintainer
 * ruling 2026-08-22, option A (recorded on the issue): the scope probes ask
 * the promote's question, i.e. `resolveDraftOrgScopeForPublish` threads the
 * stated `packageId` into BOTH of its `sys_metadata` probes.
 *
 * ## The defect these cases reproduce
 *
 * With two packages holding drafts for ONE `(type, name)` in DIFFERENT org
 * scopes, a package-stating publish resolved the wrong scope: probe 1 was
 * package-agnostic, matched the OTHER package's row in the caller's org,
 * named that org as the scope — and the promote (whose `whereFor` IS
 * package-exact since #8907/#10350) then found nothing there and answered
 * `404 [no_draft]` over a draft sitting env-wide, publishable, and named by
 * the caller.
 *
 * Unlike the #8907 cases above, NO insertion-order rigging is needed for the
 * wrong row to win: the two drafts live in different org partitions, so probe
 * 1's `organization_id` filter alone selects the foreign package's row — the
 * pre-fix failure is deterministic, not a driver-order coin toss.
 *
 * ## Why type `object` and the `OS_METADATA_WRITABLE` hatch
 *
 * The card's scenario is `(object, shared_ticket)`. `object` is
 * `allowOrgOverride: false` in the static registry, so an org-scoped object
 * draft exists only where the operator hatch (`OS_METADATA_WRITABLE=object`
 * — the Studio-side editing escape, #6190 R7) is open; with the hatch closed
 * the promote's own #6190 gate would answer `403 [not_overridable]` before
 * the probes' answer mattered, and the card's measured `404 [no_draft]`
 * could not be reproduced as filed. The hatch is scoped to this describe
 * (`beforeAll`/`afterAll` + cache reset), the same pattern
 * `protocol.org-scoped-write-refused.test.ts` R7 uses.
 *
 * ## Accepted cost, pinned on purpose
 *
 * The ruling's own words: a caller stating a package no longer discovers a
 * no-package draft of the same `(type, name)` — it 404s and the caller
 * retries without `?package=`; that narrowing is the ruling, not a side
 * effect. The last case pins BOTH halves of that sentence. The package-less
 * draft row is seeded by DIRECT `engine.insert`, not through
 * `saveMetaItem(mode:'draft')` — PR #11139 is changing how a package-less
 * draft save resolves its binding (inheriting the overlaid active row's
 * `package_id`), so a fixture seeded through that save path would stop
 * meaning "a package-less draft exists" the day it lands.
 */
describe('publishMetaItem — the scope probes ask the promote\'s question (#11003)', () => {
    beforeAll(() => {
        process.env.OS_METADATA_WRITABLE = 'object';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
    });
    afterAll(() => {
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
    });

    /**
     * The card's coexistence arrangement: `app.other` holds the caller's-org
     * (`org1`) draft, `app.demo` holds the env-wide one. Distinct ADR-0048
     * rows — different `(org, package)` pairings, one `(type, name)`.
     */
    async function seedCrossScopeDrafts(protocol: ObjectStackProtocolImplementation) {
        await protocol.saveMetaItem({
            type: 'object',
            name: 'shared_ticket',
            item: objectBody('shared_ticket', 'FROM_OTHER_ORG1'),
            packageId: 'app.other',
            organizationId: 'org1',
            mode: 'draft',
        });
        await protocol.saveMetaItem({
            type: 'object',
            name: 'shared_ticket',
            item: objectBody('shared_ticket', 'FROM_DEMO_ENV'),
            packageId: 'app.demo',
            mode: 'draft',
        });
    }

    it('finds the draft the caller NAMED: publishing app.demo succeeds over app.other\'s same-org row', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedCrossScopeDrafts(protocol);

        // The ADR-0048 coexistence precondition, asserted so a future change
        // to the seeding cannot silently drain these cases' discriminating
        // power: two draft rows, the foreign package's in the CALLER'S org,
        // the named package's env-wide.
        const drafts = draftRowsOf(rows);
        expect(drafts.map((r) => [r.package_id, r.organization_id])).toEqual([
            ['app.other', 'org1'],
            ['app.demo', null],
        ]);

        // Pre-fix this REJECTED with `404 [no_draft]`: probe 1, package-
        // agnostic, matched app.other's org1 row and answered `org1`; the
        // package-exact promote then looked in org1 WITH
        // `package_id = 'app.demo'` and found nothing — while app.demo's
        // draft sat env-wide, publishable, and was the row the caller named.
        const res = await protocol.publishMetaItem({
            type: 'object',
            name: 'shared_ticket',
            packageId: 'app.demo',
            organizationId: 'org1',
        });

        expect(res).toMatchObject({ success: true });
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(labelOf(active[0])).toBe('FROM_DEMO_ENV');
    });

    it('lands env-wide: the caller\'s org row belongs to another package, and the promotion never touches that partition', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedCrossScopeDrafts(protocol);
        await protocol.publishMetaItem({
            type: 'object',
            name: 'shared_ticket',
            packageId: 'app.demo',
            organizationId: 'org1',
        });

        // The resolution's landing, pinned row-by-row: the probe fell through
        // to env-wide BECAUSE the caller's own org row belongs to another
        // package, so the active row is ENV-WIDE under the named package —
        // not an org1 row minted from a partition holding nothing of
        // app.demo's.
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].organization_id).toBeNull();
        expect(active[0].package_id).toBe('app.demo');
        // …and app.other's org1 draft is untouched — pending, undrained, in
        // its own partition. Pre-fix there was nothing to assert here: the
        // door had already refused.
        const drafts = draftRowsOf(rows);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].package_id).toBe('app.other');
        expect(drafts[0].organization_id).toBe('org1');
        expect(labelOf(drafts[0])).toBe('FROM_OTHER_ORG1');
    });

    it('still resolves the caller\'s own org when THAT is where the named package\'s draft lives (no overshoot)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // Mirrored arrangement: app.other env-wide (seeded FIRST, so any
        // regression back toward package-agnostic env probing has a wrong row
        // to find), app.demo in the caller's org.
        await protocol.saveMetaItem({
            type: 'object',
            name: 'shared_ticket',
            item: objectBody('shared_ticket', 'FROM_OTHER_ENV'),
            packageId: 'app.other',
            mode: 'draft',
        });
        await protocol.saveMetaItem({
            type: 'object',
            name: 'shared_ticket',
            item: objectBody('shared_ticket', 'FROM_DEMO_ORG1'),
            packageId: 'app.demo',
            organizationId: 'org1',
            mode: 'draft',
        });

        const res = await protocol.publishMetaItem({
            type: 'object',
            name: 'shared_ticket',
            packageId: 'app.demo',
            organizationId: 'org1',
        });

        // GREEN BEFORE THE FIX TOO, and stated so nobody reads a repro into
        // it: pre-fix probe 1 happened to answer `org1` because the only org1
        // row WAS app.demo's. What this case bounds is the fix itself — the
        // ADR-0005 precedence (own org shadows env-wide) must survive the
        // package narrowing, so a "package-exact means env-first/env-only"
        // mis-fix fails here loudly.
        expect(res).toMatchObject({ success: true });
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].organization_id).toBe('org1');
        expect(active[0].package_id).toBe('app.demo');
        expect(labelOf(active[0])).toBe('FROM_DEMO_ORG1');
        // app.other's env-wide draft: pending, undrained.
        const drafts = draftRowsOf(rows);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].package_id).toBe('app.other');
        expect(drafts[0].organization_id).toBeNull();
    });

    it('keeps the historical match-any probes when the caller states NO package (cross-scope fixture)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        await seedCrossScopeDrafts(protocol);

        // No `packageId` key at all: the probes stay package-agnostic, the
        // promote matches any package, and the ADR-0005 precedence picks the
        // caller's own org row — app.other's, whatever package it belongs to.
        // This is the same absent-key contract the #10350 case above pins
        // env-wide, exercised HERE because these probes only run for an
        // org-scoped caller (`requestOrgId === null` returns early).
        const res = await protocol.publishMetaItem({
            type: 'object',
            name: 'shared_ticket',
            organizationId: 'org1',
        });

        expect(res).toMatchObject({ success: true });
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].organization_id).toBe('org1');
        expect(active[0].package_id).toBe('app.other');
        expect(labelOf(active[0])).toBe('FROM_OTHER_ORG1');
    });

    it('accepted cost (the ruling, not a side effect): a package-stating caller 404s over a package-less draft, and retrying without ?package= publishes it', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // Seeded by DIRECT insert — see the describe header for why this row
        // must not come from `saveMetaItem(mode:'draft')` while PR #11139 is
        // changing that path's binding resolution. The shape mirrors what the
        // repository's `put` writes for a package-less org draft — `checksum`
        // included: the post-promotion drain is an optimistic-lock delete
        // keyed on it, and a checksum-less row makes the drain read as the
        // benign "newer draft saved" race and survive (measured on this
        // fixture's first run).
        const noPackageBody = objectBody('shared_ticket', 'NO_PACKAGE');
        await engine.insert('sys_metadata', {
            type: 'object',
            name: 'shared_ticket',
            organization_id: 'org1',
            package_id: null,
            state: 'draft',
            metadata: JSON.stringify(noPackageBody),
            checksum: hashSpec(noPackageBody),
            version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });

        // Half 1 — the narrowing: the caller stated `app.demo`, so neither
        // probe nor promote may discover the unbound row. ADR-0112 envelope,
        // not a bare `toThrow`. (No pre-fix red here, stated plainly: the
        // package-exact PROMOTE already answered `no_draft` for this
        // arrangement; what this pins is that the ruling's cost sentence
        // holds end-to-end and stays held.)
        await expect(
            protocol.publishMetaItem({
                type: 'object',
                name: 'shared_ticket',
                packageId: 'app.demo',
                organizationId: 'org1',
            }),
        ).rejects.toMatchObject({ code: 'NO_DRAFT', status: 404 });
        // …and the refusal touched nothing: the package-less draft is intact.
        expect(draftRowsOf(rows)).toHaveLength(1);

        // Half 2 — the documented remedy: retry WITHOUT `?package=`. The
        // absent key restores the match-any resolution and the unbound draft
        // publishes.
        const res = await protocol.publishMetaItem({
            type: 'object',
            name: 'shared_ticket',
            organizationId: 'org1',
        });
        expect(res).toMatchObject({ success: true });
        const active = activeRowsOf(rows);
        expect(active).toHaveLength(1);
        expect(active[0].package_id).toBeNull();
        expect(active[0].organization_id).toBe('org1');
        expect(labelOf(active[0])).toBe('NO_PACKAGE');
        expect(draftRowsOf(rows)).toHaveLength(0);
    });
});
