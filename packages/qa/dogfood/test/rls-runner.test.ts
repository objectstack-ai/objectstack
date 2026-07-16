// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit proof that the RLS runner's #1994 classification is correct — driven by a
// scripted fake stack so we can exercise the three outcomes deterministically
// (a live owner-isolated fixture to exercise them end-to-end is the next step).
//
// The invariant: a user who CANNOT READ a record must not be able to WRITE it.

import { describe, it, expect } from 'vitest';
import { runRlsProofs } from '@objectstack/verify';
import type { VerifyStack } from '@objectstack/verify';

const CONFIG = {
  manifest: { id: 'fixture' },
  objects: [{ name: 'note', fields: { name: { type: 'text', required: true } } }],
};

/** A fake stack: admin always sees/owns; member behaviour is scripted per scenario. */
function fakeStack(opts: {
  memberCanRead: boolean;
  memberWriteMutates: boolean; // does member's PATCH actually change the row?
}): VerifyStack {
  const store: Record<string, any> = {};
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const apiAs: VerifyStack['apiAs'] = async (token, method, path, body) => {
    const isAdmin = token === 'admin';
    const [, , object, id] = path.split('/'); // /data/<object>/<id>
    if (method === 'POST') {
      const newId = 'rec1';
      store[newId] = { id: newId, ...(body as object) };
      return json({ object, id: newId, record: store[newId] }, 201);
    }
    if (method === 'GET') {
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
