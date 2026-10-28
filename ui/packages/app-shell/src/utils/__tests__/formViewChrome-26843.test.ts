/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26843 — the form view's `buttons`, `layout`,
 * `defaults`, `defaultTab` and `tabPosition` reach the console's form hosts.
 *
 * `resolveFormViewChrome` is the one place the full-page record form and the
 * New / Edit dialog read the first three from; `resolveFormViewLayout` carries
 * the tab keys beside the modal's tabbed content layout. Each block has a
 * CONTROL with the key absent, which keeps the host's own answer.
 */

import { describe, it, expect } from 'vitest';
import { resolveFormViewChrome, resolveFormViewLayout } from '../recordFormNavigation';

const HOST = { language: 'en', submitText: 'Save', cancelText: 'Cancel' } as const;

describe('resolveFormViewChrome — buttons', () => {
  it('an authored label and show win over the host defaults', () => {
    const chrome = resolveFormViewChrome(
      { buttons: { submit: { label: 'Send request' }, cancel: { show: false, label: 'Back' } } },
      { ...HOST, flow: 'create' },
    );
    expect(chrome).toMatchObject({
      showSubmit: true,
      submitText: 'Send request',
      showCancel: false,
      cancelText: 'Back',
    });
  });

  it('an authored per-locale label resolves against the UI language', () => {
    const buttons = { submit: { label: { en: 'Send', 'zh-CN': '发送' } } };
    expect(resolveFormViewChrome({ buttons }, { ...HOST, flow: 'edit' }).submitText).toBe('Send');
    expect(resolveFormViewChrome({ buttons }, { ...HOST, language: 'zh-CN', flow: 'edit' }).submitText).toBe('发送');
  });

  it('`show: false` on submit hides it', () => {
    expect(resolveFormViewChrome({ buttons: { submit: { show: false } } }, { ...HOST, flow: 'edit' }).showSubmit).toBe(false);
  });

  it('CONTROL: no form view, or no `buttons` — the host labels, both shown', () => {
    for (const formView of [undefined, {}, { buttons: {} }]) {
      expect(resolveFormViewChrome(formView, { ...HOST, flow: 'create' })).toStrictEqual({
        showSubmit: true,
        submitText: 'Save',
        showCancel: true,
        cancelText: 'Cancel',
        layout: 'vertical',
      });
    }
  });
});

describe('resolveFormViewChrome — layout', () => {
  it('an authored horizontal reaches the form', () => {
    expect(resolveFormViewChrome({ layout: 'horizontal' }, { ...HOST, flow: 'edit' }).layout).toBe('horizontal');
  });

  it('a value the spec enum refuses (the retired `grid`) is not copied', () => {
    expect(resolveFormViewChrome({ layout: 'grid' as any }, { ...HOST, flow: 'edit' }).layout).toBe('vertical');
  });
});

describe('resolveFormViewChrome — defaults', () => {
  const defaults = { status: 'new', priority: 'high' };

  it('seed a create', () => {
    expect(resolveFormViewChrome({ defaults }, { ...HOST, flow: 'create' }).initialValues).toBe(defaults);
  });

  it('the host values (a URL prefill) win per field over the defaults', () => {
    const chrome = resolveFormViewChrome({ defaults }, { ...HOST, flow: 'create', createValues: { priority: 'low', account: 'a1' } });
    expect(chrome.initialValues).toStrictEqual({ status: 'new', priority: 'low', account: 'a1' });
  });

  it('the merged seed keeps its identity across calls with equal inputs — the forms re-seed on a new object', () => {
    const first = resolveFormViewChrome({ defaults }, { ...HOST, flow: 'create', createValues: { priority: 'low' } });
    const second = resolveFormViewChrome({ defaults }, { ...HOST, flow: 'create', createValues: { priority: 'low' } });
    expect(second.initialValues).toBe(first.initialValues);
    const changed = resolveFormViewChrome({ defaults }, { ...HOST, flow: 'create', createValues: { priority: 'urgent' } });
    expect(changed.initialValues).not.toBe(first.initialValues);
    expect(changed.initialValues).toMatchObject({ priority: 'urgent' });
  });

  it('an edit never reads them', () => {
    expect(resolveFormViewChrome({ defaults }, { ...HOST, flow: 'edit' }).initialValues).toBeUndefined();
  });

  it('CONTROL: no defaults — the host values pass through as the object they are', () => {
    const createValues = { due_date: '2026-10-20' };
    expect(resolveFormViewChrome({}, { ...HOST, flow: 'create', createValues }).initialValues).toBe(createValues);
    expect('initialValues' in resolveFormViewChrome({}, { ...HOST, flow: 'create' })).toBe(false);
  });
});

describe('resolveFormViewLayout — the tab keys ride with the tabbed content layout', () => {
  const sections = [{ name: 'a', fields: ['x'] }, { name: 'b', fields: ['y'] }];

  it('a tabbed form view carries defaultTab and tabPosition', () => {
    expect(resolveFormViewLayout({ form: { type: 'tabbed', sections, defaultTab: 'b', tabPosition: 'left' } })).toStrictEqual({
      sections,
      contentLayout: 'tabbed',
      defaultTab: 'b',
      tabPosition: 'left',
    });
  });

  it('a position the spec enum refuses is not copied', () => {
    expect(resolveFormViewLayout({ form: { type: 'tabbed', sections, tabPosition: 'middle' as any } }).tabPosition).toBeUndefined();
  });

  it('CONTROL: a stacked form view carries neither, even when it authors them', () => {
    expect(resolveFormViewLayout({ form: { type: 'simple', sections, defaultTab: 'b', tabPosition: 'left' } })).toStrictEqual({ sections });
  });
});
