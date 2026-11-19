// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#33690] The amended confirmation contract at the live MCP door: an action
// whose author declared `ai.requiresConfirmation: true` never runs on the
// caller's own `confirm: true`. The call is handed to the host's
// pending-confirmation service (`IActionConfirmationService`, registered under
// `ACTION_CONFIRMATION_SERVICE`) and answered `status: 'pending_confirmation'`
// with the service's pending id.
//
// Real stack, real `SecurityPlugin`, real MCP plugin, over the Streamable HTTP
// transport as a signed-in person. The host's service is a plugin double that
// records each hand-off and runs nothing, standing in for a host's own (the
// open build ships none; a stack without one refuses with
// `details.reason: 'no_confirmation_service'`, pinned at the doors in
// `approval-decide-over-mcp.dogfood.test.ts` and
// `mcp-system-object-action-exposure.dogfood.test.ts`).
//
//   ⭐ the same `run_action` call, sent N times, writes the record 0 times
//      and is held N times, each with its own pending id, each hand-off
//      recorded for the person the call ran as;
//   ⭐ [#34209] a call carrying the retired `confirm` member is refused at
//      the tool's input, on the gated action and on an ungated one: nothing
//      is written and nobody is asked;
//   ⭐ CONTROL: the same update through an action that declares no
//      confirmation runs at once, and nobody is asked.
//   ⭐ [#34515] a `resume_run` hand-off on a two-screen wizard names the
//      screen its values were given for; the host approves it through
//      `dispatchActionResume` with that screen, and a second approval of
//      the same item (or one approved after the person advanced the wizard
//      in the app) is refused 409 `RESOURCE_CONFLICT` with the run left on
//      the next screen. CONTROL: a single-screen run approved with its
//      screen completes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { dispatchActionResume } from '@objectstack/runtime';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { ACTION_CONFIRMATION_SERVICE, AI_ACTION_CONFIRMATION_MEMBER } from '@objectstack/spec/contracts';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { catalogPermissionSet } from './catalog-permission-set.js';

const OBJECT = 'achoff_ticket';
const GATED = 'achoff_close_ticket';
const PLAIN = 'achoff_flag_ticket';
/** [#34515] A gated flow action whose screen flow is a two-screen wizard, and one whose flow has one screen. */
const WIZARD_ACTION = 'achoff_close_wizard';
const WIZARD_FLOW = 'achoff_close_wizard';
const ONE_SCREEN_ACTION = 'achoff_close_one_screen';
const ONE_SCREEN_FLOW = 'achoff_close_one_screen';
const PERSON = 'achoff-person@verify.test';
const SYS = { context: { isSystem: true } } as const;
const N = 3;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);

const ticket = ObjectSchema.create({
  name: OBJECT,
  label: 'Ticket',
  pluralLabel: 'Tickets',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    status: Field.text({ label: 'Status' }),
  },
  actions: [
    {
      name: GATED, label: 'Close Ticket', objectName: OBJECT, operation: 'update', patch: { status: 'closed' },
      ai: { exposed: true, description: 'Close the ticket for good, so no further work is taken on it.', requiresConfirmation: true },
    },
    {
      name: PLAIN, label: 'Flag Ticket', objectName: OBJECT, operation: 'update', patch: { status: 'flagged' },
      ai: { exposed: true, description: 'Flag the ticket so a person looks at it during the next review.' },
    },
    {
      name: WIZARD_ACTION, label: 'Close Ticket (wizard)', objectName: OBJECT, type: 'flow', target: WIZARD_FLOW,
      ai: { exposed: true, description: 'Walk the two-step close wizard for this ticket: a reason, then a final sign-off.', requiresConfirmation: true },
    },
    {
      name: ONE_SCREEN_ACTION, label: 'Close Ticket (one screen)', objectName: OBJECT, type: 'flow', target: ONE_SCREEN_FLOW,
      ai: { exposed: true, description: 'Close this ticket after asking for a comment on one screen.', requiresConfirmation: true },
    },
  ],
} as never);

/** A screen node collecting an optional `comment`: both wizard screens accept the same bag. */
const commentScreen = (id: string, title: string) => ({
  id, type: 'screen', label: title, config: { title, fields: [{ name: 'comment', label: 'Comment', type: 'text' }] },
});
/** A screen flow walking `screens` in order, start to end. */
const screenFlow = (name: string, screens: Array<ReturnType<typeof commentScreen>>) => {
  const path = ['start', ...screens.map((n) => n.id), 'end'];
  return {
    name, label: name, type: 'screen', status: 'active', runAs: 'user',
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, ...screens, { id: 'end', type: 'end', label: 'End' }],
    edges: path.slice(1).map((target, i) => ({ id: `e${i}`, source: path[i], target })),
  };
};

const stackConfig = defineStack({
  manifest: {
    id: 'com.dogfood.action-confirmation-handoff',
    namespace: 'achoff',
    version: '0.0.0',
    type: 'app',
    name: 'Action Confirmation Hand-off Fixture',
    description: 'One object with a confirmation-gated declarative update, run over MCP.',
  },
  requires: ['automation'],
  objects: [ticket],
  flows: [
    screenFlow(WIZARD_FLOW, [commentScreen('step_1', 'Step 1: reason'), commentScreen('step_2', 'Step 2: final sign-off')]),
    screenFlow(ONE_SCREEN_FLOW, [commentScreen('step_1', 'Comment')]),
  ],
} as never);

const baselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'achoff_baseline',
  label: 'Action Confirmation Hand-off Baseline — CRUD on the fixture object',
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
});

/** The host's pending-confirmation service double: records the hand-off, runs nothing. */
const handOffs: Array<{ handOff: any; userId: unknown }> = [];
const confirmationServicePlugin = {
  name: 'com.dogfood.action-confirmation-service',
  version: '1.0.0',
  init: async (ctx: any) => {
    ctx.registerService(ACTION_CONFIRMATION_SERVICE, {
      submit: async (handOff: unknown, ec: any) => {
        handOffs.push({ handOff, userId: ec?.userId });
        return { pendingId: `pa_${handOffs.length}` };
      },
    });
  },
};

describe('[#33690] a confirmation-gated action over MCP is handed to the person, never run on the caller\'s confirm', () => {
  let stack: VerifyStack;
  let ql: any;
  let person: string;
  let personId: string;

  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await stack.api('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${person}` },
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
  const statusOf = async (id: string) =>
    rowsOf(await ql.find(OBJECT, { where: { id }, context: SYS.context }))[0]?.status;
  const openTicket = async (name: string): Promise<string> => {
    const res = await stack.apiAs(person, 'POST', `/data/${OBJECT}`, { name, status: 'open' });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { id?: string; record?: { id?: string } };
    return String(created.id ?? created.record?.id ?? '');
  };

  beforeAll(async () => {
    stack = await bootStack(stackConfig as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [confirmationServicePlugin as never, new MCPServerPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    await stack.signIn();
    person = await stack.signUp(PERSON);
    personId = String((await ql.findOne('sys_user', { where: { email: PERSON }, context: SYS.context }))?.id ?? '');
    expect(personId).not.toBe('');
    expect(await catalogPermissionSet(ql, baselineSet.name), `${baselineSet.name} is served by the catalog`).toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: personId, permission_set: baselineSet.name }, SYS);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it(`⭐ the same call, sent ${N} times, writes 0 times and is held ${N} times with a pending id`, async () => {
    const id = await openTicket('gated');
    const before = handOffs.length;
    for (let i = 1; i <= N; i++) {
      const answer = await tool('run_action', {
        actionName: GATED, objectName: OBJECT, recordId: id,
      });
      expect(answer.isError, answer.text).toBe(false);
      expect(answer.payload).toMatchObject({
        status: 'pending_confirmation', pendingId: `pa_${before + i}`, actionName: GATED, objectName: OBJECT,
      });
      expect(String(answer.payload.message)).toContain(answer.payload.pendingId);
    }
    expect(await statusOf(id), 'a confirmed call wrote the record').toBe('open');
    const recorded = handOffs.slice(before);
    expect(recorded).toHaveLength(N);
    for (const { handOff, userId } of recorded) {
      expect(handOff).toMatchObject({ actionName: GATED, objectName: OBJECT, recordId: id, door: 'mcp' });
      expect(userId, 'the hand-off is recorded for the person the call ran as').toBe(personId);
    }
  }, 120_000);

  it('⭐ [#34209] a call carrying confirm is refused at the input, gated or not: nothing written, nobody asked', async () => {
    for (const [actionName, value] of [[GATED, true], [PLAIN, true], [GATED, false]] as const) {
      const id = await openTicket(`with-member-${actionName}-${value}`);
      const before = handOffs.length;
      const answer = await tool('run_action', {
        actionName, objectName: OBJECT, recordId: id, [AI_ACTION_CONFIRMATION_MEMBER]: value,
      });
      const label = `${actionName} confirm=${value}`;
      expect(answer.isError, label).toBe(true);
      expect(answer.text, label).toContain(`\`${AI_ACTION_CONFIRMATION_MEMBER}\``);
      expect(answer.text, label).toContain('in the app');
      expect(await statusOf(id), label).toBe('open');
      expect(handOffs.length, label).toBe(before);
    }
  }, 120_000);

  it('CONTROL: an action that declares no confirmation runs at once, and nobody is asked', async () => {
    const id = await openTicket('plain');
    const before = handOffs.length;
    const answer = await tool('run_action', { actionName: PLAIN, objectName: OBJECT, recordId: id });
    expect(answer.isError, answer.text).toBe(false);
    expect(await statusOf(id)).toBe('flagged');
    expect(handOffs.length).toBe(before);
  }, 120_000);

  // ── [#34515] a resume approval is bound to the screen it was given on ──────
  const automation = () => (stack.kernel as any).getService('automation');
  const screenOf = async (runId: string) => (await automation().getSuspendedScreen(runId))?.nodeId ?? null;
  /** The person starts the gated flow action in the app (REST, their confirm): the run pauses on its first screen. */
  const startPaused = async (action: string, id: string): Promise<string> => {
    const res = await stack.apiAs(person, 'POST', `/actions/${OBJECT}/${action}/${id}`, { [AI_ACTION_CONFIRMATION_MEMBER]: true });
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    const result = body?.data?.result ?? body?.data;
    expect(result?.status, JSON.stringify(body)).toBe('paused');
    return String(result.runId);
  };
  /** The agent's `resume_run`, handed to the person: the hand-off it recorded. */
  const handOffOf = async (runId: string, comment: string) => {
    const held = await tool('resume_run', { runId, values: { comment } });
    expect(held.payload, held.text).toMatchObject({ status: 'pending_confirmation' });
    return handOffs.at(-1)!.handOff.run as { runId: string; values: Record<string, unknown>; screenNodeId?: string };
  };
  /** The host's approve door: the approving person, through `dispatchActionResume`, with the item's screen. */
  const approve = (run: { runId: string; values: Record<string, unknown>; screenNodeId?: string }) =>
    dispatchActionResume(stack.kernel as never, {
      executionContext: { userId: personId } as never, runId: run.runId, values: run.values, screenNodeId: run.screenNodeId, confirm: true,
    });

  it('⭐ [#34515] the same item approved twice on a two-screen wizard: the first resumes step 1, the second is refused 409', async () => {
    const runId = await startPaused(WIZARD_ACTION, await openTicket('wizard-twice'));
    const run = await handOffOf(runId, 'meant for step 1');
    expect(run.screenNodeId).toBe('step_1');

    const first = await approve(run);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(await screenOf(runId)).toBe('step_2');

    const second = await approve(run);
    expect({ status: second.status, code: second.body.error?.code }, JSON.stringify(second.body)).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
    expect((await automation().getRun(runId))?.status).toBe('paused');
    expect(await screenOf(runId), 'the refused approval moved the run').toBe('step_2');
  }, 120_000);

  it('⭐ [#34515] an item approved after the person advanced the wizard in the app is refused 409', async () => {
    const runId = await startPaused(WIZARD_ACTION, await openTicket('wizard-advanced'));
    const run = await handOffOf(runId, 'agent, for step 1');
    const inApp = await stack.apiAs(person, 'POST', `/automation/${WIZARD_FLOW}/runs/${runId}/resume`, { inputs: { comment: 'typed in the app' } });
    expect(inApp.status, await inApp.clone().text()).toBe(200);
    expect(await screenOf(runId)).toBe('step_2');

    const refused = await approve(run);
    expect({ status: refused.status, code: refused.body.error?.code }, JSON.stringify(refused.body)).toEqual({ status: 409, code: 'RESOURCE_CONFLICT' });
    expect(await screenOf(runId)).toBe('step_2');
  }, 120_000);

  it('CONTROL [#34515]: a single-screen run approved with its screen completes', async () => {
    const runId = await startPaused(ONE_SCREEN_ACTION, await openTicket('one-screen'));
    const run = await handOffOf(runId, 'only screen');
    expect(run.screenNodeId).toBe('step_1');

    const answer = await approve(run);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect((await automation().getRun(runId))?.status).toBe('completed');
  }, 120_000);
});
