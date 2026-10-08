// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22099] The walled wiring's owner bind is decided by ONE call, and that call
// writes the one ledger record — the in-flight rule of the gate both wirings
// share, measured through THIS plugin's own triggers.
//
// ## Why this file exists
//
// `OrganizationsPlugin` runs plugin-auth's `createEnsureDefaultOrganizationOnce`
// from `kernel:ready` and from its bootstrap middleware, the same gate the
// single-org `AuthPlugin` runs. On a single-org first boot that gate re-entered
// itself: the owner write made plugin-security grant `organization_admin`, the
// grant insert is a bootstrap trigger there, and the inner call recorded
// `admin-already-member` before the outer call's accurate record, which the
// `sys_migration` primary key then refused. The gate now marks its decision in
// flight before its first `await`; a call that finds it in flight binds nobody
// and records nothing.
//
// Measured on a walled first boot (`bootStack`, `isolated`, this plugin
// mounted): ONE `adr-0093-default-org-owner-bind` insert, details `bound` with
// the organization the operator's `sys_member` row names, no warning. Under a
// wall the grant-insert arm of the trigger predicate is retired, so the chain
// that re-enters the single-org wiring does not re-enter this one today. What
// this pin holds is the other half: when a trigger this plugin DOES honour — a
// `sys_user` write that touches `email_verified` — arrives while the decision
// is in flight, the walled wiring inherits the gate's rule instead of deciding
// a second time.
//
// ## The rig
//
// The fake engine of `walled-default-org-self-registrant.pin.test.ts`, plus the
// deployment ledger read by primary key, whose insert REFUSES a duplicate id the
// way the primary key does. The `sys_member` insert drives this plugin's own
// bootstrap middleware with the operator's verifying `sys_user` update before it
// returns — the bind is still in flight at that moment.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';
import { OrganizationsPlugin } from './organizations-plugin.js';

const OWNER_EMAIL = 'ops@operator.test';
const OWNER_BIND_ID = 'adr-0093-default-org-owner-bind';

interface Row {
  [key: string]: unknown;
}

function makeEngine(store: Record<string, Row[]>) {
  const inserts: Array<{ object: string; data: Row }> = [];
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const hooks: { afterMemberInsert?: () => Promise<void> } = {};
  const matches = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([key, value]) => {
      // ⛔ Refuse a combinator rather than reading it as a field name
      // (`pnpm check:where-matcher`).
      if (key.startsWith('$')) {
        throw new Error(`fake engine: WHERE combinator \`${key}\` is not implemented`);
      }
      return value === null ? row[key] == null : row[key] === value;
    });
  const ql: any = {
    getSchema: () => null,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    // The deployment ledger: registered, read by primary key.
    getObject: (name: string) => (name in store ? { name } : undefined),
    findOne: vi.fn(async (object: string, query: any) => {
      assertEngineFindOnePredicate(object, query);
      return (store[object] ?? []).find((r) => r.id === query?.where?.id) ?? null;
    }),
    find: vi.fn(async (object: string, query: any) => {
      const rows = (store[object] ?? []).filter((r) => matches(r, query?.where));
      return rows.slice(0, query?.limit ?? rows.length);
    }),
    insert: vi.fn(async (object: string, data: Row) => {
      inserts.push({ object, data });
      if (object === 'sys_migration' && (store.sys_migration ?? []).some((r) => r.id === data.id)) {
        throw new Error('UNIQUE constraint failed: sys_migration.id');
      }
      (store[object] ??= []).push({ ...data });
      if (object === 'sys_member') await hooks.afterMemberInsert?.();
      return { ...data };
    }),
  };
  return { ql, inserts, middlewares, hooks };
}

function makeCtx(ql: any) {
  const hooks = new Map<string, Array<() => unknown>>();
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    // `invite-only` through the settings cascade with a non-`default` source —
    // what `membership-policy-gate.ts` requires a walled deployment to present.
    settings: {
      getNamespace: vi.fn(async () => ({
        values: { membership_policy: { value: 'invite-only', source: 'env' } },
      })),
    },
    auth: { getMembershipPolicy: () => 'invite-only' },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => {
      services[name] = svc;
    },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    hook: (name: string, handler: () => unknown) => {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name)!.push(handler);
    },
  };
  const trigger = async (name: string) => {
    for (const h of hooks.get(name) ?? []) await h();
  };
  return { ctx, trigger };
}

const savedPosture = process.env.OS_TENANCY_POSTURE;
const savedOwner = process.env.OS_PLATFORM_OWNER_EMAIL;
afterEach(() => {
  if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = savedPosture;
  if (savedOwner === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
  else process.env.OS_PLATFORM_OWNER_EMAIL = savedOwner;
  resetPlatformAdminEmailMemo();
});

describe('walled: a bootstrap trigger arriving while the owner bind is in flight decides nothing (#22099)', () => {
  it('the deciding call records once — `bound`, with the organization sys_member points at', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    resetPlatformAdminEmailMemo();
    const store: Record<string, Row[]> = {
      sys_permission_set: [{ id: 'ps_admin', name: 'admin_full_access' }],
      sys_user_permission_set: [],
      sys_user: [{ id: 'usr_ops', email: OWNER_EMAIL, email_verified: true, created_at: '2026-03-03T00:00:00.000Z' }],
      sys_organization: [],
      sys_member: [],
      sys_migration: [],
    };
    const { ql, inserts, middlewares, hooks } = makeEngine(store);
    const { ctx, trigger } = makeCtx(ql);
    const plugin = new OrganizationsPlugin();
    await plugin.init(ctx);
    await plugin.start(ctx);
    await trigger('kernel:bootstrapped');

    // The bootstrap re-run arm is the LAST middleware `start()` registers (the
    // neighbouring pin's reading). It is driven from inside the bind, once.
    const bootstrapMw = middlewares[middlewares.length - 1]!;
    let reentered = 0;
    hooks.afterMemberInsert = async () => {
      reentered += 1;
      if (reentered > 1) return;
      await bootstrapMw(
        { object: 'sys_user', operation: 'update', data: { id: 'usr_ops', email_verified: true } },
        async () => {},
      );
    };

    await trigger('kernel:ready');

    const memberInserts = inserts.filter((i) => i.object === 'sys_member');
    const ledgerInserts = inserts.filter((i) => i.object === 'sys_migration' && i.data.id === OWNER_BIND_ID);
    expect(reentered, 'precondition: the bind re-entered this plugin\'s bootstrap middleware').toBe(1);
    expect(memberInserts).toHaveLength(1);
    expect(memberInserts[0]!.data).toMatchObject({ user_id: 'usr_ops', role: 'owner' });
    expect(ledgerInserts, 'the owner-bind decision was written more than once').toHaveLength(1);
    const recorded = store.sys_migration!.find((r) => r.id === OWNER_BIND_ID);
    expect(JSON.parse(String(recorded?.details))).toEqual({
      outcome: 'bound',
      organizationId: store.sys_member![0]!.organization_id,
    });
    expect(ctx.logger.error).not.toHaveBeenCalled();
  });
});
