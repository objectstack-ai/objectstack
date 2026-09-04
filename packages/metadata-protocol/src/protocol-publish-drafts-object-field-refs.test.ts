// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15254 — the batch publish door REFUSES an object whose `highlightFields`
 * names a field that does not exist on it.
 *
 * ## The claim this pins, and the state it replaces
 *
 * The card is a finding from the promo-video lane, and the film's one claim is
 * that "a change made by clicking in Studio is refused by the same gate that
 * refuses code". On the pinned stack nothing Studio could produce was refused,
 * and the reproduction is the natural click order rather than a contrived one:
 * click-create a Number field (Studio mints it as `field_10`), add it to the
 * object's `highlightFields`, then give it a label — the API name auto-derives
 * to `health_score` and `highlightFields` still says `field_10`. Publishing
 * that draft answered HTTP 200, `outcome: "published"`, `failedCount: 0`, and
 * the app then silently ignored the dangling reference at runtime.
 *
 * Two independent reasons the gate stayed quiet, both measured on `origin/main`
 * before this change:
 *
 *  1. `list-view-field-unknown` inspects `view.columns`, and Studio's app
 *     builder mints no `view` items at all — the rule had nothing to inspect
 *     on the only artifacts the click path authors.
 *  2. `runtimeAuthoringRulesFor('object')` dispatched seven rules and NO
 *     reference-integrity rule among them (the suite entry declared
 *     `runtimeTypes: ['flow', 'view']`), while the object-level existence
 *     check that did exist — `semantic-role-field-unknown` — is `warning`,
 *     advisory-tier and CLI-only. So the one door a tenant has ran no
 *     reference-integrity judgement on an object write, and the one command
 *     that spoke exited 0.
 *
 * ⭐ Warning-level is not enough for the claim; it has to REFUSE. That is what
 * this file measures, end to end, through the real `publishPackageDrafts`.
 *
 * Harness: the same faithful stub engine as
 * `protocol-publish-drafts-advisories.test.ts` / `-org-scope.test.ts`, kept
 * local — self-contained harnesses are the established shape here, so two
 * tripwires can fail independently. Objects are saved as package-bound drafts
 * (draft saves are never gated, #4463 D1) and published through the REAL
 * `publishPackageDrafts`; nothing on the gate path is stubbed.
 */

import { describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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

// Overlay rows are keyed by (type, name, org, state, package_id) — the ADR-0048 key.
function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
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

const PKG = 'app.ops';
const PKG = 'app.studio';

/**
 * The card's click path, at the moment the author hits Publish.
 *
 *   1. click-create a Number field → Studio mints it as `field_10`
 *   2. add it to `highlightFields` → the list references `field_10`
 *   3. set its label to "Health Score" → the API name auto-derives to
 *      `health_score`; `highlightFields` is NOT rewritten
 *
 * `sharingModel` is load-bearing for the same reason `runAs: 'system'` is in
 * the sibling harness: without it `security-owd-unset` fires at `error` and
 * the refusal under test would be someone else's.
 */
const danglingHighlightObject = (name: string) => ({
    name,
    label: 'Task',
    sharingModel: 'private',
    fields: {
        name: { type: 'text', label: 'Name' },
        health_score: { type: 'number', label: 'Health Score' },
    },
    nameField: 'name',
    highlightFields: ['name', 'field_10'],
});

/** The same object with step 2's reference rewritten to the derived name. */
const repairedObject = (name: string) => ({
    ...danglingHighlightObject(name),
    highlightFields: ['name', 'health_score'],
});

/** Stage one package-bound object draft (Studio's "Save Draft" shape). */
async function stageObjectDraft(
    protocol: ObjectStackProtocolImplementation,
    name: string,
    item: unknown,
): Promise<void> {
    await (protocol as any).saveMetaItem({
        type: 'object', name, item, packageId: PKG, mode: 'draft',
    });
}

describe('publishPackageDrafts refuses a dangling object field-name list (#15254)', () => {
    it('REFUSES the click path: outcome is not `published`, and the receipt names the rule and the path', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageObjectDraft(protocol, 'proj_task', danglingHighlightObject('proj_task'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        // The bar, in the card's own terms: the publish FAILS.
        expect(res.outcome).not.toBe('published');
        expect(res).toMatchObject({ success: false, publishedCount: 0, failedCount: 1 });
        expect(res.published).toEqual([]);

        const causal = res.failed.find((f) => f.name === 'proj_task')!;
        expect(causal, JSON.stringify(res.failed)).toBeDefined();
        expect(causal.code).toBe('INVALID_METADATA');

        // …with a rule id and the offending path, which is what has to reach
        // the author's screen. The path is name-keyed on the wire (#10064) —
        // `objects.<name>.<key>[i]`, never the gate's private snapshot index.
        const wire = JSON.stringify(causal);
        expect(wire).toContain('object-field-ref-unknown');
        expect(wire).toContain('objects.proj_task.highlightFields[1]');
        // The author reads back the string they typed.
        expect(wire).toContain('field_10');
    });

    it('the SAME draft publishes once the reference is repaired — the refusal is about the reference, not the object', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageObjectDraft(protocol, 'proj_task', repairedObject('proj_task'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.outcome).toBe('published');
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(res.published.map((p) => p.name)).toEqual(['proj_task']);
    });

    it('reports the objects it inspected — `probes.checked.objects` is no longer a count that cannot go up', async () => {
        // The absence of this key is what let the card's filer diagnose the
        // gap: a receipt reading `{seeds: 0, views: 0, widgets: 0}` was
        // ACCURATE (the builder mints none of those) while the objects the
        // package did publish were probed by nothing at all.
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await stageObjectDraft(protocol, 'proj_task', repairedObject('proj_task'));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });
        const probes = res.probes as { checked: Record<string, number>; issues: unknown[] } | undefined;

        expect(probes, 'probes rode the response').toBeDefined();
        expect(probes!.checked).toHaveProperty('objects');
        expect(probes!.checked.objects).toBe(1);
        // A clean object raises nothing on the plane.
        expect(probes!.issues).toEqual([]);
    });

    it('a draft save is NEVER gated (#4463 D1) — the refusal belongs to the publish', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // No throw: the author keeps working on a half-finished object, and is
        // stopped at the moment they claim it is ready.
        await expect(
            stageObjectDraft(protocol, 'proj_task', danglingHighlightObject('proj_task')),
        ).resolves.toBeUndefined();
    });
});
