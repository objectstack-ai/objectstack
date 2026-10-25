// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12691 — on a read-only package, the Data pillar's Validations editor
 * says why its controls are disabled, on hover, on focus and to assistive tech.
 *
 * Measured on the card: the rule editor's Type / Name / Label / Message /
 * Severity / Priority / Runs-on / Enabled controls were all disabled with no
 * `title`, no `aria-describedby` and no tab stop — a disabled control takes
 * neither hover nor focus, so nothing in the editor said why. The editor body
 * now carries the treatment the Field properties rail got (objectui#12303,
 * `DataPillar.readOnlyRailReason-12303.test.tsx`) with the package's read-only
 * reason, `engine.studio.pkg.readonlyHint`: a tab stop described by an
 * `sr-only` copy of the reason, and the trigger of a tooltip that shows it.
 *
 * The reason is pinned by KEY, resolved in each locale, so a copy edit does
 * not redden this file and a missing row does (`t` echoes a missing key).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { ObjectValidationsPanel } from './ObjectValidationsPanel';
import { t } from '../metadata-admin/i18n';

afterEach(cleanup);

type Locale = 'en-US' | 'zh-CN';
const LOCALES: ReadonlyArray<readonly [Locale, 'en' | 'zh']> = [
  ['en-US', 'en'],
  ['zh-CN', 'zh'],
];

/** The row for `key` in `locale`, which must exist: `t` echoes a missing key. */
function row(key: string, locale: Locale): string {
  const text = t(key, locale);
  expect(text, `no ${locale} row for ${key}`).not.toBe(key);
  return text;
}

const fields = {
  status: { type: 'select', label: 'Status' },
  code: { type: 'text', label: 'Code' },
};
const RULE = {
  type: 'state_machine',
  name: 'status_flow',
  label: 'Task Status Flow',
  message: 'Bad move',
  field: 'status',
  transitions: { open: ['closed'] },
};

function renderPanel({ lang = 'en', disabled = false }: { lang?: 'en' | 'zh'; disabled?: boolean } = {}) {
  const panel = (
    <ObjectValidationsPanel draft={{ fields, validations: [RULE] }} onPatch={() => {}} disabled={disabled} />
  );
  if (lang === 'en') return render(panel);
  const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  return render(<I18nProvider instance={zh}>{panel}</I18nProvider>);
}

/** The element an `aria-describedby` names, or `null`. */
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

/** The editor's form controls — the ones the reason is about. */
const controls = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLElement>('input, select, textarea, button[role="combobox"]'),
];

describe('Validations editor on a read-only package — the reason reaches the author (objectui#12691)', () => {
  it.each(LOCALES)('%s: the editor body is described by the read-only reason, and holds the disabled controls', (locale, lang) => {
    const { container } = renderPanel({ lang, disabled: true });
    const reason = row('engine.studio.pkg.readonlyHint', locale);
    const body = container.querySelector('[data-disabled-reason]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute('tabindex', '0');
    expect(describedBy(body)).toHaveTextContent(reason);
    expect(body).toHaveAccessibleDescription(reason);
    // Named by the panel's title, so the tab stop is not an anonymous group.
    expect(body).toHaveAccessibleName(row('engine.studio.rules.title', locale));

    const all = controls(body);
    // The common fields alone are six controls; a vacuous pass is not one.
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const el of all) expect(el).toBeDisabled();
  });

  it.each(LOCALES)('%s: hovering the disabled controls opens a tooltip with the reason', async (locale, lang) => {
    const user = userEvent.setup();
    const { container } = renderPanel({ lang, disabled: true });
    const body = container.querySelector('[data-disabled-reason]') as HTMLElement;
    expect(body).not.toBeNull();
    // The card's own probe: the Severity picker, which is disabled.
    const severity = body.querySelector('[data-testid="rule-severity"]') as HTMLElement;
    expect(severity).toBeDisabled();
    await user.hover(severity);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(row('engine.studio.pkg.readonlyHint', locale));
  });

  it.each(LOCALES)('%s: a keyboard user reaches the reason — Tab from the rule list lands on the described body, which opens the tooltip', async (locale, lang) => {
    const user = userEvent.setup();
    const { container } = renderPanel({ lang, disabled: true });
    const reason = row('engine.studio.pkg.readonlyHint', locale);
    const body = container.querySelector('[data-disabled-reason]') as HTMLElement;
    screen.getByRole('button', { name: /Task Status Flow/ }).focus();
    await user.tab();
    expect(body).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(reason);
  });

  it('CONTROL — a writable package: the controls are live and the editor gives no read-only reason', () => {
    const { container } = renderPanel();
    expect(container.querySelector('[data-disabled-reason]')).toBeNull();
    expect(container.querySelector('[aria-describedby]')).toBeNull();
    expect(screen.queryByText(t('engine.studio.pkg.readonlyHint', 'en-US'))).toBeNull();
    const all = controls(container);
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const el of all) expect(el).toBeEnabled();
  });
});
