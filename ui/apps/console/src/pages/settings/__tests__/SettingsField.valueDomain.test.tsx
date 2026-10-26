/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsField — a `select` follows its specifier's `valueDomain` declaration
 * (objectui#3719).
 *
 * What this closes: since objectstack#5712 / PR objectstack#6581 a settings
 * specifier can declare `valueDomain`, and when it does the STANDARD's
 * membership is the enforcement boundary — `PUT /api/settings/localization`
 * accepts `timezone: 'Europe/Zurich'` and `currency: 'CHF'`, neither of which
 * is in the curated `options`. The console kept rendering those keys as closed
 * dropdowns, so an admin could author only the 17 curated zones / 9 currencies
 * while the contract took the whole domain. Every legal value outside the
 * table was reachable by API or env only.
 *
 * Why BOTH halves are pinned below, and why that is the whole point: proving
 * only that a domain-bearing key became a combobox is evidence-identical to
 * having replaced every settings dropdown with one. Keys WITHOUT a declaration
 * must keep the closed dropdown — their `options` are still exhaustive
 * (objectstack#5131), and `localization.locale` had its domain declaration
 * deliberately REJECTED in objectstack#6515 because its options ARE the shipped
 * catalogs. So the two groups are derived from the specifier data by `.filter`
 * on `valueDomain` rather than by listing which keys are which: a key that
 * gains a domain server-side joins the right side of the pin with no edit here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { SettingsField } from '../SettingsField';
import type { Specifier } from '../types';

/**
 * The `select` specifiers of the real `localization` manifest, mirroring
 * `service-settings/src/manifests/localization.manifest.ts` — three declared
 * domains, and the registry-backed selects that are undeclared ON PURPOSE
 * (pinned server-side in `localization.manifest.test.ts`). `options` are
 * abridged; which values are listed does not matter to either assertion, only
 * that the probe value below is NOT among them.
 */
const LOCALIZATION_SELECTS: Specifier[] = [
  {
    type: 'select',
    key: 'timezone',
    label: 'Time zone',
    valueDomain: 'iana_time_zone',
    options: [
      { value: 'UTC', label: 'UTC' },
      { value: 'America/New_York', label: 'New York' },
      { value: 'Asia/Shanghai', label: 'Shanghai' },
    ],
  },
  {
    type: 'select',
    key: 'currency',
    label: 'Currency',
    valueDomain: 'iso_4217_currency',
    options: [
      { value: 'USD', label: 'US Dollar' },
      { value: 'EUR', label: 'Euro' },
    ],
  },
  {
    type: 'select',
    key: 'default_country',
    label: 'Default country',
    valueDomain: 'iso_3166_alpha2',
    options: [
      { value: 'US', label: 'United States' },
      { value: 'DE', label: 'Germany' },
    ],
  },
  {
    type: 'select',
    key: 'locale',
    label: 'Locale',
    options: [
      { value: 'en-US', label: 'English (US)' },
      { value: 'zh-CN', label: '简体中文' },
    ],
  },
  {
    type: 'select',
    key: 'date_format',
    label: 'Date format',
    options: [
      { value: 'YYYY-MM-DD', label: '2026-01-31' },
      { value: 'MM/DD/YYYY', label: '01/31/2026' },
    ],
  },
  {
    type: 'select',
    key: 'first_day_of_week',
    label: 'First day of week',
    options: [
      { value: 'monday', label: 'Monday' },
      { value: 'sunday', label: 'Sunday' },
    ],
  },
];

/** The partition, taken from the DATA — not from a list of key names. */
const DECLARED = LOCALIZATION_SELECTS.filter((s) => s.valueDomain);
const UNDECLARED = LOCALIZATION_SELECTS.filter((s) => !s.valueDomain);

/**
 * A legal member of each domain that is deliberately outside the curated
 * `options` — the card's own repro values for the first two, both accepted by
 * the server today. Keyed by DOMAIN, so a new key carrying a known domain needs
 * no entry.
 */
const OUTSIDE_THE_CURATED_LIST: Record<string, string> = {
  iana_time_zone: 'Europe/Zurich',
  iso_4217_currency: 'CHF',
  iso_3166_alpha2: 'CH',
};

const optionValues = (spec: Specifier) => (spec.options ?? []).map((o) => String(o.value));

function renderField(spec: Specifier, extra: Partial<Parameters<typeof SettingsField>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(
    <SettingsField spec={spec} value={optionValues(spec)[0]} onChange={onChange} {...extra} />,
  );
  return { ...view, onChange };
}

afterEach(cleanup);

describe('SettingsField — `select` follows the specifier\'s valueDomain declaration', () => {
  /**
   * Guard first: both loops below are data-driven, so an empty group would let
   * them pass while asserting nothing. This is the assertion that keeps the
   * `.filter` honest.
   */
  it('the fixture actually carries both kinds', () => {
    expect(DECLARED.length).toBeGreaterThan(0);
    expect(UNDECLARED.length).toBeGreaterThan(0);
    expect(DECLARED.length + UNDECLARED.length).toBe(LOCALIZATION_SELECTS.length);
  });

  // ---- half 1: a declared domain accepts a value outside `options` ----------

  for (const spec of DECLARED) {
    it(`${spec.key} (${spec.valueDomain}) takes a value the curated options do not list`, () => {
      const probe = OUTSIDE_THE_CURATED_LIST[spec.valueDomain!];
      // The probe is only evidence if it really is outside the table.
      expect(probe).toBeTruthy();
      expect(optionValues(spec)).not.toContain(probe);

      const { container, onChange } = renderField(spec);

      const input = container.querySelector('input');
      expect(input, 'a domain-bearing select must render an editable control').not.toBeNull();

      // The curated table survives — as SUGGESTIONS, not as the boundary.
      const listId = input!.getAttribute('list');
      const datalist = container.querySelector('datalist');
      expect(datalist).not.toBeNull();
      expect(datalist!.id).toBe(listId);
      expect(
        Array.from(datalist!.querySelectorAll('option')).map((o) => o.getAttribute('value')),
      ).toEqual(optionValues(spec));

      // …and free text outside them is committed verbatim, not swallowed.
      fireEvent.change(input!, { target: { value: probe } });
      expect(onChange).toHaveBeenCalledWith(probe);
    });
  }

  // ---- half 2: no declaration ⇒ the closed dropdown is untouched ------------

  for (const spec of UNDECLARED) {
    it(`${spec.key} keeps the closed dropdown — its options are exhaustive`, () => {
      const { container } = renderField(spec);

      // Nothing free-typable anywhere in the field. This IS the refusal, in DOM
      // terms: Radix's Select renders a button trigger and no text entry.
      expect(container.querySelector('input, textarea, [contenteditable="true"]')).toBeNull();
      expect(container.querySelector('datalist')).toBeNull();

      // Still a dropdown, not merely "nothing rendered".
      const trigger = screen.getByRole('combobox');
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  }

  // ---- the two halves, counted against each other --------------------------

  it('renders exactly as many editable comboboxes as there are declarations', () => {
    const { container } = render(
      <div>
        {LOCALIZATION_SELECTS.map((spec) => (
          <SettingsField key={spec.key} spec={spec} value={undefined} onChange={() => {}} />
        ))}
      </div>,
    );

    // No dropdown was widened by accident, and none was left behind.
    expect(container.querySelectorAll('input[list]')).toHaveLength(DECLARED.length);
    expect(container.querySelectorAll('datalist')).toHaveLength(DECLARED.length);
    // …and `input[list]` is the ONLY input the select branch produces, so the
    // count above cannot be inflated by some other control.
    expect(container.querySelectorAll('input')).toHaveLength(DECLARED.length);
    expect(
      screen.getAllByRole('combobox').filter((el) => el.tagName === 'BUTTON'),
    ).toHaveLength(UNDECLARED.length);
  });

  // ---- the rejection the server sends still lands on the control ------------

  it('a server rejection marks the combobox itself, not a wrapper', () => {
    // The shape `service-settings` sends for an out-of-domain value: 400
    // SETTINGS_VALIDATION → details.fields[] → invalid_value with
    // `constraint: { valueDomain: 'iana_time_zone' }`. SettingsView hands the
    // message down as `error`; what is pinned here is that the wrapper's
    // aria wiring reaches the new control.
    const { container } = renderField(DECLARED[0], {
      error: "'Mars/Olympus' is not a recognized IANA time zone.",
    });

    const input = container.querySelector('input')!;
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    expect(screen.getByRole('alert')).toHaveTextContent('not a recognized IANA time zone');
  });
});
