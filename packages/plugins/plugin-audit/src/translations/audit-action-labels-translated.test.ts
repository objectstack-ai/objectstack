// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every audit action is named in the reader's language.
 *
 * `sys_audit_log.action` options are what Setup shows for each audit row: the
 * list, the detail and the System Overview "Audit Events by Action" chart and
 * table. A new action joins the enum writer-first, and `os i18n extract` fills
 * each translated locale with the English label as a placeholder. Nothing else
 * goes red on that fill: `check:i18n` compares key sets, `check:i18n-coverage`
 * counts a present leaf as translated, and `check:i18n-stale-fill` only sees a
 * copy of a PREVIOUS source revision. So five actions (`credential_use` among
 * them) read in English under zh-CN and every other translated locale.
 *
 * Judged on what the plugin SERVES (`AuditTranslations`), against the labels
 * the object declares, so a sixth action added without its translations reds
 * here. A label whose correct spelling in a language IS the English word is
 * listed in SAME_SPELLING with that locale; nothing else may equal the source.
 */

import { describe, it, expect } from 'vitest';
import { AuditTranslations } from './index.js';
import { SysAuditLog } from '../objects/sys-audit-log.object.js';

type ObjectsData = Record<string, { fields?: Record<string, { options?: Record<string, string> }> }>;

const actionOptions = (SysAuditLog as unknown as {
  fields: { action: { options: Array<{ label: string; value: string }> } };
}).fields.action.options;

/** Locale → action values whose translation is spelled like the English label. */
const SAME_SPELLING: Record<string, readonly string[]> = {
  fr: ['import', 'export'],
  de: ['import', 'export'],
};

const servedActionLabels = (locale: string): Record<string, string> =>
  ((AuditTranslations[locale] as { objects?: ObjectsData }).objects ?? {}).sys_audit_log?.fields?.action?.options ?? {};

const translatedLocales = Object.keys(AuditTranslations).filter((l) => l !== 'en');

describe('sys_audit_log action labels are translated in every shipped locale', () => {
  it('reads a real enum and a real locale set', () => {
    expect(actionOptions.length).toBeGreaterThanOrEqual(19);
    expect(translatedLocales).toEqual(
      expect.arrayContaining(['zh-CN', 'ja-JP', 'es-ES', 'zh-Hant', 'ar', 'fr', 'pt-BR', 'ru', 'de', 'ko']),
    );
  });

  it('zh-CN names credential_use in Chinese, not as the English source', () => {
    const served = servedActionLabels('zh-CN').credential_use;
    expect(served).toMatch(/[一-鿿]/);
    expect(served).not.toBe('Credential Use');
  });

  for (const locale of translatedLocales) {
    it(`${locale} serves no action label equal to its English source`, () => {
      const served = servedActionLabels(locale);
      const allowed = new Set(SAME_SPELLING[locale] ?? []);
      const english = actionOptions
        .filter((o) => !allowed.has(o.value))
        .filter((o) => (served[o.value] ?? o.label) === o.label)
        .map((o) => `${o.value} = ${served[o.value] ?? '(missing)'}`);
      expect(english, `${locale} serves these audit actions in English`).toEqual([]);
    });
  }
});
