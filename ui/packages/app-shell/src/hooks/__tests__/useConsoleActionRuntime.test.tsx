/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Focused coverage for the shared console action runtime (#1605) — the wiring
 * extracted from ObjectView so PageView can mount it too. We exercise the
 * authenticated handlers directly (regression coverage for ObjectView, which
 * delegates to them) and end-to-end through the provider + an `action:button`'s
 * `useAction()` consumer (PageView action execution).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import React from 'react';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }));

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
  }),
}));

// The client modal transport is stubbed for the same reason — importing it for
// real drags in <ModalForm> and the whole plugin-form graph. `resolveTargetSpy`
// stands in for the page/object lookup so the modal-dispatch tests below can
// choose whether a target resolves. Its real resolution rules are covered in
// useActionModal.resolve.test.tsx.
const modalHandlerSpy = vi.fn(async () => ({ success: true }));
const resolveTargetSpy = vi.fn(async (_schema: any): Promise<any> => null);
vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: modalHandlerSpy,
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: resolveTargetSpy,
  }),
}));

// The dialogs/flow-runner are not exercised here — keep them as inert stubs so
// the hook module imports cheaply.
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));

// Spy on the toast library so we can assert the handlers DON'T toast errors
// themselves (the ActionRunner's post-execution hook owns the error toast —
// toasting here too double-fires it).
vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  return { toast: fn };
});

import { toast } from 'sonner';
import { useConsoleActionRuntime, ConsoleActionRuntimeProvider } from '../useConsoleActionRuntime';
import { modalTargetRefusalMessage } from '../../utils/modalTargetDiagnostics';
import { useAction, usePageVariables, PageVariablesProvider, PageVariableActionBridge } from '@object-ui/react';
import { resolveServerActionRecordId } from '@object-ui/core';

beforeEach(() => {
  authFetchSpy.mockReset();
  navigateSpy.mockReset();
  modalHandlerSpy.mockClear();
  resolveTargetSpy.mockReset();
  resolveTargetSpy.mockResolvedValue(null);
  (toast as any).mockClear?.();
  (toast as any).error.mockClear();
  (toast as any).success.mockClear();
});

describe('useConsoleActionRuntime — authenticated handlers', () => {
  it('apiHandler calls an absolute endpoint via the authenticated fetch and refreshes', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: 'env_1' }) });
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], onRefresh }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({
        type: 'api', name: 'createEnv', target: '/api/v1/environments', params: { name: 'prod' },
      } as any);
    });

    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = authFetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/environments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ name: 'prod' });
    expect(res).toMatchObject({ success: true, data: { id: 'env_1' } });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('apiHandler unwraps the `{ success, data }` envelope so result.data is the inner payload (create_user password reveal)', async () => {
    // The admin/create-user wrapper returns `{ success, data: { user,
    // temporaryPassword } }`. The action `resultDialog` field paths
    // (`user.email`, `temporaryPassword`) are written relative to the INNER
    // `data`, matching flowHandler / serverActionHandler which already unwrap.
    // Pre-fix apiHandler leaked the whole envelope, so ActionResultDialog's
    // readPath(envelope, 'user.email') resolved to undefined and BOTH the email
    // and temporary-password fields rendered blank — the reported bug.
    authFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { user: { id: 'u9', email: 'new@acme.co' }, temporaryPassword: 'Tmp-abc123!' },
      }),
    });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({
        type: 'api', name: 'create_user', target: '/api/v1/auth/admin/create-user',
        params: { email: 'new@acme.co' },
      } as any);
    });

    expect(res.success).toBe(true);
    // The inner payload — not the envelope. readPath(data, 'user.email') and
    // readPath(data, 'temporaryPassword') now resolve in ActionResultDialog.
    expect(res.data).toEqual({
      user: { id: 'u9', email: 'new@acme.co' },
      temporaryPassword: 'Tmp-abc123!',
    });
    expect((res.data as any).success).toBeUndefined();
  });

  it('apiHandler surfaces a failed response and does not refresh', async () => {
    authFetchSpy.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) });
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], onRefresh }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({ type: 'api', name: 'x', target: '/api/v1/x' } as any);
    });

    expect(res).toEqual({ success: false, error: 'Forbidden' });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('apiHandler flattens an ObjectStack `{ error: { code, message } }` envelope to the message string', async () => {
    // The admin/create-user 400 returns `{ success: false, error: { code:
    // 'invalid_request', message: '...' } }`. Pre-fix the whole error OBJECT
    // rode `result.error` into the ActionRunner's toast → `toast.error(object)`
    // rendered it as a React child and crashed the page (React #31).
    authFetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: { code: 'invalid_request', message: 'Provide either password or generatePassword, not both' },
      }),
    });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({ type: 'api', name: 'x', target: '/api/v1/x' } as any);
    });

    expect(res).toEqual({
      success: false,
      error: 'Provide either password or generatePassword, not both',
    });
  });

  it('apiHandler falls back to an HTTP-status message when the error body is unusable', async () => {
    authFetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({ type: 'api', name: 'x', target: '/api/v1/x' } as any);
    });

    expect(res).toEqual({ success: false, error: 'HTTP 500' });
  });

  it('apiHandler turns an entitlement 403 into the upgrade dialog, not a red error toast', async () => {
    // Free org that already has its production env clicks "create" → the control
    // plane 403s with DEV_ENV_PLAN_LOCKED. The runtime must open a friendly
    // dialog and NOT return an `error` (which the ActionRunner would toast red).
    authFetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: {
          code: 'DEV_ENV_PLAN_LOCKED',
          message: 'Development environments are a paid feature. Upgrade to add them.',
          httpStatus: 403,
          // Business context lives in the declared `details` slot (cloud#1046).
          details: { upgrade_url: '/settings/billing', plan: 'free' },
        },
      }),
    });
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], onRefresh }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({
        type: 'api', name: 'create_environment',
        target: '/api/v1/cloud/environments', params: { displayName: 'x' },
      } as any);
    });

    // No `error` key → ActionRunner.handlePostExecution suppresses the red toast.
    expect(res).toEqual({ success: false });
    expect(onRefresh).not.toHaveBeenCalled();

    // …and the shared entitlement dialog is now open with the upgrade title.
    render(<>{result.current.dialogs}</>);
    expect(await screen.findByText('Development environments are a paid feature')).toBeTruthy();
  });

  it('apiHandler does NOT open the entitlement dialog for the retired flat error shape', async () => {
    // objectui#3329 / cloud#1046: `error.details` is the only accepted home for
    // entitlement context, and the flat `body?.error ?? body` tolerance is
    // deleted. This body — a pre-cloud#948 flat shape — must therefore take the
    // ordinary error path (a red toast), not the friendly dialog. Pinned here
    // because this handler feeds `entitlementDialogFromError` the RAW wire body.
    authFetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: 'Development environments are a paid feature. Upgrade to add them.',
        code: 'DEV_ENV_PLAN_LOCKED',
        upgrade_url: '/settings/billing',
        plan: 'free',
      }),
    });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({
        type: 'api', name: 'create_environment', target: '/api/v1/cloud/environments',
      } as any);
    });

    expect(res).toEqual({
      success: false,
      error: 'Development environments are a paid feature. Upgrade to add them.',
    });
    render(<>{result.current.dialogs}</>);
    expect(screen.queryByText('Development environments are a paid feature')).toBeNull();
  });

  it('apiHandler merges bodyExtra into the dataSource update payload (pure-confirmation action)', async () => {
    // A pure-confirmation action carries no params array; its mutation lives in
    // `bodyExtra`. Without merging it, `fields` is empty and the update below is
    // skipped — the confirmation "succeeds" but nothing is persisted.
    const updateSpy = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({
        dataSource: { update: updateSpy } as any,
        objects: [],
        objectName: 'work_order',
        onRefresh,
      }),
    );

    await act(async () => {
      await result.current.apiHandler({
        type: 'api', name: 'close', // non-absolute target → dataSource branch
        params: { recordId: 'wo_1' },
        bodyExtra: { status: 'closed', closed_at: '2026-06-18' },
      } as any);
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('work_order', 'wo_1', { status: 'closed', closed_at: '2026-06-18' });
  });

  it('serverActionHandler targets /actions/global/<name> when no object is bound (page scope)', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] /* no objectName */ }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler({ type: 'script', name: 'provision' } as any);
    });

    expect(String(authFetchSpy.mock.calls[0][0])).toContain('/api/v1/actions/global/provision');
    expect(res).toMatchObject({ success: true });
  });

  // [ADR-0110 D1] The action URL identifies the action by `name`. It used to
  // post `target || name` — the handler's REGISTRATION KEY — so for a
  // target-bound action the server resolved no declaration and silently
  // skipped the ADR-0066 D4 capability gate and the ADR-0104 param contract
  // (framework#3935). `target` is a binding expression, not an identity.
  it('serverActionHandler posts the action NAME, not its target', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'todo_task' }),
    );

    await act(async () => {
      // app-todo's real shape — declarative name ≠ handler registration key.
      await result.current.serverActionHandler(
        { type: 'script', name: 'complete_task', target: 'completeTask' } as any,
        { selectedRecords: [{ id: 'task_1' }] } as any,
      );
    });

    const url = String(authFetchSpy.mock.calls[0][0]);
    expect(url).toContain('/api/v1/actions/todo_task/complete_task');
    expect(url).not.toContain('completeTask');
  });

  it('serverActionHandler refuses an action with no name rather than falling back to target', async () => {
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'todo_task' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler({ type: 'script', target: 'completeTask' } as any);
    });

    expect(res).toMatchObject({ success: false });
    expect(String(res.error)).toMatch(/no name/i);
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('serverActionHandler returns a failed action error WITHOUT toasting it (the ActionRunner owns the error toast — no double toast)', async () => {
    // A script action that throws (e.g. lead_apply_convert validation) returns
    // { success:false, error } from the server. The handler must NOT toast it —
    // ActionRunner.handlePostExecution does, and toasting here too showed the
    // error twice (the reported bug).
    authFetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, error: '线索信息不完整，提交转商机申请前请补全：终端客户' }),
    });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'mtc_lead' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler({ type: 'script', name: 'lead_apply_convert' } as any);
    });

    expect(res).toEqual({ success: false, error: '线索信息不完整，提交转商机申请前请补全：终端客户' });
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('serverActionHandler treats an INNER success:false as a failure (objectstack#3913 — no green toast on a failed action)', async () => {
    // A server older than objectstack#3913 wraps a handler failure as HTTP 200
    // `{success: true, data: {success: false, error}}`. Reading only `res.ok`
    // and the OUTER `success` reported that as a completed action and fired the
    // green "completed" toast while swallowing the real error — the reported
    // bug. The console must inspect the inner envelope for those servers.
    authFetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { success: false, error: "Action 'log_call' on object '*' not found" },
      }),
    });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'crm_call' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler({ type: 'script', name: 'log_call' } as any);
    });

    expect(res).toEqual({ success: false, error: "Action 'log_call' on object '*' not found" });
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('serverActionHandler resolves a nested {error:{message}} to a STRING (objectstack#3913 wire)', async () => {
    // Current servers answer a failed action with a real status and the nested
    // envelope. Passing that object through as `ActionResult.error` reaches
    // `toast.error()` as a React child and crashes the page (React #31).
    authFetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        success: false,
        error: { message: "Action 'log_call' on object 'global' not found", code: 404 },
      }),
    });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler({ type: 'script', name: 'log_call' } as any);
    });

    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string');
    expect(res.error).toBe("Action 'log_call' on object 'global' not found");
  });

  it('serverActionHandler opens a handler-returned redirectUrl (read through BOTH envelopes)', async () => {
    // The action route wraps twice: `{success, data:{success, data: <handler>}}`.
    // This used to read `redirectUrl` off the ACTION envelope — a level where
    // only `success`/`data` ever live — so the convention never fired and an
    // `opensInNewTab` action left its pre-opened tab on the spinner forever.
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as any);
    authFetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { success: true, data: { redirectUrl: 'https://example.test/sso' } },
      }),
    });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'crm_call' }),
    );

    await act(async () => {
      await result.current.serverActionHandler({ type: 'script', name: 'open_env' } as any);
    });

    expect(openSpy).toHaveBeenCalledWith('https://example.test/sso', '_blank');
    openSpy.mockRestore();
  });

  it('serverActionHandler still reports success when the inner envelope says so', async () => {
    // The success wire is unchanged by objectstack#3913 — guard against the
    // inner-envelope check turning a good action into a failure.
    authFetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { success: true, data: { id: 'call_1' } } }),
    });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'crm_call' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler({ type: 'script', name: 'log_call' } as any);
    });

    expect(res).toMatchObject({ success: true });
  });

  it('exposes ActionProvider props with the api/flow/script/modal handlers wired', () => {
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );
    const props = result.current.actionProviderProps;
    expect(props.context.objectName).toBe('inv');
    expect(Object.keys(props.handlers).sort()).toEqual(['api', 'flow', 'modal', 'script']);
    expect(typeof props.onConfirm).toBe('function');
    expect(typeof props.onParamCollection).toBe('function');
    expect(typeof props.onModal).toBe('function');
  });
});

/**
 * framework#3530 — `type: 'modal'` used to be wired straight to
 * `serverActionHandler` here, while RecordDetailView opened modals client-side.
 * The same button therefore did two different things depending on which surface
 * mounted it. Both now run this rule: render `target` when it names a page —
 * only a page, since PR #4764 retired the object fallback — else report the
 * authoring error (objectstack#3959 removed the server-side fallthrough this
 * comment used to describe; the wording is shared as of objectui#4767).
 */
describe('modalActionHandler — a modal action is CLIENT-SIDE ONLY (objectstack#3959)', () => {
  it('opens the resolved target client-side and never POSTs to /actions', async () => {
    resolveTargetSpy.mockResolvedValue({ content: { name: 'log_call', type: 'utility' } });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'crm_call' }),
    );

    await act(async () => {
      await result.current.modalActionHandler({ name: 'log_call', type: 'modal', target: 'log_call' } as any);
    });

    expect(resolveTargetSpy).toHaveBeenCalledWith('log_call');
    expect(modalHandlerSpy).toHaveBeenCalledWith({ content: { name: 'log_call', type: 'utility' } });
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  // This test used to assert the opposite — that an unresolvable target fell
  // back to POSTing /actions, "how a modal action bound to registerAction still
  // runs". It never ran: the framework rejects type:'modal' over REST with a
  // 400 (headlessActionTypeError), so the fallthrough turned an authoring
  // mistake into a confusing round-trip and let apps ship handlers no
  // declaration could address (objectstack#3959).
  it('reports an unresolvable target instead of POSTing to /actions', async () => {
    resolveTargetSpy.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'crm_call' }),
    );

    let r: any;
    await act(async () => {
      r = await result.current.modalActionHandler({
        name: 'log_call', type: 'modal', target: 'log_call', params: { subject: 'Intro' },
      } as any);
    });

    expect(modalHandlerSpy).not.toHaveBeenCalled();
    expect(authFetchSpy).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    // The message must name the action, the dud target, and the way out.
    expect(String(r.error)).toContain('log_call');
    expect(String(r.error)).toMatch(/`type: 'script'` with `params`/);
    // objectui#4767 — and it must say the SAME thing the other two surfaces
    // say. This copy was hand-written and went stale when PR #4764 retired the
    // object fallback: it kept offering "no page or object" and never named
    // `type: 'form'`, the capability the retirement handed authors instead.
    expect(String(r.error)).toContain("type: 'form'");
    expect(String(r.error)).not.toMatch(/or object/);
    // Byte-equality with the shared constructor, so re-inlining the string
    // here (the exact mistake #4767 records) fails rather than drifts.
    expect(String(r.error)).toBe(
      modalTargetRefusalMessage({ actionName: 'log_call', target: 'log_call', serverHandlerHint: true }),
    );
  });

  it('prefers an inline `modal` descriptor over `target`', async () => {
    resolveTargetSpy.mockResolvedValue({ objectName: 'customers', mode: 'create' });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'crm_call' }),
    );

    await act(async () => {
      await result.current.modalActionHandler({
        name: 'x', type: 'modal', target: 'ignored', modal: { objectName: 'customers', mode: 'create' },
      } as any);
    });

    expect(resolveTargetSpy).toHaveBeenCalledWith({ objectName: 'customers', mode: 'create' });
  });
});

describe('flowHandler — list_toolbar selection fallback', () => {
  // Toolbar-invoked flow actions carry no `_rowRecord` (that's a list_item /
  // row-menu concept). The grid publishes its checkbox selection into the
  // shared ActionRunner context as `selectedRecords`; with exactly one row
  // selected the flow must receive that row's id as recordId, otherwise a
  // record-bound flow node fails ("Update requires an ID or options.multi=true").
  it('uses the single selected row from the runner context as recordId', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler(
        { type: 'flow', name: 'showcase_bulk_reassign', target: 'showcase_reassign_wizard' } as any,
        { selectedRecords: [{ id: 'rec_42', name: 'Acme' }] } as any,
      );
    });

    expect(res).toMatchObject({ success: true });
    const [url, init] = authFetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/automation/showcase_reassign_wizard/trigger');
    const body = JSON.parse(init.body);
    expect(body.recordId).toBe('rec_42');
    expect(body.params.recordId).toBe('rec_42');
  });

  it('blocks with an error (no trigger call) when multiple rows are selected', async () => {
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler(
        { type: 'flow', target: 'showcase_reassign_wizard' } as any,
        { selectedRecords: [{ id: 'a' }, { id: 'b' }] } as any,
      );
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/single record/i);
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('blocks a record-scoped flow (locations include list_item) launched with zero rows selected (#2210)', async () => {
    // BulkReassignAction shape: mounts on rows AND the toolbar. From the
    // toolbar with nothing selected there is no record to run on — pre-fix
    // the wizard opened anyway and died at the first record-bound node
    // ("Update requires an ID or options.multi=true").
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler(
        {
          type: 'flow', name: 'showcase_bulk_reassign', target: 'showcase_reassign_wizard',
          locations: ['list_item', 'list_toolbar'],
        } as any,
        { selectedRecords: [] } as any,
      );
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/select a row/i);
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('still triggers an object-level toolbar flow (no record locations) with zero rows selected', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler(
        { type: 'flow', name: 'monthly_close', target: 'monthly_close', locations: ['list_toolbar'] } as any,
        { selectedRecords: [] } as any,
      );
    });

    expect(res).toMatchObject({ success: true });
    const body = JSON.parse(authFetchSpy.mock.calls[0][1].body);
    expect(body.recordId ?? null).toBeNull();
  });

  it('an explicit _rowRecord (list_item invocation) still wins over the selection', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    await act(async () => {
      await result.current.flowHandler(
        { type: 'flow', target: 'f', params: { _rowRecord: { id: 'row_1' } } } as any,
        { selectedRecords: [{ id: 'other_1' }, { id: 'other_2' }] } as any,
      );
    });

    expect(JSON.parse(authFetchSpy.mock.calls[0][1].body).recordId).toBe('row_1');
  });

  // objectui#12331 — the flow launcher and the script launcher resolve a
  // toolbar selection by ONE rule, `@object-ui/core`'s
  // `resolveServerActionRecordId`; the flow handler used to hold a second copy.
  // The same action shape and selection reach both handlers here, and each
  // answer must be the rule's own.
  it.each([
    ['several rows', { locations: ['list_toolbar'] }, [{ id: 'a' }, { id: 'b' }]],
    ['zero rows on a record-scoped action', { locations: ['list_item', 'list_toolbar'] }, []],
  ])('refuses %s with the same answer as the script launcher (objectui#12331)', async (_label, shape, rows) => {
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );
    const context = { selectedRecords: rows } as any;
    const rule = resolveServerActionRecordId({ name: 'reassign', ...shape } as any, context);

    let flowRes: any;
    let scriptRes: any;
    await act(async () => {
      flowRes = await result.current.flowHandler(
        { type: 'flow', name: 'reassign', target: 'reassign_wizard', ...shape } as any,
        context,
      );
      scriptRes = await result.current.serverActionHandler(
        { type: 'script', name: 'reassign', ...shape } as any,
        context,
      );
    });

    expect(rule.error).toBeTruthy();
    expect(flowRes).toEqual({ success: false, error: rule.error });
    expect(scriptRes).toEqual({ success: false, error: rule.error });
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('an aggregate launch (`_selectedIds`) is not refused for its selection, as on the script launcher (objectui#12331)', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler(
        {
          type: 'flow', name: 'bulk_close', target: 'bulk_close_flow',
          locations: ['list_item', 'list_toolbar'],
          params: { _selectedIds: ['a', 'b'] },
        } as any,
        { selectedRecords: [{ id: 'a' }, { id: 'b' }] } as any,
      );
    });

    expect(res).toMatchObject({ success: true });
    const body = JSON.parse(authFetchSpy.mock.calls[0][1].body);
    expect(body.recordId ?? null).toBeNull();
    expect(body.params._selectedIds).toEqual(['a', 'b']);
  });

  it('end-to-end: selection published via updateContext reaches the flow trigger', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });

    // Mirrors the real wiring: ObjectGrid calls `updateContext({ selectedRecords })`
    // on the shared runner; the toolbar button then executes the flow action.
    function Probe() {
      const { execute, updateContext } = useAction();
      return (
        <button
          onClick={() => {
            updateContext({ selectedRecords: [{ id: 'sel_1' }] });
            void execute({ type: 'flow', name: 'showcase_bulk_reassign', target: 'showcase_reassign_wizard' } as any);
          }}
        >
          run-flow
        </button>
      );
    }

    render(
      <ConsoleActionRuntimeProvider dataSource={{}} objects={[]}>
        <Probe />
      </ConsoleActionRuntimeProvider>,
    );

    fireEvent.click(screen.getByText('run-flow'));

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalled());
    const [url, init] = authFetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/automation/showcase_reassign_wizard/trigger');
    expect(JSON.parse(init.body).recordId).toBe('sel_1');
  });
});

// #2958 — a business failure comes back HTTP 200 with the failure on the INNER
// envelope (`data.success === false`), and a failed flow launch carries neither
// `status` nor `screen`. Both used to land in the terminal-success return: the
// user saw a green "completed successfully" toast, the view refreshed, and the
// real error was swallowed. These pin the failure paths AND that the success
// paths they sit next to still work.
describe('#2958 — a failure reported under HTTP 200 is a failure, not success', () => {
  it('flowHandler reports a failed launch (no status, no screen) instead of terminal success', async () => {
    // The reported repro: a screen flow whose first CRUD node fails. Outer
    // envelope says success; only `data.success` shows the truth.
    authFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { success: false, error: "Node 'apply' failed: Update requires an ID" },
      }),
    });
    const refreshSpy = vi.fn();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv', onRefresh: refreshSpy }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler({ type: 'flow', name: 'convert_lead', target: 'convert_lead' } as any);
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("Node 'apply' failed: Update requires an ID");
    // A failed run changed nothing — refreshing implies it did.
    expect(refreshSpy).not.toHaveBeenCalled();
    // The ActionRunner's post-execution hook owns the error toast; the handler
    // must not fire a second one.
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('flowHandler prefers the flow-declared errorMessage over the raw engine error', async () => {
    authFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          success: false,
          status: 'failed',
          error: "Node 'apply' failed: constraint violation on lead.status",
          errorMessage: 'This lead has already been converted.',
        },
      }),
    });
    const { result } = renderHook(() => useConsoleActionRuntime({ dataSource: {}, objects: [] }));

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler({ type: 'flow', name: 'convert_lead', target: 'convert_lead' } as any);
    });

    expect(res).toMatchObject({ success: false, error: 'This lead has already been converted.' });
  });

  it('flowHandler still OPENS the wizard on a screen pause (success path intact)', async () => {
    // The engine stamps `success: true` alongside `status: 'paused'`, which is
    // why classifying failure first cannot swallow a wizard. `silent: true` is
    // the marker that the action only opened the runner.
    authFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          success: true,
          status: 'paused',
          runId: 'run-7',
          screen: { nodeId: 'collect', title: 'New Assignee', fields: [] },
        },
      }),
    });
    const refreshSpy = vi.fn();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], onRefresh: refreshSpy }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler({ type: 'flow', name: 'f', target: 'f' } as any);
    });

    expect(res).toMatchObject({ success: true, silent: true });
    // The run hasn't completed — the runner refreshes on completion, not now.
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('flowHandler coerces a nested {code, message} error to a string (React #31)', async () => {
    // Handing the object through as `error` reaches `toast.error()` as a React
    // child and crashes the page.
    authFetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: { message: 'Run is parked on a service-owned node', code: 'PERMISSION_DENIED' },
      }),
    });
    const { result } = renderHook(() => useConsoleActionRuntime({ dataSource: {}, objects: [] }));

    let res: any;
    await act(async () => {
      res = await result.current.flowHandler({ type: 'flow', name: 'f', target: 'f' } as any);
    });

    expect(typeof res.error).toBe('string');
    expect(res.error).toBe('Run is parked on a service-owned node');
  });

  it('apiHandler reports an HTTP-200 success:false body instead of refreshing on it', async () => {
    // The `log_call`-style repro on the api transport: 200, `success: false`.
    authFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: "Action 'log_call' on object '*' not found" }),
    });
    const refreshSpy = vi.fn();
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], onRefresh: refreshSpy }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({ type: 'api', name: 'log_call', target: '/api/v1/x' } as any);
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("Action 'log_call' on object '*' not found");
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('apiHandler leaves a payload that merely CONTAINS a success key alone', async () => {
    // Only the envelope's own `success: false` is a failure. A handler value
    // that happens to carry `success` is data, and a `success: true` envelope
    // is of course fine — neither may be misread as a rejection.
    authFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { success: false, rows: 0, note: 'partial' } }),
    });
    const { result } = renderHook(() => useConsoleActionRuntime({ dataSource: {}, objects: [] }));

    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({ type: 'api', name: 'x', target: '/api/v1/x' } as any);
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ success: false, rows: 0, note: 'partial' });
  });
});

/**
 * `recordIdParam` seeding refuses rather than under-specifies (objectstack#8018).
 *
 * The injection used to be `if (rowValue != null) body[param] = rowValue;` with a
 * silent `else`: a row that could not supply the key sent the request anyway,
 * minus the parameter naming the record. A backend reading a missing selector as
 * "match nothing" then answers success for having changed nothing — measured on a
 * session-revocation control that reported success and revoked nothing.
 *
 * The projection harvest (`listViewPredicates`, covered in plugin-grid and core)
 * closes the ordinary route to an absent key. This half closes the class: a row
 * can still lack the key for reasons projection cannot fix — a server-side read
 * mask that strips the field regardless of `$select` (`internal: true`), a
 * partial payload, a field the principal cannot read. The assertion that matters
 * on every case below is `authFetchSpy` never being called: the refusal must
 * happen BEFORE the request, not be read out of the response.
 */
describe('apiHandler — recordIdParam seeding refuses instead of under-specifying (objectstack#8018)', () => {
  const REVOKE = {
    type: 'api',
    name: 'revoke_session',
    label: 'Revoke Session',
    target: '/api/v1/auth/revoke-session',
    recordIdParam: 'token',
    recordIdField: 'token',
  };

  const dispatch = async (action: any, rowRecord: unknown) => {
    const { result } = renderHook(() => useConsoleActionRuntime({ dataSource: {}, objects: [] }));
    let res: any;
    await act(async () => {
      res = await result.current.apiHandler({
        ...action,
        params: { _rowRecord: rowRecord },
      } as any);
    });
    return res;
  };

  it('refuses when the row lacks the recordIdField key entirely', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ status: true }) });
    // Exactly what the unharvested projection delivered: every column except
    // the one the action identifies its record by.
    const res = await dispatch(REVOKE, { id: 'sess_1', ip_address: '10.0.0.2' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Revoke Session');
    expect(res.error).toContain('token');
    // The point of the whole card: no request goes out under-specified.
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('refuses when the key is present but null — a different repair, said differently', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ status: true }) });
    const res = await dispatch(REVOKE, { id: 'sess_1', token: null });

    expect(res.success).toBe(false);
    expect(res.error).toContain('this record has no value');
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('injects the value and dispatches when the row supplies it', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ status: true }) });
    const res = await dispatch(REVOKE, { id: 'sess_1', token: 'tok_abc' });

    expect(res.success).toBe(true);
    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(authFetchSpy.mock.calls[0][1].body)).toMatchObject({ token: 'tok_abc' });
  });

  it('keys off `id` by default, and refuses on a row without one', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ status: true }) });
    const byId = { ...REVOKE, recordIdField: undefined, recordIdParam: 'recordId' };

    const ok = await dispatch(byId, { id: 'sess_1' });
    expect(ok.success).toBe(true);
    expect(JSON.parse(authFetchSpy.mock.calls[0][1].body)).toMatchObject({ recordId: 'sess_1' });

    authFetchSpy.mockClear();
    const bad = await dispatch(byId, { ip_address: '10.0.0.2' });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain('"id"');
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('leaves an action declaring no recordIdParam completely alone', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ status: true }) });
    // No `recordIdParam` ⇒ no injection is declared ⇒ the guard has no opinion,
    // whatever the row does or does not carry.
    const res = await dispatch(
      { type: 'api', name: 'revoke_others', target: '/api/v1/auth/revoke-other-sessions' },
      { id: 'sess_1' },
    );

    expect(res.success).toBe(true);
    expect(authFetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('serverActionHandler — list_toolbar selection fallback', () => {
  it('uses the single selected row from the runner context as recordId', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler(
        { type: 'script', name: 'archive' } as any,
        { selectedRecords: [{ id: 'rec_7' }] } as any,
      );
    });

    expect(res).toMatchObject({ success: true });
    const [url, init] = authFetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/actions/inv/archive');
    expect(JSON.parse(init.body).recordId).toBe('rec_7');
  });

  it('honors a custom recordIdField when resolving from the selection', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    await act(async () => {
      await result.current.serverActionHandler(
        { type: 'script', name: 'archive', recordIdField: 'code' } as any,
        { selectedRecords: [{ id: 'rec_7', code: 'INV-001' }] } as any,
      );
    });

    expect(JSON.parse(authFetchSpy.mock.calls[0][1].body).recordId).toBe('INV-001');
  });

  it('blocks with an error (no API call) when multiple rows are selected', async () => {
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler(
        { type: 'script', name: 'archive' } as any,
        { selectedRecords: [{ id: 'a' }, { id: 'b' }] } as any,
      );
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/single record/i);
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('blocks a record-scoped script action launched with zero rows selected (#2210)', async () => {
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler(
        { type: 'script', name: 'archive', locations: ['list_item', 'list_toolbar'] } as any,
        { selectedRecords: [] } as any,
      );
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/select a row/i);
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('still calls an object-level toolbar script action with zero rows selected', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler(
        { type: 'script', name: 'export_all', locations: ['list_toolbar'] } as any,
        { selectedRecords: [] } as any,
      );
    });

    expect(res).toMatchObject({ success: true });
    expect(String(authFetchSpy.mock.calls[0][0])).toContain('/api/v1/actions/inv/export_all');
  });

  it('an aggregate dispatch (_selectedIds) passes the multi-select guard and posts no recordId (#3139)', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.serverActionHandler(
        {
          type: 'script',
          name: 'generate_qr_zip',
          locations: ['list_item', 'list_toolbar'],
          params: { _selectedIds: ['a', 'b'], format: 'png' },
        } as any,
        // Multi-select would block a single-record dispatch — the injected
        // `_selectedIds` marks this as the aggregate shape instead.
        { selectedRecords: [{ id: 'a' }, { id: 'b' }] } as any,
      );
    });

    expect(res).toMatchObject({ success: true });
    const [url, init] = authFetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/actions/inv/generate_qr_zip');
    const body = JSON.parse(init.body);
    // The server reads the id array, never a synthesized single recordId.
    expect(body.recordId).toBeUndefined();
    expect(body.params._selectedIds).toEqual(['a', 'b']);
    expect(body.params.format).toBe('png');
  });
});

describe('ConsoleActionRuntimeProvider — page-level action execution', () => {
  function Probe() {
    const { execute } = useAction();
    return (
      <button onClick={() => execute({ type: 'api', name: 'createEnv', target: '/api/v1/environments' } as any)}>
        run
      </button>
    );
  }

  it('an action:button consumer executes an api action through the runtime and triggers refresh', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) });
    const onRefresh = vi.fn();

    render(
      <ConsoleActionRuntimeProvider dataSource={{}} objects={[]} onRefresh={onRefresh}>
        <Probe />
      </ConsoleActionRuntimeProvider>,
    );

    fireEvent.click(screen.getByText('run'));

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalled());
    expect(String(authFetchSpy.mock.calls[0][0])).toContain('/api/v1/environments');
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — page-variable → submit bridge. apiHandler resolves `{{page.<var>}}`
// tokens in the request body against the live page-variable snapshot that
// PageVariableActionBridge publishes into the action context. This is the
// data-entry half of SDUI pages: an input writes a page variable, a submit
// button posts it.
// ---------------------------------------------------------------------------
describe('apiHandler — page-variable submit bridge', () => {
  it('resolves {{page.<var>}} tokens in params from context.pageVariables (type-preserving)', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    await act(async () => {
      await result.current.apiHandler(
        {
          type: 'api',
          name: 'onboard',
          target: '/api/v1/cloud/onboarding/complete',
          params: {
            workspace_name: '{{page.workspaceName}}',
            seats: '{{page.seats}}',
            label: 'ws-{{page.subdomain}}',
          },
        } as any,
        { pageVariables: { workspaceName: 'Acme', seats: 5, subdomain: 'acme' } } as any,
      );
    });

    const body = JSON.parse(authFetchSpy.mock.calls[0][1].body);
    expect(body.workspace_name).toBe('Acme');
    expect(body.seats).toBe(5); // whole-value token preserves the number type
    expect(body.label).toBe('ws-acme'); // embedded token is string-interpolated
  });

  it('resolves {{page.<var>}} tokens in bodyExtra as well', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    await act(async () => {
      await result.current.apiHandler(
        { type: 'api', name: 'x', target: '/api/v1/x', bodyExtra: { src: '{{page.subdomain}}' } } as any,
        { pageVariables: { subdomain: 'acme' } } as any,
      );
    });

    expect(JSON.parse(authFetchSpy.mock.calls[0][1].body).src).toBe('acme');
  });

  it('passes tokens through verbatim when no pageVariables context is present (back-compat)', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() =>
      useConsoleActionRuntime({ dataSource: {}, objects: [] }),
    );

    await act(async () => {
      await result.current.apiHandler(
        { type: 'api', name: 'x', target: '/api/v1/x', params: { a: '{{page.missing}}' } } as any,
      );
    });

    expect(JSON.parse(authFetchSpy.mock.calls[0][1].body).a).toBe('{{page.missing}}');
  });
});

describe('PageVariableActionBridge — end-to-end submit loop', () => {
  function FormProbe() {
    const { setVariable } = usePageVariables();
    const { execute } = useAction();
    return (
      <>
        <button onClick={() => setVariable('workspaceName', 'Acme')}>type</button>
        <button
          onClick={() =>
            void execute({
              type: 'api',
              name: 'onboard',
              target: '/api/v1/cloud/onboarding/complete',
              params: { workspace_name: '{{page.workspaceName}}' },
            } as any)
          }
        >
          submit
        </button>
      </>
    );
  }

  it('input → page variable → submit posts the resolved value', async () => {
    authFetchSpy.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(
      <ConsoleActionRuntimeProvider dataSource={{}} objects={[]}>
        <PageVariablesProvider definitions={[{ name: 'workspaceName', type: 'string', source: 'ws' }]}>
          <PageVariableActionBridge />
          <FormProbe />
        </PageVariablesProvider>
      </ConsoleActionRuntimeProvider>,
    );

    fireEvent.click(screen.getByText('type')); // writes page variable → bridge publishes snapshot
    fireEvent.click(screen.getByText('submit')); // executes api action → apiHandler resolves token

    await waitFor(() => expect(authFetchSpy).toHaveBeenCalled());
    expect(JSON.parse(authFetchSpy.mock.calls[0][1].body).workspace_name).toBe('Acme');
  });
});
