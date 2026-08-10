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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { formatStoredMigrationReport, storedMigrationClean } from './stored-migration.js';

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
    seedRows: Array<Partial<Row> & { type: string; name: string; metadata: unknown }>,
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
        expect(report.rows[0]!.reason).toMatch(/invalid_metadata/);
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
        expect(report.rows[0]!.reason).toMatch(/metadata_conflict/);
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
