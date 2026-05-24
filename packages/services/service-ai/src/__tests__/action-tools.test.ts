// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { Action } from '@objectstack/spec/ui';
import {
  actionSkipReason,
  buildApiRequestBody,
  createFetchApiClient,
  registerActionsAsTools,
  type ApiActionClient,
} from '../tools/action-tools.js';
import { ToolRegistry } from '../tools/tool-registry.js';

const baseAction = (over: Partial<Action> = {}): Action =>
  ({
    name: 'do_thing',
    label: 'Do thing',
    type: 'script',
    target: 'doThingHandler',
    objectName: 'task',
    locations: ['record_header'],
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

  it('respects aiExposed:false', () => {
    expect(actionSkipReason(baseAction({ aiExposed: false }))).toMatch(/aiExposed/);
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
