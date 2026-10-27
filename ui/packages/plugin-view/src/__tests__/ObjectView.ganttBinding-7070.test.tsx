/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7070 — the third face. `generateViewSchema`'s gantt branch floored
 * `startDateField` / `endDateField` at `'start_date'` / `'end_date'` for every
 * view, declared or not, exactly as the app-shell and ListView faces did.
 *
 * The sibling of `ObjectView.calendarBinding-7029` next door. Fixing two of the
 * three faces would leave this one fabricating the same names one route over —
 * which is the shape of the original defect, where objectui#3129 fixed the
 * timeline axis at app-shell alone and the two plugin faces kept inventing.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `|| 'start_date'` / `|| 'end_date'` and the "invents NO binding" case
 * goes RED while every CONTROL stays GREEN in either world.
 *
 * objectui#7499 retires the non-axis pair at this face too. `progressField` /
 * `dependenciesField` were floored at `'progress'` / `'dependencies'` and
 * pinned HERE as scope, deliberately, so that whoever retired them had a place
 * to declare it. The remedy is OMIT, not refuse — reasoning on the case below.
 * Same reverse verification: restore `|| 'progress'` / `|| 'dependencies'` and
 * the OMITS case goes RED while every CONTROL stays GREEN.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every schema the view hands to SchemaRenderer, in order. */
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

async function renderGanttView(view: Record<string, unknown>) {
  rendered.length = 0;
  const ds: any = {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'crm_leave_request', fields: {} }),
  };
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'crm_leave_request' } as ObjectViewSchema}
      views={[{ id: 'g', label: 'Gantt', type: 'gantt' as any, ...view }]}
      dataSource={ds}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

/**
 * The emitted binding. objectstack#25923: it goes out as the node's own `gantt`
 * block, never flat (the spec refuses every `GanttConfig` key flat on
 * `object-gantt`), and only once BOTH dates are declared — the condition the
 * renderer's flat branch applied before it drew. The guard reds if a flat
 * spelling comes back.
 */
const blockOf = (node: any): Record<string, any> => {
  for (const key of ['startDateField', 'endDateField', 'titleField', 'progressField', 'dependenciesField']) {
    expect(node, `flat ${key} on the node`).not.toHaveProperty(key);
  }
  return node.gantt ?? {};
};
const AXIS = { startDateField: 'planned_start', endDateField: 'planned_end' } as const;

describe('ObjectView.generateViewSchema — gantt restates only a DECLARED binding (objectui#7070)', () => {
  it('invents NO date binding for a gantt view that declares no config', async () => {
    const schema = await renderGanttView({});
    expect(schema.type).toBe('object-gantt');
    // Both used to be fabricated here. Absent bindings are the only route to
    // `ObjectGantt`'s refusal screen — measured to exist before this deletion,
    // and pinned in `plugin-gantt/src/ObjectGantt.unconfiguredRefusal-7070`.
    expect(blockOf(schema).startDateField).toBeUndefined();
    expect(blockOf(schema).endDateField).toBeUndefined();
  });

  it('invents no date binding for an EMPTY gantt block', async () => {
    // ⚠️ `gantt` sits at the VIEW's top level here, not under `options`:
    // `viewOptions` is `currentNamedViewConfig?.options || activeView`, and a
    // raw `views` entry takes the `activeView` leg. Written as `{ options:
    // { gantt } }` first, this case and the two CONTROLs below all read
    // `undefined` — the CONTROLs went red and exposed it, which is exactly the
    // job a declared-config control exists to do. Written the wrong way, THIS
    // case would have passed while measuring nothing at all.
    const schema = await renderGanttView({ gantt: {} });
    expect(blockOf(schema).startDateField).toBeUndefined();
    expect(blockOf(schema).endDateField).toBeUndefined();
  });

  it('OMITS `progress` / `dependencies` rather than inventing them — the retirement #7070 left a slot for (objectui#7499)', async () => {
    // ⭐ THE DECLARATION SLOT, and this case IS the declaration. #7070 pinned
    // the pair's presence as SCOPE, "so that whoever retires them has a place
    // to declare it"; objectui#7499 retires them.
    //
    // OMIT, not REFUSE — and the asymmetry against the date axis is the whole
    // reason #7070's ruling forbids importing the date-axis conclusion here:
    //
    //   fabricated DATE AXIS      → whole-chart error, every bar on a column
    //                               nobody declared. No legitimate twin exists.
    //   fabricated progress/deps  → per-row `undefined`, which is exactly what
    //                               the LEGITIMATE and COMMON case looks like.
    //                               Most gantt rows have neither.
    //
    // So refusing would break the common case, and fabricating manufactured a
    // binding the author never wrote whose failure was silent — an author who
    // spelled the key differently got an accidental hit on a same-named column
    // and no diagnostic. Omission keeps the legitimate absence rendering
    // exactly as before and stops inventing the name.
    const schema = await renderGanttView({});
    expect(blockOf(schema).progressField).toBeUndefined();
    expect(blockOf(schema).dependenciesField).toBeUndefined();
    // Absent, not present-and-undefined. `getGanttConfig`'s flat branch reads
    // `blockOf(schema).dependenciesField || schema.dependencyField`, so whether the key
    // is PRESENT is a different fact about this config than what it holds.
    expect(Object.keys(blockOf(schema))).not.toContain('progressField');
    expect(Object.keys(blockOf(schema))).not.toContain('dependenciesField');
  });

  it('CONTROL: a DECLARED `progressField` / `dependenciesField` still passes verbatim (objectui#7499)', async () => {
    // The control that gives the omission case its meaning: this harness CAN
    // see the pair on the rendered schema, so reading `undefined` above is a
    // measurement rather than a probe that never had anything to find.
    const schema = await renderGanttView({
      gantt: { ...AXIS, progressField: 'percent_done', dependenciesField: 'depends_on' },
    });
    expect(blockOf(schema).progressField).toBe('percent_done');
    expect(blockOf(schema).dependenciesField).toBe('depends_on');
  });

  it('CONTROL: declaring ONE of the pair leaves the other absent, not fabricated (objectui#7499)', async () => {
    // The class predicate's mixed case, the one the floors used to erase: a
    // view that declares progress but not dependencies got `'dependencies'`
    // handed down anyway.
    const schema = await renderGanttView({ gantt: { ...AXIS, progressField: 'percent_done' } });
    expect(blockOf(schema).progressField).toBe('percent_done');
    expect(blockOf(schema).dependenciesField).toBeUndefined();
  });

  it('CONTROL: forwards a declared gantt block unchanged', async () => {
    const schema = await renderGanttView({
      gantt: { startDateField: 'planned_start', endDateField: 'planned_end', titleField: 'subject' },
    });
    expect(schema.type).toBe('object-gantt');
    expect(blockOf(schema).startDateField).toBe('planned_start');
    expect(blockOf(schema).endDateField).toBe('planned_end');
    expect(blockOf(schema).titleField).toBe('subject');
  });

  it('CONTROL: a partially declared axis hands no block, and the full axis floors `titleField` (objectstack#25923)', async () => {
    // Before objectstack#25923 the declared half went out flat, and the
    // renderer's flat branch, needing both dates, refused it; the block is held
    // back under that same condition, so the outcome on screen is unchanged.
    expect((await renderGanttView({ gantt: { startDateField: 'planned_start' } })).gantt).toBeUndefined();
    // …an axis-less config hands nothing either…
    expect((await renderGanttView({ gantt: { progressField: 'percent_done' } })).gantt).toBeUndefined();
    // …and with both dates the block carries the flat branch's own `'name'` floor.
    expect(blockOf(await renderGanttView({ gantt: { ...AXIS } }))).toEqual({ ...AXIS, titleField: 'name' });
  });
});

describe('ObjectView.generateViewSchema — a block the spec refuses goes out flat, as before (objectstack#25923)', () => {
  it('a stored gantt config carrying a refused value is handed flat, so the renderer still draws it', async () => {
    // `getGanttConfig` validates a `gantt` block (objectui#13459) and never
    // validated the flat branch: nested, this view would move from drawing to
    // the refusal screen (`plugin-gantt`'s `ObjectGantt.legacyFlatDraws-25923`).
    // The stored row's legacy `options.gantt` reaches this same leg through
    // app-shell's ObjectView relay, unvalidated.
    const schema = await renderGanttView({ gantt: { ...AXIS, viewMode: 'hour' } });
    expect(schema).not.toHaveProperty('gantt');
    expect([schema.startDateField, schema.endDateField, schema.titleField, schema.viewMode]).toEqual([
      'planned_start',
      'planned_end',
      'name',
      'hour',
    ]);
  });

  it('CONTROL: the same view with a valid value goes out nested', async () => {
    const schema = await renderGanttView({ gantt: { ...AXIS, viewMode: 'week' } });
    expect(blockOf(schema)).toEqual({ ...AXIS, titleField: 'name', viewMode: 'week' });
  });
});
