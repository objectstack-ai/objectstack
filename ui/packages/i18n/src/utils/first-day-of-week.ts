/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The first day of the week for a BCP-47 locale tag (objectui#11675).
 *
 * The first day of the week follows the user's locale, as dates, times and
 * numbers do (ruling B on objectui#11675: there is no separate week-start
 * setting). So a week grid, a weekday header row and a "this week" bound all
 * read it from the tag they already format with, and never from a hard-coded
 * Sunday or Monday: `en-US` starts on Sunday, `en-GB` and `zh-CN` on Monday.
 *
 * ## The engine's own week info comes first
 *
 * `Intl.Locale` carries CLDR's week data for the tag's region, including a
 * `-u-fw-` keyword on the tag. It has two spellings: the `getWeekInfo()` method
 * of the current Intl Locale Info proposal, and the `weekInfo` accessor engines
 * shipped first. Both are read, the method first. Measured while writing this:
 * Chromium 141 has both, Node 22 (the test and CI runtime) has the accessor
 * only. Both count ISO weekdays, 1 (Monday) to 7 (Sunday).
 *
 * ## Where the engine has none, CLDR's table answers
 *
 * An engine with neither spelling gets {@link NON_MONDAY_REGIONS}: CLDR's
 * `weekData` `firstDay` rows, read by region. The region is the tag's own, or
 * the one CLDR's likely subtags give it (`Intl.Locale.prototype.maximize`), so
 * `en` reads `US` and `zh` reads `CN`. A region the table does not list, and a
 * tag with no region even after `maximize()`, reads Monday, CLDR's world
 * default (`001`). This path reads the region only: a `-u-fw-` or `-u-rg-`
 * keyword is the engine path's alone.
 *
 * The table transcribes ONE CLDR release, the one {@link WEEK_DATA_CLDR} names:
 * the newest release the repository's CI runtime ships. Engines carry their own
 * week data, and it differs: CLDR moves a region now and then, and a browser
 * may carry data of its own. That is why the engine's answer wins wherever
 * there is one. What re-derives the table against the running engine is
 * `__tests__/firstDayOfWeek-11675.test.ts`, region by region. On a runtime
 * whose CLDR release is not the table's, it reads that release's recorded
 * differences from the table instead of reporting them as drift.
 *
 * ## A tag `Intl` refuses is refused here too
 *
 * A malformed tag throws `Intl.Locale`'s `RangeError`, as `Intl.DateTimeFormat`
 * and `toLocaleDateString` do for the same tag. Every caller formats its dates
 * with the tag it hands this function, so a tag that reached here and is
 * malformed fails the caller's own formatting the same way. ⛔ No Sunday or
 * Monday is guessed for it.
 */

/** A weekday as `Date.prototype.getDay` numbers it: 0 is Sunday, 6 is Saturday. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The part of the engine's week info this function reads. */
interface WeekInfoReading {
  readonly firstDay: number;
}

/**
 * The two spellings of `Intl.Locale`'s week info. Neither is in the `ES2020`
 * lib this package compiles against, and an engine may have either, both or
 * neither, so both are optional.
 */
interface LocaleWeekInfoFaces {
  getWeekInfo?: () => WeekInfoReading;
  readonly weekInfo?: WeekInfoReading;
}

/** ISO weekday 1 (Monday) to 7 (Sunday), as a {@link WeekdayIndex}. */
const BY_ISO_WEEKDAY: readonly WeekdayIndex[] = [1, 2, 3, 4, 5, 6, 0];

function fromIsoWeekday(day: number): WeekdayIndex | undefined {
  return Number.isInteger(day) && day >= 1 && day <= 7 ? BY_ISO_WEEKDAY[day - 1] : undefined;
}

/**
 * The CLDR release {@link NON_MONDAY_REGIONS} transcribes, as the major part of
 * `process.versions.cldr`. Change it only together with the table, from a
 * runtime that ships that release.
 */
export const WEEK_DATA_CLDR = '48';

/**
 * CLDR's `weekData` `firstDay` rows other than Monday, by region, as of the
 * release {@link WEEK_DATA_CLDR} names. Regions are the canonical codes
 * `Intl.Locale` reports (`BU` reads `MM`), so the deprecated aliases CLDR also
 * lists are left out.
 */
const NON_MONDAY_REGIONS: ReadonlyArray<readonly [WeekdayIndex, string]> = [
  [
    0,
    'AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN IS JM JP KE KH KR LA MH MM MO MT MX ' +
      'MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW',
  ],
  [5, 'MV'],
  [6, 'AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY'],
];

/** CLDR's world default (`001`): the week starts on Monday. */
const WORLD_FIRST_DAY: WeekdayIndex = 1;

const FIRST_DAY_BY_REGION: ReadonlyMap<string, WeekdayIndex> = new Map(
  NON_MONDAY_REGIONS.flatMap(([day, regions]) => regions.split(' ').map((region) => [region, day] as const)),
);

function engineFirstDay(locale: Intl.Locale): WeekdayIndex | undefined {
  const faces: Intl.Locale & LocaleWeekInfoFaces = locale;
  if (typeof faces.getWeekInfo === 'function') return fromIsoWeekday(faces.getWeekInfo().firstDay);
  const info = faces.weekInfo;
  return info ? fromIsoWeekday(info.firstDay) : undefined;
}

function tableFirstDay(locale: Intl.Locale): WeekdayIndex {
  const region = locale.region ?? locale.maximize().region;
  return (region !== undefined ? FIRST_DAY_BY_REGION.get(region) : undefined) ?? WORLD_FIRST_DAY;
}

/**
 * The first day of the week in `locale`, numbered as `Date.prototype.getDay`
 * numbers weekdays (0 is Sunday), which is also what react-day-picker's
 * `weekStartsOn` takes. Read the module header for where the answer comes from.
 *
 * @example
 * firstDayOfWeek('en-US'); // 0, Sunday
 * firstDayOfWeek('en-GB'); // 1, Monday
 * firstDayOfWeek('zh-CN'); // 1, Monday
 */
export function firstDayOfWeek(locale: string): WeekdayIndex {
  const parsed = new Intl.Locale(locale);
  return engineFirstDay(parsed) ?? tableFirstDay(parsed);
}
