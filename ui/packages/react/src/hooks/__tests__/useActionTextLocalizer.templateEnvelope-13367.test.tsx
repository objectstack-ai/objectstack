/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `useActionTextLocalizer` (objectui#13367) — the `template` envelope reaches
 * the runner as an envelope.
 *
 * objectstack#24814 types `confirmText`, `successMessage` and `errorMessage`
 * as `template` slots, so they can arrive as `{ dialect: 'template', source }`.
 * Read as an `I18nLabel` map, `pickLocalized` collapsed that envelope to its
 * first string value — the word `template` — which the confirm dialog and the
 * toasts then showed. The hook now keeps the envelope, and a bundle entry
 * replaces its `source`.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(I18nProvider, {
    config: { defaultLanguage: 'zh-CN', detectBrowserLanguage: false },
    children,
  });

function setup() {
  const { result } = renderHook(
    () => ({ localize: useActionTextLocalizer(), i18n: useObjectTranslation().i18n }),
    { wrapper },
  );
  return result;
}

const COPY = {
  confirmText: { dialect: 'template', source: 'Invite {{ record.name }}?' },
  successMessage: { dialect: 'template', source: 'Invited {{ result.email }}' },
  errorMessage: { dialect: 'template', source: 'Could not invite {{ record.name }}' },
};

describe('useActionTextLocalizer keeps the template envelope (objectui#13367)', () => {
  it('a nameless action: every envelope comes back as written, never as the word "template"', () => {
    const result = setup();
    const action = { type: 'api', target: '/x', label: 'Invite', ...COPY };
    const out = result.current.localize(undefined, action);
    expect(out.confirmText).toEqual(COPY.confirmText);
    expect(out.successMessage).toEqual(COPY.successMessage);
    expect(out.errorMessage).toEqual(COPY.errorMessage);
  });

  it('a named action with no bundle entry: the envelopes come back as written', () => {
    const result = setup();
    const out = result.current.localize(undefined, { name: 'invite_member', type: 'api', ...COPY });
    expect(out.confirmText).toEqual(COPY.confirmText);
    expect(out.successMessage).toEqual(COPY.successMessage);
    expect(out.errorMessage).toEqual(COPY.errorMessage);
  });

  it('a bundle entry replaces the source and keeps the envelope, holes intact for the runner', () => {
    const result = setup();
    result.current.i18n.addResourceBundle(
      result.current.i18n.language,
      'translation',
      {
        cloud: {
          globalActions: {
            invite_member: { confirmText: '邀请 {{ record.name }}？', successMessage: '已邀请 {{ result.email }}' },
          },
        },
      },
      true,
      true,
    );
    const out = result.current.localize(undefined, { name: 'invite_member', type: 'api', ...COPY });
    expect(out.confirmText).toEqual({ dialect: 'template', source: '邀请 {{ record.name }}？' });
    expect(out.successMessage).toEqual({ dialect: 'template', source: '已邀请 {{ result.email }}' });
  });

  it('an envelope with no source and no bundle entry passes through unchanged', () => {
    const result = setup();
    const bare = { dialect: 'template' };
    const out = result.current.localize(undefined, { name: 'archive', type: 'api', confirmText: bare });
    expect(out.confirmText).toBe(bare);
  });

  it('CONTROL: a plain string and an I18nLabel map read as before', () => {
    const result = setup();
    const out = result.current.localize(undefined, {
      name: 'invite_member',
      type: 'api',
      confirmText: 'Invite {{ record.name }}?',
      successMessage: { en: 'Invited', 'zh-CN': '已邀请' },
    });
    expect(out.confirmText).toBe('Invite {{ record.name }}?');
    expect(out.successMessage).toBe('已邀请');
  });
});
