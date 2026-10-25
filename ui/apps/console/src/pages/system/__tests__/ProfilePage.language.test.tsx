// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7501 — the signed-in user's own `sys_user.locale`, on the profile
 * page.
 *
 * ## What these cases are guarding, and why each one can fail
 *
 * The column has been user-writable since the 2026-09-03 platform ruling and
 * nothing in the product let anyone set it. The control that closes that gap
 * has four properties that are easy to render *plausibly* and get wrong, so
 * each one is pinned against a thing the control could have done instead:
 *
 *  1. **The offered set is the i18n provider's `offerableLanguages`**, not a
 *     list of this file's own. A hard-coded ten would render an identical menu
 *     on the built-in packs and a WRONG one on a deployment that publishes two
 *     — so the case below hands the provider a three-code list that is not the
 *     built-in set and asserts the menu is exactly it.
 *  2. **The write goes to the data API**, argument by argument. A control
 *     wired to `useAuth().updateUser` renders and "succeeds" identically while
 *     posting to better-auth's `/update-user`, which does not know this column
 *     (`locale` is deliberately not a better-auth `additionalFields` entry) —
 *     so the assertion is on `adapter.update`'s arguments, and `updateUser` is
 *     asserted NOT to have been called.
 *  3. **Clearing writes `null`**, which is the documented "use the deployment
 *     default" and the only way back once a tag is stored. A control that
 *     wrote `''` would look the same on screen and store a malformed tag.
 *  4. **A refusal lands ON the item.** The rejection is built by running the
 *     platform's own error body through `normaliseClientError` — the adapter's
 *     real normaliser — rather than by hand-shaping what this test hopes the
 *     adapter throws, so the case fails if that chain moves.
 *
 * ## Why the form is driven with `fireEvent`, not `userEvent`
 *
 * Measured here, not preferred on style. Under the DOM environment these
 * console tests run in, a `userEvent.click` on the submit button never reaches
 * the form's `onSubmit` — so the save cases would fail for reasons that have
 * nothing to do with the control. `fireEvent.submit` is what this repo's other
 * form tests use for the same reason. The button is still asserted present and
 * ENABLED at that moment, so "the user could reach this submit" stays pinned.
 * The control is the shared `Select` (objectui#11865), picked the way a
 * keyboard user picks: open the trigger, choose the option.
 *
 * ## Reverse verification — both legs run, from the committed fix
 *
 * Restoring `ProfilePage` to its `origin/main` state (no `LanguageCard` at
 * all) turns **all seven** cases red on the missing `profile-language-select`.
 * That leg only proves the file is reachable, so a second, surgical leg was
 * run: re-pointing the write at `useAuth().updateUser` — the better-auth door
 * that cannot carry this column — and leaving everything else alone turns the
 * **three save cases** red (`saves the pick…`, `clears back…`, `renders the
 * server's per-field refusal…`) while the four menu / seeding / permission /
 * hidden cases stay green. The second leg is the one that says these
 * assertions are about the WRITE and not merely about something rendering.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { normaliseClientError } from '@object-ui/data-objectstack';

const { user, updateUser, findOne, update, offerable, writable } = vi.hoisted(() => ({
  user: { value: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' } as Record<string, unknown> | null },
  updateUser: vi.fn(async () => {}),
  findOne: vi.fn<(resource: string, id: string) => Promise<unknown>>(async () => ({ id: 'usr_1' })),
  update: vi.fn<(resource: string, id: string, data: unknown) => Promise<unknown>>(async () => ({})),
  offerable: { value: ['en', 'zh', 'ja'] as readonly string[] | null },
  writable: { value: true },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: user.value,
    updateUser,
    isLoading: false,
    changePassword: async () => {},
    setInitialPassword: async () => {},
    hasLocalPassword: async () => true,
  }),
}));

vi.mock('@object-ui/providers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUpload: () => ({ upload: async () => ({ url: '' }) }),
}));

/**
 * Echo each call site's own `defaultValue` and fill its holes — the console
 * convention for standing in for a locale pack, so the assertions below read
 * as the sentences an English console renders. What the keying itself is, is
 * the `check:i18n-keys` gate's business, not this file's.
 */
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
    offerableLanguages: offerable.value,
  }),
}));

/**
 * A STABLE adapter, as the app's provider hands out: a fresh object per render
 * re-runs the card's row read on every render, and its answer resets the
 * picked language to the stored one before Save can be reached.
 */
const ADAPTER = vi.hoisted(() => ({ findOne, update }));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => ({ isLoaded: true, checkField: () => writable.value }),
}));

const { ProfilePage } = await import('../ProfilePage');

/** The picker's trigger, once the row read has settled and the card has mounted. */
async function renderProfile() {
  render(<ProfilePage />);
  return screen.findByTestId('profile-language-select');
}

/** Open the picker and return the labels it lists, in order. */
async function listed(trigger: HTMLElement): Promise<string[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const labels = within(listbox).getAllByRole('option').map((o) => o.textContent ?? '');
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  return labels;
}

/** Pick one option by its label. */
async function pick(trigger: HTMLElement, label: string) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: label }));
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

describe('ProfilePage — my language (objectui#7501)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.value = { id: 'usr_1', name: 'Ada', email: 'ada@example.com' };
    offerable.value = ['en', 'zh', 'ja'];
    writable.value = true;
    findOne.mockResolvedValue({ id: 'usr_1' });
    update.mockResolvedValue({});
  });

  it('offers the provider’s locales — named in their own language — and nothing else', async () => {
    const select = await renderProfile();

    expect(findOne).toHaveBeenCalledWith('sys_user', 'usr_1');
    // What each option writes is pinned option by option in
    // `ProfilePage.sharedSelect-11865`; here, what the menu offers.
    const options = await listed(select);
    expect(options).toEqual([
      'Use the deployment default',
      'English',
      '中文',
      '日本語',
    ]);
    // The list is the provider's, not a built-in ten: `ko`/`de`/`fr` ship
    // catalogues in this repo and are deliberately NOT in `offerableLanguages`
    // here. A hard-coded menu would light these up.
    expect(options).not.toContain('한국어');
    expect(options).not.toContain('Deutsch');
  });

  it('seeds from the stored tag, and shows one the deployment no longer publishes', async () => {
    findOne.mockResolvedValue({ id: 'usr_1', locale: 'pt-BR' });
    const select = await renderProfile();

    expect(select).toHaveTextContent('Português (Brasil)');
    expect(await listed(select)).toEqual([
      'Use the deployment default',
      'Português (Brasil)',
      'English',
      '中文',
      '日本語',
    ]);
  });

  it('saves the pick through the data API — not through better-auth', async () => {
    const select = await renderProfile();

    await pick(select, '日本語');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.submit(select.closest('form')!);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('sys_user', 'usr_1', { locale: 'ja' });
    // `/update-user` cannot carry this column; a control wired to it would
    // pass every other assertion in this case.
    expect(updateUser).not.toHaveBeenCalled();
    expect(await screen.findByText('Language preference updated.')).toBeInTheDocument();
  });

  it('clears back to the deployment default by writing null, not an empty tag', async () => {
    findOne.mockResolvedValue({ id: 'usr_1', locale: 'ja' });
    const select = await renderProfile();
    expect(select).toHaveTextContent('日本語');

    await pick(select, 'Use the deployment default');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.submit(select.closest('form')!);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('sys_user', 'usr_1', { locale: null });
  });

  it('renders the server’s per-field refusal on the item, not as a bare alert', async () => {
    // The platform's own `400 VALIDATION_FAILED` body, run through the
    // adapter's real normaliser, so this case pins the whole chain rather than
    // a hand-shaped guess of what the adapter throws.
    update.mockRejectedValue(
      normaliseClientError({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        httpStatus: 400,
        details: {
          fields: [
            { field: 'locale', code: 'invalid_format', message: 'Not a valid language tag.' },
          ],
        },
      }),
    );

    const select = await renderProfile();
    await pick(select, '中文');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.submit(select.closest('form')!);

    const message = await screen.findByText('Not a valid language tag.');
    // ON the item: the select points at it, so a screen reader reaches it from
    // the control rather than from somewhere else on the page.
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select.getAttribute('aria-describedby')).toBe(message.id);
    expect(screen.queryByText('Language preference updated.')).not.toBeInTheDocument();
  });

  it('degrades to read-only with a reason when the write route is not the user’s', async () => {
    writable.value = false;
    const select = await renderProfile();

    expect(select).toBeDisabled();
    expect(
      screen.getByText('Your administrator manages the language for your account.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('renders no control at all when the row cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    findOne.mockRejectedValue(Object.assign(new Error('Forbidden'), { httpStatus: 403 }));

    render(<ProfilePage />);
    // The name field is the control group: the page itself rendered, so the
    // absence below is this card's absence and not an unmounted page.
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByTestId('profile-language-select')).not.toBeInTheDocument();

    warn.mockRestore();
  });
});
