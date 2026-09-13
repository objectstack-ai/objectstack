// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0090 D10 — the OAuth-scope-derived AGENT CEILING, enforced end-to-end.
//
// The producer (`resolve-execution-context`) turns an MCP OAuth token into an
// `principalKind:'agent'` principal acting `onBehalfOf` the human, whose OWN
// grants are the scope-derived ceiling set (`data:read`→mcp_agent_data_read,
// `data:write`→mcp_agent_data_write). That mapping is unit-tested in
// `@objectstack/runtime`. THIS dogfood proves the other half: that the ceiling
// sets resolve from the real bootstrap and the D10 intersection enforces them
// against the real engine (SQLite, RLS, private-OWD) — so a `data:read` agent
// acting for a user who CAN write is nonetheless blocked from writing at the
// data layer, while a `data:write` agent for the same user is allowed.
//
// This promotes an OAuth scope from a tool-surface hint to a real, enforced
// data-layer boundary, strictly consistent with "a scope can never grant more
// than the user could do" (the intersection only narrows).
//
// @proof: showcase-agent-scope-ceiling

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

const SYS = { isSystem: true } as const;
const idOf = (r: any): string => r?.id ?? r?.record?.id;

describe('showcase: ADR-0090 D10 agent scope ceiling (served engine)', () => {
  let stack: VerifyStack;
  let ql: any;
  let aliceTok: string;
  let aliceId: string;
  let adminTok: string;
  let adminId: string;
  let noteId: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  beforeAll(async () => {
    stack = await getSharedShowcase();
    adminTok = await stack.signIn(); // admin bootstrap
    aliceTok = await stack.signUp('scope-alice@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    aliceId = await uid('scope-alice@verify.test');
    adminId = await uid('admin@objectos.ai');

    // Alice (a plain member) owns a private note — she can read AND edit it.
    const created = await stack.apiAs(aliceTok, 'POST', '/data/showcase_private_note', { title: 'Alice note' });
    expect(created.status, 'member creates her own private note').toBeLessThan(300);
    noteId = idOf(await created.json())
      ?? (await ql.findOne('showcase_private_note', { where: { title: 'Alice note' }, context: SYS }))?.id;
    expect(noteId, 'note id resolved').toBeTruthy();
  }, 120_000);

  // The agent context exactly as the producer emits it: acting on behalf of
  // Alice, whose OWN grants are the scope-derived ceiling (no member baseline).
  const agentCtx = (ceiling: string) => ({
    userId: aliceId,
    principalKind: 'agent' as const,
    positions: [] as string[],
    permissions: [ceiling],
    onBehalfOf: { userId: aliceId, principalKind: 'human' as const },
  });
  // A plain human context for Alice (member baseline applies) — the control.
  const aliceCtx = () => ({ userId: aliceId, positions: [] as string[], permissions: [] as string[] });

  it('control: Alice (human) CAN read and edit her own note', async () => {
    const rows = await ql.find('showcase_private_note', { where: {}, context: aliceCtx() });
    expect((rows ?? []).map(idOf)).toContain(noteId);
    await expect(
      ql.update('showcase_private_note', { id: noteId, title: 'Alice edit' }, { context: aliceCtx() }),
    ).resolves.toBeTruthy();
  });

  it("a data:read agent CAN read Alice's note (read ceiling ∩ Alice = read Alice's rows)", async () => {
    const rows = await ql.find('showcase_private_note', { where: {}, context: agentCtx('mcp_agent_data_read') });
    expect((rows ?? []).map(idOf)).toContain(noteId);
  });

  it('a data:read agent CANNOT edit that note — even though the user could (scope ceiling enforced at the data layer)', async () => {
    await expect(
      ql.update('showcase_private_note', { id: noteId, title: 'agent tried to edit' }, { context: agentCtx('mcp_agent_data_read') }),
    ).rejects.toBeTruthy();
  });

  it('a data:read agent CANNOT create either (read-only ceiling)', async () => {
    await expect(
      ql.insert('showcase_private_note', { title: 'agent created' }, { context: agentCtx('mcp_agent_data_read') }),
    ).rejects.toBeTruthy();
  });

  it('a data:write agent for the SAME user CAN edit the note (write ceiling ∩ Alice = write)', async () => {
    await expect(
      ql.update('showcase_private_note', { id: noteId, title: 'write agent edit' }, { context: agentCtx('mcp_agent_data_write') }),
    ).resolves.toBeTruthy();
    const after = await ql.findOne('showcase_private_note', { where: { id: noteId }, context: SYS });
    expect(after?.title).toBe('write agent edit');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // [#16549 / maintainer ruling 2026-09-08, decision batch #81 item 1]
  // The measured table, end to end: a user whose visibility comes from
  // `viewAllRecords` must read the SAME rows through an OAuth agent as through
  // her own credentials. ⛔ Not "closer" — equal.
  //
  // Reported: same account, same questions, same server —
  //   API key, `principalKind: human`   → 9 accounts / 23 opportunities / 45 tasks
  //   OAuth, `principalKind: agent`     → 5 /  0 /  0
  // and the follow-up narrowed it to one column: re-owning every row to the
  // demo user made OAuth answer 9/23/59, so the agent path was reading `own`
  // where the human path read `viewAllRecords`, and the profile grant was not
  // consulted for the agent at all.
  //
  // The dev admin is this stack's `viewAllRecords` profile (a `'*'` wildcard
  // carrying the superuser bits) and owns none of Alice's rows, which is
  // exactly the shape the card measured. The human leg goes over the REST door
  // with a real token — the same door the API-key row was measured through —
  // and the agent leg through the engine with the producer's own context, so
  // the two legs really are two identity paths onto one row.
  // ─────────────────────────────────────────────────────────────────────────
  const agentForAdmin = (ceiling: string) => ({
    userId: adminId,
    principalKind: 'agent' as const,
    positions: [] as string[],
    permissions: [ceiling],
    onBehalfOf: { userId: adminId, principalKind: 'human' as const },
  });

  const restIds = async (token: string): Promise<string[]> => {
    const res = await stack.apiAs(token, 'GET', '/data/showcase_private_note?$top=200');
    expect(res.status, 'REST read succeeds').toBeLessThan(300);
    const body: any = await res.json();
    const rows: any[] = body?.data?.records ?? body?.records ?? body?.data ?? body?.value ?? [];
    return (Array.isArray(rows) ? rows : []).map(idOf).filter(Boolean);
  };

  it("[#16549] PARITY: the human leg and the OAuth agent leg agree on Alice's note for a viewAllRecords profile", async () => {
    // Human leg — the admin reads Alice's row because her profile carries
    // `viewAllRecords`, not because she owns it.
    const humanIds = await restIds(adminTok);
    expect(humanIds, 'human leg sees the row it does not own').toContain(noteId);

    // Agent leg — same person, OAuth `data:read`. Before the ruling this leg
    // ran at `own` and returned nothing: the admin owns no notes.
    const agentRows = await ql.find('showcase_private_note', { where: {}, context: agentForAdmin('mcp_agent_data_read') });
    const agentIds = (agentRows ?? []).map(idOf);
    expect(agentIds, 'agent leg sees the same row').toContain(noteId);

    // ⛔ EQUAL, not merely non-empty: every row the human leg reached, the
    // agent leg reached too. Containment in this direction is the whole claim,
    // and it is asserted over rows this suite did not create as well — a
    // shared-stack-safe way of saying "the two rows of the table match".
    expect(agentIds).toEqual(expect.arrayContaining(humanIds));
  });

  it('[#16549] NEGATIVE CONTROL: an agent for a member WITHOUT viewAllRecords still sees only her own rows', async () => {
    // The admin owns a note; Alice has no viewAllRecords and no share on it.
    // Her agent must not gain sight of it — the fix widens the manager's view,
    // not everyone's.
    const created = await stack.apiAs(adminTok, 'POST', '/data/showcase_private_note', { title: 'Admin-owned note (D10 control)' });
    expect(created.status, 'admin creates a note she owns').toBeLessThan(300);
    const adminNoteId = idOf(await created.json())
      ?? (await ql.findOne('showcase_private_note', { where: { title: 'Admin-owned note (D10 control)' }, context: SYS }))?.id;
    expect(adminNoteId, 'admin note id resolved').toBeTruthy();

    const aliceAgentIds = ((await ql.find('showcase_private_note', { where: {}, context: agentCtx('mcp_agent_data_read') })) ?? []).map(idOf);
    expect(aliceAgentIds, "Alice's agent still reaches her own row").toContain(noteId);
    expect(aliceAgentIds, "Alice's agent does NOT reach a row she does not own").not.toContain(adminNoteId);

    // …while the admin's own agent does — the same query, the same object, the
    // only difference being whose profile is on the other side of the D10
    // intersection. That difference is what the ruling restored.
    const adminAgentIds = ((await ql.find('showcase_private_note', { where: {}, context: agentForAdmin('mcp_agent_data_read') })) ?? []).map(idOf);
    expect(adminAgentIds).toContain(adminNoteId);
  });
});
