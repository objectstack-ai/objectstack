/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5711 — a `record:quick_actions` action's `resultDialog` was
 * reachable only INDIRECTLY, and nothing pinned the full chain.
 *
 * `RecordQuickActionsRenderer` never touches `resultDialog` itself (by
 * design — see its own header comment): it resolves actions through
 * `useActionEngine` and calls `executeAction`, and `resultDialog` is honoured
 * centrally in `packages/core/src/actions/ActionRunner.ts`'s
 * `handlePostExecution` — on success it suppresses the `successMessage` toast
 * and awaits the registered `ResultDialogHandler`; with none registered it
 * `console.warn`s and discards the value while STILL reporting success.
 *
 * `useActionEngine` reuses the surrounding `<ActionProvider>`'s `ActionRunner`
 * when one is mounted, and falls back to a local, unwired one otherwise
 * (`packages/react/src/hooks/useActionEngine.ts`).
 *
 * Existing coverage stopped one link short of this chain (all confirmed by
 * reading, not recalled):
 *   - `ActionRunner.resultDialog.test.ts` pins the runner IN ISOLATION, with
 *     the handler registered directly on it — no React tree, no
 *     `useActionEngine`, no `<ActionProvider>`.
 *   - `useActionEngine.sharedRunner.test.tsx` pins that the hook REUSES the
 *     provider's runner (instance identity + `ctx` merge) but never
 *     registers or asserts on `resultDialog`.
 *   - `packages/plugin-detail/src` has ZERO `resultDialog` references (grep,
 *     objectui#5711) — correct by design, but it also means no test in this
 *     package exercises the key at all.
 *   - `MetadataTypeActions.test.tsx` ("shows the result dialog when the
 *     action declares resultDialog") pins the same OUTCOME on a DIFFERENT
 *     bar — `MetadataTypeActions`, which (like `DeclaredActionsBar`) mounts
 *     its OWN internal `<ActionProvider>` rather than sharing an ambient
 *     one. It does not exercise the shared-runner path this renderer relies
 *     on.
 *
 * So nothing pinned that a handler registered on an AMBIENT `<ActionProvider>`
 * (the one `RecordDetailView` mounts around the whole record page) is
 * actually reachable from a `record:quick_actions` bar mounted as a CHILD of
 * it — the exact shape objectstack#10681 depends on (a one-shot
 * `resultDialog` on `sys_user.generate_backup_codes`, rendered at
 * `record:quick_actions { location: 'record_section' }`).
 *
 * This suite closes that gap with two legs:
 *   1. positive — with the provider's handler registered, running the action
 *      opens the dialog with the response value and suppresses the success
 *      toast.
 *   2. negative — with NO provider (the fallback-to-local-runner shape), the
 *      response is silently discarded and the documented `console.warn`
 *      fires. This is the defect class the finding is about: a refactor that
 *      accidentally drops the ambient provider would keep every affected
 *      action reporting success while showing the user nothing.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordContextProvider, ActionProvider } from '@object-ui/react';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

const LOCATION = 'record_section';
const LABEL = 'Generate backup codes';

// Mirrors objectstack#10681's `sys_user.generate_backup_codes` shape: a
// one-shot reveal declared via `resultDialog`, at `record:quick_actions`
// `location: 'record_section'`. `type: 'script'` is a BUILT-IN executor
// (`ActionRunner.executeScript`) so the positive leg needs no custom handler
// registration to produce a real, non-empty `result.data` — the CEL string
// literal below is the whole "server response".
const ACTION = {
  name: 'generate_backup_codes',
  label: LABEL,
  type: 'script',
  target: '"BACKUP-CODE-0000"',
  successMessage: 'should-not-toast',
  locations: [LOCATION],
  resultDialog: {
    title: 'Save these backup codes',
    fields: [{ path: 'value', format: 'code-list' }],
  },
};

function mount(children: React.ReactNode) {
  return render(
    <RecordContextProvider objectName="sys_user" recordId="u1" data={{ id: 'u1' }}>
      {children}
    </RecordContextProvider>,
  );
}

const clickAction = () => fireEvent.click(screen.getByRole('button', { name: LABEL }));

describe('record:quick_actions — resultDialog reaches the shared runner (objectui#5711)', () => {
  it('opens the result dialog with the response value and suppresses the success toast', async () => {
    const onResultDialog = vi.fn().mockResolvedValue(undefined);
    const onToast = vi.fn();

    mount(
      <ActionProvider onResultDialog={onResultDialog} onToast={onToast}>
        <RecordQuickActionsRenderer schema={{ actions: [ACTION], location: LOCATION } as any} />
      </ActionProvider>,
    );

    clickAction();

    await waitFor(() => expect(onResultDialog).toHaveBeenCalledOnce());
    const [spec, data] = onResultDialog.mock.calls[0];
    expect(spec.title).toBe('Save these backup codes');
    expect(data).toBe('BACKUP-CODE-0000');
    // resultDialog SUPPRESSES the success toast (ActionRunner.handlePostExecution)
    // — a one-shot reveal must not let the user dismiss it via the toast.
    expect(onToast).not.toHaveBeenCalled();
  });

  it('with no ActionProvider, discards the value silently and warns — the defect class a fallback-to-local-runner would reintroduce', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Deliberately NO <ActionProvider> here: useActionEngine falls back to a
    // local, unwired ActionRunner (packages/react/src/hooks/useActionEngine.ts).
    // This is the shape the finding warns about — if a refactor ever dropped
    // the ambient provider around a quick-actions bar, this is what a user
    // would experience: the action reports success and nothing is shown.
    mount(<RecordQuickActionsRenderer schema={{ actions: [ACTION], location: LOCATION } as any} />);

    clickAction();

    await waitFor(() => expect(warn).toHaveBeenCalledWith(
      '[ActionRunner] action.resultDialog set but no resultDialogHandler registered — the response value will not be shown to the user.',
      expect.objectContaining({ action: 'generate_backup_codes', data: 'BACKUP-CODE-0000' }),
    ));

    warn.mockRestore();
  });
});
