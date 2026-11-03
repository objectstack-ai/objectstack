/**
 * objectstack#27521 (Studio row 38) — the Studio access refusal says who
 * grants access.
 *
 * A member who opened a Studio URL read "You need Studio access to open
 * Studio." and nothing about where that access comes from. The `en` and `zh`
 * sentences now name an administrator and the Setup page where a set is
 * assigned: Permission Set Assignment, since Setup's Permission Sets catalog
 * moved into Studio (objectstack#28578).
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

const sentence = (lang: 'en' | 'zh') =>
  (builtInLocales[lang] as unknown as { console: { studio: { accessRequired: string } } }).console.studio.accessRequired;

describe('the Studio access refusal names who grants it (objectstack#27521)', () => {
  it('en: an administrator, in Setup → Permission Set Assignment', () => {
    expect(sentence('en')).toMatch(/^You need Studio access to open Studio\./u);
    expect(sentence('en')).toMatch(/administrator/u);
    expect(sentence('en')).toMatch(/Setup → Permission Set Assignment/u);
  });

  it('zh: 管理员，在「设置 → 权限集分配」', () => {
    expect(sentence('zh')).toMatch(/管理员/u);
    expect(sentence('zh')).toMatch(/设置 → 权限集分配/u);
  });
});
