/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27521 — the keys the Invitations screens added: the workspace
 * cancel dialog's "Keep invitation", the plain sign-in page's hint to open the
 * invitation link, and the accept page's "you joined" state. Every pack carries
 * each key, translated, with the English placeholders kept.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

const KEYS = [
  'organization.invitations.keepAction',
  'auth.login.invitationLinkHint',
  'organization.accept.joinedDescription',
  'organization.accept.continue',
] as const;

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');

const LANGS = Object.keys(builtInLocales) as Array<keyof typeof builtInLocales>;

describe('objectstack#27521 — the Invitations screens keys', () => {
  it('reads all ten packs (guards the loops from emptying)', () => {
    expect(LANGS).toHaveLength(10);
  });

  it.each(LANGS)('%s carries every key as a non-empty string', (lang) => {
    for (const key of KEYS) {
      const value = at(builtInLocales[lang], key);
      expect(typeof value, `${lang} :: ${key}`).toBe('string');
      expect((value as string).trim(), `${lang} :: ${key}`).not.toBe('');
    }
  });

  it.each(LANGS.filter((lang) => lang !== 'en'))('%s translates every key', (lang) => {
    for (const key of KEYS) {
      expect(at(builtInLocales[lang], key), `${lang} :: ${key}`).not.toBe(at(builtInLocales.en, key));
    }
  });

  it.each(LANGS)('%s keeps the placeholders of the English text', (lang) => {
    for (const key of KEYS) {
      expect(placeholders(at(builtInLocales[lang], key) as string), `${lang} :: ${key}`).toBe(
        placeholders(at(builtInLocales.en, key) as string),
      );
    }
  });
});
