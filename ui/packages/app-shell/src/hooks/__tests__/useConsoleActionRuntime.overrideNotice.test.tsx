/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The admin-override notice reaches the ONE dialog these actions open, and a
 * translation bundle cannot delete it (objectui#5178).
 *
 * ## Why this is a separate key and not a rewritten `description`
 *
 * The obvious implementation — fold the override warning into the dispatch's
 * `description` — is measurably wrong here, and the measurement is the reason
 * this file exists. `paramCollectionHandler` resolves the description through
 * `actionDescription(objectName, action.name, action.description)`, which
 * PREFERS a `_actions.<name>.description` bundle hit over the passed literal.
 * And `plugin-approvals` SHIPS exactly such an entry:
 *
 *   `_actions.approval_reject.description`
 *     = "Reject this request? A rejection is final for every approver."
 *
 * in en / zh-CN / ja-JP / es-ES. So a warning routed through `description`
 * would have been silently replaced by the ordinary reject copy in every
 * locale carrying the bundle — the safety wording deleted by a translation, on
 * the one privileged path it exists to guard, with nothing red to show for it.
 *
 * The second test below is that hazard, reproduced: the bundle resolver returns
 * its own text, and the notice must still be there.
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

/**
 * Stands in for the locale bundle. `bundleDescription` is what
 * `_actions.<name>.description` resolves to; `null` means "no bundle entry"
 * (the resolver's fallback contract: the passed literal wins).
 */
let bundleDescription: string | null = null;

// Partial mock: `@object-ui/components` reaches for `createSafeTranslation` at
// import time (`lib/close-label.tsx` → `ui/dialog.tsx`), so a total double
// breaks the module graph before a single test runs.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/i18n')>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => bundleDescription ?? fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) =>
      String(options?.defaultValue ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_m: string, name: string) => String(options?.[name] ?? ''),
      ),
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

/**
 * Capture the state the param dialog is handed. The sibling runtime suite stubs
 * this as an inert `() => null`; here the state IS the assertion subject.
 */
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

const OVERRIDE_NOTICE =
  'You hold no approver slot on this step. Continuing uses your admin override: it finalises the '
  + 'step immediately and bypasses the approvers who have not acted — Qian Hua, Li Lei. The decision '
  + 'is recorded as an admin override.';

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
 * state the dialog received. The promise stays pending (nothing resolves it) —
 * that is the real shape too: nothing is POSTed until the dialog's own Confirm.
 */
async function collectParams(dispatch: Record<string, unknown>, interpolate?: (text: string) => string) {
  paramDialogState = null;
  let collect: any;
  render(<Harness onReady={(fn) => { collect = fn; }} />);
  await act(async () => {
    void collect(PARAMS, dispatch as any, interpolate);
    await Promise.resolve();
  });
}

beforeEach(() => {
  bundleDescription = null;
  paramDialogState = null;
});

describe('useConsoleActionRuntime — the override notice in the param dialog (objectui#5178)', () => {
  it('puts the notice ahead of the declared description', async () => {
    await collectParams({
      name: 'approval_reject',
      label: 'Override Reject',
      objectName: 'sys_approval_request',
      description: 'Reject this request? A rejection is final for every approver.',
      overrideNotice: OVERRIDE_NOTICE,
    });

    expect(paramDialogState).toBeTruthy();
    const description = String(paramDialogState.description);
    expect(description).toContain('Qian Hua');
    expect(description).toContain('recorded as an admin override');
    // The declared description is kept, not replaced — it still says what the
    // decision itself means. The warning simply comes first.
    expect(description).toContain('A rejection is final for every approver.');
    expect(description.indexOf(OVERRIDE_NOTICE)).toBeLessThan(
      description.indexOf('A rejection is final'),
    );
    // The override framing also reaches the dialog title.
    expect(paramDialogState.title).toBe('Override Reject');
  });

  it('survives a translation bundle that owns `_actions.<name>.description`', async () => {
    // The shipped hazard: `plugin-approvals` defines this key for
    // `approval_reject`. Folding the warning into `description` would let this
    // value replace it outright.
    bundleDescription = 'Bitte bestätigen Sie die Ablehnung dieser Anfrage.';
    await collectParams({
      name: 'approval_reject',
      label: 'Override Reject',
      objectName: 'sys_approval_request',
      description: 'Reject this request? A rejection is final for every approver.',
      overrideNotice: OVERRIDE_NOTICE,
    });

    const description = String(paramDialogState.description);
    // The bundle still wins for the DECLARED half — translation works.
    expect(description).toContain('Bitte bestätigen Sie');
    expect(description).not.toContain('A rejection is final for every approver.');
    // …and the safety notice is still there. This is the whole point.
    expect(description).toContain('Qian Hua');
    expect(description).toContain('recorded as an admin override');
  });

  it('stands alone when the action declares no description', async () => {
    // `approval_approve` declares none, so the notice is the entire body.
    await collectParams({
      name: 'approval_approve',
      label: 'Override Approve',
      objectName: 'sys_approval_request',
      overrideNotice: OVERRIDE_NOTICE,
    });
    expect(String(paramDialogState.description)).toBe(OVERRIDE_NOTICE);
  });

  it('leaves an ordinary action exactly as it was', async () => {
    // No `overrideNotice` on the dispatch → the description resolution is
    // byte-for-byte the pre-objectui#5178 behaviour, bundle preference included.
    bundleDescription = 'Bundle copy.';
    await collectParams({
      name: 'approval_reject',
      label: 'Reject',
      objectName: 'sys_approval_request',
      description: 'Reject this request? A rejection is final for every approver.',
    });
    expect(paramDialogState.description).toBe('Bundle copy.');
    expect(paramDialogState.title).toBe('Reject');
  });

  it('ignores a non-string / empty notice rather than rendering a blank lead', async () => {
    await collectParams({
      name: 'approval_approve',
      label: 'Approve',
      objectName: 'sys_approval_request',
      description: 'Declared copy.',
      overrideNotice: '',
    });
    expect(paramDialogState.description).toBe('Declared copy.');
  });
});

describe('useConsoleActionRuntime — the param dialog fills the runner\'s template holes (objectui#12967)', () => {
  /** Stands in for the runner's evaluator over this dispatch's `record` (a list row). */
  const interpolate = (text: string) => text.replace(/\$\{record\.display_name\}/g, 'Acme');

  it('fills a record hole in the localized description and hands `interpolate` to the dialog for `helpText`', async () => {
    bundleDescription = 'Pausing ${record.display_name} (translated)';
    await collectParams({ name: 'pause', label: 'Pause', description: 'Pausing ${record.display_name}' }, interpolate);
    // Filled on the text the user reads — the bundle's, not the literal.
    expect(paramDialogState.description).toBe('Pausing Acme (translated)');
    expect(paramDialogState.interpolate).toBe(interpolate);
  });

  it('never reads the override notice as a template: approver names are data', async () => {
    const notice = 'Bypasses ${record.display_name} — an approver name, not a hole.';
    await collectParams({
      name: 'approval_reject',
      label: 'Override Reject',
      description: 'Rejecting ${record.display_name}',
      overrideNotice: notice,
    }, interpolate);
    expect(paramDialogState.description).toBe(`${notice}\n\nRejecting Acme`);
  });
});
