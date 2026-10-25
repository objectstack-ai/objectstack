/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11693 — `LocalizationValue.timezone` reaches the date faces.
 *
 * `LocalizationProvider` is the one place the zone enters them: it hands
 * `value.timezone` to `setDisplayTimeZone` (`@object-ui/core`), and its
 * context carries the zone back only once the faces have it. The probe below
 * renders a datetime through the central face exactly as a cell does (locale
 * threaded, zone not), so these pin the whole hand-off, including the case
 * the console meets: the zone ARRIVES after the first render, when the
 * localization fetch answers.
 *
 * The suite runs in UTC (`vitest.config.mts`, objectui#8366), so UTC is the
 * viewer's zone here, and `America/Los_Angeles` a zone unlike it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { formatDateTime, getDisplayTimeZone, setDisplayTimeZone } from '@object-ui/core';
import { LocalizationProvider, useLocalization, type LocalizationValue } from '../LocalizationContext';

/** 03:00 on Sep 2nd in UTC, 20:00 on Sep 1st in Los Angeles. */
const INSTANT = '2026-09-02T03:00:00.000Z';
const WEST = 'America/Los_Angeles';

function Probe() {
  const { timezone } = useLocalization();
  return <span data-testid="probe">{`${timezone ?? '∅'}|${formatDateTime(INSTANT, { locale: 'en-US' })}`}</span>;
}

function renderWith(value: LocalizationValue) {
  return render(
    <LocalizationProvider value={value}>
      <Probe />
    </LocalizationProvider>,
  );
}

afterEach(() => {
  setDisplayTimeZone(undefined);
  vi.restoreAllMocks();
});

describe('LocalizationProvider hands the time zone to the date faces (objectui#11693)', () => {
  it('a zone unlike the viewer\'s: a datetime renders in the set zone', () => {
    renderWith({ locale: 'en-US', timezone: WEST });
    expect(screen.getByTestId('probe')).toHaveTextContent(`${WEST}|Sep 1, 2026, 08:00 PM`);
  });

  it('no zone: a datetime renders in the viewer\'s zone', () => {
    renderWith({ locale: 'en-US' });
    expect(screen.getByTestId('probe')).toHaveTextContent('∅|Sep 2, 2026, 03:00 AM');
  });

  it('a zone that arrives after the first render re-renders every consumer in it', () => {
    const { rerender } = renderWith({});
    expect(screen.getByTestId('probe')).toHaveTextContent('∅|Sep 2, 2026, 03:00 AM');
    rerender(
      <LocalizationProvider value={{ locale: 'en-US', timezone: WEST }}>
        <Probe />
      </LocalizationProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(`${WEST}|Sep 1, 2026, 08:00 PM`);
  });

  it('unmounting the provider clears the zone', () => {
    const { unmount } = renderWith({ timezone: WEST });
    expect(getDisplayTimeZone()).toBe(WEST);
    unmount();
    expect(getDisplayTimeZone()).toBeUndefined();
  });

  it('a name the runtime does not know reads back as no zone, and the faces stay in the viewer\'s', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith({ timezone: 'Middle/Earth' });
    expect(screen.getByTestId('probe')).toHaveTextContent('∅|Sep 2, 2026, 03:00 AM');
  });
});
