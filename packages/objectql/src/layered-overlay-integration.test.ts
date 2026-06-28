// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0008 PR-10c — LayeredRepository integration test.
 *
 * Composes [SysMetadataRepository, InMemoryRepository] (top→bottom) to
 * model the eventual production stack
 * [SysMetadataPg, FileSystemRepository] — the artifact baseline at the
 * bottom, the per-org overlay at the top. This pins down the merged
 * read semantics that Studio's PUT pipeline relies on once PR-10d
 * flips `saveMetaItem` onto the repository.
 *
 * Production wiring (saveMetaItem → repo.put) is deferred to a future
 * PR after we verify hash compatibility against real sys_metadata rows
 * in staging. M0 ships the composition-level test as the contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LayeredRepository, InMemoryRepository, hashSpec } from '@objectstack/metadata-core';
import type { MetaRef } from '@objectstack/metadata-core';
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
}

function makeFakeEngine() {
    const rows = new Map<string, Row>();
    const historyRows: any[] = [];
    const keyOf = (w: Record<string, unknown>) =>
        `${w.type}|${w.name}|${String(w.organization_id ?? 'null')}`;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        const k = keyOf(w);
        const r = rows.get(k);
        return r ? { key: k, row: r } : null;
    };
    const matchesHistory = (h: any, where: Record<string, unknown>): boolean => {
        if (where.organization_id !== undefined && h.organization_id !== where.organization_id)
            return false;
        if (where.type !== undefined && h.type !== where.type) return false;
        if (where.name !== undefined && h.name !== where.name) return false;
        return true;
    };
    return {
        rows,
        historyRows,
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts.where));
            }
            return Array.from(rows.values()).filter((r) =>
                (!opts.where.type || r.type === opts.where.type) &&
                (opts.where.organization_id === undefined ||
                    r.organization_id === opts.where.organization_id) &&
                (!opts.where.state || r.state === opts.where.state),
            );
        },
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                const h = { ...(data as any) };
                if (!h.id) h.id = `h_${historyRows.length + 1}`;
                historyRows.push(h);
                return { id: h.id };
            }
            const row: Row = { id: `r_${rows.size + 1}`, ...(data as any) };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any) => Promise<T>): Promise<T> {
            return cb(undefined);
        },
    };
}

const VIEW_REF: MetaRef = {
    org: 'org_alpha',
    type: 'view',
    name: 'case_grid',
};

const baselineView = { name: 'case_grid', label: 'Cases (artifact)', object: 'case', columns: [] };
const overlayView = { name: 'case_grid', label: 'Cases (org overlay)', object: 'case', columns: [{ field: 'name' }] };

describe('LayeredRepository(overlay over artifact) — ADR-0008 PR-10c', () => {
    let baseline: InMemoryRepository;
    let overlay: SysMetadataRepository;
    let layered: LayeredRepository;

    beforeEach(async () => {
        // Bottom layer: simulates platform/built-in artifacts. Seeded
        // with the same org the LayeredRepository will read with —
        // real artifact baselines are org-agnostic, but InMemoryRepository
        // scopes by ref including org. Using the same org models the
        // "platform metadata is identical across orgs" invariant for
        // this test.
        baseline = new InMemoryRepository({ org: 'org_alpha' });
        await baseline.put(
            VIEW_REF,
            baselineView,
            { parentVersion: null, actor: 'cli' },
        );

        overlay = new SysMetadataRepository({
            engine: makeFakeEngine(),
            organizationId: 'org_alpha',
            orgLabel: 'org_alpha',
        });

        layered = new LayeredRepository({
            layers: [
                { label: 'sys-metadata', repo: overlay },   // top — writable
                { label: 'artifact', repo: baseline, readOnly: true },
            ],
        });
    });

    it('read falls through to baseline when no overlay exists', async () => {
        const item = await layered.get(VIEW_REF);
        expect(item).not.toBeNull();
        expect(item!.body.label).toBe('Cases (artifact)');
    });

    it('overlay wins over baseline on read', async () => {
        await overlay.put(VIEW_REF, overlayView, { parentVersion: null, actor: 'studio' });
        const item = await layered.get(VIEW_REF);
        expect(item!.body.label).toBe('Cases (org overlay)');
        expect(item!.hash).toBe(hashSpec(overlayView));
    });

    it('writes route to the topmost writable layer (overlay only)', async () => {
        await layered.put(VIEW_REF, overlayView, { parentVersion: null, actor: 'studio' });
        // Baseline must be untouched.
        const baselineItem = await baseline.get(VIEW_REF);
        expect(baselineItem!.body.label).toBe('Cases (artifact)');
        // Overlay must have the new row.
        const overlayItem = await overlay.get(VIEW_REF);
        expect(overlayItem!.body.label).toBe('Cases (org overlay)');
    });

    it('delete from layered removes only the overlay, baseline survives', async () => {
        const put = await layered.put(VIEW_REF, overlayView, { parentVersion: null, actor: 'studio' });
        await layered.delete(VIEW_REF, { parentVersion: put.version, actor: 'studio' });
        // Now reads fall through to baseline again.
        const item = await layered.get(VIEW_REF);
        expect(item!.body.label).toBe('Cases (artifact)');
    });

    it('events from the writable layer propagate through layered.watch', async () => {
        const received: any[] = [];
        const iter = layered.watch({ type: 'view' });
        const ai = iter[Symbol.asyncIterator]();
        // Consume up to 2 events: the replayed baseline seed (tagged
        // `artifact:*`) and then the live overlay put (tagged
        // `sys-metadata:*`). We assert the live event is what we expect.
        const consume = (async () => {
            for (let i = 0; i < 2; i++) {
                const r = await ai.next();
                if (r.done) break;
                received.push(r.value);
            }
        })();

        await new Promise((r) => setTimeout(r, 0));
        await overlay.put(VIEW_REF, overlayView, { parentVersion: null, actor: 'studio' });
        await consume;
        await ai.return!();

        const live = received.find((e) => /^sys-metadata:/.test(e.source));
        expect(live).toBeDefined();
        expect(live.op).toBe('create');
        expect(live.ref.name).toBe('case_grid');
    });

    it('list merges layers with overlay taking precedence on collision', async () => {
        // Baseline has case_grid; overlay shadows it AND adds invoice_grid.
        await overlay.put(VIEW_REF, overlayView, { parentVersion: null, actor: 'studio' });
        await overlay.put(
            { ...VIEW_REF, name: 'invoice_grid' },
            { name: 'invoice_grid', columns: [] },
            { parentVersion: null, actor: 'studio' },
        );

        const headers: any[] = [];
        for await (const h of layered.list({ type: 'view' })) headers.push(h);

        // Both names present; case_grid hash matches the overlay (not baseline).
        const byName = new Map(headers.map((h) => [h.ref.name, h]));
        expect(byName.has('case_grid')).toBe(true);
        expect(byName.has('invoice_grid')).toBe(true);
        expect(byName.get('case_grid').hash).toBe(hashSpec(overlayView));
    });
});
