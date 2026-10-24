/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useNavActionDispatch — nav `action` items reach the action runtime
 * (framework#4509).
 *
 * The contract has three parts, and the third is the one the bug was made of:
 * resolve `actionDef.actionName` against `action` metadata, dispatch the
 * resolved def through the runner, and FAIL LOUDLY when either step comes up
 * empty — a silent return would reproduce the dead click through a new route.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const execute = vi.fn();
const getItem = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAction: () => ({ execute }),
}));
vi.mock('../../providers/MetadataProvider', () => ({ useMetadata: () => ({ getItem }) }));

import { useNavActionDispatch } from '../useNavActionDispatch';

const navItem = (over: Record<string, unknown> = {}) => ({
  id: 'nav_export',
  type: 'action',
  label: 'Export Data',
  actionDef: { actionName: 'export_data' },
  ...over,
}) as never;

async function dispatch(item: unknown) {
  const { result } = renderHook(() => useNavActionDispatch());
  await act(async () => {
    result.current(item as never);
    // The handler is fire-and-forget by design (the renderer's onClick is
    // synchronous); let its promise chain settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue(undefined);
  getItem.mockReset();
  toastError.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useNavActionDispatch', () => {
  it('resolves the action by name and dispatches the resolved definition', async () => {
    getItem.mockResolvedValue({ name: 'export_data', type: 'api', target: '/exports', label: 'Export' });

    await dispatch(navItem());

    expect(getItem).toHaveBeenCalledWith('action', 'export_data');
    expect(execute).toHaveBeenCalledTimes(1);
    const [dispatched] = execute.mock.calls[0];
    // The whole def rides the dispatch — the runner reads type/target/label.
    expect(dispatched).toMatchObject({ name: 'export_data', type: 'api', target: '/exports' });
  });

  it("moves a declared `params` ARRAY to `actionParams` (the runner's dialog input)", async () => {
    getItem.mockResolvedValue({
      name: 'export_data',
      type: 'api',
      params: [{ name: 'format', type: 'text' }],
    });

    await dispatch(navItem());

    const [dispatched] = execute.mock.calls[0];
    expect(dispatched.actionParams).toEqual([{ name: 'format', type: 'text' }]);
    // `params` on the dispatch is the VALUE bag, not the param declarations —
    // leaving the array there would make the runner treat it as values.
    expect(Array.isArray(dispatched.params)).toBe(false);
  });

  it("passes the nav item's own actionDef.params through as the value bag", async () => {
    getItem.mockResolvedValue({ name: 'export_data', type: 'api' });

    await dispatch(navItem({ actionDef: { actionName: 'export_data', params: { format: 'csv' } } }));

    const [dispatched] = execute.mock.calls[0];
    expect(dispatched.params).toEqual({ format: 'csv' });
  });

  it('warns and toasts — without dispatching — when the action is not defined', async () => {
    getItem.mockResolvedValue(null);

    await dispatch(navItem());

    expect(execute).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toContain('export_data');
  });

  it('warns and toasts when the nav item names no action at all', async () => {
    await dispatch(navItem({ actionDef: undefined }));

    expect(getItem).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('surfaces a resolution failure instead of swallowing it', async () => {
    getItem.mockRejectedValue(new Error('offline'));

    await dispatch(navItem());

    expect(execute).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure thrown by the action itself', async () => {
    getItem.mockResolvedValue({ name: 'export_data', type: 'api' });
    execute.mockRejectedValue(new Error('boom'));

    await dispatch(navItem());

    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
