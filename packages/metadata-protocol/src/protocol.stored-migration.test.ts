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
            const target = rowsOf(t).find((r) => matches(r, opts.where));
            if (target) Object.assign(target, patch);
            return target ?? { id: 'x' };
        },
        async delete() { return { deleted: 0 }; },
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
    metadata: { name: 'convert', label: 'Convert', type: 'script', object: 'crm_invoice', execute: 'convertHandler' },
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

    it('walks every org, not just the env-wide bucket', async () => {
        const { engine, tables } = makeStubEngine([
            legacyObjectRow,
            { ...legacyActionRow, organization_id: 'org_a' },
        ]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.scanned).toBe(2);
        expect(report.rewritten).toBe(2);
        const orgRow = metaRows(tables).find((r) => r.organization_id === 'org_a')!;
        expect(JSON.parse(orgRow.metadata).target).toBe('convertHandler');
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
        // `agent` is allowOrgOverride:false + allowRuntimeCreate:false, so
        // `saveMetaItem` would take the legacy raw-engine branch: no history row
        // and a forced `state: 'active'`. Declining beats a silent half-write.
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
