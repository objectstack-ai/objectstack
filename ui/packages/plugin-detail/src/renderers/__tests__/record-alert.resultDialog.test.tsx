/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5808 — `record:alert`'s CTA shares the exact chain objectui#5711
 * pinned for `record:quick_actions`, and nothing pinned it here.
 *
 * `record-alert.tsx` never touches `resultDialog` itself (by design — see its
 * own "CTA wiring" header): it resolves `action.actionName` out of the
 * object's metadata `actions[]` and dispatches through `useActionEngine`.
 * `resultDialog` is honoured centrally in
 * `packages/core/src/actions/ActionRunner.ts`'s `handlePostExecution`, which
 * computes
 *
 *     const hasResultDialog = !!(action.resultDialog && result.success);
 *
 * and then gates the success toast on `result.success && !hasResultDialog`.
 * Read that gate twice: suppression keys on the KEY BEING SET, not on a
 * handler existing. With no `resultDialogHandler` registered the action still
 * reports success, the toast still stays suppressed, and the only trace is a
 * `console.warn` — the silent-success shape both findings are about.
 *
 * `useActionEngine` reuses the surrounding `ActionProvider`'s `ActionRunner`
 * when one is mounted and falls back to a local, unwired one otherwise
 * (`packages/react/src/hooks/useActionEngine.ts`). So the load-bearing chain
 * is: ambient provider (the one `RecordDetailView` mounts around the whole
 * record page) -> `useActionEngine` -> shared runner -> handler. If a refactor
 * ever dropped that ambient provider, this banner's CTA would keep reporting
 * success and show the user nothing.
 *
 * Coverage before this file, re-derived on this branch's merge-base rather
 * than recalled: `grep -in "resultDialog|ActionProvider"` across the four
 * `record-alert*.test.tsx` suites returned exactly ONE hit, and it is a
 * COMMENT in `record-alert.test.tsx` noting the renderer "require[s] a live
 * provider tree" — no assertion in either direction.
 *
 * Structure mirrors the sibling pin
 * `record-quick-actions.resultDialog.test.tsx` (objectui#5711) — one
 * mechanism, one pin shape — with the two legs the fence names:
 *
 *   1. positive — provider mounted: the dialog opens with the response value
 *      and the success toast is suppressed.
 *   2. negative — NO provider (the fallback-to-local-runner shape): the value
 *      is discarded and the documented `console.warn` fires.
 *
 * plus the counter-probes without which neither leg is a measurement:
 *
 *   1b. an action WITHOUT `resultDialog`, same provider, DOES toast. Without
 *       this, "the toast is suppressed" is satisfiable by a harness in which
 *       no toast could ever appear.
 *   2b. an action WITHOUT `resultDialog`, no provider, does NOT produce the
 *       runner's resultDialog warning while STILL executing. Without this,
 *       leg 2's warn assertion is satisfiable by ambient noise.
 *       (On this leg a toast is not observable AT ALL — with no provider the
 *       fallback runner has no `toastHandler` installed, so the toast half of
 *       the counter-probe is unobservable here as a fact about running code,
 *       not as a gap in this file. Execution itself is the observable that
 *       replaces it.)
 *   3.  provider mounted WITHOUT an `onResultDialog` handler: the toast is
 *       suppressed anyway AND the warning fires — the `hasResultDialog` gate
 *       above, pinned directly. This is the full user-visible defect: success
 *       reported, nothing shown.
 *
 * Only the DATA layer is doubled (`useMetadataItem`, the CTA's metadata
 * fetch) — the same surgical strategy as `record-alert.test.tsx`
 * (objectui#3941). `useActionEngine`, `ActionProvider`, `ActionRunner` and
 * `RecordContextProvider` are all the REAL shipped ones; doubling any of them
 * would replace the mechanism under test with a second copy of it.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

const LABEL = 'Generate backup codes';
const PLAIN_LABEL = 'Resend verification email';
const WARN =
  '[ActionRunner] action.resultDialog set but no resultDialogHandler registered — the response value will not be shown to the user.';

// Mirrors objectstack#10681's `sys_user.generate_backup_codes`: a one-shot
// reveal declared via `resultDialog`. `type: 'script'` is a BUILT-IN executor
// (`ActionRunner.executeScript`), so the positive leg needs no custom executor
// registration to produce a real, non-empty `result.data` — the CEL string
// literal below is the whole "server response".
const REVEAL_ACTION = {
  name: 'generate_backup_codes',
  label: LABEL,
  type: 'script',
  target: '"BACKUP-CODE-0000"',
  successMessage: 'should-not-toast',
  resultDialog: {
    title: 'Save these backup codes',
    fields: [{ path: 'value', format: 'code-list' }],
  },
};

// The counter-probe's action: IDENTICAL surface minus `resultDialog`. It runs
// through the runner's `onClick` branch so that its execution is observable on
// BOTH legs — including the provider-less one, where no handler of any kind is
// installed and success is otherwise invisible from outside the tree.
const onClickSpy = vi.fn();
const PLAIN_ACTION = {
  name: 'resend_verification_email',
  label: PLAIN_LABEL,
  successMessage: 'Verification email sent.',
  onClick: onClickSpy,
};

const stub = { metadataItem: undefined as any };

// Surgical: ONLY the metadata fetch behind the CTA is doubled. Everything the
// card is about — `useActionEngine`, the ambient provider's shared
// `ActionRunner`, `handlePostExecution` — is the real shipped code.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useMetadataItem: (_type: string, _name: string | null) => ({ item: stub.metadataItem }),
  };
});

import { RecordAlertRenderer } from '../record-alert';
import { RecordContextProvider, ActionProvider } from '@object-ui/react';

/** Every `console.warn` call whose first argument is the runner's resultDialog diagnostic. */
function resultDialogWarnings(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter((call) => String(call[0]) === WARN);
}

function alertSchema(actionName: string, label: string) {
  return { properties: { title: 'Account security', action: { actionName, label } } };
}

function mount(actionName: string, label: string, wrap?: (node: React.ReactNode) => React.ReactNode) {
  const banner = <RecordAlertRenderer schema={alertSchema(actionName, label) as any} />;
  return render(
    <RecordContextProvider objectName="sys_user" recordId="u1" data={{ id: 'u1' }}>
      {wrap ? wrap(banner) : banner}
    </RecordContextProvider>,
  );
}

const clickCta = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));

beforeEach(() => {
  stub.metadataItem = { actions: [REVEAL_ACTION, PLAIN_ACTION] };
  onClickSpy.mockClear();
  cleanup();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('record:alert — the CTA honours resultDialog through the shared ActionRunner (objectui#5808)', () => {
  it('opens the result dialog with the response value and suppresses the success toast', async () => {
    const onResultDialog = vi.fn().mockResolvedValue(undefined);
    const onToast = vi.fn();

    mount('generate_backup_codes', LABEL, (banner) => (
      <ActionProvider onResultDialog={onResultDialog} onToast={onToast}>
        {banner}
      </ActionProvider>
    ));

    clickCta(LABEL);

    await waitFor(() => expect(onResultDialog).toHaveBeenCalledOnce());
    const [spec, data] = onResultDialog.mock.calls[0];
    expect(spec.title).toBe('Save these backup codes');
    expect(data).toBe('BACKUP-CODE-0000');
    // resultDialog SUPPRESSES the success toast (ActionRunner.handlePostExecution)
    // — a one-shot reveal must not let the user dismiss it via the toast.
    expect(onToast).not.toHaveBeenCalled();
  });

  it('COUNTER-PROBE: without resultDialog the same provider DOES toast — so "suppressed" above is a measurement, not an empty harness', async () => {
    const onResultDialog = vi.fn().mockResolvedValue(undefined);
    const onToast = vi.fn();

    mount('resend_verification_email', PLAIN_LABEL, (banner) => (
      <ActionProvider onResultDialog={onResultDialog} onToast={onToast}>
        {banner}
      </ActionProvider>
    ));

    clickCta(PLAIN_LABEL);

    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(onToast.mock.calls[0][0]).toBe('Verification email sent.');
    expect(onClickSpy).toHaveBeenCalledOnce();
    expect(onResultDialog).not.toHaveBeenCalled();
  });

  it('with no ActionProvider, discards the value silently and warns — the defect class a fallback-to-local-runner would reintroduce', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Deliberately NO ActionProvider here: useActionEngine falls back to a
    // local, unwired ActionRunner (packages/react/src/hooks/useActionEngine.ts).
    // This is the shape the finding warns about — if a refactor ever dropped
    // the ambient provider around a record page, this is what a user would
    // experience: the CTA reports success and nothing is shown.
    mount('generate_backup_codes', LABEL);

    clickCta(LABEL);

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        WARN,
        expect.objectContaining({ action: 'generate_backup_codes', data: 'BACKUP-CODE-0000' }),
      ),
    );

    warn.mockRestore();
  });

  it('COUNTER-PROBE: without resultDialog the provider-less leg still executes and does NOT warn — so the warning above is not ambient noise', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mount('resend_verification_email', PLAIN_LABEL);

    clickCta(PLAIN_LABEL);

    await waitFor(() => expect(onClickSpy).toHaveBeenCalledOnce());
    expect(resultDialogWarnings(warn)).toHaveLength(0);

    warn.mockRestore();
  });

  it('suppression keys on resultDialog BEING SET, not on a handler existing: a provider with a toast handler and no onResultDialog shows the user nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onToast = vi.fn();

    mount('generate_backup_codes', LABEL, (banner) => (
      <ActionProvider onToast={onToast}>{banner}</ActionProvider>
    ));

    clickCta(LABEL);

    await waitFor(() => expect(resultDialogWarnings(warn)).toHaveLength(1));
    // The action reported success, the toast was suppressed anyway, and the
    // value was discarded — success reported, nothing shown.
    expect(onToast).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});
