// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A Brazilian Portuguese reader's Home feed names `sys_user` fields in
 * Portuguese (#30512) — the `pt-BR` twin of the #28107 `fr` test beside this
 * file, which carries the mechanism.
 *
 * Before `@objectstack/platform-objects` shipped `pt-BR`, this plugin's own
 * `pt-BR` catalog answered the frame while the field labels fell back to the
 * authored English ones, so the sentence read Portuguese glue around `Banned`
 * and `Ban Reason`. Here the i18n service holds what a booted kernel holds,
 * this plugin's bundle and the platform's Setup bundle in every locale each
 * ships, and the sentence is composed the way the feed's read composes it.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { SetupAppTranslations } from '@objectstack/platform-objects/apps';
import { SysUser } from '@objectstack/platform-objects/identity';

import { composeActivitySummary, readerSummaryLocale } from './activity-summary-message.js';
import type { ActivitySummaryMessage } from './activity-summary-message.js';
import { AuditTranslations } from './translations/index.js';

function bootedI18n() {
  const i18n = createMemoryI18n();
  for (const bundle of [AuditTranslations, SetupAppTranslations]) {
    for (const [locale, data] of Object.entries(bundle)) {
      i18n.loadTranslations(locale, data as Record<string, any>);
    }
  }
  return i18n;
}

const objectDef = (name: string) => (name === 'sys_user' ? SysUser : null);

/** The #27869 (b) walkthrough row: an admin banned Carl and gave a reason. */
const UPDATED_FIELDS: ActivitySummaryMessage = {
  key: 'activityUpdatedFields',
  object: 'sys_user',
  label: 'Carl Edited',
  fields: ['banned', 'ban_reason'],
  more: 0,
};

describe('Home feed — a pt-BR reader reads sys_user field labels in Portuguese (#30512)', () => {
  it('the platform Setup bundle ships pt-BR', () => {
    expect(Object.keys(SetupAppTranslations)).toContain('pt-BR');
  });

  it('a reader whose locale is pt-BR reads the fields in Portuguese, not in English', () => {
    const locale = readerSummaryLocale(bootedI18n(), 'pt-BR', objectDef);
    expect(locale?.locale).toBe('pt-BR');

    const summary = composeActivitySummary(UPDATED_FIELDS, locale!);
    expect(summary).toBe('Atualizou Usuário "Carl Edited": Banido e Motivo do banimento');
    expect(summary).not.toMatch(/Banned|Ban Reason/);
  });

  it('a tracked change names the field in Portuguese too', () => {
    const locale = readerSummaryLocale(bootedI18n(), 'pt-BR', objectDef)!;
    const summary = composeActivitySummary(
      {
        key: 'fieldChanges',
        object: 'sys_user',
        changes: [{ field: 'ban_reason', from: { text: 'spam' }, to: { text: 'abuse' } }],
      },
      locale,
    );
    expect(summary).toBe('Motivo do banimento: spam → abuse');
  });
});
