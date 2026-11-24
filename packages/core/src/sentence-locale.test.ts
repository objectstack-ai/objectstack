// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { pickSentenceLocale } from './sentence-locale.js';

describe('[#35138] pickSentenceLocale — the language of a sentence in a tool result', () => {
  const WRITTEN = ['en', 'zh-Hans', 'zh-Hant', 'ja'] as const;

  it('reads each code whole, then one subtag shorter, and takes the first language the producer writes', () => {
    expect(pickSentenceLocale(['zh-CN'], WRITTEN)).toBe('zh-Hans');
    expect(pickSentenceLocale(['zh-TW'], WRITTEN)).toBe('zh-Hant');
    expect(pickSentenceLocale(['zh-Hant-HK'], WRITTEN)).toBe('zh-Hant');
    expect(pickSentenceLocale(['fr-FR', 'ja-JP'], WRITTEN)).toBe('ja');
    // Not in the table whole: named by a shorter prefix.
    expect(pickSentenceLocale(['ja-JP-u-ca-japanese'], WRITTEN)).toBe('ja');
    expect(pickSentenceLocale(['zh-Hans-SG-x-a'], WRITTEN)).toBe('zh-Hans');
  });

  it('a language the producer does not write takes the next rung, and `en` is the floor', () => {
    expect(pickSentenceLocale(['zh-CN'], ['en', 'ja'] as const)).toBe('en');
    expect(pickSentenceLocale(['fr-FR', undefined, ''], WRITTEN)).toBe('en');
    expect(pickSentenceLocale([], WRITTEN)).toBe('en');
  });
});
