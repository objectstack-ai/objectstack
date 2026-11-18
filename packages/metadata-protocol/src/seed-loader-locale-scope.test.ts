// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/**
 * `Seed.locale` is a dataset filter axis, composed with `Seed.env` (#16510).
 *
 * An app shipping demo data for two language markets used to have to pick
 * between the two seed profiles while its config was ASSEMBLED — which bakes
 * the choice into `dist` (switching profiles means deleting the build output)
 * and leaves the other profile's rows resident in the database, because every
 * profile is an upsert and the loader only writes.
 *
 * The axis moves that decision to load time. Deliberately NOT in scope: the
 * platform translates nothing and merges nothing — the app authors both record
 * sets and this only selects between them.
 *
 * Mirrors `seed-loader-env-scope.test.ts`, the `env`-axis precedent, and pins
 * the outcomes SEPARATELY for the same reason it does: a filter that dropped
 * everything, or nothing, would satisfy any one of them alone.
 *   1. locale-scoped dataset + matching locale       → seeded
 *   2. locale-scoped dataset + non-matching locale   → NOT seeded
 *   3. no `locale` declared                          → seeded under every locale
 *   4. no `config.locale`                            → axis inert, but LOUD
 *   5. the two axes COMPOSE by conjunction — neither rescues what the other cut
 */

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createEngine() {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) {
        records = records.filter((r) =>
          Object.entries(query.where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }),
        );
      }
      if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
      return records;
    }),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
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
    update: vi.fn(async (_o: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
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
    demo_user: { name: 'demo_user', fields: { name: { type: 'text' } } },
    price_book: { name: 'price_book', fields: { name: { type: 'text' } } },
    tax_rate: { name: 'tax_rate', fields: { name: { type: 'text' } } },
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

const BASE_CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'upsert',
  batchSize: 1000,
  transaction: false,
} as any;

/** Unscoped on BOTH axes — the schema defaults. */
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

/** The English market's copy of the same thing. */
const PLAN_EN_DATASET = {
  object: 'plan_en',
  externalId: 'name',
  mode: 'upsert',
  locale: ['en', 'en-GB'],
  records: [{ name: 'Professional' }],
};

async function seedUnder(locale: string | undefined, seeds: any[], configOverrides: any = {}) {
  const { engine, store } = createEngine();
  const logger = createLogger();
  const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
    seeds,
    config: { ...BASE_CONFIG, ...(locale === undefined ? {} : { locale }), ...configOverrides },
  } as any);

  return { result, store, logger };
}

const seededObjects = (store: Record<string, any[]>) => Object.keys(store).sort();

const localeWarning = (logger: any) =>
  logger.warn.mock.calls.map((c: any[]) => String(c[0])).find((m: string) => m.includes('No locale was supplied'));

describe('Seed.locale scopes a dataset to a language market (#16510)', () => {
  // The env axis reads NODE_ENV, so pin it to a determinate value: these cases
  // are about the LOCALE axis, and an indeterminate environment would put a
  // second warning in the log that the assertions here should not have to
  // step around.
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  // ── 1. The capability itself ────────────────────────────────────────────

  it('seeds only the dataset scoped to the loading locale', async () => {
    const { result, store } = await seedUnder('zh-CN', [ACCOUNT_DATASET, PLAN_ZH_DATASET, PLAN_EN_DATASET]);

    expect(seededObjects(store)).toEqual(['account', 'plan_zh']);
    expect(store.plan_en).toBeUndefined();
    expect(result.summary.objectsProcessed).toBe(2);
  });

  it('seeds the OTHER dataset under the other locale', async () => {
    const { store } = await seedUnder('en', [ACCOUNT_DATASET, PLAN_ZH_DATASET, PLAN_EN_DATASET]);

    expect(seededObjects(store)).toEqual(['account', 'plan_en']);
    expect(store.plan_zh).toBeUndefined();
  });

  // The two above must DIFFER — a filter that dropped every scoped dataset, or
  // none of them, would satisfy one of them alone.
  it('produces a different result per locale', async () => {
    const zh = await seedUnder('zh-CN', [PLAN_ZH_DATASET, PLAN_EN_DATASET]);
    const en = await seedUnder('en', [PLAN_ZH_DATASET, PLAN_EN_DATASET]);

    expect(seededObjects(zh.store)).toEqual(['plan_zh']);
    expect(seededObjects(en.store)).toEqual(['plan_en']);
    expect(seededObjects(zh.store)).not.toEqual(seededObjects(en.store));
  });

  it('honours a multi-locale scope that includes the loading locale', async () => {
    const underGb = await seedUnder('en-GB', [PLAN_EN_DATASET]);
    const underZh = await seedUnder('zh-CN', [PLAN_EN_DATASET]);

    expect(underGb.store.plan_en).toHaveLength(1);
    expect(underZh.store.plan_en).toBeUndefined();
  });

  // ── 2. Unscoped datasets are untouched (no behaviour change) ────────────

  it('treats a dataset with no locale key as applying to every locale', async () => {
    for (const locale of ['zh-CN', 'en', 'ja-JP']) {
      const { store } = await seedUnder(locale, [ACCOUNT_DATASET]);
      expect(store.account, `account should seed under locale=${locale}`).toHaveLength(1);
    }
  });

  // ── 3. Tag matching: case-insensitive, and otherwise exact ──────────────

  it('matches BCP-47 tags case-insensitively', async () => {
    // RFC 5646 casing is a convention, not part of the tag's identity.
    const { store } = await seedUnder('zh-cn', [PLAN_ZH_DATASET]);
    expect(store.plan_zh).toHaveLength(1);
  });

  it('does NOT treat a primary language as matching a region-qualified tag', async () => {
    // `zh` is a different tag from `zh-CN`. Declaring both is the author's job;
    // widening the match here would be exactly the lenient consumer-side
    // fallback the contract-first rule forbids.
    const { store } = await seedUnder('zh', [PLAN_ZH_DATASET]);
    expect(store.plan_zh).toBeUndefined();
  });

  // ── 4. No locale supplied: inert, but loud ─────────────────────────────

  it('seeds every dataset BUT warns when no config.locale was supplied', async () => {
    const { store, logger } = await seedUnder(undefined, [ACCOUNT_DATASET, PLAN_ZH_DATASET, PLAN_EN_DATASET]);

    // Inert: the pre-existing behaviour for a host that knows nothing about
    // locales; fail-closed here would silently drop rows on every such host.
    expect(seededObjects(store)).toEqual(['account', 'plan_en', 'plan_zh']);

    // Loud: names the datasets AND the remedy. `Seed.env` spent releases being
    // authorable and inert with no diagnostic at all (framework#4704).
    const warning = localeWarning(logger);
    expect(warning).toBeDefined();
    expect(warning).toContain('plan_zh');
    expect(warning).toContain('plan_en');
    expect(warning).toContain('config.locale');
    // The unscoped dataset is not the operator's problem — don't name it.
    expect(warning).not.toContain('account (locale:');
  });

  it('stays SILENT when no locale was supplied and nothing is locale-scoped', async () => {
    const { store, logger } = await seedUnder(undefined, [ACCOUNT_DATASET]);

    expect(store.account).toHaveLength(1);
    expect(localeWarning(logger)).toBeUndefined();
  });

  it('does not warn once a locale IS supplied', async () => {
    const { logger } = await seedUnder('zh-CN', [PLAN_ZH_DATASET, PLAN_EN_DATASET]);
    expect(localeWarning(logger)).toBeUndefined();
  });

  // ── 5. Skipping is reported, never mysterious ──────────────────────────

  it('names every locale-skipped dataset so missing rows are one log line to explain', async () => {
    const { logger } = await seedUnder('zh-CN', [PLAN_ZH_DATASET, PLAN_EN_DATASET]);

    const info = logger.info.mock.calls.map((c: any[]) => String(c[0])).find((m: string) => m.includes("Locale 'zh-CN'"));
    expect(info).toBeDefined();
    expect(info).toContain('plan_en');
    expect(info).toContain('skipped');
  });

  // ── 6. The two axes compose by CONJUNCTION ─────────────────────────────

  describe('composition with the env axis', () => {
    /** Scoped on both axes: dev-only, Chinese-only. */
    const DEV_ZH = {
      object: 'demo_user',
      externalId: 'name',
      mode: 'upsert',
      env: ['dev'],
      locale: ['zh-CN'],
      records: [{ name: '演示用户' }],
    };

    it('seeds a doubly-scoped dataset when it passes BOTH axes', async () => {
      process.env.NODE_ENV = 'development';
      const { store } = await seedUnder('zh-CN', [DEV_ZH]);
      expect(store.demo_user).toHaveLength(1);
    });

    it('drops it when it passes env but FAILS locale', async () => {
      process.env.NODE_ENV = 'development';
      const { store } = await seedUnder('en', [DEV_ZH]);
      expect(store.demo_user).toBeUndefined();
    });

    it('drops it when it passes locale but FAILS env', async () => {
      process.env.NODE_ENV = 'production';
      const { store } = await seedUnder('zh-CN', [DEV_ZH]);
      expect(store.demo_user).toBeUndefined();
    });

    it('drops it when it fails both', async () => {
      process.env.NODE_ENV = 'production';
      const { store } = await seedUnder('en', [DEV_ZH]);
      expect(store.demo_user).toBeUndefined();
    });

    // All four outcomes above must be reachable from ONE dataset definition —
    // otherwise a filter that ignored one axis entirely would still pass three
    // of the four.
    it('distinguishes all four (env × locale) outcomes', async () => {
      const seededIn = async (nodeEnv: string, locale: string) => {
        process.env.NODE_ENV = nodeEnv;
        const { store } = await seedUnder(locale, [DEV_ZH]);
        return store.demo_user !== undefined;
      };

      expect([
        await seededIn('development', 'zh-CN'),
        await seededIn('development', 'en'),
        await seededIn('production', 'zh-CN'),
        await seededIn('production', 'en'),
      ]).toEqual([true, false, false, false]);
    });
  });
});

/**
 * `Seed.fallback` — the set an organization receives when its locale matches
 * no locale-scoped set of the object. An app that splits its standard price
 * book into a `zh-CN` set and an `en` set used to leave a `ja-JP` organization
 * with neither; marking the `en` set `fallback: true` gives it that set.
 *
 * Every case reads which RECORDS reached the engine, and each positive case
 * has a control beside it (the same sets unmarked, or a locale some set does
 * name), so a filter that loaded the fallback always, or never, fails here.
 */
describe('Seed.fallback fills in for a locale no set of the object names', () => {
  let savedNodeEnv: string | undefined;
  beforeEach(() => {
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  const PRICE_BOOK_ZH = {
    object: 'price_book',
    externalId: 'name',
    mode: 'upsert',
    locale: ['zh-CN'],
    records: [{ name: '标准价格表' }],
  };
  const PRICE_BOOK_EN = {
    object: 'price_book',
    externalId: 'name',
    mode: 'upsert',
    locale: ['en', 'en-US'],
    records: [{ name: 'Standard' }],
  };
  const PRICE_BOOK_EN_FALLBACK = { ...PRICE_BOOK_EN, fallback: true };
  /** Locale-neutral rows of the same object. */
  const PRICE_BOOK_SHARED = {
    object: 'price_book',
    externalId: 'name',
    mode: 'upsert',
    records: [{ name: 'Internal' }],
  };

  const names = (store: Record<string, any[]>, object = 'price_book') =>
    (store[object] ?? []).map((r) => r.name).sort();

  it('loads the fallback set for a locale no set names (ja-JP gets the en price book)', async () => {
    const { store, result } = await seedUnder('ja-JP', [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK]);
    expect(names(store)).toEqual(['Standard']);
    expect(result.success).toBe(true);
  });

  it('control: unmarked, the same sets give a ja-JP load no price book — behaviour without the key is unchanged', async () => {
    const { store, result } = await seedUnder('ja-JP', [PRICE_BOOK_ZH, PRICE_BOOK_EN]);
    expect(names(store)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('does not load the fallback set when another set names the locale', async () => {
    const { store } = await seedUnder('zh-CN', [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK]);
    expect(names(store)).toEqual(['标准价格表']);
  });

  it('matches case-insensitively when deciding a set names the locale', async () => {
    const { store } = await seedUnder('zh-cn', [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK]);
    expect(names(store)).toEqual(['标准价格表']);
  });

  it('loads the fallback set for its own locales like any other set', async () => {
    const { store } = await seedUnder('en-US', [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK]);
    expect(names(store)).toEqual(['Standard']);
  });

  it('a set with no locale is locale-neutral: it loads beside the fallback and does not block it', async () => {
    const { store } = await seedUnder('ja-JP', [PRICE_BOOK_SHARED, PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK]);
    expect(names(store)).toEqual(['Internal', 'Standard']);
  });

  it('is judged per object: a match on another object does not block it', async () => {
    const TAX_JA = { object: 'tax_rate', externalId: 'name', mode: 'upsert', locale: ['ja-JP'], records: [{ name: '消費税' }] };
    const { store } = await seedUnder('ja-JP', [TAX_JA, PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK]);
    expect(names(store)).toEqual(['Standard']);
    expect(names(store, 'tax_rate')).toEqual(['消費税']);
  });

  it('names the fallback it loaded, at info', async () => {
    const { logger } = await seedUnder('ja-JP', [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK]);
    const info = logger.info.mock.calls.map((c: any[]) => String(c[0])).find((m: string) => m.includes('fallback set(s) loaded'));
    expect(info).toContain("Locale 'ja-JP'");
    expect(info).toContain('price_book (locale: en, en-US; fallback)');
  });

  it('a load with no locale loads every set, the fallback included, and warns', async () => {
    const { store, logger } = await seedUnder(undefined, [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK]);
    expect(names(store)).toEqual(['Standard', '标准价格表']);
    expect(localeWarning(logger)).toContain('price_book (locale: en, en-US; fallback)');
  });

  describe('composition with env', () => {
    it('a matching set that env scoped out is no match: the fallback loads', async () => {
      const zhDevOnly = { ...PRICE_BOOK_ZH, env: ['dev'] };
      const { store } = await seedUnder('zh-CN', [zhDevOnly, PRICE_BOOK_EN_FALLBACK]);
      expect(names(store)).toEqual(['Standard']);
    });

    it('a fallback set env scoped out does not fill in', async () => {
      const fallbackDevOnly = { ...PRICE_BOOK_EN_FALLBACK, env: ['dev'] };
      const { store } = await seedUnder('ja-JP', [PRICE_BOOK_ZH, fallbackDevOnly]);
      expect(names(store)).toEqual([]);
    });
  });

  describe('at most one fallback set per object in a load', () => {
    const PRICE_BOOK_ZH_FALLBACK = { ...PRICE_BOOK_ZH, fallback: true };

    it('refuses only that object\'s fallback choice when two distinct sets of it are marked; the rest still seed', async () => {
      const PRICE_BOOK_SHARED_ROWS = { ...PRICE_BOOK_SHARED };
      const { store, result, logger } = await seedUnder('ja-JP', [ACCOUNT_DATASET, PRICE_BOOK_SHARED_ROWS, PRICE_BOOK_ZH_FALLBACK, PRICE_BOOK_EN_FALLBACK]);
      // Neither marked price-book set fills in for ja-JP; the object's unmarked set and every other object load.
      expect(names(store)).toEqual(['Internal']);
      expect(store.account).toEqual([expect.objectContaining({ name: 'Acme Corporation' })]);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ sourceObject: 'price_book', field: 'fallback', targetField: '(dataset)' });
      expect(result.errors[0]!.message.split('. ')[0]).toBe(
        "Seed datasets of 'price_book' mark 2 different sets `fallback: true` (locale: zh-CN; locale: en, en-US)",
      );
      // Named once at warn, whatever level the caller reports a failed load at.
      const warned = logger.warn.mock.calls.map((c: any[]) => String(c[0])).filter((m: string) => m.includes('fallback: true'));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain("'price_book'");
    });

    it('reports the object whatever the locale, and each marked set still loads for the locales it lists, as unmarked', async () => {
      // The declaration is ambiguous on every load, so every load reports it;
      // the refusal never costs a load rows the same sets give it unmarked.
      const cases: Array<[string | undefined, string[]]> = [
        ['zh-CN', ['标准价格表']],
        ['en', ['Standard']],
        ['ja-JP', []],
        [undefined, ['Standard', '标准价格表']],
      ];
      for (const [locale, expected] of cases) {
        const marked = await seedUnder(locale, [ACCOUNT_DATASET, PRICE_BOOK_ZH_FALLBACK, PRICE_BOOK_EN_FALLBACK]);
        const unmarked = await seedUnder(locale, [ACCOUNT_DATASET, PRICE_BOOK_ZH, PRICE_BOOK_EN]);
        expect(marked.result.success, `locale=${locale}`).toBe(false);
        expect(marked.result.errors.map((e) => e.field), `locale=${locale}`).toEqual(['fallback']);
        expect(names(marked.store), `locale=${locale}`).toEqual(expected);
        expect(names(unmarked.store), `control, locale=${locale}`).toEqual(expected);
        expect(marked.store.account, `locale=${locale}`).toHaveLength(1);
      }
    });

    it('names no fallback it did not use, and does not tell a correctly authored package to drop its marker', async () => {
      const { logger, result } = await seedUnder('ja-JP', [PRICE_BOOK_ZH_FALLBACK, PRICE_BOOK_EN_FALLBACK]);
      const infos = logger.info.mock.calls.map((c: any[]) => String(c[0]));
      expect(infos.some((m: string) => m.includes('fallback set(s) loaded'))).toBe(false);
      const message = result.errors[0]!.message;
      expect(message).toContain('an upgrade within this process changed a package');
      expect(message).not.toContain('drop it from the others');
    });

    it('an upgrade that changed the marked set (versions 1 and 2 on one list): en keeps its rows, ja-JP gets no fallback, warn names the object', async () => {
      // The shared replay list after an upgrade in a running process: version 1's
      // datasets, then version 2's, whose marked en set gained a row.
      const v1 = [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK];
      const EN_V2 = { ...PRICE_BOOK_EN_FALLBACK, records: [{ name: 'Standard' }, { name: 'Partner' }] };
      const v2 = [structuredClone(PRICE_BOOK_ZH), EN_V2];
      const unmarkedV2 = { ...PRICE_BOOK_EN, records: EN_V2.records };

      const en = await seedUnder('en', [ACCOUNT_DATASET, ...v1, ...v2]);
      const enControl = await seedUnder('en', [ACCOUNT_DATASET, PRICE_BOOK_ZH, PRICE_BOOK_EN, structuredClone(PRICE_BOOK_ZH), unmarkedV2]);
      expect(names(en.store)).toEqual(['Partner', 'Standard']);
      expect(names(en.store)).toEqual(names(enControl.store));
      expect(en.store.account).toHaveLength(1);

      const ja = await seedUnder('ja-JP', [ACCOUNT_DATASET, ...v1, ...v2]);
      expect(ja.store.price_book).toBeUndefined();
      expect(ja.store.account).toHaveLength(1);
      expect(ja.result.errors.map((e) => e.sourceObject)).toEqual(['price_book']);
      const warned = ja.logger.warn.mock.calls.map((c: any[]) => String(c[0])).filter((m: string) => m.includes('fallback: true'));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain("'price_book'");
    });

    it('identical copies of one fallback set count once: a list merged twice seeds normally', async () => {
      // The shared per-organization replay list holds a package's datasets once per merge.
      const copy = structuredClone(PRICE_BOOK_EN_FALLBACK);
      const reordered = Object.fromEntries(Object.entries(structuredClone(PRICE_BOOK_EN_FALLBACK)).reverse());
      const { store, result } = await seedUnder('ja-JP', [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK, structuredClone(PRICE_BOOK_ZH), copy, reordered]);
      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(names(store)).toEqual(['Standard']);
    });

    it('two packages marking the same object with different sets refuse only that object\'s fallback choice', async () => {
      const otherPackage = { object: 'price_book', externalId: 'name', mode: 'upsert', locale: ['de-DE'], fallback: true, records: [{ name: 'Standardpreisliste' }], _packageId: 'com.example.other' };
      const seeds = [ACCOUNT_DATASET, PRICE_BOOK_ZH, { ...PRICE_BOOK_EN_FALLBACK, _packageId: 'com.example.first' }, otherPackage];
      const { store, result } = await seedUnder('ja-JP', seeds);
      expect(store.price_book).toBeUndefined();
      expect(store.account).toHaveLength(1);
      expect(result.errors.map((e) => e.sourceObject)).toEqual(['price_book']);
      // Each package's marked set still loads for its own locale.
      const de = await seedUnder('de-DE', seeds);
      expect(names(de.store)).toEqual(['Standardpreisliste']);
    });

    it('one fallback set on each of two objects is fine', async () => {
      const TAX_EN_FALLBACK = { object: 'tax_rate', externalId: 'name', mode: 'upsert', locale: ['en'], fallback: true, records: [{ name: 'VAT' }] };
      const { store, result } = await seedUnder('ja-JP', [PRICE_BOOK_ZH, PRICE_BOOK_EN_FALLBACK, TAX_EN_FALLBACK]);
      expect(result.success).toBe(true);
      expect(names(store)).toEqual(['Standard']);
      expect(names(store, 'tax_rate')).toEqual(['VAT']);
    });

    it('two marked sets in different environments are not both in one load: not refused', async () => {
      const devFallback = { ...PRICE_BOOK_ZH_FALLBACK, env: ['dev'] };
      const prodFallback = { ...PRICE_BOOK_EN_FALLBACK, env: ['prod'] };
      const { store, result } = await seedUnder('ja-JP', [devFallback, prodFallback]);
      expect(result.success).toBe(true);
      expect(names(store)).toEqual(['Standard']);
    });
  });
});
