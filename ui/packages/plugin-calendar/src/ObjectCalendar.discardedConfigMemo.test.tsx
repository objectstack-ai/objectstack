/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6592 — see `ObjectMap.discardedConfigMemo.test.tsx` for the full
 * rationale (`useMemo` carries no semantic guarantee, so a fetch effect
 * keyed on `dataConfig`'s object identity is correct only for as long as
 * that identity happens to survive). This file pins the same contract for
 * `ObjectCalendar`'s record-fetch effect.
 *
 * `ObjectCalendar`'s own `dataConfig` memo is ALREADY keyed on primitives
 * (`schema.data` / `schema.staticData` / `schema.objectName` — objectui#6018),
 * so the map/tree discard proxy ("a schema with a new reference but equal
 * `objectName`") does not even recompute `dataConfig` here: those three deps
 * would all compare equal and the memo would keep its old cached object. The
 * discard proxy for THIS component instead varies `schema.data` itself — one
 * of the memo's OWN deps — across two object literals that carry the SAME
 * `provider`/`object` but a different reference, which forces the recompute
 * (`(schema as any).data` is compared by Object.is, not by value) while
 * leaving every primitive the fetch effect reads unchanged. That is the same
 * "different identity, same content" shape a genuine memo-cache discard
 * would produce.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { resolveRecordSourceConfig } from '@object-ui/core';
import { ObjectCalendar } from './ObjectCalendar';

afterEach(cleanup);

const today = new Date();
const dayInThisMonth = (d: number) => new Date(today.getFullYear(), today.getMonth(), d, 9, 0, 0, 0);

const ROWS = [{ id: 'v1', name: 'Site visit', starts_at: dayInThisMonth(10).toISOString() }];

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'visit', fields: {} }),
  } as any;
}

const CALENDAR = { startDateField: 'starts_at', titleField: 'name' };

describe('ObjectCalendar — record-fetch effect survives a discarded `dataConfig` memo (objectui#6592)', () => {
  it('does not re-fire the fetch when `dataConfig` recomputes to a new identity with the SAME primitive fields', async () => {
    const dataSource = makeDataSource();
    // Two different SCHEMA object references, byte-identical content — enough to
    // force `dataConfig`'s own memo to recompute to a NEW config object while
    // `provider`/`object` stay unchanged, which is the condition this file is
    // about.
    //
    // Spelled through `objectName` rather than `data: { provider: 'object',
    // object: 'visit' }` since objectui#8348: `ComponentPropsMap`'s
    // `object-calendar.data` row is `z.array(...)`, so the config OBJECT is no
    // longer a record source on this block and the ladder resolves rung 3
    // instead. Rung 3 builds `{ provider: 'object', object: 'visit' }` FRESH on
    // every call, so the discarded-memo condition is reproduced exactly as
    // before — the resolved config is identical and only its identity moves.
    const schemaA: any = { type: 'object-calendar', calendar: CALENDAR, objectName: 'visit' };
    const schemaB: any = { type: 'object-calendar', calendar: CALENDAR, objectName: 'visit' };
    // ⛔ The instrument check this file rests on: the two schemas really are
    // distinct references carrying equal content, so a re-render with the second
    // one really does hand the memo a changed dependency.
    expect(schemaA).not.toBe(schemaB);
    expect(schemaA).toEqual(schemaB);
    expect(resolveRecordSourceConfig(schemaA, 'array')).not.toBe(
      resolveRecordSourceConfig(schemaB, 'array'),
    );
    expect(resolveRecordSourceConfig(schemaA, 'array')).toEqual(
      resolveRecordSourceConfig(schemaB, 'array'),
    );

    const { rerender } = render(<ObjectCalendar schema={schemaA} dataSource={dataSource} />);
    await waitFor(() => expect(screen.getByText('Site visit')).toBeTruthy());
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());

    const findCallsAtRest = dataSource.find.mock.calls.length;
    const schemaCallsAtRest = dataSource.getObjectSchema.mock.calls.length;
    expect(findCallsAtRest).toBeGreaterThan(0);

    rerender(<ObjectCalendar schema={schemaB} dataSource={dataSource} />);
    await new Promise((r) => setTimeout(r, 0));

    expect(dataSource.find.mock.calls.length).toBe(findCallsAtRest);
    expect(dataSource.getObjectSchema.mock.calls.length).toBe(schemaCallsAtRest);
  });

  it('still DOES re-fire when the recomputed `dataConfig` carries a genuinely different `object`', async () => {
    const dataSource = makeDataSource();
    const schemaA: any = { type: 'object-calendar', objectName: 'visit', calendar: CALENDAR };
    const schemaB: any = { type: 'object-calendar', objectName: 'appointment', calendar: CALENDAR };

    const { rerender } = render(<ObjectCalendar schema={schemaA} dataSource={dataSource} />);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalledWith('visit', expect.any(Object)));
    const callsBefore = dataSource.find.mock.calls.length;

    rerender(<ObjectCalendar schema={schemaB} dataSource={dataSource} />);

    await waitFor(() => expect(dataSource.find.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(dataSource.find).toHaveBeenCalledWith('appointment', expect.any(Object));
  });
});
