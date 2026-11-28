// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `appManagement.editWithAi` and `appManagement.editWithAiNamed` are retired
 * from every locale pack (objectstack#37752).
 *
 * The console's app management page drew an "Edit with AI" button on every
 * packaged app that opened the build agent, which is retired. The button is
 * gone, and these two labels were its only readers.
 *
 * The i18n gates run call site → key, so a key with no reader is never visited
 * and one returning to every pack keeps parity green: this pin is the only
 * thing that goes red if they come back (the `common-search-retired-4392`
 * reasoning).
 */
import { describe, it, expect } from 'vitest';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];
const RETIRED = ['editWithAi', 'editWithAiNamed'] as const;
const appManagementOf = (lang: LocaleCode) =>
  (builtInLocales[lang] as unknown as { appManagement?: Record<string, unknown> }).appManagement;

describe('`appManagement.editWithAi*` is retired (objectstack#37752)', () => {
  it('no pack defines either key, and every pack keeps the row action neighbours', () => {
    expect(LANGS).toHaveLength(PLATFORM_LOCALE_TAGS.length);
    const revived: string[] = [];
    for (const lang of LANGS) {
      const ns = appManagementOf(lang);
      expect(ns, `${lang} lost the appManagement root`).toBeDefined();
      for (const key of RETIRED) {
        if (ns && key in ns) revived.push(`${lang} :: appManagement.${key}`);
      }
      // The row actions the deletion swept around.
      for (const key of ['editApp', 'editAppNamed', 'enableApp', 'disableApp']) {
        expect(typeof ns?.[key], `${lang} :: appManagement.${key}`).toBe('string');
      }
    }
    expect(revived, 'an "Edit with AI" label is back in a pack; the app list opens no build agent').toEqual([]);
  });
});
