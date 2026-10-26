// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12724 — the step names in the build chat read as sentences in the
 * user's language, never as the tool's id.
 *
 * The ruling (cloud#2927 Target 3, 「同意」): "Tool display names … read as
 * sentences in the user's language (`todo.tool.ts` →「记下后续检查项」); a test
 * asserts no display name equals a tool id." The step names are the packs'
 * `chatbot.tool.*` values, looked up by `humanizeToolName`, so this is that
 * test, over every key every shipped pack carries.
 *
 * Its second assertion is what keeps `en` honest: before this card the `en`
 * values were byte-equal to `humanizeToolName`'s English title-caser on
 * purpose ("List objects"), which is the tool id with its underscores
 * replaced — the very reading the ruling retires. A value left at that output
 * is a step name nobody rewrote.
 */
import { describe, expect, it } from 'vitest';
import { builtInLocales } from '@object-ui/i18n/locales';
import { humanizeToolName } from '../tool-display.js';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

/** The pack's `chatbot.tool` block, reached through the one shape the reader uses. */
const toolsOf = (lang: LocaleCode): Record<string, string> =>
  (builtInLocales[lang] as { chatbot?: { tool?: Record<string, string> } }).chatbot?.tool ?? {};

describe('chatbot.tool.* values are sentences, not tool ids (objectui#12724)', () => {
  it('reads every shipped pack, each with the same non-empty key set', () => {
    expect(LANGS).toHaveLength(10);
    const enKeys = Object.keys(toolsOf('en')).sort();
    expect(enKeys.length).toBeGreaterThan(0);
    for (const lang of LANGS) {
      expect(Object.keys(toolsOf(lang)).sort(), lang).toEqual(enKeys);
    }
  });

  it.each(LANGS)('%s: no value equals its tool id or the English title-caser of it', (lang) => {
    const offenders = Object.entries(toolsOf(lang)).filter(
      ([id, value]) => value === id || value === humanizeToolName(id),
    );
    expect(offenders, `${lang} chatbot.tool values that still read as the tool id`).toEqual([]);
  });

  it('zh: todo_write reads as the ruled sentence', () => {
    expect(toolsOf('zh').todo_write).toBe('记下后续检查项');
  });
});
