// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppPlugin } from './app-plugin';
import { appDefaultSeedLocale } from './seed-locale';
import type { PluginContext } from '@objectstack/core';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/**
 * `Seed.locale`'s PRODUCER (#16595) — the half `#16510` / PR #16592 deliberately
 * left out of its own file surface.
 *
 * The consumer landed complete: `SeedLoaderService` reads `Seed.locale`, filters
 * on `SeedLoaderConfig.locale`, composes the axis with `env` by conjunction, and
 * `seed-loader-locale-scope.test.ts` pins every one of those outcomes. None of
 * that made authoring `locale` do anything, because the second input the effect
 * depends on — `config.locale` — had no supplier: every first-party call site
 * built its request without one, so `filterByLocale` returned its input on its
 * first line and `dataset.locale` was never read at all.
 *
 * ⭐ That is the EXACT shape `Seed.env` spent releases in (framework#4704,
 * ledgered as `packages/spec/liveness/seed.json`'s specimen for the `producer`
 * field, #4837), and it is why the assertions below are written against ROWS
 * REACHING THE ENGINE rather than against the request object. A test that
 * asserted "the config carries a locale" would be green on a build where the
 * loader ignored it, which is the failure this whole family exists to catch:
 * a green suite is not evidence an axis bites.
 *
 * The three call sites this pins are the three request builders in
 * `app-plugin.ts` — inline boot seed, per-org replayer, dev hot-reload seeder.
 * They are NOT all six that build a `SeedLoaderRequest` in this repo; the other
 * three (package apply, draft publish, marketplace install) are publish/install
 * -time paths in other declared file surfaces, and the ledger row records that
 * split rather than claiming it away.
 *
 * ⛔ Not housed in `seed-loader.test.ts` — the natural home, then held by the change that landed as commit 854639b31.
 */

/**
 * A read/insert-only engine double. It deliberately declares NEITHER `delete`
 * NOR `update`: the seeds below are `upsert` into an empty store, so both
 * dispatch verbs are unreachable, and `check:engine-double-contract`'s two
 * slices are keyed on exactly those members. `findOne` still routes through the
 * real producer-side predicate, as every double in this repo does.
 */
function createEngine() {
    const store: Record<string, any[]> = {};
    let idCounter = 0;

    const engine = {
        find: vi.fn(async (objectName: string, query?: any) => {
            let records = store[objectName] || [];
            if (query?.where) {
                records = records.filter((r) =>
                    Object.entries(query.where).every(([k, v]) => {
                        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
                        return r[k] === v;
                    }),
                );
            }
            if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
            return records;
        }),
        findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
            assertEngineFindOnePredicate(object, query);
            return null;
        }),
        insert: vi.fn(async (objectName: string, data: any) => {
            if (!store[objectName]) store[objectName] = [];
            if (Array.isArray(data)) {
                const records = data.map((d) => ({ id: `gen-${++idCounter}`, ...d }));
                store[objectName].push(...records);
                return records;
            }
            const record = { id: `gen-${++idCounter}`, ...data };
            store[objectName].push(record);
            return record;
        }),
        count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
        aggregate: vi.fn(async () => []),
    } as unknown as IDataEngine;

    return { engine, store };
}

function createMetadata(): IMetadataService {
    const objects: Record<string, any> = {
        account: { name: 'account', fields: { name: { type: 'text' } } },
        plan_zh: { name: 'plan_zh', fields: { name: { type: 'text' } } },
        plan_en: { name: 'plan_en', fields: { name: { type: 'text' } } },
    };
    return {
        getObject: vi.fn(async (name: string) => objects[name]),
        listObjects: vi.fn(async () => Object.values(objects)),
        register: vi.fn(async () => {}),
        get: vi.fn(async () => undefined),
        list: vi.fn(async () => []),
        unregister: vi.fn(async () => {}),
        exists: vi.fn(async () => false),
        listNames: vi.fn(async () => []),
    } as unknown as IMetadataService;
}

/** Unscoped on both axes — loads under every locale. */
const ACCOUNT_DATASET = {
    object: 'account',
    externalId: 'name',
    mode: 'upsert',
    records: [{ name: 'Acme Corporation' }],
};

/** The Chinese market's copy of the demo plans. */
const PLAN_ZH_DATASET = {
    object: 'plan_zh',
    externalId: 'name',
    mode: 'upsert',
    locale: ['zh-CN'],
    records: [{ name: '专业版' }],
};

/** The English market's copy of the same demo plans. */
const PLAN_EN_DATASET = {
    object: 'plan_en',
    externalId: 'name',
    mode: 'upsert',
    locale: ['en'],
    records: [{ name: 'Professional' }],
};

const ALL_DATASETS = [ACCOUNT_DATASET, PLAN_ZH_DATASET, PLAN_EN_DATASET];

describe('AppPlugin supplies SeedLoaderConfig.locale (#16595)', () => {
    const OLD_BUDGET = process.env.OS_INLINE_SEED_BUDGET_MS;
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;
    const OLD_NODE_ENV = process.env.NODE_ENV;

    let engine: IDataEngine;
    let store: Record<string, any[]>;
    let metadata: IMetadataService;
    let logger: { info: any; warn: any; error: any; debug: any };
    let services: Map<string, unknown>;
    let hooks: Map<string, Array<(payload: any) => any>>;

    const makeContext = (): PluginContext => ({
        logger,
        registerService: vi.fn((name: string, svc: unknown) => { services.set(name, svc); }),
        getService: vi.fn((name: string) => {
            if (name === 'objectql') return engine;
            if (name === 'metadata') return metadata;
            return services.get(name);
        }),
        getServices: vi.fn(() => services),
        hook: vi.fn((event: string, fn: (payload: any) => any) => {
            const list = hooks.get(event) ?? [];
            list.push(fn);
            hooks.set(event, list);
        }),
        trigger: vi.fn(),
    }) as unknown as PluginContext;

    /** `objects`, in engine-insert order, that actually received rows. */
    const seededObjects = () => Object.keys(store).sort();

    const bundle = (i18n?: unknown, datasets = ALL_DATASETS) => ({
        id: 'com.example.locale-producer-app',
        ...(i18n ? { i18n } : {}),
        data: datasets,
    });

    beforeEach(() => {
        process.env.OS_INLINE_SEED_BUDGET_MS = '60000';
        delete process.env.OS_MULTI_ORG_ENABLED;
        ({ engine, store } = createEngine());
        metadata = createMetadata();
        logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        services = new Map();
        hooks = new Map();
    });

    afterEach(() => {
        if (OLD_BUDGET === undefined) delete process.env.OS_INLINE_SEED_BUDGET_MS;
        else process.env.OS_INLINE_SEED_BUDGET_MS = OLD_BUDGET;
        if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
        if (OLD_NODE_ENV === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = OLD_NODE_ENV;
    });

    // ── Call site 1: the inline boot seed ───────────────────────────────────
    describe('inline boot seed', () => {
        /**
         * ⭐ THE NEGATIVE LEG. `plan_zh` is a dataset that loads TODAY on this
         * boot path — before the wiring, `config.locale` was undefined, the
         * filter returned its input, and its row landed on an `en` stack. It
         * must not any more.
         */
        it('drops a locale-scoped dataset the declared `i18n.defaultLocale` excludes', async () => {
            const plugin = new AppPlugin(bundle({ defaultLocale: 'en' }));

            await plugin.start(makeContext());

            expect(seededObjects()).toEqual(['account', 'plan_en']);
            expect(store.plan_zh).toBeUndefined();
        });

        it('keeps the dataset the declared locale selects, and drops the other market', async () => {
            const plugin = new AppPlugin(bundle({ defaultLocale: 'zh-CN' }));

            await plugin.start(makeContext());

            expect(seededObjects()).toEqual(['account', 'plan_zh']);
            expect(store.plan_en).toBeUndefined();
            expect(store.plan_zh).toEqual([expect.objectContaining({ name: '专业版' })]);
        });

        /**
         * The absence case, and the reason `warnOnUnresolvedLocaleScope` STAYS.
         * An app that declares no `i18n` block sends no `locale` key at all, so
         * the axis is inert and every dataset loads — the pre-#16510 behaviour,
         * unchanged. Wiring a producer must not silently start dropping rows on
         * stacks that never opted in, and the loader still says so out loud.
         */
        it('sends no locale — and the loader warns — when the app declares none', async () => {
            const plugin = new AppPlugin(bundle(undefined));

            await plugin.start(makeContext());

            expect(seededObjects()).toEqual(['account', 'plan_en', 'plan_zh']);
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('No locale was supplied'),
                expect.anything(),
            );
        });

        /** An empty / non-string `defaultLocale` is an absence, not a filter. */
        it('treats a blank `defaultLocale` as no locale rather than as a filter', async () => {
            const plugin = new AppPlugin(bundle({ defaultLocale: '' }));

            await plugin.start(makeContext());

            expect(seededObjects()).toEqual(['account', 'plan_en', 'plan_zh']);
        });

        /** The legacy nested-manifest bundle shape resolves the same key. */
        it('reads `i18n.defaultLocale` off a nested `manifest` bundle too', async () => {
            const plugin = new AppPlugin({
                manifest: { id: 'com.example.locale-producer-app', i18n: { defaultLocale: 'zh-CN' } },
                data: ALL_DATASETS,
            });

            await plugin.start(makeContext());

            expect(seededObjects()).toEqual(['account', 'plan_zh']);
        });
    });

    // ── Call site 2: the per-org replayer ───────────────────────────────────
    describe('per-org replayer (multi-tenant provisioning)', () => {
        it('filters the replayed datasets by the declared locale', async () => {
            process.env.OS_MULTI_ORG_ENABLED = 'true';
            const plugin = new AppPlugin(bundle({ defaultLocale: 'en' }));

            await plugin.start(makeContext());
            // Multi-tenant boot writes nothing inline — the replayer is the path.
            expect(seededObjects()).toEqual([]);

            const replayer = services.get('seed-replayer') as (orgId: string) => Promise<any>;
            expect(typeof replayer).toBe('function');
            await replayer('org_1');

            expect(seededObjects()).toEqual(['account', 'plan_en']);
            expect(store.plan_zh).toBeUndefined();
        });
    });

    // ── Call site 3: the dev hot-reload seeder ──────────────────────────────
    describe('dev hot-reload seeder', () => {
        it('filters the newly-registered objects’ seeds by the declared locale', async () => {
            process.env.NODE_ENV = 'development';
            // Boot with NO datasets so every object below is "first seen".
            const plugin = new AppPlugin(bundle({ defaultLocale: 'en' }, []));

            await plugin.start(makeContext());

            const reloaded = hooks.get('metadata:reloaded') ?? [];
            expect(reloaded).toHaveLength(1);

            await reloaded[0]!({
                metadata: {
                    objects: [{ name: 'account' }, { name: 'plan_zh' }, { name: 'plan_en' }],
                    data: ALL_DATASETS,
                },
            });

            expect(seededObjects()).toEqual(['account', 'plan_en']);
            expect(store.plan_zh).toBeUndefined();
        });
    });
});

/**
 * [#30281] The per-org replay resolves its locale PER ORGANIZATION, at replay
 * time (maintainer ruling A, 2026-11-05: the install paths pick datasets by
 * locale). Before, the replayer captured the boot bundle's `i18n.defaultLocale`
 * once, so every organization founded in one process got the boot's market.
 *
 * The rungs, first answer wins (`resolveSeedLocaleForLoad`): the organization's
 * Localization setting (only a value somebody SET — the manifest's `en-US`
 * default is `source: 'default'` and does not count), then the founder's
 * `sys_user.locale`, then the app's declared default. Rows reaching the engine
 * are the assertion, as in the suite above.
 */
describe('per-org replay resolves the locale per organization (#30281)', () => {
    const OLD_MULTI = process.env.OS_MULTI_ORG_ENABLED;
    let engine: IDataEngine;
    let store: Record<string, any[]>;
    let services: Map<string, unknown>;
    let logger: { info: any; warn: any; error: any; debug: any };

    /** The organization's own setting, as the settings service resolves it. */
    let settingFor: Record<string, { value: string; source: string }>;
    let settingsGet: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        process.env.OS_MULTI_ORG_ENABLED = 'true';
        ({ engine, store } = createEngine());
        services = new Map();
        logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        settingFor = {};
        settingsGet = vi.fn(async (_ns: string, _key: string, ctx?: { tenantId?: string }) =>
            settingFor[ctx?.tenantId ?? ''] ?? { value: 'en-US', source: 'default' });
        services.set('settings', { get: settingsGet });
    });
    afterEach(() => {
        if (OLD_MULTI === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
        else process.env.OS_MULTI_ORG_ENABLED = OLD_MULTI;
    });

    const ctx = (): PluginContext => ({
        logger,
        registerService: vi.fn((name: string, svc: unknown) => { services.set(name, svc); }),
        getService: vi.fn((name: string) => {
            if (name === 'objectql') return engine;
            if (name === 'metadata') return createMetadata();
            return services.get(name);
        }),
        getServices: vi.fn(() => services),
        hook: vi.fn(),
        trigger: vi.fn(),
    }) as unknown as PluginContext;

    /** Boot a multi-tenant app and hand back its registered replayer. */
    async function bootReplayer(defaultLocale: string | undefined, datasets = ALL_DATASETS) {
        const plugin = new AppPlugin({
            id: 'com.example.per-org-locale-app',
            ...(defaultLocale ? { i18n: { defaultLocale } } : {}),
            data: datasets,
        });
        await plugin.start(ctx());
        const replayer = services.get('seed-replayer') as (orgId: string, options?: { userId?: string }) => Promise<any>;
        expect(typeof replayer).toBe('function');
        return replayer;
    }

    /** The plan objects an organization received rows in. */
    const plansOf = (orgId: string) =>
        ['plan_en', 'plan_zh'].filter((o) => (store[o] ?? []).some((r) => r.organization_id === orgId));

    it('two organizations with different Localization settings get different datasets in one process', async () => {
        settingFor.org_zh = { value: 'zh-CN', source: 'tenant' };
        settingFor.org_en = { value: 'en', source: 'tenant' };
        const replayer = await bootReplayer('en');

        await replayer('org_zh');
        await replayer('org_en');

        expect(plansOf('org_zh')).toEqual(['plan_zh']);
        expect(plansOf('org_en')).toEqual(['plan_en']);
        // Each read named its own organization.
        expect(settingsGet).toHaveBeenCalledWith('localization', 'locale', { tenantId: 'org_zh' });
        expect(settingsGet).toHaveBeenCalledWith('localization', 'locale', { tenantId: 'org_en' });
    });

    it('a deployment-wide `global` value counts as set', async () => {
        settingFor.org_new = { value: 'zh-CN', source: 'global' };
        const replayer = await bootReplayer('en');

        await replayer('org_new');

        expect(plansOf('org_new')).toEqual(['plan_zh']);
    });

    it('at founding (no setting yet) the founder\'s language decides — option (a)', async () => {
        store.sys_user = [{ id: 'usr_founder', locale: 'zh-CN' }];
        const replayer = await bootReplayer('en');

        await replayer('org_new', { userId: 'usr_founder' });

        expect(plansOf('org_new')).toEqual(['plan_zh']);
    });

    it('the manifest\'s `en-US` default is not a choice: it never outranks the founder', async () => {
        // `settingFor` is empty, so the service answers its built-in default.
        store.sys_user = [{ id: 'usr_founder', locale: 'zh-CN' }];
        const replayer = await bootReplayer('en');

        await replayer('org_new', { userId: 'usr_founder' });

        expect(plansOf('org_new')).toEqual(['plan_zh']);
        expect(store.plan_en).toBeUndefined();
    });

    it('the organization\'s setting outranks the founder\'s language', async () => {
        settingFor.org_new = { value: 'en', source: 'tenant' };
        store.sys_user = [{ id: 'usr_founder', locale: 'zh-CN' }];
        const replayer = await bootReplayer('zh-CN');

        await replayer('org_new', { userId: 'usr_founder' });

        expect(plansOf('org_new')).toEqual(['plan_en']);
    });

    it('no founder and no setting ⇒ the app\'s declared default — option (c)', async () => {
        const replayer = await bootReplayer('zh-CN');

        await replayer('org_sys');

        expect(plansOf('org_sys')).toEqual(['plan_zh']);
    });

    it('a founder with no stored language falls through to the app\'s default', async () => {
        store.sys_user = [{ id: 'usr_blank', locale: '' }];
        const replayer = await bootReplayer('zh-CN');

        await replayer('org_new', { userId: 'usr_blank' });

        expect(plansOf('org_new')).toEqual(['plan_zh']);
    });

    it('a host with no settings service still honours the founder', async () => {
        services.delete('settings');
        store.sys_user = [{ id: 'usr_founder', locale: 'zh-CN' }];
        const replayer = await bootReplayer('en');

        await replayer('org_new', { userId: 'usr_founder' });

        expect(plansOf('org_new')).toEqual(['plan_zh']);
    });

    it('nothing answers ⇒ no locale: every dataset loads and the loader says so', async () => {
        const replayer = await bootReplayer(undefined);

        await replayer('org_new');

        expect(plansOf('org_new')).toEqual(['plan_en', 'plan_zh']);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No locale was supplied'), expect.anything());
    });

    it('a dataset without `locale` loads whatever the organization speaks (item 4)', async () => {
        settingFor.org_zh = { value: 'zh-CN', source: 'tenant' };
        settingFor.org_en = { value: 'en', source: 'tenant' };
        const replayer = await bootReplayer('en');

        await replayer('org_zh');
        await replayer('org_en');

        expect((store.account ?? []).map((r) => r.organization_id).sort()).toEqual(['org_en', 'org_zh']);
    });

    it('reads nothing when no dataset declares a locale', async () => {
        store.sys_user = [{ id: 'usr_founder', locale: 'zh-CN' }];
        const replayer = await bootReplayer('en', [ACCOUNT_DATASET]);

        await replayer('org_new', { userId: 'usr_founder' });

        expect(settingsGet).not.toHaveBeenCalled();
        expect((engine.find as any).mock.calls.some((c: any[]) => c[0] === 'sys_user')).toBe(false);
        expect((store.account ?? []).map((r) => r.organization_id)).toEqual(['org_new']);
    });

    it('a settings read that fails writes nothing — no other language is seeded over a choice that could not be read', async () => {
        settingsGet.mockRejectedValueOnce(new Error('settings backend down'));
        store.sys_user = [{ id: 'usr_founder', locale: 'en' }];
        const replayer = await bootReplayer('en');

        await expect(replayer('org_new', { userId: 'usr_founder' })).rejects.toThrow('settings backend down');

        expect(plansOf('org_new')).toEqual([]);
        expect(store.account).toBeUndefined();
    });
});

/** [#30281] Reading the app's declared default off a package body. */
describe('appDefaultSeedLocale (#30281)', () => {
    it('reads `i18n.defaultLocale` at the top level, then off a nested `manifest`', () => {
        expect(appDefaultSeedLocale({ i18n: { defaultLocale: 'zh-CN' } })).toBe('zh-CN');
        expect(appDefaultSeedLocale({ manifest: { i18n: { defaultLocale: 'ja-JP' } } })).toBe('ja-JP');
    });

    it('a legacy `i18n` array of translation bundles declares no default', () => {
        expect(appDefaultSeedLocale({ i18n: [{ 'zh-CN': {} }] })).toBeUndefined();
    });

    it('a blank or missing default is no default', () => {
        expect(appDefaultSeedLocale({ i18n: { defaultLocale: '  ' } })).toBeUndefined();
        expect(appDefaultSeedLocale({})).toBeUndefined();
        expect(appDefaultSeedLocale(undefined)).toBeUndefined();
    });
});
