/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry, toDisplayDate } from '@object-ui/core';
import type { CalendarSchema } from '@object-ui/types';
import { Calendar } from '../../ui';

/**
 * One authored day, as `DayPicker` compares it (objectui#10293). JSON authors
 * an ISO 8601 string and `DayPicker` compares `Date`s, so a string is coerced
 * here, through the shared parse step: a date-only string is rebuilt at LOCAL
 * midnight of the day it names, where the engine's own parse read it as UTC
 * midnight and selected the day before west of UTC (the objectui#10183
 * convention). A `Date` passes unchanged; anything else is no day.
 */
function toDay(value: unknown): Date | undefined {
  if (typeof value === 'string') return toDisplayDate(value);
  return value instanceof Date ? value : undefined;
}

/**
 * The selection read (objectui#10304). `DayPicker` reads one day in `single`
 * mode, a list in `multiple` mode and `{ from, to }` in `range` mode, which is
 * the shape `CalendarSchema`'s mirror requires per mode; every day inside is
 * coerced through {@link toDay}.
 *
 * A value whose shape does not fit its mode is refused at authoring time by
 * that mirror. One that reaches the renderer anyway selects nothing — it is
 * NOT reshaped into the mode's form (a lone day is not wrapped into a list),
 * which would make an off-contract document work (AGENTS.md #0.1). Selecting
 * nothing replaces the crash `multiple` mode hit on a lone day.
 */
function toSelection(mode: string, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (mode === 'multiple') {
    return Array.isArray(value) ? value.map(toDay).filter((day): day is Date => day !== undefined) : undefined;
  }
  if (mode === 'range') {
    if (typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return undefined;
    const { from, to } = value as { from?: unknown; to?: unknown };
    return { from: toDay(from), to: toDay(to) };
  }
  return toDay(value);
}

/**
 * The month the calendar opens on (objectui#10799): the first selected day —
 * the day itself in `single` mode, the first valid listed day in `multiple`
 * mode, `from` in `range` mode. react-day-picker opens on `month`, else
 * `defaultMonth`, else today, and `selected` does not move it, so a selection
 * outside the current month used to open a page, or a year, away from it.
 *
 * A day that names no instant (an unparseable string, which {@link toDay}
 * turns into an Invalid Date) is no selected day: react-day-picker throws a
 * `RangeError` on an invalid `defaultMonth`, where the same day as `selected`
 * selects nothing. So a list whose first entry is unparseable opens on the
 * next valid one, and no selected day opens on today, as it always did.
 *
 * ⚠️ Read once, at mount: react-day-picker seeds its month from
 * `defaultMonth` when it mounts and does not follow later changes to it, and
 * this calendar is inline, not in a popover that remounts. A `value` that
 * changes after mount does not move the month the calendar shows.
 */
function firstSelectedDay(selection: unknown): Date | undefined {
  const isDay = (day: unknown): day is Date => day instanceof Date && !Number.isNaN(day.getTime());
  if (Array.isArray(selection)) return selection.find(isDay);
  const day = selection instanceof Date ? selection : (selection as { from?: unknown } | undefined)?.from;
  return isDay(day) ? day : undefined;
}

ComponentRegistry.register('calendar',
  ({ schema, className, ...props }: { schema: CalendarSchema; className?: string; [key: string]: any }) => {
    const mode = schema.mode || 'single';
    const selected = toSelection(mode, schema.value || schema.defaultValue);
    return (
      <Calendar
        mode={mode as any}
        selected={selected as any}
        defaultMonth={firstSelectedDay(selected)}
        className={className}
        {...props}
      />
    );
  },
  {
    namespace: 'ui',
    // `calendar` collides with the plugin-calendar full CRUD calendar VIEW,
    // which owns the bare `type: 'calendar'` schema keyword; this date-picker
    // primitive is reached via `ui:calendar` only.
    skipFallback: true,
    label: 'Calendar',
    inputs: [
      // Exactly the modes `CalendarSchema.mode` admits (objectui#10377). The
      // designer used to offer `'default'` too, which both authoring faces
      // refuse; `DayPicker` has no such mode and drops the selection under it.
      { name: 'mode', type: 'enum', enum: ['single', 'multiple', 'range'] },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      mode: 'single',
      className: 'rounded-md border'
    }
  }
);
