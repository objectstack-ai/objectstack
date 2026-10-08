// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#22099] The one-time owner-bind gate (`createEnsureDefaultOrganizationOnce`)
// is decided by ONE call, and that call writes the one ledger record.
//
// ## The defect these pins hold closed
//
// The bind re-enters the gate. On a first boot the owner write (the
// `sys_member` insert, or — since ADR-0131 D3 — the promotion of the
// reconciler's own `member` row) makes plugin-security grant
// `organization_admin`, and that grant insert is a bootstrap trigger under a
// non-walled posture, so plugin-auth's middleware runs the gate again INSIDE
// the deciding call. The latch was set only after `await ensure(...)` returned,
// so the inner call read "undecided" and a ledger with no row, found the admin
// already holding the membership the outer call had just written, and recorded
// `admin-already-member` first. The outer call's accurate record (`bound` or
// `promoted`, with the organization id) was then refused by the
// `sys_migration` primary key — a warning and a stack on every first boot —
// and the ledger kept the wrong outcome.
//
// ## The double
//
// `rig()` is the engine surface the gate and `ensureDefaultOrganization` read
// and write, with the two properties the defect lives in made real: the
// `sys_migration` insert REFUSES a duplicate id the way the primary key does,
// and every `sys_member` write runs a `reenter` callback after it lands — the
// stand-in for plugin-security's grant middleware handing a bootstrap trigger
// back to the gate. Every negative below is paired with the fact that makes it
// non-vacuous: the gate really was re-entered (or really was called twice).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/objectql';
import {
  ensureDefaultOrganization,
  type EnsureDefaultOrganizationOptions,
} from './ensure-default-organization.js';
import { createEnsureDefaultOrganizationOnce } from './default-org-bootstrap-once.js';
import { DEFAULT_ORG_OWNER_BIND_MIGRATION_ID } from './membership-backfill-ledger.js';

// The legacy grant anchor this helper falls back to is posture-keyed, and the
// config anchor reads `OS_PLATFORM_OWNER_EMAIL` live: pin both to the
// `single` shape the measured boot runs, never the ambient environment's.
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const MULTI_ORG_ENV = 'OS_MULTI_ORG_ENABLED';
const ambient: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of [OWNER_ENV, POSTURE_ENV, MULTI_ORG_ENV]) ambient[name] = process.env[name];
  delete process.env[OWNER_ENV];
  delete process.env[MULTI_ORG_ENV];
  process.env[POSTURE_ENV] = 'single';
  resetPlatformAdminEmailMemo();
});
afterEach(() => {
  for (const [name, value] of Object.entries(ambient)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetPlatformAdminEmailMemo();
});

type Row = Record<string, any>;

function rig(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access' }],
    // The platform admin `u1`, through the legacy grant anchor `single` reads.
    sys_user_permission_set: [{ id: 'ups1', user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null }],
    sys_organization: [],
    sys_member: [],
    sys_migration: [],
    ...seed,
  };
  /** Every row handed to the ledger insert, landed or refused. */
  const ledgerInserts: Row[] = [];
  const hooks: { reenter?: () => Promise<unknown>; refuseLedger?: Error; refuseMemberInsertOnce?: Error } = {};
  const matches = (row: Row, where: Row | undefined) =>
    Object.entries(where ?? {}).every(([key, value]) => {
      if (key.startsWith('$')) throw new Error(`fake engine: WHERE combinator ${key} is not implemented`);
      return value === null ? row[key] == null : row[key] === value;
    });
  const ql: any = {
    tables,
    getObject: (name: string) => (name in tables ? { name } : undefined),
    find: vi.fn(async (object: string, query: any) => {
      const rows = (tables[object] ?? []).filter((r) => matches(r, query?.where));
      return rows.slice(0, query?.limit ?? rows.length);
    }),
    findOne: vi.fn(async (object: string, query: any) => {
      // Pinned to ObjectQL.findOne's predicate contract (the ledger reads by id).
      assertEngineFindOnePredicate(object, query);
      return (tables[object] ?? []).find((r) => r.id === query?.where?.id) ?? null;
    }),
    insert: vi.fn(async (object: string, data: Row) => {
      if (object === 'sys_migration') {
        ledgerInserts.push(data);
        if (hooks.refuseLedger) throw hooks.refuseLedger;
        if (tables.sys_migration.some((r) => r.id === data.id)) {
          throw new Error('UNIQUE constraint failed: sys_migration.id');
        }
      }
      if (object === 'sys_member' && hooks.refuseMemberInsertOnce) {
        const refusal = hooks.refuseMemberInsertOnce;
        hooks.refuseMemberInsertOnce = undefined;
        throw refusal;
      }
      (tables[object] ??= []).push({ ...data });
      if (object === 'sys_member') await hooks.reenter?.();
      return { ...data };
    }),
    update: vi.fn(async (object: string, data: Row, options?: any) => {
      // Pinned to ObjectQL.update's dispatch predicate (the promotion is by id).
      assertEngineUpdateDispatch(data, options);
      const row = (tables[object] ?? []).find((r) => r.id === data.id);
      if (row) Object.assign(row, data);
      if (object === 'sys_member') await hooks.reenter?.();
      return row ?? null;
    }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  /** The options every `ensure` call received, in call order. */
  const ensureCalls: EnsureDefaultOrganizationOptions[] = [];
  const gate = createEnsureDefaultOrganizationOnce({
    logger,
    ensure: (engine, options) => {
      ensureCalls.push(options ?? {});
      return ensureDefaultOrganization(engine, options);
    },
  });
  const ownerBindInserts = () => ledgerInserts.filter((r) => r.id === DEFAULT_ORG_OWNER_BIND_MIGRATION_ID);
  const recorded = () => {
    const row = tables.sys_migration.find((r) => r.id === DEFAULT_ORG_OWNER_BIND_MIGRATION_ID);
    return row ? JSON.parse(String(row.details)) : undefined;
  };
  return { ql, tables, hooks, logger, gate, ensureCalls, ownerBindInserts, recorded };
}

describe('[#22099] the owner bind re-enters the gate: the deciding call records, once', () => {
  it('a fresh bind: the inner call binds nobody and records nothing; the ledger reads `bound` with the organization sys_member points at', async () => {
    const r = rig();
    let reentered = 0;
    r.hooks.reenter = async () => {
      reentered += 1;
      if (reentered === 1) await r.gate(r.ql);
    };

    const res = await r.gate(r.ql);

    expect(reentered, 'precondition: the bind re-entered the gate').toBeGreaterThanOrEqual(1);
    expect(r.ensureCalls).toHaveLength(2);
    expect(r.ensureCalls[1]?.bindOwner, 'the in-flight call must not decide').toBe(false);
    expect(res).toMatchObject({ memberCreated: true });
    expect(r.tables.sys_member).toHaveLength(1);
    expect(r.ownerBindInserts(), 'the decision was written more than once').toHaveLength(1);
    expect(r.recorded()).toEqual({ outcome: 'bound', organizationId: r.tables.sys_member[0]!.organization_id });
    expect(r.logger.error).not.toHaveBeenCalled();
  });

  it('the promotion of the reconciler-written `member` row (the landed first-boot shape): the ledger reads `promoted`', async () => {
    const r = rig({
      sys_organization: [{ id: 'org_d', slug: 'default' }],
      sys_member: [{ id: 'mem_reconciled', organization_id: 'org_d', user_id: 'u1', role: 'member' }],
    });
    let reentered = 0;
    r.hooks.reenter = async () => {
      reentered += 1;
      if (reentered === 1) await r.gate(r.ql);
    };

    const res = await r.gate(r.ql);

    expect(reentered, 'precondition: the promotion re-entered the gate').toBeGreaterThanOrEqual(1);
    expect(r.ensureCalls[1]?.bindOwner).toBe(false);
    expect(res).toMatchObject({ ownerPromoted: true });
    expect(r.tables.sys_member).toEqual([{ id: 'mem_reconciled', organization_id: 'org_d', user_id: 'u1', role: 'owner' }]);
    expect(r.ownerBindInserts()).toHaveLength(1);
    expect(r.recorded()).toEqual({ outcome: 'promoted', organizationId: 'org_d' });
    expect(r.logger.error).not.toHaveBeenCalled();
  });

  it('a concurrent trigger while the decision is in flight binds nobody: one owner row, one record', async () => {
    const r = rig({ sys_organization: [{ id: 'org_d', slug: 'default' }] });

    const [first, second] = await Promise.all([r.gate(r.ql), r.gate(r.ql)]);

    expect(r.ensureCalls, 'precondition: both triggers reached the gate').toHaveLength(2);
    // The in-flight call reaches `ensure` FIRST: the deciding one is still
    // awaiting its ledger read. Exactly one of the two may not decide.
    expect(r.ensureCalls.filter((o) => o.bindOwner === false)).toHaveLength(1);
    expect(first).toMatchObject({ memberCreated: true, defaultOrgId: 'org_d' });
    expect(second).toMatchObject({ memberCreated: false, reason: 'owner_bind_decided' });
    expect(r.tables.sys_member.filter((m) => m.role === 'owner')).toHaveLength(1);
    expect(r.ownerBindInserts()).toHaveLength(1);
    expect(r.recorded()).toEqual({ outcome: 'bound', organizationId: 'org_d' });
  });

  it('a call that did not act clears the mark: the next trigger still decides', async () => {
    const r = rig({ sys_organization: [{ id: 'org_d', slug: 'default' }] });
    r.hooks.refuseMemberInsertOnce = new Error('write refused');

    const failed = await r.gate(r.ql);
    expect(failed).toMatchObject({ memberCreated: false, reason: 'member_insert_failed' });
    expect(r.ownerBindInserts()).toHaveLength(0);

    const next = await r.gate(r.ql);
    expect(r.ensureCalls[1]?.bindOwner, 'the next trigger decided, it was not read as in flight').not.toBe(false);
    expect(next).toMatchObject({ memberCreated: true });
    expect(r.ownerBindInserts()).toHaveLength(1);
    expect(r.recorded()).toEqual({ outcome: 'bound', organizationId: 'org_d' });
  });

  it('CONTROL: a real ledger insert failure still reaches the error branch — nothing swallows it', async () => {
    const r = rig({ sys_organization: [{ id: 'org_d', slug: 'default' }] });
    r.hooks.refuseLedger = new Error('disk I/O error');

    const res = await r.gate(r.ql);

    expect(res).toMatchObject({ memberCreated: true });
    expect(r.ownerBindInserts()).toHaveLength(1);
    expect(r.tables.sys_migration).toEqual([]);
    expect(r.logger.error).toHaveBeenCalledTimes(1);
    // The error branch, by its subject and its detail — not by its prose.
    expect(r.logger.error).toHaveBeenCalledWith(
      expect.stringContaining(DEFAULT_ORG_OWNER_BIND_MIGRATION_ID),
      { error: 'disk I/O error' },
    );
  });
});
