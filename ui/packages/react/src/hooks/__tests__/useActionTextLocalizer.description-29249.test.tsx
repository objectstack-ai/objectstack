/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29249 — an action's `description`, the line the param dialog
 * draws under its title, is declared `I18nLabel` copy like `confirmText`: an
 * inline per-locale map collapses to the active language before the runner
 * and the dialog, which have no language, receive it.
 *
 * Declared-only and collapse-only, like `errorMessage`: an action that
 * declares no `description` gains no key (the dialog keeps its generic line),
 * and the bundle's `_actions.<name>.description` is not read here — the
 * param-collection host resolves that entry over the string handed on.
 *
 * Measured under a real `I18nProvider`, reading what the localizer returns.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { useActionTextLocalizer } from '../useActionTextLocalizer';

afterEach(() => cleanup());

const DESCRIPTION = {
  en: 'We e-mail them an invitation link.',
  'zh-CN': '我们会向对方发送一封邀请邮件。',
};

/** The producer's shape: a nameless inline `api` action that collects params. */
const INVITE = {
  type: 'api',
  target: '/api/v1/cloud/invitations',
  label: { en: 'Invite member', 'zh-CN': '邀请成员' },
  params: [{ name: 'email', label: 'Email', type: 'email', required: true }],
};

function harness(language: string, bundle?: Record<string, unknown>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
  const { result } = renderHook(
    () => ({ localize: useActionTextLocalizer(), translation: useObjectTranslation() }),
    { wrapper },
  );
  if (bundle) result.current.translation.i18n.addResourceBundle(language, 'translation', bundle, true, true);
  return result;
}

describe('useActionTextLocalizer — description (objectstack#29249)', () => {
  it('a nameless inline action: the locale map collapses to the zh-CN string', () => {
    const result = harness('zh-CN');
    const localized = result.current.localize(undefined, { ...INVITE, description: DESCRIPTION });
    expect(localized.description).toBe('我们会向对方发送一封邀请邮件。');
  });

  it('the same map reads the English entry under an en locale', () => {
    const result = harness('en');
    const localized = result.current.localize(undefined, { ...INVITE, description: DESCRIPTION });
    expect(localized.description).toBe('We e-mail them an invitation link.');
  });

  it('a named action collapses the map too, and the bundle entry is not read here', () => {
    const result = harness('zh-CN', {
      sys: { globalActions: { invite_member: { label: '邀请同事', description: '来自翻译包的说明' } } },
    });
    const localized = result.current.localize(undefined, {
      ...INVITE,
      name: 'invite_member',
      description: DESCRIPTION,
    });
    // Positive control: the same bundle node IS read for `label`, so the
    // harness reached a named action's bundle path.
    expect(localized.label).toBe('邀请同事');
    // Collapse-only: the host's `actionDescription` owns the bundle read.
    expect(localized.description).toBe('我们会向对方发送一封邀请邮件。');
  });

  it('a `template` envelope comes back as itself, never collapsed as a locale map', () => {
    const result = harness('zh-CN');
    const envelope = { dialect: 'template', source: 'Invite {{ record.name }} to the team.' };
    const action = { ...INVITE, label: 'Invite member', description: envelope };
    const localized = result.current.localize(undefined, action);
    expect(localized.description).toBe(envelope);
    expect(localized.description).toEqual({ dialect: 'template', source: 'Invite {{ record.name }} to the team.' });
  });

  it('a plain string comes back unchanged', () => {
    const result = harness('zh-CN');
    const localized = result.current.localize(undefined, {
      ...INVITE,
      description: 'We e-mail them an invitation link.',
    });
    expect(localized.description).toBe('We e-mail them an invitation link.');
  });

  it('an action with no description gains no key, nameless or named', () => {
    const result = harness('zh-CN', {
      sys: { globalActions: { invite_member: { description: '来自翻译包的说明' } } },
    });
    const nameless = result.current.localize(undefined, INVITE);
    const named = result.current.localize(undefined, { ...INVITE, name: 'invite_member' });
    expect('description' in nameless).toBe(false);
    expect('description' in named).toBe(false);
  });
});
