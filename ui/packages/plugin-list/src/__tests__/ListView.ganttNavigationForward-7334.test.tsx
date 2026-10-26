/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7334 — the FORWARDING half: ListView puts the authored view-level
 * `navigation` on the gantt node, and on NO other node.
 *
 * The sibling of `ListView.gantt-binding-7070` next door, and the same harness:
 * a registered spy stands in for `object-gantt` and reports the schema it was
 * handed. The RESOLUTION half — that `ObjectGantt` then makes the authored mode
 * out of it, rather than its `?? { mode: 'drawer' }` fallback — is pinned in
 * `plugin-gantt/src/ObjectGantt.navigationModeResolution-7334.test.tsx`.
 *
 * THE DEFECT. `ObjectGantt` owns a record drawer of its own and resolves
 * `const navConfig = schema.navigation ?? { mode: 'drawer' }`, classifying four
 * overlay modes (`drawer` / `modal` / `split` / `popover`). Nothing ever put
 * `navigation` on the node it receives — `baseProps` declares no such key, and
 * the `case 'gantt'` branch added only the data keys — so that `??` was the
 * only branch ever taken and a view authoring `navigation: { mode: 'page' }`
 * got a drawer with no diagnostic. The other view types do not have this
 * problem for the opposite reason: their wrappers spread host props, so
 * ListView's own overlay decides through `onRowClick`.
 *
 * ⭐ WHY THE ASSERTIONS NAME A MODE. The defect's shape is "a drawer opens
 * anyway", so a test asserting only that something opened is blind to it by
 * construction — it was green before the repair and is green after. Every
 * assertion below reads the mode value that reaches the node.
 *
 * ⭐ WHY THE `case 'gantt'` BRANCH AND NOT `baseProps` — measured, not
 * preferred, and the cross-view cases at the bottom are that measurement.
 * SEVEN other child views read `schema.navigation` themselves (grid, gallery,
 * kanban, calendar, map, timeline, tree) and every one of them also receives
 * `onRowClick: navigation.handleClick` from `baseProps`, which
 * `useNavigationOverlay` gives FULL priority over any `navigation` handed in.
 * On `baseProps` the key would therefore arrive at seven views and either be
 * outranked outright (six of them pass `onRowClick` unconditionally) or flip
 * behaviour (calendar mirrors gantt's `navIsOverlay ? undefined : onRowClick`,
 * so an authored `page` would stop it suppressing the host handler). Two
 * sources of truth for one question. Gantt is the only branch where forwarding
 * settles the question instead of splitting it, because its wrapper drops host
 * props entirely (objectui#7210 / objectui#7222) and there is no `onRowClick`
 * there to outrank anything.
 *
 * REVERSE VERIFICATION — direction predicted before running: delete the
 * `...(schema.navigation ? { navigation: schema.navigation } : {})` line from
 * the gantt branch and the three FORWARDS cases go red (each reads `undefined`
 * where it asserts a mode) while the FALLBACK case and every cross-view case
 * stay green.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

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
    status: { name: 'status', type: 'text', label: 'Status' },
    start_date: { name: 'start_date', type: 'date', label: 'Start Date' },
    end_date: { name: 'end_date', type: 'date', label: 'End Date' },
  },
};

let captured: Array<Record<string, any>> = [];

/**
 * One spy shape, registered for every view type this file measures. Each
 * records the whole props bag so the cases can read `props.schema` — the node
 * `viewComponentSchema` built — and, for the cross-view cases, confirm in the
 * same breath that the spy DOES receive `onRowClick` (the key that would
 * outrank an authored `navigation` there).
 */
const makeSpy = (testid: string) => (props: Record<string, any>) => {
  captured.push({ testid, ...props });
  return <div data-testid={testid} />;
};

for (const type of [
  'object-gantt',
  'object-grid',
  'object-kanban',
  'object-calendar',
  'object-tree',
  'object-timeline',
]) {
  ComponentRegistry.register(type, makeSpy(`${type}-spy`), {
    namespace: 'test',
    label: `${type} spy`,
    category: 'view',
  });
}

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

/** Mount ListView on `schema` and return the props its child view was given. */
async function viewProps(schema: Record<string, any>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema as never} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(captured.length).toBeGreaterThan(0));
  return captured[captured.length - 1];
}

/** The node `viewComponentSchema` built for the child view. */
const viewSchema = async (schema: Record<string, any>) => (await viewProps(schema)).schema;

beforeEach(() => {
  captured = [];
});
afterEach(cleanup);

describe('ListView forwards an authored `navigation` down the gantt view-schema path (objectui#7334)', () => {
  it('CONTROL: the spy can see a `navigation` key at all', async () => {
    // The positive control comes FIRST. Every case below reads
    // `schema.navigation`, so a harness that could never carry one would make
    // the `undefined` readings meaningless rather than red. It doubles as the
    // control the dispatch asked for by name: grepping `baseProps` for the WORD
    // "navigation" false-positives on `onRowClick: navigation.handleClick`,
    // which is the value, not the key — this reads the key.
    const node = await viewSchema({ ...BASE, navigation: { mode: 'page' } });
    expect('navigation' in node).toBe(true);
    expect(node.navigation).toBeTruthy();
  });

  it('FORWARDS an authored `page` — the node carries mode `page`, ⛔ not `drawer`', async () => {
    // ⭐ THE ACCEPTANCE CASE. `ObjectGantt` reads exactly this key; before the
    // repair it was absent, so its `?? { mode: 'drawer' }` fired for every
    // gantt in the product regardless of what the author wrote.
    const node = await viewSchema({ ...BASE, navigation: { mode: 'page' } });
    expect(node.navigation?.mode).toBe('page');
    expect(node.navigation?.mode).not.toBe('drawer');
  });

  it('FORWARDS an authored `modal` — a second, non-`drawer` OVERLAY mode', async () => {
    // Deliberately an overlay mode, so it lands on the same side of
    // `ObjectGantt`'s `navIsOverlay` classification as the old fallback: a
    // repair that had learned only to recognise "page" would pass the case
    // above and fail this one.
    const node = await viewSchema({ ...BASE, navigation: { mode: 'modal' } });
    expect(node.navigation?.mode).toBe('modal');
  });

  it('FORWARDS the whole authored block, not just `mode`', async () => {
    // `useNavigationOverlay` reads `size` and `width` off the same object
    // (`resolveOverlayWidth`), so forwarding a mode-only projection would trade
    // this defect for a narrower one. A non-`mode` member is what makes this
    // case different from the two above it, and `size` is that member.
    //
    // ⛔ The block used to carry `view` as well, and no longer does:
    // objectstack#18619 retired `navigation.view` as an ADR-0049 tombstone
    // (objectui#9667), and objectui#9874 / PR objectui#9936 had already removed
    // the matching read — `useNavigationOverlay` no longer has a `view` member
    // to resolve, so naming it here described a read that is gone.
    const node = await viewSchema({
      ...BASE,
      navigation: { mode: 'split', size: 'lg' },
    });
    expect(node.navigation).toEqual({ mode: 'split', size: 'lg' });
  });

  it('REGRESSION GUARD: a gantt view authoring NO navigation gets no key — the `drawer` fallback stays reachable', async () => {
    // ABSENT, not present-and-undefined — the same distinction the two
    // non-axis gantt keys next door are omitted for (objectui#7499). A present
    // `navigation: undefined` would still satisfy `??`, but "the author wrote
    // nothing" and "the author wrote undefined" are different facts about a
    // config and this branch keeps them apart.
    const node = await viewSchema({ ...BASE });
    expect(node.navigation).toBeUndefined();
    expect(Object.keys(node)).not.toContain('navigation');
  });

  it('CONTROL: the gantt node still carries everything it carried before', async () => {
    // The forwarding is an addition, not a rewrite of the branch.
    const node = await viewSchema({
      ...BASE,
      navigation: { mode: 'page' },
      gantt: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' },
    });
    expect(node.type).toBe('object-gantt');
    expect(node.startDateField).toBe('start_date');
    expect(node.endDateField).toBe('end_date');
    expect(node.titleField).toBe('name');
    expect(node.objectName).toBe('crm_leave_request');
    expect(typeof node.onRowClick).toBe('function');
  });
});

describe('⛔ no OTHER view type starts receiving `navigation` — one source of truth (objectui#7334)', () => {
  /**
   * The measurement behind the branch-not-`baseProps` choice, and the dispatch's
   * second stop condition ("stop if forwarding changes behaviour for a non-gantt
   * view type") turned into a pin. Each of these child views reads
   * `schema.navigation` for itself AND is handed `onRowClick` by `baseProps`;
   * had the key gone on `baseProps` it would now arrive here too, and the
   * `onRowClick` asserted alongside it is precisely what would outrank it.
   */
  for (const [viewType, testid] of [
    ['grid', 'object-grid-spy'],
    ['kanban', 'object-kanban-spy'],
    ['calendar', 'object-calendar-spy'],
    ['tree', 'object-tree-spy'],
    ['timeline', 'object-timeline-spy'],
  ] as const) {
    it(`\`${viewType}\` gets NO navigation key even when the view authors one`, async () => {
      const props = await viewProps({ ...BASE, viewType, navigation: { mode: 'page' } });
      expect(props.testid).toBe(testid);
      // The negative reading, with its own control in the same breath: this
      // spy demonstrably receives `baseProps` (it has `onRowClick`), so the
      // absent `navigation` is a measurement and not an empty harness.
      expect(typeof props.onRowClick).toBe('function');
      expect(props.schema.navigation).toBeUndefined();
      expect(Object.keys(props.schema)).not.toContain('navigation');
    });
  }
});
