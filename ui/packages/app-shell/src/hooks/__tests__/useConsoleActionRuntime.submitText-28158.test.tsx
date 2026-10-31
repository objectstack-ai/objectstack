/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `useConsoleActionRuntime`'s param-collection handler resolves the action's
 * `submitText` — the verb on the param dialog's submit button — the way it
 * resolves `description` (objectstack#28158):
 *
 *  1. the translation bundle's `objects.OBJECT._actions.ACTION.submitText`
 *     (`globalActions.ACTION.submitText` for an object-less action), through
 *     `useObjectLabel().actionSubmitText`;
 *  2. else the authored inline locale map, collapsed to the active language;
 *  3. else the authored string.
 *
 * The bundle lookup itself (which node an action reads) is `@object-ui/i18n`'s
 * and is pinned there (`useObjectLabel-actionSubmitText-28158.test.tsx`). Here
 * the resolver is a stand-in that records what it is asked, so this file pins
 * the HANDLER's half: which key object and name it asks with, that the
 * fallback it offers is already one string in the active language, and that
 * the answer reaches the dialog. `RecordDetailView`'s handler, the second
 * reader of the same seam, has its own copy of these pins.
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
    actionSubmitText: (objectName: string | undefined, actionName: string | undefined, fallback?: string) => {
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

describe('useConsoleActionRuntime — the param dialog\'s submit verb (objectstack#28158)', () => {
  it('hands the dialog the authored string', async () => {
    await collectParams({ name: 'send_email', label: 'Send Email', objectName: 'crm_contact', submitText: 'Send' });
    expect(paramDialogState.submitText).toBe('Send');
    expect(asked).toEqual([{ objectName: 'crm_contact', actionName: 'send_email', fallback: 'Send' }]);
  });

  it('prefers the bundle entry over the authored string', async () => {
    bundle['crm_contact|send_email'] = '发送';
    await collectParams({ name: 'send_email', label: 'Send Email', objectName: 'crm_contact', submitText: 'Send' });
    expect(paramDialogState.submitText).toBe('发送');
  });

  it('collapses an inline locale map to the active language BEFORE offering it as the fallback', async () => {
    await collectParams({
      name: 'send_email',
      label: 'Send Email',
      objectName: 'crm_contact',
      submitText: { en: 'Send', 'zh-CN': '发出' },
    });
    expect(paramDialogState.submitText).toBe('发出');
    expect(asked[0].fallback).toBe('发出');
  });

  it('asks the global node for an object-less action', async () => {
    bundle['global|log_call'] = '记录通话';
    await collectParams({ name: 'log_call', label: 'Log Call', submitText: 'Log Call' });
    expect(asked[0]).toMatchObject({ objectName: undefined, actionName: 'log_call' });
    expect(paramDialogState.submitText).toBe('记录通话');
  });

  it('hands the dialog nothing when the action names no verb and the bundle has none — the dialog says Confirm', async () => {
    await collectParams({ name: 'send_email', label: 'Send Email', objectName: 'crm_contact' });
    expect(paramDialogState.submitText).toBeUndefined();
    expect(asked[0].fallback).toBeUndefined();
  });
});
