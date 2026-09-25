// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20091] A dataset measure's result-column `currency` honours the source
 * field's `currencyConfig.currencyMode`.
 *
 * ## The contract (spec, not this service)
 *
 * `CurrencyConfigSchema` (`packages/spec/src/data/field.zod.ts`) declares
 * `currencyMode: 'dynamic' | 'fixed'`, defaulting to `'dynamic'`, and
 * `defaultCurrency` defaulting to `'CNY'`. Its own precision refinement reads
 * `defaultCurrency` as the field's one currency ONLY under `'fixed'` — "dynamic
 * mode is out of reach BY DESIGN" — and the `FieldSchema` guidance for the
 * mistaken `currency` key says a fixed currency is declared as
 * `currencyConfig: { currencyMode: 'fixed', defaultCurrency: … }` and "A field
 * without one uses the tenant default at runtime".
 *
 * So a `dynamic` field has no field-level currency. Its `defaultCurrency` is
 * not the column's currency; the tenant default (`ExecutionContext.currency`)
 * is. objectstack-ai/objectui#10461 made the renderer's `resolveFieldCurrency`
 * read `defaultCurrency` only under `'fixed'`; the renderer reads an explicit
 * column `currency` FIRST, so an analytics column that still carried a dynamic
 * field's `defaultCurrency` overrode the renderer's rule on exactly the faces
 * this service feeds.
 *
 * ## Why this suite boots the PLUGIN over a REAL engine
 *
 * The defect lived in the RELAY — `AnalyticsServicePlugin`'s `sourceFieldMeta`,
 * which reads the registered object off the `'data'` engine — not in the
 * service's chain. Every pre-existing currency case in this package stubs
 * `sourceFieldMeta` directly, so none of them could see what the relay does
 * with `currencyMode`. Here the object is registered on a real `ObjectQL`
 * engine over `SqliteWasmDriver`, the plugin reads it the way production does,
 * and the currency is read off the `queryDataset` RESULT.
 *
 * ## Two arrival shapes of "a config naming no mode"
 *
 * The registry does not parse (`SchemaRegistry.registerObject` stores what it
 * is handed), so the relay sees whichever shape the door delivered:
 *
 *   - RAW — a programmatic `registerObject`: `{ defaultCurrency: 'EUR' }` has
 *     NO `currencyMode` key at all, and `{}` has no `defaultCurrency` either.
 *   - PARSED — the declared-stack path (`ObjectSchema.parse`): the schema's
 *     defaults are materialised, so no-mode reads `currencyMode: 'dynamic'` and
 *     `{}` reads `{ currencyMode: 'dynamic', defaultCurrency: 'CNY' }` — the
 *     spec's placeholder `CNY` then leaked onto the column as if authored.
 *
 * Both must answer the same: no mode is `dynamic` by the schema default.
 *
 * ## Both `queryDataset` paths
 *
 * The one reader of the relay's currency is `enrichResultColumns`, which the
 * live path and the ADR-0037 P3 draft-preview path both run. Each case below
 * is asserted on both. `AnalyticsService.query` (the cube face) carries no
 * column `currency` at all — the last block pins that, so "the cube face is
 * unaffected" is a measurement rather than an assumption.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectSchema } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsResult } from '@objectstack/spec/contracts';

import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

const OBJECT = 'money_deal';

/** The fields as AUTHORED — one per case, plus a non-monetary control. */
const AUTHORED_FIELDS = {
  stage: { type: 'text' },
  amt_fixed: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } },
  amt_dynamic: { type: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'EUR' } },
  amt_nomode: { type: 'currency', currencyConfig: { defaultCurrency: 'EUR' } },
  amt_emptycfg: { type: 'currency', currencyConfig: {} },
  amt_bare: { type: 'currency' },
  units: { type: 'number' },
} as const;

const ROWS = [
  { id: 'd1', stage: 'won', amt_fixed: 10, amt_dynamic: 10, amt_nomode: 10, amt_emptycfg: 10, amt_bare: 10, units: 1 },
  { id: 'd2', stage: 'lost', amt_fixed: 5, amt_dynamic: 5, amt_nomode: 5, amt_emptycfg: 5, amt_bare: 5, units: 2 },
];

const DATASET = DatasetSchema.parse({
  name: 'money_by_stage',
  label: 'Money by Stage',
  object: OBJECT,
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [
    { name: 'm_fixed', aggregate: 'sum', field: 'amt_fixed' },
    { name: 'm_dynamic', aggregate: 'sum', field: 'amt_dynamic' },
    { name: 'm_nomode', aggregate: 'sum', field: 'amt_nomode' },
    { name: 'm_emptycfg', aggregate: 'sum', field: 'amt_emptycfg' },
    { name: 'm_bare', aggregate: 'sum', field: 'amt_bare' },
    // An explicit measure `currency` wins over every field-side answer,
    // the field's FIXED currency included.
    { name: 'm_explicit_dynamic', aggregate: 'sum', field: 'amt_dynamic', currency: 'JPY' },
    { name: 'm_explicit_fixed', aggregate: 'sum', field: 'amt_fixed', currency: 'JPY' },
    { name: 'm_units', aggregate: 'sum', field: 'units' },
  ],
});

const SELECTION = {
  dimensions: ['stage'],
  measures: DATASET.measures!.map((m) => m.name),
};

/** A tenant whose default currency differs from every field's `defaultCurrency`. */
const CTX = { currency: 'USD' } as ExecutionContext;

type Shape = 'raw' | 'parsed';

function fieldsFor(shape: Shape): Record<string, unknown> {
  if (shape === 'raw') return AUTHORED_FIELDS as unknown as Record<string, unknown>;
  // The declared-stack door: the spec's own parse materialises the defaults.
  return ObjectSchema.parse({ name: OBJECT, label: 'Money Deal', fields: AUTHORED_FIELDS }).fields as Record<string, unknown>;
}

/**
 * A `'protocol'` service answering one PENDING seed draft for {@link OBJECT},
 * which is what routes `queryDataset({ previewDrafts: true })` onto the
 * draft-preview path through the plugin's own `draftRowsResolver`.
 */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'money_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

async function bootPlugin(engine: ObjectQL): Promise<AnalyticsService> {
  const registered: Record<string, unknown> = {};
  const services: Record<string, unknown> = { data: engine, protocol: pendingSeedProtocol };
  const ctx = {
    getService: (name: string) => services[name] ?? registered[name],
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: quiet,
  };
  await new AnalyticsServicePlugin({
    // The engine path, so the live rows really come from the driver.
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
  }).init(ctx as never);
  return registered.analytics as AnalyticsService;
}

const currencyByColumn = (result: AnalyticsResult): Record<string, string | undefined> =>
  Object.fromEntries(
    (result.fields ?? [])
      .filter((f) => f.name.startsWith('m_'))
      .map((f) => [f.name, (f as { currency?: string }).currency]),
  );

describe.each<Shape>(['raw', 'parsed'])('[#20091] result-column currency honours currencyMode — %s registration', (shape) => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;
  let live: Record<string, string | undefined>;
  let preview: Record<string, string | undefined>;
  let liveRows: AnalyticsResult['rows'];

  beforeAll(async () => {
    const fields = fieldsFor(shape);
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([{ name: OBJECT, fields } as never]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
    const engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OBJECT, label: 'Money Deal', fields } as never);
    service = await bootPlugin(engine);

    const liveResult = await service.queryDataset(DATASET, SELECTION, CTX);
    const previewResult = await service.queryDataset(DATASET, SELECTION, CTX, { previewDrafts: true });
    live = currencyByColumn(liveResult);
    preview = currencyByColumn(previewResult);
    liveRows = liveResult.rows;
  });
  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('CONTROL: the registered object is what this shape says it is', () => {
    // Without this the two describe blocks could be measuring one shape twice.
    const nomode = (fieldsFor(shape).amt_nomode as { currencyConfig?: { currencyMode?: string } }).currencyConfig;
    expect(nomode?.currencyMode).toBe(shape === 'raw' ? undefined : 'dynamic');
  });

  it('CONTROL: the live path really ran over the driver rows', () => {
    const won = (liveRows as Array<Record<string, unknown>>).find((r) => r.stage === 'won');
    expect(won?.m_fixed).toBe(10);
  });

  it("currencyMode 'fixed' — the column carries the field's currency", () => {
    expect(live.m_fixed).toBe('EUR');
    expect(preview.m_fixed).toBe('EUR');
  });

  it("currencyMode 'dynamic' — the column carries the tenant default, never the field's defaultCurrency", () => {
    expect(live.m_dynamic).toBe('USD');
    expect(preview.m_dynamic).toBe('USD');
  });

  it('a currencyConfig naming no mode is dynamic — the tenant default', () => {
    expect(live.m_nomode).toBe('USD');
    expect(preview.m_nomode).toBe('USD');
  });

  it("an empty currencyConfig is dynamic — the spec's defaulted CNY never reaches the column", () => {
    expect(live.m_emptycfg).toBe('USD');
    expect(preview.m_emptycfg).toBe('USD');
  });

  it('a currency field with no currencyConfig — the tenant default', () => {
    expect(live.m_bare).toBe('USD');
    expect(preview.m_bare).toBe('USD');
  });

  it('an explicit measure currency wins, over a dynamic field and over a fixed one', () => {
    expect(live.m_explicit_dynamic).toBe('JPY');
    expect(preview.m_explicit_dynamic).toBe('JPY');
    expect(live.m_explicit_fixed).toBe('JPY');
    expect(preview.m_explicit_fixed).toBe('JPY');
  });

  it('CONTROL: a non-monetary measure carries no currency', () => {
    expect(live.m_units).toBeUndefined();
    expect(preview.m_units).toBeUndefined();
  });
});

describe('[#20091] the cube face carries no column currency to disagree about', () => {
  it('AnalyticsService.query over the same registered object mints no `currency` on any column', async () => {
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([{ name: OBJECT, fields: AUTHORED_FIELDS } as never]);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
    const engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OBJECT, label: 'Money Deal', fields: AUTHORED_FIELDS } as never);
    const service = await bootPlugin(engine);
    // Registering the dataset compiles its cube under the dataset's name.
    service.registerDataset(DATASET);
    try {
      const result = await service.query(
        { cube: DATASET.name, dimensions: ['stage'], measures: ['m_fixed', 'm_dynamic'] } as never,
        CTX,
      );
      // Positive control: the query answered, so "no currency" is about the
      // columns and not about an empty response.
      expect(result.fields?.map((f) => f.name)).toEqual(expect.arrayContaining(['m_fixed', 'm_dynamic']));
      for (const f of result.fields ?? []) expect((f as { currency?: string }).currency).toBeUndefined();
    } finally {
      await driver.disconnect?.();
    }
  });
});
