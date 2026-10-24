/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13397 — a record-scoped `type: 'flow'` action launched from a list
 * toolbar with a row count other than 1 is refused BEFORE its param dialog,
 * with a translated toast and no request. objectui#13384 gave the `script`
 * handler that early refusal (`refuseBeforeInput`); the console `flowHandler`
 * ran the same resolver only at dispatch time, after the whole dialog, and
 * showed its English `error`.
 *
 * The session here reads zh-CN: the translator answers from the shipped zh
 * pack, so a refusal that reaches the toast untranslated reads English and
 * fails the text pin.
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

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const { builtInLocales } = await import('@object-ui/i18n/locales');
  // The zh-CN pack, read by dotted key; a key it lacks answers its default.
  const zhT = (key: string, options?: { defaultValue?: string }) => {
    const hit = key.split('.').reduce<unknown>(
      (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      builtInLocales.zh,
    );
    return typeof hit === 'string' ? hit : String(options?.defaultValue ?? key);
  };
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useObjectLabel: () => ({
      fieldLabel: (_o: unknown, _n: unknown, l: string) => l,
      fieldOptionLabel: (_o: unknown, _f: unknown, _v: unknown, l: string) => l,
      actionParamText: (_o: unknown, _a: unknown, _p: unknown, _attr: unknown, fallback: string) => fallback,
      actionParamOptionLabel: (_o: unknown, _a: unknown, _p: unknown, _v: unknown, fallback: string) => fallback,
      actionDescription: (_o: unknown, _a: unknown, fallback: string) => fallback,
    }),
    useObjectTranslation: () => ({ t: zhT, language: 'zh' }),
  };
});

vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));

// The param dialog renders a marker while it is open — the "did a dialog open"
// probe. The other dialogs stay inert.
vi.mock('../../views/ActionParamDialog', () => ({
  ActionParamDialog: ({ state }: { state: { open?: boolean } }) =>
    state?.open ? <div data-testid="param-dialog" /> : null,
}));
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { toast } from 'sonner';
import { useConsoleActionRuntime, ConsoleActionRuntimeProvider } from '../useConsoleActionRuntime';
import { useAction } from '@object-ui/react';
import { resolveServerActionRecordId, type ActionContext, type ActionDef } from '@object-ui/core';

const ZH_SELECT_ROW_FIRST = '此操作针对单条记录，请先选择一行。';
const ZH_SELECT_EXACTLY_ONE_ROW = '此操作针对单条记录，请只选择一行。';

/** A record-scoped flow with a param dialog, mounted on rows AND the toolbar. */
const REASSIGN = {
  type: 'flow',
  name: 'reassign',
  target: 'reassign_wizard',
  locations: ['list_item', 'list_toolbar'],
  params: [{ name: 'owner', label: 'Owner', type: 'text', required: true }],
};
const launch = (extra: Record<string, unknown> = {}): ActionDef => ({ ...JSON.parse(JSON.stringify(REASSIGN)), ...extra });
const rowsContext = (rows: Record<string, unknown>[]): ActionContext => ({ selectedRecords: rows });
const toastError = vi.mocked(toast.error);

beforeEach(() => {
  authFetchSpy.mockReset();
  toastError.mockClear();
  vi.mocked(toast.success).mockClear();
});

describe('flowHandler.refuseBeforeInput — the resolver its dispatch runs (objectui#13397)', () => {
  const runtime = () => renderHook(() => useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' })).result.current;

  it.each([
    ['0 rows', [] as Record<string, unknown>[], 'actions.selectRowFirst'],
    ['2 rows', [{ id: 'a' }, { id: 'b' }], 'actions.selectExactlyOneRow'],
  ])('%s: answers the resolver\'s refusal with its pack key', (_label, rows, errorKey) => {
    const context = rowsContext(rows);
    const rule = resolveServerActionRecordId(launch(), context);

    expect(runtime().flowHandler.refuseBeforeInput?.(launch(), context)).toEqual({ error: rule.error, errorKey });
  });

  it('1 row: no refusal', () => {
    expect(runtime().flowHandler.refuseBeforeInput?.(launch(), rowsContext([{ id: 'a' }])))
      .toBeUndefined();
  });

  it('control: an object-level toolbar flow with 0 rows is not refused', () => {
    expect(runtime().flowHandler.refuseBeforeInput?.(
      launch({ locations: ['list_toolbar'] }),
      rowsContext([]),
    )).toBeUndefined();
  });

  it('control: a dialog that itself collects `recordId` is not judged before it runs', () => {
    const collectsRecordId = launch({ params: [{ name: 'recordId', label: 'Record', type: 'text' }] });

    expect(runtime().flowHandler.refuseBeforeInput?.(collectsRecordId, rowsContext([])))
      .toBeUndefined();
  });
});

describe('a toolbar flow launch through the console runtime (objectui#13397)', () => {
  function Probe({ rows, action }: { rows: Record<string, unknown>[]; action: ActionDef }) {
    const { execute, updateContext } = useAction();
    return (
      <button
        onClick={() => {
          updateContext({ selectedRecords: rows });
          void execute(action);
        }}
      >
        run-flow
      </button>
    );
  }
  const mount = (rows: Record<string, unknown>[], action: ActionDef = launch()) => {
    render(
      <ConsoleActionRuntimeProvider dataSource={{}} objects={[]} objectName="inv">
        <Probe rows={rows} action={action} />
      </ConsoleActionRuntimeProvider>,
    );
    fireEvent.click(screen.getByText('run-flow'));
  };

  it.each([
    ['0 rows', [] as Record<string, unknown>[], ZH_SELECT_ROW_FIRST],
    ['2 rows', [{ id: 'a' }, { id: 'b' }], ZH_SELECT_EXACTLY_ONE_ROW],
  ])('%s: refused before the param dialog, with a zh-CN toast and no request', async (_label, rows, zh) => {
    mount(rows);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(zh));
    expect(screen.queryByTestId('param-dialog')).toBeNull();
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('1 row: the param dialog opens, as today, and nothing is refused', async () => {
    mount([{ id: 'rec_1' }]);

    await screen.findByTestId('param-dialog');
    expect(toastError).not.toHaveBeenCalled();
    expect(authFetchSpy).not.toHaveBeenCalled();
  });

  it('control: an object-level toolbar flow with 0 rows still opens its dialog', async () => {
    mount([], launch({ locations: ['list_toolbar'] }));

    await screen.findByTestId('param-dialog');
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('flowHandler called directly: the dispatch-time refusal is translated (objectui#13397)', () => {
  it.each([
    ['0 rows', [] as Record<string, unknown>[], ZH_SELECT_ROW_FIRST],
    ['2 rows', [{ id: 'a' }, { id: 'b' }], ZH_SELECT_EXACTLY_ONE_ROW],
  ])('%s: refuses in zh-CN through the pack key, with no request', async (_label, rows, zh) => {
    const { result } = renderHook(() => useConsoleActionRuntime({ dataSource: {}, objects: [], objectName: 'inv' }));

    let res: unknown;
    await act(async () => {
      res = await result.current.flowHandler(launch({ params: {} }), rowsContext(rows));
    });

    expect(res).toEqual({ success: false, error: zh });
    expect(authFetchSpy).not.toHaveBeenCalled();
  });
});
