/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7070 — what ListView hands the gantt renderer, and which views it
 * offers the Gantt toggle to.
 *
 * The sibling of `ListView.calendar-binding-7029` next door. `ObjectView` was
 * one half of this face's problem; this branch is the other, and it is the half
 * that decides whether the fix is observable at all — with the object page fixed
 * and this branch untouched, `'start_date'` / `'end_date'` simply take over as
 * the fabricated names one layer down and the renderer still never sees an
 * absent binding.
 *
 * Two read-sites are pinned because they answer two different questions and both
 * used to be answered by the fabrication:
 *
 *   - the RENDER branch — which fields does the gantt lay its bars on?
 *   - the CAPABILITY gate (`availableViews`) — may this view offer Gantt at all?
 *     ADR-0047: a visualization is offered only when its binding resolves. The
 *     gate reads `schema.gantt?.startDateField || schema.options?.gantt?.…`, and
 *     the object page put a fabricated `options.gantt.startDateField` on every
 *     view in the product, so the toggle was always live.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `|| 'start_date'` / `|| 'end_date'` on the two lines this card
 * deletes and the "invents NO binding" case goes RED (the spy reads the
 * fabricated names) while every declared-config case here stays GREEN.
 *
 * objectui#7499 retires the second pair at this face. `progressField` /
 * `dependenciesField` were floored at `'progress'` / `'dependencies'` and
 * pinned HERE as scope, deliberately, so that whoever retired them had a place
 * to declare it. The remedy is OMIT, not refuse — the reasoning lives on the
 * cases below, and the same reverse verification applies: restore
 * `|| 'progress'` / `|| 'dependencies'` and the two OMITS cases go RED while
 * every CONTROL stays GREEN.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, screen, cleanup, fireEvent } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const rows = [
  { id: '1', name: 'Ada onboarding', start_date: '2099-09-01', end_date: '2099-09-03' },
  { id: '2', name: 'Grace onboarding', start_date: '2099-10-01', end_date: '2099-10-02' },
];

const objectDef = {
  name: 'crm_leave_request',
  label: 'Leave Request',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name' },
    start_date: { name: 'start_date', type: 'date', label: 'Start Date' },
    end_date: { name: 'end_date', type: 'date', label: 'End Date' },
  },
};

let captured: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-gantt',
  (props: Record<string, any>) => {
    captured.push(props);
    return <div data-testid="gantt-spy" />;
  },
  { namespace: 'test', label: 'Gantt spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => rows),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  }) as any;

const BASE = {
  type: 'list-view',
  objectName: 'crm_leave_request',
  viewType: 'gantt',
  columns: ['name'],
} as const;

/** Mount ListView on `schema` and return the props the gantt was given. */
async function ganttProps(schema: Record<string, any>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(captured.length).toBeGreaterThan(0));
  return captured[captured.length - 1].schema;
}

const queryViewOption = (name: string) =>
  screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

beforeEach(() => {
  captured = [];
});
afterEach(cleanup);

describe('ListView gantt branch — only ever restates a DECLARED binding (objectui#7070)', () => {
  it('invents NO date binding for a gantt view that declares no config', async () => {
    // THE DEFECT, at this layer. `startDateField` used to read 'start_date' and
    // `endDateField` 'end_date' here — names this view never wrote. Absent
    // bindings are what let `getGanttConfig` return null downstream, which is
    // the only route to the renderer's refusal screen.
    const props = await ganttProps({ ...BASE });
    expect(props.startDateField).toBeUndefined();
    expect(props.endDateField).toBeUndefined();
  });

  it('invents no date binding when the view carries an EMPTY gantt block', async () => {
    const props = await ganttProps({ ...BASE, gantt: {} });
    expect(props.startDateField).toBeUndefined();
    expect(props.endDateField).toBeUndefined();
  });

  it('OMITS `dependenciesField` rather than inventing it, when only the OTHER gantt keys are declared (objectui#7499)', async () => {
    // ⭐ THE DECLARATION SLOT. #7070 left this case pinning the floors as
    // SCOPE, "so that whoever retires them has a place to declare it".
    // objectui#7499 retires them, and the remedy is OMIT rather than REFUSE.
    //
    // WHY NOT REFUSE, the way the date axis does: a fabricated date axis has no
    // legitimate twin — every bar lands on a column nobody declared, a
    // whole-chart error — whereas absent progress and absent dependencies are
    // legitimate and COMMON. Most gantt rows have neither. Refusing here would
    // break the common case, which is why #7070's ruling forbids importing the
    // date-axis conclusion into this pair.
    //
    // WHY NOT KEEP FABRICATING: the failure of a fabricated non-axis name is a
    // per-row `undefined`, INDISTINGUISHABLE from that legitimate absence — so
    // an author who spelled the key differently silently hit a same-named
    // column with no diagnostic, and one who did not got a binding they never
    // wrote. Omission keeps the legitimate absence rendering exactly as before
    // and stops manufacturing the binding.
    //
    // The DECLARED half of the class predicate is asserted in the same breath:
    // `progressField` still arrives verbatim.
    const props = await ganttProps({ ...BASE, gantt: { progressField: 'pct' } });
    expect(props.startDateField).toBeUndefined();
    expect(props.endDateField).toBeUndefined();
    expect(props.progressField).toBe('pct');
    expect(props.dependenciesField).toBeUndefined();
    expect('dependenciesField' in props).toBe(false);
  });

  it('OMITS both non-axis keys for a gantt view that declares no config (objectui#7499)', async () => {
    // The undeclared half of the class predicate, at the same face. `'progress'`
    // / `'dependencies'` used to be handed down here unconditionally.
    const props = await ganttProps({ ...BASE });
    expect(props.progressField).toBeUndefined();
    expect(props.dependenciesField).toBeUndefined();
    // Absent, not present-and-undefined: `getGanttConfig`'s flat branch reads
    // `schema.dependenciesField || schema.dependencyField`, so a PRESENT
    // `dependenciesField` — even undefined — is a different fact about this
    // config than an absent one.
    expect(Object.keys(props)).not.toContain('progressField');
    expect(Object.keys(props)).not.toContain('dependenciesField');
  });

  it('CONTROL: a DECLARED `dependenciesField` still passes verbatim (objectui#7499)', async () => {
    // The control that gives the two assertions above their meaning: this
    // harness CAN see a `dependenciesField` on the captured props, so reading
    // `undefined` there is a measurement and not a spy that never receives one.
    const props = await ganttProps({ ...BASE, gantt: { dependenciesField: 'preds', progressField: 'pct' } });
    expect(props.dependenciesField).toBe('preds');
    expect(props.progressField).toBe('pct');
  });

  it('CONTROL: the legacy `options.gantt` nesting carries the pair verbatim too (objectui#7499)', async () => {
    // Both nestings are authoring faces here, and the floors used to read both
    // legs. Deleting them must not cost the `options.gantt` leg its pass-through.
    const props = await ganttProps({
      ...BASE,
      options: { gantt: { progressField: 'percent_done', dependenciesField: 'depends_on' } },
    });
    expect(props.progressField).toBe('percent_done');
    expect(props.dependenciesField).toBe('depends_on');
  });

  it('CONTROL: forwards the spec-canonical `gantt` block unchanged', async () => {
    const props = await ganttProps({
      ...BASE,
      gantt: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
    });
    expect(props.startDateField).toBe('start_date');
    expect(props.endDateField).toBe('end_date');
    expect(props.titleField).toBe('name');
  });

  it('CONTROL: forwards the legacy `options.gantt` nesting unchanged', async () => {
    // The nesting app-shell's object page emits. A correctly configured view
    // renders exactly as it did before this card.
    const props = await ganttProps({
      ...BASE,
      options: { gantt: { startDateField: 'start_date', endDateField: 'end_date', colorField: 'status' } },
    });
    expect(props.startDateField).toBe('start_date');
    expect(props.endDateField).toBe('end_date');
    expect(props.colorField).toBe('status');
  });

  it('CONTROL: a partially declared axis keeps its declared half and only that', async () => {
    const props = await ganttProps({ ...BASE, gantt: { startDateField: 'start_date' } });
    expect(props.startDateField).toBe('start_date');
    expect(props.endDateField).toBeUndefined();
  });
});

describe('ListView capability gate — the Gantt toggle follows the binding (objectui#7070)', () => {
  const GRID = { ...BASE, viewType: 'grid' } as const;

  /**
   * The switcher has two forms — an inline segmented control (role="tab") and a
   * collapsed dropdown (plain buttons behind a trigger) — so the trigger has to
   * be opened before querying, and both roles have to be accepted. Querying
   * without opening returns null for BOTH worlds, which would make the negative
   * case below pass while measuring nothing. Copied from the objectui#7029 file
   * next door, where that was measured on its first run.
   */
  const mountSwitcher = async (schema: Record<string, any>) => {
    const dataSource = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as never} dataSource={dataSource} showViewSwitcher />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const trigger = screen.queryByTestId('view-switcher-dropdown');
    if (trigger) fireEvent.click(trigger);
  };

  it('CONTROL: offers Gantt to a view that declared a binding', async () => {
    // The positive control comes FIRST: it proves this harness can see the
    // option at all, so the negative case below is a measurement rather than a
    // query that never had anything to find.
    await mountSwitcher({ ...GRID, gantt: { startDateField: 'start_date', endDateField: 'end_date' } });
    await waitFor(() => expect(queryViewOption('Gantt')).toBeInTheDocument());
  });

  it('CONTROL: offers Gantt for the legacy `options.gantt` nesting too', async () => {
    // The shape the object page emits for a view that DID declare a gantt block
    // — the half of the gate that must keep working after the fabrication left.
    await mountSwitcher({
      ...GRID,
      options: { gantt: { startDateField: 'start_date', endDateField: 'end_date' } },
    });
    await waitFor(() => expect(queryViewOption('Gantt')).toBeInTheDocument());
  });

  it('does NOT offer Gantt for the exact bag the fixed object page now emits', async () => {
    // ⭐ THE SECOND PREMISE, measured rather than assumed. #7070 asked whether
    // ADR-0047's gate drops the Gantt toggle "for free" once the fabrication is
    // gone, the way it did for calendar. The gate reads
    // `schema.gantt?.startDateField || schema.options?.gantt?.startDateField`,
    // and the fabrication it used to read came from the OBJECT PAGE, which put
    // `options.gantt.startDateField: 'start_date'` on every view in the product.
    // `{ gantt: { titleField: 'name' } }` is precisely what `ganttViewOptions`
    // now emits for a view that declared nothing — a bag that still EXISTS but
    // carries no axis. The answer is yes: no second mechanism was needed.
    await mountSwitcher({
      ...GRID,
      appearance: { allowedVisualizations: ['grid', 'gantt'] },
      options: { gantt: { titleField: 'name' } },
    });
    expect(queryViewOption('Gantt')).not.toBeInTheDocument();
  });

  it('does NOT offer Gantt to a view that declared no gantt binding', async () => {
    // ADR-0047: offered only when the binding resolves. This is the second
    // premise objectui#7070 asked to be measured rather than assumed — that the
    // capability gate drops the toggle "for free" once the fabrication is gone,
    // as it did for calendar. It does: the gate reads the same declared config
    // this card stopped inventing, so no second mechanism was needed.
    await mountSwitcher({ ...GRID, appearance: { allowedVisualizations: ['grid', 'gantt'] } });
    expect(queryViewOption('Gantt')).not.toBeInTheDocument();
  });
});
