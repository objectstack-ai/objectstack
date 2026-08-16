// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8908] TWO tightenings, deliberately one card: the batch publish refuses a
// draft stored under a non-canonical metadata type, and the ADR-0010 audit
// writer refuses one instead of silently folding it.
//
// ---------------------------------------------------------------------------
// The defect, as measured on the card
// ---------------------------------------------------------------------------
// `publishPackageDrafts` reads `sys_metadata` rows AT REST, so #7894's `/meta`
// boundary fold never reaches it. `promoteDraftForPublish` folds the stored
// spelling through `PLURAL_TO_SINGULAR` — the MANIFEST-collection map, which
// legitimately omits types that are not stack collections. For those the fold
// is a NO-OP: the lookup key equals the stored spelling, the draft resolves,
// and the publish mints an ACTIVE row in the namespace `PUT /meta/field/…`
// answers 403 NOT_OVERRIDABLE for. Every registry read and every compliance
// query on `field` then misses an item the platform just reported as published.
//
// The ADR-0010 row recorded the same plural, because `recordMetadataAudit`
// re-folded through the same incomplete map: tolerant AND incomplete — canonical
// for the 29 types that never needed it, non-canonical for the ones that did.
//
// ---------------------------------------------------------------------------
// The class is SIX spellings, not the four the card lists
// ---------------------------------------------------------------------------
// Derived from the real maps rather than hand-listed (see
// `isNonCanonicalStoredType`): `fields`, `seeds`, `external_catalogs`,
// `externalCatalogs`, `translations`, `email_templates`. The last two are the
// reason the production rule is a predicate — a hand-written list of four would
// have shipped with them missing and nothing would have said so. This file pins
// one from the card's own list (`fields`) and one it does not name
// (`email_templates`), so a regression toward a hard-coded list is visible.
//
// ---------------------------------------------------------------------------
// What is deliberately NOT refused, and why the control matters
// ---------------------------------------------------------------------------
// A manifest-PRESENT plural (`objects`) is already fail-closed by a different
// mechanism: the promote addresses the row by its folded singular, `whereFor`
// emits that spelling with no at-rest fallback, and the batch aborts on
// `NO_DRAFT` (pinned, with its reasoning, in
// `protocol.publish-side-effects-canonical-type.test.ts`). #8908 rules ONE
// class; widening this gate over that one would change a wire-visible
// `failed[].code` for rows that are not this defect. The `objects` case below
// is the boundary marker for that decision — if a later change makes the gate
// "simpler" by dropping the manifest limb, this file says so.
//
// ---------------------------------------------------------------------------
// Ablation directions, predicted BEFORE running (results in the PR body)
// ---------------------------------------------------------------------------
// The two tightenings are independent limbs and are ablated SEPARATELY:
//
//   1. Pre-flight gate removed (writer assert intact)   → the Zone A refusal
//      cases go RED; every Zone B case stays GREEN.
//      ⚠️ Predicted NOT as "the row publishes": with the boundary fold at the
//      promote still in place the row is looked up under `field` and misses, so
//      the expected red is the WRONG REFUSAL, not a success.
//      MEASURED: 4 red / 8 green, and the wrong verdict is a DIFFERENT one per
//      type — `fields` dies at the draftability gate
//      (`[not_overridable] Metadata type 'field' is not draftable`) while
//      `email_templates` dies at the row lookup
//      (`[no_draft] No pending draft exists for email_template/welcome`). Both
//      fail-closed, neither naming the residue the operator actually has; and
//      the batch case additionally reports the HEALTHY sibling in `failed[]`
//      (`['ticket', 'legacy_field']`), because the abort now happens inside the
//      transaction instead of above it. That spread is the argument for the
//      pre-flight placement, measured rather than asserted.
//   2. Writer assert removed, silent fold restored      → the Zone B refusal
//      cases go RED; Zone A stays GREEN (its rows are folded at the call site,
//      which the fold's return makes redundant but not wrong).
//      MEASURED: 3 red / 9 green, each red as `promise resolved "undefined"
//      instead of rejecting` — i.e. the writer silently accepting the spelling,
//      which is the defect verbatim.
//
// Every "refused" case is paired with a positive control in the same describe:
// a blanket rule here would break ordinary publishing, and a refusal pin with
// no control cannot show the rule is selective.

import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, imported from
// `@objectstack/metadata-core` and NOT from `@objectstack/objectql`: objectql
// depends on this package, so that import would close a dependency cycle turbo
// rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

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
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    recorded_at: string;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

type Harness = {
    engine: any;
    rows: Map<string, Row>;
    /** Audit rows that LANDED (this harness's transaction really rolls back). */
    auditRows: any[];
    /**
     * Every insert AIMED at `sys_metadata_audit`, never rolled back. The
     * observation channel that separates "the writer refused before inserting"
     * from "it inserted and the row was undone".
     */
    auditAttempts: any[];
};

/**
 * ⚠️ NOT the usual `if (table === 'sys_metadata_audit') return { id: 'audit_skip' }`
 * stub. Zone B is entirely about what the audit writer does with its input, and
 * a short-circuited insert reports "no rows" identically before and after the
 * fix. This engine persists audit rows like any other table.
 */
function makeStubEngine(): Harness {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const auditRows: any[] = [];
    const auditAttempts: any[] = [];
    let nextId = 0;
    let txDepth = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            return r ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
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
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table === 'sys_metadata_commit') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_audit') {
                // The read side `auditMetaItem` uses — so this file can assert
                // through the same door `GET /meta/:type/:name/audit` serves from.
                return auditRows.filter((a) => {
                    if (opts.where?.type !== undefined && a.type !== opts.where.type) return false;
                    if (opts.where?.name !== undefined && a.name !== opts.where.name) return false;
                    return true;
                });
            }
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts.where));
            }
            if (table === 'sys_metadata_commit') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') {
                auditAttempts.push(data);
                nextId += 1;
                const a = { id: `a_${nextId}`, ...(data as any) };
                auditRows.push(a);
                return { id: a.id };
            }
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h: HistoryRow = { id: `h_${nextId}`, ...(data as any) };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table === 'sys_metadata_commit') return { id: `c_${(nextId += 1)}` };
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
        /**
         * A transaction that REALLY ROLLS BACK — ADR-0067 D2 atomicity is half
         * of what Zone A asserts, and a passthrough would make "nothing landed"
         * unfalsifiable. `auditAttempts` is deliberately outside the snapshot:
         * it models an observer outside the database.
         */
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            const owned = txDepth === 0;
            const snapshot = owned
                ? { rows: new Map(rows), historyRows: [...historyRows], auditRows: [...auditRows] }
                : null;
            txDepth += 1;
            try {
                return await cb(undefined, { owned });
            } catch (err) {
                if (snapshot) {
                    rows.clear();
                    for (const [k, v] of snapshot.rows) rows.set(k, v);
                    historyRows.length = 0;
                    historyRows.push(...snapshot.historyRows);
                    auditRows.length = 0;
                    auditRows.push(...snapshot.auditRows);
                }
                throw err;
            } finally {
                txDepth -= 1;
            }
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
        },
    };
    return { engine, rows, auditRows, auditAttempts };
}

function makeProtocol() {
    const h = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), 'env_prod') as any;
    return { protocol, h };
}

const PKG = 'app.demo';

/** An object body that clears the authoring gates a publish runs (#8308 OWD + a field). */
const objectBody = (name: string) => ({
    name,
    label: 'Ticket',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

/**
 * Write a draft row through the REPOSITORY, which stamps `type` exactly as
 * given. The only way to produce a row whose stored spelling is non-canonical:
 * `saveMetaItem` folds before it persists, and has since #7894. This is what a
 * row minted through the pre-#7894 plural URL door looks like at rest — nothing
 * rewrites it on upgrade.
 */
async function seedDraftRowVerbatim(
    protocol: any,
    args: { type: string; name: string; body: unknown; packageId: string },
): Promise<void> {
    await protocol.ensureOverlayIndex();
    const repo = protocol.getOverlayRepo(null);
    await repo.put(
        { type: args.type, name: args.name, org: 'env' },
        args.body,
        {
            parentVersion: null,
            actor: null,
            source: 'test.at-rest-residue',
            intent: 'runtime-only',
            state: 'draft',
            packageId: args.packageId,
        },
    );
}

const activeRows = (h: Harness) => [...h.rows.values()].filter((r) => r.state === 'active');
const deniedRows = (h: Harness) => h.auditRows.filter((a) => a.outcome === 'denied');

// ═══════════════════════════════════════════════════════════════════════════
// Zone A — the promote refusal (ruling option (a))
// ═══════════════════════════════════════════════════════════════════════════
describe('[#8908] publishPackageDrafts refuses a draft stored under a non-canonical type', () => {
    it('refuses `fields` at the pre-flight — named, actionable, nothing promoted', async () => {
        const { protocol, h } = makeProtocol();
        await seedDraftRowVerbatim(protocol, {
            type: 'fields', name: 'legacy_field', body: { type: 'text', label: 'Legacy' }, packageId: PKG,
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        expect(res.published).toEqual([]);
        expect(res.failed).toHaveLength(1);
        // The PRE-FLIGHT verdict, not a downstream miss. `NO_DRAFT` here would
        // mean the gate never ran and the row died at the promote instead —
        // fail-closed, but with the verdict the ruling rejected as unhelpful.
        expect(res.failed[0]).toMatchObject({
            type: 'fields', name: 'legacy_field', code: 'STORED_TYPE_NOT_CANONICAL',
        });
        // Names the row, names the canonical spelling, says what to do.
        expect(res.failed[0].error).toContain("'fields/legacy_field'");
        expect(res.failed[0].error).toContain("'field'");
        expect(res.failed[0].error).toContain('_migrate-stored');
        // The whole point: no ACTIVE row in the second namespace.
        expect(activeRows(h)).toEqual([]);
        expect([...h.rows.values()].some((r) => r.type === 'fields' && r.state === 'active')).toBe(false);
    });

    it('the refusal leaves an audit row keyed on the CANONICAL type, with the stored spelling in `note`', async () => {
        const { protocol, h } = makeProtocol();
        await seedDraftRowVerbatim(protocol, {
            type: 'fields', name: 'legacy_field', body: { type: 'text', label: 'Legacy' }, packageId: PKG,
        });

        await protocol.publishPackageDrafts({ packageId: PKG });

        expect(deniedRows(h)).toHaveLength(1);
        expect(deniedRows(h)[0]).toMatchObject({
            // `field`, NOT `fields`: `auditMetaItem` serves
            // `GET /meta/:type/:name/audit` through a folded `:type`, so a row
            // filed under the plural is a row no compliance query can reach.
            type: 'field',
            name: 'legacy_field',
            operation: 'publish',
            outcome: 'denied',
            // adr0112-ok: D6b — persisted audit column, its own lowercase vocabulary
            code: 'stored_type_not_canonical',
            source: 'protocol.publishPackageDrafts',
        });
        // The stored spelling is not lost — it is the actionable fact.
        expect(deniedRows(h)[0].note).toContain("'fields'");
        // Readable through the door the REST `/audit` route uses.
        const throughTheDoor = await h.engine.find('sys_metadata_audit', {
            where: { type: 'field', name: 'legacy_field' },
        });
        expect(throughTheDoor).toHaveLength(1);
    });

    it('covers a spelling the card does not name (`email_templates`) — the rule is derived, not a list of four', async () => {
        const { protocol, h } = makeProtocol();
        await seedDraftRowVerbatim(protocol, {
            type: 'email_templates', name: 'welcome', body: { name: 'welcome', subject: 'Hi' }, packageId: PKG,
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.failed[0]).toMatchObject({
            type: 'email_templates', name: 'welcome', code: 'STORED_TYPE_NOT_CANONICAL',
        });
        expect(activeRows(h)).toEqual([]);
    });

    it('is BATCH-ATOMIC — one residue row refuses the whole package, its healthy sibling included', async () => {
        const { protocol, h } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG, mode: 'draft',
        });
        await seedDraftRowVerbatim(protocol, {
            type: 'fields', name: 'legacy_field', body: { type: 'text', label: 'Legacy' }, packageId: PKG,
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        expect(res.published).toEqual([]);
        // ADR-0067 D2: the healthy object did NOT half-land, and its draft is
        // still a draft — the pre-flight returns above `engine.transaction()`,
        // so nothing was even attempted.
        expect(activeRows(h)).toEqual([]);
        expect([...h.rows.values()].filter((r) => r.state === 'draft').map((r) => r.name).sort())
            .toEqual(['legacy_field', 'ticket']);
        // Exactly ONE violation: the gate refuses the offender, it does not
        // report the innocent sibling as one.
        expect(res.failed.map((f: any) => f.name)).toEqual(['legacy_field']);
    });

    // ── the discriminating positive control ─────────────────────────────────
    //
    // Without this, every assertion above is satisfied by a rule that refuses
    // EVERYTHING — which would break ordinary publishing outright.
    it('CONTROL — a legitimate canonical draft still publishes, and audits, unchanged', async () => {
        const { protocol, h } = makeProtocol();
        await protocol.saveMetaItem({
            type: 'object', name: 'ticket', item: objectBody('ticket'), packageId: PKG, mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(true);
        expect(res.publishedCount).toBe(1);
        expect(res.published[0]).toMatchObject({ type: 'object', name: 'ticket' });
        expect(activeRows(h).map((r) => r.type)).toEqual(['object']);
        expect(deniedRows(h)).toHaveLength(0);
        expect(h.auditRows.some((a) => a.operation === 'publish' && a.outcome === 'allowed'
            && a.type === 'object' && a.name === 'ticket')).toBe(true);
    });

    // ── the boundary marker for the deliberately-excluded class ─────────────
    //
    // A manifest-PRESENT plural is NOT this gate's business: it is already
    // fail-closed at the promote, and #8908 rules one class. If a later change
    // "simplifies" the predicate by dropping its manifest limb, this case is
    // what says so — the code moves from `NO_DRAFT` to the pre-flight verdict.
    it('CONTROL — a manifest-PRESENT plural (`objects`) keeps its existing NO_DRAFT abort', async () => {
        const { protocol, h } = makeProtocol();
        await seedDraftRowVerbatim(protocol, {
            type: 'objects', name: 'legacy_ticket', body: objectBody('legacy_ticket'), packageId: PKG,
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.success).toBe(false);
        expect(res.failed[0]).toMatchObject({ type: 'objects', name: 'legacy_ticket', code: 'NO_DRAFT' });
        expect(activeRows(h)).toEqual([]);
        // Its `batch_aborted` row is keyed on the canonical type too — the
        // audit writer's assert would refuse `objects`, so the batch route folds
        // it at the boundary like every other at-rest row.
        expect(h.auditRows.filter((a) => a.code === 'batch_aborted')).toHaveLength(1);
        expect(h.auditRows.find((a) => a.code === 'batch_aborted')).toMatchObject({
            type: 'object', name: 'legacy_ticket',
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Zone B — the audit writer asserts instead of folding
// ═══════════════════════════════════════════════════════════════════════════
//
// Called directly rather than through a route: the assert exists precisely
// because no ROUTE may reach it (every producer folds at its own boundary), so
// a route-level test could only ever measure the folds. What is pinned here is
// the writer's own accept set — what a FUTURE call site would meet.
describe('[#8908] recordMetadataAudit refuses a non-canonical `type`', () => {
    it('refuses a manifest-ABSENT plural — the class the old fold silently persisted', async () => {
        const { protocol, h } = makeProtocol();

        await expect(protocol.recordMetadataAudit({
            type: 'fields', name: 'legacy_field', operation: 'publish', outcome: 'allowed', code: 'ok',
        })).rejects.toMatchObject({
            code: 'AUDIT_TYPE_NOT_CANONICAL',
            status: 500,
        });
        // ⛔ Refused, not warned: nothing was even offered to the table. The
        // best-effort `catch` inside this writer would have turned a throw from
        // within the `try` into a `console.warn` — the softening the ruling
        // forbids — and `auditAttempts` is what tells the two apart.
        expect(h.auditAttempts).toHaveLength(0);
        expect(h.auditRows).toHaveLength(0);
    });

    it('refuses a manifest-PRESENT plural too — the old fold repaired this one silently', async () => {
        const { protocol, h } = makeProtocol();

        await expect(protocol.recordMetadataAudit({
            type: 'objects', name: 'ticket', operation: 'save', outcome: 'allowed', code: 'ok',
        })).rejects.toMatchObject({ code: 'AUDIT_TYPE_NOT_CANONICAL', status: 500 });
        expect(h.auditAttempts).toHaveLength(0);
    });

    it('the refusal names the offending spelling AND the canonical one', async () => {
        const { protocol } = makeProtocol();

        await expect(protocol.recordMetadataAudit({
            type: 'translations', name: 'zh_cn', operation: 'publish', outcome: 'allowed', code: 'ok',
        })).rejects.toThrow(/'translations'.*'translation'/s);
    });

    // ── positive controls: the accept set is narrowed, not closed ───────────
    it('CONTROL — a canonical type still writes its row', async () => {
        const { protocol, h } = makeProtocol();

        await protocol.recordMetadataAudit({
            type: 'field', name: 'legacy_field', operation: 'publish', outcome: 'allowed', code: 'ok',
        });

        expect(h.auditRows).toHaveLength(1);
        expect(h.auditRows[0]).toMatchObject({ type: 'field', name: 'legacy_field', code: 'ok' });
    });

    it('CONTROL — an unrecognised kind is NOT refused (a plugin kind can never trip this gate)', async () => {
        const { protocol, h } = makeProtocol();

        // `canonicalMetaType` is the identity for anything the static map does
        // not carry, so this holds BY CONSTRUCTION for every kind the platform
        // has not heard of — the same positive-control-by-construction
        // `metaUrlSpellingRefusal` is built on. The test exists anyway;
        // construction and coverage are not substitutes.
        await protocol.recordMetadataAudit({
            type: 'widgetz', name: 'x', operation: 'save', outcome: 'allowed', code: 'ok',
        });

        expect(h.auditRows).toHaveLength(1);
        expect(h.auditRows[0]).toMatchObject({ type: 'widgetz' });
    });

    it('CONTROL — the ordinary `/meta` save path still audits (the writer was narrowed, not broken)', async () => {
        const { protocol, h } = makeProtocol();

        // Addressed with the PLURAL url spelling, which the `/meta` boundary
        // folds on the way in — so the writer is handed `object` and accepts it.
        // This is the "fold at the boundary" half of the ruling, end to end.
        await protocol.saveMetaItem({
            type: 'objects', name: 'ticket', item: objectBody('ticket'), packageId: PKG, mode: 'draft',
        });

        expect(h.auditRows.filter((a) => a.operation === 'save')).toHaveLength(1);
        expect(h.auditRows.find((a) => a.operation === 'save')).toMatchObject({
            type: 'object', name: 'ticket', outcome: 'allowed',
        });
    });
});
