// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22739] An import cell matched against a lookup TARGET asks that target's
// declared exposure first (`enable.apiEnabled` / `enable.apiMethods`, the
// spec's one decision, for `list`), on a real boot: the real SecurityPlugin,
// ObjectQL, SQL driver and REST layers, over the #22661 fixture.
//
// A target the decision does not serve answers every cell, naming a record or
// not, as `reference_not_found`: the answer a target the caller cannot read
// already gets (the precedent leg). Both doors — the synchronous
// `POST /data/:object/import` and the async `/import/jobs` — and both personas.
//
// ## Armed before anything is believed
//
// Each target's own `list` is read off the data door first (404 for the off
// switch, 405 for a whitelist without `list`, 200 otherwise), and the served
// targets are the controls: a door that refused every target fails them.
//
// Fixtures are synthetic. `@objectstack/core` (the import runner) resolves
// through its BUILT output here, so a verdict on a change to it is a verdict
// on its last build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { secondObjectExposureStack, soxMemberSet } from './fixtures/second-object-exposure-fixture.js';

const SYS = { context: { isSystem: true } } as const;
/** Each source lookup and the data door's `list` answer for the object it points at. */
const LIST_STATUS = { hidden: 404, closed: 405, getonly: 405, listonly: 200, open: 200 } as const;
type Rel = keyof typeof LIST_STATUS;
const WITHHELD: Rel[] = ['hidden', 'closed', 'getonly'];
const SERVED: Rel[] = ['listonly', 'open'];
const MARK = (rel: string) => `IMPX-${rel.toUpperCase()}-81`;
const NOT_FOUND = (rel: string) => ({ ok: false, code: 'reference_not_found', field: rel });

/** The #22661 member, plus a read on its own import jobs so the async door's report can be read back. */
const member = PermissionSetSchema.parse({
  ...soxMemberSet,
  name: 'impx_fixture_member',
  objects: { ...soxMemberSet.objects, sys_import_job: { allowRead: true } },
});

type Row = { ok: boolean; code?: string; field?: string; id?: string };

describe('[#22739] an import matches a lookup cell only against a target whose declared exposure serves list', () => {
  let stack: VerifyStack;
  const token: Record<'admin' | 'member', string> = { admin: '', member: '' };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    stack = await bootStack(secondObjectExposureStack as never, {
      security: new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, member], fallbackPermissionSet: member.name }),
    });
    token.admin = await stack.signIn();
    token.member = await stack.signUp('impx-member@verify.test');
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    for (const rel of [...WITHHELD, ...SERVED, 'private']) {
      ids[rel] = String((await ql.insert(`sox_${rel}`, { name: MARK(rel) }, SYS)).id);
    }
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  /** A cell naming the target's record, then a cell naming none, per target. */
  const rowsFor = (rels: readonly string[], tag: string) =>
    rels.flatMap((rel) => [{ name: `${tag}-${rel}-m`, [rel]: MARK(rel) }, { name: `${tag}-${rel}-x`, [rel]: `IMPX-NONE-${rel}` }]);

  const doors = {
    sync: async (who: string, rows: object[]): Promise<Row[]> => {
      const res = await stack.apiAs(who, 'POST', '/data/sox_source/import', { format: 'json', rows, runAutomations: false });
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { results: Row[] }).results;
    },
    jobs: async (who: string, rows: object[]): Promise<Row[]> => {
      const res = await stack.apiAs(who, 'POST', '/data/sox_source/import/jobs', { format: 'json', rows, runAutomations: false });
      expect(res.status, await res.clone().text()).toBe(201);
      const { jobId } = (await res.json()) as { jobId: string };
      for (let i = 0; i < 200; i++) {
        const body: any = await (await stack.apiAs(who, 'GET', `/data/import/jobs/${jobId}/results`)).json();
        if (body.status === 'succeeded') return body.results;
        expect(['pending', 'running'], JSON.stringify(body)).toContain(body.status);
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`import job ${jobId} did not finish`);
    },
  };

  for (const persona of ['admin', 'member'] as const) {
    describe(persona, () => {
      it("ARMED — the data door answers each target's own list as its declaration says", async () => {
        for (const rel of [...WITHHELD, ...SERVED]) {
          const res = await stack.apiAs(token[persona], 'GET', `/data/sox_${rel}?name=${MARK(rel)}`);
          expect(res.status, rel).toBe(LIST_STATUS[rel]);
        }
      });

      for (const door of ['sync', 'jobs'] as const) {
        it(`${door}: a withheld target answers a cell naming its record as one naming none`, async () => {
          const results = await doors[door](token[persona], rowsFor(WITHHELD, `${persona}-${door}`));
          const want = WITHHELD.flatMap((rel) => [NOT_FOUND(rel), NOT_FOUND(rel)]);
          expect(results.map(({ ok, code, field }) => ({ ok, code, field }))).toEqual(want);
        });

        it(`CONTROL ${door}: a served target stores the matched id and misses a miss`, async () => {
          const results = await doors[door](token[persona], rowsFor(SERVED, `${persona}-${door}-c`));
          const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
          for (const [i, rel] of SERVED.entries()) {
            const [hit, miss] = [results[2 * i]!, results[2 * i + 1]!];
            expect(hit.ok, JSON.stringify(hit)).toBe(true);
            expect((await ql.find('sox_source', { where: { id: hit.id }, ...SYS }))[0]?.[rel], rel).toBe(ids[rel]);
            expect({ ok: miss.ok, code: miss.code, field: miss.field }).toEqual(NOT_FOUND(rel));
          }
        });
      }
    });
  }

  it('PRECEDENT — a target the member may not read answers a cell naming its record as one naming none, unchanged', async () => {
    const results = await doors.sync(token.member, rowsFor(['private'], 'precedent'));
    expect(results.map(({ ok, code, field }) => ({ ok, code, field }))).toEqual([NOT_FOUND('private'), NOT_FOUND('private')]);
  });
});
