// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29690 — the one Chinese step every Studio create door takes
 * before it derives an identifier from a display name (`romanizeHan`).
 *
 * The cases run in file order on purpose: the first describe reads the module
 * BEFORE the pinyin dictionary is loaded (its state is module-wide, as it is
 * in the Console), the rest after `loadHanRomanizer()` resolved. The door
 * sanitizers are the real ones, so each expectation is the identifier a door
 * offers, not an intermediate string.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { loadHanRomanizer, romanizeHan, romanizerPending } from './romanizeHan';
import { toFieldName, toFieldNameLoose, toFieldNameOrEmpty } from './previews/object-fields-io';
import { slugify } from './createDerive';

/** What a field-name door offers for `label`. */
const fieldName = (label: string) => toFieldNameLoose(romanizeHan(label).trim());

describe('romanizeHan before the dictionary has loaded', () => {
  it('returns the text unchanged and reports the Chinese text as pending', () => {
    expect(romanizeHan('维修中心')).toBe('维修中心');
    expect(romanizerPending('维修中心')).toBe(true);
  });

  it('is never pending for text that needs no dictionary', () => {
    expect(romanizerPending('Repair Center')).toBe(false);
    expect(romanizerPending('カスタマー')).toBe(false);
    expect(romanizerPending('顧客リスト')).toBe(false);
    expect(romanizerPending('')).toBe(false);
  });
});

describe('romanizeHan once the dictionary has loaded (objectstack#29690)', () => {
  it('loads, and nothing is pending any more', async () => {
    await loadHanRomanizer();
    expect(romanizerPending('维修中心')).toBe(false);
  });

  it('derives one snake_case identifier per Chinese word, through every field-name sanitizer', () => {
    expect(fieldName('维修中心')).toBe('weixiu_zhongxin');
    expect(fieldName('客户等级')).toBe('kehu_dengji');
    expect(toFieldNameOrEmpty(romanizeHan('客户等级'))).toBe('kehu_dengji');
    expect(toFieldName(romanizeHan('客户等级'))).toBe('kehu_dengji');
    expect(slugify(romanizeHan('客户等级'))).toBe('kehu_dengji');
  });

  it('reads a polyphone by its word: 银行 and 行动 read 行 differently', () => {
    expect(fieldName('银行')).toBe('yinhang');
    expect(fieldName('行动')).toBe('xingdong');
  });

  it('writes ü as v, so no sanitizer splits the syllable', () => {
    expect(fieldName('绿色')).toBe('lvse');
  });

  it('keeps Latin words and digits where they were', () => {
    expect(fieldName('Repair Center')).toBe('repair_center');
    expect(fieldName('维修Center 2号')).toBe('weixiu_center_2_hao');
  });

  it('leaves Japanese (kana-bearing) text alone, so its door still asks for the identifier', () => {
    expect(romanizeHan('顧客リスト')).toBe('顧客リスト');
    expect(fieldName('顧客リスト')).toBe('');
  });
});

describe('romanizeHan where the runtime has no Intl.Segmenter', () => {
  const intl = Intl as unknown as { Segmenter?: unknown };
  const original = intl.Segmenter;
  afterEach(() => {
    intl.Segmenter = original;
  });

  it("joins each character's reading with `_`, still reading polyphones in context", async () => {
    await loadHanRomanizer();
    intl.Segmenter = undefined;
    expect(fieldName('客户等级')).toBe('ke_hu_deng_ji');
    expect(fieldName('银行')).toBe('yin_hang');
  });
});
