// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0138 E1 — the anonymous branch of `resolveAuthzContext` resolves the
 * guest's grants: the sets bound to the `guest` anchor position (D3), in the
 * organization the guest entry's organization step derives (D4).
 *
 * Each case pairs the reading with the control that tells it apart from the
 * branch returning early, which is what the branch did before E1: a set bound
 * to `guest` granted nothing (ADR-0090 D9, declared and not enforced).
 *
 * The engine double answers `find` from tables, counts every read it serves,
 * and answers the registry's `getObject` for the objects it was built with —
 * the two facts the organization step asks before it reads.
 */

import { describe, it, expect } from 'vitest';
import { resolveAuthzContext, resolveGuestOrganization } from './resolve-authz-context.js';
import { resolveSystemWriteOrganization } from './system-write-organization.js';
import { bindStaticSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const GUEST_SET = 'public_catalog_reader';
const ORG = 'org_only';

interface FakeOptions {
  /** `sys_organization` rows; omitted = the object is not registered at all. */
  organizations?: Array<{ id: string }>;
  /** The `guest` anchor's declared sets. */
  guestSets?: string[];
  /** Activation-ledger rows (`sys_metadata_activation`). */
  ledger?: Array<Record<string, unknown>>;
  /** Extra tables. */
  tables?: Record<string, any[]>;
}

/**
 * The fake engine's WHERE matcher: equality and `$in` per field. A combinator
 * it does not implement is REFUSED, never read as a field name and answered
 * silently wrong.
 */
function matchesWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k.startsWith('$')) throw new Error('fakeEngine.find: unsupported logical operator ' + k);
    const hit = v && typeof v === 'object' && '$in' in (v as any) ? (v as any).$in.includes(row[k]) : row[k] === v;
    if (!hit) return false;
  }
  return true;
}

function fakeEngine(opts: FakeOptions = {}) {
  const reads: string[] = [];
  const tables: Record<string, any[]> = {
    ...(opts.organizations ? { sys_organization: opts.organizations } : {}),
    sys_metadata_activation: opts.ledger ?? [],
    ...(opts.tables ?? {}),
  };
  const registered = new Set(Object.keys(tables));
  const engine = {
    registry: { getObject: (name: string) => (registered.has(name) ? { name } : undefined) },
    async find(object: string, q: any) {
      reads.push(object);
      const where = q?.where ?? {};
      const rows = (tables[object] ?? []).filter((r) => matchesWhere(r, where));
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
  };
  bindStaticSecurityCatalog(engine, {
    positions: [{ name: 'guest', permissionSets: opts.guestSets ?? [] }, { name: 'everyone', permissionSets: ['member_default'] }],
    permissions: [
      { name: GUEST_SET, tabPermissions: { storefront: 'visible' } },
      { name: 'second_reader' },
      { name: 'member_default' },
      { name: 'guest' },
    ],
  });
  return { engine, reads };
}

const anonymous = (engine: unknown, extra: Record<string, unknown> = {}) =>
  resolveAuthzContext({ userAuthGates: undefined, apiKeyLifecycle: undefined, ql: engine, headers: new Headers(), getSession: async () => undefined, ...extra });

describe('ADR-0138 D3 — a bound set reaches the guest entry, in the derived organization', () => {
  it('carries the bound set and the one organization (D3 item 1, D4 item 1)', async () => {
    const { engine } = fakeEngine({ organizations: [{ id: ORG }], guestSets: [GUEST_SET] });
    const ctx = await anonymous(engine, { guestEntry: true });
    expect(ctx.permissions).toEqual([GUEST_SET]);
    expect(ctx.tenantId).toBe(ORG);
    expect(ctx.tabPermissions).toEqual({ storefront: 'visible' });
    expect(ctx.userId).toBeUndefined();
    // The control: the same engine, on a face that does not take the guest entry.
    const failClosed = await anonymous(engine);
    expect(failClosed.permissions).toEqual([]);
    expect(failClosed.tenantId).toBeUndefined();
  });

  it('nothing bound: no set, no organization, and no read issued (D3 item 2)', async () => {
    const { engine, reads } = fakeEngine({ organizations: [{ id: ORG }], guestSets: [] });
    const ctx = await anonymous(engine, { guestEntry: true });
    expect(ctx).toMatchObject({ positions: [], permissions: [], systemPermissions: [] });
    expect(ctx.tenantId).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it('a set the catalog does not hold, and a switched-off set, confer nothing', async () => {
    const { engine } = fakeEngine({
      organizations: [{ id: ORG }],
      guestSets: [GUEST_SET, 'second_reader', 'no_such_set'],
      ledger: [{ metadata_type: 'permission', name: 'second_reader', active: false }],
    });
    const ctx = await anonymous(engine, { guestEntry: true });
    expect(ctx.permissions).toEqual([GUEST_SET]);
  });

  it('a switched-off `guest` position grants nothing', async () => {
    const { engine } = fakeEngine({
      organizations: [{ id: ORG }],
      guestSets: [GUEST_SET],
      ledger: [{ metadata_type: 'position', name: 'guest', active: false }],
    });
    const ctx = await anonymous(engine, { guestEntry: true });
    expect(ctx.permissions).toEqual([]);
  });

  it('the guest gains neither `everyone` nor any position, and no posture rung (D3 item 3)', async () => {
    const { engine } = fakeEngine({ organizations: [{ id: ORG }], guestSets: [GUEST_SET] });
    const ctx = await anonymous(engine, { guestEntry: true });
    expect(ctx.positions).toEqual([]);
    expect(ctx.permissions).not.toContain('member_default');
    expect(ctx.posture).toBeUndefined();
  });

});

describe('ADR-0138 D4 — no derived organization, no set (D3 item 7)', () => {
  it('several organizations: nothing granted, no organization chosen', async () => {
    const { engine } = fakeEngine({ organizations: [{ id: 'org_a' }, { id: 'org_b' }], guestSets: [GUEST_SET] });
    const ctx = await anonymous(engine, { guestEntry: true });
    expect(ctx.permissions).toEqual([]);
    expect(ctx.tenantId).toBeUndefined();
  });

  it('a walled posture: nothing granted, and no organization is read', async () => {
    const { engine, reads } = fakeEngine({ organizations: [{ id: ORG }], guestSets: [GUEST_SET] });
    const ctx = await anonymous(engine, { guestEntry: true, tenancyPosture: 'isolated' });
    expect(ctx.permissions).toEqual([]);
    expect(ctx.tenantId).toBeUndefined();
    expect(reads).not.toContain('sys_organization');
  });

  it('a composition with no organization object: nothing granted, and the object is never read', async () => {
    const { engine, reads } = fakeEngine({ guestSets: [GUEST_SET] });
    const ctx = await anonymous(engine, { guestEntry: true });
    expect(ctx.permissions).toEqual([]);
    expect(reads).not.toContain('sys_organization');
  });
});

describe('ADR-0138 D4 item 2 — the guest entry asks ADR-0131 D9\'s predicate, never a second spelling', () => {
  const facts = [
    { name: 'one organization', organizations: [{ id: ORG }], posture: 'single' as const },
    { name: 'two organizations', organizations: [{ id: 'a' }, { id: 'b' }], posture: 'single' as const },
    { name: 'no organization', organizations: [], posture: 'single' as const },
    { name: 'no organization object', organizations: undefined, posture: 'single' as const },
    { name: 'a wall', organizations: [{ id: ORG }], posture: 'group' as const },
  ];
  for (const f of facts) {
    it(`${f.name}: the same decision the predicate gives the same facts`, async () => {
      const { engine } = fakeEngine({ organizations: f.organizations });
      const viaGuest = await resolveGuestOrganization(engine, f.posture);
      const direct = await resolveSystemWriteOrganization({
        posture: f.posture,
        probeOrganizations: async () => (f.organizations ?? []).map((o) => o.id),
        organizationObjectRegistered: f.organizations !== undefined,
      });
      expect(viaGuest).toEqual(direct);
    });
  }

  it('no posture supplied reads as no wall', async () => {
    const { engine } = fakeEngine({ organizations: [{ id: ORG }] });
    expect(await resolveGuestOrganization(engine, undefined)).toEqual({ kind: 'derived', organizationId: ORG });
  });

  it('a failed organization read is loud, never zero organizations', async () => {
    const engine = {
      registry: { getObject: () => ({}) },
      async find() { throw new Error('connection reset'); },
    };
    await expect(resolveGuestOrganization(engine, 'single')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
  });
});
