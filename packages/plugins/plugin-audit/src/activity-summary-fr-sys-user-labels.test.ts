// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A French reader's Home feed names `sys_user` fields in French (#28107).
 *
 * The Home feed lists `sys_activity` rows, and their summary is re-composed
 * for each reader in the locale the door resolved for them: the console sends
 * the signed-in user's `sys_user.locale` as `Accept-Language`, and
 * {@link readerSummaryLocale} negotiates it against the locales the `i18n`
 * service holds. The field names inside the sentence are looked up as
 * `objects.sys_user.fields.<field>.label` in that locale, and fall back to the
 * authored English label when the locale has none.
 *
 * Before `@objectstack/platform-objects` shipped `fr`, that lookup missed: this
 * plugin's own `fr` catalog answered the frame, so a user whose locale was `fr`
 * read `A modifié Utilisateur « Carl Edited » : Banned et Ban Reason` (French
 * glue, English field labels). Here the i18n service holds what a booted kernel
 * holds, this plugin's bundle and the platform's Setup bundle in every locale
 * each ships, and the sentence is composed the way the feed's read composes it.
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

describe('Home feed — a fr reader reads sys_user field labels in French (#28107)', () => {
  it('the platform Setup bundle ships fr', () => {
    expect(Object.keys(SetupAppTranslations)).toContain('fr');
  });

  for (const requested of ['fr', 'fr-FR']) {
    it(`a reader whose locale is ${requested} reads the fields in French, not in English`, () => {
      const locale = readerSummaryLocale(bootedI18n(), requested, objectDef);
      expect(locale?.locale).toBe('fr');

      const summary = composeActivitySummary(UPDATED_FIELDS, locale!);
      expect(summary).toBe('A modifié Utilisateur « Carl Edited » : Banni et Motif du bannissement');
      expect(summary).not.toMatch(/Banned|Ban Reason/);
    });
  }

  it('a tracked change names the field in French too', () => {
    const locale = readerSummaryLocale(bootedI18n(), 'fr', objectDef)!;
    const summary = composeActivitySummary(
      {
        key: 'fieldChanges',
        object: 'sys_user',
        changes: [{ field: 'ban_reason', from: { text: 'spam' }, to: { text: 'abuse' } }],
      },
      locale,
    );
    expect(summary).toBe('Motif du bannissement: spam → abuse');
  });

  it('control: the English reader still reads the authored labels', () => {
    const locale = readerSummaryLocale(bootedI18n(), 'en', objectDef)!;
    expect(composeActivitySummary(UPDATED_FIELDS, locale)).toBe('Updated User "Carl Edited": Banned and Ban Reason');
  });
});
