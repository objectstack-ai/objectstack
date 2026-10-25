/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `useActionTextLocalizer` (objectui#4265) — one bundle entry, one fate.
 *
 * The card's shape verbatim: a zh-CN bundle translates `convert_lead`
 * completely (label + confirmText + successMessage under the SAME
 * `_actions.convert_lead` node), and the reported defect was that the button
 * picked up `label` while the confirm dialog rendered the authored English
 * `confirmText`. These pins assert the three keys of one entry resolve
 * together, and that an entry which is absent (or lacks a key) leaves the
 * authored literal in place.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(I18nProvider, {
    config: { defaultLanguage: 'en', detectBrowserLanguage: false },
    children,
  });

/** The authored action, exactly as `src/actions/lead.actions.ts` declares it. */
const CONVERT_LEAD = {
  name: 'convert_lead',
  type: 'api',
  label: 'Convert Lead',
  confirmText: 'Are you sure you want to convert this lead?',
  successMessage: 'Lead converted.',
  locations: ['record_header'],
};

function setup() {
  const { result } = renderHook(
    () => ({ localize: useActionTextLocalizer(), i18n: useObjectTranslation().i18n }),
    { wrapper },
  );
  result.current.i18n.addResourceBundle(
    'en',
    'translation',
    {
      crm: {
        objects: {
          lead: {
            _actions: {
              // The card's bundle entry — all three keys, one node.
              convert_lead: {
                label: '转化线索',
                confirmText: '确认要转化此线索吗？',
                successMessage: '线索转化成功！',
              },
              // An entry that translates the button only, so the per-key
              // fallback is pinned separately from the no-entry case.
              label_only: { label: '仅标签' },
            },
          },
        },
      },
    },
    true,
    true,
  );
  return result;
}

describe('useActionTextLocalizer — one entry, three keys (objectui#4265)', () => {
  it('resolves label, confirmText and successMessage from the SAME bundle entry', () => {
    const result = setup();
    const localized = result.current.localize('lead', CONVERT_LEAD);
    expect(localized.label).toBe('转化线索');
    // The reported defect: this used to stay English while `label` above went
    // Chinese, on the same render, from the same entry.
    expect(localized.confirmText).toBe('确认要转化此线索吗？');
    expect(localized.successMessage).toBe('线索转化成功！');
  });

  it('falls back to the authored literals when the bundle has no entry (control)', () => {
    const result = setup();
    const localized = result.current.localize('lead', { ...CONVERT_LEAD, name: 'no_entry' });
    expect(localized.label).toBe('Convert Lead');
    expect(localized.confirmText).toBe('Are you sure you want to convert this lead?');
    expect(localized.successMessage).toBe('Lead converted.');
  });

  it('falls back per key when the entry translates the label only', () => {
    const result = setup();
    const localized = result.current.localize('lead', { ...CONVERT_LEAD, name: 'label_only' });
    expect(localized.label).toBe('仅标签');
    expect(localized.confirmText).toBe('Are you sure you want to convert this lead?');
    expect(localized.successMessage).toBe('Lead converted.');
  });

  it('does not invent a confirmText the metadata never declared', () => {
    const result = setup();
    const { confirmText: _c, successMessage: _s, ...noConfirm } = CONVERT_LEAD;
    const localized = result.current.localize('lead', noConfirm);
    expect(localized.label).toBe('转化线索');
    // A bundle must not bolt a confirmation gate (or a toast) onto an action
    // whose metadata never asked for one.
    expect('confirmText' in localized).toBe(false);
    expect('successMessage' in localized).toBe(false);
  });

  it('leaves a nameless action untranslated (no key exists) but normalizes its label', () => {
    const result = setup();
    const localized = result.current.localize('lead', {
      type: 'api',
      confirmText: 'Are you sure?',
    } as Record<string, any>, { fallbackLabel: 'Action 3' });
    expect(localized.label).toBe('Action 3');
    expect(localized.confirmText).toBe('Are you sure?');
  });

  it('collapses an I18nLabel map before offering it to the bundle as the fallback', () => {
    const result = setup();
    const localized = result.current.localize('lead', {
      name: 'no_entry',
      label: { en: 'Convert Lead', 'zh-CN': '转化线索(内联)' },
      confirmText: 'Are you sure?',
    } as Record<string, any>);
    // Active language is `en` here, so the map's `en` arm is the authored text.
    expect(localized.label).toBe('Convert Lead');
  });
});
