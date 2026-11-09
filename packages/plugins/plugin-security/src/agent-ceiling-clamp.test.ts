// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] The agent ceiling at evaluation: what the clamp clears, what
 * it leaves, that it never mutates a set it is handed, that the first-party
 * OAuth ceiling sets are untouched by it (the OAuth CONTROL, measured), and
 * that the security plugin applies it to every agent principal's sets and to
 * no person's.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { MCP_AGENT_PERMISSION_SETS, MCP_AGENT_PERMISSION_SET_RESTRICTED } from '@objectstack/spec/ai';

import {
  AGENT_CEILING_OBJECT_KEYS,
  agentCeilingBreaches,
  clampPermissionSetToAgentCeiling,
  clampPermissionSetsToAgentCeiling,
} from './agent-ceiling-clamp.js';
import { DESTRUCTIVE_CLASS_KEYS } from './permission-evaluator.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SecurityPlugin } from './security-plugin.js';

/** Every bit the ceiling forbids, on one object and on the wildcard, plus a system permission and an admin scope. */
const BREACHING = {
  name: 'ops_super',
  label: 'Ops superuser',
  objects: {
    crm_lead: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowExport: true,
      viewAllRecords: true, modifyAllRecords: true,
      allowTransfer: true, allowRestoreOwnDeleted: true, manageRecycleBin: true,
      readScope: 'org', writeScope: 'own',
    },
    '*': { allowRead: true, viewAllRecords: true, modifyAllRecords: true },
  },
  fields: { 'crm_lead.ssn': { readable: false, editable: false } },
  systemPermissions: ['manage_users'],
  adminScope: { businessUnit: 'bu_root', includeSubtree: true, manageAssignments: true, assignablePermissionSets: [] },
  tabPermissions: { crm_lead: 'visible' },
} as unknown as PermissionSet;

const CLEAN = {
  name: 'lead_reader',
  label: 'Lead reader',
  objects: { crm_lead: { allowRead: true, allowEdit: true, readScope: 'own' } },
} as unknown as PermissionSet;

describe('agentCeilingBreaches / clampPermissionSetToAgentCeiling', () => {
  it('the object bits it clears are the two bypass bits and the destructive class, derived from the evaluator', () => {
    expect([...AGENT_CEILING_OBJECT_KEYS]).toEqual(['viewAllRecords', 'modifyAllRecords', ...DESTRUCTIVE_CLASS_KEYS]);
    expect([...DESTRUCTIVE_CLASS_KEYS].sort()).toEqual(['allowRestoreOwnDeleted', 'allowTransfer', 'manageRecycleBin']);
  });

  it('names every breach, in a stable order', () => {
    expect(agentCeilingBreaches(BREACHING)).toEqual([
      'objects.crm_lead.viewAllRecords',
      'objects.crm_lead.modifyAllRecords',
      'objects.crm_lead.allowTransfer',
      'objects.crm_lead.allowRestoreOwnDeleted',
      'objects.crm_lead.manageRecycleBin',
      'objects.*.viewAllRecords',
      'objects.*.modifyAllRecords',
      'systemPermissions',
      'adminScope',
    ]);
    expect(agentCeilingBreaches(CLEAN)).toEqual([]);
  });

  it('reads the row spelling too: JSON-string columns, system_permissions and admin_scope', () => {
    expect(agentCeilingBreaches({
      name: 'row',
      objects: JSON.stringify({ t: { viewAllRecords: true } }),
      system_permissions: JSON.stringify(['manage_users']),
      admin_scope: JSON.stringify({ businessUnit: 'bu' }),
    })).toEqual(['objects.t.viewAllRecords', 'systemPermissions', 'adminScope']);
    expect(agentCeilingBreaches({ name: 'row', system_permissions: '[]', admin_scope: null })).toEqual([]);
  });

  it('clears exactly the breaching bits and leaves every ordinary grant as authored', () => {
    const clamped = clampPermissionSetToAgentCeiling(BREACHING) as any;
    expect(clamped.objects.crm_lead).toEqual({
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowExport: true,
      viewAllRecords: false, modifyAllRecords: false,
      allowTransfer: false, allowRestoreOwnDeleted: false, manageRecycleBin: false,
      readScope: 'org', writeScope: 'own',
    });
    expect(clamped.objects['*']).toEqual({ allowRead: true, viewAllRecords: false, modifyAllRecords: false });
    expect(clamped.systemPermissions).toEqual([]);
    expect('adminScope' in clamped).toBe(false);
    expect(clamped.fields).toEqual((BREACHING as any).fields);
    expect(clamped.tabPermissions).toEqual((BREACHING as any).tabPermissions);
    expect(clamped.name).toBe('ops_super');
    expect(agentCeilingBreaches(clamped)).toEqual([]);
  });

  it('never mutates the set it is handed: a clean set comes back as the same object, a breaching one as a fresh copy', () => {
    const before = JSON.stringify(BREACHING);
    const clamped = clampPermissionSetToAgentCeiling(BREACHING);
    expect(clamped).not.toBe(BREACHING);
    expect(JSON.stringify(BREACHING)).toBe(before);
    expect(clampPermissionSetToAgentCeiling(CLEAN)).toBe(CLEAN);
    expect(clampPermissionSetsToAgentCeiling([CLEAN, BREACHING]).map((s) => s.name)).toEqual(['lead_reader', 'ops_super']);
  });

  it('MEASURED: the first-party OAuth agent ceiling sets carry nothing the clamp clears — 0 of 3 clamped', () => {
    const ceilings = defaultPermissionSets.filter((s) => (MCP_AGENT_PERMISSION_SETS as readonly string[]).includes(s.name));
    expect(ceilings.map((s) => s.name).sort()).toEqual([...MCP_AGENT_PERMISSION_SETS].sort());
    const clampedCount = ceilings.filter((s) => agentCeilingBreaches(s).length > 0).length;
    expect(clampedCount).toBe(0);
    for (const s of ceilings) expect(clampPermissionSetToAgentCeiling(s)).toBe(s);
  });
});

describe('the security plugin reads every agent principal\'s sets under the ceiling, and no person\'s', () => {
  async function plugin() {
    const p = new SecurityPlugin({ fallbackPermissionSet: null });
    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      // An engine double: the middleware is registered and never driven here.
      objectql: { registerMiddleware: vi.fn(), getSchema: () => undefined, find: async () => [], findOne: async () => null },
      metadata: { get: async () => null, list: async () => [BREACHING, CLEAN] },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    } as any;
    await p.init(ctx);
    await p.start(ctx);
    return p as any;
  }

  it('an AI service account (agent, no onBehalfOf): the breaching set is clamped, and the restricted floor is its baseline', async () => {
    const p = await plugin();
    const sets: PermissionSet[] = await p.resolvePermissionSetsForContext({
      userId: 'u_bot', principalKind: 'agent', permissions: ['ops_super', 'lead_reader'], positions: ['org_member'],
    });
    expect(sets.map((s) => s.name)).toEqual(['ops_super', 'lead_reader']);
    for (const s of sets) expect(agentCeilingBreaches(s), s.name).toEqual([]);
    expect(sets.map((s) => s.name)).not.toContain('member_default');
  });

  it('an OAuth-delegated agent: the same clamp holds on its own side', async () => {
    const p = await plugin();
    const sets: PermissionSet[] = await p.resolvePermissionSetsForContext({
      userId: 'u_mia', principalKind: 'agent', onBehalfOf: { userId: 'u_mia', principalKind: 'human' }, permissions: ['ops_super'],
    });
    expect(sets.map((s) => s.name)).toEqual(['ops_super']);
    expect(agentCeilingBreaches(sets[0])).toEqual([]);
  });

  it('an agent whose sets resolve nothing falls back to the restricted set, still under the ceiling', async () => {
    const p = await plugin();
    const sets: PermissionSet[] = await p.resolvePermissionSetsForContext({ userId: 'u_bot', principalKind: 'agent', permissions: ['no_such_set'] });
    expect(sets.map((s) => s.name)).toEqual([MCP_AGENT_PERMISSION_SET_RESTRICTED]);
  });

  it('CONTROL: a person holding the same set keeps every bit of it', async () => {
    const p = await plugin();
    const sets: PermissionSet[] = await p.resolvePermissionSetsForContext({
      userId: 'u_mia', principalKind: 'human', permissions: ['ops_super'],
    });
    const held = sets.find((s) => s.name === 'ops_super');
    expect(held).toBe(BREACHING);
    expect(agentCeilingBreaches(held)).toHaveLength(9);
  });
});
