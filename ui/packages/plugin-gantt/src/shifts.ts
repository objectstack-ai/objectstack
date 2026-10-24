/**
 * Shift segmentation (shift bands / rostering) for the Gantt — pure,
 * side-effect-free helpers.
 *
 * A factory's day is split into named time bands (day shift 08:00–20:00, night
 * shift 20:00–08:00 the next day). The Gantt is positioned in continuous
 * milliseconds, so a band is just a recurring time window; this module turns a
 * declarative config into a normalized model the renderer can lay columns and
 * snap drags against.
 *
 * Two ideas make cross-midnight shifts a non-problem:
 *
 *   - **Shift-day:** the "day" column does NOT start at calendar
 *     midnight but at the configured `dayStart` (e.g. 08:00) and runs a full 24h
 *     to the next `dayStart`. A night shift that crosses 00:00 therefore sits
 *     wholly inside one shift-day column instead of straddling two date cells.
 *
 *   - **Attribution by start:** a record belongs to the shift-day that contains
 *     its START instant. A night shift starting 6/4 20:00 belongs to 6/4 even
 *     though it ends 6/5 08:00. {@link shiftDayStart} / {@link bandAt} encode
 *     this.
 *
 * Bands are laid out by *cumulative duration* from `dayStart`, never by absolute
 * clock math, so a band whose `end` < `start` (crosses midnight) needs no
 * special-casing — its duration is `(end - start + 24h) mod 24h`.
 */

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;
const MINS_PER_DAY = 24 * 60;

/** Declarative band as authored in the view config. */
export interface ShiftBandConfig {
  /** Stable identifier (e.g. 'day' / 'night'); defaults to `band{index}`. */
  key?: string;
  /** Display label ('Day shift' / 'Night shift') — already localized by the caller. */
  label: string;
  /** Band start, 'HH:mm' (24h). */
  start: string;
  /** Band end, 'HH:mm'. When `end <= start` the band crosses midnight. */
  end: string;
  /** Optional accent color (any CSS color) for the column tint. */
  color?: string;
}

/** Declarative shift config attached to a Gantt view (`gantt.timeSegments`). */
export interface ShiftSegmentsConfig {
  /**
   * Clock time the shift-day begins, 'HH:mm'. The day column starts here and
   * runs 24h. Defaults to '00:00' (calendar day). For an 08:00 handover set '08:00'.
   */
  dayStart?: string;
  /** Ordered bands covering the 24h shift-day, beginning at `dayStart`. */
  bands: ShiftBandConfig[];
  /**
   * Draw the dashed calendar-midnight (00:00) cue inside cross-midnight
   * bands. Defaults to `true`; set `false` to hide it.
   */
  showMidnight?: boolean;
}

/** Normalized band — duration in ms, ready for column layout. */
export interface NormShiftBand {
  key: string;
  label: string;
  color?: string;
  /** Band length in ms (cross-midnight resolved). */
  durMs: number;
}

/** Normalized shift model produced by {@link normalizeShiftSegments}. */
export interface NormShiftSegments {
  /** Minutes after local midnight the shift-day starts (08:00 → 480). */
  dayStartMin: number;
  /** Bands in order from `dayStart`; durations sum to ~24h. */
  bands: NormShiftBand[];
  /** Whether to draw the dashed calendar-midnight cue. Default true. */
  showMidnight: boolean;
}

/** Parse 'HH:mm' → minutes after midnight, or null when malformed. */
export function parseHHMM(value: string | undefined | null): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Turn a declarative config into the normalized model, or return null when the
 * config is absent or invalid (no usable bands). Bands are laid out by
 * cumulative duration so a cross-midnight band (`end <= start`) is handled
 * uniformly; a band with `end === start` is treated as a full 24h slot.
 */
export function normalizeShiftSegments(
  cfg: ShiftSegmentsConfig | null | undefined,
): NormShiftSegments | null {
  if (!cfg || !Array.isArray(cfg.bands) || cfg.bands.length === 0) return null;
  const dayStartMin = parseHHMM(cfg.dayStart) ?? 0;
  const bands: NormShiftBand[] = [];
  for (let i = 0; i < cfg.bands.length; i++) {
    const b = cfg.bands[i];
    const s = parseHHMM(b.start);
    const e = parseHHMM(b.end);
    if (s == null || e == null || !b.label) return null;
    const durMin = ((e - s + MINS_PER_DAY) % MINS_PER_DAY) || MINS_PER_DAY;
    bands.push({
      key: b.key ?? `band${i}`,
      label: b.label,
      color: b.color,
      durMs: durMin * MS_PER_MIN,
    });
  }
  return { dayStartMin, bands, showMidnight: cfg.showMidnight !== false };
}

/**
 * Floor an instant to the start of the shift-day that contains it — the most
 * recent moment whose local time-of-day equals `dayStartMin`. For dayStart
 * 08:00, anything from 08:00 today up to (but not including) 08:00 tomorrow maps
 * to today's 08:00.
 */
export function shiftDayStart(date: Date, dayStartMin: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(dayStartMin);
  if (d.getTime() > date.getTime()) d.setDate(d.getDate() - 1);
  return d;
}

/**
 * The band a START instant falls into, by cumulative duration from its
 * shift-day start. Used both to tint/label columns and to derive the band of a
 * record (the night/day band of `startDateField`). Returns null only for an
 * empty model.
 */
export function bandAt(date: Date, seg: NormShiftSegments): NormShiftBand | null {
  if (seg.bands.length === 0) return null;
  const base = shiftDayStart(date, seg.dayStartMin).getTime();
  const offset = date.getTime() - base;
  let acc = 0;
  for (const b of seg.bands) {
    acc += b.durMs;
    if (offset < acc) return b;
  }
  return seg.bands[seg.bands.length - 1];
}

export { MS_PER_DAY as SHIFT_MS_PER_DAY };
