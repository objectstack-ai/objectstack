// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4307 — the Applications page's chrome is keyed, and the server's
 * words are not.
 *
 * The page was raw English end to end while #4233 / PR #4300 wired its four
 * mutations, deliberately: the writes and the localization were kept as
 * separable cards. This file pins the second half.
 *
 * ## Why `t` answers in no natural language here
 *
 * The sister file (`AppManagementPage.mutations.test.tsx`) mocks `t` to echo the
 * call site's `defaultValue`, which is right for what it asserts — the English
 * console still renders English, so its write assertions keep reading naturally.
 * But that same mock makes THIS file's question unanswerable: a page that never
 * called `t` at all would render the identical English and pass every one of
 * those cases. A hardcoded literal and a correctly keyed lookup are
 * indistinguishable the moment the pack agrees with the source.
 *
 * So `t` here returns a sentinel built from the key and the arguments —
 * `«appManagement.title»`, `«appManagement.selectApp»[name=Ops]` — which is what
 * a NON-English pack does to this page in the only respect that matters: the
 * English disappears. Every assertion below is therefore two-sided. It names the
 * key that must be asked for, and (via `RETIRED_LITERALS`) it re-checks that the
 * English sentence the page used to hardcode is nowhere on screen.
 *
 * ## Reverse verification
 *
 * Putting any one literal back — `<h1>Applications</h1>` for
 * `t('appManagement.title', …)` — turns BOTH sides red at once: the key's
 * sentinel is missing, and 'Applications' is on screen again. Restoring
 * `${app.label || app.name}` in place of `appTitle(app)` turns the keyed-label
 * case red with the exact string it produced before this card: `[object
 * Object]`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { saveItem, deleteItem, refresh, toastSuccess, toastError, toastInfo, apps } = vi.hoisted(() => ({
  saveItem: vi.fn<(type: string, name: string, item: any) => Promise<unknown>>(async () => ({})),
  deleteItem: vi.fn<(type: string, name: string) => Promise<unknown>>(async () => ({})),
  refresh: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  apps: { value: [] as any[] },
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: apps.value, refresh }),
  useAdapter: () => ({ getClient: () => ({ meta: { saveItem, deleteItem } }) }),
}));

/**
 * A pack that speaks only in keys. `defaultValue` is dropped on purpose — it is
 * the call site's own English, and honouring it here would hand the test back
 * the very sentence it is trying to prove the page no longer hardcodes.
 */
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  // Partial, so `@object-ui/components`' module-scope `createSafeTranslation`
  // probes keep working — only the page's own translator is replaced.
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const args = Object.entries(options ?? {})
        .filter(([name]) => name !== 'defaultValue')
        .map(([name, value]) => `${name}=${String(value)}`)
        .join('|');
      return args ? `«${key}»[${args}]` : `«${key}»`;
    },
  }),
}));

const { AppManagementPage } = await import('../AppManagementPage');

const CRM = { name: 'crm_app', label: 'CRM', isDefault: true, active: true };
const OPS = { name: 'ops_app', label: 'Ops', active: true };

/**
 * The English this page hardcoded before it was keyed. None of it may survive a
 * pack that answers in another language — this is the half of each assertion
 * that a merely-added `t()` call cannot satisfy on its own.
 */
const RETIRED_LITERALS = [
  'Applications',
  'Manage all configured applications',
  'New App',
  'Search apps',
  'Select all (2)',
  'No apps found.',
  'Default',
  'Active',
  'Inactive',
];

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

describe('page chrome resolves through the console i18n path', () => {
  it('asks for `appManagement.*` for every heading, control and badge', () => {
    renderPage();

    // Headings and the create control.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('«appManagement.title»');
    expect(screen.getByText('«appManagement.subtitle»')).toBeInTheDocument();
    expect(screen.getByTestId('create-app-btn')).toHaveTextContent('«appManagement.newApp»');

    // Search: the sr-only label AND the placeholder, which are two strings.
    expect(screen.getByLabelText('«appManagement.searchLabel»')).toBeInTheDocument();
    expect(screen.getByTestId('app-search-input')).toHaveAttribute(
      'placeholder',
      '«appManagement.searchPlaceholder»',
    );

    // Select-all carries its count as an interpolation argument, not as text
    // spliced around the sentence.
    expect(screen.getByText('«appManagement.selectAll»[n=2]')).toBeInTheDocument();

    // Row badges.
    expect(screen.getByText('«appManagement.defaultBadge»')).toBeInTheDocument();
    expect(screen.getAllByText('«appManagement.active»')).toHaveLength(2);
  });

  it('names each row control by key, with the app as an argument', () => {
    renderPage();

    expect(screen.getByLabelText('«appManagement.selectApp»[name=Ops]')).toBeInTheDocument();
    expect(screen.getByLabelText('«appManagement.openAppNamed»[name=Ops]')).toBeInTheDocument();
    expect(screen.getByLabelText('«appManagement.editAppNamed»[name=Ops]')).toBeInTheDocument();
    expect(screen.getByLabelText('«appManagement.disableAppNamed»[name=Ops]')).toBeInTheDocument();
    expect(screen.getByLabelText('«appManagement.setDefaultNamed»[name=Ops]')).toBeInTheDocument();
    expect(screen.getByLabelText('«appManagement.deleteAppNamed»[name=Ops]')).toBeInTheDocument();

    // The tooltip is a SECOND string per control — it names the action without
    // the target, and it was hardcoded separately before this card.
    // Two rows, so each action's tooltip appears twice — both apps are active,
    // so both toggles read `disableApp` rather than one of each.
    expect(screen.getAllByTitle('«appManagement.openApp»')).toHaveLength(2);
    expect(screen.getAllByTitle('«appManagement.disableApp»')).toHaveLength(2);
    expect(screen.getAllByTitle('«appManagement.setDefault»')).toHaveLength(2);
  });

  it('renders the empty state and the bulk bar through the pack too', async () => {
    apps.value = [];
    const { unmount } = renderPage();
    expect(screen.getByText('«appManagement.empty»')).toBeInTheDocument();
    unmount();

    apps.value = [CRM, OPS];
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByLabelText('«appManagement.selectApp»[name=Ops]'));

    expect(screen.getByText('«appManagement.selectedCount»[n=1]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '«appManagement.bulkEnable»' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '«appManagement.bulkDisable»' })).toBeInTheDocument();
  });

  it('⛔ leaves NO hardcoded English on screen once the pack answers otherwise', async () => {
    renderPage();

    // Swept BEFORE any interaction, deliberately: every assertion here is a
    // `query…` that stands on its own, so this case reports the English it
    // found rather than dying on a sentinel query used as a precondition.
    for (const literal of RETIRED_LITERALS) {
      expect(screen.queryByText(literal)).toBeNull();
    }
    // The aria-labels the mutation suite drives the page by.
    expect(screen.queryByLabelText('Set Ops as default')).toBeNull();
    expect(screen.queryByLabelText('Delete Ops')).toBeNull();

    // The two bulk buttons exist only once something is selected. `Enable` and
    // `Disable` are also substrings of other labels, so they are judged as
    // whole accessible names rather than as text nodes.
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('«appManagement.selectApp»[name=Ops]'));
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
  });

  it('resolves a KEYED app label through the same `t`, rather than stringifying it', () => {
    // rc.6 lets an app carry objectui's keyed label form. Before this card the
    // row's controls interpolated `app.label` directly, so every one of them
    // read `[object Object]` — and the visible heading, two lines away in the
    // same file, already resolved it. One resolver, one `t`, one display name.
    apps.value = [{ name: 'crm_app', label: { key: 'app.crm.label', defaultValue: 'CRM' }, active: true }];
    renderPage();

    // First the exact string the row's controls produced before this card — put
    // ahead of the sentinel queries so a revert reports THIS, which is the
    // claim the comment above makes.
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
    expect(screen.queryByLabelText(/\[object Object\]/)).toBeNull();
    // …then that the label was resolved through `t`, not left at its authoring
    // `defaultValue` (which is what dropping the second argument would give).
    expect(screen.getByText('«app.crm.label»')).toBeInTheDocument();
    expect(screen.getByLabelText('«appManagement.selectApp»[name=«app.crm.label»]')).toBeInTheDocument();
  });
});

describe("the server's refusal is passed through, never translated", () => {
  it('keys the toast FRAME and interpolates the server sentence byte for byte', async () => {
    // `PUT /meta/app/:name` is gated on `manage_metadata` (ADR-0066 D1), so this
    // is an ordinary outcome for an operator who can read this page. The
    // sentence is the server's diagnosis of THIS request — there is no fixed
    // catalogue of them to key against, so it rides in a `{{reason}}` hole.
    saveItem.mockRejectedValueOnce(new Error('forbidden: manage_metadata required'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('«appManagement.setDefaultNamed»[name=Ops]'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // One assertion, both halves: the frame is a key, its filling is verbatim.
    expect(toastError.mock.calls[0][0]).toBe(
      '«appManagement.toast.setDefaultFailed»[reason=forbidden: manage_metadata required]',
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('localizes the ONE part that is the page’s own — what it says when the server said nothing', async () => {
    deleteItem.mockRejectedValueOnce(new Error(''));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('«appManagement.deleteAppNamed»[name=Ops]'));
    await user.click(screen.getByLabelText('«appManagement.confirmDeleteNamed»[name=Ops]'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toBe(
      '«appManagement.toast.deleteFailed»[reason=«appManagement.toast.unknownError»]',
    );
  });

  it('keys the frame of a `reset: false` answer and passes the server sentence through (objectui#12300)', async () => {
    // A delete with no customization row to remove: nothing was deleted, and
    // the server says so in its own words. Those words ride the hole verbatim,
    // exactly like a refusal's; only the frame is the page's.
    const sentence = 'No customization overlay found for app/ops_app — already at artifact default.';
    deleteItem.mockResolvedValueOnce({ success: true, reset: false, message: sentence });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('«appManagement.deleteAppNamed»[name=Ops]'));
    await user.click(screen.getByLabelText('«appManagement.confirmDeleteNamed»[name=Ops]'));

    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(toastInfo.mock.calls[0][0]).toBe(`«appManagement.toast.nothingToDelete»[name=Ops|reason=${sentence}]`);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('localizes what a `reset: false` answer means when the server gave no sentence (objectui#12300)', async () => {
    deleteItem.mockResolvedValueOnce({ success: true, reset: false });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('«appManagement.deleteAppNamed»[name=Ops]'));
    await user.click(screen.getByLabelText('«appManagement.confirmDeleteNamed»[name=Ops]'));

    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(toastInfo.mock.calls[0][0]).toBe(
      '«appManagement.toast.nothingToDelete»[name=Ops|reason=«appManagement.toast.alreadyAtDefault»]',
    );
  });

  it('keys the bulk failure ENTRY and its joiner, and still carries both server messages', async () => {
    saveItem
      .mockRejectedValueOnce(new Error('forbidden'))
      .mockRejectedValueOnce(new Error('in use'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('«appManagement.selectApp»[name=CRM]'));
    await user.click(screen.getByLabelText('«appManagement.selectApp»[name=Ops]'));
    await user.click(screen.getByRole('button', { name: '«appManagement.bulkDisable»' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = String(toastError.mock.calls[0][0]);
    // The entry template and the separator are both pack-owned — bracket style
    // and list punctuation are locale properties, not code constants.
    expect(message).toContain('«appManagement.toast.bulkFailureEntry»[name=CRM|reason=forbidden]');
    expect(message).toContain('«appManagement.toast.bulkFailureEntry»[name=Ops|reason=in use]');
    expect(message).toContain('«appManagement.toast.bulkFailureJoiner»');
    expect(message).toMatch(/^«appManagement\.toast\.bulkFailed»\[n=2\|details=/);
  });

  it('counts the writes that landed, in a keyed sentence', async () => {
    saveItem.mockRejectedValueOnce(new Error('forbidden'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText('«appManagement.selectApp»[name=CRM]'));
    await user.click(screen.getByLabelText('«appManagement.selectApp»[name=Ops]'));
    await user.click(screen.getByRole('button', { name: '«appManagement.bulkDisable»' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // `n` is the landed count, not the selection size — the same invariant the
    // mutation suite pins, restated here in the keyed form.
    expect(toastSuccess.mock.calls[0][0]).toBe('«appManagement.toast.bulkDisabled»[n=1]');
  });
});
