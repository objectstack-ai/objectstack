// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28986 — in display-patch mode (a read-only base's own field,
 * edited through its pair) every control the inspector locks explains itself:
 * on hover, on keyboard focus and to assistive tech, as the read-only rail's
 * described wrapper does (objectui#12303). The whitelisted controls stay
 * editable and carry no reason.
 *
 * The oracle is the checklist row `ux-conventions.disabled-control-reason`:
 * a disabled control, or its focusable wrapper, is in the tab order and
 * carries an accessible description resolving to non-empty text.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t, tFormat } from '../i18n';

type Row = Record<string, unknown>;

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  const client = { list: async () => [], listDrafts: async () => [] };
  return { ...mod, useMetadataClient: () => client };
});

vi.mock('../previews/useObjectFields', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../previews/useObjectFields')>();
  return { ...mod, useObjectFields: () => ({ fields: [], loading: false, error: null }) };
});

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { BaseFieldDisplayPatchContext } from '../../studio-design/StudioCustomizeControls';

beforeEach(() => {
  // Radix reads pointer capture, which the DOM double does not implement.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
});

afterEach(cleanup);

const LOCALE = 'en-US';

/** One field per family of locked control the inspector draws. */
const OBJECT: Row = {
  name: 'crm_account',
  label: 'Account',
  fields: {
    name: { type: 'text', label: 'Account Name', required: true, placeholder: 'Acme' },
    industry: {
      type: 'select',
      label: 'Industry',
      options: [
        { value: 'technology', label: 'Technology', color: '#22aa22' },
        { value: 'retail', label: 'Retail' },
      ],
    },
    parent: { type: 'lookup', label: 'Parent', reference: 'crm_account' },
    employees: { type: 'number', label: 'Employees' },
    score: { type: 'formula', label: 'Score', expression: 'record.employees * 2' },
    revenue: { type: 'currency', label: 'Revenue' },
  },
};
const FIELDS = Object.keys(OBJECT.fields as Row);

function mount(selected: string, { patchOnly = true, readOnly = false } = {}) {
  render(
    <BaseFieldDisplayPatchContext.Provider value={patchOnly}>
      <div data-testid="rail">
        <ObjectFieldInspector
          type="object"
          name={String(OBJECT.name)}
          draft={OBJECT}
          selection={{ kind: 'field', id: selected }}
          onPatch={() => {}}
          onClearSelection={() => {}}
          onSelectionChange={() => {}}
          readOnly={readOnly}
          locale={LOCALE}
        />
      </div>
    </BaseFieldDisplayPatchContext.Provider>,
  );
  return screen.getByTestId('rail');
}

const CONTROLS = 'input, button, textarea, select, [role="checkbox"], [role="combobox"], [role="switch"]';

/** Every control rendered disabled: the attribute, `aria-disabled`, or Radix's `data-disabled`. */
function disabledControls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CONTROLS)).filter(
    (el) => el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled'),
  );
}

/** The text an element's `aria-describedby` resolves to, ids joined as assistive tech reads them. */
function description(el: Element): string {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

/** The whitelisted inputs: label, description, help text, placeholder, and each option's label. */
function editableControls(root: HTMLElement): HTMLElement[] {
  const named = ['designer.field.description', 'designer.field.helpText', 'designer.field.placeholder'].map(
    (key) => within(root).getByLabelText(t(key, LOCALE)),
  );
  return [within(root).getByTestId('field-label-input'), ...named, ...within(root).queryAllByTestId('option-label')];
}

describe('ObjectFieldInspector — display-patch mode explains every locked control (objectstack#28986)', () => {
  it.each(FIELDS)('field %s: each disabled control sits in a focusable wrapper described by the whitelist sentence', (field) => {
    const rail = mount(field);
    const sentence = within(rail).getByTestId('field-base-patch-only');
    expect(sentence.textContent?.trim()).not.toBe('');
    const locked = disabledControls(rail);
    expect(locked.length).toBeGreaterThan(0);
    for (const control of locked) {
      const wrapper = control.closest('[data-disabled-reason]');
      expect(wrapper, `${control.outerHTML.slice(0, 120)} has no described wrapper`).not.toBeNull();
      expect(wrapper).toHaveAttribute('tabindex', '0');
      expect(description(wrapper!)).toBe(sentence.textContent?.trim());
    }
  });

  it.each(FIELDS)('field %s: no wrapper is a tab stop over nothing locked, nor over an editable control', (field) => {
    const rail = mount(field);
    const wrappers = within(rail).queryAllByTestId('field-base-patch-locked');
    expect(wrappers.length).toBeGreaterThan(0);
    for (const wrapper of wrappers) {
      expect(disabledControls(wrapper).length, wrapper.outerHTML.slice(0, 160)).toBeGreaterThan(0);
    }
    for (const control of editableControls(rail)) {
      expect(control).toBeEnabled();
      expect(control.closest('[data-disabled-reason]')).toBeNull();
      expect(control).not.toHaveAttribute('aria-describedby', expect.stringContaining(within(rail).getByTestId('field-base-patch-only').id));
    }
  });

  it('the named locks of the card: API name, Type, Required, Track history, a rule editor, Move up/down and Remove', () => {
    const rail = mount('industry');
    const sentence = within(rail).getByTestId('field-base-patch-only');
    const named = [
      within(rail).getByTestId('field-apiname-input'),
      within(rail).getByRole('checkbox', { name: t('designer.field.required', LOCALE) }),
      within(rail).getByRole('checkbox', { name: t('designer.field.trackHistory', LOCALE) }),
      within(rail).getByLabelText(t('designer.field.visibleWhen', LOCALE)),
      // The header's pair and each option row's.
      ...within(rail).getAllByRole('button', { name: t('engine.inspector.reorder.up', LOCALE) }),
      within(rail).getByRole('button', { name: tFormat('designer.field.remove', LOCALE, { label: 'Industry' }) }),
      within(rail).getAllByTestId('option-value')[0]!,
    ];
    for (const control of named) {
      expect(control).toBeDisabled();
      const wrapper = control.closest('[data-disabled-reason]');
      expect(wrapper).not.toBeNull();
      expect(wrapper).toHaveAttribute('aria-describedby', sentence.id);
    }
  });

  it('Tab reaches a lock, and focus or hover shows the reason as a tooltip', async () => {
    const rail = mount('name');
    const sentence = within(rail).getByTestId('field-base-patch-only').textContent!.trim();
    const apiNameLock = within(rail).getByTestId('field-apiname-input').closest<HTMLElement>('[data-disabled-reason]')!;
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      await userEvent.tab();
      reached = document.activeElement === apiNameLock;
    }
    expect(reached).toBe(true);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(sentence);

    cleanup();
    const again = mount('name');
    const requiredLock = within(again)
      .getByRole('checkbox', { name: t('designer.field.required', LOCALE) })
      .closest<HTMLElement>('[data-disabled-reason]')!;
    await userEvent.hover(requiredLock);
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent(sentence);
  });
});

describe('CONTROL: outside display-patch mode the inspector draws no lock of its own (objectstack#28986)', () => {
  it('a writable field: nothing disabled, nothing wrapped', () => {
    const rail = mount('name', { patchOnly: false });
    expect(within(rail).queryByTestId('field-base-patch-only')).toBeNull();
    expect(rail.querySelector('[data-disabled-reason]')).toBeNull();
    expect(within(rail).getByTestId('field-apiname-input')).toBeEnabled();
  });

  it('a read-only rail: the host describes the whole rail, so no inner tab stops are added', () => {
    for (const patchOnly of [false, true]) {
      const rail = mount('industry', { patchOnly, readOnly: true });
      expect(disabledControls(rail).length).toBeGreaterThan(0);
      expect(rail.querySelector('[data-disabled-reason]')).toBeNull();
      cleanup();
    }
  });
});
