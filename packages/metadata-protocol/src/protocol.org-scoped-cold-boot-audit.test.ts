// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6190, ADR-0131 D6] Cold boot SAYS which stored rows sit in a legacy
 * organization's layer — rows no read serves any more.
 *
 * #6190 made the skip of an organization-scoped `flow` row loud: boot hydrates
 * `organization_id IS NULL` rows only, and an organization-authored flow
 * stopped firing after a restart with nothing said. ADR-0131 D6 then retired
 * the per-organization overlay axis: every read is environment → code, for
 * every type, so a legacy organization row of ANY type — a tenant's `view`
 * overlay as much as a pre-#6190 flow — is served by no read. The report
 * widened with it: every type, active and draft rows, plus the legacy rows of
 * the three ledgers the timeline, history, diff and audit reads no longer
 * show, and the remedy is the v18 migration ceremony (`os migrate`, ADR-0131
 * D10), which names each row's fate. Nothing is deleted or rewritten here.
 *
 * Reverse verification: deleting the `reportUnhydratableOrgScopedRows()` call
 * from `loadMetaFromDb` turns the "names" cases red and leaves the silence
 * cases green (they assert an absence a deleted producer satisfies).
 */
import { describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). From `@objectstack/metadata-core`, never `@objectstack/objectql`
// — objectql depends on THIS package, so that import would close a cycle.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
}

/**
 * A stub that honours the two predicates the audit query relies on
 * (`organization_id: { $null: false }` and `type: { $in: [...] }`) plus the
 * plain equality the boot query uses. `driver-memory`, `driver-sql` and
 * `driver-mongodb` all lower `$null`; this mirrors that, and the
 * dropped-predicate case gets its own stub below.
 */
function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        const actual = (r as any)[k];
        if (v !== null && typeof v === 'object') {
            const ops = v as Record<string, unknown>;
            if ('$null' in ops) {
                const isNull = actual === null || actual === undefined;
                if (isNull !== ops.$null) return false;
            }
            if ('$in' in ops) {
                if (!(ops.$in as unknown[]).includes(actual)) return false;
            }
            continue;
        }
        if (actual !== v) return false;
    }
    return true;
}

function makeEngine(
    rows: Row[],
    opts: { dropPredicates?: boolean; ledgers?: Record<string, Array<{ organization_id: string | null }>> } = {},
) {
    const registered: Array<{ type: string; name: string }> = [];
    const engine: any = {
        async find(table: string, q: { where: Record<string, unknown> }) {
            if (table !== 'sys_metadata') {
                const ledger = (opts.ledgers?.[table] ?? []) as any[];
                return opts.dropPredicates ? ledger : ledger.filter((r) => matchesWhere(r, q.where));
            }
            // A driver that cannot lower `$null`/`$in` hands back a superset —
            // the exact degradation the JS re-check exists for.
            if (opts.dropPredicates) return rows;
            return rows.filter((r) => matchesWhere(r, q.where));
        },
        async findOne(object: string, query?: EngineFindOneQueryInput) {
                          assertEngineFindOnePredicate(object, query); return null; },
        async insert() { return { id: 'x' }; },
        async update(_t: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, o);
            return { id: null };
        },
        async delete(_t: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            return { deleted: 0 };
        },
        registry: {
            registerItem: (type: string, item: any) => { registered.push({ type, name: item?.name }); },
            registerObject: (item: any) => { registered.push({ type: 'object', name: item?.name }); },
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
        },
    };
    return { engine, registered };
}

const flowBody = (name: string) => JSON.stringify({
    name,
    label: 'Escalate overdue tasks',
    type: 'record_change',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'task', triggerType: 'record-after-update' } },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

const viewBody = (name: string) => JSON.stringify({
    name, label: 'Overdue', object: 'task', columns: [{ field: 'name', label: 'Name' }],
});

const row = (over: Partial<Row> & Pick<Row, 'type' | 'name'>): Row => ({
    id: `r_${over.type}_${over.name}_${over.organization_id ?? 'env'}`,
    organization_id: null,
    state: 'active',
    metadata: over.type === 'view' ? viewBody(over.name) : flowBody(over.name),
    ...over,
});

/** One `console.warn` capture, returned as the lines the boot printed. */
async function bootAndCapture(engine: any): Promise<{ result: any; warns: string[] }> {
    const warns: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
        warns.push(a.map(String).join(' '));
    });
    try {
        const protocol = new ObjectStackProtocolImplementation(engine) as any;
        const result = await protocol.loadMetaFromDb();
        return { result, warns };
    } finally {
        spy.mockRestore();
    }
}

const AUDIT = '[metadata_org_scoped_unserved]';

describe('[#6190, ADR-0131 D6] cold boot names every legacy organization-scoped row, which no read serves', () => {
    it('names a legacy organization FLOW row and a tenant VIEW overlay alike, per type, with the ceremony as the remedy', async () => {
        const { engine } = makeEngine([
            row({ type: 'flow', name: 'org_sweep', organization_id: 'org_a' }),
            row({ type: 'flow', name: 'platform_sweep' }),
            row({ type: 'view', name: 'org_grid', organization_id: 'org_a' }),
            row({ type: 'view', name: 'org_draft_grid', organization_id: 'org_b', state: 'draft' }),
            row({ type: 'view', name: 'platform_grid' }),
        ]);

        const { result, warns } = await bootAndCapture(engine);

        // Hydration loads the environment's rows only.
        expect(result).toMatchObject({ loaded: 2, errors: 0, storeUnavailable: false });

        const line = warns.find((w) => w.includes(AUDIT));
        expect(line, `no ${AUDIT} line in: ${JSON.stringify(warns)}`).toBeDefined();
        expect(line).toContain('flow×1 (org_sweep@org_a)');
        expect(line).toContain('view×2 (org_grid@org_a, org_draft_grid@org_b (draft))');
        expect(line).toContain('bind its triggers');
        expect(line).toContain('os migrate');
        expect(line).not.toContain('platform_');
    });

    it('counts the legacy rows of the three ledgers the reads no longer show', async () => {
        const { engine } = makeEngine([], {
            ledgers: {
                sys_metadata_commit: [{ organization_id: 'org_a' }, { organization_id: null }],
                sys_metadata_history: [{ organization_id: 'org_a' }, { organization_id: 'org_b' }],
                sys_metadata_audit: [{ organization_id: null }],
            },
        });

        const { warns } = await bootAndCapture(engine);

        const line = warns.find((w) => w.includes(AUDIT));
        expect(line).toContain('sys_metadata_commit×1, sys_metadata_history×2');
        expect(line).not.toContain('sys_metadata_audit×');
    });

    it('counts every row but samples the names, so a thousand rows cost one line', async () => {
        const rows: Row[] = [];
        for (let i = 0; i < 9; i++) {
            rows.push(row({ type: 'flow', name: `sweep_${i}`, organization_id: `org_${i}` }));
        }
        const { engine } = makeEngine(rows);

        const { warns } = await bootAndCapture(engine);

        const audit = warns.filter((w) => w.includes(AUDIT));
        expect(audit).toHaveLength(1);
        expect(audit[0]).toContain('flow×9');
        expect(audit[0]).toContain('+4 more');
    });

    it('still reports truthfully when the driver drops the predicates and returns a superset', async () => {
        const { engine } = makeEngine([
            row({ type: 'flow', name: 'org_sweep', organization_id: 'org_a' }),
            row({ type: 'flow', name: 'platform_sweep' }),
        ], { dropPredicates: true });

        const { warns } = await bootAndCapture(engine);

        const line = warns.find((w) => w.includes(AUDIT));
        expect(line).toContain('org_sweep@org_a');
        expect(line).not.toContain('platform_sweep');
    });

    it('says nothing at all on a store with no legacy organization row', async () => {
        const { engine } = makeEngine([
            row({ type: 'flow', name: 'platform_sweep' }),
            row({ type: 'view', name: 'platform_grid' }),
        ]);

        const { result, warns } = await bootAndCapture(engine);

        expect(result.loaded).toBe(2);
        expect(warns.filter((w) => w.includes(AUDIT))).toEqual([]);
    });

    it('a failing audit probe does not change the boot verdict', async () => {
        // #5897: a best-effort extra probe must not turn a healthy boot into
        // `storeUnavailable`.
        let call = 0;
        const { engine } = makeEngine([row({ type: 'flow', name: 'platform_sweep' })]);
        const inner = engine.find;
        engine.find = async (t: string, q: any) => {
            call++;
            if (call > 1) throw new Error('probe exploded');
            return inner(t, q);
        };

        const { result, warns } = await bootAndCapture(engine);

        expect(call).toBeGreaterThan(1);
        expect(result).toMatchObject({ loaded: 1, errors: 0, storeUnavailable: false });
        expect(warns.filter((w) => w.includes('DB hydration skipped'))).toEqual([]);
        expect(warns.filter((w) => w.includes(AUDIT))).toEqual([]);
    });
});
