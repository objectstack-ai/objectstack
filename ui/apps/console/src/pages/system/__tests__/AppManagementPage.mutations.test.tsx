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

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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
  useAdapter: () => ({
    getClient: () => ({ meta: { saveItem, deleteItem } }),
    // objectstack#35054 — a save starts from the stored app (the layers read):
    // the listed row minus its read decorations, which no layer carries.
    getAuthoredItem: async (_type: string, name: string) => {
      const row = apps.value.find((a: any) => a.name === name);
      return row ? Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_'))) : null;
    },
  }),
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

/**
 * objectstack#34860 — a refused set-default leaves the default where it was.
 *
 * The outgoing default lives in a writable package; the target lives in a
 * read-only one, whose promote the server refuses with 403. Demote-first means
 * the demotion has already landed by then, so the page must put it back, in the
 * same package scope, or the deployment is left with no default app.
 */
describe('Set as default — a refused promote restores the previous default (objectstack#34860)', () => {
  const MTHREE = {
    name: 'mthree_app',
    label: 'MThree',
    isDefault: true,
    _packageId: 'com.objectstack.qa.mthree',
  };
  const SHOWCASE = { name: 'showcase_app', label: 'Showcase', _packageId: 'com.example.showcase' };
  const READ_ONLY =
    "Cannot overlay 'app' in package 'com.example.showcase': that package is read-only";
  /** A refusal the server answered, in the shape the client throws: the status on `httpStatus`. */
  const refused = (message: string, httpStatus = 403) => Object.assign(new Error(message), { httpStatus });

  /** Every write the page sent, with the package scope it named (the 4th argument). */
  const writes = () =>
    (saveItem.mock.calls as unknown[][]).map(([, name, body, options]) => [
      name,
      (body as { isDefault?: boolean }).isDefault,
      (options as { packageId?: string } | undefined)?.packageId,
    ]);

  /** The `isDefault` each app holds after the writes that LANDED, over the listed state. */
  const landedDefaults = async () => {
    const state: Record<string, boolean> = Object.fromEntries(
      apps.value.map((a: any) => [a.name, a.isDefault === true]),
    );
    for (const [i, call] of (saveItem.mock.calls as unknown[][]).entries()) {
      const outcome = saveItem.mock.results[i];
      // A rejected write is a settled promise that throws; only fulfilled ones landed.
      const landed = await Promise.resolve(outcome?.value).then(() => true, () => false);
      if (landed) state[call[1] as string] = (call[2] as { isDefault?: boolean }).isDefault === true;
    }
    return Object.keys(state).filter((name) => state[name]);
  };

  beforeEach(() => {
    apps.value = [MTHREE, SHOWCASE];
  });

  // `clearAllMocks` keeps an implementation, so the refusals below are undone
  // here rather than leaking into the describes that follow.
  afterEach(() => {
    saveItem.mockImplementation(async () => ({}));
  });

  it('re-promotes the demoted default in its own package, and the final writes leave the same default', async () => {
    saveItem.mockImplementation(async (_type, name, item) => {
      if (name === 'showcase_app' && item.isDefault === true) throw refused(READ_ONLY);
      return {};
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Showcase as default'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(writes()).toEqual([
      ['mthree_app', false, 'com.objectstack.qa.mthree'],
      ['showcase_app', true, 'com.example.showcase'],
      ['mthree_app', true, 'com.objectstack.qa.mthree'],
    ]);
    expect(await landedDefaults()).toEqual(['mthree_app']);
    // The original refusal is what the operator is told, in the server's words.
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain(READ_ONLY);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('⛔ says so when the restore is refused too — the lost default is never hidden', async () => {
    saveItem.mockImplementation(async (_type, name, item) => {
      if (name === 'showcase_app' && item.isDefault === true) throw refused(READ_ONLY);
      if (name === 'mthree_app' && item.isDefault === true) throw refused('restore refused');
      return {};
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Showcase as default'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(writes()).toEqual([
      ['mthree_app', false, 'com.objectstack.qa.mthree'],
      ['showcase_app', true, 'com.example.showcase'],
      ['mthree_app', true, 'com.objectstack.qa.mthree'],
    ]);
    expect(await landedDefaults()).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError.mock.calls[0][0]).toContain(READ_ONLY);
    // The second error names the app that is no longer the default, and why.
    expect(toastError.mock.calls[1][0]).toContain('MThree');
    expect(toastError.mock.calls[1][0]).toContain('restore refused');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('a refused demotion writes nothing more — there is nothing to restore', async () => {
    saveItem.mockImplementation(async (_type, name) => {
      if (name === 'mthree_app') throw refused('forbidden');
      return {};
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Showcase as default'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(writes()).toEqual([['mthree_app', false, 'com.objectstack.qa.mthree']]);
    expect(await landedDefaults()).toEqual(['mthree_app']);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  // A failure the server did not answer, or a 5xx, may have been written: the
  // promote may have landed, so a restore could leave TWO defaults. Nothing is
  // undone; the re-read shows what the server holds.
  it.each([
    ['no answer (no httpStatus)', () => new TypeError('Failed to fetch')],
    ['a 5xx', () => refused('upstream timeout', 504)],
  ])('⛔ a promote failure with %s sends no restore write', async (_label, failure) => {
    saveItem.mockImplementation(async (_type, name, item) => {
      if (name === 'showcase_app' && item.isDefault === true) throw failure();
      return {};
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Showcase as default'));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(writes()).toEqual([
      ['mthree_app', false, 'com.objectstack.qa.mthree'],
      ['showcase_app', true, 'com.example.showcase'],
    ]);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('CONTROL: an accepted promote keeps the order demote → promote, with no restore write', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('Set Showcase as default'));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(writes()).toEqual([
      ['mthree_app', false, 'com.objectstack.qa.mthree'],
      ['showcase_app', true, 'com.example.showcase'],
    ]);
    expect(await landedDefaults()).toEqual(['showcase_app']);
    expect(toastError).not.toHaveBeenCalled();
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
