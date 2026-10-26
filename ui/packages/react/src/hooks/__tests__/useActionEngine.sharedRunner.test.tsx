/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression suite for the `useActionEngine` × `<ActionProvider>` contract.
 *
 * Two behaviours are locked down here:
 *
 *  1. When mounted under `<ActionProvider>`, `useActionEngine` MUST share
 *     the provider's `ActionRunner` instance. The provider is the only
 *     place that has the platform-level handlers (`onConfirm`, `onToast`,
 *     `onParamCollection`, …) wired up — a nested standalone runner would
 *     silently no-op on `params:` / `confirmText` actions.
 *
 *  2. When the hook layers per-render context onto a shared runner, it
 *     must MERGE into the existing `ctx` namespace rather than replace it.
 *     The provider seeds `ctx: { record, user, objectName }`; if the hook
 *     wrote `ctx: { record, recordId, objectName }` wholesale it would
 *     wipe `ctx.user`, and every `record.id == ctx.user.id`-style
 *     predicate would throw → fail closed → every action hidden.
 *     This is the bug that hid Change Password / Delete My Account on the
 *     sys_user Security tab.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActionEngine } from '../useActionEngine';
import { ActionProvider, useAction } from '../../context/ActionContext';

const SELF_ID = 'user-self';

function withProvider(providerContext: any) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(ActionProvider, { context: providerContext, children });
}

describe('useActionEngine — shared ActionProvider runner', () => {
  it('reuses the provider runner instead of building a standalone one', () => {
    // Render the hook and `useAction()` under the same provider tree and
    // verify both observe the same in-memory `ActionRunner` instance.
    // (Two separate `renderHook` calls would each instantiate their own
    // provider, so identity comparison there is meaningless.)
    const wrapper = withProvider({
      record: { id: SELF_ID },
      user: { id: SELF_ID },
      objectName: 'sys_user',
    });

    const { result } = renderHook(
      () => ({
        hook: useActionEngine({ actions: [] }),
        provider: useAction(),
      }),
      { wrapper }
    );
    expect(result.current.hook.engine.getRunner()).toBe(result.current.provider.runner);
  });

  it('preserves provider `ctx.user` when hook layers per-render context (regression)', () => {
    // The bug: the hook used to call `updateContext({ ctx: {record, recordId, objectName} })`
    // which overwrote the provider's `ctx: {record, user, objectName}` wholesale,
    // dropping `ctx.user`. Predicates like `record.id == ctx.user.id` then
    // threw ReferenceError → fail-closed → every action hidden.
    const wrapper = withProvider({
      record: { id: SELF_ID },
      user: { id: SELF_ID, name: 'Self' },
      objectName: 'sys_user',
    });

    const { result } = renderHook(
      () =>
        useActionEngine({
          actions: [
            {
              name: 'change_password',
              type: 'script',
              target: 'true',
              visible: 'record.id == ctx.user.id',
              locations: ['record_section'],
            } as any,
          ],
          context: {
            // Per-render context that previously stomped the provider's ctx.
            record: { id: SELF_ID },
            recordId: SELF_ID,
            objectName: 'sys_user',
          },
        }),
      { wrapper }
    );

    const visible = result.current.getActionsForLocation('record_section').map(a => a.name);
    expect(visible).toContain('change_password');

    // And verify the runner's resolved ctx still has `user` after the merge.
    const ctxSnapshot = result.current.engine.getRunner().getEvaluator().getContext().toObject() as any;
    expect(ctxSnapshot.ctx).toBeDefined();
    expect(ctxSnapshot.ctx.user).toBeDefined();
    expect(ctxSnapshot.ctx.user.id).toBe(SELF_ID);
    // Per-render fields are also present.
    expect(ctxSnapshot.ctx.record.id).toBe(SELF_ID);
  });

  it('still works standalone (no provider) with both flat and ctx accessors', () => {
    const { result } = renderHook(() =>
      useActionEngine({
        actions: [
          {
            name: 'self_only_flat',
            type: 'script',
            target: 'true',
            visible: 'record.id == user.id',
            locations: ['record_section'],
          } as any,
          {
            name: 'self_only_ctx',
            type: 'script',
            target: 'true',
            visible: 'record.id == ctx.user.id',
            locations: ['record_section'],
          } as any,
        ],
        context: {
          record: { id: SELF_ID },
          user: { id: SELF_ID },
        },
      })
    );

    const visible = result.current.getActionsForLocation('record_section').map(a => a.name);
    expect(visible.sort()).toEqual(['self_only_ctx', 'self_only_flat']);
  });
});
