// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppPlugin } from './app-plugin';
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
 * ⛔ Not housed in `seed-loader.test.ts` — the natural home, held by PR #16783.
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
        id: 'locale-producer-app',
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
                manifest: { id: 'locale-producer-app', i18n: { defaultLocale: 'zh-CN' } },
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
