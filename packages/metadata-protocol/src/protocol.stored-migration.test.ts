// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4327 — `os migrate meta --stored`: the read-path conversion chain gets a
 * finish line.
 *
 * #3903/#4317 made every stored-row rehydration seam replay the full chain, so
 * a legacy row *reads* canonical forever. It stayed legacy on disk, though —
 * re-lowered on every load, warning once per boot. `migrateStoredMetadata`
 * writes the canonical body back through the normal write path so the row
 * itself stops carrying the old dialect.
 *
 * Rows are seeded straight into the stub engine, deliberately bypassing
 * `saveMetaItem`'s schema gate — exactly like a real row written years ago
 * under an older protocol. What the pass then does with them is the contract
 * under test: preview writes nothing, apply rewrites through the repository
 * (history row + fresh checksum + `source: 'migrate-stored'`), and everything
 * it declines to touch says so instead of being silently counted clean.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { applyMetaMigrations } from '@objectstack/spec/migrations';
import { ObjectStackProtocolImplementation } from './protocol.js';
import {
    DECISION_MODE_REVIEW_CONVERSION_ID,
    collectDecisionModeReview,
    formatStoredMigrationReport,
    storedMigrationClean,
} from './stored-migration.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    checksum: string | null;
    metadata: string;
}

function matches(r: Record<string, any>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if ((r[k] ?? null) !== v) return false;
    }
    return true;
}

/**
 * A multi-table stub engine: `sys_metadata` seeded from `seedRows`, every other
 * table (`sys_metadata_history`, `sys_metadata_audit`) created on first write.
 * The repository write path needs all of them, and the history table is where
 * this feature's central claim — "re-saved through the normal write path" — is
 * actually observable.
 */
function makeStubEngine(
    // `metadata` is `Omit`-ed out of the `Partial<Row>` half, never merely
    // intersected over it: on the row `metadata` is the STORED string, and
    // `string & unknown` is `string`, so a plain intersection refuses every
    // body written as an object literal — which is the seeding convenience
    // this harness exists for, and what it already does at runtime below.
    seedRows: Array<Omit<Partial<Row>, 'metadata'> & { type: string; name: string; metadata: unknown }>,
) {
    let nextId = 0;
    const tables = new Map<string, Record<string, any>[]>();
    tables.set(
        'sys_metadata',
        seedRows.map((r) => ({
            id: `r_${++nextId}`,
            organization_id: null,
            package_id: null,
            state: 'active',
            checksum: `sha256:seed_${nextId}`,
            ...r,
            metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata),
        })),
    );
    const rowsOf = (t: string): Record<string, any>[] => {
        let rows = tables.get(t);
        if (!rows) tables.set(t, (rows = []));
        return rows;
    };

    const engine: any = {
        async find(t: string, opts?: { where?: Record<string, unknown> }) {
            return rowsOf(t).filter((r) => matches(r, opts?.where ?? {}));
        },
        async findOne(t: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(t, opts);
            return rowsOf(t).find((r) => matches(r, opts?.where ?? {})) ?? null;
        },
        async insert(t: string, row: Record<string, any>) {
            const withId = { id: row.id ?? `r_${++nextId}`, ...row };
            rowsOf(t).push(withId);
            return withId;
        },
        async update(t: string, patch: Record<string, any>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(patch, opts);
            const target = rowsOf(t).find((r) => matches(r, opts.where));
            if (target) Object.assign(target, patch);
            return target ?? { id: 'x' };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: {
            listItems: () => [],
            isPackageDisabled: () => false,
            registerItem: () => { /* no-op */ },
            registerObject: () => { /* no-op */ },
        },
    };
    return { engine, tables };
}

const metaRows = (tables: Map<string, Record<string, any>[]>) => tables.get('sys_metadata')!;
const historyRows = (tables: Map<string, Record<string, any>[]>) =>
    tables.get('sys_metadata_history') ?? [];

/**
 * A protocol-≤16 object row: `conditionalRequired` was removed from the spec in
 * 17 (#3855) and its conversion is `retiredFromLoadPath` — the authored load
 * seam refuses it, the stored seam keeps lowering it, and this pass persists
 * the lowering.
 */
const legacyObjectRow = {
    type: 'object',
    name: 'crm_invoice',
    metadata: {
        name: 'crm_invoice',
        label: 'Invoice',
        fields: {
            status: { type: 'select', label: 'Status' },
            amount: { type: 'currency', label: 'Amount', conditionalRequired: "record.status == 'sent'" },
        },
    },
};

/** The same object, already canonical — the shape every row ends up in. */
const canonicalObjectRow = {
    type: 'object',
    name: 'crm_quote',
    metadata: {
        name: 'crm_quote',
        label: 'Quote',
        fields: {
            status: { type: 'select', label: 'Status' },
            amount: { type: 'currency', label: 'Amount', requiredWhen: "record.status == 'sent'" },
        },
    },
};

/** A pre-17 standalone action row still carrying the removed `execute` alias. */
const legacyActionRow = {
    type: 'action',
    name: 'convert',
    metadata: { name: 'convert', label: 'Convert', type: 'script', objectName: 'crm_invoice', execute: 'convertHandler' },
};

describe('migrateStoredMetadata — preview (#4327)', () => {
    it('reports the rows carrying a pre-protocol shape and writes nothing', async () => {
        const { engine, tables } = makeStubEngine([legacyObjectRow, canonicalObjectRow]);
        const before = JSON.stringify(metaRows(tables));
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.apply).toBe(false);
        expect(report.scanned).toBe(2);
        expect(report.pending).toBe(1);
        expect(report.canonical).toBe(1);
        expect(report.rewritten).toBe(0);
        // The whole point of a preview: the bytes are exactly as they were, and
        // no history row was appended either.
        expect(JSON.stringify(metaRows(tables))).toBe(before);
        expect(historyRows(tables)).toHaveLength(0);
    });

    it('names the conversion per row, so a preview is actionable rather than a count', async () => {
        const { engine } = makeStubEngine([legacyObjectRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.rows).toHaveLength(1);
        const row = report.rows[0]!;
        expect(row).toMatchObject({ type: 'object', name: 'crm_invoice', outcome: 'pending', state: 'active' });
        expect(row.notices.length).toBeGreaterThan(0);
        expect(row.notices[0]!.from).toBe('conditionalRequired');
        expect(row.notices[0]!.to).toBe('requiredWhen');
        // An already-canonical row is counted, never itemised — otherwise a
        // healthy deployment's report is a wall of rows that need nothing.
        expect(report.rows.every((r) => r.outcome !== 'canonical')).toBe(true);
    });

    it('is not "clean" while work remains — that verdict is what a CI gate reads', async () => {
        const { engine } = makeStubEngine([legacyObjectRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        expect(storedMigrationClean(await protocol.migrateStoredMetadata())).toBe(false);
    });
});

describe('migrateStoredMetadata — apply (#4327)', () => {
    it('rewrites the row in place with the canonical body', async () => {
        const { engine, tables } = makeStubEngine([legacyObjectRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.rewritten).toBe(1);
        expect(report.pending).toBe(0);
        expect(storedMigrationClean(report)).toBe(true);

        const stored = JSON.parse(metaRows(tables)[0]!.metadata);
        expect(stored.fields.amount.requiredWhen).toBe("record.status == 'sent'");
        expect('conditionalRequired' in stored.fields.amount).toBe(false);
    });

    it('goes through the normal write path — history row, fresh checksum, migrate-stored source', async () => {
        const { engine, tables } = makeStubEngine([legacyObjectRow]);
        const seededChecksum = metaRows(tables)[0]!.checksum;
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.migrateStoredMetadata({ apply: true });

        const history = historyRows(tables);
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({
            type: 'object',
            name: 'crm_invoice',
            source: 'migrate-stored',
            // The lineage is intact: the new version's parent is the row's
            // pre-migration checksum, not a null "created from nothing".
            previous_checksum: seededChecksum,
        });
        // A rewritten body is a new content hash — the row is no longer
        // addressed by the checksum its legacy bytes had.
        expect(metaRows(tables)[0]!.checksum).not.toBe(seededChecksum);
        expect(metaRows(tables)[0]!.checksum).toBe(history[0]!.checksum);
    });

    it('re-running is a no-op — the second pass finds every row canonical', async () => {
        const { engine, tables } = makeStubEngine([legacyObjectRow, legacyActionRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const first = await protocol.migrateStoredMetadata({ apply: true });
        expect(first.rewritten).toBe(2);

        const second = await protocol.migrateStoredMetadata({ apply: true });
        expect(second.scanned).toBe(2);
        expect(second.canonical).toBe(2);
        expect(second.rewritten).toBe(0);
        expect(second.rows).toHaveLength(0);
        // Idempotence is the operator's verifiable statement: nothing new was
        // written on the second run either.
        expect(historyRows(tables)).toHaveLength(2);
    });

    it('rewrites a DRAFT row as a draft — the pass never promotes staged work live', async () => {
        const { engine, tables } = makeStubEngine([{ ...legacyObjectRow, state: 'draft' }]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.rewritten).toBe(1);
        expect(report.rows[0]).toMatchObject({ state: 'draft', outcome: 'rewritten' });
        expect(metaRows(tables)[0]!.state).toBe('draft');
    });

    it('walks every org, not just the env-wide bucket — and REPORTS the org-scoped residue it cannot rewrite', async () => {
        // The walk is what this case is named for, and the walk is unchanged:
        // both buckets are scanned. What changed is the org row's OUTCOME.
        //
        // [#6190, 2026-08-09] `action` is `allowOrgOverride: false`, so since
        // that ruling an org-scoped row of it cannot be written — and this pass
        // rewrites through `saveMetaItem`, so it is refused like any other
        // write. That is the correct outcome, not a gap to route around:
        //
        //   • Ruling 2 = A made existing org-scoped rows of such types
        //     NON-DESTRUCTIVE residue — audible, disposed of operationally,
        //     never rewritten by a migration. A canonicalization pass that
        //     quietly rewrote them would be doing exactly the migration the
        //     ruling declined to authorise, one row at a time.
        //   • And the refusal is not silent: the row surfaces in the report
        //     with the reason, which makes this pass a SECOND residue detector
        //     alongside the cold-boot warn (PR #6600).
        //
        // Deliberately NOT re-spelled to an org-overridable type: that would
        // have kept the assertion green while deleting the only coverage of
        // what the pass does with residue.
        const { engine, tables } = makeStubEngine([
            legacyObjectRow,
            { ...legacyActionRow, organization_id: 'org_a' },
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.scanned).toBe(2);
        expect(report.rewritten).toBe(1);
        expect(report.failed).toBe(1);

        const orgReport = report.rows.find((r: any) => r.type === 'action')!;
        expect(orgReport.outcome).toBe('failed');
        expect(orgReport.reason).toContain('cannot be written org-scoped');

        // Non-destructive: the stored bytes are exactly as they were.
        const orgRow = metaRows(tables).find((r) => r.organization_id === 'org_a')!;
        expect(JSON.parse(orgRow.metadata).execute).toBe('convertHandler');
    });

    it('leaves archived rows alone — they are a record of what was, not served metadata', async () => {
        const { engine, tables } = makeStubEngine([{ ...legacyObjectRow, state: 'archived' }]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.scanned).toBe(0);
        expect(JSON.parse(metaRows(tables)[0]!.metadata).fields.amount.conditionalRequired).toBeDefined();
    });

    it('restricts to the requested types', async () => {
        const { engine } = makeStubEngine([legacyObjectRow, legacyActionRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true, types: ['action'] });

        expect(report.scanned).toBe(1);
        expect(report.rows[0]).toMatchObject({ type: 'action', outcome: 'rewritten' });
    });
});

describe('migrateStoredMetadata — flow rows via the canonicalizeFlow hook (#4454)', () => {
    // A body the write path's schema gate accepts — the hook canonicalizes the
    // shape, it does not exempt the row from validation.
    const flowBody = (config: Record<string, unknown>) => ({
        name: 'purge_flow',
        label: 'Purge Stale Leads',
        type: 'autolaunched',
        status: 'active',
        nodes: [{ id: 'n1', type: 'delete_record', label: 'Purge', config }],
        edges: [],
    });
    const flowRow = {
        type: 'flow',
        name: 'purge_flow',
        metadata: flowBody({ objectName: 'lead', filters: { status: 'stale' } }),
    };
    /** Stands in for `AutomationEngine.canonicalizeStoredFlow` — same contract. */
    const canonicalizeFlow = (_name: string, body: any) => {
        const node = body?.nodes?.[0];
        if (!node || !('filters' in (node.config ?? {}))) {
            // Copy-on-write: an unchanged body comes back BY REFERENCE, which is
            // what the pass reads as "already canonical".
            return { storable: body, notices: [], conflicts: [] };
        }
        const { filters, ...rest } = node.config;
        return {
            storable: { ...body, nodes: [{ ...node, config: { ...rest, filter: filters } }] },
            notices: [{
                conversionId: 'flow-node-crud-filter-alias',
                surface: 'flow.node.config.filter',
                from: 'filters',
                to: 'filter',
                path: 'flows[0].nodes[0].config',
                message: 'filters → filter',
            }],
            conflicts: [],
        };
    };

    it('rewrites a flow row when the caller supplies the engine hook', async () => {
        const { engine, tables } = makeStubEngine([flowRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true, canonicalizeFlow });

        expect(report.rewritten).toBe(1);
        expect(report.skipped).toBe(0);
        const stored = JSON.parse(metaRows(tables)[0]!.metadata);
        expect(stored.nodes[0].config.filter).toEqual({ status: 'stale' });
        expect('filters' in stored.nodes[0].config).toBe(false);
        expect(historyRows(tables)[0]).toMatchObject({ type: 'flow', source: 'migrate-stored' });
    });

    it('still skips — with the reason — when no hook is supplied', async () => {
        const { engine, tables } = makeStubEngine([flowRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.skipped).toBe(1);
        expect(report.rows[0]!.reason).toMatch(/registerFlow/);
        expect(historyRows(tables)).toHaveLength(0);
    });

    it('counts an already-canonical flow as canonical, not as a rewrite', async () => {
        const canonicalFlow = {
            type: 'flow',
            name: 'purge_flow',
            metadata: flowBody({ objectName: 'lead', filter: { status: 'stale' } }),
        };
        const { engine, tables } = makeStubEngine([canonicalFlow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true, canonicalizeFlow });

        expect(report.canonical).toBe(1);
        expect(report.rewritten).toBe(0);
        expect(historyRows(tables)).toHaveLength(0);
    });

    it('rewrites a flow the hook changed WITHOUT emitting a notice — the condition envelope case', async () => {
        // The `{dialect, source}` envelope is a schema transform, not a
        // conversion, so it reports no notice while still changing the body.
        // Reading notices alone would call this row canonical and leave it
        // re-deriving on every boot — the exact thing the pass exists to end.
        const envelopeOnly = (_n: string, body: any) => ({
            storable: {
                ...body,
                edges: [{ ...body.edges[0], condition: { dialect: 'cel', source: "x == 'y'" } }],
            },
            notices: [],
            conflicts: [],
        });
        const row = {
            type: 'flow',
            name: 'purge_flow',
            metadata: {
                ...flowBody({ objectName: 'lead', filter: { status: 'stale' } }),
                edges: [{ id: 'e1', source: 'n1', target: 'n1', condition: "x == 'y'" }],
            },
        };
        const { engine, tables } = makeStubEngine([row]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true, canonicalizeFlow: envelopeOnly });

        expect(report.rewritten).toBe(1);
        expect(JSON.parse(metaRows(tables)[0]!.metadata).edges[0].condition)
            .toEqual({ dialect: 'cel', source: "x == 'y'" });
    });

    it('fails the row loudly when the guard refuses a rename over a live name', async () => {
        const conflicting = (_n: string, body: any) => ({
            storable: body,
            notices: [],
            conflicts: [{
                conversionId: 'flow-node-type-rename',
                token: 'webhook',
                path: 'flows[0].nodes[0].type',
                message: "'webhook' is registered by a custom executor in this environment.",
            }],
        });
        const { engine, tables } = makeStubEngine([flowRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true, canonicalizeFlow: conflicting });

        expect(report.failed).toBe(1);
        expect(report.rewritten).toBe(0);
        expect(report.rows[0]!.reason).toMatch(/live name/);
        expect(report.rows[0]!.reason).toMatch(/webhook/);
        // Never a silent skip and never a clobber — the owner's node survives.
        expect(historyRows(tables)).toHaveLength(0);
        expect(storedMigrationClean(report)).toBe(false);
    });

    it('reports a flow that cannot canonicalize instead of persisting a guess', async () => {
        const throwing = () => { throw new Error('Unrecognized key(s) on this flow: `_uiPosition`'); };
        const { engine, tables } = makeStubEngine([flowRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true, canonicalizeFlow: throwing });

        expect(report.failed).toBe(1);
        expect(report.rows[0]!.reason).toMatch(/does not canonicalize/);
        expect(report.rows[0]!.reason).toMatch(/_uiPosition/);
        expect(historyRows(tables)).toHaveLength(0);
    });
});

describe('migrateStoredMetadata — what it declines to touch, loudly (#4327)', () => {
    it('skips flow rows and names the seam that owns them', async () => {
        const legacyFlow = {
            type: 'flow',
            name: 'purge_flow',
            metadata: {
                name: 'purge_flow',
                nodes: [{ id: 'n1', type: 'delete_record', config: { objectName: 'lead', filters: { status: 'stale' } } }],
            },
        };
        const { engine, tables } = makeStubEngine([legacyFlow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.skipped).toBe(1);
        expect(report.rewritten).toBe(0);
        expect(report.rows[0]!.reason).toMatch(/registerFlow/);
        expect(JSON.parse(metaRows(tables)[0]!.metadata).nodes[0].config.filters).toEqual({ status: 'stale' });
        // A skipped row is a documented carve-out, not unfinished work: it does
        // not fail the run's verdict, but the report always names it.
        expect(storedMigrationClean(report)).toBe(true);
    });

    it('skips a type with no repository write path rather than rewriting it without history', async () => {
        // `agent` is allowOrgOverride:false + allowRuntimeCreate:false. The
        // skip is what this test pins, and it is unchanged; only its rationale
        // moved. It used to be "`saveMetaItem` would take the legacy raw-engine
        // branch: no history row and a forced `state: 'active'`" — #5086
        // (PR #5263) then made `saveMetaItem` refuse a code-only type with 403
        // before persistence, and #5264 deleted the now-unreachable branch. So
        // today the pass declines a write that would be refused anyway, which
        // keeps it a reported `skipped` row instead of `failed` noise.
        const { engine, tables } = makeStubEngine([
            { type: 'agent', name: 'legacy_agent', metadata: { name: 'legacy_agent', label: 'Legacy' } },
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.skipped).toBe(1);
        expect(report.rows[0]!.reason).toMatch(/no repository write path/);
        expect(historyRows(tables)).toHaveLength(0);
    });

    it('reports a row whose body is not JSON instead of throwing the whole run away', async () => {
        const { engine } = makeStubEngine([
            { type: 'object', name: 'broken', metadata: '{ not json' },
            legacyObjectRow,
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.failed).toBe(1);
        expect(report.rewritten).toBe(1);
        expect(report.rows.find((r) => r.name === 'broken')!.reason).toMatch(/not valid JSON/);
        expect(storedMigrationClean(report)).toBe(false);
    });

    it('reports — and does not write — a row that still fails the schema after conversion', async () => {
        // `fields` as a number is a genuine contract violation no conversion
        // owns. `saveMetaItem`'s 422 is correct, and the row keeps reading
        // through the chain: this pass records the refusal rather than
        // bypassing the gate that new rows are held to.
        const { engine, tables } = makeStubEngine([
            {
                type: 'object',
                name: 'corrupt_thing',
                metadata: {
                    name: 'corrupt_thing',
                    label: 'Corrupt',
                    fields: { amount: { type: 'currency', conditionalRequired: 'x' } },
                    // an off-contract key the schema rejects and no conversion lowers
                    listViews: 42,
                },
            },
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.failed).toBe(1);
        expect(report.rewritten).toBe(0);
        expect(report.rows[0]!.reason).toMatch(/failed spec validation/);
        expect(historyRows(tables)).toHaveLength(0);
        expect(JSON.parse(metaRows(tables)[0]!.metadata).fields.amount.conditionalRequired).toBe('x');
    });

    it('does not clobber a row a concurrent writer moved — the optimistic lock is real', async () => {
        const { engine, tables } = makeStubEngine([legacyObjectRow]);
        // Someone else saved between the pass's scan and its write: the scan is
        // handed the checksum the body was read under, the row on disk has
        // already moved on.
        metaRows(tables)[0]!.checksum = 'sha256:moved_by_someone_else';
        const protocol = new ObjectStackProtocolImplementation(engine);
        const originalFind = engine.find.bind(engine);
        let served = false;
        engine.find = async (t: string, opts?: any) => {
            const rows = await originalFind(t, opts);
            if (t === 'sys_metadata' && !served) {
                served = true;
                return rows.map((r: any) => ({ ...r, checksum: 'sha256:stale' }));
            }
            return rows;
        };

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.failed).toBe(1);
        expect(report.rows[0]!.reason).toMatch(/has been modified since you loaded it/);
        // The other writer's row is untouched.
        expect(metaRows(tables)[0]!.checksum).toBe('sha256:moved_by_someone_else');
    });
});

describe('formatStoredMigrationReport (#4327)', () => {
    it('leads with the verdict when everything is already canonical', async () => {
        const { engine } = makeStubEngine([canonicalObjectRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const lines = formatStoredMigrationReport(await protocol.migrateStoredMetadata());
        expect(lines.join('\n')).toMatch(/already on protocol/);
    });

    it('refuses to call an empty scan clean — that is the wrong-directory reading too', async () => {
        const { engine } = makeStubEngine([]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const report = await protocol.migrateStoredMetadata();
        expect(report.scanned).toBe(0);
        const text = formatStoredMigrationReport(report).join('\n');
        expect(text).toMatch(/attests nothing/);
        expect(text).not.toMatch(/already on protocol/);
    });

    it('prints each pending row with the conversion that would fire', async () => {
        const { engine } = makeStubEngine([legacyObjectRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const text = formatStoredMigrationReport(await protocol.migrateStoredMetadata()).join('\n');
        expect(text).toMatch(/object\/crm_invoice \[env-wide\]/);
        expect(text).toMatch(/conditionalRequired → requiredWhen/);
    });
});

describe('migrateStoredMetadata — a site the chain leaves as stored is a TODO, not silence (#17321)', () => {
    // Ruling item 2 (decision batch #121 item 4, B): a stored page filter
    // carrying `$and` / `$or` / `$not` is passed through unchanged and
    // reported as a structured TODO naming the page/block and the combinator —
    // `os migrate meta --stored` prints the list, so the operator can answer
    // "did it convert my row" from that output.
    //
    // Before the TODO lane existed, the conversion emitted NO notice for such a
    // site, this pass reads notices as its change signal, and so a page whose
    // only legacy filter carried a combinator was counted `canonical` —
    // "already on protocol" about a row whose next save is refused.
    const COMBINATOR = { $or: [{ stage: 'open' }, { stage: 'won' }] };
    const pageRow = (name: string, components: unknown[]) => ({
        type: 'page',
        name,
        metadata: { name, label: 'Pipeline', type: 'app', regions: [{ name: 'main', components }] },
    });
    const kanban = (filter: unknown) => ({ type: 'object-kanban', properties: { objectName: 'deal', filter } });
    const grid = (filter: unknown) => ({ type: 'object-grid', properties: { objectName: 'deal', filter } });
    const combinatorPage = pageRow('pipeline_board', [kanban(COMBINATOR)]);
    const losslessPage = pageRow('open_deals', [grid({ stage: 'open' })]);
    const mixedPage = pageRow('deal_desk', [grid({ stage: 'open' }), kanban(COMBINATOR)]);
    const canonicalPage = pageRow('won_deals', [grid([{ field: 'stage', operator: 'equals', value: 'won' }])]);

    it('a combinator-only page is listed with a TODO naming its path and the combinator — not counted canonical', async () => {
        const { engine, tables } = makeStubEngine([combinatorPage]);
        const before = JSON.stringify(metaRows(tables));
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.canonical).toBe(0);
        expect(report.skipped).toBe(1);
        expect(report.rows).toHaveLength(1);
        const row = report.rows[0]!;
        expect(row).toMatchObject({ type: 'page', name: 'pipeline_board', outcome: 'skipped', notices: [] });
        expect(row.reason).toMatch(/left 1 site\(s\) of this row as stored/);
        expect(row.todos).toHaveLength(1);
        const todo = row.todos[0]!;
        expect(todo.conversionId).toBe('page-component-filter-record-to-rule-array');
        expect(todo.path).toBe('pages[0].regions[0].components[0].properties.filter');
        expect(todo.from).toBe(JSON.stringify(COMBINATOR));
        expect(todo.reason).toContain('the `object-kanban` block');
        expect(todo.reason).toContain('the combinator `$or`');
        // A TODO is reporting only: nothing written, and the filter is never flattened.
        expect(JSON.stringify(metaRows(tables))).toBe(before);

        // The operator reads it off the rendered report: the row, the path, the combinator.
        const text = formatStoredMigrationReport(report).join('\n');
        expect(text).toContain('page/pipeline_board [env-wide]');
        expect(text).toContain(`TODO page-component-filter-record-to-rule-array: ${JSON.stringify(COMBINATOR)} left as stored at pages[0].regions[0].components[0].properties.filter`);
        expect(text).toContain('`$or`');
        expect(text).toMatch(/☐ TODO: 1 site\(s\) in 1 row\(s\) are left as stored/);
        // …and is never told the opposite in the same breath.
        expect(text).not.toMatch(/already on protocol/);
    });

    it('does not flip `storedMigrationClean` — a skip class this pass has no lever for, by ruling', async () => {
        const { engine, tables } = makeStubEngine([combinatorPage]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const preview = await protocol.migrateStoredMetadata();
        expect(storedMigrationClean(preview)).toBe(true);

        // An apply run writes nothing for it either, and says the same thing.
        const applied = await protocol.migrateStoredMetadata({ apply: true });
        expect(applied.rows[0]).toMatchObject({ outcome: 'skipped' });
        expect(applied.rows[0]!.todos).toHaveLength(1);
        expect(storedMigrationClean(applied)).toBe(true);
        expect(historyRows(tables)).toHaveLength(0);
    });

    it('CONTROL — a losslessly folded filter produces no TODO, and its outcome is unchanged', async () => {
        const { engine, tables } = makeStubEngine([losslessPage]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const preview = await protocol.migrateStoredMetadata();
        expect(preview.rows).toHaveLength(1);
        expect(preview.rows[0]).toMatchObject({ outcome: 'pending', todos: [] });
        expect(preview.rows[0]!.notices.map((n) => n.path)).toEqual([
            'pages[0].regions[0].components[0].properties.filter',
        ]);
        expect(formatStoredMigrationReport(preview).join('\n')).not.toMatch(/TODO/);

        const applied = await protocol.migrateStoredMetadata({ apply: true });
        expect(applied.rows[0]).toMatchObject({ outcome: 'rewritten', todos: [] });
        expect(storedMigrationClean(applied)).toBe(true);
        const stored = JSON.parse(metaRows(tables)[0]!.metadata);
        expect(stored.regions[0].components[0].properties.filter).toEqual([
            { field: 'stage', operator: 'equals', value: 'open' },
        ]);
    });

    it('CONTROL — an already-canonical page is counted, never itemised, and reports no TODO', async () => {
        const { engine } = makeStubEngine([canonicalPage]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.canonical).toBe(1);
        expect(report.rows).toHaveLength(0);
        const text = formatStoredMigrationReport(report).join('\n');
        expect(text).toMatch(/already on protocol/);
        expect(text).not.toMatch(/TODO/);
    });

    it('one row, two filters: the lossless one converts, the combinator one is a TODO on the same row', async () => {
        const { engine } = makeStubEngine([mixedPage]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        // The outcome is what the notice alone makes it — TODOs never move it.
        expect(report.pending).toBe(1);
        expect(storedMigrationClean(report)).toBe(false);
        const row = report.rows[0]!;
        expect(row.outcome).toBe('pending');
        expect(row.notices.map((n) => n.path)).toEqual(['pages[0].regions[0].components[0].properties.filter']);
        expect(row.todos.map((t) => t.path)).toEqual(['pages[0].regions[0].components[1].properties.filter']);
        expect(row.todos[0]!.reason).toContain('the combinator `$or`');

        const text = formatStoredMigrationReport(report).join('\n');
        const rowAt = text.indexOf('page/deal_desk');
        const noticeAt = text.indexOf('page-component-filter-record-to-rule-array: {"stage":"open"} →');
        const todoAt = text.indexOf('TODO page-component-filter-record-to-rule-array:');
        // Both nested under the row, the conversion first.
        expect(rowAt).toBeGreaterThanOrEqual(0);
        expect(noticeAt).toBeGreaterThan(rowAt);
        expect(todoAt).toBeGreaterThan(noticeAt);
    });

    it('MEASURED — the write path judges the two door kinds differently, and the TODO rides on either outcome', async () => {
        // `properties.filter` sits in the page component's open `properties` bag:
        // the runtime save door does not parse it by `type` (the props gate is
        // `@objectstack/lint`'s, advisory). `dataSource.filter` is a declared key
        // of the strict component schema, so the save door refuses it there.
        const bindingMixed = pageRow('deal_room', [
            grid({ stage: 'open' }),
            { type: 'object-kanban', dataSource: { object: 'deal', filter: COMBINATOR }, properties: { objectName: 'deal' } },
        ]);
        // The third door: `defaultFilters` on the grid, the same open bag.
        const defaultsMixed = pageRow('deal_grid', [
            { type: 'object-grid', properties: { objectName: 'deal', filter: { stage: 'open' }, defaultFilters: COMBINATOR } },
        ]);
        const { engine, tables } = makeStubEngine([mixedPage, bindingMixed, defaultsMixed]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        const props = report.rows.find((r) => r.name === 'deal_desk')!;
        expect(props.outcome).toBe('rewritten');
        expect(props.todos.map((t) => t.path)).toEqual(['pages[0].regions[0].components[1].properties.filter']);
        const binding = report.rows.find((r) => r.name === 'deal_room')!;
        expect(binding.outcome).toBe('failed');
        expect(binding.todos.map((t) => t.path)).toEqual(['pages[0].regions[0].components[1].dataSource.filter']);
        const defaults = report.rows.find((r) => r.name === 'deal_grid')!;
        expect(defaults.outcome).toBe('rewritten');
        expect(defaults.todos.map((t) => t.path)).toEqual(['pages[0].regions[0].components[0].properties.defaultFilters']);
        const storedDefaults = JSON.parse(metaRows(tables).find((r) => r.name === 'deal_grid')!.metadata);
        expect(storedDefaults.regions[0].components[0].properties.defaultFilters).toEqual(COMBINATOR);

        // The rewritten row persisted its lossless half; the combinator is byte-identical.
        const stored = JSON.parse(metaRows(tables).find((r) => r.name === 'deal_desk')!.metadata);
        expect(stored.regions[0].components[0].properties.filter).toEqual([
            { field: 'stage', operator: 'equals', value: 'open' },
        ]);
        expect(stored.regions[0].components[1].properties.filter).toEqual(COMBINATOR);

        // Re-run: what is left of the rewritten row is its TODO — skipped, never canonical.
        const again = await protocol.migrateStoredMetadata({ apply: true, types: ['page'] });
        const rerun = again.rows.find((r) => r.name === 'deal_desk')!;
        expect(rerun.outcome).toBe('skipped');
        expect(rerun.todos).toHaveLength(1);
        expect(again.canonical).toBe(0);
    });
});

describe('migrateStoredMetadata — the decision review list: stored rows take first-match, and are LISTED, never rewritten (#15429, ruling C)', () => {
    // Maintainer ruling letter C on #15429: a stored decision with no
    // `conditions` list, no `mode` and two or more conditioned out-edges takes
    // the protocol-18 meaning (first match) on upgrade — no stored-row rewrite,
    // no cutoff, no read-path completion — and `os migrate meta --stored` lists
    // every such node, report only, so an operator can review candidates
    // before and after the upgrade.
    //
    // The hotcrm#1555 shape: both predicates hold for a confirmed lead.
    const OVERLAP = { a: "lead.status != 'suspected'", b: "lead.status == 'confirmed'" };
    const gatewayBody = (name: string, opts: {
        config?: Record<string, unknown>;
        b?: string;
        bType?: string;
        withDefault?: boolean;
        withLegacyPurge?: boolean;
    } = {}) => ({
        name,
        label: 'Lead Verdict',
        type: 'autolaunched',
        status: 'active',
        nodes: [
            // A second, unrelated pre-protocol shape the canonicalizer rewrites,
            // so an apply run DOES write this row — and must still write no `mode`.
            ...(opts.withLegacyPurge
                ? [{ id: 'purge', type: 'delete_record', label: 'Purge', config: { objectName: 'lead', filters: { status: 'stale' } } }]
                : []),
            { id: 'check', type: 'decision', label: 'Verdict?', ...(opts.config ? { config: opts.config } : {}) },
            { id: 'refuse', type: 'end', label: 'Refuse' },
            { id: 'convert', type: 'end', label: 'Convert' },
            ...(opts.withDefault ? [{ id: 'fallback', type: 'end', label: 'Fallback' }] : []),
        ],
        edges: [
            { id: 'e_refuse', source: 'check', target: 'refuse', condition: OVERLAP.a },
            {
                id: 'e_convert', source: 'check', target: 'convert',
                ...(opts.bType ? { type: opts.bType } : {}),
                ...(opts.b === '' ? {} : { condition: opts.b ?? OVERLAP.b }),
            },
            ...(opts.withDefault ? [{ id: 'e_fallback', source: 'check', target: 'fallback', isDefault: true }] : []),
        ],
    });
    const flowRow = (name: string, body: unknown, extra: Record<string, unknown> = {}) =>
        ({ type: 'flow', name, metadata: body, ...extra });
    /**
     * Stands in for `AutomationEngine.canonicalizeStoredFlow`, and answers what
     * the real seam answers for these bodies: it refuses the D2 entry by id, so
     * a two-branch decision comes back WITHOUT `mode`. It rewrites only the
     * legacy `filters` alias, so a row carrying one is a real rewrite.
     */
    const canonicalizeFlow = (_name: string, body: any) => {
        const purge = body?.nodes?.find((n: any) => n.id === 'purge');
        if (!purge || !('filters' in (purge.config ?? {}))) return { storable: body, notices: [], conflicts: [] };
        return {
            storable: {
                ...body,
                nodes: body.nodes.map((n: any) => (n === purge
                    ? { ...n, config: { objectName: 'lead', filter: purge.config.filters } }
                    : n)),
            },
            notices: [{
                conversionId: 'flow-node-crud-filter-alias',
                surface: 'flow.node.config.filter',
                from: 'filters',
                to: 'filter',
                path: 'flows[0].nodes[0].config',
                message: 'filters → filter',
            }],
            conflicts: [],
        };
    };

    it('a stored two-branch decision with no `mode` is LISTED — row, flow, node, label and path — and the row is canonical', async () => {
        const { engine, tables } = makeStubEngine([flowRow('lead_verdict', gatewayBody('lead_verdict'), { organization_id: 'org_1' })]);
        const before = JSON.stringify(metaRows(tables));
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ canonicalizeFlow });

        expect(report.decisionModeReview).toEqual([{
            id: metaRows(tables)[0]!.id,
            name: 'lead_verdict',
            organizationId: 'org_1',
            packageId: null,
            state: 'active',
            nodeId: 'check',
            nodeLabel: 'Verdict?',
            path: 'nodes[0]',
        }]);
        // ON protocol: listed, not pending — the list moves no count and no verdict.
        expect(report).toMatchObject({ scanned: 1, canonical: 1, pending: 0, skipped: 0, failed: 0, rows: [] });
        expect(storedMigrationClean(report)).toBe(true);
        expect(JSON.stringify(metaRows(tables))).toBe(before);
    });

    it('`--apply` changes nothing for it: no rewrite, no history row, the stored bytes identical — and the list is the same', async () => {
        const { engine, tables } = makeStubEngine([flowRow('lead_verdict', gatewayBody('lead_verdict'))]);
        const before = JSON.stringify(metaRows(tables));
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true, canonicalizeFlow });

        expect(report.decisionModeReview.map((r) => `${r.name}:${r.nodeId}`)).toEqual(['lead_verdict:check']);
        expect(report).toMatchObject({ canonical: 1, rewritten: 0, failed: 0 });
        expect(historyRows(tables)).toHaveLength(0);
        expect(JSON.stringify(metaRows(tables))).toBe(before);
        expect(JSON.parse(metaRows(tables)[0]!.metadata).nodes[0]).not.toHaveProperty('config');
    });

    it('a row `--apply` DOES rewrite for another conversion persists no `mode` — the list never rides into the write', async () => {
        const { engine, tables } = makeStubEngine([flowRow('lead_verdict', gatewayBody('lead_verdict', { withLegacyPurge: true }))]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true, canonicalizeFlow });

        expect(report.rewritten).toBe(1);
        expect(report.rows[0]!.notices.map((n) => n.conversionId)).toEqual(['flow-node-crud-filter-alias']);
        const stored = JSON.parse(metaRows(tables)[0]!.metadata);
        expect(stored.nodes.find((n: any) => n.id === 'purge').config).toEqual({ objectName: 'lead', filter: { status: 'stale' } });
        expect(stored.nodes.find((n: any) => n.id === 'check')).not.toHaveProperty('config');
        expect(report.decisionModeReview.map((r) => `${r.nodeId}@${r.path}`)).toEqual(['check@nodes[1]']);
    });

    it('needs no engine: with no canonicalizer the flow row is `skipped` and its decision is STILL listed', async () => {
        const { engine } = makeStubEngine([flowRow('lead_verdict', gatewayBody('lead_verdict'))]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.skipped).toBe(1);
        expect(report.rows[0]!.reason).toMatch(/no automation service/);
        expect(report.decisionModeReview.map((r) => r.nodeId)).toEqual(['check']);
    });

    it('lists a decision inside a loop body, judged against the region\'s own edges, at its region path', async () => {
        const body = {
            name: 'lead_sweep',
            label: 'Sweep',
            type: 'autolaunched',
            status: 'active',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'sweep', type: 'loop', label: 'Sweep',
                    config: {
                        collection: '{leads}',
                        iteratorVariable: 'lead',
                        body: {
                            nodes: [
                                { id: 'gate', type: 'decision' },
                                { id: 'x', type: 'end', label: 'X' },
                                { id: 'y', type: 'end', label: 'Y' },
                            ],
                            edges: [
                                { id: 'g1', source: 'gate', target: 'x', condition: OVERLAP.a },
                                { id: 'g2', source: 'gate', target: 'y', condition: { dialect: 'cel', source: OVERLAP.b } },
                            ],
                        },
                    },
                },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'sweep' }],
        };

        expect(collectDecisionModeReview(body)).toEqual([{ nodeId: 'gate', path: 'nodes[1].config.body.nodes[0]' }]);
    });

    it('CONTROLS — a declared `mode` (either member), one conditioned edge beside a default, a `conditions` list and a `fault` second edge are NOT listed', () => {
        expect(collectDecisionModeReview(gatewayBody('f', { config: { mode: 'exclusive' } }))).toEqual([]);
        expect(collectDecisionModeReview(gatewayBody('f', { config: { mode: 'inclusive' } }))).toEqual([]);
        expect(collectDecisionModeReview(gatewayBody('f', { b: '', withDefault: true }))).toEqual([]);
        expect(collectDecisionModeReview(gatewayBody('f', {
            config: { conditions: [{ label: 'Refuse', expression: OVERLAP.a }] },
        }))).toEqual([]);
        expect(collectDecisionModeReview(gatewayBody('f', { bType: 'fault' }))).toEqual([]);
        // …and the POSITIVE for the same builder, so the controls cannot pass vacuously.
        expect(collectDecisionModeReview(gatewayBody('f')).map((r) => r.nodeId)).toEqual(['check']);
    });

    it('ONE PREDICATE — the list is exactly what the `--from 17` chain writes `mode` at, through the same registry entry', () => {
        const body = gatewayBody('lead_verdict');
        const bodyBytes = JSON.stringify(body);

        const listed = collectDecisionModeReview(body).map((r) => `flows[0].${r.path}.config.mode`);
        const chain = applyMetaMigrations({ flows: [body] }, 17, 18);
        const written = chain.applied
            .filter((a) => a.conversionId === DECISION_MODE_REVIEW_CONVERSION_ID)
            .map((a) => a.path);

        expect(written).toEqual(['flows[0].nodes[0].config.mode']);
        expect(listed).toEqual(written);
        // The listing ran the entry and discarded its output: the body is untouched.
        expect(JSON.stringify(body)).toBe(bodyBytes);
    });

    it('the renderer prints the list with the one-line fix, beside — not instead of — the on-protocol verdict', async () => {
        const { engine } = makeStubEngine([flowRow('lead_verdict', gatewayBody('lead_verdict'), { state: 'draft' })]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const text = formatStoredMigrationReport(await protocol.migrateStoredMetadata({ canonicalizeFlow })).join('\n');

        expect(text).toMatch(/1 decision node\(s\) in 1 flow row\(s\) take the FIRST matching branch since protocol 18/);
        expect(text).toContain(`flow/lead_verdict [env-wide, draft] — decision 'check' "Verdict?" at nodes[0]`);
        expect(text).toContain("declare `mode: 'inclusive'`");
        expect(text).toMatch(/already on protocol/);
    });

    it('CONTROL — a run with nothing to review prints no review section', async () => {
        const { engine } = makeStubEngine([flowRow('lead_verdict', gatewayBody('lead_verdict', { config: { mode: 'exclusive' } }))]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ canonicalizeFlow });

        expect(report.decisionModeReview).toEqual([]);
        expect(formatStoredMigrationReport(report).join('\n')).not.toMatch(/FIRST matching branch/);
    });
});
