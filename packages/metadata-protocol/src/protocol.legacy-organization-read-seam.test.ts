// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6/D7, #23609] The legacy-organization read seam on a database the
 * organization-ownership ceremony has not migrated: the `sys_metadata` family
 * declares no organization column, the engine shapes every read to the
 * declared columns, and the physical column still holds each legacy
 * organization's rows. Every case runs twice: on that v17 shape, and on a
 * migrated store (no physical column, the CONTROL), whose answers are the
 * ones every read gave before.
 *
 * 1. A read that PAGES leaves the legacy rows out before the page is cut:
 *    `auditMetaItem` (`orderBy` + `limit`), `listCommits` (`limit`),
 *    `revertStoredPackage`'s `limit: 1` probe and the repository's
 *    `list({ limit })`. Filtered after the cut, the page came back short, and
 *    the probe answered 409 "never been published" for a package whose first
 *    active row was an organization's.
 *
 * The real-engine pins over a v17-shape SQLite file are in `@objectstack/cli`
 * (`meta-stored-legacy-organization.integration.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SysMetadataRepository } from './sys-metadata-repository.js';

type Row = Record<string, unknown>;

/** Equality (NULL included), `$and`, `$in` and `$nin` — the subset these reads emit. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$and') {
            if (!(v as Row[]).every((clause) => matches(row, clause))) return false;
            continue;
        }
        // Any other combinator is refused, never read as a field name.
        if (k.startsWith('$')) throw new Error(`matches: unsupported combinator ${k}`);
        if (v === undefined) continue;
        const actual = row[k] ?? null;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const ops = v as Record<string, unknown>;
            for (const op of Object.keys(ops)) {
                if (op !== '$in' && op !== '$nin') throw new Error(`matches: unsupported operator ${op}`);
            }
            if ('$in' in ops && !(ops.$in as unknown[]).includes(actual)) return false;
            if ('$nin' in ops && (ops.$nin as unknown[]).includes(actual)) return false;
            continue;
        }
        if (actual !== v) return false;
    }
    return true;
}

/**
 * An engine over `seed`. `legacyShape` puts the physical `organization_id`
 * column on disk: the driver's catalog read lists it and its row read answers
 * the rows that carry a value. Either way the engine's own reads never return
 * the key, as the real engine's do not.
 */
function harness(seed: Record<string, Row[]>, legacyShape: boolean) {
    const tables = new Map<string, Row[]>(Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
    const table = (t: string) => {
        if (!tables.has(t)) tables.set(t, []);
        return tables.get(t)!;
    };
    const declared = ({ organization_id: _physical, ...row }: Row): Row => row;
    const select = (t: string, q?: { where?: Row; orderBy?: Array<{ field: string; order: 'asc' | 'desc' }>; limit?: number; offset?: number }) => {
        let rows = table(t).filter((r) => matches(r, q?.where));
        for (const { field, order } of [...(q?.orderBy ?? [])].reverse()) {
            rows = [...rows].sort((a, b) => {
                const cmp = String(a[field]).localeCompare(String(b[field]));
                return order === 'desc' ? -cmp : cmp;
            });
        }
        const start = q?.offset ?? 0;
        return rows.slice(start, typeof q?.limit === 'number' ? start + q.limit : undefined).map(declared);
    };
    const engine: any = {
        async find(t: string, q?: any) { return select(t, q); },
        async findOne(t: string, q: { where: Row }) {
            assertEngineFindOnePredicate(t, q);
            return select(t, q)[0] ?? null;
        },
        async count(t: string, q?: { where?: Row }) { return select(t, q).length; },
        async insert(t: string, data: Row) {
            table(t).push({ ...data });
            return { id: data.id };
        },
        async update(_t: string, data: Row, o: { where: Row }) {
            assertEngineUpdateDispatch(data, o);
            return { id: null };
        },
        async delete(_t: string, o: { where: Row }) {
            assertEngineDeleteDispatch(o);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        getDriverForObject(t: string) {
            return {
                dialectName: 'sqlite',
                async execute(sql: string) {
                    if (/column_name/.test(sql)) {
                        return [{ column_name: 'id' }, ...(legacyShape ? [{ column_name: 'organization_id' }] : [])];
                    }
                    return table(t)
                        .filter((r) => r.organization_id !== undefined && r.organization_id !== null && r.organization_id !== '')
                        .map((r) => ({ id: r.id, organization_id: r.organization_id }));
                },
            };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getObject: () => undefined,
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod') as any;
    protocol.overlayIndexEnsured = true;
    return { protocol, engine };
}

/** The v17 shape keeps the legacy rows on disk; a migrated store holds none of them. */
const store = (rows: Row[], legacyShape: boolean): Row[] =>
    legacyShape ? rows : rows.filter((r) => r.organization_id === null || r.organization_id === undefined);

const SHAPES = [
    { shape: 'v17 shape (legacy organization rows on disk)', legacyShape: true },
    { shape: 'CONTROL: a migrated store', legacyShape: false },
] as const;

const audit = (id: string, at: string, organization_id: string | null): Row => ({
    id, type: 'view', name: 'grid', occurred_at: at, actor: 'u', source: null, operation: 'save',
    outcome: 'allowed', code: 'OK', lock_state: null, lock_overridden: false, request_id: null, note: null,
    organization_id,
});

const commit = (id: string, at: string, organization_id: string | null): Row => ({
    id, package_id: 'app.pkg', operation: 'apply', item_count: 0, items: '[]', created_at: at, organization_id,
});

const active = (id: string, name: string, organization_id: string | null): Row => ({
    id, type: 'view', name, package_id: 'app.pkg', state: 'active', version: 1,
    metadata: JSON.stringify({ name }), organization_id,
});

describe('[#23609] a read that pages leaves the legacy organization rows out before the page is cut', () => {
    for (const { shape, legacyShape } of SHAPES) {
        describe(shape, () => {
            it('auditMetaItem: the newest `limit` events of the environment, never a short page', async () => {
                const rows = store([
                    audit('e_old', '2026-01-01T00:00:00.000Z', null),
                    audit('e_mid', '2026-01-02T00:00:00.000Z', null),
                    audit('o_new1', '2026-01-03T00:00:00.000Z', 'org_a'),
                    audit('o_new2', '2026-01-04T00:00:00.000Z', 'org_a'),
                ], legacyShape);
                const { protocol } = harness({ sys_metadata_audit: rows }, legacyShape);
                const { events } = await protocol.auditMetaItem({ type: 'view', name: 'grid', limit: 2 });
                expect(events.map((e: { id: unknown }) => e.id)).toEqual(['e_mid', 'e_old']);
            });

            it('listCommits: `limit` environment commits', async () => {
                const rows = store([
                    commit('o_c1', '2026-01-01T00:00:00.000Z', 'org_a'),
                    commit('c_env', '2026-01-02T00:00:00.000Z', null),
                ], legacyShape);
                const { protocol } = harness({ sys_metadata_commit: rows }, legacyShape);
                const commits = await protocol.listCommits({ packageId: 'app.pkg', limit: 1 });
                expect(commits.map((c: { id: string }) => c.id)).toEqual(['c_env']);
            });

            it('revertStoredPackage: a package the environment published is reverted, whatever row comes first', async () => {
                const rows = store([active('o_row', 'org_grid', 'org_a'), active('e_row', 'grid', null)], legacyShape);
                const { protocol } = harness({ sys_metadata: rows }, legacyShape);
                await expect(protocol.revertStoredPackage({ packageId: 'app.pkg' }))
                    .resolves.toEqual({ stored: true, discarded: [] });
            });

            it('revertStoredPackage: a package only an organization published holds nothing of the environment\'s', async () => {
                const rows = store([active('o_row', 'org_grid', 'org_a')], legacyShape);
                const { protocol } = harness({ sys_metadata: rows }, legacyShape);
                await expect(protocol.revertStoredPackage({ packageId: 'app.pkg' }))
                    .resolves.toEqual({ stored: false, discarded: [] });
            });

            it('an offset counts the environment\'s rows only', async () => {
                const rows = store([
                    commit('o_c1', '2026-01-01T00:00:00.000Z', 'org_a'),
                    commit('c_1', '2026-01-02T00:00:00.000Z', null),
                    commit('c_2', '2026-01-03T00:00:00.000Z', null),
                ], legacyShape);
                const { protocol } = harness({ sys_metadata_commit: rows }, legacyShape);
                const page = await protocol.findEnvironmentRows('sys_metadata_commit', {
                    where: { package_id: 'app.pkg' }, offset: 1, limit: 1, context: { isSystem: true },
                });
                expect(page.map((r: Row) => r.id)).toEqual(['c_2']);
            });

            it('the repository\'s list({ limit }): `limit` environment rows', async () => {
                const rows = store([active('o_row', 'org_grid', 'org_a'), active('e_row', 'grid', null)], legacyShape);
                const { engine } = harness({ sys_metadata: rows }, legacyShape);
                const repo = new SysMetadataRepository({ engine } as any);
                const names: string[] = [];
                for await (const header of repo.list({ type: 'view', limit: 1 })) names.push(String(header.ref.name));
                expect(names).toEqual(['grid']);
            });
        });
    }
});
