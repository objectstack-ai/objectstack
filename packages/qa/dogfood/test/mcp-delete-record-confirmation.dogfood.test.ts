// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The MCP `delete_record` tool refuses a call without `confirm: true` with
// `run_action`'s confirmation refusal, and REST `DELETE /data/:object/:id`
// stays outside that gate — proven together on a booted showcase, through the
// live `/api/v1/mcp` transport and the live REST data door, for one caller.
//
// ## Why this file and not only the package's own pins
//
// `@objectstack/mcp` and `@objectstack/runtime` do not depend on each other,
// so the door's pins (`packages/mcp/src/mcp-delete-record-confirmation.test.ts`)
// compare the delete refusal with a DOUBLE of the runtime gate. Here the
// runtime gate is the real one: `run_action` on an action the configuration
// declares `ai.requiresConfirmation: true` reaches `actionConfirmationRefusal`
// in `@objectstack/runtime`, and its served refusal is held against the
// `delete_record` refusal served by the same transport to the same caller.
//
// The derived configuration flags the showcase's own AI-exposed, object-less
// action (`showcase_portfolio_snapshot`) as gated; nothing else changes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';
import { bootShowcase } from './showcase-boot.js';

const OBJECT = 'showcase_private_note';
const GATED_ACTION = 'showcase_portfolio_snapshot';
const idOf = (b: any) => b?.id ?? b?.record?.id ?? b?.data?.id ?? b?.recordId;

describe('MCP delete_record takes run_action\'s confirmation gate; REST DELETE stays outside it', () => {
  let stack: VerifyStack;
  let admin: string;

  /** One `tools/call` over the live MCP transport; the tool's text content, parsed. */
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${admin}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    expect(res.status).toBe(200);
    const rpc: any = await res.json();
    expect(rpc.error, JSON.stringify(rpc.error)).toBeUndefined();
    const text = String(rpc.result?.content?.[0]?.text ?? '');
    let payload: any;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { isError: rpc.result?.isError === true, payload, text };
  };

  const createNote = async (title: string): Promise<string> => {
    const res = await stack.apiAs(admin, 'POST', `/data/${OBJECT}`, { title });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    const id = idOf(await res.json());
    expect(id, 'created note id').toBeTruthy();
    return String(id);
  };
  const readStatus = async (id: string) => (await stack.apiAs(admin, 'GET', `/data/${OBJECT}/${id}`)).status;

  beforeAll(async () => {
    const declared = showcaseStack as unknown as { actions?: any[] };
    const actions = (declared.actions ?? []).map((a) =>
      a?.name === GATED_ACTION ? { ...a, ai: { ...(a.ai ?? {}), requiresConfirmation: true } } : a,
    );
    expect(actions.some((a) => a?.name === GATED_ACTION && a.ai?.exposed === true), 'the fixture action moved').toBe(true);
    stack = await bootShowcase(
      { extraPlugins: [new MCPServerPlugin()] },
      { ...(showcaseStack as unknown as Record<string, unknown>), actions },
    );
    admin = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('refuses an unconfirmed delete_record with ACTION_CONFIRMATION_REQUIRED, and the record is intact', async () => {
    const id = await createNote('mcp delete unconfirmed');

    const refused = await tool('delete_record', { objectName: OBJECT, recordId: id });

    expect(refused.isError, refused.text).toBe(true);
    expect(refused.payload.error).toMatchObject({
      code: 'ACTION_CONFIRMATION_REQUIRED',
      status: 428,
      details: { actionName: 'delete_record', objectName: OBJECT, confirmationMember: AI_ACTION_CONFIRMATION_MEMBER },
    });
    expect(await readStatus(id), 'the refused delete removed the record').toBe(200);
  }, 60_000);

  it('serves the same code, status, envelope keys and confirmation member as run_action\'s real gate', async () => {
    const id = await createNote('mcp delete shape');

    const viaAction = await tool('run_action', { actionName: GATED_ACTION });
    const viaDelete = await tool('delete_record', { objectName: OBJECT, recordId: id });

    // Lit control: the runtime gate really refused the action.
    expect(viaAction.isError, viaAction.text).toBe(true);
    expect(viaAction.payload.error?.code).toBe('ACTION_CONFIRMATION_REQUIRED');
    expect(viaAction.payload.error?.details?.actionName).toBe(GATED_ACTION);

    const a = viaAction.payload.error;
    const d = viaDelete.payload.error;
    expect(d.code).toBe(a.code);
    expect(d.status).toBe(a.status);
    expect(Object.keys(d)).toEqual(Object.keys(a));
    expect(d.details.confirmationMember).toBe(a.details.confirmationMember);
    // The action is object-less, so its details carry no `objectName`; every
    // key it does carry, the delete refusal carries too.
    expect(Object.keys(d.details)).toEqual(expect.arrayContaining(Object.keys(a.details)));
    expect(await readStatus(id)).toBe(200);
  }, 60_000);

  it('deletes on the retry with confirm: true', async () => {
    const id = await createNote('mcp delete confirmed');

    const deleted = await tool('delete_record', { objectName: OBJECT, recordId: id, [AI_ACTION_CONFIRMATION_MEMBER]: true });

    expect(deleted.isError, deleted.text).toBe(false);
    expect(deleted.payload).toMatchObject({ object: OBJECT, success: true });
    expect(await readStatus(id), 'the confirmed delete left the record').toBe(404);
  }, 60_000);

  it('control: REST DELETE /data/:object/:id takes no confirmation and deletes', async () => {
    const id = await createNote('rest delete');

    const res = await stack.apiAs(admin, 'DELETE', `/data/${OBJECT}/${id}`);

    expect(res.status, await res.clone().text()).toBeLessThan(300);
    expect(await readStatus(id)).toBe(404);
  }, 60_000);
});
