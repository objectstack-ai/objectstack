// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12194 — the metadata item-name grammar is enforced at the publish door.
 *
 * Stage 1 of #12176's maintainer-ruled retirement of compound-name addressing
 * (2026-08-25): item names are lowercase snake_case segments, optionally
 * dot-qualified (`METADATA_ITEM_NAME_PATTERN`, `@objectstack/spec/shared` —
 * the same segment source as `ViewItemNameSchema`'s dot-required arity), and
 * `saveMetaItem` / `publishMetaItem` refuse an off-grammar name loudly.
 *
 * What the #12176 census measured BEFORE this landed — every refusal case in
 * this suite was an acceptance then: `''`, `'a//b'`, `'Views/All Leads'` and
 * `'views/all_leads'` were all accepted and stored as item names, and a slash
 * in the name BYPASSED the #8421 unrecognised-type refusal entirely
 * (`type=fieldz name='a'` → 400 while `type=fieldz name='a/b'` was accepted
 * and stored). This suite is that census's probe table, pinned.
 *
 * ## What this suite pins, in both directions
 *
 * A suite that only asserted "junk is refused" would be satisfied by a door
 * that refuses everything, so:
 *
 *  - flat snake_case still saves, and the DOTTED qualified form still saves —
 *    the ruling keeps the dot (`ViewItemNameSchema`'s convention becomes
 *    enforced-optional at this door, Q2 = B);
 *  - every junk shape is refused with the ADR-0112 envelope (`code` AND
 *    `status`, never a bare throw) and NOTHING is persisted;
 *  - the slash bypass of `refuseUnmintableMetaType` is closed: an
 *    unrecognised type + slash name is refused (grammar reason), and the
 *    unrecognised-type refusal itself still fires for grammatical names
 *    (anti-vacuity control);
 *  - the promotion door (`publishMetaItem`) enforces the same grammar;
 *  - reads and DELETE stay open for pre-grammar residue rows, or the
 *    accumulation would become one nobody can clear.
 *
 * Harness: the real `saveMetaItem` write path over a stub engine — the pinned
 * shape `protocol.unrecognised-meta-type.test.ts` carries. A gate INSIDE
 * `saveMetaItem` cannot be measured against a harness that mocks it.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL itself refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    /** A real `checksum` is required or the OCC parent-version check 409s */
    /** before `deleteMetaItem` reaches anything this suite is about. */
    checksum: string;
    metadata: string;
}

function makeProtocol(seedRows: Array<Partial<Row>> = []) {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const keyOf = (w: { type?: unknown; name?: unknown; organization_id?: unknown; state?: unknown }) =>
        `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
    for (const seed of seedRows) {
        nextId += 1;
        const row = {
            id: `seed_${nextId}`,
            organization_id: null,
            state: 'active',
            checksum: 'sha256:stored-head',
            metadata: JSON.stringify({ name: seed.name, label: 'Stored' }),
            ...seed,
        } as Row;
        rows.set(keyOf(row), row);
    }
    const deletes: Array<Record<string, unknown> | undefined> = [];
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            for (const row of rows.values()) {
                if (opts.where.type !== undefined && row.type !== opts.where.type) continue;
                if (opts.where.name !== undefined && row.name !== opts.where.name) continue;
                return row;
            }
            return null;
        },
        async find(_t: string, opts?: { where?: Record<string, unknown> }) {
            const where = opts?.where ?? {};
            return [...rows.values()].filter((row) =>
                (where.type === undefined || row.type === where.type)
                && (where.name === undefined || row.name === where.name));
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            deletes.push(opts);
            const id = (opts as any)?.where?.id;
            for (const [key, row] of rows.entries()) if (row.id === id) rows.delete(key);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction(fn: (ctx: unknown) => Promise<unknown>) { return fn(undefined); },
        async execute() { return {}; },
        async getObjectSchema() { return undefined; },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            unregisterItem: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        undefined,
    ) as any;
    return { protocol, rows, deletes };
}

const metaRows = (rows: Map<string, Row>) => [...rows.values()].filter((r) => r.type !== undefined);

/** Spec-valid `view` body, so the ONLY variable under test is the NAME. */
const VIEW_BODY = {
    name: 'probe_item',
    label: 'Probe',
    object: 'task',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
};

const GRAMMAR_MESSAGE = /is not a legal metadata item name/;

describe('#12194 — the names that must keep working', () => {
    it('accepts flat snake_case (`crm_lead`)', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await protocol.saveMetaItem({ type: 'view', name: 'crm_lead', item: VIEW_BODY });
        expect(result.success).toBe(true);
        expect(metaRows(rows)).toHaveLength(1);
        expect(metaRows(rows)[0]!.name).toBe('crm_lead');
    });

    it('accepts the dotted qualified form (`crm_lead.pipeline`) — the ruling keeps the dot', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await protocol.saveMetaItem({ type: 'view', name: 'crm_lead.pipeline', item: VIEW_BODY });
        expect(result.success).toBe(true);
        expect(metaRows(rows)).toHaveLength(1);
        expect(metaRows(rows)[0]!.name).toBe('crm_lead.pipeline');
    });

    it('accepts a multi-dot qualified name (`a.b.c` family)', async () => {
        const { protocol, rows } = makeProtocol();
        const result = await protocol.saveMetaItem({ type: 'view', name: 'crm_lead.kanban.v2_board', item: VIEW_BODY });
        expect(result.success).toBe(true);
        expect(metaRows(rows)).toHaveLength(1);
    });
});

describe('#12194 — the junk shapes the census measured ACCEPTED are now refused', () => {
    // Each entry was accepted and stored on the pre-#12194 tree (census P2–P8).
    // The refusal asserts the ADR-0112 envelope — `code` AND `status` — never a
    // bare `.toThrow()`, which an unrelated 422 one layer down would satisfy.
    const JUNK: Array<[label: string, name: string]> = [
        ['one slash (retired compound spelling)', 'views/all_leads'],
        ['two slashes', 'a/b/c'],
        ['empty section', '/all_leads'],
        ['empty leaf', 'views/'],
        ['double slash alone', '//'],
        ['empty string', ''],
        ['uppercase + whitespace + slash', 'Views/All Leads'],
        ['double slash inside', 'a//b'],
        ['leading dot', '.a'],
        ['trailing dot', 'a.'],
        ['double dot', 'a..b'],
        ['uppercase', 'CRM_Lead'],
        ['interior whitespace', 'crm lead'],
        ['leading digit', '1crm'],
    ];

    it.each(JUNK)('refuses %s with the ADR-0112 envelope and persists nothing', async (_label, name) => {
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'view', name, item: VIEW_BODY }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
        expect(metaRows(rows)).toHaveLength(0);
    });

    it('names the grammar AND the dotted prescription in the refusal', async () => {
        const { protocol } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'view', name: 'views/all_leads', item: VIEW_BODY }),
        ).rejects.toThrow(GRAMMAR_MESSAGE);
        await expect(
            protocol.saveMetaItem({ type: 'view', name: 'views/all_leads', item: VIEW_BODY }),
        ).rejects.toThrow(/crm_lead\.pipeline/);
    });
});

describe('#12194 — the slash bypass of the unrecognised-type refusal is CLOSED', () => {
    it('refuses unrecognised type + slash name (the census P10 acceptance)', async () => {
        // Pre-#12194: `refuseUnmintableMetaType` opened with
        // `if (request.name.includes('/')) return;` — so this exact request was
        // ACCEPTED and stored `type='fieldz' name='a/b'` (census P10, and the
        // residue #8421's own docblock stated rather than hid). The grammar
        // verdict now runs first, so the refusal FIRES — for the grammar
        // reason — and nothing is persisted.
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'fieldz', name: 'a/b', item: { name: 'x' } }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
        await expect(
            protocol.saveMetaItem({ type: 'fieldz', name: 'a/b', item: { name: 'x' } }),
        ).rejects.toThrow(GRAMMAR_MESSAGE);
        expect(metaRows(rows)).toHaveLength(0);
    });

    it('ANTI-VACUITY — unrecognised type + grammatical name still earns the TYPE refusal', async () => {
        // The pair that proves the two verdicts compose rather than one
        // swallowing the other: `a` passes the grammar, so the refusal that
        // fires is #8421's own, with its own prescription.
        const { protocol, rows } = makeProtocol();
        await expect(
            protocol.saveMetaItem({ type: 'fieldz', name: 'a', item: { name: 'x' } }),
        ).rejects.toThrow(/'fieldz' is not a metadata type/);
        expect(metaRows(rows)).toHaveLength(0);
    });
});

describe('#12194 — the promotion door enforces the same grammar', () => {
    it('refuses publishMetaItem for an off-grammar name, before draft resolution', async () => {
        const { protocol } = makeProtocol();
        await expect(
            protocol.publishMetaItem({ type: 'view', name: 'views/all_leads' }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
        await expect(
            protocol.publishMetaItem({ type: 'view', name: 'views/all_leads' }),
        ).rejects.toThrow(GRAMMAR_MESSAGE);
    });

    it('ANTI-VACUITY — a grammatical name reaches draft resolution (fails as no_draft, not grammar)', async () => {
        const { protocol } = makeProtocol();
        const failure = await protocol
            .publishMetaItem({ type: 'view', name: 'crm_lead' })
            .then(() => null, (e: unknown) => e as Error);
        expect(failure).not.toBeNull();
        expect(String(failure)).not.toMatch(GRAMMAR_MESSAGE);
    });
});

describe('#12194 — the refusal is scoped to the doors that MINT or PROMOTE', () => {
    it('leaves READS of a residue slash name answering', async () => {
        const { protocol } = makeProtocol([{ type: 'view', name: 'views/all_leads' }]);
        await expect(protocol.getMetaItem({ type: 'view', name: 'views/all_leads' }))
            .resolves.toBeDefined();
    });

    it('leaves a residue slash-name row DELETABLE', async () => {
        // Rows written before this grammar existed are real and nothing
        // rewrites them on upgrade. Refusing delete would strand them
        // permanently — the same scoping #8421 chose for residue types.
        const { protocol, rows } = makeProtocol([{ type: 'view', name: 'views/all_leads' }]);
        expect(metaRows(rows)).toHaveLength(1);
        await expect(
            protocol.deleteMetaItem({ type: 'view', name: 'views/all_leads' }),
        ).resolves.toBeDefined();
    });

    it('and the row cannot come back through the save door after the delete', async () => {
        const { protocol } = makeProtocol([{ type: 'view', name: 'views/all_leads' }]);
        await protocol.deleteMetaItem({ type: 'view', name: 'views/all_leads' });
        await expect(
            protocol.saveMetaItem({ type: 'view', name: 'views/all_leads', item: VIEW_BODY }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
    });
});
