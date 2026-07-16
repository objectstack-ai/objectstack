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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const SYS = { isSystem: true } as const;
const idOf = (r: any): string => r?.id ?? r?.record?.id;

describe('showcase: ADR-0090 D10 agent scope ceiling (served engine)', () => {
  let stack: VerifyStack;
  let ql: any;
  let aliceTok: string;
  let aliceId: string;
  let noteId: string;

  const uid = async (email: string) =>
    (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn(); // admin bootstrap
    aliceTok = await stack.signUp('scope-alice@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    aliceId = await uid('scope-alice@verify.test');

    // Alice (a plain member) owns a private note — she can read AND edit it.
    const created = await stack.apiAs(aliceTok, 'POST', '/data/showcase_private_note', { title: 'Alice note' });
    expect(created.status, 'member creates her own private note').toBeLessThan(300);
    noteId = idOf(await created.json())
      ?? (await ql.findOne('showcase_private_note', { where: { title: 'Alice note' }, context: SYS }))?.id;
    expect(noteId, 'note id resolved').toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

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
});
