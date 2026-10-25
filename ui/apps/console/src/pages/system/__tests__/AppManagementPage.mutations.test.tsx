// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4233 half B — the Applications page writes, or says it did not.
 *
 * QA confirmed all three mutating controls (Set as default, Disable, Delete)
 * showed a success toast with **zero non-GET requests on the wire** and no
 * server change after reload. Each handler carried
 * `// TODO: Replace with real API call when backend supports app management`
 * immediately before its `toast.success(...)`, then called `refresh()` — which
 * re-rendered the unchanged server state underneath the confirmation, and is
 * why the stub read as a working feature rather than as a no-op.
 *
 * The TODO's premise was measured against `@objectstack/client` 17.0.0-rc.6 and
 * is false: `meta.saveItem` (`PUT /api/v1/meta/:type/:name`) and
 * `meta.deleteItem` (`DELETE /api/v1/meta/:type/:name`) both exist and are
 * already how `useNavigationSync` persists app schemas. So these pins assert
 * the WIRED outcome — a real mutation issued, with the right type, name and
 * body — rather than the disabled-control outcome the card's other branch
 * called for.
 *
 * ## What each assertion is guarding
 *
 * A toast is not evidence, so no test here asserts only that one appeared. The
 * load-bearing assertions are (1) the client call, argument by argument, and
 * (2) that on a REJECTED call no success toast is emitted — because the defect
 * was never "no toast", it was "a success toast uncorrelated with a write".
 * `toThrow`-style coverage would miss both halves of that.
 *
 * ## Reverse verification
 *
 * Restoring any handler's stub body (drop the `await meta.…`, keep the
 * `toast.success`) turns that control's `issues a real …` case red on the
 * missing client call, and ALSO turns its error-path case red — the stub cannot
 * fail, so it reports success where the server refused. Both directions, which
 * is the pair the stub was able to satisfy before.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { saveItem, deleteItem, refresh, toastSuccess, toastError, apps } = vi.hoisted(() => ({
  // Typed with the real client signatures, so the argument-by-argument
  // assertions below are checked rather than indexed into an untyped tuple.
  saveItem: vi.fn<(type: string, name: string, item: any) => Promise<unknown>>(async () => ({})),
  deleteItem: vi.fn<(type: string, name: string) => Promise<unknown>>(async () => ({})),
  refresh: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  apps: {
    value: [] as any[],
  },
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

/**
 * The page's chrome is keyed as of objectui#4307, so every label and toast
 * below now arrives through `t`. This stands in for the pack the console
 * convention's way (`useConsoleActionRuntime.test.tsx`,
 * `sharedInboxFeed.twoSurfaces.test.tsx`): echo the call site's own
 * `defaultValue` and fill its `{{holes}}` from the arguments.
 *
 * That choice is what keeps this file's assertions UNCHANGED across the i18n
 * conversion — they still read `'Set Ops as default'` and `'2 apps disabled'`,
 * because those are still the sentences an English console renders. What these
 * cases pin is the WRITE, not the wording, and re-spelling them as key names
 * would have quietly moved them off that subject. The keying itself is pinned
 * next door, in `AppManagementPage.i18n.test.tsx`.
 */
// Partial, via `importOriginal`: `@object-ui/components` builds its own
// `createSafeTranslation` probes at module scope, so replacing the whole module
// breaks the dialog graph on re-import (the `no adapter` case below resets the
// registry and re-imports the page).
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
  }),
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: apps.value, refresh }),
  useAdapter: () => ({ getClient: () => ({ meta: { saveItem, deleteItem } }) }),
}));

const { AppManagementPage } = await import('../AppManagementPage');

const CRM = { name: 'crm_app', label: 'CRM', isDefault: true, navigation: [{ id: 'nav_1' }] };
const OPS = { name: 'ops_app', label: 'Ops', active: true };

function renderPage() {
  return render(
    <MemoryRouter>
      <AppManagementPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apps.value = [CRM, OPS];
});

describe('Set as default — issues a real mutation', () => {
  it('PUTs `isDefault: true` on the target app', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Ops as default'));

    await waitFor(() => expect(saveItem).toHaveBeenCalled());
    expect(saveItem).toHaveBeenCalledWith(
      'app',
      'ops_app',
      expect.objectContaining({ name: 'ops_app', isDefault: true }),
    );
  });

  it('demotes the outgoing default first, so the landing cannot depend on list order', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Ops as default'));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));
    // `resolveLandingPath` takes the FIRST `isDefault` match, so two holders is
    // not a cosmetic inconsistency — it is a landing that changes with the
    // order the server lists apps in.
    expect(saveItem.mock.calls[0]).toEqual([
      'app',
      'crm_app',
      expect.objectContaining({ isDefault: false }),
    ]);
    expect(saveItem.mock.calls[1]).toEqual([
      'app',
      'ops_app',
      expect.objectContaining({ isDefault: true }),
    ]);
  });

  it('preserves the fields the console does not model — the whole record round-trips', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Ops as default'));

    await waitFor(() => expect(saveItem).toHaveBeenCalled());
    const [, , body] = saveItem.mock.calls.find((c: any[]) => c[1] === 'ops_app')!;
    expect(body).toMatchObject({ name: 'ops_app', label: 'Ops', active: true, isDefault: true });
  });

  it('⛔ reports FAILURE when the server refuses — no success toast off a rejected write', async () => {
    // The permission gate is real: `PUT /meta/:type/:name` is gated on
    // `manage_metadata` (ADR-0066 D1), so 403 is an ordinary outcome for an
    // operator who can READ this page. Reporting success for it is the bug.
    saveItem.mockRejectedValueOnce(new Error('forbidden: manage_metadata required'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Ops as default'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError.mock.calls[0][0]).toContain('manage_metadata');
  });
});

describe('Disable / Enable — issues a real mutation', () => {
  it('PUTs `active: false` when disabling an active app', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Disable Ops'));

    await waitFor(() => expect(saveItem).toHaveBeenCalled());
    expect(saveItem).toHaveBeenCalledWith(
      'app',
      'ops_app',
      expect.objectContaining({ active: false }),
    );
  });

  it('PUTs `active: true` when re-enabling a disabled app', async () => {
    apps.value = [{ ...OPS, active: false }];
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Enable Ops'));

    await waitFor(() => expect(saveItem).toHaveBeenCalled());
    expect(saveItem).toHaveBeenCalledWith(
      'app',
      'ops_app',
      expect.objectContaining({ active: true }),
    );
  });

  it('⛔ reports FAILURE when the server refuses', async () => {
    saveItem.mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Disable Ops'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('Delete — issues a real mutation', () => {
  it('DELETEs the app, and only after the confirm click', async () => {
    const user = userEvent.setup();
    renderPage();

    // First click ARMS the control (`confirmDelete`), it must not write.
    await user.click(screen.getByLabelText('Delete Ops'));
    expect(deleteItem).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Confirm delete Ops'));
    await waitFor(() => expect(deleteItem).toHaveBeenCalledWith('app', 'ops_app'));
  });

  it('⛔ reports FAILURE when the server refuses', async () => {
    deleteItem.mockRejectedValueOnce(new Error('in use'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Delete Ops'));
    await user.click(screen.getByLabelText('Confirm delete Ops'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('Bulk toggle — issues one real mutation per selected app', () => {
  it('writes every selection and reports the count that actually landed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Select CRM'));
    await user.click(screen.getByLabelText('Select Ops'));
    await user.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(2));
    expect(saveItem).toHaveBeenCalledWith('app', 'crm_app', expect.objectContaining({ active: false }));
    expect(saveItem).toHaveBeenCalledWith('app', 'ops_app', expect.objectContaining({ active: false }));
    expect(toastSuccess).toHaveBeenCalledWith('2 apps disabled');
  });

  it('⛔ counts only the writes that SUCCEEDED — a partial failure is not "2 apps disabled"', async () => {
    // No transaction spans these writes, so a mixed outcome is the normal one
    // under a permission gate. Announcing the selection size instead of the
    // landed count would be the same lie in a form that is harder to spot.
    saveItem.mockRejectedValueOnce(new Error('forbidden'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Select CRM'));
    await user.click(screen.getByLabelText('Select Ops'));
    await user.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('1 apps disabled');
    expect(toastError.mock.calls[0][0]).toContain('Failed for 1');
  });
});

describe('no adapter — the control refuses instead of pretending', () => {
  it('⛔ never reports success when there is no metadata client to write through', async () => {
    vi.resetModules();
    vi.doMock('@object-ui/app-shell', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      useMetadata: () => ({ apps: apps.value, refresh }),
      useAdapter: () => null,
    }));
    const { AppManagementPage: Unwired } = await import('../AppManagementPage');

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Unwired />
      </MemoryRouter>,
    );

    await user.click(screen.getByLabelText('Set Ops as default'));

    expect(saveItem).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();

    vi.doUnmock('@object-ui/app-shell');
    vi.resetModules();
  });
});
