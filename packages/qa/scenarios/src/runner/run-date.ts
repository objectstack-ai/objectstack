// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A card's dates rebased onto the day it runs.
 *
 * A card fixes its "today" (`asOf`) and writes every seed row, truth and
 * expected value around it. The app it runs against stamps `created_at` /
 * `updated_at` with the real clock, so a run weeks after `asOf` shows the
 * agent seeded rows "created" after the day the prompt calls today, and an
 * agent that notices stops to ask. {@link rebaseScenario} moves the card
 * instead: every date it holds moves by ONE whole-day delta, `runDate − asOf`,
 * before the run seeds anything. The prompt's "today", the seeded rows, the
 * record timestamps the app stamps and the grader's expectations then agree.
 *
 * Whole days, not calendar months: the delta is a count of days added through
 * UTC date arithmetic, so a month end, Feb 29 and a year boundary are plain
 * days, every interval between two of the card's dates is kept exactly (a
 * due date two weeks out stays two weeks out, a `last_days` window holds the
 * same rows), and `asOf` lands on the run date itself. A `calendar` window
 * (`this_month`, `previous_month`, …) is re-read around the new `asOf`: the
 * truths are computed again over the moved seed ({@link truthsOver}), so the
 * figure the grader holds is the one the moved data gives. Weekday names in
 * an ask are written again for the moved date.
 *
 * Working days: a whole-day delta that is not whole weeks puts a Monday-to-
 * Friday date on a weekend, so a leave request's days, the balances they come
 * off and an ask that names "Wednesday" change meaning. A card that declares
 * `workingDays: true` keeps every date it holds, but its today, on a working
 * day (the loader refuses one that does not), and moves them by whole WORKING
 * days instead ({@link shiftWorkingDays}): `asOf` still lands on the run date
 * itself, a date before it lands on or before the run date and a date after it
 * after the run date, consecutive working days stay consecutive, and N working
 * days between two dates stay N. The run date may be a weekend: the card's
 * other dates then move as they would for the Friday before it. A whole-week
 * delta would keep the weekdays too, but only by putting the prompt's today up
 * to three days off the run date, the very mismatch this rebase removes.
 *
 * What moves: `asOf`; every value under `run` and `iterate` that is an ISO date
 * (`YYYY-MM-DD`) or starts with one (an ISO date-time keeps its time); and the
 * dates an operation's or question's `ask` writes in its text — ISO dates,
 * English `[Weekday] D Month [YYYY]` and `Month D[, YYYY]`, and Chinese
 * `[M 月 ]D 日[(周X)]`. A text date with no year is read in the year that puts
 * it nearest the card's `asOf`; a Chinese day with no month takes the month of
 * the date before it in the same text, else the `asOf` month. The card's build
 * prompt and comments are not touched: a rule such as "the leave year starts
 * on 1 July" is not a date the run lives on.
 *
 * The card file is never changed; the loaded card is copied.
 */

import type { LoadedScenario } from '../loader.js';
import { truthsOver } from '../loader.js';

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?=$|T)/;

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZH_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** A valid calendar date `YYYY-MM-DD` as UTC midnight, or `undefined`. */
function parseDay(y: number, m: number, d: number): Date | undefined {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t : undefined;
}

function ymd(t: Date): string {
  return t.toISOString().slice(0, 10);
}

function dayOf(iso: string): Date {
  const m = ISO_DATE.exec(iso);
  const t = m ? parseDay(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
  if (!t) throw new Error(`not an ISO date: ${JSON.stringify(iso)}`);
  return t;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / DAY_MS);
}

/** `date` (`YYYY-MM-DD`, or an ISO date-time whose time is kept) moved by `days` whole days. */
export function shiftDate(date: string, days: number): string {
  return ymd(new Date(dayOf(date).getTime() + days * DAY_MS)) + date.slice(10);
}

/** Whether `t` (UTC midnight) is a working day, Monday to Friday; public holidays are out of scope. */
function isWorkingDay(t: Date): boolean {
  const w = t.getUTCDay();
  return w !== 0 && w !== 6;
}

/** Whether `date` (`YYYY-MM-DD`, or an ISO date-time) falls on a working day, Monday to Friday. */
export function onWorkingDay(date: string): boolean {
  return isWorkingDay(dayOf(date));
}

// Working days are counted from Monday 1969-12-29, the Monday before the epoch (a Thursday).
/** The working-day number of `t`, or of the working day before it when `t` is a weekend. */
function workingDayNumber(t: Date): number {
  const n = Math.round(t.getTime() / DAY_MS) + 3; // days since Monday 1969-12-29
  const week = Math.floor(n / 7);
  return week * 5 + Math.min(n - week * 7, 4);
}

/** The working day numbered `k` ({@link workingDayNumber}). */
function workingDay(k: number): Date {
  const week = Math.floor(k / 5);
  return new Date((week * 7 + (k - week * 5) - 3) * DAY_MS);
}

/** Whole working days from `from` to `to`, each read as the working day on or before it. */
export function workingDaysBetween(from: string, to: string): number {
  return workingDayNumber(dayOf(to)) - workingDayNumber(dayOf(from));
}

/** `date`, a working day (`YYYY-MM-DD`, or an ISO date-time whose time is kept), moved by `days` whole working days. */
export function shiftWorkingDays(date: string, days: number): string {
  const t = dayOf(date);
  if (!isWorkingDay(t)) throw new Error(`not a working day: ${JSON.stringify(date)}`);
  return ymd(workingDay(workingDayNumber(t) + days)) + date.slice(10);
}

/** How a card's dates move: a day (UTC midnight) to the day it becomes. */
type Move = (t: Date) => Date;

/** Whether a card value is a date the rebase moves. */
function isDateValue(v: string): boolean {
  const m = ISO_DATE.exec(v);
  return !!m && parseDay(Number(m[1]), Number(m[2]), Number(m[3])) !== undefined && (v.length === 10 || /^T\d{2}:\d{2}/.test(v.slice(10)));
}

/** The date of month `m`, day `d` with no year, in the year nearest `anchor`. */
function nearestYear(m: number, d: number, anchor: Date): Date | undefined {
  let best: Date | undefined;
  for (const y of [anchor.getUTCFullYear() - 1, anchor.getUTCFullYear(), anchor.getUTCFullYear() + 1]) {
    const t = parseDay(y, m, d);
    if (t && (!best || Math.abs(t.getTime() - anchor.getTime()) < Math.abs(best.getTime() - anchor.getTime()))) best = t;
  }
  return best;
}

const EN_WEEKDAY = `(?:(${EN_WEEKDAYS.join('|')}),? )?`;
const EN_MONTH = `(${EN_MONTHS.join('|')})`;

/**
 * An ask's text with every date it writes moved, read around the card's `asOf`: by `move` whole days, or by
 * the card's own {@link Move} (the working-day rebase).
 */
export function shiftTextDates(text: string, move: number | Move, asOf: string): string {
  const anchor = dayOf(asOf);
  const moved: Move = typeof move === 'number' ? (t) => new Date(t.getTime() + move * DAY_MS) : move;
  const shift = (iso: string) => ymd(moved(dayOf(iso))) + iso.slice(10);

  // ISO dates.
  let out = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (all, y: string, m: string, d: string) =>
    parseDay(Number(y), Number(m), Number(d)) ? shift(all) : all,
  );

  // English "[Weekday] D Month [YYYY]" and "[Weekday, ]Month D[, YYYY]", in one pass so no date moves twice.
  const dayMonth = `${EN_WEEKDAY}(\\d{1,2}) ${EN_MONTH}(?: (\\d{4}))?`;
  const monthDay = `(?:(${EN_WEEKDAYS.join('|')}), )?${EN_MONTH} (\\d{1,2})(?:, (\\d{4}))?`;
  out = out.replace(
    new RegExp(`\\b(?:${dayMonth}|${monthDay})\\b`, 'g'),
    (all, wd1?: string, d1?: string, mon1?: string, y1?: string, wd2?: string, mon2?: string, d2?: string, y2?: string) => {
      const first = d1 !== undefined;
      const [wd, d, mon, y] = first ? [wd1, d1, mon1!, y1] : [wd2, d2!, mon2!, y2];
      const m = EN_MONTHS.indexOf(mon) + 1;
      const t = y ? parseDay(Number(y), m, Number(d)) : nearestYear(m, Number(d), anchor);
      if (!t) return all;
      const n = moved(t);
      const [W, D, M, Y] = [EN_WEEKDAYS[n.getUTCDay()], n.getUTCDate(), EN_MONTHS[n.getUTCMonth()], n.getUTCFullYear()];
      return first ? `${wd ? `${W} ` : ''}${D} ${M}${y ? ` ${Y}` : ''}` : `${wd ? `${W}, ` : ''}${M} ${D}${y ? `, ${Y}` : ''}`;
    },
  );

  // Chinese "[M 月 ]D 日[(周X)]". A day with no month is a date only after a month-date in the same
  // text, or with its weekday; it takes the month of the date before it.
  let month: number | undefined;
  let movedMonth: number | undefined;
  let seps: [string, string] = [' ', ' '];
  out = out.replace(
    /(?:(\d{1,2})( ?)月( ?))?(\d{1,2})( ?)日(?:([(（])周[一二三四五六日]([)）]))?/g,
    (all, m: string | undefined, s1: string | undefined, s2: string | undefined, d: string, s3: string, open: string | undefined, close: string | undefined) => {
      if (m === undefined && month === undefined && open === undefined) return all;
      if (m !== undefined) {
        month = Number(m);
        seps = [s1 ?? '', s2 ?? ''];
      }
      const t = nearestYear(month ?? anchor.getUTCMonth() + 1, Number(d), anchor);
      if (!t) return all;
      const n = moved(t);
      const nm = n.getUTCMonth() + 1;
      // A day-only date stays day-only while it stays in the month the text last named.
      const head = m !== undefined || nm !== movedMonth ? `${nm}${seps[0]}月${seps[1]}` : '';
      movedMonth = nm;
      return `${head}${n.getUTCDate()}${s3}日${open ? `${open}周${ZH_WEEKDAYS[n.getUTCDay()]}${close}` : ''}`;
    },
  );
  return out;
}

/** `value` with every date in it moved; an `ask` object's texts are rewritten, every other string only when it IS a date. */
function shiftTree(value: unknown, move: Move, asOf: string, key?: string): unknown {
  if (typeof value === 'string') return isDateValue(value) ? ymd(move(dayOf(value))) + value.slice(10) : value;
  if (Array.isArray(value)) return value.map((v) => shiftTree(v, move, asOf));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === '$comment') out[k] = v;
    else if (key === 'ask' && typeof v === 'string') out[k] = shiftTextDates(v, move, asOf);
    else out[k] = shiftTree(v, move, asOf, k);
  }
  return out;
}

/**
 * How a card's dates move so `asOf` is `runDate`: by one whole-day delta, or, on a card that declares
 * `workingDays`, `asOf` onto `runDate` and every other date by whole working days ({@link shiftWorkingDays}).
 */
function moveFor(card: LoadedScenario['card'], asOf: string, runDate: string): Move {
  if (card.workingDays !== true) {
    const days = daysBetween(asOf, runDate);
    return (t) => new Date(t.getTime() + days * DAY_MS);
  }
  const [from, to] = [dayOf(asOf), dayOf(runDate)];
  const days = workingDaysBetween(asOf, runDate);
  return (t) => {
    if (t.getTime() === from.getTime()) return to;
    if (!isWorkingDay(t)) throw new Error(`card declares workingDays but holds ${ymd(t)}, a weekend`);
    return workingDay(workingDayNumber(t) + days);
  };
}

/**
 * `scenario` with its card's dates moved so `asOf` is `runDate`, and its truths
 * computed again over the moved seed. A card with no `asOf`, or one already on
 * `runDate`, is returned as it is. `scopeFigures` stay: both moves map distinct
 * dates to distinct dates (the working-day move keeps every date but `asOf` on
 * a working day, and `asOf` alone on the run date), so no count it holds moves.
 */
export function rebaseScenario(scenario: LoadedScenario, runDate: string): LoadedScenario {
  const { asOf } = scenario.card;
  if (asOf === undefined || daysBetween(asOf, runDate) === 0) return scenario;
  const move = moveFor(scenario.card, asOf, runDate);
  const card = {
    ...scenario.card,
    asOf: ymd(move(dayOf(asOf))),
    run: shiftTree(scenario.card.run, move, asOf) as LoadedScenario['card']['run'],
    iterate: shiftTree(scenario.card.iterate, move, asOf) as LoadedScenario['card']['iterate'],
  };
  return { ...scenario, card, ...truthsOver(card, card.run.seed) };
}
