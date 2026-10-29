/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27611 — the shared console runtime sends a click on a DECLARED
 * same-origin `type: 'api'` action through the action door, so the gates its
 * declaration carries hold for a human click as they do for an agent (step 3
 * of the ruling on objectstack#27506, ADR-0066 D4 as amended).
 *
 * The door is the mocked authenticated fetch: what is pinned here is the
 * request the console sends and how it reads each answer. That the door runs
 * its gates, never calls a switched-off action's target, and assembles the
 * target's body from the declaration is the server's own pin
 * (`packages/runtime/src/domains/api-action-forward.test.ts`).
 *
 * Three answers below are written as the door gives them once objectstack#27738
 * relays a target's `error.details` / `userMessage` and admits decision-output
 * params: a flow-backed endpoint's inner refusal, the entitlement dialog's call
 * to action and usage, and an approval decision carrying its outputs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import React from 'react';
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const authFetchSpy = vi.fn();
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => fallback,
  }),
  // The entitlement dialog localizes its own copy — stand in with the English
  // defaults (+ `{{token}}` interpolation) the real `t` would resolve to.
  useObjectTranslation: () => ({
    t: (key: string, options?: any) =>
      String(options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_m: string, name: string) => String(options?.[name] ?? ''),
      ),
    language: 'en',
    i18n: undefined,
  }),
}));

vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));

vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));

vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  return { toast: fn };
});

import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

registerBuiltInLocales();

const DOOR = '/api/v1/actions/';

const BAN = {
  name: 'ban_user',
  label: 'Ban User',
  type: 'api',
  target: '/api/v1/auth/admin/ban-user',
  recordIdParam: 'userId',
  params: [{ name: 'banReason', label: 'Reason', type: 'text' }],
};
const PING = { name: 'ping_hook', label: 'Ping', type: 'api', target: 'https://hooks.example.test/ping' };
const NOTE = { name: 'post_note', label: 'Post note', type: 'api', target: '/api/v1/notes' };
const CREATE_ENV = { name: 'create_environment', label: 'Create', type: 'api', target: '/api/v1/cloud/environments' };
const RECALC = {
  name: 'showcase_recalc_estimate',
  label: 'Recalculate Estimate',
  type: 'api',
  target: '/api/v1/apps/showcase/recalc',
  recordIdParam: 'recordId',
};
const APPROVE = {
  name: 'approval_approve',
  label: 'Approve',
  type: 'api',
  method: 'POST',
  target: '/api/v1/approvals/requests/{id}/approve',
  params: [{ name: 'comment', label: 'Comment', type: 'textarea' }],
};

const OBJECTS = [
  { name: 'sys_user', actions: [BAN, PING, NOTE] },
  { name: 'sys_environment', actions: [CREATE_ENV] },
  { name: 'showcase_task', actions: [RECALC] },
  { name: 'sys_approval_request', actions: [APPROVE] },
];

const ROW = { id: 'u_target', email: 'target@example.test' };
const DISABLED = "Action 'ban_user' is disabled — switched off in the packaged-metadata activation ledger "
  + '(sys_metadata_activation, ADR-0126 §8).';

function answer(status: number, body: unknown) {
  authFetchSpy.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function mount(objectName: string, objects: unknown[] = OBJECTS) {
  const onRefresh = vi.fn();
  const hook = renderHook(() => useConsoleActionRuntime({ dataSource: {}, objects: objects as any[], objectName, onRefresh }));
  return { ...hook, onRefresh };
}

async function click(result: { current: ReturnType<typeof useConsoleActionRuntime> }, action: any, context?: any) {
  let out: any;
  await act(async () => {
    out = await result.current.apiHandler(action, context);
  });
  return out;
}

/** The one request the click sent: its URL and parsed body. */
function sent(): { url: string; method: string; body: any } {
  expect(authFetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = authFetchSpy.mock.calls[0] as [string, any];
  return { url: String(url), method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) };
}

beforeEach(() => {
  authFetchSpy.mockReset();
});

describe('objectstack#27611 — a declared same-origin api click goes through the action door', () => {
  it('sends the subject row\'s id and the params bag to the door, and nothing to the target', async () => {
    answer(200, { success: true, data: { user: { id: 'u_target', banned: true } } });
    const { result } = mount('sys_user');

    await click(result, { ...BAN, params: { banReason: 'spam', _rowRecord: ROW } });

    const req = sent();
    expect(req.url.endsWith(`${DOOR}sys_user/ban_user`)).toBe(true);
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({ recordId: 'u_target', params: { banReason: 'spam' } });
  });

  it('a switched-off action answers the door\'s 409 ACTION_DISABLED as its sentence, never the bare code', async () => {
    answer(409, { success: false, error: { code: 'ACTION_DISABLED', message: DISABLED, httpStatus: 409 } });
    const { result, onRefresh } = mount('sys_user');

    const out = await click(result, { ...BAN, params: { banReason: 'spam', _rowRecord: ROW } });

    expect(sent().url.endsWith(`${DOOR}sys_user/ban_user`)).toBe(true);
    expect(out).toEqual({ success: false, error: DISABLED });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('a switched-on action answers the target\'s payload, unwrapped, and refreshes', async () => {
    answer(200, { success: true, data: { user: { id: 'u_target', banned: true } } });
    const { result, onRefresh } = mount('sys_user');

    const out = await click(result, { ...BAN, params: { banReason: 'spam', _rowRecord: ROW } });

    expect(sent().url.endsWith(`${DOOR}sys_user/ban_user`)).toBe(true);
    expect(out).toEqual({ success: true, data: { user: { id: 'u_target', banned: true } }, reload: true });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('a target\'s HTTP 200 rejection, relayed as the door\'s data, is a failure', async () => {
    answer(200, { success: true, data: { success: false, error: { message: 'User is already banned' } } });
    const { result, onRefresh } = mount('sys_user');

    const out = await click(result, { ...BAN, params: { _rowRecord: ROW } });

    expect(out).toEqual({ success: false, error: 'User is already banned' });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('resolves `{{page.<var>}}` tokens in the browser and sends the values as params', async () => {
    answer(200, { success: true, data: { id: 'n1' } });
    const { result } = mount('sys_user');

    await click(result, { ...NOTE, params: { text: '{{page.draft}}' } }, { pageVariables: { draft: 'hello' } });

    const req = sent();
    expect(req.url.endsWith(`${DOOR}sys_user/post_note`)).toBe(true);
    expect(req.body).toEqual({ params: { text: 'hello' } });
  });
});

describe('objectstack#27611 — every other api click keeps the direct fetch', () => {
  it('an off-origin target is called directly', async () => {
    answer(200, { ok: true });
    const { result } = mount('sys_user');

    await click(result, { ...PING, params: { _rowRecord: ROW } });

    expect(sent().url).toBe('https://hooks.example.test/ping');
  });

  it('a click that names no declared action (an inline page button) is called directly', async () => {
    answer(200, { success: true, data: {} });
    const { result } = mount('sys_user', []);

    await click(result, { ...BAN, params: { banReason: 'spam', _rowRecord: ROW } });

    const req = sent();
    expect(req.url.endsWith(BAN.target)).toBe(true);
    expect(req.body).toEqual({ banReason: 'spam', userId: 'u_target' });
  });

  it('a same-named declaration aimed at another target is not the click\'s, so the click is called directly', async () => {
    answer(200, { success: true, data: {} });
    const { result } = mount('sys_user');

    await click(result, { ...BAN, target: '/api/v1/auth/admin/unban-user', params: { _rowRecord: ROW } });

    expect(sent().url.endsWith('/api/v1/auth/admin/unban-user')).toBe(true);
  });
});

describe('objectstack#27611 — what the door answers once objectstack#27738 lands', () => {
  it('a flow-backed endpoint\'s refused run reads its inner refusal, not the node chain', async () => {
    const refusal = 'You do not have permission to perform this action. Contact your administrator if you need access.';
    answer(400, {
      success: false,
      error: {
        code: 'FLOW_FAILED',
        message: `Node 'write_estimate' failed: update_record(showcase_task) failed: ${refusal}`,
        httpStatus: 400,
        details: { innerRefusal: { code: 'PERMISSION_DENIED', message: refusal } },
      },
    });
    const { result } = mount('showcase_task');

    const out = await click(result, { ...RECALC, params: { _rowRecord: { id: 'task-1' } } });

    expect(sent().url.endsWith(`${DOOR}showcase_task/showcase_recalc_estimate`)).toBe(true);
    expect(out).toEqual({ success: false, error: builtInLocales.en.form.noPermissionToSave });
  });

  it('an entitlement 403 opens the upgrade dialog with its call to action, not a red toast', async () => {
    answer(403, {
      success: false,
      error: {
        code: 'DEV_ENV_PLAN_LOCKED',
        message: 'Development environments are a paid feature. Upgrade to add them.',
        httpStatus: 403,
        details: { upgrade_url: '/settings/billing', plan: 'free' },
      },
    });
    const { result, onRefresh } = mount('sys_environment');

    const out = await click(result, { ...CREATE_ENV, params: { displayName: 'x' } });

    expect(sent().url.endsWith(`${DOOR}sys_environment/create_environment`)).toBe(true);
    expect(out).toEqual({ success: false });
    expect(onRefresh).not.toHaveBeenCalled();
    render(<>{result.current.dialogs}</>);
    expect(await screen.findByText('Development environments are a paid feature')).toBeTruthy();
    const cta = screen.getByTestId('entitlement-cta-primary');
    expect(cta.textContent).toBe('Upgrade plan');
    expect(cta.getAttribute('href')).toMatch(/\/settings\/billing$/);
  });

  it('an exhausted environment pool quotes the usage the door relays', async () => {
    answer(403, {
      success: false,
      error: {
        code: 'DEV_ENV_LIMIT',
        message: 'Development environment limit reached.',
        httpStatus: 403,
        details: { current: 3, limit: 3, upgrade_url: '/settings/billing' },
      },
    });
    const { result } = mount('sys_environment');

    expect(await click(result, { ...CREATE_ENV, params: { displayName: 'x' } })).toEqual({ success: false });
    expect(sent().url.endsWith(`${DOOR}sys_environment/create_environment`)).toBe(true);
    render(<>{result.current.dialogs}</>);
    expect(await screen.findByText(/You are using 3 of 3 development environments/)).toBeTruthy();
  });

  it('an approval decision sends its outputs as `outputs.<key>` params, for the door to fold', async () => {
    answer(200, { success: true, data: { request: { id: 'req_1', record_title: 'Q4 budget' } } });
    const { result } = mount('sys_approval_request');

    const out = await click(result, {
      ...APPROVE,
      params: { comment: 'ok', 'outputs.reason': 'within budget', _rowRecord: { id: 'req_1' } },
    });

    const req = sent();
    expect(req.url.endsWith(`${DOOR}sys_approval_request/approval_approve`)).toBe(true);
    expect(req.body).toEqual({ recordId: 'req_1', params: { comment: 'ok', 'outputs.reason': 'within budget' } });
    expect(out).toEqual({ success: true, data: { request: { id: 'req_1', record_title: 'Q4 budget' } }, reload: true });
  });
});
