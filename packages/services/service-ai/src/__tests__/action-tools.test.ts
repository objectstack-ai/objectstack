// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { Action } from '@objectstack/spec/ui';
import {
  actionSkipReason,
  actionToToolDefinition,
  buildApiRequestBody,
  createFetchApiClient,
  registerActionsAsTools,
  type ApiActionClient,
} from '../tools/action-tools.js';
import { ToolRegistry } from '../tools/tool-registry.js';

// Actions are AI-exposed only by opt-in (ADR-0011), so the baseline fixture
// carries a valid `ai` block. Tests that exercise the opt-in gate override it.
const baseAction = (over: Partial<Action> = {}): Action =>
  ({
    name: 'do_thing',
    label: 'Do thing',
    type: 'script',
    target: 'doThingHandler',
    objectName: 'task',
    locations: ['record_header'],
    ai: { exposed: true, description: 'Do the thing the user asked for on this task record.' },
    ...over,
  }) as Action;

describe('actionSkipReason', () => {
  it('allows a plain script action', () => {
    expect(actionSkipReason(baseAction())).toBeNull();
  });

  it('skips UI-only types', () => {
    expect(actionSkipReason(baseAction({ type: 'url', target: 'https://x' }))).toMatch(/UI-only/);
    expect(actionSkipReason(baseAction({ type: 'modal' }))).toMatch(/UI-only/);
    expect(actionSkipReason(baseAction({ type: 'form' }))).toMatch(/UI-only/);
  });

  it('flags api action without wiring when ctx supplied', () => {
    const a = baseAction({ type: 'api', target: '/api/v1/x' });
    expect(actionSkipReason(a)).toBeNull(); // no ctx → allowed
    expect(actionSkipReason(a, {})).toMatch(/apiClient or apiBaseUrl/);
    expect(actionSkipReason(a, { apiBaseUrl: 'http://x' })).toBeNull();
  });

  it('flags flow action without automation when ctx supplied', () => {
    const a = baseAction({ type: 'flow', target: 'send_email' });
    expect(actionSkipReason(a, {})).toMatch(/automation/);
    expect(actionSkipReason(a, { automation: {} as never })).toBeNull();
  });

  it('skips dangerous actions', () => {
    expect(actionSkipReason(baseAction({ confirmText: 'Sure?' }))).toMatch(/confirm/);
    expect(actionSkipReason(baseAction({ mode: 'delete' }))).toMatch(/delete/);
    expect(actionSkipReason(baseAction({ variant: 'danger' }))).toMatch(/danger/);
  });

  it('is opt-in: skips actions that did not set ai.exposed', () => {
    expect(actionSkipReason(baseAction({ ai: undefined }))).toMatch(/not AI-exposed/);
    expect(actionSkipReason(baseAction({ ai: { exposed: false } as never }))).toMatch(/not AI-exposed/);
  });

  it('skips an exposed action missing a description (defensive)', () => {
    expect(
      actionSkipReason(baseAction({ ai: { exposed: true } as never })),
    ).toMatch(/description is missing/);
  });

  it('ai.requiresConfirmation:false lets an exposed destructive action run', () => {
    // delete looks destructive, but the author asserts it is safe → exposed.
    expect(
      actionSkipReason(baseAction({
        mode: 'delete',
        ai: { exposed: true, description: 'Archive this task record; it is reversible from trash.', requiresConfirmation: false },
      })),
    ).toBeNull();
  });

  it('ai.requiresConfirmation:true gates an otherwise-safe action behind HITL', () => {
    const a = baseAction({
      ai: { exposed: true, description: 'Update the task title to the value the user supplied.', requiresConfirmation: true },
    });
    expect(actionSkipReason(a)).toMatch(/requires confirmation/);
    expect(
      actionSkipReason(a, {
        enableActionApproval: true,
        aiService: { proposePendingAction: async () => ({ id: 'x' }) },
      }),
    ).toBeNull();
  });
});

describe('actionToToolDefinition — ai: block translation', () => {
  it('returns null when not exposed', () => {
    expect(actionToToolDefinition(baseAction({ ai: undefined }), undefined, new Map())).toBeNull();
  });

  it('uses ai.description and carries category/objectName/requiresConfirmation', () => {
    const def = actionToToolDefinition(
      baseAction({ ai: { exposed: true, description: 'Triage a support case and suggest a priority and queue.', category: 'analytics' } }),
      undefined,
      new Map(),
    );
    expect(def).not.toBeNull();
    expect(def!.description).toContain('Triage a support case');
    expect(def!.category).toBe('analytics');
    expect(def!.objectName).toBe('task');
    expect(def!.requiresConfirmation).toBe(false);
  });

  it('summarises ai.outputSchema into the description and carries it through', () => {
    const outputSchema = {
      type: 'object',
      properties: { priority: { type: 'string' }, queue: { type: 'string' } },
    };
    const def = actionToToolDefinition(
      baseAction({ ai: { exposed: true, description: 'Triage a support case and return a structured suggestion.', outputSchema } }),
      undefined,
      new Map(),
    );
    expect(def!.outputSchema).toEqual(outputSchema);
    expect(def!.description).toMatch(/Returns an object with: priority, queue\./);
  });

  it('merges ai.paramHints into the parameter JSON Schema', () => {
    const def = actionToToolDefinition(
      baseAction({
        params: [{ name: 'priority', type: 'text' }],
        ai: {
          exposed: true,
          description: 'Set the priority on the task record to one of the allowed values.',
          paramHints: { priority: { description: 'One of P0-P3.', enum: ['P0', 'P1', 'P2', 'P3'] } },
        },
      }),
      undefined,
      new Map(),
    );
    const props = (def!.parameters as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(props.priority.enum).toEqual(['P0', 'P1', 'P2', 'P3']);
    expect(props.priority.description).toBe('One of P0-P3.');
  });
});

describe('buildApiRequestBody', () => {
  it('returns user params flat by default', () => {
    const a = baseAction({ type: 'api', target: '/api/v1/x' });
    expect(buildApiRequestBody(a, { foo: 1, bar: 'b' }, undefined, undefined)).toEqual({
      foo: 1,
      bar: 'b',
    });
  });

  it('wraps params under bodyShape.wrap and keeps recordIdParam flat', () => {
    const a = baseAction({
      type: 'api',
      target: '/api/v1/orgs/update',
      bodyShape: { wrap: 'data' },
      recordIdParam: 'organizationId',
    });
    const out = buildApiRequestBody(a, { name: 'new' }, { id: 'org_1' }, 'org_1');
    expect(out).toEqual({ data: { name: 'new' }, organizationId: 'org_1' });
  });

  it('uses recordIdField to seed recordIdParam', () => {
    const a = baseAction({
      type: 'api',
      target: '/api/v1/sessions/revoke',
      recordIdParam: 'token',
      recordIdField: 'session_token',
    });
    const out = buildApiRequestBody(a, {}, { id: 's1', session_token: 'abc' }, 's1');
    expect(out).toEqual({ token: 'abc' });
  });

  it('merges bodyExtra last so constants win', () => {
    const a = baseAction({
      type: 'api',
      target: '/api/v1/x',
      bodyExtra: { resend: true, role: 'admin' },
    });
    const out = buildApiRequestBody(
      a,
      { role: 'user', email: 'a@b' },
      undefined,
      undefined,
    );
    expect(out).toEqual({ role: 'admin', email: 'a@b', resend: true });
  });
});

describe('createFetchApiClient', () => {
  it('resolves relative URLs against baseUrl and parses JSON', async () => {
    const fakeFetch = vi.fn(async (url: string) => {
      expect(url).toBe('http://test.local/api/v1/x');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = createFetchApiClient({
      baseUrl: 'http://test.local',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const out = await client.request({ url: '/api/v1/x', method: 'POST', body: { a: 1 } });
    expect(out).toEqual({ ok: true });
    expect(fakeFetch).toHaveBeenCalledOnce();
    const init = fakeFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('throws on non-2xx with status + body', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'nope' }), { status: 403 }),
    );
    const client = createFetchApiClient({
      baseUrl: 'http://t',
      fetch: fakeFetch as unknown as typeof fetch,
    });
    await expect(client.request({ url: '/x', method: 'POST' })).rejects.toThrow(/403.*nope/);
  });
});

describe('registerActionsAsTools — api + flow dispatch', () => {
  function makeContext(over: Record<string, unknown> = {}) {
    const action: Action = baseAction({
      type: 'api',
      name: 'invite_user',
      target: '/api/v1/auth/admin/create-user',
      method: 'POST',
      locations: [],
      params: [],
    } as Partial<Action>);
    const objects = [{ name: 'task', label: 'Task', fields: {}, actions: [action] }];
    return {
      metadata: { listObjects: async () => objects } as never,
      dataEngine: {
        find: async () => [],
      } as never,
      ...over,
    };
  }

  it('skips api action when no apiClient/apiBaseUrl', async () => {
    const reg = new ToolRegistry();
    const { registered, skipped } = await registerActionsAsTools(reg, makeContext());
    expect(registered).toEqual([]);
    expect(skipped).toEqual([
      { action: 'invite_user', reason: 'no apiClient or apiBaseUrl configured' },
    ]);
  });

  it('registers api action when apiClient is supplied and invokes it', async () => {
    const reg = new ToolRegistry();
    const calls: unknown[] = [];
    const apiClient: ApiActionClient = {
      request: async (input) => {
        calls.push(input);
        return { userId: 'u_42' };
      },
    };
    const { registered } = await registerActionsAsTools(reg, {
      ...makeContext({ apiClient }),
    } as never);
    expect(registered).toEqual(['action_invite_user']);
    const def = reg.getDefinition('action_invite_user');
    expect(def).toBeDefined();
    const result = await reg.execute({
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'action_invite_user',
      input: { email: 'a@b.com' },
    } as never);
    const parsed = JSON.parse((result.output as { value: string }).value);
    expect(parsed.ok).toBe(true);
    expect(parsed.result).toEqual({ userId: 'u_42' });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { method: string }).method).toBe('POST');
    expect((calls[0] as { url: string }).url).toBe('/api/v1/auth/admin/create-user');
    expect((calls[0] as { body: Record<string, unknown> }).body).toEqual({ email: 'a@b.com' });
  });

  it('skips flow action when no automation service', async () => {
    const reg = new ToolRegistry();
    const flowAction: Action = baseAction({
      type: 'flow',
      name: 'send_welcome',
      target: 'send_welcome_email',
      locations: [],
      params: [],
    } as Partial<Action>);
    const ctx = {
      metadata: {
        listObjects: async () => [{ name: 'task', fields: {}, actions: [flowAction] }],
      } as never,
      dataEngine: { find: async () => [] } as never,
    };
    const { registered, skipped } = await registerActionsAsTools(reg, ctx as never);
    expect(registered).toEqual([]);
    expect(skipped[0].reason).toMatch(/automation/);
  });

  it('registers and invokes a flow action via automation.execute', async () => {
    const reg = new ToolRegistry();
    const flowAction: Action = baseAction({
      type: 'flow',
      name: 'send_welcome',
      target: 'send_welcome_email',
      locations: [],
      params: [],
    } as Partial<Action>);
    const calls: Array<{ flow: string; ctx: unknown }> = [];
    const automation = {
      execute: async (flow: string, c: unknown) => {
        calls.push({ flow, ctx: c });
        return { success: true, output: { sent: true } };
      },
    } as never;
    const ctx = {
      metadata: {
        listObjects: async () => [{ name: 'task', fields: {}, actions: [flowAction] }],
      } as never,
      dataEngine: { find: async () => [] } as never,
      automation,
    };
    const { registered } = await registerActionsAsTools(reg, ctx as never);
    expect(registered).toEqual(['action_send_welcome']);
    const r = await reg.execute({
      type: 'tool-call',
      toolCallId: 't',
      toolName: 'action_send_welcome',
      input: {},
    } as never);
    const parsed = JSON.parse((r.output as { value: string }).value);
    expect(parsed.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].flow).toBe('send_welcome_email');
  });

  it('flow action surfaces failure when automation returns success:false', async () => {
    const reg = new ToolRegistry();
    const flowAction: Action = baseAction({
      type: 'flow',
      name: 'send_welcome',
      target: 'send_welcome_email',
      locations: [],
      params: [],
    } as Partial<Action>);
    const automation = {
      execute: async () => ({ success: false, error: 'smtp down' }),
    } as never;
    await registerActionsAsTools(reg, {
      metadata: {
        listObjects: async () => [{ name: 'task', fields: {}, actions: [flowAction] }],
      } as never,
      dataEngine: { find: async () => [] } as never,
      automation,
    } as never);
    const r = await reg.execute({
      type: 'tool-call',
      toolCallId: 't',
      toolName: 'action_send_welcome',
      input: {},
    } as never);
    const parsed = JSON.parse((r.output as { value: string }).value);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/smtp down/);
  });
});

describe('actionRequiresApproval + HITL queue routing', () => {
  it('skips dangerous actions when approval is NOT wired', () => {
    const a = baseAction({ mode: 'delete' });
    // No approval ctx → skipped
    expect(actionSkipReason(a)).toMatch(/delete/);
    expect(actionSkipReason(a, { enableActionApproval: false })).toMatch(/delete/);
  });

  it('registers dangerous actions when approval IS wired', () => {
    const a = baseAction({ mode: 'delete' });
    expect(
      actionSkipReason(a, {
        enableActionApproval: true,
        aiService: { proposePendingAction: async () => ({ id: 'x' }) },
      }),
    ).toBeNull();
  });

  it('routes invocation to proposePendingAction + pre-registers dispatcher', async () => {
    const reg = new ToolRegistry();
    const propose = vi.fn(async (input: unknown) => {
      void input;
      return { id: 'pa_42' };
    });
    const dispatchers = new Map<string, (input: unknown) => Promise<unknown>>();
    const registerDispatcher = vi.fn((name: string, fn: (input: unknown) => Promise<unknown>) => {
      dispatchers.set(name, fn);
    });

    let executed = false;
    const action = baseAction({
      name: 'delete_task',
      mode: 'delete',
      type: 'script',
      target: 'deleteTaskHandler',
      locations: [],
      params: [],
    } as Partial<Action>);
    const objects = [{ name: 'task', label: 'Task', fields: {}, actions: [action] }];

    const { registered, skipped } = await registerActionsAsTools(reg, {
      metadata: { listObjects: async () => objects } as never,
      dataEngine: {
        find: async () => [],
        executeAction: async () => {
          executed = true;
          return { deleted: true };
        },
      } as never,
      enableActionApproval: true,
      aiService: {
        proposePendingAction: propose,
        registerPendingActionDispatcher: registerDispatcher,
      },
    } as never);

    expect(skipped).toEqual([]);
    expect(registered).toEqual(['action_delete_task']);
    expect(registerDispatcher).toHaveBeenCalledWith('action_delete_task', expect.any(Function));

    // LLM invokes the tool → should NOT execute, should queue.
    const r = await reg.execute({
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'action_delete_task',
      input: { recordId: 'rec_1' },
    } as never);
    const env = JSON.parse((r.output as { value: string }).value);
    expect(env.status).toBe('pending_approval');
    expect(env.pendingActionId).toBe('pa_42');
    expect(executed).toBe(false);
    expect(propose).toHaveBeenCalledTimes(1);
    const proposeArg = propose.mock.calls[0][0] as any;
    expect(proposeArg.objectName).toBe('task');
    expect(proposeArg.actionName).toBe('delete_task');
    expect(proposeArg.toolName).toBe('action_delete_task');
    expect(proposeArg.toolInput).toEqual({ recordId: 'rec_1' });

    // Approval pathway: registered dispatcher should bypass HITL.
    const dispatcher = dispatchers.get('action_delete_task');
    expect(dispatcher).toBeDefined();
    const result = await dispatcher!({ recordId: 'rec_1' });
    expect(executed).toBe(true);
    // Dispatcher returns parsed envelope (helps AIService store structured result).
    expect((result as any).ok).toBe(true);
    expect((result as any).result).toEqual({ deleted: true });
  });
});

describe('lint guardrail — asserted-safe destructive actions', () => {
  it('registers but warns when a destructive action sets ai.requiresConfirmation:false', async () => {
    const reg = new ToolRegistry();
    const action = baseAction({
      name: 'archive_task',
      mode: 'delete',
      type: 'script',
      target: 'archiveTaskHandler',
      locations: [],
      params: [],
      ai: {
        exposed: true,
        description: 'Archive this task record; the operation is reversible from the trash.',
        requiresConfirmation: false,
      },
    } as Partial<Action>);
    const objects = [{ name: 'task', label: 'Task', fields: {}, actions: [action] }];
    const { registered, skipped, warnings } = await registerActionsAsTools(reg, {
      metadata: { listObjects: async () => objects } as never,
      dataEngine: { find: async () => [], executeAction: async () => ({ ok: true }) } as never,
    } as never);

    expect(skipped).toEqual([]);
    expect(registered).toEqual(['action_archive_task']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].action).toBe('archive_task');
    expect(warnings[0].warning).toMatch(/without human approval/);
  });
});
