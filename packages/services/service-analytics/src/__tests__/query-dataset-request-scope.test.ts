// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20356] A dataset query writes nothing into the registries every caller
 * shares.
 *
 * `queryDataset` used to compile its dataset and REGISTER it — the cube in the
 * service-wide `CubeRegistry`, the compiled dataset in the join-allowlist /
 * dataset-scope registry — before the selection ran and before any admission
 * was asked. The dataset's name then meant the caller's definition for every
 * later reader of that name, whatever the request's own verdict was. It now
 * compiles into a request scope that overlays the shared registry read-only.
 *
 * ## What each case is shaped to catch
 *
 * - The OBSERVER is a second caller: its `getMeta()` and the exact call its own
 *   query puts on the driver, both taken before and after. Equality of the two
 *   snapshots is the assertion — a fix that registered and later restored
 *   would pass a spot check on one field and fail this.
 * - The REFUSED leg asserts the refusal's envelope (`PERMISSION_DENIED` / 403)
 *   and that the driver never saw the walled object. Its dataset carries the
 *   name of an ADMITTED cube, so the verdict also proves admission judged the
 *   request's own dataset: a scope applied to the strategy but not to the
 *   admission set would admit it against the shared cube's object.
 * - The ADMITTED leg is the negative control a lazy fix loses: the request
 *   must still be served, from ITS definition — the driver sees the request's
 *   object, not the shared cube's.
 * - A `public: false` cube keeps its authored definition in the registry, and
 *   stays hidden: `getMeta` omits it (`cube-visibility.ts`), so the observer's
 *   discovery snapshot — taken before and after — never lists it, and the
 *   entry the visibility filter reads is still the author's.
 * - CONTROL: a dataset registered at construction (`datasets`, the boot door)
 *   still serves by name, and a request under its name leaves its compiled
 *   scope — the definition-level `filter` the shared query applies — intact.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { Cube } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

const CALLER_A = { userId: 'u_a', tenantId: 'org_a' } as ExecutionContext;
const CALLER_B = { userId: 'u_b', tenantId: 'org_a' } as ExecutionContext;

/** The object no caller may read. */
const WALLED = 'walled_obj';

const OPEN_SUMMARY: Cube = {
  name: 'open_summary',
  title: 'Open summary',
  sql: 'open_obj',
  measures: {
    authored_total: { label: 'Authored total', type: 'count', sql: '*' },
  },
  dimensions: {
    region: { label: 'Region', type: 'string', sql: 'region' },
  },
};

const HIDDEN_SUMMARY: Cube = {
  name: 'hidden_summary',
  title: 'Hidden summary',
  sql: 'open_obj',
  measures: {
    hidden_total: { label: 'Hidden total', type: 'count', sql: '*' },
  },
  dimensions: {
    region: { label: 'Region', type: 'string', sql: 'region' },
  },
  public: false,
};

/** Registered at construction — the boot door this card keeps. */
const SAVED = DatasetSchema.parse({
  name: 'saved_summary',
  label: 'Saved summary',
  object: 'open_obj',
  filter: { region: 'west' },
  dimensions: [{ name: 'region', label: 'Region', field: 'region', type: 'string' }],
  measures: [{ name: 'saved_total', label: 'Saved total', aggregate: 'count' }],
});

/** A request's own dataset, under a name the shared registry may already hold. */
const inline = (name: string, object: string) =>
  DatasetSchema.parse({
    name,
    label: `inline ${name}`,
    object,
    dimensions: [],
    measures: [{ name: 'inline_total', label: 'Inline total', aggregate: 'count' }],
  });

const nativeSqlOnly = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });
const objectqlOnly = () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false });

const STRATEGY_PATHS = [
  { label: 'NativeSQLStrategy', capabilities: nativeSqlOnly },
  { label: 'ObjectQLStrategy', capabilities: objectqlOnly },
] as const;

/** Every call either strategy put on the driver, in order. */
type DriverCall = { object: string; detail: unknown };

function makeService(capabilities: () => { nativeSql: boolean; objectqlAggregate: boolean; inMemory: boolean }) {
  const calls: DriverCall[] = [];
  const svc = new AnalyticsService({
    cubes: [OPEN_SUMMARY, HIDDEN_SUMMARY],
    datasets: [SAVED],
    queryCapabilities: capabilities,
    admitObjectRead: (object) => object !== WALLED,
    executeRawSql: async (object, sql, params) => {
      calls.push({ object, detail: { sql, params } });
      return [{ authored_total: 3, saved_total: 2, inline_total: 5, amount_sum: 7 }];
    },
    executeAggregate: async (object, options) => {
      calls.push({ object, detail: options });
      return [{ authored_total: 3, saved_total: 2, inline_total: 5, amount_sum: 7 }];
    },
  });
  return { svc, calls };
}

type Harness = ReturnType<typeof makeService>;

/**
 * The second caller's whole view: what discovery lists, and the exact driver
 * call its queries of the authored cube and of the saved dataset produce.
 */
async function observe({ svc, calls }: Harness) {
  const meta = await svc.getMeta();
  const from = calls.length;
  await svc.query({ cube: 'open_summary', measures: ['authored_total'] }, CALLER_B);
  await svc.query({ cube: 'saved_summary', measures: ['saved_total'] }, CALLER_B);
  const driven = calls.slice(from);
  return { meta, driven };
}

describe.each(STRATEGY_PATHS)('queryDataset leaves the shared registries alone — $label', ({ capabilities }) => {
  it('observer baseline: the authored cube and the saved dataset serve by name, on their own objects', async () => {
    const h = makeService(capabilities);
    const { meta, driven } = await observe(h);
    // `hidden_summary` declares `public: false`, so discovery omits it.
    expect(meta.map((c) => c.name).sort()).toEqual(['open_summary', 'saved_summary']);
    expect(driven.map((c) => c.object)).toEqual(['open_obj', 'open_obj']);
    // The saved dataset's definition-level filter reaches the driver — the
    // compiled scope this card must leave in place.
    expect(JSON.stringify(driven[1].detail)).toContain('west');
  });

  it('a REFUSED request under an authored name answers PERMISSION_DENIED / 403 and changes nothing another caller sees', async () => {
    const h = makeService(capabilities);
    const before = await observe(h);
    const from = h.calls.length;

    await expect(
      h.svc.queryDataset(inline('open_summary', WALLED), { measures: ['inline_total'] }, CALLER_A),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    // Admission judged the request's own object — the walled one — so nothing
    // reached the driver for it.
    expect(h.calls.slice(from)).toEqual([]);

    expect(await observe(h)).toEqual(before);
    expect(h.svc.cubeRegistry.get('open_summary')).toBe(OPEN_SUMMARY);
  });

  it('an ADMITTED request under an authored name is served from ITS definition and changes nothing another caller sees', async () => {
    const h = makeService(capabilities);
    const before = await observe(h);
    const from = h.calls.length;

    const result = await h.svc.queryDataset(
      inline('open_summary', 'other_obj'),
      { measures: ['inline_total'] },
      CALLER_A,
    );
    expect(result.rows).toHaveLength(1);
    // Served, and from the request's own dataset: its object, not the
    // authored cube's.
    expect(h.calls.slice(from).map((c) => c.object)).toEqual(['other_obj']);

    expect(await observe(h)).toEqual(before);
    expect(h.svc.cubeRegistry.get('open_summary')).toBe(OPEN_SUMMARY);
  });

  it('a request under a `public: false` cube\'s name leaves the author\'s hidden definition in the registry', async () => {
    const h = makeService(capabilities);
    const before = await observe(h);

    await h.svc.queryDataset(inline('hidden_summary', 'other_obj'), { measures: ['inline_total'] }, CALLER_A);

    expect(await observe(h)).toEqual(before);
    const entry = h.svc.cubeRegistry.get('hidden_summary');
    expect(entry).toBe(HIDDEN_SUMMARY);
    expect(entry?.public).toBe(false);
  });

  it('a request under a fresh name leaves no entry — refused or admitted, augmented measures included', async () => {
    const h = makeService(capabilities);
    const names = h.svc.cubeRegistry.names();
    const before = await observe(h);

    await expect(
      h.svc.queryDataset(inline('fresh_walled', WALLED), { measures: ['inline_total'] }, CALLER_A),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    // `amount_sum` is not declared by the dataset: `ensureCube` augments the
    // request's cube with a suffix-inferred measure, and that augmentation is
    // the request's too.
    const from = h.calls.length;
    await h.svc.queryDataset(
      inline('fresh_open', 'other_obj'),
      { measures: ['inline_total', 'amount_sum'] },
      CALLER_A,
    );
    const driven = h.calls.slice(from);
    expect(driven.map((c) => c.object)).toEqual(['other_obj']);
    // …and the augmented measure really reached the driver (`SUM(amount)`).
    expect(JSON.stringify(driven[0].detail)).toContain('amount');

    expect(h.svc.cubeRegistry.names()).toEqual(names);
    expect(await observe(h)).toEqual(before);
  });

  it('CONTROL: the boot-registered dataset still serves, and a request under its name leaves its compiled scope intact', async () => {
    const h = makeService(capabilities);
    const before = await observe(h);

    // The saved definition itself, through the dataset door — still served.
    const saved = await h.svc.queryDataset(SAVED, { measures: ['saved_total'] }, CALLER_A);
    expect(saved.rows).toHaveLength(1);
    // A different definition under the saved name: no filter, another object.
    await h.svc.queryDataset(inline('saved_summary', 'other_obj'), { measures: ['inline_total'] }, CALLER_A);

    const after = await observe(h);
    expect(after).toEqual(before);
    expect(JSON.stringify(after.driven[1].detail)).toContain('west');
  });
});
