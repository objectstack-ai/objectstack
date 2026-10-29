/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27487 — a `type: 'api'` action whose target is a declared
 * `type: 'flow'` endpoint shows the run's inner refusal, not the node chain.
 *
 * The endpoint answers a failed run with the trigger door's `400 FLOW_FAILED`
 * (`error.details.innerRefusal` included). The shared console runtime's
 * `apiHandler` used to toast that envelope's `message`, so a member refused on
 * a flow's `update_record` read `Node '…' failed: update_record(…) failed: …`.
 * It now reads the envelope through `apiActionFailureMessage`, in the host's
 * active language.
 *
 * CONTROL: a 4xx that is not `FLOW_FAILED` still reads its own message.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
  useObjectTranslation: () => ({
    t: (key: string, options?: any) => String(options?.defaultValue ?? key),
    language: 'zh-CN',
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

// Every pack resident, so the `zh` line is the catalogue a Chinese console has.
registerBuiltInLocales();

const REFUSAL = 'You do not have permission to perform this action. Contact your administrator if you need access.';
const NESTED = "Node 'recalc_each' failed: map 'recalc_each': item 0 (subflow 'showcase_recalc_task_estimate') failed: "
  + `Node 'write_estimate' failed: update_record(showcase_task) failed: ${REFUSAL}`;

const RECALC = {
  name: 'showcase_recalc_estimate',
  label: 'Recalculate Estimate',
  type: 'api',
  target: '/api/v1/apps/showcase/recalc',
  recordIdParam: 'recordId',
  params: { _rowRecord: { id: 'task-1' } },
};

function answer(status: number, body: unknown) {
  authFetchSpy.mockImplementation(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

async function runRecalc() {
  const { result } = renderHook(() =>
    useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'showcase_task' }),
  );
  let out: any;
  await act(async () => {
    out = await result.current.apiHandler({ ...RECALC } as any);
  });
  return out;
}

beforeEach(() => {
  authFetchSpy.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectstack#27487 — console runtime: a flow-backed api action reads the run refusal', () => {
  it("a refused nested map → subflow write shows the record form's permission line, in the host's language", async () => {
    answer(400, {
      success: false,
      error: {
        code: 'FLOW_FAILED',
        message: NESTED,
        httpStatus: 400,
        details: { innerRefusal: { code: 'PERMISSION_DENIED', message: REFUSAL } },
      },
    });

    const out = await runRecalc();

    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ success: false, error: builtInLocales.zh.form.noPermissionToSave });
  });

  it('CONTROL: a 4xx that is not FLOW_FAILED reads its own message', async () => {
    answer(403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'Forbidden', httpStatus: 403 } });

    expect(await runRecalc()).toEqual({ success: false, error: 'Forbidden' });
  });
});
