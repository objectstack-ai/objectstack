/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The business-time-zone shim `GanttView` renders through, in a module of its
 * own (objectui#10866).
 *
 * It moved out of `GanttView.tsx` unchanged, because `ObjectGantt` now asks it
 * too: a date-only day has to be handed to the view as the instant the shim
 * re-bases back onto that day (`readTaskDate` in `ObjectGantt.tsx`). The
 * `ObjectGantt` suites replace the `./GanttView` module with a probe
 * (`vi.mock('./GanttView', …)`), so an import of the shim from there is
 * undefined in each of them. `GanttView.tsx` re-exports `makeTzShift`, so its
 * existing import sites are unchanged.
 */

/** Offset (ms east of UTC) of an IANA time zone at a given instant. */
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const get = (type: string) => Number(dtf.formatToParts(at).find((p) => p.type === type)?.value ?? 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUTC - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * "Shifted clock" for business-time-zone rendering: translate
 * real instants into a display space where the browser's local clock reads
 * the CONFIGURED zone's wall time. All existing local-clock logic — shift
 * bands, day columns, snapping, the today line, date labels — then renders
 * that zone correctly for every viewer. `from` translates an emitted date
 * back into the real instant, which is what a `datetime` field persists.
 * `to` and `from` read each zone's offset at the instant they are handed, so
 * they are exact inverses except near a DST change of the configured zone or
 * the viewer's, where they can disagree by an hour: `to(from(midnight))` can
 * then be 23:00 of the day before. A `datetime` value takes the shim as it is.
 * A date-only value is a calendar day, not an instant (objectui#10866), so
 * `ObjectGantt` does not round-trip it: it hands the view the instant
 * {@link invertTo} finds for the day's local midnight, and writes a dropped
 * `date` field as the day of the display date {@link invertFrom} recovers,
 * never as an instant (`readTaskDate`, `toStoredDateValue`).
 */
export function makeTzShift(timeZone?: string): {
  delta: number;
  to: (d: Date) => Date;
  from: (d: Date) => Date;
  now: () => Date;
} {
  const identity = { delta: 0, to: (d: Date) => d, from: (d: Date) => d, now: () => new Date() };
  if (!timeZone) return identity;
  try {
    tzOffsetMs(timeZone, new Date()); // validate the IANA name early
  } catch {
    console.warn(`[GanttView] invalid timeZone "${timeZone}" — falling back to the browser zone`);
    return identity;
  }
  const deltaAt = (d: Date) => tzOffsetMs(timeZone, d) - -d.getTimezoneOffset() * 60000;
  const probe = deltaAt(new Date());
  if (probe === 0) return identity;
  return {
    delta: probe,
    to: (d: Date) => new Date(d.getTime() + deltaAt(d)),
    from: (d: Date) => new Date(d.getTime() - deltaAt(d)),
    now: () => new Date(Date.now() + deltaAt(new Date())),
  };
}

/** The part of a shim the two inverses below read. */
type Shim = Pick<ReturnType<typeof makeTzShift>, 'delta' | 'to' | 'from'>;

const HALF_HOUR_MS = 30 * 60_000;

/**
 * Solve `f(x) = target` for one direction of a shim, exactly (objectui#10866).
 *
 * Each direction is `f(x) = x + offset(x)`, where `offset` is the difference
 * of the two zones' offsets read AT `x`, so it steps only at a DST change of
 * either zone. The first guess is the round trip's own step,
 * `target - offset(target)`: exact everywhere except near such a change,
 * where `offset(x)` differs from `offset(target)` and the guess misses by the
 * step, typically an hour. So every value `offset` takes within three hours of
 * the guess is tried, and each `x = target - value` is kept when `f` maps it
 * EXACTLY onto `target`.
 *
 * `f` can map two instants an hour apart onto one target (a step up), or none
 * (the target falls in the hour a step skips). `prefer` picks among two:
 * `'any'` takes the first guess when it is exact, `'latest'` the later one. With
 * none, the candidate `f` maps soonest after `target` is taken: `target` moved
 * on by the step, where the target opens the skipped hour.
 */
function solveShim(f: (d: Date) => Date, target: Date, prefer: 'any' | 'latest'): Date {
  const t = target.getTime();
  const seen = new Map<number, number>();
  const at = (x: number): number => {
    let y = seen.get(x);
    if (y === undefined) {
      y = f(new Date(x)).getTime();
      seen.set(x, y);
    }
    return y;
  };
  const guess = t - (at(t) - t);
  if (prefer === 'any' && at(guess) === t) return new Date(guess);
  const candidates = new Set<number>([guess]);
  for (let k = -6; k <= 6; k++) {
    const x = guess + k * HALF_HOUR_MS;
    candidates.add(t - (at(x) - x));
  }
  const exact = [...candidates].filter((x) => at(x) === t).sort((a, b) => a - b);
  if (exact.length > 0) return new Date(prefer === 'latest' ? exact[exact.length - 1] : exact[0]);
  const after = [...candidates].filter((x) => at(x) > t).sort((a, b) => at(a) - at(b));
  return new Date(after.length > 0 ? after[0] : guess);
}

/**
 * The instant a shim's `to` maps EXACTLY onto `display`: how `ObjectGantt`
 * hands `GanttView` a date-only day, so the bar is drawn from that day's local
 * midnight in the view's display space on a DST day too (objectui#10866),
 * where `from(display)` is drawn from 23:00 of the day before or 01:00. When
 * `to` maps no instant onto that midnight (for example, the chart zone's
 * clocks change at 00:00 that day), an instant it maps a step later, 01:00 of
 * that day for an hour's step. The identity shim hands `display` back.
 */
export function invertTo(shift: Shim, display: Date): Date {
  return shift.delta === 0 ? display : solveShim(shift.to, display, 'any');
}

/**
 * The display-space `Date` a shim's `from` was handed, recovered EXACTLY from
 * the instant it returned: how `ObjectGantt` reads the day a `date` field was
 * dropped on (objectui#10866), where `to(instant)` can fall on 23:00 of the
 * day before. Where `from` maps two display instants an hour apart onto one
 * instant, the later is taken: the two sit on either side of the chart zone's
 * clock stepping forward against the viewer's, and when that step falls at a
 * display midnight, a day dropped there is the later one.
 * The identity shim hands `instant` back.
 */
export function invertFrom(shift: Shim, instant: Date): Date {
  return shift.delta === 0 ? instant : solveShim(shift.from, instant, 'latest');
}
