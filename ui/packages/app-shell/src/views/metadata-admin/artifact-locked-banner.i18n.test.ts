/**
 * F6 (objectui#1926): a user's own object, after publishing it to a project
 * package, used to be told it was "shipped by a code package" — misleading,
 * with no stated edit path. This pins the corrected wording in both locales:
 * accurate ("installed package") and actionable ("republish" / 重新发布).
 */
import { describe, it, expect } from 'vitest';
import { t } from './i18n';

describe('artifactLockedBanner wording — F6', () => {
  it('[en] is accurate (not "shipped by a code package") and states the edit path', () => {
    const msg = t('engine.edit.artifactLockedBanner', 'en');
    expect(msg).not.toMatch(/shipped by a code package/i);
    expect(msg).toMatch(/installed package/i);
    expect(msg).toMatch(/republish/i);
  });

  it('[zh] is accurate (not 由代码包提供) and states the edit path', () => {
    const msg = t('engine.edit.artifactLockedBanner', 'zh');
    expect(msg).not.toMatch(/由代码包提供/);
    expect(msg).toMatch(/已安装的包/);
    expect(msg).toMatch(/重新发布/);
  });
});
