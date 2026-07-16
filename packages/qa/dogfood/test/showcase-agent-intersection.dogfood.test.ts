// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0090 D10 — agent/service intersection, proven against the REAL served
// engine (real RLS compiler, real SQLite, real private-OWD + VAMA bypass).
//
// The unit suite (`security-plugin.test.ts` → "ADR-0090 D10 agent
// intersection") drives the real middleware with mocked ql/metadata. This
// dogfood closes the last gap the plan flagged as the biggest risk — delegator
// RLS FIDELITY: does the reconstructed delegator context substitute correctly
// into a real compiled `owner_id = current_user.id` policy, and does the
// intersection actually STRIP an agent's View-All when the delegator lacks it?
//
// Scenario: an agent holding `showcase_auditor` (viewAllRecords on the private
// note) acts on behalf of a PLAIN member (baseline member_default, own-only).
// Alone, the agent's View-All lets it read another user's private note. Acting
// on behalf of the plain member, the D10 intersection must hide that row — the
// agent may not see what the user it stands in for cannot.
//
// @proof: showcase-agent-intersection

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true } as const;

describe('showcase: ADR-0090 D10 agent intersection (served engine)', () => {
  let stack: VerifyStack;
  let ql: any;
  let ownerTok: string;
  let agentId: string, delId: string, ownerId: string;
  let othersNoteId: string, delsNoteId: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn(); // admin (ensures bootstrap)
    ownerTok = await stack.signUp('int-owner@verify.test');
    await stack.signUp('int-agent@verify.test');
    const delTok = await stack.signUp('int-del@verify.test');

    ql = await stack.kernel.getServiceAsync('objectql');
    agentId = await uid('int-agent@verify.test');
    delId = await uid('int-del@verify.test');
    ownerId = await uid('int-owner@verify.test');

    // The agent holds the auditor set (viewAllRecords on the private note); the
    // delegator holds NOTHING beyond the additive member_default baseline.
    const auditor = await ql.findOne('sys_permission_set', { where: { name: 'showcase_auditor' }, context: SYS });
    expect(auditor?.id, 'showcase_auditor seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: agentId, permission_set_id: auditor.id }, { context: SYS });

    // A private note owned by int-owner (NOT the delegator) — the VAMA probe.
    const other = await stack.apiAs(ownerTok, 'POST', '/data/showcase_private_note', { title: "someone else's note" });
    expect(other.status, 'owner creates a private note').toBeLessThan(300);
    othersNoteId = (await other.json())?.id
      ?? (await ql.findOne('showcase_private_note', { where: { title: "someone else's note" }, context: SYS }))?.id;
    expect(othersNoteId, "other's note id").toBeTruthy();

    // A private note owned by the delegator — visible to BOTH principals.
    const delTokNote = await stack.apiAs(delTok, 'POST', '/data/showcase_private_note', { title: "delegator's own note" });
    delsNoteId = (await delTokNote.json())?.id
      ?? (await ql.findOne('showcase_private_note', { where: { title: "delegator's own note" }, context: SYS }))?.id;
    expect(delsNoteId, "delegator's note id").toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // Agent context as it reaches the engine middleware (auth layer resolved the
  // agent's own grants into `permissions`; the delegator's are reconstructed
  // from the DB by the D10 path).
  const agentAlone = () => ({ userId: agentId, positions: [], permissions: ['showcase_auditor'] });
  const agentOnBehalf = () => ({
    userId: agentId, positions: [], permissions: ['showcase_auditor'],
    principalKind: 'agent', onBehalfOf: { userId: delId, principalKind: 'human' },
  });

  const idsVisible = async (ctx: any): Promise<Set<string>> => {
    const rows = await ql.find('showcase_private_note', { where: {}, context: ctx });
    return new Set((Array.isArray(rows) ? rows : []).map((r: any) => r.id));
  };

  it("baseline: the agent's View-All alone reads another user's private note", async () => {
    const seen = await idsVisible(agentAlone());
    expect(seen.has(othersNoteId), 'VAMA bypass surfaces the private row').toBe(true);
  });

  it("D10: acting on behalf of a plain member, the agent can NO LONGER see that note (View-All stripped)", async () => {
    const seen = await idsVisible(agentOnBehalf());
    expect(seen.has(othersNoteId), 'intersection hides a row the delegator cannot see').toBe(false);
  });

  it("D10: the agent still sees the DELEGATOR's own note (both principals may read it)", async () => {
    const seen = await idsVisible(agentOnBehalf());
    expect(seen.has(delsNoteId), "the delegator's own row survives the intersection").toBe(true);
  });

  it('a dangling on-behalf-of link (deleted delegator) fails CLOSED', async () => {
    const ctx = { userId: agentId, positions: [], permissions: ['showcase_auditor'], onBehalfOf: { userId: 'user_does_not_exist' } };
    await expect(ql.find('showcase_private_note', { where: {}, context: ctx })).rejects.toBeTruthy();
  });

  it('explain() attributes the D10 intersection: alone allowed, on-behalf-of narrows', async () => {
    const security: any = stack.kernel.getService('security');
    // Self-explain carries onBehalfOf through unchanged (request.userId omitted).
    const decision = await security.explain(
      { object: 'showcase_private_note', operation: 'read' },
      agentOnBehalf(),
    );
    const principal = (decision?.layers ?? []).find((l: any) => l.layer === 'principal');
    expect(principal?.detail, 'principal layer names the delegator intersection').toMatch(/on behalf of/i);
    expect(decision?.principal?.onBehalfOf?.userId).toBe(delId);
  });
});
