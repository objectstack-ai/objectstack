// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0095 D1, 2026-10-18 note; ruling of record 6250748677 on #24164, letter
 * E′ items 3 and 5] The platform identity objects declare their default row
 * scope (`ObjectSchema.defaultRowScope`), and what each declares is the policy
 * this package's shipped permission sets carry for that object today — read
 * here off `defaultPermissionSets`, never retyped.
 *
 * Three pins:
 *   1. The declarers are exactly the 23 objects the ruling names: every object
 *      `@objectstack/platform-objects` and `@objectstack/plugin-audit` register
 *      that declares a default is on the list, every listed object declares
 *      one, and the platform-global objects declare none (item 5).
 *   2. Each declaration is the shipped literal with `object` dropped: same
 *      name, operation and predicate as the baseline set's policy for the
 *      object, and every shipped set that carries a policy for it carries the
 *      same predicate.
 *   3. `sys_user` is the one merge: the key holds one policy, so its two
 *      shipped literals (`sys_user_self`, `sys_user_org_members`) are joined
 *      with `||`, and the merged predicate admits exactly the union of the two
 *      literals' rows whenever `org_user_ids` is resolved.
 *
 * No reader of the key is wired yet, and the shipped sets keep their spreads,
 * so nothing here moves a served row.
 */

import { describe, it, expect } from 'vitest';
import * as PlatformObjects from '@objectstack/platform-objects';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { defaultPermissionSets } from './default-permission-sets.js';
import { RLSCompiler } from '../rls-compiler.js';

type Policy = {
  name: string;
  object?: string;
  operation: string;
  using?: string;
  check?: string;
  positions?: string[];
  enabled?: boolean;
};
type ObjectDef = { name: string; fields?: Record<string, unknown>; defaultRowScope?: Policy };

/** The 23 declarers ruling E′ item 3 names, by the literal family that carries each today. */
const DECLARERS = [
  // `scimProjectionRowScope`
  'sys_scim_user',
  'sys_scim_subject',
  'sys_scim_projection_grant',
  'sys_scim_identity_tombstone',
  'sys_scim_group',
  'sys_scim_group_member',
  'sys_scim_connection_binding',
  // `privateCredentialRowScope`
  'sys_verification',
  'sys_jwks',
  // the identity `_self` / `_org_members` carve-outs
  'sys_organization',
  'sys_user',
  'sys_session',
  'sys_account',
  'sys_team_member',
  'sys_two_factor',
  'sys_user_preference',
  'sys_api_key',
  'sys_device_code',
  'sys_oauth_access_token',
  'sys_oauth_refresh_token',
  'sys_oauth_consent',
  'sys_oauth_application',
  // `auditLedgerRowScope`
  'sys_audit_log',
] as const;

/** Ruling E′ item 5: the platform-global objects declare no default. */
const PLATFORM_GLOBAL = /^(sys_metadata|sys_job|sys_migration)|^(sys_platform_setting|sys_presence|sys_flow_dispatch)$/;

function isObjectDef(v: unknown): v is ObjectDef {
  return (
    typeof v === 'object' && v !== null && typeof (v as ObjectDef).name === 'string'
    && typeof (v as ObjectDef).fields === 'object'
  );
}

/** The objects `AuditPlugin` registers — `sys_audit_log` is plugin-audit's (ADR-0029 K2). */
async function auditPluginObjects(): Promise<ObjectDef[]> {
  const registered: Array<{ objects?: ObjectDef[] }> = [];
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    getService: (name: string) =>
      name === 'manifest' ? { register: (m: { objects?: ObjectDef[] }) => registered.push(m) } : undefined,
    registerService() {},
    hook() {},
  };
  await new AuditPlugin().init(ctx);
  return registered.flatMap((m) => m.objects ?? []);
}

async function registeredObjects(): Promise<Map<string, ObjectDef>> {
  const byName = new Map<string, ObjectDef>();
  for (const v of Object.values(PlatformObjects)) if (isObjectDef(v)) byName.set(v.name, v);
  for (const o of await auditPluginObjects()) byName.set(o.name, o);
  return byName;
}

const setNamed = (name: string) => {
  const set = defaultPermissionSets.find((s) => s.name === name);
  if (!set) throw new Error(`shipped set ${name} not found`);
  return set;
};
const policiesFor = (setName: string, object: string): Policy[] =>
  ((setNamed(setName).rowLevelSecurity ?? []) as Policy[]).filter((p) => p.object === object);

/** The declaration as the shipped literal spells it: `object` implied, `enabled` defaulted. */
const asLiteral = (object: string, scope: Policy): Policy => ({ ...scope, object, enabled: scope.enabled ?? true });

describe('the platform identity objects declare their default row scope (ruling E′ items 3 and 5)', () => {
  it('the declarers are exactly the 23 the ruling names, and the platform-global objects declare none', async () => {
    const objects = await registeredObjects();
    const declaring = [...objects.values()].filter((o) => o.defaultRowScope !== undefined).map((o) => o.name);

    expect([...declaring].sort()).toEqual([...DECLARERS].sort());
    expect(DECLARERS).toHaveLength(23);

    const platformGlobal = [...objects.keys()].filter((n) => PLATFORM_GLOBAL.test(n));
    // The census reached them: the item-5 list is not vacuous here.
    expect(platformGlobal).toEqual(expect.arrayContaining(['sys_metadata', 'sys_job', 'sys_migration', 'sys_platform_setting']));
    for (const name of platformGlobal) expect(objects.get(name)!.defaultRowScope, name).toBeUndefined();
  });

  it.each(DECLARERS.filter((n) => n !== 'sys_user'))(
    '%s declares the baseline set\'s literal for it, with `object` dropped',
    async (object) => {
      const declared = (await registeredObjects()).get(object)!.defaultRowScope!;
      const [baseline, ...more] = policiesFor('member_default', object);
      expect(more).toEqual([]);
      expect(asLiteral(object, declared)).toEqual(baseline);
      expect('object' in declared).toBe(false);

      // The organization-admin set carries the same literal, and every shipped
      // set that carries a policy for the object carries the same predicate.
      expect(policiesFor('organization_admin', object)).toEqual([baseline]);
      for (const set of defaultPermissionSets) {
        for (const p of policiesFor(set.name, object)) {
          expect({ set: set.name, name: p.name, using: p.using }).toEqual({
            set: set.name,
            name: declared.name,
            using: declared.using,
          });
        }
      }
    },
  );

  it('sys_user declares its two shipped literals as one `select` policy, the predicates joined with `||`', async () => {
    const declared = (await registeredObjects()).get('sys_user')!.defaultRowScope!;
    for (const setName of ['organization_admin', 'member_default', 'viewer_readonly']) {
      const self = policiesFor(setName, 'sys_user').find((p) => p.name === 'sys_user_self')!;
      const peers = policiesFor(setName, 'sys_user').find((p) => p.name === 'sys_user_org_members')!;
      expect(declared.using).toBe(`${self.using} || ${peers.using}`);
      // The peer arm is `select` in every set; the merged policy keeps it there.
      expect(peers.operation).toBe('select');
    }
    expect(declared).toMatchObject({ name: 'sys_user_self_or_org_members', operation: 'select' });
    expect(policiesFor('organization_admin', 'sys_user').map((p) => p.operation)).toEqual(['select', 'select']);
  });
});

/**
 * The rows a compiled filter admits, over a fixture — the three shapes the two
 * literals compile to (`{ id }`, `{ id: { $in } }`, `{ $or }`) and the deny
 * filter, which is itself an `{ id }` no row carries.
 */
function admits(filter: Record<string, unknown> | null, rows: Array<{ id: string }>): string[] {
  const match = (f: Record<string, unknown>, row: { id: string }): boolean =>
    Object.entries(f).every(([k, v]) => {
      if (k === '$or') return (v as Record<string, unknown>[]).some((g) => match(g, row));
      if (k === '$and') return (v as Record<string, unknown>[]).every((g) => match(g, row));
      const cell = (row as Record<string, unknown>)[k];
      if (v !== null && typeof v === 'object') {
        const ops = v as Record<string, unknown>;
        if (Object.keys(ops).some((op) => op !== '$in' && op !== '$eq')) {
          throw new Error(`fixture matcher: unhandled operator in ${JSON.stringify(ops)}`);
        }
        if ('$in' in ops && !(ops.$in as unknown[]).includes(cell)) return false;
        if ('$eq' in ops && ops.$eq !== cell) return false;
        return true;
      }
      return cell === v;
    });
  if (filter === null) return rows.map((r) => r.id);
  return rows.filter((r) => match(filter, r)).map((r) => r.id);
}

describe('sys_user\'s merged predicate admits the union of its two literals\' rows (rider: the key is one policy)', () => {
  const rows = ['u_me', 'u_peer_a', 'u_peer_b', 'u_stranger'].map((id) => ({ id }));
  const contexts = {
    'peers resolved': { userId: 'u_me', tenantId: 'org_1', org_user_ids: ['u_me', 'u_peer_a', 'u_peer_b'] },
    'peers resolved, self not among them': { userId: 'u_me', tenantId: 'org_1', org_user_ids: ['u_peer_a'] },
    'no organization (the resolver seeds [])': { userId: 'u_me', org_user_ids: [] },
  };

  it.each(Object.entries(contexts))('%s', async (_label, ctx) => {
    const declared = (await registeredObjects()).get('sys_user')!.defaultRowScope!;
    const merged = asLiteral('sys_user', declared) as any;
    const literals = policiesFor('organization_admin', 'sys_user') as any[];
    const compiler = new RLSCompiler();

    const mergedRows = admits(compiler.compileFilter([merged], ctx as any), rows);
    const unionRows = [
      ...new Set(literals.flatMap((p) => admits(compiler.compileFilter([p], ctx as any), rows))),
    ].sort();
    // Both literals, as the shipped sets OR-combine them, admit the same set.
    expect(admits(compiler.compileFilter(literals, ctx as any), rows).sort()).toEqual(unionRows);
    expect(mergedRows.sort()).toEqual(unionRows);
    expect(mergedRows).toContain('u_me');
    expect(mergedRows).not.toContain('u_stranger');
  });

  it('measured divergence: with `org_user_ids` unresolved the merged policy fails closed whole, own row included', async () => {
    const declared = (await registeredObjects()).get('sys_user')!.defaultRowScope!;
    const compiler = new RLSCompiler();
    const ctx = { userId: 'u_me', tenantId: 'org_1' } as any;
    expect(admits(compiler.compileFilter([asLiteral('sys_user', declared) as any], ctx), rows)).toEqual([]);
    // The two literals apart keep the self arm.
    expect(admits(compiler.compileFilter(policiesFor('organization_admin', 'sys_user') as any, ctx), rows)).toEqual(['u_me']);
  });
});
