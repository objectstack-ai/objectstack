// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0057 D1 — scope-depth WRITE grants on the real showcase app.
//
// `writeScope` widens the owner-set an owner-scoped (`private`) object accepts
// EDITS from, the way `readScope` widens reads — and the two axes are
// consulted INDEPENDENTLY (permission-evaluator.getEffectiveScope reads
// `op.writeScope` for the write class, absent → 'own'; sharing-service.canEdit
// widens its owner-match by `__writeScope`). The sibling proof
// (showcase-scope-depth) covers the read axis; until the 2026-07 security-
// subset re-verification the write axis was `live` on two cited readers but
// carried no runtime proof — this file is that proof.
//
// Three postures, each asserted on POST-STATE (a SYSTEM read of the row after
// the attempt), not just the HTTP status:
//   1. writeScope 'unit'  → a BU co-member's note IS editable; a CHILD-BU
//      member's note is NOT ('unit' does not descend).
//   2. writeScope absent under readScope 'unit' → the co-member's note is
//      READABLE yet NOT editable — the write axis defaults to 'own' and gates
//      on its own, independent of how wide reads are.
//   3. the hierarchy seam fails CLOSED: same 'unit' grant, no enterprise
//      resolver registered → co-member edit is denied (owner-only), never
//      fail-open.
//
// @proof: showcase-scope-depth-write

import { describe, it, expect, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { PermissionSetSchema } from '@objectstack/spec/security';

const OBJ = '/data/showcase_private_note';
const WHO = ['alice', 'bob', 'carol'] as const;
type Who = (typeof WHO)[number];

function writeProfile(tag: string, writeScope?: 'unit') {
  return PermissionSetSchema.parse({
    name: `wscope_${tag}_profile`,
    label: `Write-scope ${tag}`,
    isDefault: true,
    objects: {
      showcase_private_note: {
        allowRead: true,
        allowCreate: true,
        allowEdit: true,
        readScope: 'unit',
        // Posture 2 authors NO writeScope at all — the axis under test must
        // come from the schema-default 'own', not from an explicit value.
        ...(writeScope ? { writeScope } : {}),
      },
    },
  });
}

interface World {
  stack: VerifyStack;
  tokens: Record<Who, string>;
  noteIds: Record<Who, string>;
  ql: any;
}

// BU world: alice+carol ∈ bu_parent, bob ∈ bu_child (child of parent).
// Each owns one note. Reference hierarchy resolver as in showcase-scope-depth
// (test fixture for the enterprise seam) — only the 'unit' branch is needed.
async function bootWriteWorld(tag: string, opts: { writeScope?: 'unit'; withResolver?: boolean }): Promise<World> {
  const stack = await bootStack(showcaseStack, {
    security: new SecurityPlugin({
      defaultPermissionSets: [...securityDefaultPermissionSets, writeProfile(tag, opts.writeScope)],
    }),
  });
  await stack.signIn();
  const tokens = {} as Record<Who, string>;
  for (const who of WHO) tokens[who] = await stack.signUp(`wscope-${who}-${tag}@verify.test`);

  const ql: any = await stack.kernel.getServiceAsync('objectql');
  const SYS = { isSystem: true } as const;
  const sys = (o: string, d: any) => ql.insert(o, d, { context: SYS });

  if (opts.withResolver !== false) {
    (stack.kernel as any).registerService('hierarchy-scope-resolver', {
      async resolveOwnerIds(c: any, sc: string): Promise<string[]> {
        const meId = String(c.userId ?? '');
        const ids = new Set<string>([meId]);
        if (sc !== 'unit') return [...ids];
        const mine = await ql.find('sys_business_unit_member', { where: { user_id: meId }, fields: ['business_unit_id'], context: SYS });
        const buIds = [...new Set((mine ?? []).map((r: any) => String(r.business_unit_id ?? '')).filter(Boolean))];
        if (!buIds.length) return [...ids];
        const members = await ql.find('sys_business_unit_member', { where: { business_unit_id: { $in: buIds } }, fields: ['user_id'], context: SYS });
        for (const m of members ?? []) { const u = String(m.user_id ?? ''); if (u) ids.add(u); }
        return [...ids];
      },
    });
  }

  const id = {} as Record<Who, string>;
  for (const who of WHO) {
    id[who] = (await ql.findOne('sys_user', { where: { email: `wscope-${who}-${tag}@verify.test` }, context: SYS }))?.id;
    expect(id[who], `${who} resolved`).toBeTruthy();
  }

  let orgId = (await ql.findOne('sys_organization', { where: {}, context: SYS }).catch(() => null))?.id;
  if (!orgId) { orgId = `org_w_${tag}`; await sys('sys_organization', { id: orgId, name: 'WScope Org', slug: `wscope_${tag}` }).catch(() => {}); }

  await sys('sys_business_unit', { id: `bu_wparent_${tag}`, name: 'Parent', kind: 'division', organization_id: orgId, active: true });
  await sys('sys_business_unit', { id: `bu_wchild_${tag}`, name: 'Child', kind: 'department', parent_business_unit_id: `bu_wparent_${tag}`, organization_id: orgId, active: true });
  await sys('sys_business_unit_member', { id: `wm_a_${tag}`, business_unit_id: `bu_wparent_${tag}`, user_id: id.alice });
  await sys('sys_business_unit_member', { id: `wm_c_${tag}`, business_unit_id: `bu_wparent_${tag}`, user_id: id.carol });
  await sys('sys_business_unit_member', { id: `wm_b_${tag}`, business_unit_id: `bu_wchild_${tag}`, user_id: id.bob });

  const noteIds = {} as Record<Who, string>;
  for (const who of WHO) {
    const r = await stack.apiAs(tokens[who], 'POST', OBJ, { title: `${who} ${tag} note` });
    expect(r.status, `${who} creates note`).toBeLessThan(300);
    const body: any = await r.json().catch(() => ({}));
    noteIds[who] = body?.id ?? body?.record?.id
      ?? (await ql.findOne('showcase_private_note', { where: { title: `${who} ${tag} note` }, context: SYS }))?.id;
    expect(noteIds[who], `${who} note id resolved`).toBeTruthy();
  }
  return { stack, tokens, noteIds, ql };
}

/** PATCH as `who`, then report the row's REAL title from a system read. */
async function tryEdit(w: World, who: Who, targetId: string, newTitle: string): Promise<{ status: number; titleAfter: string }> {
  const r = await w.stack.apiAs(w.tokens[who], 'PATCH', `${OBJ}/${targetId}`, { title: newTitle });
  const row = await w.ql.findOne('showcase_private_note', { where: { id: targetId }, context: { isSystem: true } });
  return { status: r.status, titleAfter: String(row?.title ?? '') };
}

describe('showcase: scope-depth write — `unit` widens edits to BU co-members (ADR-0057 D1)', () => {
  let w: World;
  afterAll(async () => { await w?.stack?.stop(); });

  it('boots', async () => { w = await bootWriteWorld('u', { writeScope: 'unit' }); }, 120_000);

  it("a co-member's note IS editable under writeScope 'unit'", async () => {
    const r = await tryEdit(w, 'alice', w.noteIds.carol, 'edited by alice');
    expect(r.status, 'co-member edit accepted').toBeLessThan(300);
    expect(r.titleAfter, 'the write actually landed').toBe('edited by alice');
  });

  it("a CHILD-BU member's note is NOT editable — 'unit' does not descend", async () => {
    const r = await tryEdit(w, 'alice', w.noteIds.bob, 'must not land');
    expect(r.status, 'child-BU edit rejected').toBeGreaterThanOrEqual(400);
    expect(r.titleAfter, 'row untouched').toBe('bob u note');
  });
});

describe('showcase: scope-depth write — absent writeScope stays owner-only even under a wide readScope', () => {
  let w: World;
  afterAll(async () => { await w?.stack?.stop(); });

  it('boots', async () => { w = await bootWriteWorld('d', { /* no writeScope */ }); }, 120_000);

  it("the co-member's note is READABLE (readScope 'unit')…", async () => {
    const r = await w.stack.apiAs(w.tokens.alice, 'GET', `${OBJ}/${w.noteIds.carol}`);
    expect(r.status, 'read widened by readScope').toBe(200);
  });

  it('…yet NOT editable — the write axis defaults to own and gates independently', async () => {
    const r = await tryEdit(w, 'alice', w.noteIds.carol, 'must not land');
    expect(r.status, 'write denied despite readability').toBeGreaterThanOrEqual(400);
    expect(r.titleAfter, 'row untouched').toBe('carol d note');
  });

  it('the owner still edits their own note', async () => {
    const r = await tryEdit(w, 'alice', w.noteIds.alice, 'alice edits herself');
    expect(r.status).toBeLessThan(300);
    expect(r.titleAfter).toBe('alice edits herself');
  });
});

describe('open edition — a hierarchy writeScope fails CLOSED without the enterprise resolver', () => {
  let w: World;
  afterAll(async () => { await w?.stack?.stop(); });

  it('boots', async () => { w = await bootWriteWorld('f', { writeScope: 'unit', withResolver: false }); }, 120_000);

  it("writeScope 'unit' degrades to owner-only — a co-member edit is denied, never fail-open", async () => {
    const r = await tryEdit(w, 'alice', w.noteIds.carol, 'must not land');
    expect(r.status, 'unresolvable hierarchy scope = deny').toBeGreaterThanOrEqual(400);
    expect(r.titleAfter, 'row untouched').toBe('carol f note');
  });
});
