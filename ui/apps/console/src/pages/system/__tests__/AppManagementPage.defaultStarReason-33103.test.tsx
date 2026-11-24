// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The default app's Set-default star is disabled, and it says why
 * (ux-conventions.disabled-control-reason).
 *
 * The star goes through the console's one disabled-reason pattern
 * (`useDisabledReason` + `DisabledReasonTrigger` from `@object-ui/components`):
 * a focusable wrapper opens the reason as a tooltip on hover and on focus, and
 * the reason is the accessible description of the button and of the wrapper.
 *
 * Rendered through the real page, the real Radix tooltip and a real
 * `I18nProvider`, so the sentence each case expects is read from the shipped
 * pack rather than from the call site's `defaultValue`.
 *
 * Controls: a non-default app's star is live and carries no reason, and a write
 * in flight disables every star without one (it is the page's own transient
 * state, not a fact about the app).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const { saveItem, deleteItem, refresh, apps } = vi.hoisted(() => ({
  saveItem: vi.fn<(type: string, name: string, item: any) => Promise<unknown>>(async () => ({})),
  deleteItem: vi.fn<(type: string, name: string) => Promise<unknown>>(async () => ({})),
  refresh: vi.fn(async () => {}),
  apps: { value: [] as any[] },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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

const { en, 'zh-Hans': zh } = builtInLocales;

const CRM = { name: 'crm_app', label: 'CRM', isDefault: true, active: true };
const OPS = { name: 'ops_app', label: 'Ops', active: true };

function renderPage(language: 'en' | 'zh' = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter>
        <AppManagementPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The star of the named app, found by its accessible name in that pack. */
function star(pack: { appManagement: { setDefaultNamed: string } }, name: string): HTMLButtonElement {
  const label = pack.appManagement.setDefaultNamed.replace('{{name}}', name);
  return screen.getByRole('button', { name: label }) as HTMLButtonElement;
}

/** The text an element's `aria-describedby` ids resolve to, joined. */
const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `(missing #${id})`)
    .join(' | ');

/** The star gives no reason: no description, no wrapper, no reason text. */
function expectNoReason(button: HTMLElement) {
  expect(button).not.toHaveAttribute('aria-describedby');
  expect(button.parentElement).not.toHaveAttribute('data-disabled-reason');
}

beforeEach(() => {
  vi.clearAllMocks();
  apps.value = [CRM, OPS];
});
afterEach(() => cleanup());

describe('the default app star says why it is disabled', () => {
  const REASON = en.appManagement.alreadyDefault;

  it('the disabled star and its wrapper carry the reason as their accessible description', () => {
    renderPage();
    const button = star(en, 'CRM');
    expect(button).toBeDisabled();
    expect(description(button)).toBe(REASON);
    const trigger = button.parentElement as HTMLElement;
    expect(trigger).toHaveAttribute('data-disabled-reason');
    expect(description(trigger)).toBe(REASON);
  });

  it('hovering it opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.hover(star(en, 'CRM').parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });

  it('a keyboard user reaches it: Tab lands on the wrapper, which opens the tooltip', async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = star(en, 'CRM').parentElement as HTMLElement;
    for (let i = 0; i < 30 && document.activeElement !== trigger; i += 1) await user.tab();
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });

  it('the reason is the active language pack sentence', () => {
    renderPage('zh');
    expect(zh.appManagement.alreadyDefault).not.toBe(REASON);
    expect(description(star(zh, 'CRM'))).toBe(zh.appManagement.alreadyDefault);
  });

  it('control: a non-default app star is enabled and gives no reason', () => {
    renderPage();
    const button = star(en, 'Ops');
    expect(button).not.toBeDisabled();
    expectNoReason(button);
  });

  it('control: a write in flight disables the other stars without a reason', async () => {
    let settle: () => void = () => {};
    saveItem.mockImplementationOnce(() => new Promise((resolve) => { settle = () => resolve({}); }));
    apps.value = [CRM, OPS, { name: 'hr_app', label: 'HR', active: true }];
    const user = userEvent.setup();
    renderPage();

    await user.click(star(en, 'Ops'));
    await waitFor(() => expect(star(en, 'HR')).toBeDisabled());
    expectNoReason(star(en, 'HR'));

    settle();
    await waitFor(() => expect(star(en, 'HR')).not.toBeDisabled());
  });
});
