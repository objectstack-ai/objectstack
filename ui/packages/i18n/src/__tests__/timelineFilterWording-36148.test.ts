/**
 * objectstack#36148 — the record timeline's events chip has its own name, and
 * the Chinese stream says 动态, never 活动 (ruling 7074372050, option A).
 *
 * The 动态 tab's chips read 全部 · 事件 · 讨论 · 变更. 活动 is left to the app:
 * a CRM object named 活动 (meetings and calls) sits in the same tab row, and the
 * chip, the panel's one empty state and the stream's title used to say it too.
 * The events chip also differs from the tab word in every pack, so no pack names
 * the whole stream and one of its subsets with one word, and it never takes the
 * field-history chip's word (变更 / Changes, ruling 6649643659 on #30074).
 *
 * Values only: the keys are the ones the timeline already reads.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

type Pack = Record<string, unknown>;

const detail = (locale: string): Record<string, string> =>
  (builtInLocales[locale as keyof typeof builtInLocales] as unknown as Record<string, Pack>).detail as Record<
    string,
    string
  >;

/** The detail keys the record timeline's stream draws (its title, chips, empty and failure states). */
const STREAM_KEYS = [
  'activity',
  'timeline',
  'allActivity',
  'streamAll',
  'streamActivity',
  'streamDiscussion',
  'streamChanges',
  'noActivity',
  'activityAccessDenied',
  'activityLoadFailed',
  'filterActivity',
] as const;

const CHINESE = [
  { locale: 'zh-Hans', stream: '动态', events: '事件', empty: '暂无动态', banned: '活动' },
  { locale: 'zh-Hant', stream: '動態', events: '事件', empty: '暫無動態', banned: '活動' },
] as const;

describe('the record timeline says 动态, and its events chip 事件 (objectstack#36148)', () => {
  describe.each(CHINESE)('$locale', ({ locale, stream, events, empty, banned }) => {
    const pack = detail(locale);

    it(`no string the stream draws says ${banned}`, () => {
      const drawn = STREAM_KEYS.map((key) => [key, pack[key]] as const);
      expect(drawn.every(([, value]) => typeof value === 'string' && value.length > 0)).toBe(true);
      expect(drawn.filter(([, value]) => value.includes(banned))).toEqual([]);
    });

    it(`the chip reads ${events}, the empty state ${empty}, the title ${stream}`, () => {
      expect(pack.streamActivity).toBe(events);
      expect(pack.noActivity).toBe(empty);
      expect(pack.activity).toBe(stream);
      expect(pack.timeline).toBe(stream);
    });
  });

  it('en names the chip Events', () => {
    expect(detail('en').streamActivity).toBe('Events');
  });

  describe.each(Object.keys(builtInLocales))('%s', (locale) => {
    const pack = detail(locale);

    it('the events chip differs from the tab, the stream title and the field-history chip', () => {
      expect(pack.streamActivity).toBeTruthy();
      expect(pack.streamActivity).not.toBe(pack.timeline);
      expect(pack.streamActivity).not.toBe(pack.activity);
      expect(pack.streamActivity).not.toBe(pack.streamChanges);
    });
  });
});
