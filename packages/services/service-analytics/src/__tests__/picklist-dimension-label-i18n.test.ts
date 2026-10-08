// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22178] A picklist-bound select dimension renders its category labels in
 * the request's locale, through the plugin's own `translateSelectOptions`
 * bridge.
 *
 * ## The shape this closes
 *
 * A select field may author `picklist: '<name>'` in place of inline `options`
 * (`FieldSchema.picklist`). The registry serves it with the list's options
 * resolved onto it AND `picklist` kept (`PicklistServedFieldSchema`), and its
 * option labels translate under `picklists.<name>.options.<value>`, which
 * every referencing field inherits. `translateObject` consults that address
 * only for a field that carries `picklist`; the plugin built its synthetic
 * field from `options` alone, so a picklist-bound dimension rendered its
 * authored (English) labels under every `Accept-Language`, while
 * `GET /meta/object/:name` relabelled the identical field. Measured on
 * `POST /api/v1/analytics/dataset/query` in hotcrm: `zh-CN` and `ja-JP`
 * answered English for the picklist-bound `industry`, and translated labels
 * for the inline-options `type` beside it.
 *
 * ## What these pins hold
 *
 * - **The precondition the fix reads.** The real engine serves the
 *   picklist-bound field with `picklist` beside its resolved `options`, and
 *   the inline field with no `picklist`.
 * - **The defect.** Under `zh-CN` and `ja-JP` the picklist-bound dimension
 *   renders the list's translated labels, on both strategies. A field-level
 *   entry for one value is the more specific address and wins over the
 *   list's, exactly as on the object-metadata door: every label equals what
 *   `translateObject` gives the served object for the same locale.
 * - **The control.** The inline-options dimension renders its field-level
 *   translations, exactly as before; with no locale both dimensions render
 *   their authored labels.
 * - **The sort-key pass.** Once the picklist-bound dimension renders
 *   translated labels, an ascending `order` on it must sort, and a `limit`
 *   window it, by those labels rather than the authored ones it sorted by
 *   before; the same holds for the inline dimension, whose sort keys were
 *   never translated either. With no locale the order is the authored one.
 *
 * `AnalyticsService.queryDataset` is what `POST /api/v1/analytics/dataset/query`
 * calls, with the request's ExecutionContext (its `locale` read from
 * `Accept-Language`). The door lives in `@objectstack/rest`, which this package
 * does not depend on, so the pins stand at the service call it makes, over the
 * plugin's real composition: a real `ObjectQL` engine as `data` and an i18n
 * service as `i18n`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import { translateObject, type TranslationBundle } from '@objectstack/spec/system';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OBJECT = 'os22178_account';
const PICKLIST = 'os22178_industry';

const INDUSTRY = {
  name: PICKLIST,
  label: 'Industry',
  options: [
    { label: 'Education', value: 'education' },
    { label: 'Energy & Utilities', value: 'energy' },
    { label: 'Logistics', value: 'logistics' },
  ],
};

const ACCOUNT = {
  name: OBJECT,
  label: 'Account',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    industry: { name: 'industry', label: 'Industry', type: 'select' as const, picklist: PICKLIST },
    type: {
      name: 'type',
      label: 'Type',
      type: 'select' as const,
      options: [
        { label: 'Customer', value: 'customer' },
        { label: 'Partner', value: 'partner' },
      ],
    },
  },
};

const ROWS = [
  { name: 'a1', industry: 'education', type: 'customer' },
  { name: 'a2', industry: 'education', type: 'partner' },
  { name: 'a3', industry: 'energy', type: 'customer' },
  { name: 'a4', industry: 'logistics', type: 'customer' },
] as const;

/**
 * The bundle an i18n service holds: the list's labels under `picklists`, the
 * inline field's under `objects`. `zh-CN` also carries a FIELD-level entry for
 * one value of the picklist-bound field — the more specific address.
 */
const TRANSLATIONS: Record<string, Record<string, unknown>> = {
  en: {},
  'zh-CN': {
    picklists: { [PICKLIST]: { label: '行业', options: { education: '教育', energy: '能源公用事业', logistics: '物流' } } },
    objects: {
      [OBJECT]: {
        fields: {
          industry: { options: { logistics: '物流运输' } },
          type: { options: { customer: '正式客户', partner: '合作伙伴' } },
        },
      },
    },
  },
  'ja-JP': {
    picklists: { [PICKLIST]: { label: '業種', options: { education: '教育・学術', energy: 'エネルギー・公益', logistics: 'ロジスティクス' } } },
    objects: { [OBJECT]: { fields: { type: { options: { customer: '顧客', partner: 'パートナー' } } } } },
  },
};

const i18n = {
  getLocales: () => Object.keys(TRANSLATIONS),
  getTranslations: (locale: string) => TRANSLATIONS[locale] ?? {},
  getDefaultLocale: () => 'en',
  getFallbackLocale: () => 'en',
  t: (key: string) => key,
  loadTranslations: () => {},
};

/** Count per rendered label, from the rows the service answered. */
const EXPECTED: Record<string, { industry: Record<string, number>; type: Record<string, number> }> = {
  'zh-CN': {
    industry: { 教育: 2, 能源公用事业: 1, 物流运输: 1 },
    type: { 正式客户: 3, 合作伙伴: 1 },
  },
  'ja-JP': {
    industry: { '教育・学術': 2, 'エネルギー・公益': 1, ロジスティクス: 1 },
    type: { 顧客: 3, パートナー: 1 },
  },
};

const AUTHORED = {
  industry: { Education: 2, 'Energy & Utilities': 1, Logistics: 1 },
  type: { Customer: 3, Partner: 1 },
};

/**
 * Each dimension's rendered labels in ascending order of the rendered label
 * (the executor compares sort labels with `localeCompare`), and — the vacuity
 * guard — the same labels in ascending order of their AUTHORED labels, which
 * is what an `order` on a select dimension sorted by before. The two differ
 * for every locale and dimension here, so a sort-key pass that still read the
 * authored label cannot satisfy a pin on the first.
 */
const ORDERED = {
  'zh-CN': {
    industry: { byRendered: ['教育', '物流运输', '能源公用事业'], byAuthored: ['教育', '能源公用事业', '物流运输'] },
    type: { byRendered: ['合作伙伴', '正式客户'], byAuthored: ['正式客户', '合作伙伴'] },
  },
  'ja-JP': {
    industry: { byRendered: ['エネルギー・公益', 'ロジスティクス', '教育・学術'], byAuthored: ['教育・学術', 'エネルギー・公益', 'ロジスティクス'] },
    type: { byRendered: ['パートナー', '顧客'], byAuthored: ['顧客', 'パートナー'] },
  },
} as const;

const AUTHORED_ORDER = { industry: ['Education', 'Energy & Utilities', 'Logistics'], type: ['Customer', 'Partner'] } as const;

const DATASET = DatasetSchema.parse({
  name: 'os22178_account_metrics',
  label: 'Account metrics',
  object: OBJECT,
  dimensions: [
    { name: 'industry', field: 'industry', type: 'string' },
    { name: 'type', field: 'type', type: 'string' },
  ],
  measures: [{ name: 'account_count', aggregate: 'count' }],
});

const FACES = ['native', 'objectql'] as const;
type Face = (typeof FACES)[number];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

describe('[#22178] a picklist-bound select dimension renders its labels in the request locale', () => {
  let engine: ObjectQL;
  const services: Partial<Record<Face, AnalyticsService>> = {};

  /** `{ label: count }` for one dimension, as the dataset door would answer it. */
  const labelsOf = async (face: Face, dimension: 'industry' | 'type', locale?: string) => {
    const res = await services[face]!.queryDataset(
      DATASET,
      { dimensions: [dimension], measures: ['account_count'] },
      (locale ? { locale } : {}) as never,
    );
    const out: Record<string, number> = {};
    for (const row of res.rows) out[String(row[dimension])] = Number(row.account_count);
    return out;
  };

  /** The rendered labels in the order the service answered an ascending `order` on the dimension. */
  const orderedLabelsOf = async (face: Face, dimension: 'industry' | 'type', locale?: string, limit?: number) => {
    const res = await services[face]!.queryDataset(
      DATASET,
      { dimensions: [dimension], measures: ['account_count'], order: { [dimension]: 'asc' as const }, ...(limit ? { limit } : {}) },
      (locale ? { locale } : {}) as never,
    );
    return res.rows.map((row) => String(row[dimension]));
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registerApp({ id: 'com.test.os22178', name: 'os22178', picklists: [INDUSTRY], objects: [ACCOUNT] } as never);
    await engine.syncSchemas();
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as never);

    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
        getService: (name: string) => (name === 'data' ? engine : name === 'i18n' ? i18n : registered[name]),
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        hook: () => {},
        logger: quiet,
      } as never);
      services[face] = registered.analytics as AnalyticsService;
    }
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the engine serves the picklist-bound field with `picklist` beside its resolved options, and the inline field with none', () => {
    const fields = engine.getObject(OBJECT)!.fields as Record<string, { picklist?: unknown; options?: Array<{ value: unknown }> }>;
    expect(fields.industry.picklist).toBe(PICKLIST);
    expect(fields.industry.options!.map((o) => o.value)).toEqual(['education', 'energy', 'logistics']);
    expect(fields.type.picklist).toBeUndefined();
    expect(fields.type.options!.map((o) => o.value)).toEqual(['customer', 'partner']);
  });

  it('the ordering fixture discriminates: rendered-label order is the comparator\'s order and differs from authored-label order', () => {
    for (const locale of ['zh-CN', 'ja-JP'] as const) {
      for (const dimension of ['industry', 'type'] as const) {
        const { byRendered, byAuthored } = ORDERED[locale][dimension];
        expect([...byRendered].sort((a, b) => a.localeCompare(b)), `${locale} ${dimension}`).toEqual(byRendered);
        expect(byAuthored, `${locale} ${dimension}`).not.toEqual(byRendered);
        expect([...byAuthored].sort(), `${locale} ${dimension}`).toEqual([...byRendered].sort());
      }
    }
  });

  for (const face of FACES) {
    describe(`${face} strategy`, () => {
      for (const locale of ['zh-CN', 'ja-JP'] as const) {
        it(`${locale}: the picklist-bound dimension renders the list's translated labels`, async () => {
          expect(await labelsOf(face, 'industry', locale)).toEqual(EXPECTED[locale].industry);
        });

        it(`${locale}: every picklist-bound label equals the object-metadata door's label for the same field`, async () => {
          const bundle = TRANSLATIONS as unknown as TranslationBundle;
          const served = translateObject(engine.getObject(OBJECT)! as never, bundle, {
            locale,
            fallbackChain: ['en'],
            defaultLocale: 'en',
          }) as { fields: Record<string, { options: Array<{ value: string; label: string }> }> };
          const counts: Record<string, number> = { education: 2, energy: 1, logistics: 1 };
          const fromMetaDoor: Record<string, number> = {};
          for (const opt of served.fields.industry.options) fromMetaDoor[opt.label] = counts[opt.value];
          expect(await labelsOf(face, 'industry', locale)).toEqual(fromMetaDoor);
        });

        it(`${locale}: control — the inline-options dimension renders its field-level translations, as before`, async () => {
          expect(await labelsOf(face, 'type', locale)).toEqual(EXPECTED[locale].type);
        });
      }

      it('control — with no locale, both dimensions render their authored labels', async () => {
        expect(await labelsOf(face, 'industry')).toEqual(AUTHORED.industry);
        expect(await labelsOf(face, 'type')).toEqual(AUTHORED.type);
      });

      // The sort-key pass reads the same translated options as the display
      // pass, so an `order` sorts, and a `limit` windows, by the label the
      // row renders — for the picklist-bound and the inline dimension alike.
      for (const locale of ['zh-CN', 'ja-JP'] as const) {
        for (const dimension of ['industry', 'type'] as const) {
          it(`${locale}: an ascending order on ${dimension} sorts and windows by the rendered label`, async () => {
            const { byRendered } = ORDERED[locale][dimension];
            expect(await orderedLabelsOf(face, dimension, locale)).toEqual(byRendered);
            expect(await orderedLabelsOf(face, dimension, locale, 1)).toEqual([byRendered[0]]);
          });
        }
      }

      it('control — with no locale, an ascending order sorts by the authored label', async () => {
        expect(await orderedLabelsOf(face, 'industry')).toEqual(AUTHORED_ORDER.industry);
        expect(await orderedLabelsOf(face, 'type')).toEqual(AUTHORED_ORDER.type);
      });
    });
  }
});
