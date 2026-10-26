/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordDetailDrawer } from '../RecordDetailDrawer';

/**
 * Capability = handler presence (#2436 第 5 项).
 *
 * The drawer must derive its edit/delete affordances from whether the host
 * actually supplied `onFieldSave` / `onDelete` — a caller that omits them
 * (e.g. plugin-gantt for a row locked via `lockField`, or a globally
 * read-only gantt) gets a strictly read-only drawer. Previously the drawer
 * hardcoded `inlineEdit` + `showDelete: true` and always passed wrapper
 * functions down, so the inner DetailView saw live handlers even when the
 * outer props were undefined — letting users "edit" locked records (the
 * edits silently went nowhere) and see a Delete action that shouldn't exist.
 *
 * DetailView is mocked to capture the exact props it receives; its own
 * gating of `inlineEdit` / `schema.showDelete` is covered by the DetailView
 * and DetailSection test suites.
 */

const captured = vi.hoisted(() => ({ props: [] as any[] }));
const capturedBar = vi.hoisted(() => ({ props: [] as any[] }));

vi.mock('../DetailView', () => ({
  DetailView: (props: any) => {
    captured.props.push(props);
    return <div data-testid="dv-probe" />;
  },
}));

// Inline-edit persistence moved out of DetailView into <InlineEditSaveBar>
// (objectui#2407 P1). Capture the save bar's props to assert the drawer wires
// the host's per-field onFieldSave into it (callback-persistence mode).
vi.mock('../InlineEditSaveBar', () => ({
  InlineEditSaveBar: (props: any) => {
    capturedBar.props.push(props);
    return null;
  },
}));

function lastProps() {
  expect(captured.props.length).toBeGreaterThan(0);
  return captured.props[captured.props.length - 1];
}

function lastBarProps() {
  expect(capturedBar.props.length).toBeGreaterThan(0);
  return capturedBar.props[capturedBar.props.length - 1];
}

function renderDrawer(extra: Partial<React.ComponentProps<typeof RecordDetailDrawer>> = {}) {
  return render(
    <RecordDetailDrawer
      open
      onClose={() => {}}
      title="Task Details"
      record={{ id: '1', name: 'Hello' }}
      objectName="tasks"
      recordId="1"
      {...extra}
    />,
  );
}

beforeEach(() => {
  captured.props.length = 0;
  capturedBar.props.length = 0;
});

describe('RecordDetailDrawer capability = handler presence', () => {
  it('enables inline edit and delete when both handlers are supplied', () => {
    renderDrawer({ onFieldSave: vi.fn(), onDelete: vi.fn() });
    const props = lastProps();
    expect(props.inlineEdit).toBe(true);
    expect(props.schema.showDelete).toBe(true);
    // onFieldSave no longer rides on DetailView — it wires into the save bar.
    expect(props.onFieldSave).toBeUndefined();
    expect(typeof props.onDelete).toBe('function');
    expect(typeof lastBarProps().onFieldSave).toBe('function');
  });

  it('renders strictly read-only when both handlers are omitted', () => {
    renderDrawer();
    const props = lastProps();
    expect(props.inlineEdit).toBe(false);
    expect(props.schema.showDelete).toBe(false);
    expect(props.onFieldSave).toBeUndefined();
    expect(props.onDelete).toBeUndefined();
    // The save bar also receives no persistence handler (read-only).
    expect(lastBarProps().onFieldSave).toBeUndefined();
  });

  it('gates each capability independently (save without delete)', () => {
    renderDrawer({ onFieldSave: vi.fn() });
    const props = lastProps();
    expect(props.inlineEdit).toBe(true);
    expect(props.schema.showDelete).toBe(false);
    expect(props.onDelete).toBeUndefined();
  });

  it('forwards field saves to the host handler', async () => {
    const onFieldSave = vi.fn().mockResolvedValue(undefined);
    renderDrawer({ onFieldSave });
    await lastBarProps().onFieldSave('name', 'World');
    expect(onFieldSave).toHaveBeenCalledWith('name', 'World');
  });

  it('rethrows a rejected field save so the save bar can keep the draft and show it', async () => {
    // Swallowing here made a rejected save look successful: the value looked
    // persisted and the failure was never displayed (#2473 第 2 项).
    const onFieldSave = vi.fn().mockRejectedValue(new Error('仅管理责任人可修改'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDrawer({ onFieldSave });
    await expect(lastBarProps().onFieldSave('name', 'World')).rejects.toThrow('仅管理责任人可修改');
    errSpy.mockRestore();
  });

  it('closes the drawer after a successful delete, but not on failure', async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderDrawer({ onClose, onDelete });
    await lastProps().onDelete();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Failure path: the wrapper swallows (logs) the error and keeps the
    // drawer open so the user can retry.
    captured.props.length = 0;
    const onClose2 = vi.fn();
    const failingDelete = vi.fn().mockRejectedValue(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDrawer({ onClose: onClose2, onDelete: failingDelete });
    await lastProps().onDelete();
    await waitFor(() => expect(failingDelete).toHaveBeenCalledTimes(1));
    expect(onClose2).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
