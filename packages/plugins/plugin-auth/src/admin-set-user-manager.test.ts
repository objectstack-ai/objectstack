// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /api/v1/auth/admin/set-user-manager` (#16678).
 *
 * Two things this suite is built to prove, in order:
 *
 *  1. **The hole is closed, and closed the way the ruling says.** The column
 *     becomes writable through a product surface, and it does so under a
 *     SYSTEM context — so the ADR-0092 Tier-1 whitelist is asserted UNMOVED
 *     here as part of the fix, not merely left alone. A future change that
 *     "fixes" this by admitting `manager_id` to Tier 1 reds this file.
 *  2. **Every refusal refuses, and refuses without writing.** Each refusal
 *     case asserts the ADR-0112 envelope (`error.code` + HTTP status + the
 *     `details.reason` discriminator) AND that the engine's `update` was
 *     never called. A bare status assertion is not a pin: "still 400" is what
 *     a handler that refuses everything also looks like, which is why the
 *     admissions below sit in the same file.
 *
 * The engine double pins its `update` to the real dispatch contract
 * (`assertEngineUpdateDispatch`), so a handler that learned to write by
 * predicate could not pass here while failing against `ObjectQL.update`.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import {
  runSetUserManager,
  MAX_MANAGER_CHAIN_DEPTH,
  type SetUserManagerDeps,
  type SetUserManagerEngine,
} from './admin-set-user-manager';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields';
import type { AdminActor } from './admin-user-endpoints';

const ACTOR: AdminActor = { id: 'usr_admin', email: 'admin@example.com' };

type Row = Record<string, unknown>;

interface Recorded {
  object: string;
  data: Row;
  options: Record<string, unknown> | undefined;
}

/**
 * Equality on a field name — every predicate this module issues — and a LOUD
 * refusal of everything else. A double that reads a combinator as a field name
 * answers a question nobody asked, silently, and keeps the suite green while
 * the real engine returns something else entirely.
 *
 * Lifted to module scope rather than closed over the fixtures on purpose: a
 * matcher that closes over its own rows is unjudgeable by
 * `check:where-matcher`, which is a worse answer than a wrong one.
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

function makeEngine(tables: Record<string, Row[]>) {
  const updates: Recorded[] = [];
  const failReads = new Set<string>();
  const engine: SetUserManagerEngine & {
    updates: Recorded[];
    failReadsOn(object: string): void;
  } = {
    updates,
    failReadsOn(object: string) {
      failReads.add(object);
    },
    async find(object: string, query?: unknown): Promise<unknown[]> {
      if (failReads.has(object)) throw new Error(`read of ${object} failed`);
      const q = (query ?? {}) as { where?: Record<string, unknown>; limit?: number };
      const rows = tables[object] ?? [];
      const where = q.where ?? {};
      const out = rows.filter((r) => matchesWhere(r, where));
      return typeof q.limit === 'number' ? out.slice(0, q.limit) : out;
    },
    async update(object: string, data: unknown, options?: unknown): Promise<unknown> {
      // The real engine's three-way dispatch — a double looser than this is
      // no double at all.
      assertEngineUpdateDispatch(data as Row, options as Record<string, unknown> | undefined);
      updates.push({
        object,
        data: data as Row,
        options: options as Record<string, unknown> | undefined,
      });
      const row = (tables[object] ?? []).find((r) => r.id === (data as Row).id);
      if (row) Object.assign(row, data as Row);
      return row ?? null;
    },
  };
  return engine;
}

function deps(engine: SetUserManagerEngine | undefined, warns: unknown[][] = []): SetUserManagerDeps {
  return {
    getDataEngine: () => engine,
    logger: { warn: (msg, meta) => void warns.push([msg, meta]) },
  };
}

const post = (body: unknown): Request =>
  new Request('http://local/api/v1/auth/admin/set-user-manager', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A simple two-person org with no tenancy facts recorded. */
const twoUsers = () => ({
  sys_user: [
    { id: 'u_report', manager_id: null, source: 'env_native' },
    { id: 'u_boss', manager_id: null, source: 'env_native' },
  ] as Row[],
});

describe('set-user-manager — the write surface the column never had (#16678)', () => {
  it('the column had no product write surface, and the fix does NOT change that fact for Tier 1', () => {
    // ⛔ The load-bearing half of the design: `manager_id` is reachable by
    // CONTEXT, never by whitelist. ADR-0092 D5's amendment made Tier-1
    // membership imply SELF-editability, so admitting the column here would
    // hand every member their own first-rung approver and a widening of their
    // own `own_and_reports` read scope. ADR-0092 D4 depends on it too.
    expect([...SYS_USER_PROFILE_EDIT_FIELDS].sort()).toEqual(['image', 'locale', 'name']);
    expect(SYS_USER_PROFILE_EDIT_FIELDS).not.toContain('manager_id');
  });

  it('SETS the manager, under a system context, attributed to the admin', async () => {
    const engine = makeEngine(twoUsers());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_report', managerId: 'u_boss' }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ userId: 'u_report', managerId: 'u_boss', setBy: 'usr_admin' });

    // The preservation half: what the engine actually received.
    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0].object).toBe('sys_user');
    expect(engine.updates[0].data).toEqual({ id: 'u_report', manager_id: 'u_boss' });
    // `isSystem: true` is what carries this past the ADR-0092 identity write
    // guard (`isUserContextWrite` is `Boolean(userId) && isSystem !== true`).
    expect((engine.updates[0].options as { context?: { isSystem?: boolean } })?.context?.isSystem).toBe(true);
  });

  it('CLEARS the manager on an explicit null', async () => {
    const engine = makeEngine({
      sys_user: [
        { id: 'u_report', manager_id: 'u_boss', source: 'env_native' },
        { id: 'u_boss', manager_id: null, source: 'env_native' },
      ],
    });
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_report', managerId: null }));

    expect(res.status).toBe(200);
    expect(engine.updates[0].data).toEqual({ id: 'u_report', manager_id: null });
  });

  it('accepts the snake_case spellings the sibling ObjectStack mounts also read', async () => {
    const engine = makeEngine(twoUsers());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ user_id: 'u_report', manager_id: 'u_boss' }));
    expect(res.status).toBe(200);
    expect(engine.updates[0].data).toEqual({ id: 'u_report', manager_id: 'u_boss' });
  });

  it('an ABSENT managerId is refused, never read as a clear', async () => {
    // A payload that misspells the key must not silently unset an org chart.
    const engine = makeEngine(twoUsers());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_report', managerID: 'u_boss' }));

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(res.body.error?.details?.reason).toBe('invalid_body');
    expect(engine.updates).toEqual([]);
  });

  it.each([
    ['no userId', { managerId: 'u_boss' }],
    ['empty userId', { userId: '', managerId: 'u_boss' }],
    ['non-string managerId', { userId: 'u_report', managerId: 42 }],
    ['empty managerId', { userId: 'u_report', managerId: '' }],
  ])('refuses a malformed body: %s', async (_label, body) => {
    const engine = makeEngine(twoUsers());
    const res = await runSetUserManager(deps(engine), ACTOR, post(body));

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REQUEST');
    expect(res.body.error?.details?.reason).toBe('invalid_body');
    expect(engine.updates).toEqual([]);
  });

  it('refuses when no data engine is wired — loudly, not as a silent success', async () => {
    const res = await runSetUserManager(deps(undefined), ACTOR, post({ userId: 'u_report', managerId: 'u_boss' }));
    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error?.details?.reason).toBe('engine_unavailable');
  });

  it('refuses an unknown target user', async () => {
    const engine = makeEngine(twoUsers());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_ghost', managerId: 'u_boss' }));

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('RESOURCE_NOT_FOUND');
    expect(res.body.error?.details?.reason).toBe('user_not_found');
    expect(engine.updates).toEqual([]);
  });

  it('refuses an unknown proposed manager', async () => {
    const engine = makeEngine(twoUsers());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_report', managerId: 'u_ghost' }));

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REFERENCE');
    expect(res.body.error?.details?.reason).toBe('manager_not_found');
    expect(engine.updates).toEqual([]);
  });
});

describe('set-user-manager — refusal 1: self-assignment', () => {
  it('refuses a user as their own manager, and says why', async () => {
    const engine = makeEngine(twoUsers());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_report', managerId: 'u_report' }));

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_FIELD');
    expect(res.body.error?.details?.reason).toBe('self_assignment');
    // The reason is the whole point of the tier and is stated to the operator.
    expect(res.body.error?.message).toContain('cannot be their own manager');
    expect(engine.updates).toEqual([]);
  });

  it('the refusal is about the TARGET, not about the admin editing himself', async () => {
    // An admin setting his OWN manager to someone else is a legitimate write:
    // the refusal is `userId === managerId`, never `userId === actor.id`.
    const engine = makeEngine({
      sys_user: [
        { id: 'usr_admin', manager_id: null, source: 'env_native' },
        { id: 'u_boss', manager_id: null, source: 'env_native' },
      ],
    });
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'usr_admin', managerId: 'u_boss' }));
    expect(res.status).toBe(200);
  });
});

describe('set-user-manager — refusal 2: cycle, enforced AT THE WRITE', () => {
  // Nothing downstream catches this: `ApprovalService.lookupManager` and
  // `TeamGraphService.managerOf` each read ONE row, and the multi-hop
  // resolver ships outside this repo. A loop admitted here is admitted
  // permanently.

  it('refuses the two-hop loop (A -> B, then B -> A)', async () => {
    const engine = makeEngine({
      sys_user: [
        { id: 'a', manager_id: 'b', source: 'env_native' },
        { id: 'b', manager_id: null, source: 'env_native' },
      ],
    });
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'b', managerId: 'a' }));

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('RESOURCE_CONFLICT');
    expect(res.body.error?.details?.reason).toBe('cycle');
    expect(engine.updates).toEqual([]);
  });

  it('refuses a loop closed several hops up (A -> B -> C, then C -> A)', async () => {
    const engine = makeEngine({
      sys_user: [
        { id: 'a', manager_id: 'b', source: 'env_native' },
        { id: 'b', manager_id: 'c', source: 'env_native' },
        { id: 'c', manager_id: null, source: 'env_native' },
      ],
    });
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'c', managerId: 'a' }));

    expect(res.status).toBe(409);
    expect(res.body.error?.details?.reason).toBe('cycle');
    expect(engine.updates).toEqual([]);
  });

  it('ADMITS a diamond — two reports under one manager is not a cycle', async () => {
    // The discriminating control: the walk must refuse loops, not every
    // chain that reaches a shared ancestor.
    const engine = makeEngine({
      sys_user: [
        { id: 'a', manager_id: 'top', source: 'env_native' },
        { id: 'b', manager_id: null, source: 'env_native' },
        { id: 'top', manager_id: null, source: 'env_native' },
      ],
    });
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'b', managerId: 'top' }));
    expect(res.status).toBe(200);
    expect(engine.updates).toHaveLength(1);
  });

  it('terminates on a loop that ALREADY exists above the proposed manager', async () => {
    // The walk carries its own `seen` set, so pre-existing corruption is
    // reported as the data defect it is instead of hanging the request.
    const engine = makeEngine({
      sys_user: [
        { id: 'x', manager_id: null, source: 'env_native' },
        { id: 'p', manager_id: 'q', source: 'env_native' },
        { id: 'q', manager_id: 'p', source: 'env_native' },
      ],
    });
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'x', managerId: 'p' }));

    expect(res.status).toBe(409);
    expect(res.body.error?.details?.reason).toBe('cycle');
    expect(res.body.error?.message).toContain('already contains a loop');
    expect(engine.updates).toEqual([]);
  });
});

describe('set-user-manager — refusal 3: depth', () => {
  /** A straight chain `c0 -> c1 -> ... -> c{n-1}`, plus a free-standing `leaf`. */
  const chain = (n: number) => ({
    sys_user: [
      { id: 'leaf', manager_id: null, source: 'env_native' },
      ...Array.from({ length: n }, (_, i) => ({
        id: `c${i}`,
        manager_id: i + 1 < n ? `c${i + 1}` : null,
        source: 'env_native',
      })),
    ] as Row[],
  });

  // `chain(n)` holds n-1 links among `c0..c{n-1}`, so attaching `leaf` under
  // `c0` makes 1 + (n - 1) = n links. The cap is on the resulting chain, so
  // n == MAX is the last admissible one and n == MAX + 1 is the first refused
  // — the boundary is pinned from BOTH sides so an off-by-one cannot hide as
  // "the refusal still fires".
  it(`admits a chain of exactly ${MAX_MANAGER_CHAIN_DEPTH} links`, async () => {
    const engine = makeEngine(chain(MAX_MANAGER_CHAIN_DEPTH));
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'leaf', managerId: 'c0' }));
    expect(res.status).toBe(200);
  });

  it('refuses the first link that would cross the cap', async () => {
    const engine = makeEngine(chain(MAX_MANAGER_CHAIN_DEPTH + 1));
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'leaf', managerId: 'c0' }));

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALUE_OUT_OF_RANGE');
    expect(res.body.error?.details?.reason).toBe('max_depth_exceeded');
    expect(res.body.error?.message).toContain(String(MAX_MANAGER_CHAIN_DEPTH));
    expect(engine.updates).toEqual([]);
  });
});

describe('set-user-manager — refusal 4: cross-organization', () => {
  const membership = (rows: Array<{ user_id: string; organization_id: string }>) => ({
    sys_user: [
      { id: 'u_report', manager_id: null, source: 'env_native' },
      { id: 'u_boss', manager_id: null, source: 'env_native' },
    ] as Row[],
    sys_member: rows as unknown as Row[],
  });

  it('refuses a manager whose memberships are DISJOINT from the user’s', async () => {
    const engine = makeEngine(
      membership([
        { user_id: 'u_report', organization_id: 'org_a' },
        { user_id: 'u_boss', organization_id: 'org_b' },
      ]),
    );
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_report', managerId: 'u_boss' }));

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_REFERENCE');
    expect(res.body.error?.details?.reason).toBe('cross_organization');
    expect(engine.updates).toEqual([]);
  });

  it('ADMITS a manager who shares one organization, even while holding others', async () => {
    const engine = makeEngine(
      membership([
        { user_id: 'u_report', organization_id: 'org_a' },
        { user_id: 'u_boss', organization_id: 'org_b' },
        { user_id: 'u_boss', organization_id: 'org_a' },
      ]),
    );
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_report', managerId: 'u_boss' }));
    expect(res.status).toBe(200);
  });

  it('an ABSENT tenancy fact is not a negative one — the link is admitted', async () => {
    // Mirrors `managerIsProvablyOutsideOrg`'s ruled posture: a stack that
    // stamps organizations on requests but never materializes `sys_member`
    // rows would otherwise lose every manager link at once.
    const engine = makeEngine(membership([{ user_id: 'u_report', organization_id: 'org_a' }]));
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_report', managerId: 'u_boss' }));
    expect(res.status).toBe(200);
  });

  it('a FAILED tenancy read says so once, and does not invent an empty membership', async () => {
    const engine = makeEngine(
      membership([
        { user_id: 'u_report', organization_id: 'org_a' },
        { user_id: 'u_boss', organization_id: 'org_b' },
      ]),
    );
    engine.failReadsOn('sys_member');
    const warns: unknown[][] = [];
    const res = await runSetUserManager(deps(engine, warns), ACTOR, post({ userId: 'u_report', managerId: 'u_boss' }));

    // Degraded, not silently degraded: the link goes through (the screen could
    // not answer) and the consequence plus the remedy are stated once.
    expect(res.status).toBe(200);
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain('could not read sys_member');
    expect(String(warns[0][0])).toContain('Remedy');
  });
});

describe('set-user-manager — refusal 5: the directory owns this identity', () => {
  const provisioned = () => ({
    sys_user: [
      { id: 'u_sso', manager_id: 'u_old', source: 'idp_provisioned' },
      { id: 'u_boss', manager_id: null, source: 'env_native' },
      { id: 'u_old', manager_id: null, source: 'env_native' },
    ] as Row[],
  });

  it('refuses a SET on an idp_provisioned identity, naming the sync as the surface', async () => {
    const engine = makeEngine(provisioned());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_sso', managerId: 'u_boss' }));

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('PERMISSION_DENIED');
    expect(res.body.error?.details?.reason).toBe('idp_provisioned');
    expect(res.body.error?.message).toContain('directory');
    expect(engine.updates).toEqual([]);
  });

  it('refuses the CLEAR too — a value the next sync reverts is the shape ADR-0049 refuses', async () => {
    const engine = makeEngine(provisioned());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_sso', managerId: null }));

    expect(res.status).toBe(403);
    expect(res.body.error?.details?.reason).toBe('idp_provisioned');
    expect(engine.updates).toEqual([]);
  });

  it('an env_native identity is unaffected — the control for the screen above', async () => {
    const engine = makeEngine(provisioned());
    const res = await runSetUserManager(deps(engine), ACTOR, post({ userId: 'u_old', managerId: 'u_boss' }));
    expect(res.status).toBe(200);
  });
});
