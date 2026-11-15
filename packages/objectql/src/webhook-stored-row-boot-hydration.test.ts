// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31699 PR 2 round 2, R2-B] How a stored webhook row reaches the registry at
 * boot, for one holder and two.
 *
 * The metadata boot priming pass never reads a webhook row: it walks
 * `DEFAULT_METADATA_TYPE_REGISTRY`, which lists no webhook
 * (`database-loader.test.ts`, the #32458 CONTROL). The path that does is the
 * protocol's boot hydration, `loadMetaFromDb` (`ObjectQLPlugin.start()`),
 * which hands every environment row of every type to
 * `hydrateOverlayIntoRegistry`, and so to `registerItem` under the row's
 * package. The declared-webhook reader dispatches each holder's
 * `getPackageScopedItem` (`declared-webhooks.test.ts`), so the slot a row lands
 * in is the declaration that holder's events are sent with.
 *
 * Measured the same with and without this PR's type-set flips: a row naming a
 * holder lands in that holder's slot and in no other. A webhook overlay of a
 * shipped declaration is sealed (ADR-0131 D6), so such a row is residue an
 * older release stored, and the boot census names it with its remedy.
 *
 * [#32741, merged from main] A package-less row at a holder's address is
 * declined for a sealed type in every hydration state, so it no longer lands
 * in the one holder's slot: the slot keeps the holder's declaration. Measured
 * the same on the merged tree with `webhook` out of the three type sets
 * (dists rebuilt), so that move is #32741's, not this PR's.
 *
 * The harness is the one `protocol.hydrate-overlay-canonical-type.test.ts`
 * uses: an engine double answering `find` over the stored rows, with the real
 * `SchemaRegistry` and the real `ObjectStackProtocolImplementation`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
/** [#32692] An installed package that declares no webhook. */
const S = 'com.acme.stray';
const T = 'task_changed';
const hook = (url: string) => ({ name: T, label: 'Task changed', object: 'showcase_task', triggers: ['create'], url });
const shipped = (id: string) => `https://hooks.example/${id.split('.').pop()}`;

/** The registry with each id installed as a code package declaring {@link T}, in this order. */
function registryShipping(ids: string[]): SchemaRegistry {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    registry.installPackage({ id: S, name: S, version: '1.0.0', type: 'app', namespace: 'stray' } as never, 'code');
    for (const id of ids) {
        registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop() } as never, 'code');
        registry.registerItem('webhook', hook(shipped(id)), 'name' as never, id);
    }
    return registry;
}

/** The boot hydration over `rows` (stored environment rows of {@link T}), then each holder's slot. */
async function hydrate(ids: string[], rows: Array<{ packageId: string | null; url: string }>) {
    const registry = registryShipping(ids);
    const stored = rows.map((r, i) => ({
        id: `row_${i}`, type: 'webhook', name: T, organization_id: null, package_id: r.packageId, state: 'active',
        metadata: JSON.stringify(hook(r.url)),
    }));
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const where = opts?.where ?? {};
            const rows = stored.filter((r) => Object.entries(where).every(([k, v]) => v === undefined || (r as any)[k] === v));
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
        },
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query);
            return null;
        },
        registry,
    };
    const load = await new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod').loadMetaFromDb();
    const slot = (id: string) => (registry.getPackageScopedItem('webhook', T, id) as { url?: string } | undefined)?.url;
    return {
        load,
        holders: [...registry.packageScopedHoldersOf('webhook', T)].sort(),
        environment: registry.getEnvironmentScopedItem('webhook', T),
        slots: Object.fromEntries(ids.map((id) => [id, slot(id)])),
        stray: slot(S),
    };
}

describe('a stored webhook row at boot: loadMetaFromDb registers it in its own holder\'s slot (#31699 R2-B)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { warn.mockRestore(); });

    it('CONTROL — one holder: a row naming it is its slot; a row naming no package is declined, as main since #32741, so the slot keeps the declaration; no environment holder appears', async () => {
        for (const [packageId, url] of [[A, 'https://stored.example/row'], [null, shipped(A)]] as const) {
            const got = await hydrate([A], [{ packageId, url: 'https://stored.example/row' }]);
            expect(got.load).toMatchObject({ loaded: 1, errors: 0 });
            expect([got.holders, got.environment, got.slots, got.stray], String(packageId)).toEqual([[A], undefined, { [A]: url }, undefined]);
        }
        // The boot census names the sealed residue row (ADR-0131 D6).
        expect(warn.mock.calls.some((call: unknown[]) => String(call[0]).includes('metadata_sealed_overlay_unserved'))).toBe(true);
    });

    for (const order of [[A, B], [B, A]]) {
        it(`two holders (${order[0] === A ? 'alpha' : 'beta'} first): a row naming one holder is that holder's slot, and the other keeps its declaration`, async () => {
            for (const [own, other] of [[A, B], [B, A]]) {
                const got = await hydrate(order, [{ packageId: own, url: 'https://stored.example/row' }]);
                expect(got.load).toMatchObject({ loaded: 1, errors: 0 });
                expect([got.holders, got.environment], own).toEqual([[A, B], undefined]);
                expect(got.slots, own).toEqual({ [own]: 'https://stored.example/row', [other]: shipped(other) });
            }
        });
    }

    it('[#32692] CONTROL — one holder: a row naming a package that declares nothing keeps its reading (it is the one holder\'s), as before', async () => {
        const got = await hydrate([A], [{ packageId: S, url: 'https://stored.example/stray' }]);
        expect([got.holders, got.environment, got.slots]).toEqual([[A], undefined, { [A]: 'https://stored.example/stray' }]);
    });

    for (const order of [[A, B], [B, A]]) {
        it(`[#32692] two holders (${order[0] === A ? 'alpha' : 'beta'} first): a row naming a package that holds no webhook of the name lands in no slot, and the boot census reports it`, async () => {
            // FROM: the row took the first-registered holder's slot (alpha's,
            // or beta's in the other order), so that holder's events went to
            // the row's URL. TO: no slot takes it.
            const got = await hydrate(order, [{ packageId: S, url: 'https://stored.example/stray' }]);
            expect([got.holders, got.environment, got.stray]).toEqual([[A, B], undefined, undefined]);
            expect(got.slots).toEqual({ [A]: shipped(A), [B]: shipped(B) });
            // A webhook is sealed (ADR-0131 D6): the census names the row.
            const lines: string[] = warn.mock.calls.map((call: unknown[]) => String(call[0]));
            expect(lines.some((line) => line.includes('metadata_sealed_overlay_unserved') && line.includes(T))).toBe(true);
        });
    }
});

/**
 * [#32692] The same boot hydration for the other package-scoped types, over a
 * real `SchemaRegistry`: a stored row naming a package that holds no item of a
 * name two other packages hold is laid into no holder's slot, and a bundle
 * addition's own row stays its own. Both registration orders.
 */
describe('a stored row of a two-holder name at boot, beyond the webhook (#32692)', () => {
    const N = 'thing';
    const D = 'com.acme.dep';
    const APP = 'com.acme.app';
    /** Install `<id>.custom`, the per-package customization pair of `id` (ADR-0146). */
    const pair = (id: string) => (registry: SchemaRegistry) => registry.installPackage({ id: `${id}.custom`, name: `${id}.custom`, version: '1.0.0', type: 'app', namespace: `${id.split('.').pop()}_custom` } as never, 'code');
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { warn.mockRestore(); });

    /** Boot `type` with `order` each shipping `ship(id)`, then the stored rows; the protocol and registry after it. */
    async function boot(type: string, order: string[], ship: (id: string) => Record<string, unknown>,
        rows: Array<{ packageId: string; body: Record<string, unknown> }>, extra?: (registry: SchemaRegistry) => void,
        holder?: (id: string) => Record<string, unknown>) {
        const registry = new SchemaRegistry();
        registry.logLevel = 'silent';
        registry.installPackage({ id: S, name: S, version: '1.0.0', type: 'app', namespace: 'stray' } as never, 'code');
        for (const id of order) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop(), ...holder?.(id) } as never, 'code');
            registry.registerItem(type, ship(id), 'name' as never, id);
        }
        extra?.(registry);
        const stored = rows.map((r, i) => ({
            id: `row_${i}`, type, name: N, organization_id: null, package_id: r.packageId, state: 'active', metadata: JSON.stringify(r.body),
        }));
        const matches = (r: Record<string, unknown>, where: Record<string, unknown>) =>
            Object.entries(where).every(([k, v]) => v === undefined || typeof v === 'object' || r[k] === v);
        const engine: any = {
            async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
                if (table !== 'sys_metadata') return [];
                const found = stored.filter((r) => matches(r, opts?.where ?? {}));
                return typeof opts?.limit === 'number' ? found.slice(0, opts.limit) : found;
            },
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                assertEngineFindOnePredicate(object, query);
                return stored.find((r) => matches(r, (query as { where?: Record<string, unknown> } | undefined)?.where ?? {})) ?? null;
            },
            registry,
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod');
        await protocol.loadMetaFromDb();
        const lines = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));
        return { registry, protocol, lines };
    }

    for (const order of [[A, B], [B, A]]) {
        const first = order[0] === A ? 'alpha' : 'beta';

        it(`tool (${first} first): a row naming a package that holds no tool of the name is in no holder's slot`, async () => {
            // FROM: the first-registered holder's slot served the row.
            const body = (label: string) => ({ name: N, label, description: label });
            const { registry } = await boot('tool', order, (id) => body(`shipped:${id}`), [{ packageId: S, body: body('row:stray') }]);
            const label = (id: string) => (registry.getPackageScopedItem('tool', N, id) as { label?: string } | undefined)?.label;
            expect([label(A), label(B), label(S)]).toEqual([`shipped:${A}`, `shipped:${B}`, undefined]);
            expect([...registry.packageScopedHoldersOf('tool', N)].sort()).toEqual([A, B]);
        });

        it(`tool (${first} first): a row of the second holder's customization pair is that holder's item, never the first-registered holder's`, async () => {
            // FROM: the pair row wore the first-registered holder's envelope, so in one order alpha answered beta's override.
            const body = (label: string) => ({ name: N, label, description: label });
            const { registry } = await boot('tool', order, (id) => body(`shipped:${id}`),
                [{ packageId: `${B}.custom`, body: { ...body('row:beta-custom'), overrides: { package: B } } }], pair(B));
            const label = (id: string) => (registry.getPackageScopedItem('tool', N, id) as { label?: string } | undefined)?.label;
            expect([label(A), label(B)]).toEqual([`shipped:${A}`, 'row:beta-custom']);
        });

        it(`tool (${first} first): the first holder's own pair row stays the first holder's, whichever registered first`, async () => {
            const body = (label: string) => ({ name: N, label, description: label });
            const { registry } = await boot('tool', order, (id) => body(`shipped:${id}`),
                [{ packageId: `${A}.custom`, body: { ...body('row:alpha-custom'), overrides: { package: A } } }], pair(A));
            const label = (id: string) => (registry.getPackageScopedItem('tool', N, id) as { label?: string } | undefined)?.label;
            expect([label(A), label(B)]).toEqual(['row:alpha-custom', `shipped:${B}`]);
        });

        it(`tool (${first} first): a pair row that binds to no holder is in no holder's slot and in no registry list`, async () => {
            // FROM: the row took the first-registered holder's slot. Two shapes
            // bind to no holder (the exact read's rule): a shared App pair's
            // row that declares no base, and a per-package pair's row that
            // declares a package the pair does not customize. These rows carry
            // `overrides` as a stored residue does; the hydrator judges them as stored.
            const body = (label: string) => ({ name: N, label, description: label });
            const label = (registry: SchemaRegistry, id: string) => (registry.getPackageScopedItem('tool', N, id) as { label?: string } | undefined)?.label;
            const listed = (registry: SchemaRegistry) => registry.listItems('tool').map((item) => (item as { label?: string }).label);
            const shared = await boot('tool', order, (id) => body(`shipped:${id}`), [{ packageId: `${APP}.custom`, body: body('row:app-custom') }],
                (registry) => {
                    registry.installPackage({ id: APP, name: APP, version: '1.0.0', type: 'app', namespace: 'app' } as never, 'code');
                    registry.installPackage({ id: `${APP}.custom`, name: `${APP}.custom`, version: '1.0.0', type: 'app', namespace: 'app_custom' } as never, 'code');
                },
                () => ({ type: 'module', dependencies: { [APP]: '^1.0.0' } }));
            expect([label(shared.registry, A), label(shared.registry, B)]).toEqual([`shipped:${A}`, `shipped:${B}`]);
            expect(listed(shared.registry)).not.toContain('row:app-custom');
            const nonOwner = await boot('tool', order, (id) => body(`shipped:${id}`),
                [{ packageId: `${B}.custom`, body: { ...body('row:beta-custom'), overrides: { package: S } } }], pair(B));
            expect([label(nonOwner.registry, A), label(nonOwner.registry, B)]).toEqual([`shipped:${A}`, `shipped:${B}`]);
            expect(listed(nonOwner.registry)).not.toContain('row:beta-custom');
        });

        it(`tool (${first} first): a disable does not move a pair row's envelope: the disabled holder's row is in no registry list, and its slot answers it again on enable`, async () => {
            const body = (label: string) => ({ name: N, label, description: label });
            const { registry, protocol } = await boot('tool', order, (id) => body(`shipped:${id}`),
                [{ packageId: `${B}.custom`, body: { ...body('row:beta-custom'), overrides: { package: B } } }], pair(B));
            const listed = () => registry.listItems('tool').map((item) => (item as { label?: string }).label);
            registry.disablePackage(B);
            await protocol.getMetaItems({ type: 'tool' });
            expect(listed()).toEqual([`shipped:${A}`]);
            registry.enablePackage(B);
            await protocol.getMetaItems({ type: 'tool' });
            expect((registry.getPackageScopedItem('tool', N, B) as { label?: string } | undefined)?.label).toBe('row:beta-custom');
            expect((registry.getPackageScopedItem('tool', N, A) as { label?: string } | undefined)?.label).toBe(`shipped:${A}`);
        });

        it(`tool (${first} first): a pair row read while its holder is disabled wears that holder's envelope, so the holder's slot answers it on enable before any other read`, async () => {
            const body = (label: string) => ({ name: N, label, description: label });
            const { registry } = await boot('tool', order, (id) => body(`shipped:${id}`),
                [{ packageId: `${B}.custom`, body: { ...body('row:beta-custom'), overrides: { package: B } } }],
                (registry) => { pair(B)(registry); registry.disablePackage(B); });
            expect(registry.listItems('tool').map((item) => (item as { label?: string }).label)).toEqual([`shipped:${A}`]);
            registry.enablePackage(B);
            expect((registry.getPackageScopedItem('tool', N, B) as { label?: string } | undefined)?.label).toBe('row:beta-custom');
        });

        it(`CONTROL — dashboard (${first} first): a per-package pair row of a row-served type stays out of the registry's bare entry and list, as before`, async () => {
            const body = (label: string) => ({ name: N, label, description: label });
            const { registry } = await boot('dashboard', order, (id) => body(`shipped:${id}`),
                [{ packageId: `${B}.custom`, body: { ...body('row:beta-custom'), overrides: { package: B } } }], pair(B));
            expect(registry.listItems('dashboard').map((item) => (item as { label?: string }).label)).not.toContain('row:beta-custom');
        });

        it(`permission (${first} first): a stray package's row is its own package's set, in its own slot, and each holder keeps its shipped set (ADR-0150 D2, #32780)`, async () => {
            // FROM (main at #32780): the first-registered holder's slot
            // answered the row (the CONTROL this replaces). A permission set
            // is `(package, name)`: the stray package's stored set is its own.
            const body = (label: string) => ({ name: N, label, description: label });
            const { registry } = await boot('permission', order, (id) => body(`shipped:${id}`), [{ packageId: S, body: body('row:stray') }]);
            const label = (id: string) => (registry.getPackageScopedItem('permission', N, id) as { label?: string } | undefined)?.label;
            expect([label(A), label(B), label(S)]).toEqual([`shipped:${A}`, `shipped:${B}`, 'row:stray']);
        });

        it(`CONTROL — email_template (${first} first): a shared pair's undeclared row of a locale no holder ships keeps its bare-slot registration, as before`, async () => {
            // The row-served exemption is load-bearing here: no artifact of
            // the member exists, so the borrowed-envelope rule does not catch
            // the row, and the pair rule would decline it.
            const body = (label: string, locale: string) => ({ name: N, label, subject: label, body: label, locale });
            const { registry } = await boot('email_template', order, (id) => body(`shipped:${id}`, 'en-US'),
                [{ packageId: `${APP}.custom`, body: body('row:app-fr', 'fr-FR') }],
                (registry) => {
                    registry.installPackage({ id: APP, name: APP, version: '1.0.0', type: 'app', namespace: 'app' } as never, 'code');
                    registry.installPackage({ id: `${APP}.custom`, name: `${APP}.custom`, version: '1.0.0', type: 'app', namespace: 'app_custom' } as never, 'code');
                },
                () => ({ type: 'module', dependencies: { [APP]: '^1.0.0' } }));
            expect(registry.listItems('email_template').map((item) => (item as { label?: string }).label)).toContain('row:app-fr');
        });

        it(`CONTROL — dashboard (${first} first): a shared pair's undeclared row leaves each holder's exact read its own item`, async () => {
            const body = (label: string) => ({ name: N, label, description: label });
            const { protocol } = await boot('dashboard', order, (id) => body(`shipped:${id}`), [{ packageId: `${APP}.custom`, body: body('row:app-custom') }],
                (registry) => {
                    registry.installPackage({ id: APP, name: APP, version: '1.0.0', type: 'app', namespace: 'app' } as never, 'code');
                    registry.installPackage({ id: `${APP}.custom`, name: `${APP}.custom`, version: '1.0.0', type: 'app', namespace: 'app_custom' } as never, 'code');
                },
                () => ({ type: 'module', dependencies: { [APP]: '^1.0.0' } }));
            for (const id of [A, B]) {
                const read = await protocol.getMetaItem({ type: 'dashboard', name: N, packageId: id }) as { item?: { label?: string } };
                expect(read.item?.label, id).toBe(`shipped:${id}`);
            }
        });

        it(`CONTROL — dashboard (${first} first): a row-served type keeps its reading: the row is the stray package's own at its address, and no new line is printed`, async () => {
            const body = (label: string) => ({ name: N, label, description: label });
            const { protocol } = await boot('dashboard', order, (id) => body(`shipped:${id}`), [{ packageId: S, body: body('row:stray') }]);
            const read = await protocol.getMetaItem({ type: 'dashboard', name: N, packageId: S }) as { item?: { label?: string } };
            expect(read.item?.label).toBe('row:stray');
        });

        it(`CONTROL — email_template (${first} first): a bundle addition's own row of the locale it ships stays its own beside two holders`, async () => {
            const body = (label: string, locale: string) => ({ name: N, label, subject: label, body: label, locale });
            const { registry } = await boot('email_template', order, (id) => body(`shipped:${id}`, 'en-US'),
                [{ packageId: D, body: body('row:dep-fr', 'fr-FR') }],
                (registry) => {
                    registry.installPackage({ id: D, name: D, version: '1.0.0', type: 'app', namespace: 'dep', dependencies: { [A]: '^1.0.0' } } as never, 'code');
                    registry.registerItem('email_template', body(`shipped:${D}`, 'fr-FR'), 'name' as never, D);
                });
            const label = (id: string, locale: string) => (registry.getPackageScopedItem('email_template', N, id, locale) as { label?: string } | undefined)?.label;
            expect([label(D, 'fr-FR'), label(A, 'en-US'), label(B, 'en-US')]).toEqual(['row:dep-fr', `shipped:${A}`, `shipped:${B}`]);
        });
    }

    it('every type the decline judges is sealed once a package ships the name, so the boot census names a declined row', () => {
        // If one of these types ever opens environment overlays, the decline
        // stops being reported by the census: give it a report of its own first.
        const judged = ['action', 'hook', 'job', 'webhook', 'connector', 'sharing_rule', 'queue', 'assignment_rule',
            'analytics_cube', 'picklist', 'api', 'tool', 'skill', 'agent'];
        // The table the protocol's overlay allow-list is built from (`allowEnvironmentOverlay`).
        const open: string[] = DEFAULT_METADATA_TYPE_REGISTRY.filter((entry) => entry.allowEnvironmentOverlay).map((entry) => entry.type);
        expect(judged.filter((type) => open.includes(type))).toEqual([]);
    });

    it('CONTROL — tool, one holder: a pair row declaring a package the pair does not customize keeps its reading (the one holder\'s)', async () => {
        const body = (label: string) => ({ name: N, label, description: label });
        const { registry } = await boot('tool', [A], (id) => body(`shipped:${id}`),
            [{ packageId: `${A}.custom`, body: { ...body('row:alpha-custom'), overrides: { package: S } } }], pair(A));
        expect((registry.getPackageScopedItem('tool', N, A) as { label?: string } | undefined)?.label).toBe('row:alpha-custom');
    });
});

/**
 * [#33127] Two holders of a name, each with its own stored row. Before this
 * change the registry kept ONE bare slot per name for a stored row, so the row
 * hydrated last took it: the other holder's slot and exact read answered its
 * shipped item, which holder by row order. Each row bound to a
 * holder now lives in that holder's own overlay slot, beside the holder's
 * code artifact, so every order answers the same. The read naming no package
 * still refuses 409 naming both holders (#32607). Every registration order,
 * every row order.
 */
describe('[#33127] two holders, each with its own stored row: each row is its own holder\'s, in every order', () => {
    const N = 'shared_thing';
    const TYPES = ['tool', 'webhook', 'agent', 'skill'] as const;
    const nsOf = (id: string) => id.split('.').pop()!;
    const body = (type: string, label: string) => type === 'webhook'
        ? { name: N, label, object: 'showcase_task', triggers: ['create'], url: `https://hooks.example/${label}` }
        : { name: N, label, description: label };
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { warn.mockRestore(); });

    /** Boot `type` with `order` each shipping the name, then a stored row of each of `rowOwners`, in that order. */
    async function boot(type: string, order: readonly string[], rowOwners: readonly string[]) {
        const registry = new SchemaRegistry();
        registry.logLevel = 'silent';
        for (const id of order) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: nsOf(id) } as never, 'code');
            registry.registerItem(type, body(type, `shipped-${nsOf(id)}`), 'name' as never, id);
        }
        const stored = rowOwners.map((id, i) => ({
            id: `row_${i}`, type, name: N, organization_id: null, package_id: id, state: 'active', metadata: JSON.stringify(body(type, `row-${nsOf(id)}`)),
        }));
        const engine: any = {
            async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
                if (table !== 'sys_metadata') return [];
                const where = opts?.where ?? {};
                const found = stored.filter((r) => Object.entries(where).every(([k, v]) => v === undefined || typeof v === 'object' || (r as any)[k] === v));
                return typeof opts?.limit === 'number' ? found.slice(0, opts.limit) : found;
            },
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                assertEngineFindOnePredicate(object, query);
                return null;
            },
            registry,
        };
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod');
        const load = await protocol.loadMetaFromDb();
        const slot = (id: string) => (registry.getPackageScopedItem(type, N, id) as { label?: string } | undefined)?.label;
        const read = async (packageId?: string) => {
            try {
                return ((await protocol.getMetaItem({ type, name: N, ...(packageId ? { packageId } : {}) } as never)) as { item?: { label?: string } })?.item?.label;
            } catch (e) {
                const err = e as { code?: string; status?: number; refusal?: { candidates?: Array<{ packageId?: string }> } };
                return { code: err.code, status: err.status, candidates: (err.refusal?.candidates ?? []).map((c) => c.packageId).sort() };
            }
        };
        return { load, registry, slot, read };
    }

    for (const type of TYPES) {
        for (const order of [[A, B], [B, A]] as const) {
            for (const rowOwners of [[A, B], [B, A]] as const) {
                it(`${type} (${nsOf(order[0])} registered first, ${nsOf(rowOwners[0])}'s row stored first): each holder's slot and exact read is its own row; the read naming no package refuses 409 naming both`, async () => {
                    // FROM (measured on main): the row hydrated last took the
                    // name's one bare slot, so only its holder answered its
                    // row; the other holder's slot and exact read answered
                    // its shipped item, which holder by row order.
                    const { load, slot, read } = await boot(type, order, rowOwners);
                    expect(load).toMatchObject({ loaded: 2, errors: 0 });
                    expect([slot(A), slot(B)], 'the registry slots').toEqual(['row-alpha', 'row-beta']);
                    expect([await read(A), await read(B)], 'the exact reads').toEqual(['row-alpha', 'row-beta']);
                    expect(await read(), 'the read naming no package').toEqual({ code: 'RESOURCE_CONFLICT', status: 409, candidates: [A, B] });
                });
            }
            it(`CONTROL — ${type} (${nsOf(order[0])} registered first): one holder's row leaves the other holder its shipped item, as before`, async () => {
                const { slot, read } = await boot(type, order, [B]);
                expect([slot(A), slot(B)]).toEqual(['shipped-alpha', 'row-beta']);
                expect([await read(A), await read(B)]).toEqual(['shipped-alpha', 'row-beta']);
            });
        }
        it(`CONTROL — ${type}, one holder: its own row is its slot, its exact read and its read naming no package, as before`, async () => {
            const { slot, read } = await boot(type, [A], [A]);
            expect([slot(A), await read(A), await read()]).toEqual(['row-alpha', 'row-alpha', 'row-alpha']);
        });
    }
});

/**
 * [#32900] A module's locale member at boot: X ships `welcome` in en-US and
 * depends on the App; the App's pair stores X's de-DE override (declaring X),
 * and a package-less de-DE row of the same name is stored too. X's de-DE slot
 * followed the row order (the package-less row took the one bare slot when it
 * hydrated last). It now answers X's own pair row in both orders.
 */
describe('[#32900] a module\'s locale member beside a package-less row of the same locale at boot', () => {
    const APP = 'com.acme.suite';
    const X = 'com.acme.suitex';
    const PAIR = `${APP}.custom`;
    const tpl = (label: string, locale: string, extra: object = {}) => ({ name: 'welcome', label, subject: label, bodyHtml: label, locale, ...extra });
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { warn.mockRestore(); });

    async function boot(rowOrder: ReadonlyArray<'pair' | 'env'>) {
        const registry = new SchemaRegistry();
        registry.logLevel = 'silent';
        registry.installPackage({ id: APP, name: APP, version: '1.0.0', type: 'app', namespace: 'suite' } as never, 'code');
        registry.installPackage({ id: PAIR, name: PAIR, version: '1.0.0', type: 'app', namespace: 'suite_custom' } as never, 'code');
        registry.installPackage({ id: X, name: X, version: '1.0.0', type: 'module', namespace: 'suitex', dependencies: { [APP]: '^1.0.0' } } as never, 'code');
        registry.registerItem('email_template', tpl('suitex', 'en-US'), 'name' as never, X);
        const rows: Record<string, unknown>[] = rowOrder.map((k, i) => k === 'pair'
            ? { id: `r${i}`, type: 'email_template', name: 'welcome', bundle_member: 'de-DE', organization_id: null, package_id: PAIR, state: 'active', metadata: JSON.stringify(tpl('pair', 'de-DE', { overrides: { package: X } })) }
            : { id: `r${i}`, type: 'email_template', name: 'welcome', bundle_member: 'de-DE', organization_id: null, package_id: null, state: 'active', metadata: JSON.stringify(tpl('env', 'de-DE')) });
        const engine: any = {
            async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
                if (table !== 'sys_metadata') return [];
                const found = rows.filter((r) => Object.entries(opts?.where ?? {}).every(([k, v]) => v === undefined || typeof v === 'object' || (r[k] ?? null) === v));
                return typeof opts?.limit === 'number' ? found.slice(0, opts.limit) : found;
            },
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                assertEngineFindOnePredicate(object, query);
                return null;
            },
            registry,
        };
        await new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod').loadMetaFromDb();
        return (registry.getPackageScopedItem('email_template', 'welcome', X, 'de-DE') as { label?: string } | undefined)?.label ?? null;
    }

    for (const rowOrder of [['pair', 'env'], ['env', 'pair']] as const) {
        it(`${rowOrder[0]} row stored first: X's de-DE slot is its own pair row`, async () => {
            // FROM: the row hydrated last ('env' in the first order) answered X's slot.
            expect(await boot(rowOrder)).toBe('pair');
        });
    }
    it('CONTROL — the pair row alone and the package-less row alone keep their readings', async () => {
        expect([await boot(['pair']), await boot(['env'])]).toEqual(['pair', 'env']);
    });
});
