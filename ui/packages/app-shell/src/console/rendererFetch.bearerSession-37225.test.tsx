// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The renderer packages' same-server requests ride the host's authenticated
 * fetch (objectstack#37225): the share dialog (`@object-ui/components`) and the
 * chatbot hooks (`@object-ui/plugin-chatbot`) send through
 * `SchemaRendererProvider`'s `apiFetch`, which the console builds as
 * `createAuthenticatedFetch({ sameOriginOnly: true })` (`ConsoleShell`).
 *
 * The defect: each sent the bare global `fetch` with `credentials: 'include'`,
 * the session cookie and nothing else. A session held by its bearer token alone
 * (no cookie: a cross-site embed, a blocked third-party cookie) was answered as
 * anonymous: no share links, no agents, no models, no pending approvals, and an
 * in-chat approval refused. Against a server that refuses any request without
 * the bearer, mounted the way the console mounts them:
 *
 *   - with a token stored, each loads (or decides), and its request carries
 *     `Authorization: Bearer <token>` beside the cookie (`credentials: 'include'`),
 *     and a `401` reaches the console's session-ended check;
 *   - CONTROL, no token stored (a cookie session): the same requests go out
 *     cookie-only, as before.
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { TokenStorage, createAuthenticatedFetch } from '@object-ui/auth';
import { sessionEndEvents } from '../../../auth/src/session-end-events';
import { ShareDialog } from '@object-ui/components';
import { useAgents, useAiModels, useHitlInChat, usePendingActions } from '@object-ui/plugin-chatbot';
import { __resetAgentsCatalog } from '../../../plugin-chatbot/src/useAgents';
import { resetAiModelsSession } from '../../../plugin-chatbot/src/useAiModels';

const TOKEN = 'stored-session-token';
const AI = '/api/v1/ai';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Sent = { path: string; method: string; credentials: RequestCredentials | undefined; authorization: string | null };
let sent: Sent[] = [];

function answer(path: string, method: string): Response {
  if (path === '/api/v1/share-links' && method === 'GET') {
    return reply({ links: [{ id: 'sl_1', token: 'tok_1', permission: 'view', audience: 'link_only', label: 'Board review link' }] });
  }
  if (path === `${AI}/agents`) return reply({ agents: [{ name: 'helper', label: 'Helper', active: true }] });
  if (path === `${AI}/models`) {
    return reply({ models: [{ id: 'm_fast', label: 'Fast' }, { id: 'm_deep', label: 'Deep' }], defaultModelId: 'm_fast' });
  }
  if (path === `${AI}/pending-actions` && method === 'GET') {
    return reply({ items: [{ id: 'pa_1', toolName: 'delete_record', status: 'pending' }], total: 1 });
  }
  if (path === `${AI}/pending-actions/pa_1/approve` && method === 'POST') {
    return reply({ id: 'pa_1', status: 'executed', result: { ok: true } });
  }
  return reply({ error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } }, 404);
}

/** A server that answers only the bearer: no cookie rides in a unit test, so a request without it is refused. */
function bearerOnlyServer(input: RequestInfo | URL, init?: RequestInit): Response {
  const path = new URL(String(input instanceof Request ? input.url : input), 'http://console.test').pathname;
  const method = (init?.method ?? 'GET').toUpperCase();
  const authorization = new Headers(init?.headers).get('Authorization');
  sent.push({ path, method, credentials: init?.credentials, authorization });
  if (authorization !== `Bearer ${TOKEN}`) {
    return reply({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required to access this endpoint.' } }, 401);
  }
  return answer(path, method);
}

/** The console's composition: the renderers' `apiFetch` is the authenticated fetch (`ConsoleShell`). */
const hostFetch = createAuthenticatedFetch({ sameOriginOnly: true });
const wrapper = ({ children }: { children: ReactNode }) => (
  <SchemaRendererProvider dataSource={null} apiFetch={hostFetch}>
    {children}
  </SchemaRendererProvider>
);

const withBearer = { credentials: 'include', authorization: `Bearer ${TOKEN}` } as const;
const cookieOnly = { credentials: 'include', authorization: null } as const;

let sessionEnds = 0;
let unsubscribe: () => void = () => {};

beforeEach(() => {
  sent = [];
  sessionEnds = 0;
  unsubscribe = sessionEndEvents.subscribe(() => {
    sessionEnds += 1;
  });
  __resetAgentsCatalog();
  resetAiModelsSession();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => bearerOnlyServer(input, init)));
});

afterEach(() => {
  cleanup();
  unsubscribe();
  __resetAgentsCatalog();
  resetAiModelsSession();
  vi.unstubAllGlobals();
  TokenStorage.clear();
});

describe('the share dialog (components) under a bearer-only session', () => {
  const dialog = () =>
    render(
      <ShareDialog open onOpenChange={() => {}} objectName="ai_conversations" recordId="c1" apiBase="/api" />,
      { wrapper },
    );

  it("lists the record's links, sending the stored bearer beside the cookie", async () => {
    TokenStorage.set(TOKEN);
    dialog();
    expect(await screen.findByText('Board review link')).toBeTruthy();
    expect(sent).toEqual([{ path: '/api/v1/share-links', method: 'GET', ...withBearer }]);
  });

  it('CONTROL: with no token stored the read goes out cookie-only, and its 401 reaches the session-ended check', async () => {
    dialog();
    expect(await screen.findByTestId('share-dialog-error')).toBeTruthy();
    expect(sent).toEqual([{ path: '/api/v1/share-links', method: 'GET', ...cookieOnly }]);
    expect(sessionEnds).toBe(1);
  });
});

describe('the chatbot hooks (plugin-chatbot) under a bearer-only session', () => {
  it('useAgents loads the agent catalog with the stored bearer', async () => {
    TokenStorage.set(TOKEN);
    const { result } = renderHook(() => useAgents({ apiBase: AI }), { wrapper });
    await waitFor(() => expect(result.current.agents.map((a) => a.name)).toEqual(['helper']));
    expect(sent).toEqual([{ path: `${AI}/agents`, method: 'GET', ...withBearer }]);
  });

  it('useAiModels loads the model allowlist with the stored bearer', async () => {
    TokenStorage.set(TOKEN);
    const { result } = renderHook(() => useAiModels({ apiBase: AI }), { wrapper });
    await waitFor(() => expect(result.current.models.map((m) => m.id)).toEqual(['m_fast', 'm_deep']));
    expect(sent).toEqual([{ path: `${AI}/models`, method: 'GET', ...withBearer }]);
  });

  it('usePendingActions lists and approves with the stored bearer', async () => {
    TokenStorage.set(TOKEN);
    const { result } = renderHook(() => usePendingActions({ apiBase: AI, pollInterval: 0 }), { wrapper });
    await waitFor(() => expect(result.current.items.map((row) => row.id)).toEqual(['pa_1']));
    await act(async () => {
      await result.current.approve('pa_1');
    });
    expect(sent.slice(0, 2)).toEqual([
      { path: `${AI}/pending-actions`, method: 'GET', ...withBearer },
      { path: `${AI}/pending-actions/pa_1/approve`, method: 'POST', ...withBearer },
    ]);
    expect(sent.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('useHitlInChat sends the in-chat approval with the stored bearer', async () => {
    TokenStorage.set(TOKEN);
    const messages = [
      {
        id: 'm1',
        role: 'assistant' as const,
        content: '',
        toolInvocations: [
          { toolCallId: 'call_1', toolName: 'delete_record', pendingActionId: 'pa_1', state: 'approval-requested' as const },
        ],
      },
    ];
    const { result } = renderHook(() => useHitlInChat({ messages: messages as never, apiBase: AI }), { wrapper });
    await act(async () => {
      await result.current.decide('call_1', true);
    });
    expect(sent).toEqual([{ path: `${AI}/pending-actions/pa_1/approve`, method: 'POST', ...withBearer }]);
    expect(result.current.decisions.call_1?.state).not.toBe('error');
  });

  it('CONTROL: with no token stored the agent read goes out cookie-only, refused as before', async () => {
    const { result } = renderHook(() => useAgents({ apiBase: AI }), { wrapper });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(sent).toEqual([{ path: `${AI}/agents`, method: 'GET', ...cookieOnly }]);
    expect(sessionEnds).toBe(1);
  });
});
