// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit proof that the RLS runner's #1994 classification is correct — driven by a
// scripted fake stack so we can exercise the outcomes deterministically.
//
// The invariant: a user who CANNOT READ a record must not be able to WRITE it.
//
// This is also the runner's DETECTOR-LIVENESS oracle. The live fixture
// (`rls-fixture.dogfood.test.ts`) can no longer plant the hole — #7665 closed
// the class platform-side, so its red block is now a green regression guard —
// and `objectstack verify --rls` reports 0 holes against the real apps. Only a
// scripted stack can still answer "the runner CAN say `rls-hole`", which is what
// keeps every green above from being a runner that lost the ability to fail.
//
// [#7685] The three classifications below are joined by the two the same issue
// added, and both exist because a NOT-PROVEN object used to be indistinguishable
// from a proven one:
//   • `probe-blocked` — the OBJECT gate refused the persona, so record scope was
//     never consulted. On the stock showcase that was 11 of 13 "consistent"
//     verdicts, i.e. green that no platform change could have turned red.
//   • target adoption — an admin create the app's own validation rejects no
//     longer cascades its dependents out of the run.

import { describe, it, expect } from 'vitest';
import { runRlsProofs } from '@objectstack/verify';
import type { VerifyStack } from '@objectstack/verify';

const CONFIG = {
  manifest: { id: 'fixture' },
  objects: [{ name: 'note', fields: { name: { type: 'text', required: true } } }],
};

interface FakeOpts {
  memberCanRead: boolean;
  memberWriteMutates: boolean; // does member's PATCH actually change the row?
  /** The object-level gate refuses the member outright (403 before record scope). */
  objectGateDenies?: boolean;
  /** Status the admin POST answers with (e.g. 400 — the app's own validation). */
  adminCreateStatus?: number;
  /** Rows that already exist on the object, as seed data would. */
  seeded?: Array<Record<string, unknown>>;
}

/** A fake stack: admin always sees/owns; member behaviour is scripted per scenario. */
function fakeStack(opts: FakeOpts): VerifyStack {
  const store: Record<string, any> = {};
  for (const row of opts.seeded ?? []) store[String(row.id)] = { ...row };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const apiAs: VerifyStack['apiAs'] = async (token, method, path, body) => {
    const isAdmin = token === 'admin';
    // `/data/<object>[?query]` (list) or `/data/<object>/<id>` (by id)
    const [, , objectSegment, id] = path.split('/');
    const object = String(objectSegment).split('?')[0];

    // The object-level gate answers first, for every verb — exactly what made
    // the grant-less persona's verdicts meaningless (#7685).
    if (!isAdmin && opts.objectGateDenies) return json({ code: 'PERMISSION_DENIED' }, 403);

    if (method === 'POST') {
      if (opts.adminCreateStatus) return json({ error: 'VALIDATION_FAILED' }, opts.adminCreateStatus);
      const newId = 'rec1';
      store[newId] = { id: newId, ...(body as object) };
      return json({ object, id: newId, record: store[newId] }, 201);
    }
    if (method === 'GET') {
      if (id === undefined) {
        // LIST — the runner's reachability probe, and the admin-side source the
        // cascade-stopper adopts a target from.
        if (!isAdmin && !opts.memberCanRead) return json({ records: [] });
        return json({ records: Object.values(store) });
      }
      if (!isAdmin && !opts.memberCanRead) return json({ error: 'not found' }, 404);
      return json({ object, id, record: store[id] ?? null });
    }
    if (method === 'PATCH') {
      // Admin always writes. Member writes only "land" when the scenario says so
      // (i.e. RLS failed to scope the by-id write — the #1994 bug).
      if (isAdmin || opts.memberWriteMutates) Object.assign(store[id], body as object);
      return json({ object, id, record: store[id] }, isAdmin || opts.memberWriteMutates ? 200 : 403);
    }
    return json({}, 405);
  };

  return {
    apiAs,
    kernel: {} as never,
    api: (async () => new Response()) as never,
    raw: (async () => new Response()) as never,
    signIn: async () => 'admin',
    signUp: async () => 'member',
    stop: async () => {},
  };
}

describe('runRlsProofs #1994 classification', () => {
  it('flags a HOLE when a member who cannot read a record still mutates it by id', async () => {
    const stack = fakeStack({ memberCanRead: false, memberWriteMutates: true });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG);
    expect(report.summary.holes).toBe(1);
    expect(report.results[0].status).toBe('rls-hole');
  });

  it('passes (consistent) when a member who cannot read also cannot mutate', async () => {
    const stack = fakeStack({ memberCanRead: false, memberWriteMutates: false });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG);
    expect(report.summary.holes).toBe(0);
    expect(report.results[0].status).toBe('rls-consistent');
  });

  it('reports member-visible (inconclusive) when the member can read the record', async () => {
    const stack = fakeStack({ memberCanRead: true, memberWriteMutates: true });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG);
    expect(report.summary.holes).toBe(0);
    expect(report.results[0].status).toBe('member-visible');
  });
});

describe('[#7685] a NOT-PROVEN object never reads as a pass', () => {
  it('reports probe-blocked — NOT rls-consistent — when the OBJECT gate refuses the persona', async () => {
    // The exact shape of the old defect: the persona holds no object grants, so
    // the 403 that comes back says nothing about record scope. The runner used
    // to bank it as `rls-consistent`; a platform regression in the by-id write
    // could not have flipped it, which is what made the green worthless.
    const stack = fakeStack({ memberCanRead: false, memberWriteMutates: true, objectGateDenies: true });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG);
    expect(report.results[0].status).toBe('probe-blocked');
    expect(report.summary.consistent).toBe(0);
    expect(report.summary.proven).toBe(0);
    expect(report.summary.unproven).toBe(1);
    expect(report.unproven.map((u) => u.object)).toEqual(['note']);
  });

  it('counts member-visible and skipped as UNPROVEN, separately from holes', async () => {
    const stack = fakeStack({ memberCanRead: true, memberWriteMutates: false });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG);
    expect(report.summary).toMatchObject({
      objects: 1, consistent: 0, holes: 0, memberVisible: 1, probeBlocked: 0, skipped: 0,
      proven: 0, unproven: 1,
    });
  });

  it('carries the probe descriptor through to the report so a run\'s REACH is legible', async () => {
    const stack = fakeStack({ memberCanRead: false, memberWriteMutates: false });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG, {
      probe: { label: 'probe@test', grantedObjects: 1 },
    });
    expect(report.probe).toEqual({ label: 'probe@test', grantedObjects: 1 });
  });
});

describe('[#7685] an unsatisfiable admin create does not cascade objects out of the run', () => {
  it('adopts an existing row when the derived create is rejected, and still probes the object', async () => {
    const stack = fakeStack({
      memberCanRead: false,
      memberWriteMutates: true,
      adminCreateStatus: 400,
      seeded: [{ id: 'seed1', name: 'seeded' }],
    });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG);
    expect(report.results[0].target).toBe('adopted');
    // The point of adopting: the object is PROVEN rather than skipped — and it
    // is the hole here, which a skip would have hidden.
    expect(report.results[0].status).toBe('rls-hole');
    expect(report.summary.skipped).toBe(0);
    expect(report.summary.holes).toBe(1);
  });

  it('still skips — with the create failure in the reason — when there is nothing to adopt', async () => {
    const stack = fakeStack({ memberCanRead: false, memberWriteMutates: false, adminCreateStatus: 400 });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG);
    expect(report.results[0].status).toBe('skipped');
    expect(report.results[0].detail).toContain('admin create failed (400)');
    expect(report.results[0].detail).toContain('no existing note row to adopt');
    expect(report.summary.proven).toBe(0);
  });
});
