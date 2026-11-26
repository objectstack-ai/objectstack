// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The Studio app's display name (ADR-0084, the 2026-11-26 position amendment):
// a Chinese interface reads 应用搭建 and every other interface App Studio. Only
// display text moved — the app's name, its `/studio` address and every
// identifier stay `studio`.
//
// The served bundle is what is judged here, not the hand-authored pack: a
// translation whose recorded source hash disagrees with the current `en` source
// is replaced by that source on the way out (`withSourceFallback`), so a
// re-translated label whose digest was not re-recorded would serve the English
// name in the Chinese UI while every pack still read correctly.

import { describe, expect, it } from 'vitest';
import { STUDIO_APP } from '../studio.app.js';
import { SetupAppTranslations } from './setup.translation.js';

const CHINESE: Readonly<Record<string, string>> = {
  'zh-CN': '应用搭建',
  'zh-Hant': '應用搭建',
};

describe('Studio app display name', () => {
  it('keeps the identifier and renames only the label', () => {
    expect(STUDIO_APP.name).toBe('studio');
    expect(STUDIO_APP.label).toBe('App Studio');
  });

  it.each(Object.keys(SetupAppTranslations))('serves the ruled name in %s', (locale) => {
    const served = SetupAppTranslations[locale]?.apps?.studio?.label;
    expect(served).toBe(CHINESE[locale] ?? 'App Studio');
  });
});
