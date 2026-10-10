// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] Every metadata read is environment → code.
 *
 *  1. A legacy organization-scoped row — one per formerly org-overridable
 *     (tier-A) type, stored before the per-organization overlay axis retired —
 *     is invisible to the item, list, layered, history, diff, audit, drafts,
 *     commits, lock and ETag reads, whatever organization a caller still
 *     names: the environment's row, or the code definition, is served.
 *     `overlayScope` is `'env'` or `null`, never `'org'`.
 *  2. [Triage ruling Q1 → C] An environment overlay row of SEALED managed
 *     content — a managed action or hook, written through the
 *     `OS_METADATA_WRITABLE` hatch before the seal — is not served: the
 *     package's definition wins. `permission` keeps its own fork ruling, so a
 *     fork of a packaged permission set is still served (the control).
 *  3. The boot report names both populations, per type, with their remedies
 *     — the v18 migration ceremony for the legacy organization rows, and the
 *     two remedies for the sealed overlays. Nothing is deleted or rewritten.
 *  4. [Triage ruling Q3 A] The one read left that reaches a legacy
 *     organization's rows: the anonymous form doors' `view` list read
 *     (`legacyFormOrganizationId`), kept fail-closed until the ceremony. Any
 *     other type reads the environment alone, whoever passes the key.
 *
 * Reverse verification (one-shot, recorded in the PR): restoring an
 * organization row to the served-row lookup (`findServedOverlayRow` with its
 * `organization_id` predicate removed) turns §1's item-read pin red; removing
 * the sealed arm from `declinesStoredRow` turns §2 red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineFindOnePredicate,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const ORG = 'org_a';
const PKG = 'app.pkg';
const TIER_A = ['view', 'dashboard', 'report', 'translation', 'email_template'] as const;

type Row = Record<string, unknown>;

/** Equality (NULL included), `$or`, `$null` and `$in` — the subset these reads emit. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Row[]).some((clause) => matches(row, clause))) return false;
            continue;
        }
        if (v === undefined) continue;
        const actual = row[k] ?? null;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const ops = v as Record<string, unknown>;
            if ('$null' in ops && (actual === null) !== ops.$null) return false;
            if ('$in' in ops && !(ops.$in as unknown[]).includes(actual)) return false;
            continue;
        }
        if (actual !== v) return false;
    }
    return true;
}

interface Artifact { type: string; name: string; body: Row }

function harness(seed: Record<string, Row[]>, artifacts: Artifact[] = []) {
    const tables = new Map<string, Row[]>(Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
    const table = (t: string) => {
        if (!tables.has(t)) tables.set(t, []);
        return tables.get(t)!;
    };
    let nextId = 0;
    const artifactOf = (type: string, name: string) =>
        artifacts.find((a) => a.type === type && a.name === name)?.body;
    const engine: any = {
        async find(t: string, q?: { where?: Row }) {
            return table(t).filter((r) => matches(r, q?.where));
        },
        async findOne(t: string, q: { where: Row }) {
            assertEngineFindOnePredicate(t, q);
            return table(t).find((r) => matches(r, q.where)) ?? null;
        },
        async insert(t: string, data: Row) {
            nextId += 1;
            const row = { ...data, id: data.id ?? `i_${nextId}` };
            table(t).push(row);
            return { id: row.id };
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
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getObject: () => undefined,
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            listItems: (type: string) => artifacts.filter((a) => a.type === type).map((a) => ({ ...a.body })),
            getItem: (type: string, name: string) => artifactOf(type, name),
            getArtifactItem: (type: string, name: string) => artifactOf(type, name),
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod') as any;
    return { protocol, tables };
}

const metaRow = (type: string, name: string, org: string | null, body: Row, over: Row = {}): Row => ({
    id: `r_${type}_${name}_${org ?? 'env'}_${String(over.state ?? 'active')}`,
    type,
    name,
    organization_id: org,
    package_id: null,
    state: 'active',
    version: 1,
    metadata: JSON.stringify({ name, ...body }),
    ...over,
});

/** The two spellings a caller may still send: none, and a retired organization key. */
const CALLERS = [{}, { organizationId: ORG }] as const;
const asCaller = <R extends object>(request: R, caller: object) => ({ ...request, ...caller }) as R;

afterEach(() => vi.restoreAllMocks());

describe('§1 [ADR-0131 D6] a legacy organization row is invisible to every read, whatever organization the caller names', () => {
    for (const type of TIER_A) {
        const seed = () => ({
            sys_metadata: [
                metaRow(type, 'shared', null, { label: 'env' }),
                metaRow(type, 'shared', ORG, { label: 'org', _lock: 'full' }),
                metaRow(type, 'org_only', ORG, { label: 'org only' }),
                metaRow(type, 'org_draft', ORG, { label: 'org draft' }, { state: 'draft' }),
            ],
            sys_metadata_history: [
                {
                    id: 'h_org', type, name: 'org_only', organization_id: ORG, version: 1, event_seq: 1,
                    operation_type: 'put', metadata: JSON.stringify({ name: 'org_only' }), checksum: 'x',
                    recorded_at: '2026-01-01T00:00:00.000Z',
                },
            ],
            sys_metadata_audit: [
                { id: 'a_env', type, name: 'shared', organization_id: null, operation: 'save', outcome: 'allowed', code: 'ok' },
                { id: 'a_org', type, name: 'shared', organization_id: ORG, operation: 'save', outcome: 'allowed', code: 'ok' },
            ],
            sys_metadata_commit: [
                { id: 'c_env', package_id: PKG, organization_id: null, operation: 'apply', items: '[]', item_count: 0 },
                { id: 'c_org', package_id: PKG, organization_id: ORG, operation: 'apply', items: '[]', item_count: 0 },
            ],
        });

        for (const caller of CALLERS) {
            const who = 'organizationId' in caller ? `a caller naming ${ORG}` : 'a caller naming none';
            it(`${type} · ${who}: item, list, layered, history, diff, audit, drafts, commits, lock and ETag`, async () => {
                const { protocol } = harness(seed());

                // item: the environment's row, its lock; the org-only name answers nothing
                const shared = await protocol.getMetaItem(asCaller({ type, name: 'shared' }, caller));
                expect(shared.item?.label).toBe('env');
                expect(shared.lock).toBe('none');
                expect((await protocol.getMetaItem(asCaller({ type, name: 'org_only' }, caller))).item).toBeUndefined();

                // list
                const list = await protocol.getMetaItems(asCaller({ type }, caller));
                const listed = (list.items as Row[]).map((i) => `${String(i.name)}=${String(i.label)}`);
                expect(listed).toEqual(['shared=env']);

                // layered: overlayScope is 'env' or null, never 'org'
                const layeredShared = await protocol.getMetaItemLayered(asCaller({ type, name: 'shared' }, caller));
                expect({ label: layeredShared.overlay?.label, scope: layeredShared.overlayScope, lock: layeredShared.lock })
                    .toEqual({ label: 'env', scope: 'env', lock: 'none' });
                const layeredOrgOnly = await protocol.getMetaItemLayered(asCaller({ type, name: 'org_only' }, caller));
                expect([layeredOrgOnly.overlay, layeredOrgOnly.overlayScope]).toEqual([null, null]);

                // history and diff: the legacy organization's change log is not read
                expect((await protocol.historyMetaItem(asCaller({ type, name: 'org_only' }, caller))).events).toEqual([]);
                const diff = await settle(protocol.diffMetaItem(asCaller({ type, name: 'org_only' }, caller)));
                expect(JSON.stringify(diff)).not.toContain('org_only"}');

                // audit
                const audit = await protocol.auditMetaItem(asCaller({ type, name: 'shared' }, caller));
                expect(audit.events.map((e: Row) => e.id)).toEqual(['a_env']);

                // drafts
                const drafts = await protocol.listDrafts(asCaller({ type }, caller));
                expect(drafts.drafts).toEqual([]);

                // commits
                const commits = await protocol.listCommits(asCaller({ packageId: PKG }, caller));
                expect(commits.map((c: Row) => c.id)).toEqual(['c_env']);

                // ETag: one validator, whoever asks
                const cached = await protocol.getMetaItemCached(asCaller({ type, name: 'shared' }, caller));
                const unscoped = await protocol.getMetaItemCached({ type, name: 'shared' });
                expect(cached.etag.value).toBe(unscoped.etag.value);
                expect(cached.data?.label).toBe('env');
            });
        }
    }
});

/** A promise's value, or the error it rejected with. */
async function settle<T>(p: Promise<T>): Promise<T | Error> {
    try {
        return await p;
    } catch (e) {
        return e as Error;
    }
}

describe('§2 [triage ruling Q1 → C] an environment overlay of sealed managed content is not served: the package definition wins', () => {
    const packaged = (type: string, name: string): Artifact => ({
        type, name, body: { name, label: 'packaged', _packageId: PKG },
    });

    for (const type of ['action', 'hook'] as const) {
        it(`a managed ${type}: the item, list and layered reads serve the package's definition, not the hatch-written row`, async () => {
            const { protocol } = harness(
                { sys_metadata: [metaRow(type, 'managed', null, { label: 'hatch-written' })] },
                [packaged(type, 'managed')],
            );
            expect(protocol.declinesStoredRow(type, 'managed')).toBe(true);

            const item = await protocol.getMetaItem({ type, name: 'managed' });
            expect(item.item?.label).toBe('packaged');

            const list = await protocol.getMetaItems({ type });
            expect((list.items as Row[]).filter((i) => i.name === 'managed').map((i) => i.label)).toEqual(['packaged']);

            const layered = await protocol.getMetaItemLayered({ type, name: 'managed' });
            expect(layered.effective?.label).toBe('packaged');
        });

        it(`control: an environment ${type} no managed package ships is served from its row`, async () => {
            const { protocol } = harness({ sys_metadata: [metaRow(type, 'authored', null, { label: 'authored' })] });
            expect(protocol.declinesStoredRow(type, 'authored')).toBe(false);
            expect((await protocol.getMetaItem({ type, name: 'authored' })).item?.label).toBe('authored');
        });
    }

    it('control: a regime-O type keeps its overlay of a packaged item (a view)', async () => {
        const { protocol } = harness(
            { sys_metadata: [metaRow('view', 'managed', null, { label: 'overlay' })] },
            [packaged('view', 'managed')],
        );
        expect(protocol.declinesStoredRow('view', 'managed')).toBe(false);
        expect((await protocol.getMetaItem({ type: 'view', name: 'managed' })).item?.label).toBe('overlay');
    });

    it('control: a fork of a packaged permission set keeps its own ruling and is still served', async () => {
        const { protocol } = harness(
            { sys_metadata: [metaRow('permission', 'managed', null, { label: 'fork', objects: {} })] },
            [packaged('permission', 'managed')],
        );
        expect(protocol.declinesStoredRow('permission', 'managed')).toBe(false);
    });
});

describe('§3 the boot report names both populations, per type, with their remedies', () => {
    async function boot(seed: Record<string, Row[]>, artifacts: Artifact[] = []) {
        const warns: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warns.push(a.map(String).join(' ')); });
        const { protocol } = harness(seed, artifacts);
        const result = await protocol.loadMetaFromDb();
        return { result, warns };
    }

    it('one line per population: the legacy organization rows (the ceremony), the sealed overlays (the two remedies)', async () => {
        const { warns } = await boot(
            {
                sys_metadata: [
                    metaRow('view', 'org_grid', ORG, { label: 'org' }),
                    metaRow('dashboard', 'org_board', ORG, { label: 'org' }),
                    metaRow('action', 'managed', null, { label: 'hatch-written' }),
                    metaRow('hook', 'managed', null, { label: 'hatch-written' }),
                    metaRow('view', 'env_grid', null, { label: 'env' }),
                ],
            },
            [
                { type: 'action', name: 'managed', body: { name: 'managed', _packageId: PKG } },
                { type: 'hook', name: 'managed', body: { name: 'managed', _packageId: PKG } },
            ],
        );

        const legacy = warns.filter((w) => w.includes('[metadata_org_scoped_unserved]'));
        expect(legacy).toHaveLength(1);
        expect(legacy[0]).toContain('view×1 (org_grid@org_a)');
        expect(legacy[0]).toContain('dashboard×1 (org_board@org_a)');
        expect(legacy[0]).toContain('os migrate');
        expect(legacy[0]).toContain('Nothing is deleted or rewritten');

        const sealed = warns.filter((w) => w.includes('[metadata_sealed_overlay_unserved]'));
        expect(sealed).toHaveLength(1);
        expect(sealed[0]).toContain('action×1 (managed)');
        expect(sealed[0]).toContain('hook×1 (managed)');
        expect(sealed[0]).toContain('linkage-free clone');
        expect(sealed[0]).toContain('delete the stored row');
        expect(sealed[0]).not.toContain('env_grid');
    });

    it('silence on a store with neither population', async () => {
        const { warns } = await boot({ sys_metadata: [metaRow('view', 'env_grid', null, { label: 'env' })] });
        expect(warns.filter((w) => w.includes('_unserved]'))).toEqual([]);
    });
});

describe('§4 [triage ruling Q3 A] the anonymous form doors\' legacy layer is the one read left that reaches a legacy organization', () => {
    const seed = () => ({
        sys_metadata: [
            metaRow('view', 'intake', null, { label: 'env intake' }),
            metaRow('view', 'intake', ORG, { label: 'org intake' }),
            metaRow('dashboard', 'board', ORG, { label: 'org board' }),
        ],
    });

    it('a view list read with legacyFormOrganizationId prefers that organization\'s body', async () => {
        const { protocol } = harness(seed());
        const list = await protocol.getMetaItems({ type: 'view', legacyFormOrganizationId: ORG });
        expect((list.items as Row[]).map((i) => i.label)).toEqual(['org intake']);
        // …and nothing else reads it: the same list without the key, and with the retired key.
        for (const caller of CALLERS) {
            const plain = await protocol.getMetaItems(asCaller({ type: 'view' }, caller));
            expect((plain.items as Row[]).map((i) => i.label)).toEqual(['env intake']);
        }
    });

    it('the key reaches no other type', async () => {
        const { protocol } = harness(seed());
        const list = await protocol.getMetaItems({ type: 'dashboard', legacyFormOrganizationId: ORG });
        expect(list.items).toEqual([]);
    });
});
