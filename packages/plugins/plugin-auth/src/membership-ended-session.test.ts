// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#15784] The membership-ended session trigger, branch by branch.
//
// The END-TO-END proof lives in `qa/dogfood/membership-ended-session-revoke`,
// driven through better-auth's own `/organization/remove-member` — a seam that
// works when called directly proves nothing about whether the route crosses it
// (#3106). What this file covers is the half a route test cannot reach
// cheaply: the decision table, the shapes that must be NO-OPS, the bounded
// scan, and the two failure paths, which must degrade loudly and never throw.

import { describe, it, expect, vi } from 'vitest';
import {
  MEMBERSHIP_ENDED_REVOKE_REASON,
  endSessionClaimsForEndedMembership,
  registerMembershipEndedSessionTrigger,
  type MembershipEndedSessionEngine,
} from './membership-ended-session';

const ORG_A = 'org_a';
const ORG_B = 'org_b';
const USER = 'user_1';

type Row = Record<string, any>;

/**
 * The WHERE matcher, at MODULE scope and pure, so both conformance gates can
 * lift it and judge it — a matcher that closes over its fixtures is unjudgeable,
 * which is a worse answer than a wrong one.
 *
 * It honours only equality on a field name, which is every predicate this module
 * issues, and REFUSES everything else loudly. A double that reads a combinator
 * as a field name answers a question nobody asked, silently.
 */
function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key.startsWith('$') || key === 'and' || key === 'or' || key === 'not') {
      throw new Error(`engineDouble: unsupported WHERE combinator '${key}' — implement it or stop issuing it`);
    }
    if (value !== null && typeof value === 'object') {
      throw new Error(`engineDouble: unsupported operator object on '${key}' — implement it or stop issuing it`);
    }
    if (String(row[key] ?? '') !== String(value ?? '')) return false;
  }
  return true;
}

/**
 * A find/update double over two tables.
 *
 * Deliberately no more forgiving than the real engine in the two places a
 * forgiving fake would hide the very logic under test: it REFUSES a `where`
 * shape it does not implement, and it APPLIES the caller's `limit` — by
 * presence, so `limit: 0` returns nothing, and after the filter, so a bound
 * never returns rows the predicate excluded. The scan-ceiling test below is
 * measuring exactly that bound.
 *
 * Failure injection is done by REPLACING a method on the returned object, never
 * by a flag inside one: a flag read makes the method unliftable, and an
 * unjudgeable double is how a fake stops being held to anything.
 */
function engineDouble(members: Row[], sessions: Row[]) {
  const updates: Row[] = [];
  const tables: Record<string, Row[]> = { sys_member: members, sys_session: sessions };
  const engine: MembershipEndedSessionEngine & { updates: Row[] } = {
    updates,
    async find(object: string, query: any) {
      const rows = tables[object] ?? [];
      const matched = rows.filter((r) => matchesWhere(r, query?.where ?? {}));
      return typeof query?.limit === 'number' ? matched.slice(0, query.limit) : matched;
    },
    async update(object: string, data: any) {
      updates.push({ object, ...data });
      const rows = tables[object] ?? [];
      const row = rows.find((r) => String(r.id) === String(data.id));
      if (row) Object.assign(row, data);
      return row;
    },
    registerHook() { /* not used by the direct-call tests */ },
  };
  return engine;
}

/** The read half refuses — a driver this call cannot reach. */
function withFailingFind(engine: ReturnType<typeof engineDouble>) {
  engine.find = async () => { throw new Error('driver unreachable'); };
  return engine;
}

/** The write half refuses — the row is readable and not writable. */
function withFailingUpdate(engine: ReturnType<typeof engineDouble>) {
  engine.update = async () => { throw new Error('write refused'); };
  return engine;
}

const liveSession = (id: string, org: string | null): Row => ({
  id, user_id: USER, active_organization_id: org, expires_at: new Date(Date.now() + 86_400_000), revoked_at: null,
});

describe('#15784 endSessionClaimsForEndedMembership — the ruled decision table (option B)', () => {
  it('NO remaining membership: the session is REVOKED through the existing mechanism', async () => {
    const engine = engineDouble([], [liveSession('s1', ORG_A)]);
    const out = await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A });

    expect(out).toEqual([{ action: 'revoked', sessionId: 's1', from: ORG_A }]);
    const write = engine.updates.at(-1)!;
    expect(write.object).toBe('sys_session');
    expect(write.revoke_reason).toBe(MEMBERSHIP_ENDED_REVOKE_REASON);
    expect(write.revoked_at).toBeInstanceOf(Date);
    // Expired IN PLACE and strictly in the past, so every `expiresAt < now`
    // liveness check in better-auth is true even at millisecond resolution.
    expect((write.expires_at as Date).getTime()).toBeLessThan(Date.now());
    // ⛔ Not a delete: the tombstone is the audit record.
    expect(engine.updates.every((u) => u.object === 'sys_session')).toBe(true);
  });

  it('ANOTHER membership remains: the claim is RE-POINTED and the session is NOT revoked', async () => {
    const engine = engineDouble(
      [{ id: 'm2', user_id: USER, organization_id: ORG_B, created_at: '2026-01-01T00:00:00Z' }],
      [liveSession('s1', ORG_A)],
    );
    const out = await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A });

    expect(out).toEqual([{ action: 'repointed', sessionId: 's1', from: ORG_A, to: ORG_B }]);
    const write = engine.updates.at(-1)!;
    expect(write.active_organization_id).toBe(ORG_B);
    // ⛔ Option A's shape, explicitly refused by the ruling: nothing about the
    // revocation columns is written for a person who still belongs somewhere.
    expect('revoked_at' in write).toBe(false);
    expect('revoke_reason' in write).toBe(false);
    expect('expires_at' in write).toBe(false);
  });

  it('the re-point target is the OLDEST remaining membership, so it is deterministic', async () => {
    const engine = engineDouble(
      [
        { id: 'm3', user_id: USER, organization_id: 'org_new', created_at: '2026-06-01T00:00:00Z' },
        { id: 'm2', user_id: USER, organization_id: ORG_B, created_at: '2026-01-01T00:00:00Z' },
      ],
      [liveSession('s1', ORG_A)],
    );
    await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A });
    expect(engine.updates.at(-1)!.active_organization_id).toBe(ORG_B);
  });

  it('memberships remain but none carries an organization id: the claim is CLEARED, not revoked', async () => {
    // Single-org mode — `sys_member.organization_id` is null there. The ruling's
    // "cleared, or re-pointed": they still hold a membership, so they keep the
    // session.
    const engine = engineDouble(
      [{ id: 'm2', user_id: USER, organization_id: null, created_at: '2026-01-01T00:00:00Z' }],
      [liveSession('s1', ORG_A)],
    );
    const out = await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A });
    expect(out).toEqual([{ action: 'repointed', sessionId: 's1', from: ORG_A, to: null }]);
    expect(engine.updates.at(-1)!.active_organization_id).toBeNull();
  });
});

describe('#15784 the shapes that must be NO-OPS — acting on the claim, never on the user', () => {
  it('a session claiming a DIFFERENT organization is untouched', async () => {
    const engine = engineDouble([], [liveSession('s_other', ORG_B)]);
    const out = await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A });
    expect(out).toEqual([]);
    expect(engine.updates).toEqual([]);
  });

  it('an ALREADY-revoked session is not re-stamped, so it keeps the revocation it records', async () => {
    const engine = engineDouble([], [{
      id: 's_dead', user_id: USER, active_organization_id: ORG_A,
      expires_at: new Date(Date.now() - 1000), revoked_at: new Date('2026-01-01T00:00:00Z'),
    }]);
    const out = await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A });
    expect(out).toEqual([]);
    expect(engine.updates).toEqual([]);
  });

  it('an already-EXPIRED session is not touched either', async () => {
    const engine = engineDouble([], [{
      id: 's_old', user_id: USER, active_organization_id: ORG_A,
      expires_at: new Date(Date.now() - 60_000), revoked_at: null,
    }]);
    expect(await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A })).toEqual([]);
  });

  it('a membership ending with no user id does nothing at all', async () => {
    const engine = engineDouble([], [liveSession('s1', ORG_A)]);
    expect(await endSessionClaimsForEndedMembership(engine, { userId: '', organizationId: ORG_A })).toEqual([]);
    expect(engine.updates).toEqual([]);
  });
});

describe('#15784 degradation — best-effort, and never silent', () => {
  it('a refused session WRITE is reported, names the #15409 backstop, and does not throw', async () => {
    const warn = vi.fn();
    const engine = withFailingUpdate(engineDouble([], [liveSession('s1', ORG_A)]));
    const out = await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A }, { logger: { warn } });

    expect(out).toEqual([{ action: 'failed', sessionId: 's1', intended: 'revoked' }]);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0];
    // The operator has to learn BOTH halves: what did not happen, and that it
    // is not an access exposure — otherwise this reads as a security incident.
    expect(message).toContain('NOT revoked');
    expect(message).toContain('per-request membership check');
    expect(message).toContain('Remedy');
  });

  it('a failed READ is reported once and swallowed — a member removal must not 500 on this', async () => {
    const warn = vi.fn();
    const engine = withFailingFind(engineDouble([], [liveSession('s1', ORG_A)]));
    const out = await endSessionClaimsForEndedMembership(engine, { userId: USER, organizationId: ORG_A }, { logger: { warn } });

    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('did not run to completion');
  });

  it('more sessions than the scan ceiling is reported, and the ones in reach are still handled', async () => {
    const warn = vi.fn();
    const sessions = Array.from({ length: 4 }, (_, i) => liveSession(`s${i}`, ORG_A));
    const engine = engineDouble([], sessions);
    const out = await endSessionClaimsForEndedMembership(
      engine, { userId: USER, organizationId: ORG_A }, { logger: { warn }, maxSessionScan: 2 },
    );
    expect(out).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('more sessions than the sweep considers');
  });
});

describe('#15784 registration — which writes the trigger listens for', () => {
  function recordingEngine() {
    const hooks: Array<{ event: string; handler: (ctx: any) => any; options: any }> = [];
    const engine: any = {
      hooks,
      find: async () => [],
      update: async () => undefined,
      registerHook(event: string, handler: any, options: any) { hooks.push({ event, handler, options }); },
      unregisterHooksByPackage: vi.fn(),
    };
    return engine;
  }

  it('binds afterDelete and afterUpdate on sys_member — and nothing on sys_session', () => {
    const engine = recordingEngine();
    registerMembershipEndedSessionTrigger(engine, { packageId: 'p' });
    expect(engine.hooks.map((h: any) => `${h.event}:${h.options.object}`)).toEqual([
      'afterDelete:sys_member',
      'afterUpdate:sys_member',
    ]);
    // AFTER hooks on purpose: a removal `last-admin-guard` refuses at
    // `beforeDelete` must not have its sessions touched.
    expect(engine.hooks.every((h: any) => h.event.startsWith('after'))).toBe(true);
    expect(engine.unregisterHooksByPackage).toHaveBeenCalledWith('p');
  });

  it('a ROLE change is not a membership ending — the update hook ignores it', async () => {
    const engine = recordingEngine();
    const seen: any[] = [];
    engine.find = async (object: string) => { seen.push(object); return []; };
    registerMembershipEndedSessionTrigger(engine, { packageId: 'p' });
    const onUpdate = engine.hooks.find((h: any) => h.event === 'afterUpdate')!.handler;

    await onUpdate({
      object: 'sys_member',
      input: { id: 'm1', data: { role: 'admin' } },
      previous: { user_id: USER, organization_id: ORG_A, role: 'member' },
    });
    // Not one read was issued: the person is still in the room.
    expect(seen).toEqual([]);
  });

  it('an organization RE-POINT is a membership ending in the organization it left', async () => {
    const engine = recordingEngine();
    const queried: any[] = [];
    engine.find = async (object: string, query: any) => { queried.push({ object, query }); return []; };
    registerMembershipEndedSessionTrigger(engine, { packageId: 'p' });
    const onUpdate = engine.hooks.find((h: any) => h.event === 'afterUpdate')!.handler;

    await onUpdate({
      object: 'sys_member',
      input: { id: 'm1', data: { organization_id: ORG_B } },
      previous: { user_id: USER, organization_id: ORG_A },
    });
    expect(queried.length).toBeGreaterThan(0);
    expect(queried[0].query.where).toEqual({ user_id: USER });
  });

  it('a delete reads WHO and WHERE from `previous` — a delete carries no payload', async () => {
    const engine = recordingEngine();
    const queried: any[] = [];
    engine.find = async (object: string, query: any) => { queried.push({ object, query }); return []; };
    registerMembershipEndedSessionTrigger(engine, { packageId: 'p' });
    const onDelete = engine.hooks.find((h: any) => h.event === 'afterDelete')!.handler;

    await onDelete({ object: 'sys_member', input: { id: 'm1' }, previous: { user_id: USER, organization_id: ORG_A } });
    expect(queried[0]).toEqual({ object: 'sys_member', query: expect.objectContaining({ where: { user_id: USER } }) });

    // No `previous` (a driver-level write the engine never saw a pre-image for)
    // is a no-op, not a crash.
    queried.length = 0;
    await onDelete({ object: 'sys_member', input: { id: 'm2' } });
    expect(queried).toEqual([]);
  });
});
