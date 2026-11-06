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

async function collectParams(dispatch: Record<string, unknown>) {
  paramDialogState = null;
  let collect: any;
  render(<Harness onReady={(fn) => { collect = fn; }} />);
  await act(async () => {
    void collect(PARAMS, dispatch as any);
    await Promise.resolve();
  });
  expect(paramDialogState).toBeTruthy();
}

beforeEach(() => {
  bundle = {};
  asked.length = 0;
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
