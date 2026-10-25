/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One `lookupColumns` declaration, two surfaces, one answer — objectui#5492.
 *
 * Reported from a real 17.1.0 deployment. A form's lookup field offers two
 * ways to pick a related record:
 *
 *   the inline dropdown  — the quick-select popover under the field, and
 *   the browse-all picker — the RecordPickerDialog table behind "show all".
 *
 * Both read the SAME `lookupColumns` declaration, and they disagreed. The
 * picker resolved every cell through the type-aware cell renderer; the
 * dropdown printed the raw stored value into its option subtitle and
 * concatenated `label: String(rawValue)` into the row's `title` attribute. So
 * one declaration produced, side by side:
 *
 *   | column | dropdown (before)              | picker                |
 *   |--------|--------------------------------|-----------------------|
 *   | lookup | T5MsMCuwP4t_yUHq (bare FK id)  | the related record name |
 *   | date   | 2026-08-20T00:00:00.000Z (ISO) | a formatted date      |
 *   | select | pending (enum code)            | the authored option label |
 *
 * These tests pin the DISAGREEMENT rather than either surface alone: the same
 * declaration is driven through both, and the rendered values must match
 * column for column.
 *
 * They also pin the fallback. Both surfaces' queries now ask for `$expand` on
 * the reference columns they show (objectui#10223), but this file's backend
 * ignores that parameter and returns the bare foreign key, as any backend that
 * does not honour it would — and widening `lookupColumns` with
 * dot-path/populate semantics is explicitly NOT what fixes this — so a lookup
 * value can legitimately arrive as an unresolved foreign-key id. The rule is
 * that the dropdown adopts whatever the picker shows for it, and that the
 * column is never silently dropped: a held value keeps its slot and renders
 * the lookup cell renderer's own placeholder, because a blank column is worse
 * than a bare id (the field report records a dot-path attempt producing
 * exactly that silent-empty outcome).
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { LookupField } from './LookupField';
import { RecordPickerDialog } from './RecordPickerDialog';
import { getCellRenderer } from '../index';

/** The reporter's shape: a schedule row referencing a work step by bare id. */
const RESOLVABLE_STEP_ID = 'T5MsMCuwP4t_yUHq';
/** A second id nothing resolves — the unresolved-reference fallback pin. */
const UNRESOLVED_STEP_ID = 'Zz9QwErTyUiOpAsD';

const PLANNED_ISO = '2026-08-20T00:00:00.000Z';

const WORK_STEPS: Record<string, any> = {
  [RESOLVABLE_STEP_ID]: { id: RESOLVABLE_STEP_ID, name: 'Fitting, Line A' },
};

/**
 * The referenced object's schema. `lookupColumns` names four of its fields;
 * three of them are exactly the types the report calls out.
 */
const SCHEDULE_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  work_step: { type: 'lookup', label: 'Work Step', reference: 'work_steps' },
  planned_on: { type: 'date', label: 'Planned On', format: 'medium' },
  status: {
    type: 'select',
    label: 'Status',
    options: [
      { value: 'pending', label: 'Pending approval' },
      { value: 'done', label: 'Completed' },
    ],
  },
};

const LOOKUP_COLUMNS = ['name', 'work_step', 'planned_on', 'status'];

/** The non-display columns — the ones both surfaces must agree about. */
const COMPARED = ['work_step', 'planned_on', 'status'];

function makeSchedule(stepId: string) {
  return {
    id: 'sch_1',
    name: 'Line A retooling',
    work_step: stepId,
    planned_on: PLANNED_ISO,
    status: 'pending',
  };
}

function makeDataSource(rows: any[]) {
  return {
    find: vi.fn(async (objectName: string) => {
      if (objectName === 'work_steps') {
        return { data: Object.values(WORK_STEPS), total: Object.keys(WORK_STEPS).length };
      }
      return { data: rows, total: rows.length };
    }),
    findOne: vi.fn(async (objectName: string, id: any) => {
      if (objectName === 'work_steps') return WORK_STEPS[String(id)] ?? null;
      return rows.find((r) => r.id === id) ?? null;
    }),
    getObjectSchema: vi.fn(async (objectName: string) => {
      if (objectName === 'work_schedules') return { name: objectName, fields: SCHEDULE_FIELDS };
      if (objectName === 'work_steps') {
        return { name: objectName, fields: { name: { type: 'text', label: 'Name' } } };
      }
      return undefined;
    }),
  } as any;
}

/**
 * Flush the client-side id resolution both surfaces depend on: the referenced
 * object's schema fetch, then the lookup cell renderer's `findOne`, then the
 * re-render that carries the resolved name into the DOM. Macrotask flushes
 * rather than a `waitFor` predicate on purpose — the predicate would have to
 * encode the very answer under test, and a timeout would replace a readable
 * value diff with a timeout message.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/**
 * What one surface shows for one column: the rendered text, plus whether that
 * text came from the shared empty-value slot. Both matter — an unresolved
 * reference and an absent value can print the same glyph, and only one of them
 * is correct for a record that HOLDS a foreign key.
 */
type ColumnReading = { text: string; emptySlot: boolean; present: boolean };

function readColumns(selector: (field: string) => string): Record<string, ColumnReading> {
  const out: Record<string, ColumnReading> = {};
  for (const field of COMPARED) {
    const el = document.querySelector(selector(field));
    out[field] = {
      present: !!el,
      text: el ? (el.textContent ?? '') : '',
      emptySlot: !!el?.querySelector('[data-slot="empty-value"]'),
    };
  }
  return out;
}

/** Render the inline dropdown, open it, and read its rendered column values. */
async function readInlineDropdown(stepId: string): Promise<Record<string, ColumnReading>> {
  const rows = [makeSchedule(stepId)];
  const dataSource = makeDataSource(rows);
  render(
    <SchemaRendererContext.Provider value={{ dataSource } as any}>
      <LookupField
        value={undefined}
        onChange={() => {}}
        dataSource={dataSource}
        field={{
          reference: 'work_schedules',
          display_field: 'name',
          // The spec's spelling, the only one the widget reads (objectui#12157).
          lookupColumns: LOOKUP_COLUMNS,
        } as never}
      />
    </SchemaRendererContext.Provider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('lookup-trigger'));
  });
  await waitFor(() => expect(screen.getByText('Line A retooling')).toBeInTheDocument());
  await settle();
  const values = readColumns((f) => `[data-lookup-preview="${f}"]`);
  cleanup();
  return values;
}

/** Render the browse-all picker over the same declaration and read its cells. */
async function readBrowseAllPicker(stepId: string): Promise<Record<string, ColumnReading>> {
  const rows = [makeSchedule(stepId)];
  const dataSource = makeDataSource(rows);
  render(
    <SchemaRendererContext.Provider value={{ dataSource } as any}>
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={dataSource}
        objectName="work_schedules"
        displayField="name"
        columns={LOOKUP_COLUMNS}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={SCHEDULE_FIELDS}
      />
    </SchemaRendererContext.Provider>,
  );
  await waitFor(() => expect(screen.getByText('Line A retooling')).toBeInTheDocument());
  await settle();
  const values = readColumns((f) => `[data-lookup-cell="${f}"]`);
  cleanup();
  return values;
}

afterEach(cleanup);

describe('LookupField — inline dropdown agrees with the browse-all picker (objectui#5492)', () => {
  it('renders lookup, date and select columns identically on both surfaces', async () => {
    const dropdown = await readInlineDropdown(RESOLVABLE_STEP_ID);
    const picker = await readBrowseAllPicker(RESOLVABLE_STEP_ID);

    // The whole card: one declaration must not produce two answers.
    expect(dropdown).toEqual(picker);

    // …and the answer both give is the RENDERED one, not the stored one.
    expect(dropdown.work_step.text).toBe('Fitting, Line A');
    expect(dropdown.work_step.text).not.toBe(RESOLVABLE_STEP_ID);

    expect(dropdown.planned_on.text).not.toBe(PLANNED_ISO);
    expect(dropdown.planned_on.text).not.toContain('T00:00:00');
    expect(dropdown.planned_on.text.trim()).not.toBe('');

    expect(dropdown.status.text).toBe('Pending approval');
    expect(dropdown.status.text).not.toBe('pending');
  });

  it('keeps an unresolved reference visible, and shows what the picker shows', async () => {
    const dropdown = await readInlineDropdown(UNRESOLVED_STEP_ID);
    const picker = await readBrowseAllPicker(UNRESOLVED_STEP_ID);

    // This backend ignores `$expand` and serves the bare key, so an id that
    // resolves to nothing is a legitimate state. Whatever it renders, it renders
    // the picker's answer — the two surfaces do not get to disagree here either.
    expect(dropdown).toEqual(picker);

    // The column must still be THERE, and it must not have degraded into the
    // shared empty-value slot. A dot-path declaration produces an undefined
    // read and a silently empty column; that outcome is worse than showing the
    // bare id, and these three lines are what keep the fix away from it. What
    // renders instead is the lookup cell renderer's own placeholder for a
    // reference that is present but not nameable — the picker's long-standing
    // answer, which the dropdown now adopts rather than re-deciding.
    expect(dropdown.work_step.present).toBe(true);
    expect(dropdown.work_step.emptySlot).toBe(false);
    expect(dropdown.work_step.text.trim()).not.toBe('');

    // The sibling columns are unaffected by the unresolved reference.
    expect(dropdown.status.text).toBe('Pending approval');
    expect(dropdown.planned_on.text).not.toBe(PLANNED_ISO);
  });
});
