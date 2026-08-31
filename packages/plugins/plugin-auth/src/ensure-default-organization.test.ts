// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0081 D1 — the default-org bootstrap helper (open home: plugin-auth).
// Covers the idempotency short-circuits, the create/reuse paths, and the
// injectable seed-ownership step (enterprise injects it; open path omits it).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import {
  ensureDefaultOrganization,
  isDefaultOrganizationBootstrapTrigger,
} from './ensure-default-organization.js';

// [#11973] The config anchor reads `OS_PLATFORM_OWNER_EMAIL` live (memoized on
// the raw value), so every case in this file pins the variable's state instead
// of inheriting the ambient environment's.
const ENV = 'OS_PLATFORM_OWNER_EMAIL';
let ambientOwnerEmail: string | undefined;
beforeEach(() => {
  ambientOwnerEmail = process.env[ENV];
  delete process.env[ENV];
  resetPlatformAdminEmailMemo();
});
afterEach(() => {
  if (ambientOwnerEmail === undefined) delete process.env[ENV];
  else process.env[ENV] = ambientOwnerEmail;
  resetPlatformAdminEmailMemo();
});

/** Declare the deployment's administrators and drop the raw-value memo. */
function declare(value: string): void {
  process.env[ENV] = value;
  resetPlatformAdminEmailMemo();
}

type Row = Record<string, any>;

function makeQl(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access' }],
    sys_user_permission_set: [
      { id: 'ups1', user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null },
    ],
    sys_member: [],
    sys_organization: [],
    sys_user: [],
    ...seed,
  };
  const matches = (row: Row, where: Row) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return v === null ? row[k] == null : row[k] === v;
    });
  return {
    tables,
    find: vi.fn(async (object: string, q: any) =>
      (tables[object] ?? []).filter((r) => matches(r, q?.where)).slice(0, q?.limit ?? 100),
    ),
    insert: vi.fn(async (object: string, data: Row) => {
      (tables[object] ??= []).push(data);
      return data;
    }),
  };
}

describe('ensureDefaultOrganization (plugin-auth home)', () => {
  it('creates the default org and binds the admin as owner', async () => {
    const ql = makeQl();
    const res = await ensureDefaultOrganization(ql);
    expect(res.defaultOrgCreated).toBe(true);
    expect(res.memberCreated).toBe(true);
    expect(ql.tables.sys_organization[0]).toMatchObject({ slug: 'default', name: 'Default Organization' });
    expect(ql.tables.sys_member[0]).toMatchObject({ user_id: 'u1', role: 'owner', organization_id: res.defaultOrgId });
  });

  it('no-ops when there is no platform admin yet', async () => {
    const ql = makeQl({ sys_user_permission_set: [] });
    const res = await ensureDefaultOrganization(ql);
    expect(res).toMatchObject({ defaultOrgCreated: false, memberCreated: false, reason: 'no_admin' });
    expect(ql.insert).not.toHaveBeenCalled();
  });

  it('respects an admin who already belongs to an org', async () => {
    const ql = makeQl({ sys_member: [{ id: 'm0', user_id: 'u1', organization_id: 'org_x' }] });
    const res = await ensureDefaultOrganization(ql);
    expect(res.reason).toBe('admin_already_in_org');
    expect(ql.insert).not.toHaveBeenCalled();
  });

  it('reuses a pre-existing slug=default org instead of minting a new one', async () => {
    const ql = makeQl({ sys_organization: [{ id: 'org_default', slug: 'default', name: 'Default Organization' }] });
    const res = await ensureDefaultOrganization(ql);
    expect(res.defaultOrgCreated).toBe(false);
    expect(res.defaultOrgId).toBe('org_default');
    expect(res.memberCreated).toBe(true);
  });

  it('picks the OLDEST cross-tenant admin grant', async () => {
    const ql = makeQl({
      sys_user_permission_set: [
        { id: 'b', user_id: 'u_newer', permission_set_id: 'ps_admin', organization_id: null, created_at: '2026-01-02T00:00:00Z' },
        { id: 'a', user_id: 'u_older', permission_set_id: 'ps_admin', organization_id: null, created_at: '2026-01-01T00:00:00Z' },
      ],
    });
    await ensureDefaultOrganization(ql);
    expect(ql.tables.sys_member[0].user_id).toBe('u_older');
  });

  it('runs the injected claimSeedOwnership step (enterprise path) and reports the count', async () => {
    const ql = makeQl();
    const claim = vi.fn(async () => [{ count: 3 }, { count: 2 }]);
    const res = await ensureDefaultOrganization(ql, { claimSeedOwnership: claim });
    expect(claim).toHaveBeenCalledWith(ql, res.defaultOrgId, 'u1', expect.any(Object));
    expect(res.ownershipClaimed).toBe(5);
  });

  it('skips seed-ownership when not injected (open single-org path)', async () => {
    const res = await ensureDefaultOrganization(makeQl());
    expect(res.ownershipClaimed).toBe(0);
  });

  it('a failing injected claim never undoes the owner bind', async () => {
    const ql = makeQl();
    const res = await ensureDefaultOrganization(ql, {
      claimSeedOwnership: vi.fn(async () => { throw new Error('seed pipeline down'); }),
    });
    expect(res.memberCreated).toBe(true);
    expect(ql.tables.sys_member).toHaveLength(1);
  });

  // [#12981] A refused bootstrap write is a DURABILITY degradation, not a
  // functional one: `tryInsert` answers `null`, the boot goes on, nothing else
  // fails, and the admin simply has no organization. AGENTS.md "Degradation log
  // levels" puts that at `error`, and the two lines below used to be `warn`.
  describe('refused bootstrap writes report at `error` (#12981)', () => {
    function refusingQl(object: string) {
      const ql = makeQl();
      const realInsert = ql.insert;
      ql.insert = vi.fn(async (obj: string, data: Row) => {
        if (obj === object) throw new Error(`write refused: ${obj}`);
        return realInsert(obj, data);
      }) as any;
      return ql;
    }

    it('a refused sys_organization insert names the consequence AND the remedy at `error`', async () => {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const res = await ensureDefaultOrganization(refusingQl('sys_organization'), { logger });

      expect(res.reason).toBe('org_insert_failed');
      expect(logger.error).toHaveBeenCalledTimes(1);
      // ⛔ Not `expect(...).toHaveBeenCalled()` on its own: the level IS the
      // defect this repairs, so `warn` must be silent for the assertion to mean
      // anything.
      expect(logger.warn).not.toHaveBeenCalled();
      const [message, cause, meta] = logger.error.mock.calls[0];
      expect(message).toContain('NOT created');
      expect(message).toContain('LOOKING HEALTHY');
      expect(message).toContain('Remedy');
      // The spec `Logger.error` arity: the CAUSE is the second argument and meta
      // the third. Passing meta into the cause slot puts it where a Logger
      // neither reads nor serializes it.
      expect(cause).toBeUndefined();
      expect(meta).toMatchObject({ object: 'sys_organization' });
    });

    it('a refused sys_member insert reports at `error` too', async () => {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const res = await ensureDefaultOrganization(refusingQl('sys_member'), { logger });

      expect(res).toMatchObject({ defaultOrgCreated: true, memberCreated: false, reason: 'member_insert_failed' });
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0][0]).toContain('NOT bound');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    // #9754: `error` is optional because hosts do inject reduced sinks. A
    // fallback that only exists in the type is not a fallback — this is the
    // case that proves the `warn` leg is wired, and it is the one
    // `logger?.error?.(…)` would fail while looking correct.
    it('falls back to `warn` against a sink with no `error`', async () => {
      const logger = { info: vi.fn(), warn: vi.fn() };
      await ensureDefaultOrganization(refusingQl('sys_organization'), { logger });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][0]).toContain('NOT created');
      // The fallback takes (message, meta) — no cause slot on `warn`.
      expect(logger.warn.mock.calls[0][1]).toMatchObject({ object: 'sys_organization' });
    });

    it('a class-based sink keeps its receiver (⛔ never a detached `error ?? warn`)', async () => {
      // `@objectstack/core`'s ObjectLogger is a class whose `error` reaches for
      // `this`. A detached `(logger.error ?? logger.warn)(…)` throws against it
      // and survives every plain-closure double in this file, which is why the
      // case is written with a real receiver.
      class Sink {
        seen: string[] = [];
        info(): void {}
        warn(): void {}
        error(message: string): void {
          this.seen.push(message);
        }
      }
      const sink = new Sink();
      await ensureDefaultOrganization(refusingQl('sys_organization'), { logger: sink });
      expect(sink.seen).toHaveLength(1);
    });
  });

  // [#11973 / #11663 L3] The config-anchored population — design §2 step 5.
  describe('config-anchored population (#11973)', () => {
    const OWNER = 'owner@corp.example';

    it('finds a declared, VERIFIED administrator with NO grant row anywhere (post-L4 walled population)', async () => {
      declare(OWNER);
      const ql = makeQl({
        sys_user_permission_set: [],
        sys_user: [{ id: 'u_cfg', email: OWNER, email_verified: true }],
      });
      const res = await ensureDefaultOrganization(ql);
      expect(res.memberCreated).toBe(true);
      expect(ql.tables.sys_member[0]).toMatchObject({ user_id: 'u_cfg', role: 'owner' });
    });

    it('prefers the config anchor over the legacy grant anchor (the derivation prefers config)', async () => {
      declare(OWNER);
      const ql = makeQl({
        sys_user: [{ id: 'u_cfg', email: OWNER, email_verified: true }],
      });
      // The default fixture also carries the legacy grant admin `u1`.
      await ensureDefaultOrganization(ql);
      expect(ql.tables.sys_member[0].user_id).toBe('u_cfg');
    });

    it('an UNVERIFIED declared account confers nothing — falls back to the legacy grant anchor', async () => {
      declare(OWNER);
      const ql = makeQl({
        sys_user: [{ id: 'u_cfg', email: OWNER, email_verified: false }],
      });
      await ensureDefaultOrganization(ql);
      expect(ql.tables.sys_member[0].user_id).toBe('u1');
    });

    it('declared but nobody registered, and no grants: no_admin — the trigger set re-runs it later', async () => {
      declare(OWNER);
      const ql = makeQl({ sys_user_permission_set: [] });
      const res = await ensureDefaultOrganization(ql);
      expect(res).toMatchObject({ defaultOrgCreated: false, memberCreated: false, reason: 'no_admin' });
    });

    it('operator order decides between several declared administrators with standing', async () => {
      declare('first@corp.example,second@corp.example');
      const ql = makeQl({
        sys_user_permission_set: [],
        sys_user: [
          { id: 'u_second', email: 'second@corp.example', email_verified: true },
          { id: 'u_first', email: 'first@corp.example', email_verified: true },
        ],
      });
      await ensureDefaultOrganization(ql);
      expect(ql.tables.sys_member[0].user_id).toBe('u_first');
    });

    it('an entry with no verified account is passed over for the next declared entry', async () => {
      declare('first@corp.example,second@corp.example');
      const ql = makeQl({
        sys_user_permission_set: [],
        sys_user: [{ id: 'u_second', email: 'second@corp.example', email_verified: true }],
      });
      await ensureDefaultOrganization(ql);
      expect(ql.tables.sys_member[0].user_id).toBe('u_second');
    });

    it('a REFUSED variable (unparseable entry) fails the whole list closed — legacy anchor answers', async () => {
      declare(`${OWNER},not an email`);
      const ql = makeQl({
        sys_user: [{ id: 'u_cfg', email: OWNER, email_verified: true }],
      });
      await ensureDefaultOrganization(ql);
      // Choice 2B: the whole variable is refused, never the one entry — so the
      // verified declared account confers nothing and the grant admin is bound.
      expect(ql.tables.sys_member[0].user_id).toBe('u1');
    });

    it('queries the VERBATIM spelling too — an imported row that is not stored lowercased is found', async () => {
      declare('Ada@Example.com');
      const ql = makeQl({
        sys_user_permission_set: [],
        // The fake driver is an exact-match store, so the normalized
        // (lowercased) lookup misses this row; only the as-typed spelling hits.
        sys_user: [{ id: 'u_ada', email: 'Ada@Example.com', email_verified: true }],
      });
      await ensureDefaultOrganization(ql);
      expect(ql.tables.sys_member[0].user_id).toBe('u_ada');
    });

    // The Choice 4A pin the PM asked for by name: with the variable UNSET, a
    // verified `sys_user` row is NOT a population candidate. If the re-point
    // leaked into the `single` branch (any verified user read as an admin
    // candidate), `u_other` would win the bind below and this goes red.
    it('config UNSET: a verified sys_user row is NOT an admin candidate — the grant anchor decides (Choice 4A)', async () => {
      const ql = makeQl({
        sys_user: [{ id: 'u_other', email: 'other@corp.example', email_verified: true }],
      });
      const res = await ensureDefaultOrganization(ql);
      expect(res.memberCreated).toBe(true);
      expect(ql.tables.sys_member[0].user_id).toBe('u1');
      // …and the config half cost no sys_user read at all.
      expect(ql.find).not.toHaveBeenCalledWith('sys_user', expect.anything(), expect.anything());
    });
  });
});

// [#11973 / #11663 L3, design H4] The trigger predicate — one definition for
// every wiring (plugin-auth's middleware here; the enterprise organizations
// package's walled wiring is asked to consume the same export).
describe('isDefaultOrganizationBootstrapTrigger', () => {
  it.each([
    [{ object: 'sys_user', operation: 'insert' }, true],
    [{ object: 'sys_user', operation: 'create' }, true],
    [{ object: 'sys_user', operation: 'update', data: { email_verified: true } }, true],
    [{ object: 'sys_user', operation: 'update', data: { email: 'x@y.example' } }, true],
    [{ object: 'sys_user', operation: 'update', data: { name: 'renamed' } }, false],
    [{ object: 'sys_user', operation: 'update' }, false],
    [{ object: 'sys_user', operation: 'delete' }, false],
    [{ object: 'sys_user_permission_set', operation: 'insert' }, true],
    [{ object: 'sys_user_permission_set', operation: 'create' }, true],
    [{ object: 'sys_user_permission_set', operation: 'update', data: { organization_id: null } }, false],
    [{ object: 'sys_member', operation: 'insert' }, false],
    [{ object: 'task', operation: 'insert' }, false],
    [{}, false],
  ])('%j → %s', (opCtx, expected) => {
    expect(isDefaultOrganizationBootstrapTrigger(opCtx as any)).toBe(expected);
  });
});
