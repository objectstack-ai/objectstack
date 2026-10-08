// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// END-TO-END gate: an ad-hoc query on `POST /analytics/query` or
// `POST /analytics/sql` changes nothing another member sees — refused or
// admitted. A measure the caller named on top of a configured cube, and a cube
// inferred for an object no cube is configured over, stay that request's own
// (#20381).
//
// ## The defect
//
// Both ad-hoc doors resolved the query's cube, and minted what was missing,
// straight into the analytics service's process-wide registry — BEFORE the
// object-level read admission ran. A request refused `403 PERMISSION_DENIED`
// still left the cube it inferred for the refused object in every member's
// `GET /analytics/meta`, and a suffix measure a caller named on a configured
// cube was appended to that cube for every member, admitted or refused. The
// doors now run in a request scope of their own (the one the dataset door got
// for #20356), and nothing minted there leaves it. An ADMITTED request's
// inferred cube used to be published to the shared registry ("CubeRegistry
// source 3"), so `meta` listed to every member an object someone had queried
// and the member names they used; that source is retired (ruling A on
// #20381), and the registry is written by configuration alone.
//
// ## How it is observed
//
// Two separate sign-ups, A and B, holding the same grant (read on
// `admission_open` only), plus the administrator. Member A — or the admin —
// asks; member B observes. B's observation is the whole of what B can see of
// the analytics registry through the two doors B uses — the `meta` listing,
// kept as the raw response bytes as well as parsed, and B's query of the
// configured cube — taken immediately before and after each leg and compared
// for EQUALITY, so neither a partial rewrite nor an added cube can pass.
//
// ## The legs, on each door
//
// - REFUSED, inferred: A's ad-hoc query over the object A may not read →
//   `403 PERMISSION_DENIED`, and B's view is unchanged.
// - REFUSED, appended: A's query of the configured cube over that object,
//   naming a suffix measure the cube does not declare → `403`, and B's view is
//   unchanged.
// - ADMITTED, appended: the same suffix measure on the configured cube over
//   the object A may read → `200`, served WITH A's measure, and B's view is
//   unchanged. The negative control a fix that simply refused would lose.
//
// ## Controls
//
// - A configured cube still serves: every B observation is a `200` count of
//   B's own rows.
// - An admitted scalar metric over an object is served on a second request
//   too, with the same answer: it infers again, because nothing was
//   published between the two, and B's view is unchanged.
// - The administrator's admitted ad-hoc query over the walled object leaves
//   B's `meta` byte-identical and B's configured-cube query unchanged, and B's
//   own query of that object is still refused on both doors.

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

/** The configured cube B reads, over the object every member may read. */
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

/** A configured cube over the object no member may read. */
const WALLED_SUMMARY: Cube = {
  name: 'walled_summary',
  title: 'Walled summary',
  sql: 'admission_walled',
  measures: {
    walled_total: { label: 'Walled total', type: 'count', sql: '*' },
  },
  dimensions: {},
};

const adhocStack = defineStack({
  manifest: {
    id: 'com.dogfood.analytics-adhoc-isolation',
    // The fixture objects' own prefix — they are reused, not renamed.
    namespace: 'admission',
    version: '0.0.0',
    type: 'app',
    name: 'Analytics Ad-hoc Query Isolation Fixture',
    description: 'The admission fixture objects, with configured cubes over each on the analytics plugin.',
  },
  objects: [AdmissionOpen, AdmissionWalled],
});

/** A suffix measure no configured cube declares — `ensureCube` appends it. */
const APPENDED = 'region_count_distinct';

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
const DOORS = ['/analytics/query', '/analytics/sql'] as const;
type Door = (typeof DOORS)[number];

/**
 * One boot per driver AND door: the registry is process-wide, so a leg on one
 * door would otherwise leave behind — on a regressed build — exactly the entry
 * the same leg on the other door is meant to catch, and read green.
 */
const CASES = DRIVERS.flatMap((driver) => DOORS.map((door) => ({ driver, door })));

interface Boot {
  stack: VerifyStack;
  adminToken: string;
  tokenA: string;
  tokenB: string;
}

interface Observation {
  meta: { status: number; body: unknown; bytes: string };
  authored: { status: number; body: unknown };
}

const boots = new Map<string, Boot>();

async function read(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

/** A response read as its raw bytes too — for the listing whose sameness is the pin. */
async function readBytes(res: Response): Promise<{ status: number; body: unknown; bytes: string }> {
  const bytes = await res.text();
  return { status: res.status, body: JSON.parse(bytes), bytes };
}

/** Everything member B can see of the analytics registry. */
async function observeAsB(stack: VerifyStack, tokenB: string): Promise<Observation> {
  return {
    meta: await readBytes(await stack.apiAs(tokenB, 'GET', '/analytics/meta')),
    authored: await read(
      await stack.apiAs(tokenB, 'POST', '/analytics/query', {
        cube: 'open_summary',
        measures: ['authored_total'],
      }),
    ),
  };
}

/** The listed cubes, whichever envelope the door uses. */
function cubesOf(meta: { body: unknown }): unknown[] {
  const payload = (meta.body as { data?: unknown })?.data ?? meta.body;
  return Array.isArray(payload) ? payload : [];
}

/** The listed cube names. */
function cubeNamesOf(meta: { body: unknown }): string[] {
  return cubesOf(meta).map((c) => (c as { name: string }).name);
}

/** The single count a one-measure answer carries, whichever envelope the door uses. */
function countOf(body: unknown, measure: string): number {
  const payload = (body as { data?: unknown })?.data ?? body;
  const rows = (payload as { rows?: Array<Record<string, unknown>> })?.rows ?? [];
  return rows.reduce((sum, row) => sum + Number(row[measure] ?? 0), 0);
}

/** The ADR-0112 refusal both ad-hoc doors answer for an object the caller may not read. */
async function expectRefused(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { error?: { code?: string; httpStatus?: number } };
  expect(body.error?.code).toBe('PERMISSION_DENIED');
  expect(body.error?.httpStatus).toBe(403);
}

async function bootFor(driver: (typeof DRIVERS)[number], door: Door): Promise<Boot> {
  const stack = await bootStack(adhocStack as never, {
    security: admissionFixtureSecurity(),
    databaseDriver: 'sqlite-wasm',
    analytics: analyticsFor(driver, { cubes: [OPEN_SUMMARY, WALLED_SUMMARY] }),
  });
  const adminToken = await stack.signIn();
  const slug = door.replace(/\W+/g, '-');
  const tokenA = await stack.signUp(`adhoc-a-${driver}${slug}@verify.test`);
  const tokenB = await stack.signUp(`adhoc-b-${driver}${slug}@verify.test`);

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
  return { stack, adminToken, tokenA, tokenB };
}

describe.each(CASES)(
  'dogfood: an ad-hoc analytics query changes nothing another member sees before it is admitted [driver=$driver, door=$door]',
  ({ driver, door }) => {
    const key = `${driver} ${door}`;

    beforeAll(async () => {
      boots.set(key, await bootFor(driver, door));
    }, 120_000);

    afterAll(async () => {
      await boots.get(key)?.stack.stop();
      boots.delete(key);
    });

    it('baseline: B sees the configured cubes, and the open one serves B\'s own rows', async () => {
      const { stack, tokenB } = boots.get(key)!;
      const baseline = await observeAsB(stack, tokenB);
      expect(baseline.meta.status).toBe(200);
      expect(cubesOf(baseline.meta).map((c) => (c as { name: string }).name).sort()).toEqual([
        'open_summary',
        'walled_summary',
      ]);
      expect(baseline.authored.status).toBe(200);
      expect(countOf(baseline.authored.body, 'authored_total')).toBe(B_OPEN_ROWS);
    });

    it('REFUSED: A\'s ad-hoc query over the object A may not read answers 403 PERMISSION_DENIED, and B\'s view is unchanged', async () => {
      const { stack, tokenA, tokenB } = boots.get(key)!;
      const before = await observeAsB(stack, tokenB);

      await expectRefused(await stack.apiAs(tokenA, 'POST', door, { cube: 'admission_walled', measures: ['count'] }));

      expect(await observeAsB(stack, tokenB)).toEqual(before);
    });

    it('REFUSED: A\'s suffix measure on the configured cube over that object answers 403, and B\'s view is unchanged', async () => {
      const { stack, tokenA, tokenB } = boots.get(key)!;
      const before = await observeAsB(stack, tokenB);

      await expectRefused(
        await stack.apiAs(tokenA, 'POST', door, { cube: 'walled_summary', measures: ['walled_total', APPENDED] }),
      );

      expect(await observeAsB(stack, tokenB)).toEqual(before);
    });

    it('ADMITTED: A\'s suffix measure on the configured cube over the open object is served, and B\'s view is unchanged', async () => {
      const { stack, tokenA, tokenB } = boots.get(key)!;
      const before = await observeAsB(stack, tokenB);

      const res = await stack.apiAs(tokenA, 'POST', door, { cube: 'open_summary', measures: ['authored_total', APPENDED] });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Served WITH A's own measure — in the rows on the query door, in the
      // statement on the dry-run door.
      expect(JSON.stringify(body)).toContain(door === '/analytics/query' ? APPENDED : 'region');
      if (door === '/analytics/query') expect(countOf(body, 'authored_total')).toBe(A_OPEN_ROWS);

      expect(await observeAsB(stack, tokenB)).toEqual(before);
    });

    it('CONTROL: an admitted scalar metric over an object is served again on a second request, re-inferred, with the same answer', async () => {
      const { stack, tokenA, tokenB } = boots.get(key)!;
      const before = await observeAsB(stack, tokenB);

      const answers: unknown[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await stack.apiAs(tokenA, 'POST', door, { cube: 'admission_open', measures: ['count'] });
        expect(res.status).toBe(200);
        const body = await res.json();
        if (door === '/analytics/query') expect(countOf(body, 'count')).toBe(A_OPEN_ROWS);
        else expect(JSON.stringify(body)).toContain('admission_open');
        answers.push(body);
        // Between the two, not even the asker's own `meta` lists the name, so
        // the second request cannot resolve it from the registry: it infers.
        if (i === 0) {
          const askersMeta = await read(await stack.apiAs(tokenA, 'GET', '/analytics/meta'));
          expect(cubeNamesOf(askersMeta)).not.toContain('admission_open');
        }
      }
      expect(answers[1]).toEqual(answers[0]);

      const after = await observeAsB(stack, tokenB);
      expect(cubesOf(after.meta)).toEqual(cubesOf(before.meta));
      expect(after).toEqual(before);
    });

    it('CONTROL: the administrator\'s admitted ad-hoc query over the walled object leaves B\'s meta byte-identical', async () => {
      const { stack, adminToken, tokenB } = boots.get(key)!;
      const before = await observeAsB(stack, tokenB);

      const res = await stack.apiAs(adminToken, 'POST', door, { cube: 'admission_walled', measures: ['count'] });
      expect(res.status).toBe(200);

      // B still may not read the object.
      await expectRefused(await stack.apiAs(tokenB, 'POST', door, { cube: 'admission_walled', measures: ['count'] }));
      const after = await observeAsB(stack, tokenB);
      // Stated first on its own, so a failure reads as the defect: B's cube list
      // is EXACTLY what it was — nothing named after the walled object joined it.
      expect(cubeNamesOf(after.meta)).toEqual(cubeNamesOf(before.meta));
      expect(cubesOf(after.meta)).toEqual(cubesOf(before.meta));
      expect(after.meta.bytes).toBe(before.meta.bytes);
      // …and B's query of the configured cube answers as before.
      expect(after.authored).toEqual(before.authored);
      expect(countOf(after.authored.body, 'authored_total')).toBe(B_OPEN_ROWS);
    });
  },
);
