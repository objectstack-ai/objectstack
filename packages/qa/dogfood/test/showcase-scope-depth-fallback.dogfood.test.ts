// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D7 + ADR-0057 D1 — app-declared DEFAULT PROFILE honored via the CLI
// wiring (`appDefaultPermissionSetName` → SecurityPlugin `fallbackPermissionSet`),
// resolved BY NAME from metadata, carrying a hierarchy `readScope`.
//
// This is the companion to `showcase-scope-depth.dogfood.test.ts`. That test
// injects the scope profile directly as a SecurityPlugin `defaultPermissionSet`
// (an in-memory bootstrap set). THIS test exercises the path that
// `objectstack dev`/`serve`/`start` actually take: the app declares the default
// profile in METADATA, the CLI computes its name with `appDefaultPermissionSetName`
// and passes only that NAME as `fallbackPermissionSet`, and the SecurityPlugin
// resolves the full set (incl. `readScope`) from `sys_permission_set` at request
// time. The bug this guards: the artifact-serve path used to drop `permissions[]`
// from the stack config, so `appDefaultPermissionSetName` saw nothing, the fallback
// silently degraded to the built-in owner-only `member_default`, and a grant-less
// user never got the app's declared `readScope` widening.
//
// @proof: showcase-scope-depth-fallback

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, appDefaultPermissionSetName } from '@objectstack/plugin-security';

const OBJ = '/data/showcase_private_note';
const WHO = ['alice', 'bob', 'carol', 'dave'] as const;
type Who = (typeof WHO)[number];

const PROFILE_NAME = 'scope_fallback_unit_and_below';

// The app-declared default profile, as it appears in stack `permissions[]`
// metadata. `isDefault: true` is what `appDefaultPermissionSetName` keys off.
const DEFAULT_PROFILE_METADATA = {
  name: PROFILE_NAME,
  label: 'Scope Fallback (unit_and_below)',
  isDefault: true,
  objects: {
    showcase_private_note: {
      allowRead: true, allowCreate: true, allowEdit: true,
      readScope: 'unit_and_below', writeScope: 'unit_and_below',
    },
  },
};

interface World { stack: VerifyStack; tokens: Record<Who, string>; }

// Same BU world as the reference test: bu_parent ⊃ bu_child (sibling bu_other).
// alice+carol ∈ bu_parent, bob ∈ bu_child, dave ∈ bu_other. Each owns one note.
// The scope profile is NOT passed as a bootstrap permission set — it is seeded
// into `sys_permission_set` (the runtime home of an app-declared `permission`)
// and reached only by NAME via `fallbackPermissionSet`.
async function bootFallbackWorld(withResolver = true): Promise<World> {
  const stack = await bootStack(showcaseStack, {
    // Mirror the CLI exactly: the app's isDefault profile name, computed off the
    // declared `permissions[]`, handed to SecurityPlugin as the fallback. No
    // `defaultPermissionSets` carry the scope profile — it must resolve from DB.
    security: new SecurityPlugin({
      fallbackPermissionSet: appDefaultPermissionSetName([DEFAULT_PROFILE_METADATA]),
    }),
  });
  await stack.signIn();
  const tokens = {} as Record<Who, string>;
  for (const who of WHO) tokens[who] = await stack.signUp(`fb-${who}@verify.test`);

  const ql: any = await stack.kernel.getServiceAsync('objectql');
  const sys = (o: string, d: any) => ql.insert(o, d, { context: { isSystem: true } });

  // Reference hierarchy-scope resolver (test fixture; prod = @objectstack/security-enterprise).
  const refResolver = {
    async resolveOwnerIds(c: any, sc: string): Promise<string[]> {
      const meId = c.userId as string;
      const ids = new Set<string>([meId]);
      const myBus = await ql.find('sys_business_unit_member', { where: { user_id: meId }, fields: ['business_unit_id'], context: { isSystem: true } });
      let buIds: string[] = [...new Set((myBus ?? []).map((r: any) => String(r.business_unit_id ?? '')).filter(Boolean))] as string[];
      if (!buIds.length) return [meId];
      if (sc === 'unit_and_below') {
        const allBu = new Set<string>(buIds); let frontier: string[] = [...buIds];
        for (let d = 0; d < 20 && frontier.length; d++) {
          const kids = await ql.find('sys_business_unit', { where: { parent_business_unit_id: { $in: frontier } }, fields: ['id'], context: { isSystem: true } });
          const next: string[] = [];
          for (const k of kids ?? []) { const id = String(k.id ?? ''); if (id && !allBu.has(id)) { allBu.add(id); next.push(id); } }
          frontier = next;
        }
        buIds = [...allBu];
      }
      const m = await ql.find('sys_business_unit_member', { where: { business_unit_id: { $in: buIds } }, fields: ['user_id'], context: { isSystem: true } });
      for (const x of m ?? []) { const u = String(x.user_id ?? ''); if (u) ids.add(u); }
      return [...ids];
    },
  };
  if (withResolver) (stack.kernel as any).registerService('hierarchy-scope-resolver', refResolver);

  // Seed the app-declared profile into `sys_permission_set` — this is what an
  // app `permission` metadata becomes at runtime, and what the named fallback
  // resolves through the SecurityPlugin dbLoader. `readScope` rides inside
  // object_permissions JSON.
  await sys('sys_permission_set', {
    name: PROFILE_NAME,
    label: DEFAULT_PROFILE_METADATA.label,
    active: true,
    object_permissions: JSON.stringify(DEFAULT_PROFILE_METADATA.objects),
  });

  const uid = async (who: Who) =>
    (await ql.findOne('sys_user', { where: { email: `fb-${who}@verify.test` }, context: { isSystem: true } }))?.id;
  const id = {} as Record<Who, string>;
  for (const who of WHO) id[who] = await uid(who);

  let org = await ql.findOne('sys_organization', { where: {}, context: { isSystem: true } }).catch(() => null);
  let orgId = org?.id;
  if (!orgId) { orgId = 'org_fb'; await sys('sys_organization', { id: orgId, name: 'FB Org', slug: 'fb' }).catch(() => {}); }

  await sys('sys_business_unit', { id: 'bu_parent_fb', name: 'Parent', kind: 'division', organization_id: orgId, active: true });
  await sys('sys_business_unit', { id: 'bu_child_fb', name: 'Child', kind: 'department', parent_business_unit_id: 'bu_parent_fb', organization_id: orgId, active: true });
  await sys('sys_business_unit', { id: 'bu_other_fb', name: 'Other', kind: 'division', organization_id: orgId, active: true });
  await sys('sys_business_unit_member', { id: 'm_a_fb', business_unit_id: 'bu_parent_fb', user_id: id.alice });
  await sys('sys_business_unit_member', { id: 'm_c_fb', business_unit_id: 'bu_parent_fb', user_id: id.carol });
  await sys('sys_business_unit_member', { id: 'm_b_fb', business_unit_id: 'bu_child_fb', user_id: id.bob });
  await sys('sys_business_unit_member', { id: 'm_d_fb', business_unit_id: 'bu_other_fb', user_id: id.dave });

  for (const who of WHO) {
    const r = await stack.apiAs(tokens[who], 'POST', OBJ, { title: `${who} note` });
    expect(r.status, `${who} creates note (fallback grants allowCreate)`).toBeLessThan(300);
  }
  return { stack, tokens };
}

async function titles(stack: VerifyStack, token: string): Promise<string[]> {
  const r = await stack.apiAs(token, 'GET', OBJ);
  expect(r.status).toBe(200);
  const b: any = await r.json();
  return (b.records ?? b.data ?? b ?? []).map((x: any) => x.title).filter(Boolean);
}

describe('app-default-permission-set via fallbackPermissionSet (ADR-0056 D7 / ADR-0057 D1)', () => {
  it('appDefaultPermissionSetName picks the isDefault profile name (the CLI helper)', () => {
    expect(appDefaultPermissionSetName([DEFAULT_PROFILE_METADATA])).toBe(PROFILE_NAME);
    // an add-on (isDefault absent) is never chosen as the default
    expect(appDefaultPermissionSetName([{ name: 'addon', isDefault: true }])).toBe('addon');
  });
});

describe('fallback profile honored: readScope `unit_and_below` widens the matrix', () => {
  let world: World;
  beforeAll(async () => { world = await bootFallbackWorld(true); }, 120_000);
  afterAll(async () => { await world?.stack?.stop(); });

  it('a grant-less member gets the app default profile, not owner-only member_default', async () => {
    const t = await titles(world.stack, world.tokens.alice);
    expect(t).toContain('alice note');   // own
    expect(t).toContain('carol note');   // same BU — widened by the fallback profile's readScope
    expect(t).toContain('bob note');     // child BU — unit_and_below subtree descent
    expect(t).not.toContain('dave note'); // sibling root — still isolated
  });

  it('the child member does NOT roll up into the parent', async () => {
    const t = await titles(world.stack, world.tokens.bob);
    expect(t.sort()).toEqual(['bob note']);
  });
});

describe('open edition — same fallback profile fails CLOSED without the enterprise resolver', () => {
  let world: World;
  beforeAll(async () => { world = await bootFallbackWorld(false); }, 120_000);
  afterAll(async () => { await world?.stack?.stop(); });

  it('a `unit_and_below` fallback degrades to owner-only — no widening, never fail-open', async () => {
    const t = await titles(world.stack, world.tokens.alice);
    expect(t).toContain('alice note');      // own still works
    expect(t).not.toContain('carol note');  // NO widening without @objectstack/security-enterprise
    expect(t).not.toContain('bob note');
    expect(t).not.toContain('dave note');
  });
});
