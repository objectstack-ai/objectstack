// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4636 PR2 — BOOT re-hydration (`loadMetaFromDb`) keys object-overlay
 * ownership by the row's REAL package binding, closing the restart half of
 * the same defect PR1 closed on the write path.
 *
 * ## What was wrong
 *
 * The object branch of `loadMetaFromDb` read `record.packageId` off a row
 * that came straight out of `engine.find('sys_metadata', …)` — and those
 * rows are keyed by the object's SNAKE_CASE column names. `sys_metadata`
 * declares `package_id`; the repository writes `package_id`; `getMetaItems`
 * reads `r.package_id`; the sibling (non-object) branch three lines below
 * reads `(record as …).package_id`. Only this one branch spelled it
 * camelCase, so the expression was permanently `undefined || 'sys_metadata'`
 * and EVERY boot-hydrated object registered under the sentinel, package-bound
 * or not.
 *
 * ## The behaviour that pins it: create, restart, edit
 *
 * The ownership key is the package-filter key — `getAllObjects(packageId)`
 * matches `contributor.packageId` and the runtime sidebar consumes it. After
 * PR1 the write path records `app.<slug>`, so the surviving defect was
 * exactly restart-shaped: an object was in its package's filter when you
 * created it and gone after a reboot.
 *
 * Worse than the missing filter row, and the reason this file simulates a
 * real restart rather than asserting the key in isolation: with the two sides
 * disagreeing, the FIRST edit after a restart re-claimed ownership under a
 * different key, `registerObject` threw `already owned by package
 * "sys_metadata"`, and `applyObjectRegistryMutation` catches that into a
 * `console.warn`. The save answered `success: true` while the in-memory
 * schema stayed at the pre-edit version — the edit was dropped silently. It
 * is cloud#970's restart surface in its post-PR1 form: not a `403`, because
 * both sides do stamp `_provenance: 'org'` and the overlay gate stays open,
 * but a swallowed ownership clash. So the assertions below run a full
 * session-1-writes / session-2-boots / session-2-edits cycle against the
 * real `SchemaRegistry`, and check the evolved field actually lands.
 *
 * This file lives in `@objectstack/objectql` for the same reason PR1's
 * `protocol-writepath-object-ownership.test.ts` does: the subject is the REAL
 * `SchemaRegistry` (contributor ownership, `getAllObjects` filtering), and
 * `@objectstack/objectql` depends on `@objectstack/metadata-protocol` — only
 * this direction can hold both halves without closing a cycle turbo rejects.
 */

import { describe, expect, it } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
// [#4550 / #5480] The producer's OWN write-verb dispatch decisions, so this
// double cannot accept a call `ObjectQL.delete` / `ObjectQL.update` refuses.
import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

/** A Studio authoring workspace id — writable under ADR-0070. */
const APP_PKG = 'app.myapp';
const OTHER_PKG = 'app.otherapp';
/** The key an overlay row bound to NO package keeps. */
const SENTINEL = 'sys_metadata';

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
    event_seq: number;
    type: string;
    name: string;
    version: number;
    operation_type: string;
    metadata: string | null;
    checksum: string | null;
    organization_id: string | null;
    recorded_at: string;
}

function matches(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/**
 * One kernel process: a fresh `SchemaRegistry` + protocol over a
 * `sys_metadata` table. `seed` is how a RESTART is expressed — the rows a
 * previous process persisted, handed to a brand-new registry that knows
 * nothing about them until `loadMetaFromDb` runs.
 */
function makeSession(seed: { rows?: Row[]; history?: HistoryRow[] } = {}) {
    const registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
    const rows = new Map<string, Row>();
    for (const r of seed.rows ?? []) rows.set(keyOf(r), { ...r });
    const historyRows: HistoryRow[] = (seed.history ?? []).map((h) => ({ ...h }));
    const synced: string[] = [];
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        registry,
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matches(h as any, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matches(h as any, opts.where));
            }
            return Array.from(rows.values()).filter((r) => matches(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                const h = { id: `h_${++nextId}`, ...(data as any) } as HistoryRow;
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        async syncObjectSchema(name: string) { synced.push(name); },
    };
    // A PROJECT kernel (`environmentId` set) — the topology cloud#970 was
    // reported on, and the only one where `saveMetaItem`'s overlay gate is
    // engaged at all.
    const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
    return { registry, protocol, rows, historyRows, synced };
}

function objectBody(name: string, extra?: Record<string, unknown>) {
    return {
        name,
        label: 'Invoice',
        // [#8310] The runtime object door requires an authored OWD.
        sharingModel: 'private',
        fields: {
            name: { name: 'name', type: 'text', label: 'Name' },
            amount: { name: 'amount', type: 'number', label: 'Amount' },
        },
        ...extra,
    };
}

/** The owning contributor recorded for `name` (no namespace → fqn === name). */
const owner = (registry: SchemaRegistry, name: string) => registry.getObjectOwner(name);

/**
 * Session 1: author the object through the REAL write path, then hand its
 * persisted rows to a brand-new process. Hand-crafting the row would let the
 * fixture drift from what the repository actually writes — the column
 * spelling is the entire subject of this test.
 */
async function persistThenRestart(opts: { name: string; packageId?: string }) {
    const first = makeSession();
    const res = await first.protocol.saveMetaItem({
        type: 'object',
        name: opts.name,
        ...(opts.packageId ? { packageId: opts.packageId } : {}),
        item: objectBody(opts.name),
    });
    expect(res.success).toBe(true);
    const persisted = Array.from(first.rows.values());
    return {
        persisted,
        reboot: () => makeSession({ rows: persisted, history: first.historyRows }),
    };
}

describe('#4636 PR2 — boot re-hydration keys object ownership by the row\'s package_id', () => {
    it('registers a package-bound row under its REAL package id, not the sentinel', async () => {
        const { persisted, reboot } = await persistThenRestart({
            name: 'myapp_invoice',
            packageId: APP_PKG,
        });

        // The row the previous process left behind carries the binding in the
        // snake_case column this branch has to read.
        expect(persisted).toHaveLength(1);
        expect(persisted[0].package_id).toBe(APP_PKG);
        expect((persisted[0] as any).packageId).toBeUndefined();

        const second = reboot();
        const res = await second.protocol.loadMetaFromDb();

        expect(res.loaded).toBe(1);
        expect(res.errors).toBe(0);
        // Pre-fix: `'sys_metadata'` — `record.packageId` was undefined and the
        // `|| 'sys_metadata'` fallback always won.
        expect(owner(second.registry, 'myapp_invoice')?.packageId).toBe(APP_PKG);
    });

    it('still stamps `_provenance: \'org\'` on the hydrated body (cloud#970 unchanged)', async () => {
        const { reboot } = await persistThenRestart({
            name: 'myapp_invoice',
            packageId: APP_PKG,
        });

        const second = reboot();
        await second.protocol.loadMetaFromDb();

        // Unchanged by PR2 and deliberately so: the row is tenant-authored
        // whatever package it is bound to, and this stamp — not the sentinel
        // string — is what keeps `isArtifactBacked` false so the overlay gate
        // lets the next write through.
        expect((owner(second.registry, 'myapp_invoice')?.definition as any)?._provenance).toBe('org');
    });

    it('the sidebar package filter finds the object again after a restart', async () => {
        const { reboot } = await persistThenRestart({
            name: 'myapp_invoice',
            packageId: APP_PKG,
        });

        const second = reboot();
        await second.protocol.loadMetaFromDb();

        // runtime `meta.ts` → `getAllObjects(packageId)`. Pre-fix this was
        // empty after every restart even though the object was there before it.
        expect(second.registry.getAllObjects(APP_PKG).map((o: any) => o.name)).toEqual(['myapp_invoice']);
        expect(second.registry.getAllObjects(OTHER_PKG)).toEqual([]);
    });

    it('the FIRST edit after a restart lands in the schema (cloud#970 restart surface)', async () => {
        const { reboot } = await persistThenRestart({
            name: 'myapp_invoice',
            packageId: APP_PKG,
        });

        const second = reboot();
        await second.protocol.loadMetaFromDb();

        // The user comes back the next morning and adds a field.
        const evolved = objectBody('myapp_invoice');
        (evolved.fields as any).due_date = { name: 'due_date', type: 'date', label: 'Due' };
        const saved = await second.protocol.saveMetaItem({
            type: 'object',
            name: 'myapp_invoice',
            packageId: APP_PKG,
            item: evolved,
        });

        expect(saved.success).toBe(true);
        // THE load-bearing assertion. Pre-fix, `success: true` was already
        // true — boot claimed `'sys_metadata'`, this save claimed `app.myapp`,
        // `registerObject` threw `already owned by package "sys_metadata"`, and
        // `applyObjectRegistryMutation` swallowed it into a `console.warn`. The
        // write reached the DB and the in-memory schema stayed at the boot
        // version, so CRUD on the new field failed until the NEXT restart.
        expect(Object.keys((second.registry.getObject('myapp_invoice') as any).fields)).toContain('due_date');
        // Ownership survives the re-registration on the same key.
        expect(owner(second.registry, 'myapp_invoice')?.packageId).toBe(APP_PKG);
        // On disk: still one row, still bound to its package.
        const stored = Array.from(second.rows.values()).filter((r) => r.name === 'myapp_invoice');
        expect(stored).toHaveLength(1);
        expect(stored[0].package_id).toBe(APP_PKG);
    });
});

describe('#4636 PR2 — a package-less row keeps the sentinel (regression)', () => {
    it('hydrates an unbound row under the sentinel, exactly as before', async () => {
        const { persisted, reboot } = await persistThenRestart({ name: 'global_invoice' });

        expect(persisted[0].package_id ?? null).toBeNull();

        const second = reboot();
        const res = await second.protocol.loadMetaFromDb();

        expect(res.loaded).toBe(1);
        // `||`, not `??`: no binding — including the empty-string spelling —
        // means "no package", and the sentinel marks that one thing. Same
        // normalisation the write path applies to `request.packageId`.
        expect(owner(second.registry, 'global_invoice')?.packageId).toBe(SENTINEL);
        expect((owner(second.registry, 'global_invoice')?.definition as any)?._provenance).toBe('org');
        // It is not smuggled into any package's filter.
        expect(second.registry.getAllObjects(APP_PKG)).toEqual([]);
    });
});
