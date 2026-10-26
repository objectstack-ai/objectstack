/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866, slice 5 — `invertTo` / `invertFrom`, the exact inverses of
 * the business-zone shim that `ObjectGantt` hands a date-only day through.
 *
 * A real shim reads the two zones' offsets through `Intl` and the process
 * zone, which the normal run pins to UTC; the zone pin
 * `ObjectGantt.zonedDstDay-10866` drives real zones in a forked child. These
 * cases hand the inverses a STEP shim instead, built on the shape a real shim
 * takes for an `America/Los_Angeles` viewer of an `America/New_York` chart on
 * March 8th, 2026: the offset is +3 h, +4 h from 07:00Z (New York changes) and
 * +3 h again from 10:00Z (Los Angeles changes). So every branch is reached in
 * any zone, with exact numbers.
 */

import { describe, expect, it } from 'vitest';
import { invertFrom, invertTo } from '../tzShift';

const H = 3_600_000;
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 2, 8, hour, minute));

/**
 * A shim whose offset is `before` until `from`, `during` until `until`, then
 * `before` again. Its `delta` is non-zero, as every real shim's is but the
 * identity's.
 */
function stepShim(before: number, during: number, from: Date, until: Date) {
  const offset = (d: Date) => (d >= from && d < until ? during : before);
  return {
    delta: during,
    to: (d: Date) => new Date(d.getTime() + offset(d)),
    from: (d: Date) => new Date(d.getTime() - offset(d)),
    now: () => new Date(),
  };
}

const LA_VIEWER_NY_CHART = stepShim(3 * H, 4 * H, at(7), at(10));

describe('invertTo (objectui#10866)', () => {
  it("finds the instant `to` maps exactly onto a display midnight the shim's own round trip misses", () => {
    const shift = LA_VIEWER_NY_CHART;
    const midnight = at(8); // March 8th, 00:00 in Los Angeles
    // The round trip lands an hour early: 23:00 of the day before.
    expect(shift.to(shift.from(midnight))).toEqual(at(7));
    const handed = invertTo(shift, midnight);
    expect(handed).toEqual(at(5)); // 00:00 in New York
    expect(shift.to(handed)).toEqual(midnight);
  });

  it('is the first guess wherever the round trip is already exact', () => {
    const shift = LA_VIEWER_NY_CHART;
    const noon = at(20);
    expect(invertTo(shift, noon)).toEqual(shift.from(noon));
  });

  it('where `to` skips the target, takes the instant it maps one step later, still on that day', () => {
    // A chart zone whose clock steps forward an hour exactly at the viewer's
    // midnight (08:00Z): `to` maps x before 08:00Z to x, and x from 08:00Z on
    // to x + 1 h, so no instant is drawn in [08:00Z, 09:00Z).
    const gapped = stepShim(0, H, at(8), at(20));
    const midnight = at(8);
    expect(gapped.to(at(7, 59))).toEqual(at(7, 59));
    expect(gapped.to(at(8))).toEqual(at(9));
    expect(gapped.to(invertTo(gapped, midnight))).toEqual(at(9));
  });
});

describe('invertFrom (objectui#10866)', () => {
  it("recovers the display midnight `from` was handed, where the shim's `to` lands on the day before", () => {
    const shift = LA_VIEWER_NY_CHART;
    const emitted = shift.from(at(8)); // a drop onto March 8th's display midnight
    expect(emitted).toEqual(at(4));
    expect(shift.to(emitted)).toEqual(at(7)); // 23:00 on March 7th: the old write
    expect(invertFrom(shift, emitted)).toEqual(at(8));
  });

  it('where `from` maps two display instants onto one, takes the later', () => {
    const shift = LA_VIEWER_NY_CHART;
    // 06:30Z (offset +3 h) and 07:30Z (offset +4 h) both translate to 03:30Z.
    expect(shift.from(at(6, 30))).toEqual(at(3, 30));
    expect(shift.from(at(7, 30))).toEqual(at(3, 30));
    expect(invertFrom(shift, at(3, 30))).toEqual(at(7, 30));
  });
});

describe('the identity shim (objectui#10866)', () => {
  it('hands the date back unchanged both ways', () => {
    const identity = { delta: 0, to: (d: Date) => d, from: (d: Date) => d };
    const d = at(8);
    expect(invertTo(identity, d)).toBe(d);
    expect(invertFrom(identity, d)).toBe(d);
  });
});
