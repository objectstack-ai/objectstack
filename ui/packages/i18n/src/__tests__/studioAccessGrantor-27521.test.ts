/**
 * objectstack#27521 (Studio row 38) — the Studio access refusal says who
 * grants access.
 *
 * A member who opened a Studio URL read "You need Studio access to open
 * Studio." and nothing about where that access comes from. The `en` and `zh`
 * sentences now name an administrator and Setup's Permission Sets; the other
 * packs keep their sentence until a translator adds the clause.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

const sentence = (lang: 'en' | 'zh') =>
  (builtInLocales[lang] as unknown as { console: { studio: { accessRequired: string } } }).console.studio.accessRequired;

describe('the Studio access refusal names who grants it (objectstack#27521)', () => {
  it('en: an administrator, in Setup → Permission Sets', () => {
    expect(sentence('en')).toMatch(/^You need Studio access to open Studio\./u);
    expect(sentence('en')).toMatch(/administrator/u);
    expect(sentence('en')).toMatch(/Permission Sets/u);
  });

  it('zh: 管理员，在「设置 → 权限集」', () => {
    expect(sentence('zh')).toMatch(/管理员/u);
    expect(sentence('zh')).toMatch(/权限集/u);
  });
});
