/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useConsoleActionRuntime`'s param-collection handler hands the dialog the
 * host-composed companion `resolveParamDialogCompanion` picks
 * (objectstack#30205): the ban dialog carries the user's assigned-work panel
 * for the row it runs on, and any other action carries none.
 * `RecordDetailView`'s handler, the second reader of the same seam, has its
 * own copy of these pins.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

/** The bundle, keyed `KEY_OBJECT|ACTION` (`global` for no key object). */
let bundle: Record<string, string> = {};
const asked: Array<{ objectName: string | undefined; actionName: string | undefined; fallback: unknown }> = [];
/** Preflight row labels, keyed `KEY_OBJECT|ACTION|PATH` (`global` for no key object). */
let preflightLabels: Record<string, string> = {};
const preflightAsked: Array<{ objectName: string | undefined; actionName: string | undefined }> = [];
const LANGUAGE = 'zh-CN';

// Partial mock: `@object-ui/components` reaches for `createSafeTranslation` at
// import time, so a total double breaks the module graph.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => fallback,
    actionSubmitText: (_o: any, _a: any, fallback: any) => fallback,
    actionCancelText: (objectName: string | undefined, actionName: string | undefined, fallback?: string) => {
      asked.push({ objectName, actionName, fallback });
      return bundle[`${objectName ?? 'global'}|${actionName}`] ?? (fallback || undefined);
    },
    // Stands in for the bundle overlay so this file pins what the handler asks
    // and passes on; the bundle node lookup is `@object-ui/i18n`'s own pin.
    actionPreflight: (objectName: string | undefined, actionName: string | undefined, spec: any) => {
      preflightAsked.push({ objectName, actionName });
      if (!spec || !Array.isArray(spec.fields)) return spec;
      return {
        ...spec,
        fields: spec.fields.map((field: any) => {
          const label = preflightLabels[`${objectName ?? 'global'}|${actionName}|${field.path}`];
          return label ? { ...field, label } : field;
        }),
      };
    },
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) => String(options?.defaultValue ?? key),
    language: LANGUAGE,
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

let paramDialogState: any = null;
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({
  ActionParamDialog: ({ state }: any) => {
    if (state?.open) paramDialogState = state;
    return null;
  },
}));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  return { toast: fn };
});

import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

const PARAMS = [{ name: 'subject', label: 'Subject', type: 'text' }] as any[];

function Harness({ onReady }: { onReady: (fn: any) => void }) {
  const runtime = useConsoleActionRuntime({ dataSource: {}, objects: [] });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime.actionProviderProps.onParamCollection);
  }
  return <>{runtime.dialogs}</>;
}

async function collectParams(dispatch: Record<string, unknown>, interpolateRead?: unknown) {
  paramDialogState = null;
  let collect: any;
  render(<Harness onReady={(fn) => { collect = fn; }} />);
  await act(async () => {
    void collect(PARAMS, dispatch as any, undefined, undefined, interpolateRead);
    await Promise.resolve();
  });
  expect(paramDialogState).toBeTruthy();
}

beforeEach(() => {
  bundle = {};
  asked.length = 0;
  preflightLabels = {};
  preflightAsked.length = 0;
  paramDialogState = null;
});

describe('useConsoleActionRuntime — the ban dialog\'s companion (objectstack#30205)', () => {
  it('hands the ban dialog the assigned-work panel for the row it runs on', async () => {
    await collectParams({ name: 'ban_user', label: 'Ban User', objectName: 'sys_user', params: { _rowRecord: { id: 'u_lee', name: 'Lee' } } });
    expect(paramDialogState.companion).toEqual({ kind: 'user-assigned-work', userId: 'u_lee' });
  });

  it('CONTROL: another sys_user action carries no companion', async () => {
    await collectParams({ name: 'unban_user', label: 'Unban User', objectName: 'sys_user', params: { _rowRecord: { id: 'u_lee' } } });
    expect(paramDialogState.companion).toBeUndefined();
  });
});

describe('useConsoleActionRuntime — the declared preflight read joins the slot (objectstack#31808)', () => {
  const PREFLIGHT = { read: { url: '/api/v1/plan?subject=${param.subject}' }, path: 'data' };
  const fill = () => '/api/v1/plan';

  it('hands the dialog the action\'s preflight, judged by the spec, with the runner\'s filler', async () => {
    await collectParams({ name: 'send_note', label: 'Send', objectName: 'crm_note', preflight: PREFLIGHT }, fill);
    expect(paramDialogState.companion).toMatchObject({ kind: 'preflight', judged: { ok: true } });
    expect(paramDialogState.companion.interpolateRead).toBe(fill);
    expect(paramDialogState.companion.hostChrome).toBeUndefined();
  });

  it('keeps the ban dialog\'s panel beside a declared read on the same action', async () => {
    await collectParams(
      { name: 'ban_user', label: 'Ban User', objectName: 'sys_user', preflight: PREFLIGHT, params: { _rowRecord: { id: 'u_lee' } } },
      fill,
    );
    expect(paramDialogState.companion).toMatchObject({
      kind: 'preflight',
      hostChrome: { kind: 'user-assigned-work', userId: 'u_lee' },
    });
  });
});

describe('useConsoleActionRuntime — the preflight rows read the bundle (objectstack#31937)', () => {
  const PREFLIGHT = {
    read: { url: '/api/v1/plan?subject=${param.subject}' },
    path: 'data',
    fields: [
      { path: 'plan.total', label: 'Total' },
      { path: 'plan.note', label: { en: 'Note', 'zh-CN': '备注' } },
    ],
  };

  it('hands the companion the localized rows, asked on the action\'s own object', async () => {
    preflightLabels = { 'crm_note|send_note|plan.total': '合计' };
    await collectParams({ name: 'send_note', label: 'Send', objectName: 'crm_note', preflight: PREFLIGHT });
    expect(preflightAsked).toEqual([{ objectName: 'crm_note', actionName: 'send_note' }]);
    expect(paramDialogState.companion.judged).toMatchObject({ ok: true });
    expect(paramDialogState.companion.judged.preflight.fields).toEqual([
      { path: 'plan.total', label: '合计' },
      // No bundle string: the authored inline map goes on as written.
      { path: 'plan.note', label: { en: 'Note', 'zh-CN': '备注' } },
    ]);
  });

  it('CONTROL: an action that declares no preflight asks nothing', async () => {
    await collectParams({ name: 'send_note', label: 'Send', objectName: 'crm_note' });
    expect(preflightAsked).toEqual([]);
    expect(paramDialogState.companion).toBeUndefined();
  });
});
