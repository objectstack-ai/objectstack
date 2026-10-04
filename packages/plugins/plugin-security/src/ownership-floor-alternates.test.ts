// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21729] The ownership-floor alternate seam — how a plugin other than this
 * one stops the platform's `created_by` write floor pre-empting its own row
 * gate, registered beside that gate (`ownership-floor-alternates.ts`).
 *
 * Three things are pinned here, each where it can fail on its own:
 *
 *  1. THE RULES a contribution is held to — a wildcard object, a non-limb
 *     operation (`all` included) and a malformed policy are refused loudly, and
 *     a plugin's contributions are keyed by that plugin.
 *  2. THE PLACEMENT — the alternate lands beside an ENABLED SHIPPED floor
 *     policy of its limb, in that policy's own `positions` domain, and carries
 *     the floor's provenance; nowhere else does anything change.
 *  3. THE BYTE-IDENTITY of every other principal — driven through the real
 *     plugin's resolution and composition: with the `sys_attachment` delete
 *     alternate contributed, the ONLY (principal, object, operation) cell whose
 *     collected policies or compiled filter moves is the in-domain member's
 *     `sys_attachment` delete. That is the `positions`-domain argument
 *     `sys_comment_moderation`'s comment makes (an empty write class is the
 *     derive-from-select trigger), held by construction rather than by a
 *     hand-written domain.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { OwnershipFloorAlternates } from './ownership-floor-alternates.js';
import {
  isPlatformOwnershipFloorPolicy,
  withOwnershipFloorAlternates,
  type OwnershipFloorAlternate,
} from './platform-ownership-policies.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

/** Written out rather than imported from service-storage: the pin must not move with the module. */
const ATTACHMENT_DELETE: OwnershipFloorAlternate = {
  name: 'sys_attachment_parent_editor_delete',
  object: 'sys_attachment',
  operation: 'delete',
  using: 'id != null',
};

const setByName = (name: string) => {
  const ps = defaultPermissionSets.find((p) => p.name === name);
  if (!ps) throw new Error(`default permission set '${name}' not found`);
  return ps;
};
const memberDefaultPolicies = (): RowLevelSecurityPolicy[] =>
  (setByName('member_default').rowLevelSecurity ?? []) as RowLevelSecurityPolicy[];

describe('the seam refuses what is not one limb of the floor on one object', () => {
  const contribute = (alternate: Record<string, unknown>) => () =>
    new OwnershipFloorAlternates().contribute('com.example.contributor', [alternate as never]);

  it("object '*' — that withdraws the floor instead of relieving it", () => {
    expect(contribute({ ...ATTACHMENT_DELETE, object: '*' })).toThrow(/'com\.example\.contributor'.*object '\*' would withdraw the floor/);
  });

  it.each(['all', 'select', 'insert', 'purge'])("operation '%s' — not one floor limb", (operation) => {
    expect(contribute({ ...ATTACHMENT_DELETE, operation })).toThrow(/is not one floor limb/);
  });

  it('a policy that does not parse (name not snake_case), an empty predicate, no object', () => {
    expect(contribute({ ...ATTACHMENT_DELETE, name: 'Parent Editor Delete' })).toThrow(/not a well-formed row-level security policy/);
    expect(contribute({ ...ATTACHMENT_DELETE, using: '   ' })).toThrow(/carries no `using` predicate/);
    expect(contribute({ ...ATTACHMENT_DELETE, object: '' })).toThrow(/names no object/);
  });

  it('an unnamed contributor', () => {
    expect(() => new OwnershipFloorAlternates().contribute('', [ATTACHMENT_DELETE])).toThrow(/contributing plugin is not named/);
  });

  it('keys contributions by plugin: a second call replaces, an empty list withdraws, plugins coexist', () => {
    const reg = new OwnershipFloorAlternates();
    expect(reg.all()).toEqual([]);
    reg.contribute('com.example.a', [ATTACHMENT_DELETE]);
    reg.contribute('com.example.a', [ATTACHMENT_DELETE]);
    expect(reg.all()).toEqual([ATTACHMENT_DELETE]);
    const other = { ...ATTACHMENT_DELETE, name: 'other_delete', object: 'other_object' };
    reg.contribute('com.example.b', [other]);
    expect(reg.all().map((a) => a.name)).toEqual(['sys_attachment_parent_editor_delete', 'other_delete']);
    reg.contribute('com.example.a', []);
    expect(reg.all().map((a) => a.name)).toEqual(['other_delete']);
  });

  it('a refused contribution leaves what was in force untouched', () => {
    const reg = new OwnershipFloorAlternates();
    reg.contribute('com.example.a', [ATTACHMENT_DELETE]);
    expect(() => reg.contribute('com.example.a', [{ ...ATTACHMENT_DELETE, operation: 'all' as never }])).toThrow();
    expect(reg.all()).toEqual([ATTACHMENT_DELETE]);
  });
});

describe('placement: beside the enabled shipped floor of the limb, in the floor’s domain', () => {
  it('lands once, beside owner_only_deletes, domained to org_member, carrying floor provenance', () => {
    const out = withOwnershipFloorAlternates(memberDefaultPolicies(), [ATTACHMENT_DELETE]);
    const added = out.filter((p) => !memberDefaultPolicies().includes(p as never));
    expect(added).toEqual([
      {
        name: 'sys_attachment_parent_editor_delete',
        object: 'sys_attachment',
        operation: 'delete',
        using: 'id != null',
        positions: ['org_member'],
      },
    ]);
    const floorIndex = out.findIndex((p) => p.name === 'owner_only_deletes');
    expect(out[floorIndex + 1]).toBe(added[0]);
    expect(isPlatformOwnershipFloorPolicy(added[0]!)).toBe(true);
    // The edit limb gained nothing.
    expect(out.filter((p) => p.operation === 'update')).toEqual(
      memberDefaultPolicies().filter((p) => p.operation === 'update'),
    );
  });

  it('a set that ships no floor is returned as-is (same array, nothing added)', () => {
    for (const name of ['viewer_readonly', 'admin_full_access', 'organization_admin']) {
      const policies = (setByName(name).rowLevelSecurity ?? []) as RowLevelSecurityPolicy[];
      expect(withOwnershipFloorAlternates(policies, [ATTACHMENT_DELETE]), name).toBe(policies);
    }
  });

  it('a switched-off floor has nothing to relieve', () => {
    const policies = memberDefaultPolicies().map((p) => (p.name === 'owner_only_deletes' ? { ...p, enabled: false } : p));
    // Still the shipped floor by provenance key — but switched off, so not evaluated.
    expect(withOwnershipFloorAlternates(policies, [ATTACHMENT_DELETE])).toBe(policies);
  });

  it('an authored policy spelling the floor predicate is not the floor, and gains no alternate', () => {
    const authored: RowLevelSecurityPolicy[] = [
      { name: 'my_owner_deletes', object: '*', operation: 'delete', using: 'created_by == current_user.id', positions: ['org_member'] },
    ];
    expect(withOwnershipFloorAlternates(authored, [ATTACHMENT_DELETE])).toBe(authored);
  });

  it('floor provenance is identity, not spelling: an authored copy of the alternate is not the floor', () => {
    const authoredTwin = { ...ATTACHMENT_DELETE, positions: ['org_member'] };
    expect(isPlatformOwnershipFloorPolicy(authoredTwin)).toBe(false);
  });

  it('no contribution: the input array itself', () => {
    const policies = memberDefaultPolicies();
    expect(withOwnershipFloorAlternates(policies, [])).toBe(policies);
  });
});

// ── 3. byte-identity through the real plugin ──────────────────────────────

const FIELDS = (extra: string[]) =>
  Object.fromEntries(['id', 'created_by', 'organization_id', ...extra].map((f) => [f, { name: f, type: 'text' }]));
const SCHEMAS: Record<string, unknown> = {
  sys_attachment: { name: 'sys_attachment', isSystem: true, fields: FIELDS(['parent_object', 'parent_id', 'uploaded_by']) },
  sys_comment: { name: 'sys_comment', isSystem: true, fields: FIELDS(['thread_id', 'body']) },
  account: { name: 'account', fields: FIELDS(['name']) },
};

const MEMBER = { userId: 'u_member', tenantId: 'org-1', positions: ['org_member', 'everyone'], permissions: [], posture: 'MEMBER' };
const ORGLESS = { userId: 'u_orgless', positions: ['everyone'], permissions: [], posture: 'MEMBER' };
const ORG_ADMIN = { userId: 'u_admin', tenantId: 'org-1', positions: ['org_admin', 'everyone'], permissions: ['organization_admin'], posture: 'ORG_ADMIN' };
const AGENT = {
  userId: 'u_agent',
  tenantId: 'org-1',
  positions: ['org_member', 'everyone'],
  permissions: ['mcp_agent_data_write'],
  principalKind: 'agent',
  posture: 'MEMBER',
};
const PRINCIPALS = { MEMBER, ORGLESS, ORG_ADMIN, AGENT } as const;
const OBJECTS = ['sys_attachment', 'sys_comment', 'account'] as const;
const OPERATIONS = ['delete', 'update', 'find', 'insert'] as const;

async function boot() {
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: vi.fn(),
      getSchema: (name: string) => SCHEMAS[name],
      find: vi.fn(async () => []),
      findOne: vi.fn(async (object: string, options: unknown) => {
        // As strict as `ObjectQL.findOne`: this fake never serves a row, so the
        // only thing it can get wrong is accepting a call the engine refuses.
        assertEngineFindOnePredicate(object, options as never);
        return null;
      }),
    },
    metadata: {
      get: async (_type: string, name: string) => SCHEMAS[name],
      list: async () => [],
    },
  };
  const registerService = vi.fn();
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin();
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  const security = registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
  if (typeof security?.contributeOwnershipFloorAlternates !== 'function') {
    throw new Error('the registered security service does not expose contributeOwnershipFloorAlternates');
  }
  return { plugin: plugin as any, security };
}

/** Every cell's collected policies AND compiled filter, as one comparable string per cell. */
async function measure(plugin: any): Promise<Record<string, string>> {
  const cells: Record<string, string> = {};
  for (const [who, context] of Object.entries(PRINCIPALS)) {
    const sets = await plugin.resolvePermissionSetsForContext({ ...context });
    for (const object of OBJECTS) {
      for (const operation of OPERATIONS) {
        const collected = plugin.collectRLSPolicies(sets, object, operation, context.positions);
        const filter = await plugin.computeRlsFilter(sets, object, operation, { ...context });
        cells[`${who} ${object} ${operation}`] = JSON.stringify({ collected, filter });
      }
    }
  }
  return cells;
}

describe('byte-identity: only the in-domain member’s sys_attachment delete moves', () => {
  it('contributing the delete alternate changes exactly one cell, and withdrawing it restores every cell', async () => {
    const { plugin, security } = await boot();
    const before = await measure(plugin);

    security.contributeOwnershipFloorAlternates('com.objectstack.service.storage', [ATTACHMENT_DELETE]);
    const after = await measure(plugin);

    const moved = Object.keys(before).filter((cell) => before[cell] !== after[cell]);
    expect(moved).toEqual(['MEMBER sys_attachment delete']);

    // The moved cell gained the alternate as an OR beside the floor — the
    // floor itself is still there, so it can only widen that class.
    const was = JSON.parse(before['MEMBER sys_attachment delete']!);
    const now = JSON.parse(after['MEMBER sys_attachment delete']!);
    expect(was.collected.map((p: any) => p.name)).toEqual(['owner_only_deletes']);
    expect(now.collected.map((p: any) => p.name)).toEqual(['owner_only_deletes', 'sys_attachment_parent_editor_delete']);
    expect(now.collected[1].positions).toEqual(['org_member']);
    expect(JSON.stringify(now.filter)).not.toBe(JSON.stringify(was.filter));

    security.contributeOwnershipFloorAlternates('com.objectstack.service.storage', []);
    expect(await measure(plugin)).toEqual(before);
  });

  it('the seam refuses a widening to both limbs at once, and nothing moves', async () => {
    const { plugin, security } = await boot();
    const before = await measure(plugin);
    expect(() =>
      security.contributeOwnershipFloorAlternates('com.objectstack.service.storage', [{ ...ATTACHMENT_DELETE, operation: 'all' }]),
    ).toThrow(/is not one floor limb/);
    expect(await measure(plugin)).toEqual(before);
  });
});
