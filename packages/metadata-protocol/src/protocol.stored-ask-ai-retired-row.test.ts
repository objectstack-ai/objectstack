// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0160 D7, seventh amendment — a stored `action` row whose `type` is the
 * retired `ask_ai` IS the action the conversion `action-type-ask-ai-removed`
 * deletes, so the stored seam (`applyConversionsToStoredItem`) yields no item
 * of it. Pinned here on the protocol's own doors, over the same stub engine as
 * `protocol.migrate-stored-noncanonical-type.test.ts`:
 *
 *   - `migrateStoredMetadata` lists the row `skipped` with the way out (delete
 *     it by name through the metadata API), on a preview and an apply run
 *     alike, and writes nothing — there is no body to re-save;
 *   - the list read serves nothing for it, and the live row beside it as
 *     stored;
 *   - a by-name read previewing drafts treats a pending draft row of it as no
 *     draft, and serves the active item;
 *   - the layered read reports no overlay for it and no pending draft, and
 *     its version token still names the stored row, so a publish pinned to
 *     it replaces the row;
 *   - the metadata API's delete (`deleteMetaItem`, through
 *     `SysMetadataRepository`) still reaches the row and takes it out.
 */
import { describe, expect, it } from 'vitest';
// Paid during collection, not inside a clocked case: the diagnostics `import()` it in a function body (`scripts/check-test-source-alias.mjs`).
import '@objectstack/lint';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { NO_PACKAGE_SCOPED_READS } from './no-package-scoped-reads.testkit.js';
import { ObjectStackProtocolImplementation } from './protocol.js';

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

/**
 * What {@link makeStubEngine} accepts for one seeded row.
 *
 * `metadata` is `Omit`-ed out of the `Partial<Row>` half rather than merely
 * intersected over it: on the row `metadata` is the STORED string, and
 * `string & unknown` is `string`, so a plain intersection refuses every body
 * written as an object literal — the seeding convenience this harness exists
 * for. Stated once, here, so the fixtures below need no casts.
 */
type SeedRow = Omit<Partial<Row>, 'metadata'> & { type: string; name: string; metadata: unknown };

function matches(r: Record<string, any>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if ((r[k] ?? null) !== v) return false;
    }
    return true;
}

/**
 * The same multi-table stub as `protocol.stored-migration.test.ts`: rows are
 * seeded STRAIGHT into `sys_metadata`, the only way to hold a row that every
 * authoring door now refuses.
 */
function makeStubEngine(seedRows: SeedRow[], registered: Record<string, unknown>[] = []) {
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
        async find(t: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            const rows = rowsOf(t).filter((r) => matches(r, opts?.where ?? {}));
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
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
        async delete(t: string, opts?: Record<string, unknown>) {
            // [#4550] The producer's own delete-verb dispatch contract.
            assertEngineDeleteDispatch(opts);
            const rows = rowsOf(t);
            const at = rows.findIndex((r) => r.id === (opts as { where?: { id?: unknown } })?.where?.id);
            if (at >= 0) rows.splice(at, 1);
            return { deleted: at >= 0 ? 1 : 0 };
        },
        registry: {
            ...NO_PACKAGE_SCOPED_READS,
            listItems: () => [],
            getItem: (type: string, name: string) =>
                (type === 'action' ? registered.find((i) => i.name === name) : undefined),
            isPackageDisabled: () => false,
            registerItem: () => { /* no-op */ },
            registerObject: () => { /* no-op */ },
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => { /* no-op */ },
        },
    };
    return { engine, tables };
}

const metaRows = (tables: Map<string, Record<string, any>[]>) => tables.get('sys_metadata')!;
const historyRows = (tables: Map<string, Record<string, any>[]>) =>
    tables.get('sys_metadata_history') ?? [];

const askAiRow: SeedRow = {
    type: 'action',
    name: 'ask_about_ticket',
    metadata: { name: 'ask_about_ticket', label: 'Ask AI', objectName: 'ticket', type: 'ask_ai' },
};
const liveRow: SeedRow = {
    type: 'action',
    name: 'close_ticket',
    metadata: { name: 'close_ticket', label: 'Close', objectName: 'ticket', type: 'script', target: 'close_ticket' },
};

describe('a stored ask_ai action row (ADR-0160 D7)', () => {
    it('the stored pass lists it skipped, with the delete door named', async () => {
        const { engine } = makeStubEngine([askAiRow, liveRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata();

        expect(report.skipped).toBe(1);
        const row = report.rows.find((r) => r.name === 'ask_about_ticket')!;
        expect(row).toMatchObject({ type: 'action', outcome: 'skipped' });
        expect(row.notices.map((n) => n.conversionId)).toContain('action-type-ask-ai-removed');
        expect(row.reason).toContain('DELETE /api/v1/meta/action/ask_about_ticket');
    });

    it('an apply run writes nothing for it', async () => {
        const { engine, tables } = makeStubEngine([askAiRow]);
        const before = JSON.stringify(metaRows(tables));
        const protocol = new ObjectStackProtocolImplementation(engine);

        const report = await protocol.migrateStoredMetadata({ apply: true });

        expect(report.skipped).toBe(1);
        expect(report.rewritten).toBe(0);
        expect(JSON.stringify(metaRows(tables))).toBe(before);
        expect(historyRows(tables)).toHaveLength(0);
    });

    it('the list read serves nothing for it, and the live row beside it', async () => {
        const { engine } = makeStubEngine([askAiRow, liveRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const served = await protocol.getMetaItems({ type: 'action' });
        const names = ((served as { items?: Array<{ name: string }> }).items ?? []).map((i) => i.name);

        expect(names).toContain('close_ticket');
        expect(names).not.toContain('ask_about_ticket');
    });

    it('a by-name read previewing drafts treats a pending ask_ai draft as no draft, and serves the active item', async () => {
        // The active item is the registry's (a hydrated live row); the draft
        // row of the same name is of the retired type.
        const active = { name: 'ask_about_ticket', label: 'Close', objectName: 'ticket', type: 'script', target: 'close_ticket' };
        const { engine } = makeStubEngine([{ ...askAiRow, state: 'draft' }], [active]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const served = await protocol.getMetaItem({ type: 'action', name: 'ask_about_ticket', previewDrafts: true });

        expect((served as { item?: unknown }).item).toMatchObject(active);
        expect((served as { item?: Record<string, unknown> }).item?._draft).toBeUndefined();
    });

    it('the layered read reports no overlay and no pending draft for it', async () => {
        const { engine } = makeStubEngine([askAiRow, { ...askAiRow, state: 'draft' }]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        const layered = await protocol.getMetaItemLayered({ type: 'action', name: 'ask_about_ticket' }, { withDraft: true, withVersion: true });

        expect(layered).toMatchObject({ overlay: null, overlayScope: null, draft: null });
        expect(layered.overlayVersion).toEqual(expect.any(String));
    });

    it('the layered version token still names the stored row, so a publish pinned to it replaces the row', async () => {
        // Studio pins a publish to the layered read's `overlayVersion`. A
        // `null` token would pin `If-None-Match: *`, which the row still
        // stored at the address refuses `409`; the stored row's token lets a
        // new action of the name be published over it.
        const { engine, tables } = makeStubEngine([askAiRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);
        const { overlayVersion } = await protocol.getMetaItemLayered({ type: 'action', name: 'ask_about_ticket' }, { withVersion: true });
        const live = { name: 'ask_about_ticket', label: 'Close', objectName: 'ticket', type: 'script', target: 'close_ticket' };

        await protocol.saveMetaItem({ type: 'action', name: 'ask_about_ticket', item: live, mode: 'draft' });
        await protocol.publishMetaItem({ type: 'action', name: 'ask_about_ticket', parentVersion: overlayVersion });

        expect(metaRows(tables).map((r) => [r.state, JSON.parse(r.metadata).type])).toEqual([['active', 'script']]);
    });

    it('the metadata API delete reaches the row and takes it out', async () => {
        const { engine, tables } = makeStubEngine([askAiRow, liveRow]);
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.deleteMetaItem({ type: 'action', name: 'ask_about_ticket' });

        expect(metaRows(tables).map((r) => r.name)).toEqual(['close_ticket']);
    });
});
