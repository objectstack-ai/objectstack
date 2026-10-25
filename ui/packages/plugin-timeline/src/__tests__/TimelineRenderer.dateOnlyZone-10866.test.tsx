/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866 — the timeline renderer's item date names the day a
 * date-only value stores, on each of its three faces, in every zone.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The renderer's `formatDate` parsed the item's date with the engine's own
 * `Date` parse, which reads a date-only `2026-10-06` as UTC midnight. Its
 * `short` face (the default) and its `long` face read the value with local
 * getters, so every viewer west of UTC saw October 5th. Its ISO face printed
 * `toISOString()`, which was right for a date-only value only because the
 * parse was UTC too: once the parse is local midnight, the same print names
 * the day before EAST of UTC. So the ISO rows below are green on the base as
 * well, on purpose: they are the half a parse-only repair would break.
 *
 * The parse is now the shared step, `toDisplayDate` (`@object-ui/core`, the
 * objectui#10183 convention). A date-only value prints its ISO day from local
 * getters; a value with a time part keeps its instant, and its ISO face keeps
 * the instant's UTC day. A value the shared step refuses (a day its month does
 * not have, objectui#10026) prints as written on the ISO face instead of
 * throwing, and the `short` / `long` faces give it the face they give any
 * unparsable value.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too.
 *
 * `Asia/Shanghai` is the control: east of UTC the UTC-midnight parse already
 * landed on the named day, and an hour-offset "repair" would break it.
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { TimelineRenderer } from '../renderer';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in October — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

const DAY = '2026-10-06';
/** A fixed instant: 21:00 on the 5th in the west, 12:00 on the 6th in the east. */
const INSTANT = '2026-10-06T04:00:00.000Z';

/** Move this forked process into `zone`. */
function enter(zone: string): void {
  process.env.TZ = zone;
}

afterEach(() => cleanup());

/** The date face the vertical renderer prints for one item dated `time`. */
function face(dateFormat: string, time: string): string {
  const { container } = render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <TimelineRenderer
        schema={{ type: 'timeline', variant: 'vertical', dateFormat, items: [{ time, title: 'Ship' }] } as never}
      />
    </LocalizationProvider>,
  );
  const text = container.querySelector('time')?.textContent ?? '';
  cleanup();
  return text;
}

describe('timeline item date, in the suite zone (objectui#10866)', () => {
  it('a date-only value prints the day it stores on every face', () => {
    expect(face('short', DAY)).toBe('10/6/2026');
    expect(face('long', DAY)).toBe('October 6, 2026');
    expect(face('iso', DAY)).toBe(DAY);
  });

  it('a day its month does not have is not rolled into March, and the ISO face prints it as written', () => {
    expect(face('short', '2026-02-30')).not.toBe('3/2/2026');
    expect(face('iso', '2026-02-30')).toBe('2026-02-30');
  });

  it('the ISO face prints an unparsable value as written rather than throwing', () => {
    expect(face('iso', 'not a date')).toBe('not a date');
  });
});

describe.runIf(DRIVEN)('timeline item date west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(21);
  });

  it('fixture validity: the engine parse of the string lands on the day before here', () => {
    enter(WEST);
    // Without this the cases below would be green for free.
    expect(new Date(DAY).getDate()).toBe(5);
  });

  it('`2026-10-06` prints October 6th on the short and long faces', () => {
    enter(WEST);
    expect(face('short', DAY)).toBe('10/6/2026');
    expect(face('long', DAY)).toBe('October 6, 2026');
  });

  it('`2026-10-06` prints itself on the ISO face', () => {
    enter(WEST);
    expect(face('iso', DAY)).toBe(DAY);
  });

  it('control: an instant keeps its local day here, the 5th, and its ISO face keeps its UTC day', () => {
    enter(WEST);
    expect(face('short', INSTANT)).toBe('10/5/2026');
    expect(face('long', INSTANT)).toBe('October 5, 2026');
    expect(face('iso', INSTANT)).toBe('2026-10-06');
  });
});

describe.runIf(DRIVEN)('timeline item date east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  it('`2026-10-06` prints October 6th on the short and long faces, as it already did', () => {
    enter(EAST);
    expect(face('short', DAY)).toBe('10/6/2026');
    expect(face('long', DAY)).toBe('October 6, 2026');
  });

  it('`2026-10-06` prints itself on the ISO face, not the day before', () => {
    enter(EAST);
    expect(face('iso', DAY)).toBe(DAY);
  });

  it('control: an instant keeps its local day here, the 6th, and its ISO face keeps its UTC day', () => {
    enter(EAST);
    expect(face('short', INSTANT)).toBe('10/6/2026');
    expect(face('long', INSTANT)).toBe('October 6, 2026');
    expect(face('iso', INSTANT)).toBe('2026-10-06');
  });
});
