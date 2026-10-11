// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22661] A read that reaches a SECOND object — the record a lookup points at
// — asks that object's own declared exposure (`enable.apiEnabled` /
// `enable.apiMethods`, ADR-0049), through the spec's one decision, on a real
// boot: the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST, auth and
// analytics layers.
//
// ## The reads, and what each must answer
//
// - The data door's `$expand` — the list route, the single-record route, the
//   query route's relation map, a second-level entry, and the export door
//   (which expands every lookup to name it). An entry whose target the
//   decision does not serve for `get` answers as an UNEXPANDED lookup: the
//   stored id, the answer the door already gives for a related record the
//   caller may not read (the precedent leg below).
// - The dataset door's two dimension-label passes. A target the decision does
//   not serve for `get` is not read: the stored id renders, and an `order` on
//   the dimension sorts by it.
//
// ## Armed before anything is believed
//
// The decision's own answer for each target is read off the data door first:
// `GET /data/{target}/{id}` answers 404 for the off switch, 405 for a
// whitelist that does not grant `get`, and 200 for the targets that serve it —
// and the expansion and label of each target must agree with that answer, for
// an administrator and a member alike (the decision takes no caller). The
// served targets are the controls: a door that withheld everything would fail
// them.
//
// Fixtures are synthetic. ⚠️ No test title states a value.
// `@objectstack/metadata-protocol` and `@objectstack/service-analytics`
// resolve through their BUILT output here, so a verdict on a change to either
// is a verdict on its last build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { secondObjectExposureStack, secondObjectExposureSecurity } from './fixtures/second-object-exposure-fixture.js';

const MEMBER_EMAIL = 'sox-member@verify.test';
const SYS = { context: { isSystem: true } } as const;

/** Each source lookup, the object it points at, and the data door's `get` answer for that object. */
const TARGETS = {
  hidden: { object: 'sox_hidden', getStatus: 404 },
  closed: { object: 'sox_closed', getStatus: 405 },
  listonly: { object: 'sox_listonly', getStatus: 405 },
  getonly: { object: 'sox_getonly', getStatus: 200 },
  open: { object: 'sox_open', getStatus: 200 },
} as const;
type Rel = keyof typeof TARGETS;
const WITHHELD: Rel[] = ['hidden', 'closed', 'listonly'];
const SERVED: Rel[] = ['getonly', 'open'];

/** Synthetic display names; each is unique, so finding one in a body means it was served. */
const MARK: Record<Rel | 'private', string> = {
  hidden: 'SOXHIDDEN71',
  closed: 'SOXCLOSED72',
  listonly: 'SOXLISTONLY73',
  getonly: 'SOXGETONLY74',
  open: 'SOXOPEN75',
  private: 'SOXPRIVATE76',
};

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);

describe('[#22661] a second-object read serves only a target whose declared exposure serves it', () => {
  let stack: VerifyStack;
  const token: Record<'admin' | 'member', string> = { admin: '', member: '' };
  /** The stored id each source lookup holds (the same on both source rows, except `hidden`). */
  const ids: Record<string, string> = {};
  let sourceId = '';

  beforeAll(async () => {
    stack = await bootStack(secondObjectExposureStack as never, { security: secondObjectExposureSecurity() });
    token.admin = await stack.signIn();
    token.member = await stack.signUp(MEMBER_EMAIL);
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    // Two hidden rows whose name order is the reverse of their id order, so a
    // sort by the withheld name and a sort by the stored id disagree.
    await ql.insert('sox_hidden', { id: 'soxh_2', name: `A-${MARK.hidden}` }, SYS);
    await ql.insert('sox_hidden', { id: 'soxh_1', name: `Z-${MARK.hidden}` }, SYS);
    ids.hidden = 'soxh_2';
    for (const rel of ['closed', 'listonly', 'getonly', 'private'] as const) {
      const row = await ql.insert(`sox_${rel}`, { name: MARK[rel] }, SYS);
      ids[rel] = String(row.id);
    }
    const open = await ql.insert('sox_open', { name: MARK.open, inner: 'soxh_1' }, SYS);
    ids.open = String(open.id);
    const a = await ql.insert('sox_source', { name: 'src-a', amount: 1, ...ids }, SYS);
    sourceId = String(a.id);
    await ql.insert('sox_source', { name: 'src-b', amount: 2, ...ids, hidden: 'soxh_1' }, SYS);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  for (const persona of ['admin', 'member'] as const) {
    describe(persona, () => {
      it('ARMED — the data door answers each target\'s own get as its declaration says', async () => {
        for (const rel of [...WITHHELD, ...SERVED]) {
          const res = await stack.apiAs(token[persona], 'GET', `/data/${TARGETS[rel].object}/${ids[rel]}`);
          expect(res.status, `${rel}: ${await res.clone().text()}`).toBe(TARGETS[rel].getStatus);
        }
      });

      const spellings: Array<[string, (rel: Rel) => Promise<Row>]> = [
        ['the list route', async (rel) => {
          const res = await stack.apiAs(token[persona], 'GET', `/data/sox_source?$expand=${rel}&$filter=${encodeURIComponent(JSON.stringify({ name: 'src-a' }))}`);
          expect(res.status, await res.clone().text()).toBe(200);
          return rowsOf(await res.json())[0]!;
        }],
        ['the single-record route', async (rel) => {
          const res = await stack.apiAs(token[persona], 'GET', `/data/sox_source/${sourceId}?expand=${rel}`);
          expect(res.status, await res.clone().text()).toBe(200);
          const body: any = await res.json();
          return body.record ?? body;
        }],
        ['the query route relation map', async (rel) => {
          const res = await stack.apiAs(token[persona], 'POST', '/data/sox_source/query', {
            where: { name: 'src-a' },
            expand: { [rel]: { object: rel, fields: ['name'] } },
          });
          expect(res.status, await res.clone().text()).toBe(200);
          return rowsOf(await res.json())[0]!;
        }],
      ];

      for (const [spelling, read] of spellings) {
        it(`$expand on ${spelling}: a withheld target answers as an unexpanded lookup`, async () => {
          for (const rel of WITHHELD) {
            const row = await read(rel);
            expect(row[rel], rel).toBe(ids[rel]);
          }
        });
        it(`CONTROL $expand on ${spelling}: a served target is expanded`, async () => {
          for (const rel of SERVED) {
            const row = await read(rel);
            expect(row[rel]?.name, rel).toBe(MARK[rel]);
          }
        });
      }

      it('$expand second level: the inner entry into the unexposed object is withheld, the outer one served', async () => {
        const res = await stack.apiAs(token[persona], 'POST', '/data/sox_source/query', {
          where: { name: 'src-a' },
          expand: { open: { object: 'open', expand: { inner: { object: 'inner' } } } },
        });
        expect(res.status, await res.clone().text()).toBe(200);
        const row = rowsOf(await res.json())[0]!;
        expect(row.open?.name).toBe(MARK.open);
        expect(row.open?.inner).toBe('soxh_1');
      });

      it('the export door names a served target and not a withheld one', async () => {
        const res = await stack.apiAs(token[persona], 'GET', '/data/sox_source/export?format=json');
        expect(res.status, await res.clone().text()).toBe(200);
        const text = await res.text();
        for (const rel of SERVED) expect(text, rel).toContain(MARK[rel]);
        for (const rel of WITHHELD) expect(text, rel).not.toContain(MARK[rel]);
      });

      const dataset = (rel: Rel) => ({
        name: `sox_by_${rel}`,
        label: `By ${rel}`,
        object: 'sox_source',
        dimensions: [{ name: rel, label: rel, field: rel, type: 'lookup' }],
        measures: [{ name: 'cnt', label: 'Count', aggregate: 'count' }],
      });
      const datasetRows = async (rel: Rel, order?: Record<string, 'asc' | 'desc'>) => {
        const res = await stack.apiAs(token[persona], 'POST', '/analytics/dataset/query', {
          dataset: dataset(rel),
          selection: { dimensions: [rel], measures: ['cnt'], ...(order ? { order } : {}) },
        });
        expect(res.status, await res.clone().text()).toBe(200);
        return ((await res.json()) as { rows?: Row[] }).rows ?? [];
      };

      it('dataset label pass: a withheld target renders its stored id', async () => {
        for (const rel of ['closed', 'listonly'] as const) {
          expect((await datasetRows(rel)).map((r) => r[rel]), rel).toEqual([ids[rel]]);
        }
        expect((await datasetRows('hidden')).map((r) => r.hidden).sort()).toEqual(['soxh_1', 'soxh_2']);
      });

      it('CONTROL dataset label pass: a served target renders its name', async () => {
        for (const rel of SERVED) {
          expect((await datasetRows(rel)).map((r) => r[rel]), rel).toEqual([MARK[rel]]);
        }
      });

      it('dataset sort-key pass: an order on a withheld dimension sorts by the stored id', async () => {
        // By the withheld names this would read soxh_2 (A-…) first.
        expect((await datasetRows('hidden', { hidden: 'asc' })).map((r) => r.hidden)).toEqual(['soxh_1', 'soxh_2']);
      });
    });
  }

  it('PRECEDENT — a related record the member may not read answers as an unexpanded lookup, unchanged', async () => {
    const res = await stack.apiAs(token.member, 'GET', `/data/sox_source/${sourceId}?expand=private`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body: any = await res.json();
    expect((body.record ?? body).private).toBe(ids.private);
  });
});
