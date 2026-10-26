/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The param-collection dialog titles itself from `label` and from nothing else
 * (objectui#4282).
 *
 * This used to read `action?.label || action?.title`. `title` is declared on no
 * action surface in the ecosystem — it is absent from `@objectstack/spec`'s
 * `ActionSchema` (44 keys at spec 17.0.0), from `ActionDef`, from
 * `@object-ui/types`' renderer view (`ui-action.ts`) and from its `crud.ts`
 * `ActionSchema` / `BaseSchema` — and none of the four action renderers
 * (`action:button`, `action:icon`, `action:group`, `action:menu`) forwards it.
 * So the right-hand side of that `||` was unreachable from authored metadata:
 * a fallback that cannot fire, which is precisely the "declared is not
 * enforced" shape objectstack#4075 exists to reduce.
 *
 * ## Why this is a pin and not just a deletion
 *
 * Removing an alias is cheap; keeping it removed is the expensive half. The
 * handler's `action` parameter is `any`, so nothing in the compiler stops the
 * limb being helpfully reinstated by the next reader who sees an untitled
 * dialog and reaches for a second key. The second test below is red the moment
 * that happens, and names the rule in its failure.
 *
 * Deliberately NOT pinned here: that a host may not carry a `title` at all.
 * Objects reaching this handler are plain data (objectstack#3903 — stored
 * `sys_metadata` rows are rehydrated unparsed), so a stray key is not an error,
 * it is simply not read. The assertion is about the READER, which is the half
 * this file owns.
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

// Partial mock: `@object-ui/components` reaches for `createSafeTranslation` at
// import time (`lib/close-label.tsx` -> `ui/dialog.tsx`), so a total double
// breaks the module graph before a single test runs. Same shape as the sibling
// override-notice suite.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) => String(options?.defaultValue ?? key),
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

/** Capture the state the param dialog is handed — it IS the assertion subject. */
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

const PARAMS = [{ name: 'comment', label: 'Comment', type: 'textarea' }] as any[];

/**
 * Mount the runtime WITH its `dialogs` element — the param dialog reads its
 * state from there, so a bare `renderHook` would leave the capture above empty.
 */
function Harness({ onReady }: { onReady: (fn: any) => void }) {
  const runtime = useConsoleActionRuntime({ dataSource: {}, objects: [] });
  const ready = React.useRef(false);
  if (!ready.current) {
    ready.current = true;
    onReady(runtime.actionProviderProps.onParamCollection);
  }
  return <>{runtime.dialogs}</>;
}

/**
 * Drive `onParamCollection` the way `DeclaredActionsBar` does and read back the
 * state the dialog received. The promise stays pending — that is the real shape
 * too: nothing is POSTed until the dialog's own Confirm.
 */
async function collectParams(dispatch: Record<string, unknown>) {
  paramDialogState = null;
  let collect: any;
  render(<Harness onReady={(fn) => { collect = fn; }} />);
  await act(async () => {
    void collect(PARAMS, dispatch as any);
    await Promise.resolve();
  });
}

beforeEach(() => { paramDialogState = null; });

describe('useConsoleActionRuntime — the param dialog titles itself from `label` alone (objectui#4282)', () => {
  it('titles the dialog with the action label', async () => {
    await collectParams({
      name: 'approval_reject',
      label: 'Reject',
      objectName: 'sys_approval_request',
    });
    expect(paramDialogState).toBeTruthy();
    expect(paramDialogState.title).toBe('Reject');
  });

  it('does NOT fall back to a `title` key — no producer sets one, so nothing reads one', async () => {
    // The exact shape the removed limb served: an action with no `label` but
    // carrying `title`. Before objectui#4282 this dialog came up titled
    // "Should Not Win"; a key no schema declares and no renderer forwards must
    // not be the thing naming a dialog.
    await collectParams({
      name: 'approval_reject',
      title: 'Should Not Win',
      objectName: 'sys_approval_request',
    });
    expect(paramDialogState).toBeTruthy();
    expect(paramDialogState.title).toBeUndefined();
  });

  it('leaves `label` winning when both are present', async () => {
    // Green before AND after the removal (`||` short-circuits), so it pins no
    // change — it is here to keep the first test's failure legible: if this one
    // is green and the second is red, the limb is back.
    await collectParams({
      name: 'approval_reject',
      label: 'Reject',
      title: 'Should Not Win',
      objectName: 'sys_approval_request',
    });
    expect(paramDialogState.title).toBe('Reject');
  });

  it('titles from `label` independently of the description, which reads one key too', async () => {
    await collectParams({
      name: 'approval_reject',
      label: 'Reject',
      description: 'A rejection is final for every approver.',
      objectName: 'sys_approval_request',
    });
    expect(paramDialogState.title).toBe('Reject');
    expect(paramDialogState.description).toBe('A rejection is final for every approver.');
  });
});
