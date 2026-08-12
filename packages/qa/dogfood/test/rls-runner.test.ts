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
//
// [#7978] And by the POSITION fan-out, which this file is the liveness oracle
// for in exactly the same sense: the live apps report 0 holes for every position
// persona too, so only a scripted stack can answer "can a position persona still
// SAY `rls-hole`". A fan-out that cannot fail is decoration, and this file is
// what stops it becoming that.

import { describe, it, expect } from 'vitest';
import { runRlsProofs, declaredPositionNames } from '@objectstack/verify';
import type { VerifyStack } from '@objectstack/verify';

const CONFIG = {
  manifest: { id: 'fixture' },
  objects: [{ name: 'note', fields: { name: { type: 'text', required: true } } }],
};

/** [#7978] The same app, declaring one position — the fan-out's input. */
const CONFIG_WITH_POSITION = {
  ...CONFIG,
  positions: [{ name: 'contributor', label: 'Contributor' }],
};

/** How one persona behaves. The member token uses the top-level scenario fields. */
interface PersonaScript {
  canRead: boolean;
  writeMutates: boolean;
  objectGateDenies?: boolean;
}

interface FakeOpts {
  memberCanRead: boolean;
  memberWriteMutates: boolean; // does member's PATCH actually change the row?
  /** The object-level gate refuses the member outright (403 before record scope). */
  objectGateDenies?: boolean;
  /** Status the admin POST answers with (e.g. 400 — the app's own validation). */
  adminCreateStatus?: number;
  /** Rows that already exist on the object, as seed data would. */
  seeded?: Array<Record<string, unknown>>;
  /** [#7978] Per-token scripts — one per position persona. */
  personas?: Record<string, PersonaScript>;
  /** [#7978] Call log, so cost and marker-distinctness are assertable. */
  calls?: { posts: number; patches: Array<{ token: string; value: unknown }> };
}

/** A fake stack: admin always sees/owns; member behaviour is scripted per scenario. */
function fakeStack(opts: FakeOpts): VerifyStack {
  const store: Record<string, any> = {};
  for (const row of opts.seeded ?? []) store[String(row.id)] = { ...row };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const scriptFor = (token: string): PersonaScript =>
    opts.personas?.[token] ?? {
      canRead: opts.memberCanRead,
      writeMutates: opts.memberWriteMutates,
      objectGateDenies: opts.objectGateDenies,
    };

  const apiAs: VerifyStack['apiAs'] = async (token, method, path, body) => {
    const isAdmin = token === 'admin';
    const script = scriptFor(token);
    // `/data/<object>[?query]` (list) or `/data/<object>/<id>` (by id)
    const [, , objectSegment, id] = path.split('/');
    const object = String(objectSegment).split('?')[0];

    // The object-level gate answers first, for every verb — exactly what made
    // the grant-less persona's verdicts meaningless (#7685).
    if (!isAdmin && script.objectGateDenies) return json({ code: 'PERMISSION_DENIED' }, 403);

    if (method === 'POST') {
      if (opts.calls) opts.calls.posts += 1;
      if (opts.adminCreateStatus) return json({ error: 'VALIDATION_FAILED' }, opts.adminCreateStatus);
      const newId = 'rec1';
      store[newId] = { id: newId, ...(body as object) };
      return json({ object, id: newId, record: store[newId] }, 201);
    }
    if (method === 'GET') {
      if (id === undefined) {
        // LIST — the runner's reachability probe, and the admin-side source the
        // cascade-stopper adopts a target from.
        if (!isAdmin && !script.canRead) return json({ records: [] });
        return json({ records: Object.values(store) });
      }
      if (!isAdmin && !script.canRead) return json({ error: 'not found' }, 404);
      return json({ object, id, record: store[id] ?? null });
    }
    if (method === 'PATCH') {
      if (opts.calls && !isAdmin) opts.calls.patches.push({ token, value: (body as any)?.name });
      // Admin always writes. Member writes only "land" when the scenario says so
      // (i.e. RLS failed to scope the by-id write — the #1994 bug).
      if (isAdmin || script.writeMutates) Object.assign(store[id], body as object);
      return json({ object, id, record: store[id] }, isAdmin || script.writeMutates ? 200 : 403);
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

describe('[#7978] declaredPositionNames — the fan-out reads the app, never a list', () => {
  it('derives the position names from the config, in order, deduplicated', () => {
    expect(
      declaredPositionNames({
        positions: [{ name: 'contributor' }, { name: 'manager' }, { name: 'contributor' }],
      }),
    ).toEqual(['contributor', 'manager']);
  });

  it('covers a position added to the app WITHOUT any change here — the point of deriving', () => {
    const tomorrow = { positions: [{ name: 'contributor' }, { name: 'field_ops_delegate' }] };
    expect(declaredPositionNames(tomorrow)).toContain('field_ops_delegate');
  });

  it('excludes the built-in audience anchors and tolerates an app with no positions', () => {
    // No app declares `everyone`/`guest` (ADR-0090 D5/D9): every authenticated
    // member already holds `everyone` — the base persona's own baseline — and
    // `guest` is the anonymous audience no signed-up persona can hold.
    expect(declaredPositionNames({ positions: [{ name: 'everyone' }, { name: 'guest' }, { name: 'ops' }] }))
      .toEqual(['ops']);
    expect(declaredPositionNames({})).toEqual([]);
    expect(declaredPositionNames(undefined)).toEqual([]);
  });
});

describe('[#7978] a POSITION persona can still say `rls-hole` — fan-out detector liveness', () => {
  it('flags a HOLE found by a position persona, and rolls it into `totals` where the CLI reads it', async () => {
    // The base persona is clean; only the persona holding the app's position
    // can see the defect, because only its policies are position-gated. This is
    // the whole class #7978 exists to reach — and the assertion that keeps the
    // fan-out falsifiable rather than decorative.
    const stack = fakeStack({
      memberCanRead: false,
      memberWriteMutates: false,
      personas: { 'tok-contributor': { canRead: false, writeMutates: true } },
    });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG_WITH_POSITION, {
      positionPersonas: [{ position: 'contributor', token: 'tok-contributor', label: 'pos@test' }],
    });

    expect(report.summary.holes).toBe(0); // base persona: consistent
    expect(report.positionRuns).toHaveLength(1);
    expect(report.positionRuns[0].position).toBe('contributor');
    expect(report.positionRuns[0].results[0].status).toBe('rls-hole');
    expect(report.positionRuns[0].summary.holes).toBe(1);
    // `totals` is what `objectstack verify` counts as a hard failure: a hole a
    // position persona found is exactly as real as one the base persona found.
    expect(report.totals.holes).toBe(1);
    expect(report.totals.proven).toBe(2); // base consistent + position hole
    expect(report.positionCoverage).toMatchObject({ declared: ['contributor'], ran: ['contributor'], notRun: [] });
  });

  it('reports probe-blocked — NOT a pass — when the object gate refuses a position persona', async () => {
    // A declared position the app binds no object grants to. Honest: the
    // by-id-write class was not exercised for it, and it must not read as reach.
    const stack = fakeStack({
      memberCanRead: false,
      memberWriteMutates: false,
      personas: { 'tok-finance': { canRead: false, writeMutates: true, objectGateDenies: true } },
    });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG_WITH_POSITION, {
      positionPersonas: [{ position: 'contributor', token: 'tok-finance', label: 'pos@test' }],
    });
    expect(report.positionRuns[0].results[0].status).toBe('probe-blocked');
    expect(report.positionRuns[0].summary).toMatchObject({ consistent: 0, proven: 0, probeBlocked: 1, unproven: 1 });
    expect(report.positionRuns[0].unproven.map((u) => u.object)).toEqual(['note']);
    expect(report.totals.holes).toBe(0);
    expect(report.totals.proven).toBe(1); // the base persona's verdict, and only that
  });

  it('gives each persona a DISTINCT marker and creates the probe target only once', async () => {
    // Two properties in one run. Shared targets are what keeps the fan-out
    // affordable (one admin create for N personas, not N). Distinct markers are
    // what keeps it correct: with one shared marker, persona 2's refused write
    // would re-read persona 1's successful mutation as its own — a fabricated
    // hole on a platform that is behaving.
    const calls = { posts: 0, patches: [] as Array<{ token: string; value: unknown }> };
    const stack = fakeStack({
      memberCanRead: false,
      memberWriteMutates: false,
      calls,
      personas: {
        'tok-a': { canRead: false, writeMutates: true },
        'tok-b': { canRead: false, writeMutates: false },
      },
    });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG_WITH_POSITION, {
      positionPersonas: [
        { position: 'contributor', token: 'tok-a', label: 'a@test' },
        { position: 'manager', token: 'tok-b', label: 'b@test' },
      ],
    });

    expect(calls.posts).toBe(1);
    const markers = calls.patches.map((p) => p.value);
    expect(new Set(markers).size).toBe(markers.length);
    // `tok-b` writes after `tok-a` mutated the row, and is still judged correctly.
    expect(report.positionRuns[0].results[0].status).toBe('rls-hole');
    expect(report.positionRuns[1].results[0].status).toBe('rls-consistent');
  });
});

describe('[#7978] a position that produced no verdict never reads as a pass', () => {
  it('says so distinctly when the app declares NO positions — and adds nothing to `proven`', async () => {
    const stack = fakeStack({ memberCanRead: false, memberWriteMutates: false });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG);
    expect(report.positionRuns).toEqual([]);
    expect(report.positionCoverage.declared).toEqual([]);
    expect(report.positionCoverage.note).toMatch(/no position personas to run/);
    // No silent contribution: the totals are exactly the base persona's.
    expect(report.totals).toEqual(report.summary);
  });

  it('records a declared position whose persona could not be provisioned, with the reason', async () => {
    const stack = fakeStack({ memberCanRead: false, memberWriteMutates: false });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG_WITH_POSITION, {
      positionFailures: [{ position: 'contributor', error: 'no sys_user row for pos@test' }],
    });
    expect(report.positionRuns).toEqual([]);
    expect(report.positionCoverage.notRun).toEqual([
      { position: 'contributor', reason: 'no sys_user row for pos@test' },
    ]);
    // No `note` here: the app DOES declare positions, so "none ran" is a gap,
    // not the app-declares-nothing case.
    expect(report.positionCoverage.note).toBeUndefined();
  });

  it('reports a declared position the caller simply never provisioned a persona for', async () => {
    const stack = fakeStack({ memberCanRead: false, memberWriteMutates: false });
    const report = await runRlsProofs(stack, 'admin', 'member', CONFIG_WITH_POSITION);
    expect(report.positionCoverage.notRun).toHaveLength(1);
    expect(report.positionCoverage.notRun[0]).toMatchObject({ position: 'contributor' });
    expect(report.positionCoverage.notRun[0].reason).toMatch(/NOT exercised/);
  });
});
