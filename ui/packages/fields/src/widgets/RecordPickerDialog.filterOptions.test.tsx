/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Record Picker FILTER PANEL — select filter inputs carry the schema's options
 * (#3336).
 *
 * #3333 fixed the picker's table CELLS: they now format through the referenced
 * object's schema `fields` map (`fieldsMeta`) plus the shared i18n option
 * translation, so a `select` column renders the authored option label instead
 * of title-casing the raw stored value.
 *
 * The filter panel is the other face of the same widget and was still broken.
 * `LookupField` turns each typed picker column into a `RecordPickerFilterColumn`
 * (`{ field, label, type: 'select' }`) with no `options`, and the panel's select
 * input renders `col.options?.map(...)` — so the dropdown opened EMPTY and the
 * column could not be filtered at all.
 *
 * ## What these cases assert, and in which direction
 *
 * - **The two reproducers (`renderFilterBar` slot + built-in panel DOM) were
 *   RED before the fix**: `options` was `undefined` and the dropdown rendered
 *   zero `option` roles.
 * - **The parity case is the load-bearing one.** It asserts the filter option
 *   label and the table cell for the SAME field are the same translated string,
 *   under an `I18nProvider` that translates `fieldOptions.<obj>.<field>.<value>`.
 *   That is what pins "one source" rather than "two derivations that happen to
 *   agree today" — a second, filter-only derivation reading `meta.options`
 *   directly would satisfy the label assertions but not this one.
 * - **Two cases are deliberate NO-OP pins, green before and after** (called out
 *   individually below): a schema field with no `options` still yields an empty
 *   dropdown (the fix adds no consumer-side leniency — no options synthesised
 *   from the loaded page's raw values), and explicitly authored filter options
 *   keep winning over the schema (including the `in`-operator options
 *   auto-derived from `lookupFilters`). They guard the precedence and the
 *   non-leniency the fix chose, not a defect it repaired.
 *
 * The second suite in this file covers #3422 — what the panel DOWNLOADS once an
 * option is picked. Having the right options to choose from (#3336) and sending
 * the right value for the chosen one are the two halves of the same control, so
 * they are pinned side by side; see that suite's own header for its directions.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { I18nProvider } from '@object-ui/i18n';
import { RecordPickerDialog } from './RecordPickerDialog';
import type { RecordPickerFilterBarProps } from './RecordPickerDialog';
import { LookupField } from './LookupField';
import { getCellRenderer } from '../index';

// Radix Select opens on pointer events happy-dom/jsdom do not implement.
beforeAll(() => {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: any = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  (window as any).PointerEvent = MockPointerEvent;
  (HTMLElement.prototype as any).hasPointerCapture = vi.fn();
  (HTMLElement.prototype as any).releasePointerCapture = vi.fn();
  (HTMLElement.prototype as any).scrollIntoView = vi.fn();
});

const projects = [
  { id: 'p1', name: 'Line A retooling', project_phase: 'manufacturing' },
];

/** The referenced object's schema `fields` map, as `getObjectSchema` returns it. */
const projectFields = {
  name: { type: 'text', label: 'Name' },
  project_phase: {
    type: 'select',
    label: 'Project Phase',
    options: [
      { label: '01 Initiation', value: 'initiation' },
      { label: '03 Manufacturing', value: 'manufacturing' },
    ],
  },
  // A select field the metadata author never gave options to.
  risk_level: { type: 'select', label: 'Risk Level' },
};

function makeDataSource() {
  const find = vi.fn(async () => ({ data: projects, total: projects.length }));
  const getObjectSchema = vi.fn(async () => ({
    name: 'projects',
    fields: projectFields,
    highlightFields: ['name', 'project_phase'],
  }));
  return { find, getObjectSchema } as any;
}

const phaseFilterColumn = { field: 'project_phase', label: 'Project Phase', type: 'select' as const };

/**
 * Open the built-in filter panel and return the first select trigger in it.
 *
 * The toggle is reached structurally (first button in the filter bar) rather
 * than by its accessible name: one case below mounts a `zh` I18nProvider, and
 * `initReactI18next` makes that instance the default for provider-less renders
 * afterwards — so a `/filters/i` name match would pass or fail depending on
 * test order, not on the behaviour under test.
 *
 * `findBy…`: the filter bar only exists once the filter columns are resolved,
 * which in the LookupField path waits on the referenced object's schema fetch.
 */
async function openFilterPanel(): Promise<HTMLElement> {
  const bar = await screen.findByTestId('record-picker-filter-bar');
  fireEvent.click(bar.querySelector('button')!);
  return (await screen.findByTestId('record-picker-filter-panel')) as HTMLElement;
}

async function openFilterSelect(): Promise<Element> {
  const panel = await openFilterPanel();
  const trigger = panel.querySelector('[role="combobox"]');
  expect(trigger).toBeTruthy();
  await act(async () => {
    fireEvent.pointerDown(trigger!, { button: 0 });
  });
  return trigger!;
}

describe('RecordPickerDialog filter panel — select options come from the schema (#3336)', () => {
  it('hands the filter bar a select column carrying the schema field options', async () => {
    let captured: RecordPickerFilterBarProps | null = null;
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={makeDataSource()}
        objectName="projects"
        columns={[{ field: 'project_phase', label: 'Project Phase', type: 'select' }]}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={projectFields}
        filterColumns={[phaseFilterColumn]}
        renderFilterBar={(p) => {
          captured = p;
          return <div data-testid="external-filter-bar" />;
        }}
      />,
    );

    await waitFor(() => expect(captured).not.toBeNull());
    // Pre-fix this was `undefined` — the panel had nothing to render.
    expect(captured!.filterColumns[0].options).toEqual([
      { label: '01 Initiation', value: 'initiation' },
      { label: '03 Manufacturing', value: 'manufacturing' },
    ]);
  });

  it('renders the schema options in the built-in filter panel dropdown', async () => {
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={makeDataSource()}
        objectName="projects"
        columns={[
          { field: 'name', label: 'Name', type: 'text' },
          { field: 'project_phase', label: 'Project Phase', type: 'select' },
        ]}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={projectFields}
        filterColumns={[phaseFilterColumn]}
      />,
    );

    await waitFor(() => expect(screen.getByText('Line A retooling')).toBeInTheDocument());
    await openFilterSelect();

    // Pre-fix: SelectContent was empty, so neither option role existed.
    expect(await screen.findByRole('option', { name: '03 Manufacturing' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '01 Initiation' })).toBeTruthy();
  });

  it('filters on the picked option value', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName="projects"
        columns={[{ field: 'project_phase', label: 'Project Phase', type: 'select' }]}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={projectFields}
        filterColumns={[phaseFilterColumn]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await openFilterSelect();

    const option = await screen.findByRole('option', { name: '03 Manufacturing' });
    await act(async () => {
      fireEvent.click(option);
    });

    await waitFor(() => {
      const lastParams = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
      expect(lastParams.$filter).toMatchObject({ project_phase: 'manufacturing' });
    });
  });

  /**
   * The load-bearing case: ONE source for both faces of the widget. The filter
   * option label and the table cell for the same field must be the same
   * translated string — a filter-only re-derivation that skipped the shared
   * i18n option path would show the authored English here.
   */
  it('translates filter option labels through the same i18n path as the cells', async () => {
    let captured: RecordPickerFilterBarProps | null = null;
    render(
      <I18nProvider
        config={{
          defaultLanguage: 'zh',
          detectBrowserLanguage: false,
          resources: {
            zh: {
              demo: {
                fields: { projects_zh: { project_phase: '项目阶段' } },
                fieldOptions: {
                  projects_zh: {
                    project_phase: {
                      initiation: '01 立项',
                      manufacturing: '03 制造',
                    },
                  },
                },
              },
            },
          },
        }}
      >
        {/* A dedicated object name: the bundle above stays registered on the
            default i18next instance for later renders, and keying it to
            `projects_zh` keeps it from translating the other cases' options. */}
        <RecordPickerDialog
          open
          onOpenChange={() => {}}
          dataSource={makeDataSource()}
          objectName="projects_zh"
          columns={[{ field: 'project_phase', label: 'Project Phase', type: 'select' }]}
          onSelect={() => {}}
          cellRenderer={getCellRenderer}
          fieldsMeta={projectFields}
          filterColumns={[phaseFilterColumn]}
          renderFilterBar={(p) => {
            captured = p;
            return <div data-testid="external-filter-bar" />;
          }}
        />
      </I18nProvider>,
    );

    // The cell already resolved the translated label after #3333 …
    await waitFor(() => expect(screen.getByText('03 制造')).toBeInTheDocument());
    // … and the filter option for the same field now says exactly the same thing.
    await waitFor(() => expect(captured).not.toBeNull());
    const labels = captured!.filterColumns[0].options?.map(o => o.label);
    expect(labels).toEqual(['01 立项', '03 制造']);
    expect(labels).not.toContain('03 Manufacturing');
  });

  /**
   * NO-OP PIN (green before and after). A select field the author gave no
   * options keeps an empty dropdown: the fix derives options from the schema
   * and adds no consumer-side leniency — it never invents entries from the
   * loaded page's raw stored values, which would hide the metadata gap behind
   * a list that changes per page.
   */
  it('leaves a select filter optionless when the schema field declares none', async () => {
    let captured: RecordPickerFilterBarProps | null = null;
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={makeDataSource()}
        objectName="projects"
        columns={[{ field: 'name', label: 'Name', type: 'text' }]}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={projectFields}
        filterColumns={[{ field: 'risk_level', label: 'Risk Level', type: 'select' }]}
        renderFilterBar={(p) => {
          captured = p;
          return <div data-testid="external-filter-bar" />;
        }}
      />,
    );

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.filterColumns[0].options).toBeUndefined();
  });

  /**
   * NO-OP PIN (green before and after). Authored filter options are the more
   * specific statement and keep winning — including the `in`-operator options
   * `lookupFilters` auto-derivation builds, which must not be replaced by the
   * schema's full option set (that would widen a deliberately narrowed list).
   */
  it('keeps explicitly authored filter options over the schema ones', async () => {
    let captured: RecordPickerFilterBarProps | null = null;
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={makeDataSource()}
        objectName="projects"
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={projectFields}
        lookupFilters={[{ field: 'project_phase', operator: 'in', value: ['manufacturing'] }]}
        renderFilterBar={(p) => {
          captured = p;
          return <div data-testid="external-filter-bar" />;
        }}
      />,
    );

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.filterColumns[0].options).toEqual([
      { label: 'manufacturing', value: 'manufacturing' },
    ]);
  });
});

/**
 * Record Picker FILTER PANEL — the picked option keeps its AUTHORED type
 * (#3422).
 *
 * Radix `Select` speaks strings: options render as `String(opt.value)` and
 * `onValueChange` returns that string. The panel used to store the string
 * as-is, and `filterValuesToRecord`'s `select` branch passes its value through
 * untouched — so a `lookup_filters`-derived option whose authored value is a
 * number or a boolean queried `{ level: "1" }` against records storing
 * `level: 1`. The user picked an option that plainly has records and got an
 * empty list.
 *
 * The fix maps the control's string back through `col.options` at the control
 * boundary (`matchOptionValue`, the #3090 semantics from
 * `packages/components/src/renderers/form/option-value.ts`) — NOT a coercion
 * in `filterValuesToRecord`, which would have to guess whether `"1"` meant `1`
 * or `"1"`.
 *
 * ## Directions, decided before the run
 *
 * - **The two reproducers are RED before / GREEN after**: `$filter.level` was
 *   the string `"1"`, `$filter.active` the string `"false"`. They assert
 *   `toBe(1)` / `toBe(false)` plus an explicit `typeof`, because `"1" == 1` and
 *   a loose assertion would have passed on the broken build.
 * - **Three cases are NO-OP pins, green before and after** (marked
 *   individually): schema-derived options are already strings and must
 *   round-trip byte-identical (the fix must not start morphing the path
 *   #3336 just made work); and the `number` / `boolean` filter inputs, which
 *   already converted explicitly, must keep doing exactly that — the
 *   three-branch inconsistency the issue flagged is resolved by lifting
 *   `select` up to them, not by touching them.
 * - **The collision case documents a tie-break, not a repair.** Two options
 *   whose `String()` forms collide (`1` and `'1'`) cannot both be addressed by
 *   a string-speaking control — Radix sees two `SelectItem`s with the same
 *   `value`. The first match wins; the case pins that so the resolution is a
 *   stated rule rather than an accident of `Array.prototype.find`.
 */
describe('RecordPickerDialog filter panel — picked option keeps its authored type (#3422)', () => {
  const tasks = [{ id: 't1', name: 'Recalibrate press', level: 1, active: false }];

  function makeTaskDataSource() {
    const find = vi.fn(async () => ({ data: tasks, total: tasks.length }));
    const getObjectSchema = vi.fn(async () => ({
      name: 'tasks',
      fields: {
        name: { type: 'text', label: 'Name' },
        level: { type: 'number', label: 'Level' },
        active: { type: 'boolean', label: 'Active' },
      },
      highlightFields: ['name'],
    }));
    return { find, getObjectSchema } as any;
  }

  /** The `$filter` of the most recent `find` call. */
  function lastFilter(ds: any): Record<string, any> {
    return ds.find.mock.calls[ds.find.mock.calls.length - 1][1].$filter;
  }

  /**
   * REPRODUCER (red before the fix). `lookup_filters` with an `in` array of
   * numbers derives a select whose option values are numbers
   * (`LookupFilterDef.value` is `unknown`, so the author's type survives into
   * `options`). Picking one must query the number.
   */
  it('sends the authored NUMBER for a lookupFilters-derived select option', async () => {
    const ds = makeTaskDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName="tasks"
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        lookupFilters={[{ field: 'level', operator: 'in', value: [1, 2, 3] }]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await openFilterSelect();

    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: '1' }));
    });

    // Pre-fix this was the string "1"; `toBe` distinguishes them, `==` would not.
    await waitFor(() => expect(lastFilter(ds).level).toBe(1));
    expect(typeof lastFilter(ds).level).toBe('number');
  });

  /** REPRODUCER (red before the fix) — the boolean half of the same morph. */
  it('sends the authored BOOLEAN for a lookupFilters-derived select option', async () => {
    const ds = makeTaskDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName="tasks"
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        lookupFilters={[{ field: 'active', operator: 'in', value: [true, false] }]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await openFilterSelect();

    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'false' }));
    });

    // Pre-fix this was the string "false" — which is TRUTHY, so the query asked
    // for the opposite of what the user picked wherever the backend coerces.
    await waitFor(() => expect(lastFilter(ds).active).toBe(false));
    expect(typeof lastFilter(ds).active).toBe('boolean');
  });

  /**
   * NO-OP PIN (green before and after). Schema-derived options are strings by
   * spec (`SelectOptionSchema.value` is `string`), so the #3336 path must come
   * out of the round-trip byte-identical — the fix restores the authored type,
   * it does not invent one.
   */
  it('round-trips a schema-derived string option unchanged', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName="projects"
        columns={[{ field: 'project_phase', label: 'Project Phase', type: 'select' }]}
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        fieldsMeta={projectFields}
        filterColumns={[phaseFilterColumn]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await openFilterSelect();

    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: '03 Manufacturing' }));
    });

    await waitFor(() => expect(lastFilter(ds).project_phase).toBe('manufacturing'));
    expect(typeof lastFilter(ds).project_phase).toBe('string');
  });

  /**
   * TIE-BREAK PIN. `1` and `'1'` both render as the control string `"1"`, so
   * the control cannot tell them apart — Radix receives two `SelectItem`s with
   * the same `value` and React two children with the same key. The lookup
   * resolves to the FIRST declared match, whichever entry was clicked. This
   * documents the rule; it does not claim such an option list is usable.
   */
  it('resolves a String() collision to the first declared option', async () => {
    const ds = makeTaskDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName="tasks"
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        filterColumns={[
          {
            field: 'level',
            label: 'Level',
            type: 'select',
            options: [
              { label: 'Number one', value: 1 },
              { label: 'String one', value: '1' },
            ],
          },
        ]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await openFilterSelect();

    // Clicking the SECOND entry still yields the first match — that is the
    // documented consequence of a collision, not a bug in this assertion.
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'String one' }));
    });

    await waitFor(() => expect(lastFilter(ds).level).toBe(1));
    expect(typeof lastFilter(ds).level).toBe('number');
  });

  /**
   * NO-OP PIN (green before and after). The `number` and `boolean` filter
   * inputs already converted explicitly (`Number(raw)` / `Boolean(checked)`);
   * the issue flagged the three branches disagreeing, and the fix resolves that
   * by lifting `select` to their standard — these two must be untouched.
   */
  it('leaves the number and boolean filter inputs converting as before', async () => {
    const ds = makeTaskDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={() => {}}
        dataSource={ds}
        objectName="tasks"
        onSelect={() => {}}
        cellRenderer={getCellRenderer}
        filterColumns={[
          { field: 'level', label: 'Level', type: 'number' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
      />,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const panel = await openFilterPanel();

    await act(async () => {
      fireEvent.change(panel.querySelector('input[type="number"]')!, { target: { value: '2' } });
    });
    await waitFor(() => expect(lastFilter(ds).level).toBe(2));
    expect(typeof lastFilter(ds).level).toBe('number');

    await act(async () => {
      fireEvent.click(panel.querySelector('[role="checkbox"]')!);
    });
    await waitFor(() => expect(lastFilter(ds).active).toBe(true));
    expect(typeof lastFilter(ds).active).toBe('boolean');
  });
});

describe('LookupField → picker filter panel wiring (#3336)', () => {
  const lookup = {
    name: 'project',
    label: 'Project',
    type: 'lookup',
    reference: 'projects',
    reference_field: 'name',
  } as any;

  it('offers the referenced object schema options in the derived select filter', async () => {
    render(
      <LookupField
        field={lookup}
        value={undefined}
        onChange={vi.fn()}
        readonly={false}
        dataSource={makeDataSource()}
      />,
    );

    // Open the "Browse all records" picker.
    await act(async () => {
      fireEvent.click(await screen.findByTestId('browse-all-records'));
    });
    await waitFor(() => expect(screen.getByTestId('record-picker-dialog')).toBeInTheDocument());

    // `project_phase` reaches the filter bar because it is a typed picker column
    // derived from `highlightFields`; its options come from the same schema.
    await openFilterSelect();
    expect(await screen.findByRole('option', { name: '03 Manufacturing' })).toBeTruthy();
  });
});
