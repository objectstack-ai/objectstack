// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36373 — a label box reads and writes the CURRENT language
 * (`servedLabel.ts`).
 *
 * The rules, each pinned below:
 *
 *  - The box shows the served text while the buffer still holds the authored
 *    value the server translated; an edited buffer, or a served text that is
 *    the source itself, shows the buffer.
 *  - An edit typed over a translation of a plain-string label stores the inline
 *    locale map `{ default: SOURCE, LANG: EDIT }`: the source is byte-identical,
 *    so every other language reads what it read before (the server half of that
 *    promise is `packages/spec/src/system/i18n-report.test.ts`).
 *  - A map label writes its own language's entry and keeps every other one.
 *  - The clear removes this language's own entry; a borrowed translation has
 *    no entry, so clearing it leaves the label as authored.
 *  - ⛔ The served text is never stored as the source.
 */

import { describe, it, expect } from 'vitest';
import { shownLabel, writtenLabel, type ServedLabelPair } from './servedLabel';

const SOURCE = 'Opportunities by Stage';
const ZH = '各阶段商机';
const served: ServedLabelPair = { authored: SOURCE, served: ZH };

describe('shownLabel — the box reads the session language (objectstack#36373)', () => {
  it('an untouched buffer shows the served translation', () => {
    expect(shownLabel(SOURCE, served, 'zh-CN')).toBe(ZH);
  });

  it('an edited buffer shows itself, not the translation of what it was', () => {
    expect(shownLabel('Deals by stage', served, 'zh-CN')).toBe('Deals by stage');
  });

  it('a served text that is the source itself shows the buffer (an en session)', () => {
    expect(shownLabel(SOURCE, { authored: SOURCE, served: SOURCE }, 'en-US')).toBe(SOURCE);
  });

  it('no pair: the buffer in the session language, as before', () => {
    expect(shownLabel(SOURCE, null, 'zh-CN')).toBe(SOURCE);
    expect(shownLabel({ en: SOURCE, 'zh-CN': ZH }, null, 'zh-CN')).toBe(ZH);
  });

  it('a map buffer equal to the authored map shows the served text', () => {
    const map = { en: SOURCE, 'zh-CN': '旧的中文' };
    expect(shownLabel(map, { authored: { ...map }, served: ZH }, 'zh-CN')).toBe(ZH);
  });
});

describe('writtenLabel — an edit lands in its own language (objectstack#36373)', () => {
  it('an edit over a translation stores { default: SOURCE, zh-CN: EDIT }, the source byte-identical', () => {
    const next = writtenLabel(SOURCE, served, 'zh-CN', '商机阶段分布', '');
    expect(next).toEqual({ default: SOURCE, 'zh-CN': '商机阶段分布' });
    expect((next as Record<string, string>).default).toBe(SOURCE);
    // ⛔ the served text is never the stored source.
    expect(JSON.stringify(next)).not.toContain(ZH);
  });

  it('a map label writes its own entry and keeps every other language', () => {
    const map = { en: SOURCE, ja: '段階別の商談', 'zh-CN': ZH };
    expect(writtenLabel(map, { authored: map, served: ZH }, 'zh-CN', '新名称', '')).toEqual({
      en: SOURCE,
      ja: '段階別の商談',
      'zh-CN': '新名称',
    });
  });

  it('a box that showed the source writes the source, as before', () => {
    expect(writtenLabel(SOURCE, { authored: SOURCE, served: SOURCE }, 'en-US', 'Deals by stage', '')).toBe(
      'Deals by stage',
    );
    expect(writtenLabel(SOURCE, null, 'en-US', 'Deals by stage', '')).toBe('Deals by stage');
  });

  it('clearing a borrowed translation leaves the label as authored', () => {
    expect(writtenLabel(SOURCE, served, 'zh-CN', '', '')).toBe(SOURCE);
  });

  it("clearing a map's own entry removes it; the last entry gone is the caller's empty", () => {
    expect(writtenLabel({ default: SOURCE, 'zh-CN': '新' }, null, 'zh-CN', '', '')).toEqual({ default: SOURCE });
    expect(writtenLabel({ 'zh-CN': '新' }, null, 'zh-CN', '', undefined)).toBeUndefined();
    expect(writtenLabel(SOURCE, null, 'en-US', '', '')).toBe('');
  });

  it('a second edit after the first rewrites the same entry (the buffer is a map now)', () => {
    const first = writtenLabel(SOURCE, served, 'zh-CN', '一', '');
    // The buffer moved, so the box no longer reads the borrowed translation.
    expect(shownLabel(first, served, 'zh-CN')).toBe('一');
    expect(writtenLabel(first, served, 'zh-CN', '一二', '')).toEqual({ default: SOURCE, 'zh-CN': '一二' });
  });
});
