// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0008 PR-10b — SysMetadataRepository tests.
 *
 * Exercises the round-trip behaviour against a fake engine. The fake is
 * intentionally minimal — we are testing the repository's adherence to
 * the MetadataRepository contract, not the engine itself.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, hashSpec } from '@objectstack/metadata-core';
import { SysMetadataRepository } from '@objectstack/metadata-protocol';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    metadata: string;
    checksum: string;
    state: string;
    version: number;
    created_at: string;
    updated_at: string;
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

/**
 * In-memory fake honoring just enough of the engine surface to drive
 * the SysMetadataRepository unit tests. Multi-table aware (sys_metadata
 * + sys_metadata_history) and supports a pass-through `transaction()`
 * that matches the real engine's behavior on drivers without
 * `beginTransaction` (cb runs with `undefined` ctx, no rollback).
 */
function makeFakeEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];

    const keyOf = (where: Record<string, unknown>) =>
        `${where.type}|${where.name}|${String(where.organization_id ?? 'null')}|${String(where.state ?? 'active')}`;

    const findRow = (where: Record<string, unknown>): { key: string; row: Row } | null => {
        if (where.id !== undefined) {
            for (const [k, r] of rows) {
                if (r.id === where.id) return { key: k, row: r };
            }
            return null;
        }
        const k = keyOf(where);
        const r = rows.get(k);
        return r ? { key: k, row: r } : null;
    };

    const matchesHistory = (h: HistoryRow, where: Record<string, unknown>): boolean => {
        if (where.organization_id !== undefined && h.organization_id !== where.organization_id)
            return false;
        if (where.type !== undefined && h.type !== where.type) return false;
        if (where.name !== undefined && h.name !== where.name) return false;
        if (where.operation_type !== undefined && h.operation_type !== where.operation_type)
            return false;
        if (where.version !== undefined && h.version !== where.version) return false;
        return true;
    };

    return {
        rows,
        historyRows,
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts.where));
            }
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                const h = { ...(data as any) } as HistoryRow;
                if (!h.id) h.id = `h_${historyRows.length + 1}`;
                historyRows.push(h);
                return { id: h.id };
            }
            const k = keyOf(data);
            const row: Row = { id: `r_${rows.size + 1}`, ...(data as any) };
            rows.set(k, row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) throw new Error('not found');
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        /**
         * No-rollback pass-through, matching `ObjectQL.transaction` on
         * drivers without `beginTransaction`. Sufficient for assertions
         * about ordering and "no history row on conflict"; not for
         * testing rollback-on-failure of the history insert itself.
         */
        async transaction<T>(cb: (ctx: any) => Promise<T>): Promise<T> {
            return cb(undefined);
        },
    };
}

describe('SysMetadataRepository', () => {
    let engine: ReturnType<typeof makeFakeEngine>;
    let repo: SysMetadataRepository;

    const sampleView = {
        name: 'case_grid',
        label: 'Cases',
        object: 'case',
        columns: [{ field: 'name' }],
    };

    beforeEach(() => {
        engine = makeFakeEngine();
        repo = new SysMetadataRepository({
            engine,
            organizationId: 'org_alpha',
            orgLabel: 'org_alpha',
        });
    });

    // ── basic CRUD ──────────────────────────────────────────────────

    it('put creates a new row and returns the hash version', async () => {
        const result = await repo.put(
            { org: 'org_alpha', type: 'view', name: 'case_grid' },
            sampleView,
            { parentVersion: null, actor: 'studio' },
        );
        expect(result.version).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(result.version).toBe(hashSpec(sampleView));
        expect(result.seq).toBe(1);
        expect(engine.rows.size).toBe(1);
    });

    it('get returns the stored item with canonical body', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        const got = await repo.get(ref);
        expect(got).not.toBeNull();
        expect(got!.body).toEqual(sampleView);
        expect(got!.hash).toBe(hashSpec(sampleView));
    });

    it('get returns null when row is absent', async () => {
        const got = await repo.get({
            org: 'org_alpha',
            type: 'view', name: 'missing',
        });
        expect(got).toBeNull();
    });

    // ── optimistic locking ──────────────────────────────────────────

    it('put rejects when parentVersion does not match HEAD', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const first = await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });

        await expect(
            repo.put(ref, { ...sampleView, label: 'X' }, { parentVersion: 'sha256:wrong', actor: 'studio' }),
        ).rejects.toBeInstanceOf(ConflictError);

        // Threading the actual parentVersion succeeds.
        const second = await repo.put(
            ref,
            { ...sampleView, label: 'X' },
            { parentVersion: first.version, actor: 'studio' },
        );
        expect(second.version).not.toBe(first.version);
    });

    it('put rejects when row already exists but caller expected absence', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await expect(
            repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' }),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    it('put with identical body is a no-op (no seq bump)', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const first = await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        const second = await repo.put(ref, sampleView, { parentVersion: first.version, actor: 'studio' });
        expect(second.version).toBe(first.version);
        // No new event => seqCounter unchanged.
        const third = await repo.put(
            ref, { ...sampleView, label: 'New' }, { parentVersion: first.version, actor: 'studio' },
        );
        expect(third.seq).toBe(2); // first was 1; identical no-op didn't consume a seq
    });

    // ── delete ──────────────────────────────────────────────────────

    it('delete removes the row when parentVersion matches', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const first = await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await repo.delete(ref, { parentVersion: first.version, actor: 'studio' });
        expect(engine.rows.size).toBe(0);
        expect(await repo.get(ref)).toBeNull();
    });

    it('delete throws ConflictError on parentVersion mismatch', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await expect(
            repo.delete(ref, { parentVersion: 'sha256:wrong', actor: 'studio' }),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    it('delete throws on absent row', async () => {
        await expect(
            repo.delete(
                { org: 'org_alpha', type: 'view', name: 'missing' },
                { parentVersion: 'sha256:anything', actor: 'studio' },
            ),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    // ── whitelist enforcement (mirrors PR-10a, at the repo layer) ───

    it('put refuses non-allowOrgOverride types (trigger)', async () => {
        await expect(
            repo.put(
                { org: 'org_alpha', type: 'trigger', name: 'on_insert' },
                { name: 'on_insert', object: 'case', event: 'beforeInsert' },
                { parentVersion: null, actor: 'studio' },
            ),
        ).rejects.toMatchObject({ code: 'not_overridable', status: 403 });
    });

    it('put refuses non-allowOrgOverride types (datasource)', async () => {
        await expect(
            repo.put(
                { org: 'org_alpha', type: 'datasource', name: 'analytics' },
                { name: 'analytics', driver: 'sql' },
                { parentVersion: null, actor: 'studio' },
            ),
        ).rejects.toMatchObject({ code: 'not_overridable', status: 403 });
    });

    // ── runtime-create gate: plugin-registered types must be accepted ───
    //
    // Regression: types like `theme`, `api`, `connector`, `webhook` are
    // not in DEFAULT_METADATA_TYPE_REGISTRY — they are registered at
    // runtime by plugins. The listing endpoint (protocol.getMetaTypes())
    // synthesises descriptors with `allowRuntimeCreate: true` for them,
    // so the admin UI advertises them as writable. The repo gate must
    // agree, otherwise the UI 403s on save. Previously the gate keyed
    // off the static registry only and rejected all 9+ such types.

    it('put accepts plugin-registered type with intent=runtime-only (theme)', async () => {
        const result = await repo.put(
            { org: 'org_alpha', type: 'theme', name: 'my_theme' },
            { name: 'my_theme', label: 'Test', tokens: {} },
            { parentVersion: null, actor: 'studio', intent: 'runtime-only' },
        );
        expect(result.version).toMatch(/^sha256:/);
    });

    it('put accepts plugin-registered type with intent=runtime-only (api)', async () => {
        const result = await repo.put(
            { org: 'org_alpha', type: 'api', name: 'my_api' },
            { name: 'my_api', path: '/x', method: 'GET' },
            { parentVersion: null, actor: 'studio', intent: 'runtime-only' },
        );
        expect(result.version).toMatch(/^sha256:/);
    });

    it('put still refuses plugin-registered type without runtime-only intent', async () => {
        // intent defaults to 'override-artifact'; that path requires
        // allowOrgOverride, which plugin-registered types do not get
        // automatically. Keeps the artifact-shadowing security boundary
        // intact for plugin types until they explicitly opt in.
        await expect(
            repo.put(
                { org: 'org_alpha', type: 'theme', name: 'evil_theme' },
                { name: 'evil_theme', label: 'X', tokens: {} },
                { parentVersion: null, actor: 'studio' },
            ),
        ).rejects.toMatchObject({ code: 'not_overridable', status: 403 });
    });

    it('put refuses statically-registered type with allowRuntimeCreate:false (function)', async () => {
        // `function` IS in the static registry with both flags false.
        // The new "unknown type ⇒ permissive" branch must NOT relax it.
        await expect(
            repo.put(
                { org: 'org_alpha', type: 'function', name: 'my_fn' },
                { name: 'my_fn', handler: 'index.ts' },
                { parentVersion: null, actor: 'studio', intent: 'runtime-only' },
            ),
        ).rejects.toMatchObject({ code: 'not_creatable', status: 403 });
    });

    // ── list ────────────────────────────────────────────────────────

    it('list yields headers for stored items, body stripped', async () => {
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'a' },
            { name: 'a', columns: [] },
            { parentVersion: null, actor: 'studio' },
        );
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'b' },
            { name: 'b', columns: [] },
            { parentVersion: null, actor: 'studio' },
        );
        const headers: any[] = [];
        for await (const h of repo.list({ type: 'view' })) headers.push(h);
        expect(headers).toHaveLength(2);
        expect(headers[0]).not.toHaveProperty('body');
        expect(headers[0]).toHaveProperty('hash');
        expect(headers[0]).toHaveProperty('ref');
    });

    // ── watch ───────────────────────────────────────────────────────

    it('watch delivers events to subscribers', async () => {
        const received: any[] = [];
        const iter = repo.watch({ type: 'view' });
        const ai = iter[Symbol.asyncIterator]();

        // Background consumer.
        const consume = (async () => {
            for (let i = 0; i < 2; i += 1) {
                const r = await ai.next();
                if (r.done) break;
                received.push(r.value);
            }
        })();

        // Give the iterator a tick to register before firing events.
        await new Promise((r) => setTimeout(r, 0));
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'one' },
            { name: 'one' }, { parentVersion: null, actor: 'studio' },
        );
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'two' },
            { name: 'two' }, { parentVersion: null, actor: 'studio' },
        );

        await consume;
        await ai.return!();

        expect(received).toHaveLength(2);
        expect(received[0].op).toBe('create');
        expect(received[0].ref.name).toBe('one');
        expect(received[1].ref.name).toBe('two');
    });

    it('watch filters by type', async () => {
        const received: any[] = [];
        const iter = repo.watch({ type: 'dashboard' });
        const ai = iter[Symbol.asyncIterator]();

        const consume = (async () => {
            const r = await ai.next();
            if (!r.done) received.push(r.value);
        })();

        await new Promise((r) => setTimeout(r, 0));
        // View event should be filtered out.
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'v1' },
            { name: 'v1' }, { parentVersion: null, actor: 'studio' },
        );
        // Dashboard event should arrive.
        await repo.put(
            { org: 'org_alpha', type: 'dashboard', name: 'd1' },
            { name: 'd1' }, { parentVersion: null, actor: 'studio' },
        );

        await consume;
        await ai.return!();
        expect(received).toHaveLength(1);
        expect(received[0].ref.type).toBe('dashboard');
    });

    // ── durable history (M1) ────────────────────────────────────────

    it('put writes a history row inside the same transaction', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        await repo.put(ref, sampleView, {
            parentVersion: null, actor: 'studio', source: 'studio',
        });
        expect(engine.historyRows).toHaveLength(1);
        expect(engine.historyRows[0]).toMatchObject({
            organization_id: 'org_alpha',
            type: 'view',
            name: 'case_grid',
            operation_type: 'create',
            version: 1,
            event_seq: 1,
            source: 'studio',
            previous_checksum: null,
            checksum: hashSpec(sampleView),
        });
    });

    it('update writes a history row with previous_checksum chained', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const first = await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        const next = { ...sampleView, label: 'Cases v2' };
        await repo.put(ref, next, { parentVersion: first.version, actor: 'studio' });
        expect(engine.historyRows).toHaveLength(2);
        expect(engine.historyRows[1]).toMatchObject({
            operation_type: 'update',
            version: 2,
            event_seq: 2,
            previous_checksum: first.version,
            checksum: hashSpec(next),
        });
    });

    it('identical-body no-op put does NOT write a history row', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const first = await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await repo.put(ref, sampleView, { parentVersion: first.version, actor: 'studio' });
        expect(engine.historyRows).toHaveLength(1);
    });

    it('conflict put does NOT write a history row', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await expect(
            repo.put(ref, { ...sampleView, label: 'X' }, { parentVersion: 'sha256:wrong', actor: 'studio' }),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(engine.historyRows).toHaveLength(1); // only the initial create
    });

    it('delete writes a tombstone history row (op=delete, body=null, checksum=null)', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const first = await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await repo.delete(ref, { parentVersion: first.version, actor: 'studio', message: 'gone' });
        expect(engine.historyRows).toHaveLength(2);
        expect(engine.historyRows[1]).toMatchObject({
            operation_type: 'delete',
            version: 2,
            event_seq: 2,
            metadata: null,
            checksum: null,
            previous_checksum: first.version,
            change_note: 'gone',
        });
    });

    it('delete then recreate continues incrementing version (no restart at 1)', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const first = await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await repo.delete(ref, { parentVersion: first.version, actor: 'studio' });
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        const versions = engine.historyRows.map((h) => h.version);
        expect(versions).toEqual([1, 2, 3]); // create, delete tombstone, re-create
    });

    it('event_seq is per-org monotonic across types', async () => {
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'a' },
            { name: 'a' }, { parentVersion: null, actor: 'studio' },
        );
        await repo.put(
            { org: 'org_alpha', type: 'dashboard', name: 'b' },
            { name: 'b' }, { parentVersion: null, actor: 'studio' },
        );
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'c' },
            { name: 'c' }, { parentVersion: null, actor: 'studio' },
        );
        const seqs = engine.historyRows.map((h) => h.event_seq);
        expect(seqs).toEqual([1, 2, 3]);
    });

    it('history() yields events in event_seq order with mapped fields', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const first = await repo.put(ref, sampleView, {
            parentVersion: null, actor: 'alice', source: 'studio', message: 'init',
        });
        await repo.put(ref, { ...sampleView, label: 'X' }, {
            parentVersion: first.version, actor: 'bob', source: 'studio',
        });
        const events: any[] = [];
        for await (const e of repo.history({ org: 'org_alpha', type: 'view', name: 'case_grid' })) {
            events.push(e);
        }
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            seq: 1,
            op: 'create',
            ref: { org: 'org_alpha', type: 'view', name: 'case_grid' },
            actor: 'alice',
            source: 'studio',
            message: 'init',
            parentHash: null,
        });
        expect(events[1].op).toBe('update');
        expect(events[1].parentHash).toBe(first.version);
    });

    it('history(since) skips events at or below the cursor', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const a = await repo.put(ref, sampleView, { parentVersion: null, actor: 'a' });
        await repo.put(ref, { ...sampleView, label: 'b' }, { parentVersion: a.version, actor: 'a' });
        const events: any[] = [];
        for await (const e of repo.history(
            { org: 'org_alpha', type: 'view', name: 'case_grid' },
            { sinceSeq: 1 },
        )) {
            events.push(e);
        }
        expect(events).toHaveLength(1);
        expect(events[0].seq).toBe(2);
    });

    // ── draft / publish / rollback (per-item lifecycle) ─────────────

    it('put with state=draft creates a separate draft row that does not affect active reads', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        const active = await repo.put(ref, sampleView, {
            parentVersion: null,
            actor: 'studio',
        });
        const draft = await repo.put(
            ref,
            { ...sampleView, label: 'Draft Label' },
            { parentVersion: null, actor: 'studio', state: 'draft' },
        );
        expect(draft.version).not.toBe(active.version);
        // Active read still sees published body.
        const live = await repo.get(ref);
        expect(live!.body.label).toBe('Cases');
        // Explicit draft read sees the pending body.
        const pending = await repo.get(ref, { state: 'draft' });
        expect(pending!.body.label).toBe('Draft Label');
    });

    it('drafts do not broadcast watch events', async () => {
        const received: any[] = [];
        const iter = repo.watch({ type: 'view' });
        const ai = iter[Symbol.asyncIterator]();

        const consume = (async () => {
            for (let i = 0; i < 2; i += 1) {
                const r = await ai.next();
                if (r.done) break;
                received.push(r.value);
            }
        })();

        await new Promise((r) => setTimeout(r, 0));
        // Draft write — must NOT be emitted.
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'drafty' },
            { name: 'drafty' },
            { parentVersion: null, actor: 'studio', state: 'draft' },
        );
        // Active write — should be received.
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'live1' },
            { name: 'live1' },
            { parentVersion: null, actor: 'studio' },
        );
        // Second active write — should also be received (2nd event).
        await repo.put(
            { org: 'org_alpha', type: 'view', name: 'live2' },
            { name: 'live2' },
            { parentVersion: null, actor: 'studio' },
        );

        await consume;
        await ai.return!();
        expect(received.map((e) => e.ref.name)).toEqual(['live1', 'live2']);
    });

    it('promoteDraft promotes the draft body to active and clears the draft', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await repo.put(
            ref,
            { ...sampleView, label: 'Draft Label' },
            { parentVersion: null, actor: 'studio', state: 'draft' },
        );
        const result = await repo.promoteDraft(ref, { actor: 'admin' });
        expect(result.item.body.label).toBe('Draft Label');
        // Active is now the formerly-draft body.
        const live = await repo.get(ref);
        expect(live!.body.label).toBe('Draft Label');
        // Draft row is gone.
        expect(await repo.get(ref, { state: 'draft' })).toBeNull();
        // History records a 'publish' op.
        const events: any[] = [];
        for await (const e of repo.history(ref)) events.push(e);
        const ops = events.map((e) => e.op);
        expect(ops).toContain('publish');
    });

    it('promoteDraft carries the draft package binding onto the promoted active row', async () => {
        // A whole-app build stages every artifact bound to the app's workspace
        // package and the app starts `hidden`. Promotion MUST preserve that
        // binding — otherwise the active app row lands unbound (package_id NULL)
        // and the ADR-0045 publish visibility flip (which looks up hidden apps
        // by package: getMetaItems({ type:'app', packageId })) never matches it,
        // leaving the freshly-built app hidden from the app switcher forever.
        const ref = { org: 'org_alpha', type: 'app' as const, name: 'ticket_service_app' };
        await repo.put(
            ref,
            { name: 'ticket_service_app', label: 'Tickets', hidden: true },
            { parentVersion: null, actor: 'studio', state: 'draft', packageId: 'app.tickets' },
        );
        await repo.promoteDraft(ref, { actor: 'admin' });
        const activeRow = Array.from(engine.rows.values()).find(
            (r) => (r as any).type === 'app'
                && (r as any).name === 'ticket_service_app'
                && (r as any).state === 'active',
        ) as any;
        expect(activeRow).toBeDefined();
        expect(activeRow.package_id).toBe('app.tickets');
        // The draft row is consumed by the promotion.
        const draftRow = Array.from(engine.rows.values()).find(
            (r) => (r as any).type === 'app'
                && (r as any).name === 'ticket_service_app'
                && (r as any).state === 'draft',
        );
        expect(draftRow).toBeUndefined();
    });

    it('promoteDraft throws no_draft when nothing is pending', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await expect(
            repo.promoteDraft(ref, { actor: 'admin' }),
        ).rejects.toMatchObject({ code: 'no_draft', status: 404 });
    });

    it('restoreVersion writes the historical body back as active with op=revert', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        // v1
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        // v2
        const v2 = await repo.put(
            ref,
            { ...sampleView, label: 'Renamed' },
            { parentVersion: hashSpec(sampleView), actor: 'studio' },
        );
        // Now rollback to v1.
        const result = await repo.restoreVersion(ref, 1, { actor: 'admin' });
        expect(result.item.body.label).toBe('Cases');
        const live = await repo.get(ref);
        expect(live!.body.label).toBe('Cases');
        const events: any[] = [];
        for await (const e of repo.history(ref)) events.push(e);
        expect(events.map((e) => e.op)).toContain('revert');
        // Last event should be the revert; its hash matches v1's body.
        expect(events[events.length - 1].op).toBe('revert');
        expect(events[events.length - 1].hash).toBe(hashSpec(sampleView));
        void v2;
    });

    it('restoreVersion throws version_not_found for missing version', async () => {
        const ref = { org: 'org_alpha', type: 'view' as const, name: 'case_grid' };
        await repo.put(ref, sampleView, { parentVersion: null, actor: 'studio' });
        await expect(
            repo.restoreVersion(ref, 99, { actor: 'admin' }),
        ).rejects.toMatchObject({ code: 'version_not_found', status: 404 });
    });

    // ── close ───────────────────────────────────────────────────────

    it('close prevents further reads/writes', () => {
        repo.close();
        return expect(
            repo.get({ org: 'org_alpha', type: 'view', name: 'x' }),
        ).rejects.toThrow(/closed/);
    });
});
