// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0081 D1 — the default-org bootstrap helper (open home: plugin-auth).
// Covers the idempotency short-circuits, the create/reuse paths, and the
// injectable seed-ownership step (enterprise injects it; open path omits it).

import { describe, it, expect, vi } from 'vitest';
import { ensureDefaultOrganization } from './ensure-default-organization.js';

type Row = Record<string, any>;

function makeQl(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access' }],
    sys_user_permission_set: [
      { id: 'ups1', user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null },
    ],
    sys_member: [],
    sys_organization: [],
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
});
