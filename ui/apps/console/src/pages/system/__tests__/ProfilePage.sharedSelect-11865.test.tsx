// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The profile page's preferred language is the shared `Select`
 * (objectui#11865).
 *
 * The language card picked with a browser-native select, beside the shared
 * Radix `Select` the rest of the console picks with. The card asks for one
 * control for one kind of choice, surface by surface.
 *
 * What is pinned:
 *   - the picker IS the primitive (a Radix combobox trigger) and shows the
 *     stored tag; the only native select left is Radix's own hidden form
 *     mirror;
 *   - the trigger keeps the name the card's `<Label htmlFor>` gave the native
 *     control;
 *   - every option writes the `adapter.update` call the native control led to,
 *     compared as JSON text, "Use the deployment default" (value `''`, saved
 *     as `null`) included, and re-picking the current option leaves nothing
 *     to save;
 *   - a pick the offered list has since dropped is what the trigger shows;
 *   - the keyboard alone opens the picker and selects.
 *
 * Read-only follows the primitive (objectui#11781): `ProfilePage.language`'s
 * "degrades to read-only" case pins the disabled trigger.
 *
 * DIRECTION, observed against the native control: every pin here but the name
 * pin is red there, because each one reads the picker as the primitive's
 * trigger. What makes the write pins guards of "the conversion changed nothing
 * the card saves" is the literal each compares against: a `change` event on
 * the pre-conversion card's native control, then the same submit, led to that
 * same `update` JSON, read once on that card with these fixtures. The name and
 * the dropped-pick reading were taken there the same way.
 */

import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { findOne, update, offerable } = vi.hoisted(() => ({
  findOne: vi.fn<(resource: string, id: string) => Promise<unknown>>(async () => ({ id: 'usr_1' })),
  update: vi.fn<(resource: string, id: string, data: unknown) => Promise<unknown>>(async () => ({})),
  offerable: { value: ['en', 'zh', 'ja'] as readonly string[] },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' },
    updateUser: async () => {},
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

/** Each call site's own `defaultValue`, as an English console renders it. */
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
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
  usePermissions: () => ({ isLoaded: true, checkField: () => true }),
}));

const { ProfilePage } = await import('../ProfilePage');

const DEFAULT = 'Use the deployment default';

beforeEach(() => {
  vi.clearAllMocks();
  offerable.value = ['en', 'zh', 'ja'];
  findOne.mockResolvedValue({ id: 'usr_1' });
  update.mockResolvedValue({});
});

/** The picker, once the row read has settled and the card has mounted. */
async function renderCard(locale?: string) {
  findOne.mockResolvedValue(locale ? { id: 'usr_1', locale } : { id: 'usr_1' });
  const utils = render(<ProfilePage />);
  const trigger = await screen.findByTestId('profile-language-select');
  return { ...utils, trigger };
}

/** Open the picker from the keyboard and return the options it lists, in order. */
async function openPicker(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const options = await openPicker(trigger);
  const option = options.find((o) => o.textContent === label);
  if (!option) throw new Error(`no "${label}" listed: ${options.map((o) => o.textContent).join(' | ')}`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
}

describe('the language picker is the shared Select (objectui#11865)', () => {
  it('renders the picker as the Radix combobox trigger, showing the stored tag', async () => {
    const { trigger } = await renderCard('ja');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger).toHaveTextContent('日本語');
    // Radix mirrors the value into a hidden native select inside a form; it is
    // aria-hidden and out of the tab order. No other native select is left.
    expect(document.querySelectorAll('select:not([aria-hidden="true"])')).toHaveLength(0);
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('keeps the name the card’s label gave the native control', async () => {
    const { trigger } = await renderCard();
    expect(screen.getByRole('combobox', { name: 'Preferred language' })).toBe(trigger);
    expect(trigger).toHaveAttribute('id', 'profile-language');
  });
});

/**
 * [the stored tag, option label, the JSON text of `adapter.update`'s call].
 * `null`: nothing to save — the option is the current one, so Save stays
 * disabled.
 */
const WRITES: ReadonlyArray<readonly [stored: string | undefined, label: string, json: string | null]> = [
  [undefined, DEFAULT, null],
  [undefined, 'English', '["sys_user","usr_1",{"locale":"en"}]'],
  [undefined, '中文', '["sys_user","usr_1",{"locale":"zh"}]'],
  [undefined, '日本語', '["sys_user","usr_1",{"locale":"ja"}]'],
  ['ja', DEFAULT, '["sys_user","usr_1",{"locale":null}]'],
  ['ja', 'English', '["sys_user","usr_1",{"locale":"en"}]'],
  ['ja', '中文', '["sys_user","usr_1",{"locale":"zh"}]'],
  ['ja', '日本語', null],
  ['pt-BR', DEFAULT, '["sys_user","usr_1",{"locale":null}]'],
  ['pt-BR', 'English', '["sys_user","usr_1",{"locale":"en"}]'],
  ['pt-BR', '中文', '["sys_user","usr_1",{"locale":"zh"}]'],
  ['pt-BR', '日本語', '["sys_user","usr_1",{"locale":"ja"}]'],
  ['pt-BR', 'Português (Brasil)', null],
];

describe('every option writes what the native control wrote', () => {
  it('lists the options in the order the native control did', async () => {
    const { trigger } = await renderCard('pt-BR');
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual([
      DEFAULT,
      'Português (Brasil)',
      'English',
      '中文',
      '日本語',
    ]);
  });

  it.each(WRITES.map(([stored, label, json]) => [`stored ${stored ?? 'none'} → ${label}`, stored, label, json] as const))(
    '%s',
    async (_name, stored, label, json) => {
      const { trigger } = await renderCard(stored);
      await pick(trigger, label);
      expect(trigger).toHaveTextContent(label);
      const save = screen.getByRole('button', { name: 'Save' });
      if (json === null) {
        expect(save).toBeDisabled();
        expect(update).not.toHaveBeenCalled();
        return;
      }
      expect(save).toBeEnabled();
      fireEvent.submit(trigger.closest('form')!);
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      expect(JSON.stringify(update.mock.calls[0])).toBe(json);
    },
  );
});

describe('a value no option carries is what the trigger shows', () => {
  it('a pick the offered list has since dropped: shown and saved as picked', async () => {
    const { trigger, rerender } = await renderCard();
    await pick(trigger, '中文');
    offerable.value = ['en', 'ja'];
    rerender(<ProfilePage />);
    // The native control showed its first option here while Save would write `zh`.
    expect(trigger).toHaveTextContent('zh');
    expect((await openPicker(trigger)).map((o) => o.textContent)).toEqual(['zh', DEFAULT, 'English', '日本語']);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    fireEvent.submit(trigger.closest('form')!);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(update.mock.calls[0])).toBe('["sys_user","usr_1",{"locale":"zh"}]');
  });
});

describe('the keyboard alone picks', () => {
  it('Enter opens the picker and Enter on an option selects it', async () => {
    const { trigger } = await renderCard();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'English' }), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveTextContent('English');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
