// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate: an INLINE dataset posted to `POST /analytics/dataset/query`
// is that request's definition and nobody else's — another member's
// `GET /analytics/meta` and their own queries answer exactly as they did before
// it, whether the request was refused or admitted (#20356).
//
// ## The defect
//
// The dataset door compiled the posted definition and registered it in the
// analytics service's process-wide registry under the dataset's name, BEFORE
// the object-level admission ran. The name then meant the poster's definition
// for every later reader of it, whatever the request's own verdict, until a
// restart. The service now compiles each request's dataset into a scope of its
// own, and the registry every caller reads is only ever written at boot.
//
// ## How it is observed
//
// Two separate sign-ups. Member A posts; member B observes. B's observation is
// the whole of what B can see through the three doors — the `meta` listing,
// B's query of the authored cube, and B's query of the app's saved dataset —
// and each leg asserts it is EQUAL to the baseline B took before A posted
// anything. Equality over the whole answer, not a spot check of one title, so
// a partial replacement cannot pass.
//
// ## The legs
//
// - REFUSED: A's dataset reads an object A holds no grant on, under the name of
//   the authored cube → `403 PERMISSION_DENIED`, and B's view is unchanged.
// - ADMITTED: the same name over an object A may read → `200`, served from A's
//   definition (A's measure, over A's own rows), and B's view is unchanged.
//   This is the negative control a fix that simply refused would lose.
// - HIDDEN: the name of a cube declared `public: false` → still `200` (no new
//   refusal on this door: a name shared with a configured cube is harmless
//   once nothing is shared), and B's view is unchanged. Whether `meta` LISTS
//   a hidden cube at all is `analytics_cube.public`'s enforcement, which this
//   tree does not carry; the equality holds either way, so this leg keeps its
//   meaning once that lands.
// - CONTROL: the saved dataset the app declares still serves by name, in the
//   baseline and after every leg.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';
import { defineStack } from '@objectstack/spec';
import type { Cube } from '@objectstack/spec/data';
import {
  AdmissionOpen,
  AdmissionWalled,
  admissionFixtureSecurity,
} from './fixtures/analytics-admission-fixture.js';

const A_OPEN_ROWS = 3;
/** Deliberately different from A's count, so the two members' numbers cannot be confused. */
const B_OPEN_ROWS = 2;
const WALLED_ROWS = 4;

/** The configured cube other members read, over the object every member may read. */
const OPEN_SUMMARY: Cube = {
  name: 'open_summary',
  title: 'Open summary',
  sql: 'admission_open',
  measures: {
    authored_total: { label: 'Authored total', type: 'count', sql: '*' },
  },
  dimensions: {
    region: { label: 'Region', type: 'string', sql: 'region' },
  },
};

/** A configured cube its author hid. */
const HIDDEN_SUMMARY: Cube = {
  name: 'hidden_summary',
  title: 'Hidden summary',
  sql: 'admission_open',
  measures: {
    hidden_total: { label: 'Hidden total', type: 'count', sql: '*' },
  },
  dimensions: {},
  public: false,
};

const isolationStack = defineStack({
  manifest: {
    id: 'com.dogfood.analytics-inline-isolation',
    // The fixture objects' own prefix — they are reused, not renamed.
    namespace: 'admission',
    version: '0.0.0',
    type: 'app',
    name: 'Analytics Inline Dataset Isolation Fixture',
    description: 'The admission fixture objects plus one saved dataset, with configured cubes on the analytics plugin.',
  },
  objects: [AdmissionOpen, AdmissionWalled],
  datasets: [
    {
      name: 'saved_open_summary',
      label: 'Saved open summary',
      object: 'admission_open',
      dimensions: [],
      measures: [{ name: 'saved_total', label: 'Saved total', aggregate: 'count' }],
    },
  ],
});

/** A member's own dataset, posted inline under a chosen name. */
const inlineDataset = (name: string, object: string) => ({
  name,
  label: `inline ${name}`,
  object,
  dimensions: [],
  measures: [{ name: 'inline_total', label: 'Inline total', aggregate: 'count' }],
});

/**
 * [ADR-0131 C1] The two analytics strategies, each on the SQL in-memory driver
 * (`sqlite-wasm`, `:memory:`): the `sqlite-wasm` leg lets the analytics plugin
 * take its NativeSQL strategy, and the `objectql-strategy` leg withholds the
 * native-SQL capability (`queryCapabilities`) so the ObjectQL strategy answers.
 * That leg used to be the in-memory driver, whose only route to the ObjectQL
 * strategy was having no SQL. Under `single` every session now carries the
 * Default Organization, and `driver-memory` refuses a tenant-scoped read (503)
 * until ADR-0131 D8 gives `single` no read predicate.
 * Restart-when: #15212 closed — add the `memory` leg back then.
 */
const DRIVERS = ['sqlite-wasm', 'objectql-strategy'] as const;

/** The analytics plugin a leg boots; the ObjectQL-strategy leg withholds native SQL. */
function analyticsFor(
  leg: (typeof DRIVERS)[number],
  options: ConstructorParameters<typeof AnalyticsServicePlugin>[0] = {},
): AnalyticsServicePlugin {
  return new AnalyticsServicePlugin({
    ...options,
    ...(leg === 'objectql-strategy'
      ? { queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) }
      : {}),
  });
}

interface Boot {
  stack: VerifyStack;
  tokenA: string;
  tokenB: string;
  baseline: Observation;
}

interface Observation {
  meta: { status: number; body: unknown };
  authored: { status: number; body: unknown };
  saved: { status: number; body: unknown };
}

const boots = new Map<string, Boot>();

async function read(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

/** Everything member B can see of analytics through the three doors. */
async function observeAsB(stack: VerifyStack, tokenB: string): Promise<Observation> {
  return {
    meta: await read(await stack.apiAs(tokenB, 'GET', '/analytics/meta')),
    authored: await read(
      await stack.apiAs(tokenB, 'POST', '/analytics/query', {
        cube: 'open_summary',
        measures: ['authored_total'],
      }),
    ),
    saved: await read(
      await stack.apiAs(tokenB, 'POST', '/analytics/dataset/query', {
        datasetName: 'saved_open_summary',
        selection: { measures: ['saved_total'] },
      }),
    ),
  };
}

/** The single count a one-measure answer carries, whichever envelope the door uses. */
function countOf(body: unknown, measure: string): number {
  const payload = (body as { data?: unknown })?.data ?? body;
  const rows = (payload as { rows?: Array<Record<string, unknown>> })?.rows ?? [];
  return rows.reduce((sum, row) => sum + Number(row[measure] ?? 0), 0);
}

async function bootFor(driver: (typeof DRIVERS)[number]): Promise<Boot> {
  const stack = await bootStack(isolationStack as never, {
    security: admissionFixtureSecurity(),
    databaseDriver: 'sqlite-wasm',
    analytics: analyticsFor(driver, { cubes: [OPEN_SUMMARY, HIDDEN_SUMMARY] }),
  });
  const adminToken = await stack.signIn();
  const tokenA = await stack.signUp(`isolation-a-${driver}@verify.test`);
  const tokenB = await stack.signUp(`isolation-b-${driver}@verify.test`);

  // Each member authors their own rows over HTTP, so `created_by` is the real
  // caller and the owner policy makes each member's count their own number.
  for (const [token, rows, who] of [
    [tokenA, A_OPEN_ROWS, 'a'],
    [tokenB, B_OPEN_ROWS, 'b'],
  ] as const) {
    for (let i = 0; i < rows; i++) {
      const r = await stack.apiAs(token, 'POST', '/data/admission_open', { name: `${who}-open-${i}`, region: 'west' });
      expect(r.status).toBeLessThan(300);
    }
  }
  for (let i = 0; i < WALLED_ROWS; i++) {
    const w = await stack.apiAs(adminToken, 'POST', '/data/admission_walled', { name: `walled-${i}`, region: 'west' });
    expect(w.status).toBeLessThan(300);
  }

  const baseline = await observeAsB(stack, tokenB);
  return { stack, tokenA, tokenB, baseline };
}

describe.each(DRIVERS)(
  'dogfood: an inline dataset changes nothing another member sees [driver=%s]',
  (driver) => {
    beforeAll(async () => {
      boots.set(driver, await bootFor(driver));
    }, 120_000);

    afterAll(async () => {
      await boots.get(driver)?.stack.stop();
      boots.delete(driver);
    });

    it('baseline: B sees the configured cube and the saved dataset, each over B\'s own rows', () => {
      const { baseline } = boots.get(driver)!;
      expect(baseline.meta.status).toBe(200);
      const listed = JSON.stringify(baseline.meta.body);
      expect(listed).toContain('Open summary');
      expect(listed).not.toContain('inline ');
      expect(baseline.authored.status).toBe(200);
      expect(countOf(baseline.authored.body, 'authored_total')).toBe(B_OPEN_ROWS);
      // CONTROL — the app's saved dataset serves by name.
      expect(baseline.saved.status).toBe(200);
      expect(countOf(baseline.saved.body, 'saved_total')).toBe(B_OPEN_ROWS);
    });

    it('REFUSED: A\'s dataset over an object A may not read answers 403 PERMISSION_DENIED, and B\'s view is unchanged', async () => {
      const boot = boots.get(driver)!;
      const res = await boot.stack.apiAs(boot.tokenA, 'POST', '/analytics/dataset/query', {
        dataset: inlineDataset('open_summary', 'admission_walled'),
        selection: { measures: ['inline_total'] },
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code?: string }).code).toBe('PERMISSION_DENIED');

      expect(await observeAsB(boot.stack, boot.tokenB)).toEqual(boot.baseline);
    });

    it('ADMITTED: the same name over an object A may read is served from A\'s definition, and B\'s view is unchanged', async () => {
      const boot = boots.get(driver)!;
      const res = await boot.stack.apiAs(boot.tokenA, 'POST', '/analytics/dataset/query', {
        dataset: inlineDataset('open_summary', 'admission_open'),
        selection: { measures: ['inline_total'] },
      });
      expect(res.status).toBe(200);
      // A's measure, over A's own rows — the request's definition, not B's cube.
      expect(countOf(await res.json(), 'inline_total')).toBe(A_OPEN_ROWS);

      expect(await observeAsB(boot.stack, boot.tokenB)).toEqual(boot.baseline);
    });

    it('HIDDEN: a dataset named like a `public: false` cube is served without a new refusal, and B\'s view is unchanged', async () => {
      const boot = boots.get(driver)!;
      const res = await boot.stack.apiAs(boot.tokenA, 'POST', '/analytics/dataset/query', {
        dataset: inlineDataset('hidden_summary', 'admission_open'),
        selection: { measures: ['inline_total'] },
      });
      expect(res.status).toBe(200);

      const after = await observeAsB(boot.stack, boot.tokenB);
      expect(after).toEqual(boot.baseline);
      expect(JSON.stringify(after.meta.body)).not.toContain('inline hidden_summary');
    });

    it('CONTROL: a dataset posted under the saved dataset\'s name leaves the saved dataset serving as before', async () => {
      const boot = boots.get(driver)!;
      const res = await boot.stack.apiAs(boot.tokenA, 'POST', '/analytics/dataset/query', {
        dataset: inlineDataset('saved_open_summary', 'admission_walled'),
        selection: { measures: ['inline_total'] },
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code?: string }).code).toBe('PERMISSION_DENIED');

      expect(await observeAsB(boot.stack, boot.tokenB)).toEqual(boot.baseline);
    });
  },
);
