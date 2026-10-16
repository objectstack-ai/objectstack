// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { PlatformTranslationDataSchema, type PlatformTranslationBundle } from './translation.zod';
import { resolveSettingsBannerText, resolveSettingsBannerTitle } from './i18n-resolver';

/**
 * The `info_banner` slot of the platform settings translation group:
 * `settings.<namespace>.banners.<banner_id>.{title,text}`, keyed by the
 * specifier's `id`, beside `groups` / `keys` / `actions`.
 */
describe('settings.<namespace>.banners — the info_banner translation slot', () => {
  const banners = {
    beta_notice: { title: '注意', text: 'Beta 功能可能随时变更。' },
  };

  it('accepts a banner title and text on the platform face', () => {
    const result = PlatformTranslationDataSchema.safeParse({ settings: { feature_flags: { banners } } });
    expect(result.success).toBe(true);
  });

  it.each([
    ['the specifier spelling `bannerText`', { bannerText: 'x' }, 'text'],
    ['the specifier spelling `label`', { label: 'x' }, 'title'],
    ['the group body spelling `description`', { description: 'x' }, 'text'],
  ])('refuses %s on a banner and names the leaf that holds it', (_what, leaf, expected) => {
    const result = PlatformTranslationDataSchema.safeParse({
      settings: { feature_flags: { banners: { beta_notice: leaf } } },
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path).toEqual(['settings', 'feature_flags', 'banners', 'beta_notice']);
    expect(issue?.message).toContain(`→ \`${expected}\``);
  });

  it('refuses the singular `banner` group and names `banners`', () => {
    const result = PlatformTranslationDataSchema.safeParse({
      settings: { feature_flags: { banner: banners } },
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue?.path).toEqual(['settings', 'feature_flags']);
    expect(issue?.message).toContain('→ `banners`');
  });
});

describe('resolveSettingsBannerTitle / resolveSettingsBannerText', () => {
  const bundle: PlatformTranslationBundle = {
    'zh-CN': {
      settings: {
        feature_flags: { banners: { beta_notice: { title: '注意', text: 'Beta 功能可能随时变更。' } } },
      },
    },
  };

  it('resolves the requested locale', () => {
    const opts = { locale: 'zh-CN' };
    expect(resolveSettingsBannerTitle(bundle, 'feature_flags', 'beta_notice', 'Heads up', opts)).toBe('注意');
    expect(resolveSettingsBannerText(bundle, 'feature_flags', 'beta_notice', 'Beta features…', opts))
      .toBe('Beta 功能可能随时变更。');
  });

  it('walks the declared fallback chain when the requested locale has no entry', () => {
    const opts = { locale: 'ja-JP', fallbackChain: ['zh-CN'] };
    expect(resolveSettingsBannerTitle(bundle, 'feature_flags', 'beta_notice', 'Heads up', opts)).toBe('注意');
    expect(resolveSettingsBannerText(bundle, 'feature_flags', 'beta_notice', 'Beta features…', opts))
      .toBe('Beta 功能可能随时变更。');
  });

  it('falls back to the manifest literal when no locale in the chain has the banner', () => {
    const opts = { locale: 'ja-JP' };
    expect(resolveSettingsBannerTitle(bundle, 'feature_flags', 'beta_notice', 'Heads up', opts)).toBe('Heads up');
    expect(resolveSettingsBannerText(bundle, 'feature_flags', 'beta_notice', 'Beta features…', opts))
      .toBe('Beta features…');
    expect(resolveSettingsBannerText(bundle, 'feature_flags', 'other_notice', undefined, { locale: 'zh-CN' }))
      .toBeUndefined();
    expect(resolveSettingsBannerTitle(undefined, 'feature_flags', 'beta_notice', 'Heads up')).toBe('Heads up');
  });
});
