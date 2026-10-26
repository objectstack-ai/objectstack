/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10404 — the console `api` handler's generic (data-source) branch
 * never records a field the row does not carry as `null` in its Undo snapshot.
 *
 * This branch writes `params` plus `bodyExtra` through `dataSource.update` and,
 * for an `undoable` action, snapshots each written field's prior value off the
 * row stashed under `params._rowRecord`. The snapshot used to be
 * `rowRecord[k] ?? null`, so on a projected list row a written field no column
 * shows was recorded as `null` and Undo overwrote the stored value with it —
 * the same defect as `ActionRunner`'s `captureUpdateUndoData`, in the handler's
 * own copy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: unknown, _n: unknown, l: unknown) => l,
    fieldOptionLabel: (_o: unknown, _f: unknown, _v: unknown, l: unknown) => l,
    actionParamText: (_o: unknown, _a: unknown, _p: unknown, _attr: unknown, fallback: unknown) => fallback,
    actionParamOptionLabel: (_o: unknown, _a: unknown, _p: unknown, _v: unknown, fallback: unknown) => fallback,
    actionDescription: (_o: unknown, _a: unknown, fallback: unknown) => fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => String(options?.defaultValue ?? key),
  }),
}));

// Imported for real these drag in the modal/form graph; nothing here renders them.
vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import type { ActionDef, ActionResult } from '@object-ui/core';
import { useConsoleActionRuntime } from '../useConsoleActionRuntime';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Run the card's action through the generic branch against `row`. */
async function closeTask(row: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const dataSource = { update: vi.fn(async () => ({})) };
  const { result } = renderHook(() =>
    useConsoleActionRuntime({ dataSource, objects: [], objectName: 'task' }),
  );
  let res: ActionResult = { success: false };
  await act(async () => {
    res = await result.current.apiHandler({
      type: 'api',
      name: 'close_task',
      label: 'Close',
      target: 'close_task',
      undoable: true,
      bodyExtra: { status: 'closed' },
      params: { _rowRecord: row },
      ...extra,
    } as ActionDef);
  });
  return { res, dataSource };
}

describe('console `api` handler — the Undo snapshot never records an absent field as `null` (objectui#10404)', () => {
  it('offers no Undo when the row lacks the written field, and still performs the write', async () => {
    // A projected row: `status` was not selected.
    const { res, dataSource } = await closeTask({ id: 't_1', name: 'Ada' });

    expect(dataSource.update).toHaveBeenCalledWith('task', 't_1', { status: 'closed' });
    expect(res.success).toBe(true);
    expect(res.undo).toBeUndefined();
    expect(warn.mock.calls[0][1]).toEqual({ action: 'close_task', missing: ['status'] });
  });

  it('control: a row that carries the field snapshots its stored value', async () => {
    const { res } = await closeTask({ id: 't_1', name: 'Ada', status: 'open' });

    expect(res.undo?.undoData).toEqual({ status: 'open' });
    expect(res.undo?.redoData).toEqual({ status: 'closed' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('still snapshots a `null` the row carries — a real empty value', async () => {
    const { res } = await closeTask({ id: 't_1', status: null });

    expect(res.undo?.undoData).toEqual({ status: null });
  });

  it('offers no partial Undo: a carried `bodyExtra` field beside an absent param field is no Undo at all', async () => {
    const { res } = await closeTask(
      { id: 't_1', status: 'open' },
      { params: { _rowRecord: { id: 't_1', status: 'open' }, note: 'typed' } },
    );

    expect(res.success).toBe(true);
    expect(res.undo).toBeUndefined();
    expect(warn.mock.calls[0][1]).toEqual({ action: 'close_task', missing: ['note'] });
  });
});
