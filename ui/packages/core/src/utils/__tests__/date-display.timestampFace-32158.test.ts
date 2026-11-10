/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32158 — `formatDateTimeStamp`, the timestamp face: the compact
 * face's numeric date and 12-hour clock, to the second, in the display zone.
 *
 * A zh-CN reader saw `2026/11/10 上午7:03` in a grid cell beside
 * `2026/11/10 07:24:26` in the audit log: two clocks in one locale, because the
 * log formatted with the bare `Intl` default. The suite runs in UTC
 * (`vitest.config.mts`), so a declared display zone is the per-case input.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTimeCompactParts, formatDateTimeStamp, setDisplayTimeZone } from '../date-display';

const STORED = '2020-03-04T15:30:07.000Z';

afterEach(() => setDisplayTimeZone(undefined));

describe('formatDateTimeStamp (objectstack#32158)', () => {
  it('zh-CN: the 12-hour clock to the second, the clock a zh-CN grid cell paints', () => {
    const stamp = formatDateTimeStamp(STORED, { locale: 'zh-CN' });
    expect(stamp).toBe('2020/3/4 下午3:30:07');
    const cell = formatDateTimeCompactParts(STORED, { locale: 'zh-CN' });
    expect(stamp).toBe(`${cell?.date} ${cell?.time}:07`);
  });

  it('en: the face the audit log has always drawn, `toLocaleString` to the second', () => {
    expect(formatDateTimeStamp(STORED, { locale: 'en' })).toBe('3/4/2020, 3:30:07 PM');
    expect(formatDateTimeStamp(STORED, { locale: 'en' })).toBe(new Date(STORED).toLocaleString('en'));
  });

  it('renders in the declared display zone', () => {
    setDisplayTimeZone('Asia/Shanghai');
    expect(formatDateTimeStamp(STORED, { locale: 'zh-CN' })).toBe('2020/3/4 下午11:30:07');
    expect(formatDateTimeStamp(STORED, { locale: 'en' })).toBe('3/4/2020, 11:30:07 PM');
  });

  it('answers the dash for an empty or unparseable value', () => {
    expect(formatDateTimeStamp('', { locale: 'en' })).toBe('—');
    expect(formatDateTimeStamp('not a date', { locale: 'en' })).toBe('—');
  });
});
