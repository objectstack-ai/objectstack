// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0021, ADR-0149 D1] `AnalyticsService.queryDataset` — the method
 * `POST /analytics/dataset/query` (single and batch), the dashboard, the
 * report and the AI tool all reach — answers only the members the dataset
 * declares.
 *
 * Before, it minted a measure the dataset does not declare (`count`, a raw
 * field read as its `sum`, an `<field>_sum` suffix spelling, a
 * `<dataset>.`-qualified spelling) and grouped by a raw field named as a
 * dimension or a time dimension, so a dashboard tile could show a number the
 * dataset never defines. `query_dataset` refused those since it gained the
 * closed-member rule; the service now refuses them on every face, with the
 * same `INVALID_FIELD` / 400 (`member` / `param` / `cube`), before anything
 * is read, naming the members THIS caller may use and the remedy.
 *
 * Unchanged, and pinned as controls: every declared member is served; a
 * declared member over a field the caller may not read still reaches the
 * field gate (403); a caller who may not read the object at all gets the read
 * refusal (403), and one the read gate cannot decide for gets its 503, never
 * a member list either way; the cube door (`query()`, not a
 * dataset) still mints `count`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';
import { compareWindowRemedy } from '../dataset-declared-members.js';

const ME = { userId: 'u_me', tenantId: 'org_a' } as ExecutionContext;
const ADMIN = { userId: 'u_admin', tenantId: 'org_a' } as ExecutionContext;

const OBJECTS: Record<string, { fields: Record<string, Record<string, unknown>> }> = {
  crm_opp: {
    fields: {
      id: { type: 'text' },
      stage: { type: 'text' },
      region: { type: 'text' },
      amount: { type: 'number' },
      margin: { type: 'number' },
      closed_on: { type: 'date' },
      secret: { type: 'number', internal: true },
    },
  },
  crm_locked: { fields: { id: { type: 'text' }, amount: { type: 'number' } } },
  crm_flaky: { fields: { id: { type: 'text' }, amount: { type: 'number' } } },
};

const PIPELINE: Dataset = DatasetSchema.parse({
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opp',
  dimensions: [
    { name: 'stage', label: 'Stage', field: 'stage', type: 'string' },
    { name: 'region', label: 'Region', field: 'region', type: 'string' },
    { name: 'close_month', label: 'Close month', field: 'closed_on', type: 'date' },
  ],
  measures: [
    { name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount' },
    { name: 'margin_total', label: 'Margin', aggregate: 'sum', field: 'margin' },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
    { name: 'secret_sum', label: 'Secret', aggregate: 'sum', field: 'secret' },
  ],
});
const LOCKED: Dataset = DatasetSchema.parse({
  name: 'locked_ds',
  label: 'Locked',
  object: 'crm_locked',
  dimensions: [],
  measures: [{ name: 'total', label: 'Total', aggregate: 'sum', field: 'amount' }],
});

/** The read gate cannot reach a verdict on `crm_flaky` for u_me (its lookup throws: the 503 answer). */
const FLAKY: Dataset = DatasetSchema.parse({
  name: 'flaky_ds',
  label: 'Flaky',
  object: 'crm_flaky',
  dimensions: [],
  measures: [{ name: 'total', label: 'Total', aggregate: 'sum', field: 'amount' }],
});

const nativeSql = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });

/** u_me may not read `crm_locked` nor the `margin` field; u_admin reads everything. */
const security = {
  getReadFilter: async () => undefined,
  canReadObject: (object: string, ctx?: ExecutionContext) => {
    if (ctx?.userId === 'u_me' && object === 'crm_flaky') throw new Error('permission store unreachable');
    return !(ctx?.userId === 'u_me' && object === 'crm_locked');
  },
  getReadableFields: async (object: string, ctx?: ExecutionContext) => {
    const all = Object.keys(OBJECTS[object]?.fields ?? {});
    return ctx?.userId === 'u_me' ? all.filter((f) => f !== 'margin') : all;
  },
  getQueryableFields: async (object: string, ctx?: ExecutionContext) => {
    const all = Object.keys(OBJECTS[object]?.fields ?? {});
    return ctx?.userId === 'u_me' ? all.filter((f) => f !== 'margin') : all;
  },
};

async function boot(rows: Record<string, unknown>[] = [{ stage: 'won', revenue: 100 }]) {
  const reads: string[] = [];
  const engine = {
    execute: async (sql: unknown, options?: { object?: string }) => {
      reads.push(`execute:${options?.object ?? String(sql)}`);
      return { rows: rows.map((r) => ({ ...r })) };
    },
    hasObjectMiddleware: () => false,
    getObject: (name: string) => OBJECTS[name],
    resolveEffectiveDatasource: () => undefined,
  };
  const registered: Record<string, unknown> = {};
  const ctx = {
    getService: (name: string) => (name === 'security' ? security : name === 'data' ? engine : registered[name]),
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  await new AnalyticsServicePlugin({ queryCapabilities: nativeSql }).init(ctx as never);
  return { service: registered.analytics as AnalyticsService, reads };
}

const messageOf = (e: unknown) => String((e as Error)?.message ?? e);

describe('queryDataset refuses a selection member the dataset does not declare', () => {
  it.each([
    ['the ad-hoc count', { measures: ['count'] }, 'count', 'measures'],
    ['a raw field as a measure', { measures: ['amount'] }, 'amount', 'measures'],
    ['a suffix spelling', { measures: ['amount_sum'] }, 'amount_sum', 'measures'],
    ['a dataset-qualified spelling of a declared measure', { measures: ['pipeline.revenue'] }, 'pipeline.revenue', 'measures'],
    ['an undeclared measure beside a declared one', { measures: ['revenue', 'amount'] }, 'amount', 'measures'],
    ['a raw field as a dimension', { measures: ['revenue'], dimensions: ['region', 'amount'] }, 'amount', 'dimensions'],
    [
      'a raw field as a time dimension',
      { measures: ['revenue'], timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }] },
      'closed_on',
      'timeDimensions',
    ],
  ])('%s: 400 INVALID_FIELD naming the member, the declared ones and the remedy, reading nothing', async (_case, selection, member, param) => {
    const { service, reads } = await boot();
    const e = await service.queryDataset(PIPELINE, selection as never, ADMIN).catch((err) => err);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member, param, cube: 'pipeline' });
    expect(messageOf(e)).toContain(`The dataset "pipeline" does not declare the ${param === 'measures' ? 'measure' : 'dimension'} "${member}".`);
    for (const declared of ['revenue', 'margin_total', 'deal_count', 'stage', 'region', 'close_month']) {
      expect(messageOf(e)).toContain(declared);
    }
    expect(messageOf(e)).toContain('declare the member on the dataset');
    expect(reads).toEqual([]);
  });

  it('names every undeclared member, and only the members THIS caller may use', async () => {
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(PIPELINE, { measures: ['count'], dimensions: ['amount'] } as never, ME)
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'count', param: 'measures' });
    expect(messageOf(e)).toContain('the measure "count", dimension "amount"');
    expect(messageOf(e)).toContain('revenue');
    // `margin` is withheld from u_me; `secret` is an internal field.
    expect(messageOf(e)).not.toContain('margin_total');
    expect(messageOf(e)).not.toContain('secret');
    expect(reads).toEqual([]);
  });

  it('an inline dataset is judged against its own declaration', async () => {
    const { service, reads } = await boot();
    const inline = DatasetSchema.parse({
      name: 'draft_ds',
      label: 'Draft',
      object: 'crm_opp',
      dimensions: [],
      measures: [{ name: 'opp_count', label: 'Count', aggregate: 'count' }],
    });
    await expect(service.queryDataset(inline, { measures: ['count'] } as never, ADMIN)).rejects.toMatchObject({
      code: 'INVALID_FIELD',
      status: 400,
      member: 'count',
      cube: 'draft_ds',
    });
    expect(reads).toEqual([]);
    const served = await service.queryDataset(inline, { measures: ['opp_count'] } as never, ADMIN);
    expect(Array.isArray(served.rows)).toBe(true);
  });

  it('CONTROL: a caller who may not read the object gets the read refusal, never a member list', async () => {
    const { service, reads } = await boot();
    const e = await service.queryDataset(LOCKED, { measures: ['count'] } as never, ME).catch((err) => err);
    expect(e).toMatchObject({ status: 403 });
    expect(messageOf(e)).not.toContain('Measures you may use');
    expect(reads).toEqual([]);
  });

  it('CONTROL: a caller the read gate cannot decide for gets that gate\'s 503, never a member list', async () => {
    const { service, reads } = await boot();
    const e = await service.queryDataset(FLAKY, { measures: ['count'] } as never, ME).catch((err) => err);
    expect(e).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(messageOf(e)).not.toContain('Measures you may use');
    expect(messageOf(e)).not.toContain('total');
    expect(reads).toEqual([]);
  });

  it('CONTROL: a declared member over a field the caller may not read still reaches the field gate (403)', async () => {
    const { service, reads } = await boot();
    const e = await service.queryDataset(PIPELINE, { measures: ['margin_total'] } as never, ME).catch((err) => err);
    expect(e).toMatchObject({ status: 403 });
    expect(reads).toEqual([]);
  });

  it('a comparison window over an undeclared date key names the compare widget\'s remedy', async () => {
    // A dashboard compare widget lowers the dashboard date-range filter into
    // `timeDimensions` under the filtered FIELD's name (`closed_on`), which
    // this dataset declares only as `close_month`.
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(
        PIPELINE,
        {
          measures: ['revenue'],
          timeDimensions: [{ dimension: 'closed_on', dateRange: ['2026-01-01', '2026-03-31'] }],
          compareTo: { kind: 'previousPeriod' },
        } as never,
        ADMIN,
      )
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'closed_on', param: 'timeDimensions', cube: 'pipeline' });
    expect(messageOf(e)).toContain('The dataset "pipeline" does not declare the dimension "closed_on".');
    expect(messageOf(e)).toContain(
      'The dimension "closed_on" is the date key of this query\'s comparison window (`compareTo`)',
    );
    expect(messageOf(e)).toContain('Declare a date dimension named "closed_on" on the dataset (over that field).');
    expect(messageOf(e)).not.toContain('compareTo.dimension');
    expect(reads).toEqual([]);
  });

  it('a comparison whose compareTo.dimension names a declared dimension still refuses a second, undeclared dated key, with the one remedy', async () => {
    // Setting `compareTo.dimension` is no remedy: the renderer still lowers the
    // dashboard window on the undeclared field beside the declared one.
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(
        PIPELINE,
        {
          measures: ['revenue'],
          timeDimensions: [
            { dimension: 'close_month', dateRange: ['2026-01-01', '2026-03-31'] },
            { dimension: 'closed_on', dateRange: ['2026-01-01', '2026-03-31'] },
          ],
          compareTo: { kind: 'previousPeriod', dimension: 'close_month' },
        } as never,
        ADMIN,
      )
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'closed_on', param: 'timeDimensions', cube: 'pipeline' });
    expect(messageOf(e)).toContain('The dataset "pipeline" does not declare the dimension "closed_on".');
    expect(messageOf(e)).toContain(
      'The dimension "closed_on" is the date key of this query\'s comparison window (`compareTo`)',
    );
    expect(messageOf(e)).toContain('Declare a date dimension named "closed_on" on the dataset (over that field).');
    expect(messageOf(e)).not.toContain('compareTo.dimension');
    expect(reads).toEqual([]);
  });

  it('two undeclared comparison date keys are named together, in the plural, with one remedy', async () => {
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(
        PIPELINE,
        {
          measures: ['revenue'],
          timeDimensions: [
            { dimension: 'closed_on', dateRange: ['2026-01-01', '2026-03-31'] },
            { dimension: 'created_at', dateRange: ['2026-01-01', '2026-03-31'] },
          ],
          compareTo: { kind: 'previousYear' },
        } as never,
        ADMIN,
      )
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'closed_on', param: 'timeDimensions', cube: 'pipeline' });
    expect(messageOf(e)).toContain(
      'The dimensions "closed_on" and "created_at" are the date keys of this query\'s comparison window (`compareTo`)',
    );
    expect(messageOf(e)).toContain(
      'Declare a date dimension for each on the dataset, named "closed_on" and "created_at", each over the field of the same name.',
    );
    expect(messageOf(e)).not.toContain('compareTo.dimension');
    expect(reads).toEqual([]);
  });

  it('mixed comparison date keys: a related record\'s field gets the declare-over-it remedy, a nameable key keeps its declare-it remedy', async () => {
    // Seat ruling (option A): a dotted key cannot be a dimension name, so no
    // sentence tells the author to declare a dimension named after it; the
    // remedy is a date dimension declared over it (objectstack#34350).
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(
        PIPELINE,
        {
          measures: ['revenue'],
          timeDimensions: [
            { dimension: 'closed_on', dateRange: ['2026-01-01', '2026-03-31'] },
            { dimension: 'account.signed_at', dateRange: ['2026-01-01', '2026-03-31'] },
          ],
          compareTo: { kind: 'previousPeriod' },
        } as never,
        ADMIN,
      )
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'closed_on', param: 'timeDimensions', cube: 'pipeline' });
    expect(messageOf(e)).toContain(
      'The dimensions "closed_on" and "account.signed_at" are the date keys of this query\'s comparison window (`compareTo`)',
    );
    expect(messageOf(e)).toContain('"account.signed_at" cannot be a dimension name');
    expect(messageOf(e)).toContain(
      'so no date dimension can be declared under it. Declare one date dimension over it instead, with `type: \'date\'` and `field` set to that field, '
        + 'under any snake_case name (a related record\'s field needs its relationship in the dataset\'s `include`), and name that dimension in '
        + '`timeDimensions` (and in `compareTo.dimension`, if set): a dashboard compare widget sends its window under that declared name itself.',
    );
    expect(messageOf(e)).toContain(
      'For the key that can be a dimension name, declare a date dimension named "closed_on" on the dataset (over that field).',
    );
    expect(messageOf(e)).not.toMatch(/declare a date dimension[^.]*"account\.signed_at"/i);
    // The select-or-declare sentence names the member it is for, never the dotted key.
    expect(messageOf(e)).toContain(
      'For the dimension "closed_on", use one of these, or declare the member on the dataset (its `measures` or `dimensions`) and query it by that name.',
    );
    expect(reads).toEqual([]);
  });

  it('a related record\'s field as the only undeclared member: the refusal names no member to declare under the key, only a date dimension over it', async () => {
    // Seat ruling (option A): the message must be true for that class. The
    // select-or-declare sentence would name the dotted key, which no
    // declaration can carry, so it is left out; the compare-window sentence is
    // the whole remedy, a date dimension declared over the field
    // (objectstack#34350).
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(
        PIPELINE,
        {
          measures: ['revenue'],
          timeDimensions: [{ dimension: 'account.signed_at', dateRange: ['2026-01-01', '2026-03-31'] }],
          compareTo: { kind: 'previousPeriod' },
        } as never,
        ADMIN,
      )
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'account.signed_at', param: 'timeDimensions', cube: 'pipeline' });
    expect(messageOf(e)).toContain('Dimensions you may use: stage, region, close_month. The dimension "account.signed_at" is the date key');
    expect(messageOf(e)).not.toMatch(/\bdeclare (the member|a date dimension named)/i);
    expect(messageOf(e)).not.toContain('Use one of these');
    expect(messageOf(e)).toContain(
      '"account.signed_at" cannot be a dimension name (a dimension name is a snake_case identifier, with no dot, so a related record\'s field is never one), '
        + 'so no date dimension can be declared under it. Declare one date dimension over it instead, with `type: \'date\'` and `field` set to that field, '
        + 'under any snake_case name (a related record\'s field needs its relationship in the dataset\'s `include`), and name that dimension in '
        + '`timeDimensions` (and in `compareTo.dimension`, if set): a dashboard compare widget sends its window under that declared name itself.',
    );
    expect(reads).toEqual([]);
  });

  it('a related record\'s date key beside an undeclared measure: the select-or-declare sentence names the measure only', async () => {
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(
        PIPELINE,
        {
          measures: ['amount_sum'],
          timeDimensions: [{ dimension: 'account.signed_at', dateRange: ['2026-01-01', '2026-03-31'] }],
          compareTo: { kind: 'previousPeriod' },
        } as never,
        ADMIN,
      )
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'amount_sum', param: 'measures', cube: 'pipeline' });
    expect(messageOf(e)).toContain('does not declare the measure "amount_sum", dimension "account.signed_at".');
    expect(messageOf(e)).toContain(
      'For the measure "amount_sum", use one of these, or declare the member on the dataset (its `measures` or `dimensions`) and query it by that name.',
    );
    expect(messageOf(e)).not.toContain('Use one of these');
    expect(messageOf(e)).toContain('"account.signed_at" cannot be a dimension name');
    expect(messageOf(e)).not.toMatch(/declare a date dimension[^.]*"account\.signed_at"/i);
    expect(reads).toEqual([]);
  });

  it('CONTROL: the same undeclared time dimension with no comparison gets no compare-widget remedy', async () => {
    const { service } = await boot();
    const e = await service
      .queryDataset(
        PIPELINE,
        { measures: ['revenue'], timeDimensions: [{ dimension: 'closed_on', dateRange: ['2026-01-01', '2026-03-31'] }] } as never,
        ADMIN,
      )
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'closed_on' });
    expect(messageOf(e)).not.toContain('comparison window');
  });

  it('CONTROL: every declared measure and dimension, a declared time dimension included, is served', async () => {
    const { service, reads } = await boot([{ stage: 'won', revenue: 100, deal_count: 1 }]);
    const out = await service.queryDataset(
      PIPELINE,
      {
        measures: ['revenue', 'deal_count'],
        dimensions: ['stage', 'region'],
        timeDimensions: [{ dimension: 'close_month', dateRange: ['2026-01-01', '2026-12-31'] }],
      } as never,
      ADMIN,
    );
    expect(Array.isArray(out.rows)).toBe(true);
    expect(reads.length).toBeGreaterThan(0);
  });

  it('CONTROL: the cube door (query(), not a dataset) still mints `count`', async () => {
    const { service } = await boot([{ count: 3 }]);
    const spy = vi.fn();
    const out = await service.query({ cube: 'crm_opp', measures: ['count'] } as never, ADMIN).catch((e) => spy(e));
    expect(spy).not.toHaveBeenCalled();
    expect(out).toBeDefined();
  });
});

/**
 * [ADR-0021, ADR-0149 D1] The source-field gates' remedy on each door. A
 * dataset reaches them only through a DECLARED member whose field the object
 * does not have (a stale declaration): an undeclared one is refused first,
 * above. Their cube-door hint — measures are inferred from the object's own
 * fields as `FIELD_sum` …, and any own field may be used as a dimension
 * without declaring it — is false on the dataset door, so there the refusal
 * points at the member's declared field. The cube door keeps its hint.
 */
describe('the source-field gates word their remedy for the door that asked', () => {
  const STALE: Dataset = DatasetSchema.parse({
    name: 'stale_pipeline',
    label: 'Stale pipeline',
    object: 'crm_opp',
    dimensions: [
      { name: 'stage', label: 'Stage', field: 'stage', type: 'string' },
      { name: 'ghost_dim', label: 'Ghost', field: 'ghost', type: 'string' },
    ],
    measures: [
      { name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount' },
      { name: 'ghost_total', label: 'Ghost total', aggregate: 'sum', field: 'ghost' },
    ],
  });
  const MEASURE_HINT = /inferred from the object's OWN fields/;
  const DIMENSION_HINT = /without the cube declaring it/;

  it('the dataset door: a stale declared measure names its field and the fix, never the inferred-measure hint', async () => {
    const { service, reads } = await boot();
    const e = await service.queryDataset(STALE, { measures: ['ghost_total'] } as never, ADMIN).catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'ghost', param: 'measures' });
    expect(messageOf(e)).toMatch(/aggregates field 'ghost', which object 'crm_opp' does not have/);
    expect(messageOf(e)).toContain("The dataset declares this measure over 'ghost': point its `field` at one of the object's fields, or remove the measure");
    expect(messageOf(e)).not.toMatch(MEASURE_HINT);
    expect(reads).toEqual([]);
  });

  it('the dataset door: a stale declared dimension names its field and the fix, never the undeclared-dimension hint', async () => {
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(STALE, { measures: ['revenue'], dimensions: ['ghost_dim'] } as never, ADMIN)
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'ghost', param: 'dimensions' });
    expect(messageOf(e)).toMatch(/groups by field 'ghost', which object 'crm_opp' does not have/);
    expect(messageOf(e)).toContain("The dataset declares this dimension over 'ghost': point its `field` at one of the object's fields, or remove the dimension");
    expect(messageOf(e)).not.toMatch(DIMENSION_HINT);
    expect(reads).toEqual([]);
  });

  it('CONTROL: the cube door keeps both hints, because there they are true', async () => {
    const { service } = await boot();
    const measure = await service.query({ cube: 'crm_opp', measures: ['ghost_sum'] } as never, ADMIN).catch((err) => err);
    expect(measure).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'ghost' });
    expect(messageOf(measure)).toMatch(MEASURE_HINT);
    expect(messageOf(measure)).not.toContain('The dataset declares');
    const dimension = await service
      .query({ cube: 'crm_opp', measures: ['count'], dimensions: ['ghost'] } as never, ADMIN)
      .catch((err) => err);
    expect(dimension).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'ghost' });
    expect(messageOf(dimension)).toMatch(DIMENSION_HINT);
    expect(messageOf(dimension)).not.toContain('The dataset declares');
  });
});

describe('compareWindowRemedy — a true sentence for every key, in every mix', () => {
  const windows = (...keys: string[]) =>
    keys.map((member) => ({ member, param: 'timeDimensions' as const, compareWindow: true }));
  const include = 'under any snake_case name (a related record\'s field needs its relationship in the dataset\'s `include`)';
  const overIt = `so no date dimension can be declared under it. Declare one date dimension over it instead, with \`type: 'date'\` and \`field\` set to that field, ${include}, and name that dimension in \`timeDimensions\` (and in \`compareTo.dimension\`, if set): a dashboard compare widget sends its window under that declared name itself.`;
  const overEach = `so no date dimension can be declared under them. Declare one date dimension over each instead, with \`type: 'date'\` and \`field\` set to that field, ${include}, and name those dimensions in \`timeDimensions\` (and in \`compareTo.dimension\`, if set): a dashboard compare widget sends each window under its declared name itself.`;

  // [nameable keys, unnameable keys, the sentences after the intro]
  for (const [nameable, unnameable, tail] of [
    [['closed_on'], [], 'Declare a date dimension named "closed_on" on the dataset (over that field).'],
    [['closed_on', 'created_at'], [], 'Declare a date dimension for each on the dataset, named "closed_on" and "created_at", each over the field of the same name.'],
    [[], ['account.founded_at'], `"account.founded_at" cannot be a dimension name (a dimension name is a snake_case identifier, with no dot, so a related record's field is never one), ${overIt}`],
    [[], ['CloseDate'], `"CloseDate" cannot be a dimension name (a dimension name is a snake_case identifier, with no dot, so a related record's field is never one), ${overIt}`],
    [[], ['account.founded_at', 'owner.hired_at'], `"account.founded_at" and "owner.hired_at" cannot be dimension names (a dimension name is a snake_case identifier, with no dot, so a related record's field is never one), ${overEach}`],
    [['closed_on'], ['account.founded_at', 'owner.hired_at'], `"account.founded_at" and "owner.hired_at" cannot be dimension names (a dimension name is a snake_case identifier, with no dot, so a related record's field is never one), ${overEach} For the key that can be a dimension name, declare a date dimension named "closed_on" on the dataset (over that field).`],
    [['closed_on', 'created_at'], ['account.founded_at'], `"account.founded_at" cannot be a dimension name (a dimension name is a snake_case identifier, with no dot, so a related record's field is never one), ${overIt} For the keys that can be dimension names, declare a date dimension for each on the dataset, named "closed_on" and "created_at", each over the field of the same name.`],
  ] as Array<[string[], string[], string]>) {
    it(`${nameable.length} nameable, ${unnameable.length} unnameable`, () => {
      const keys = [...nameable, ...unnameable];
      const text = compareWindowRemedy(windows(...keys));
      expect(text.endsWith(` ${tail}`), text).toBe(true);
      expect(text).toContain(keys.length === 1 ? 'is the date key of' : 'are the date keys of');
      for (const key of unnameable) {
        expect(text).not.toMatch(new RegExp(`declare a date dimension[^.]*"${key.replace('.', '\\.')}"`, 'i'));
      }
    });
  }

  it('CONTROL: no comparison-window key, no sentence', () => {
    expect(compareWindowRemedy([{ member: 'account.founded_at', param: 'timeDimensions' }])).toBe('');
  });
});
