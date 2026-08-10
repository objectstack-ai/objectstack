// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6190 — cold boot must SAY which org-scoped rows it walked past.
 *
 * ---------------------------------------------------------------------------
 * What survived the upstream ruling, measured against `origin/main`
 * ---------------------------------------------------------------------------
 * #6155 Q1=B → #6283 → PR #6478 rolled `flow`'s `allowOrgOverride` back to
 * `false` and proved declared=enforced on the write side: overlaying a
 * PACKAGED flow per org is now a 403 `NOT_OVERRIDABLE` before persistence.
 *
 * That closed one of the two write tiers. The other is still open BY DESIGN —
 * `flow` keeps `allowRuntimeCreate: true`, which is ADR-0005's "a deployment,
 * not an overlay" — and it is the tier the tenant scenario in #6190 actually
 * uses: authoring a BRAND-NEW flow in Studio. Measured on current main, that
 * write still lands `sys_metadata.organization_id = '<org>'`, because
 * `SysMetadataRepository.put` stamps `organization_id: this.organizationId`
 * for every type and the runtime `PUT /metadata/:type/:name` threads
 * `resolveActiveOrganizationId` into `saveMetaItem`:
 *
 *     PROBE rows = [{"name":"org_sweep","org":"org_a"},
 *                   {"name":"platform_sweep","org":null}]
 *     PROBE loadMetaFromDb = {"loaded":1,...}   // only platform_sweep
 *     PROBE logs during cold boot = []          // ← the defect
 *     PROBE getMetaItems({type:flow}) no org = ["platform_sweep"]
 *
 * So the symptom #6190 filed — an org-scoped flow that fires all day and never
 * fires again after a restart — is still reachable, and the third line is why
 * nobody can tell: the skip was completely silent. `kernel:bootstrapped`'s
 * unbound audit cannot report it either, because the flow was never registered.
 *
 * This file pins the loud half. It does NOT change what boot loads — whether
 * such a row should exist at all (refuse the write / force it env-wide / teach
 * the binder to read per-org) is a contract ruling recorded on the issue.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, with a deliberately green control. Deleting the
 * `reportUnhydratableOrgScopedRows()` call from `loadMetaFromDb` turns the
 * three "warns" cases red AND the probe-failure case with them — that one
 * asserts the second `find` happened at all, so it goes red counting calls
 * rather than reading a message. The two silence cases and the registry
 * premise pin stay green: they assert an ABSENCE of output, which a deleted
 * producer trivially satisfies. Predicted 4 red / 3 green; measured 4 red /
 * 3 green, and the reds fail in the shape that names the defect:
 *
 *   AssertionError: no [metadata_org_scoped_unhydrated] line in: []
 *   AssertionError: expected 1 to be greater than 1
 *
 * — the silent cold boot of the PROBE output above, reproduced on demand.
 *
 * The silence cases are not slack: a "fix" that warned about every skipped
 * org-scoped row would pass the red half and fail there, and that shape is
 * wrong — for `view` and friends (`allowOrgOverride: true`) the skip IS the
 * ADR-0005 design, loaded on demand by `getMetaItem`/`getMetaItems`.
 */
import { describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). From `@objectstack/metadata-core`, never `@objectstack/objectql`
// — objectql depends on THIS package, so that import would close a cycle.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
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

function makeEngine(rows: Row[], opts: { dropPredicates?: boolean } = {}) {
    const registered: Array<{ type: string; name: string }> = [];
    const engine: any = {
        async find(_table: string, q: { where: Record<string, unknown> }) {
            // A driver that cannot lower `$null`/`$in` hands back a superset —
            // the exact degradation the JS re-check exists for.
            if (opts.dropPredicates) return rows.filter((r) => r.state === q.where.state);
            return rows.filter((r) => matchesWhere(r, q.where));
        },
        async findOne() { return null; },
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

const AUDIT = '[metadata_org_scoped_unhydrated]';

describe('#6190 — cold boot names the org-scoped rows it cannot hydrate', () => {
    // ── the premise, read from the registry rather than restated ──────────

    it('flow is the specimen: not per-org overridable, still runtime-creatable', () => {
        // Both halves matter. `allowOrgOverride: false` (#6283 / PR #6478) is
        // why an org-scoped flow row can never be read back as an overlay;
        // `allowRuntimeCreate: true` is why one can still be WRITTEN. If a
        // later ruling closes the second flag, this case goes red and the
        // whole file should be re-read, not repaired.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'flow')).toMatchObject({
            allowOrgOverride: false,
            allowRuntimeCreate: true,
        });
        // The control specimen's flag, likewise read and not assumed.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'view')).toMatchObject({
            allowOrgOverride: true,
        });
    });

    // ── the acceptance criterion: the absence is loud ─────────────────────

    it('warns, naming type/name/org, when an org-scoped FLOW row is skipped', async () => {
        const { engine } = makeEngine([
            row({ type: 'flow', name: 'org_sweep', organization_id: 'org_a' }),
            row({ type: 'flow', name: 'platform_sweep' }),
        ]);

        const { result, warns } = await bootAndCapture(engine);

        // Hydration itself is UNCHANGED — this issue's fix is the log, not a
        // load. The org row stays out of the process-wide registry.
        expect(result).toMatchObject({ loaded: 1, errors: 0, invalid: 0, storeUnavailable: false });

        const line = warns.find((w) => w.includes(AUDIT));
        expect(line, `no ${AUDIT} line in: ${JSON.stringify(warns)}`).toBeDefined();
        expect(line).toContain('flow×1');
        expect(line).toContain('org_sweep@org_a');
        // The consequence, not just the fact — an operator reading this must
        // learn why an automation stopped firing after a restart.
        expect(line).toContain('bind its triggers');
        // And it must not name the row that DID load.
        expect(line).not.toContain('platform_sweep');
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

    it('still warns when the driver drops the predicates and returns a superset', async () => {
        // `driver-memory` historically dropped `is_null` outright (see its
        // `memory-filter-ast-vocabulary.test.ts`), so the audit re-checks both
        // predicates in JS. A superset must produce the SAME line — not a
        // false accusation against the env-wide and view rows in it.
        const { engine } = makeEngine([
            row({ type: 'flow', name: 'org_sweep', organization_id: 'org_a' }),
            row({ type: 'flow', name: 'platform_sweep' }),
            row({ type: 'view', name: 'org_grid', organization_id: 'org_a' }),
        ], { dropPredicates: true });

        const { warns } = await bootAndCapture(engine);

        const line = warns.find((w) => w.includes(AUDIT));
        expect(line).toBeDefined();
        expect(line).toContain('org_sweep@org_a');
        expect(line).not.toContain('platform_sweep');
        expect(line).not.toContain('org_grid');
    });

    // ── the silence that is the design, not a miss ────────────────────────

    it('says NOTHING about an org-scoped VIEW — that skip is ADR-0005 working', async () => {
        // `view` is `allowOrgOverride: true`: the row is a per-org overlay,
        // deliberately not hydrated process-wide and served on demand by
        // `getMetaItem`/`getMetaItems({ organizationId })`. Warning here would
        // print a line at every boot of every healthy tenant.
        const { engine } = makeEngine([
            row({ type: 'view', name: 'org_grid', organization_id: 'org_a' }),
            row({ type: 'view', name: 'platform_grid' }),
        ]);

        const { result, warns } = await bootAndCapture(engine);

        expect(result.loaded).toBe(1);
        expect(warns.filter((w) => w.includes(AUDIT))).toEqual([]);
    });

    it('says nothing at all on a store with no org-scoped rows', async () => {
        const { engine } = makeEngine([
            row({ type: 'flow', name: 'platform_sweep' }),
            row({ type: 'view', name: 'platform_grid' }),
        ]);

        const { result, warns } = await bootAndCapture(engine);

        expect(result.loaded).toBe(2);
        expect(warns.filter((w) => w.includes(AUDIT))).toEqual([]);
    });

    // ── the diagnostic can never become the outage ────────────────────────

    it('a failing audit probe does not change the boot verdict', async () => {
        // #5897 draws a hard line between "the store had no rows" and "the
        // store could not be read". A best-effort extra probe must not be able
        // to cross it: the first `find` succeeds, so this boot is HEALTHY, and
        // `storeUnavailable` must stay false even though the probe threw.
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
