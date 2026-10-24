/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8355 — this branch forwards the CANONICAL calendar keys only, and the
 * retired spellings are refused BY NAME at the read door.
 *
 * Director seat, 2026-09-16, class-1 self-adjudication: "retire the aliases at
 * both faces, now". Option A — normalise `dateField` to `startDateField` HERE —
 * was on the table and was REFUSED as the end state: it keeps a second spelling
 * alive at the producer, which is the lenient alias AGENTS.md #0.1 names.
 *
 * ## ⭐ WHY THIS FILE EXISTS AT ALL — a text census cannot see a spread
 *
 * `ListView`'s calendar branch used to end with two raw spreads of the authored
 * block onto the node it emits. The keys therefore reached the renderer WITHOUT
 * this file ever naming them, and a word-boundary census of producers came back
 * a confident zero. That false zero is what let an earlier attempt remove the
 * renderer's alias ladder and break a live authoring path with every gate green
 * (recorded on objectui#8651). ⇒ the only census that can answer this question
 * RUNS the producer, which is what the spy registration below does.
 *
 * ## THE TWO HALVES, and the ablation that keeps them apart
 *
 *   1. THE QUIET HALF — the merged block is destructured and only the remainder
 *      is spread, so neither retired spelling reaches the generated node.
 *   2. THE LOUD HALF — `@object-ui/types` refuses both spellings by name at the
 *      view's read door (`safeValidateSchema`, the same entry point `os check` /
 *      `os validate` and the save gate run), pointing at `startDateField` /
 *      `endDateField`. ⛔ Without this half, half 1 is exactly the silent
 *      breakage the ruling exists to prevent.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore the two raw spreads in `ListView.tsx` and the node arms go RED while
 * every refusal arm stays GREEN; remove either arm from `CalendarConfig` in
 * `@object-ui/types` and the refusal arms go RED while the node arms stay GREEN.
 * Two independent halves, two independent ablations.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ListView } from '../ListView';

const OBJECT = 'duly_task';

const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    kickoff: { name: 'kickoff', type: 'date', label: 'Kickoff' },
    wrapup: { name: 'wrapup', type: 'date', label: 'Wrapup' },
  },
};

/** Every `object-calendar` node the renderer generated, in order. */
let calendarNodes: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-calendar',
  (props: Record<string, any>) => {
    calendarNodes.push(props.schema);
    return <div data-testid="calendar-spy" />;
  },
  { namespace: 'test', label: 'Calendar spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 0),
    getObjectSchema: vi.fn(async () => objectDef),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  }) as any;

/** Mount `ListView` on a view and return the last generated `object-calendar` node. */
async function generatedCalendarNode(view: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, viewType: 'calendar', ...view } as never}
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(calendarNodes.length).toBeGreaterThan(0));
  return calendarNodes[calendarNodes.length - 1];
}

/**
 * THE FIXTURE, used by BOTH halves so neither can drift onto a different
 * document than the other. It is the shape the objectui#8651 measurement
 * captured: an authored block carrying the retired spellings and no canonical
 * one, which used to emit a node with a flat `dateField` and NO `startDateField`.
 */
const ALIASED_VIEW = {
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'calendar',
  calendar: { dateField: 'kickoff', endField: 'wrapup', titleField: 'name' },
} as const;

/** The same document written the way the contract spells it. */
const CANONICAL_VIEW = {
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'calendar',
  calendar: { startDateField: 'kickoff', endDateField: 'wrapup', titleField: 'name' },
} as const;

/**
 * The read door judges the AUTHORED page node (objectui#12670, ruling C on
 * objectstack-ai/objectstack#22444): its props in the `properties` bag, its
 * object named in `data`, its kind as the bag's `type`. The fixtures above are
 * the `ListView` component's props, which half 1 renders; half 2 hands the
 * door the same list view in the page spelling.
 */
const asPageNode = ({ type, objectName, viewType, ...props }: Record<string, unknown>) => ({
  type,
  properties: { data: { provider: 'object', object: objectName }, type: viewType, ...props },
});

const issuesAt = (doc: Record<string, unknown>, suffix: string) => {
  const result = safeValidateSchema(asPageNode(doc));
  if (result.success) return [];
  return result.error.issues.filter((i) => i.path.join('.').endsWith(suffix));
};

beforeEach(() => {
  calendarNodes = [];
});

describe('objectui#8355 · half 1 — the generated node carries the canonical keys only', () => {
  it('neither retired spelling reaches the `object-calendar` node', async () => {
    const node = await generatedCalendarNode(ALIASED_VIEW);
    // Before this change both rode the branch's two raw spreads onto the node,
    // where the renderer's alias ladder read them.
    expect(Object.keys(node)).not.toContain('dateField');
    expect(Object.keys(node)).not.toContain('endField');
  });

  it('…and no canonical binding is invented from them either', async () => {
    // ⛔ THE ARM THAT TELLS THE RULING APART FROM OPTION A. A producer-side fold
    // would emit `startDateField: 'kickoff'` here and every other row in this
    // file would still pass. The ruling refused that end state, so the aliased
    // view produces NO date binding — and the author has already been told why
    // by half 2 below.
    const node = await generatedCalendarNode(ALIASED_VIEW);
    expect(node.startDateField).toBeUndefined();
    expect(node.endDateField).toBeUndefined();
  });

  it('CONTROL: the canonical block still reaches the node intact', async () => {
    // Without this row, "the aliases do not reach the node" is satisfied by a
    // branch that forwards nothing at all.
    const node = await generatedCalendarNode(CANONICAL_VIEW);
    expect(node.startDateField).toBe('kickoff');
    expect(node.endDateField).toBe('wrapup');
    expect(node.titleField).toBe('name');
  });

  it('CONTROL: the block\'s other DECLARED keys still reach the node; an undeclared one does not (objectui#6152 round 14)', async () => {
    // This card stripped exactly TWO keys and pinned that the branch did not
    // become a whitelist, with `defaultView` as the knob that still rode
    // through. objectui#6152 round 14 made it one ON PURPOSE: the branch now
    // forwards the spec calendar block's five keys by name, so the declared
    // `allDayField` still arrives and the refused `defaultView` does not.
    const node = await generatedCalendarNode({
      calendar: { startDateField: 'kickoff', allDayField: 'is_all_day', defaultView: 'week' },
    });
    expect(node.allDayField).toBe('is_all_day');
    expect(node).not.toHaveProperty('defaultView');
  });

  it('CONTROL: the LEGACY `options.calendar` nesting is stripped on the same path', async () => {
    // app-shell's `calendarViewOptions` forwards a view's declared block into
    // this nesting, so a stored view carries the aliases here too.
    const node = await generatedCalendarNode({
      options: { calendar: { dateField: 'kickoff', titleField: 'name' } },
    });
    expect(Object.keys(node)).not.toContain('dateField');
    expect(node.startDateField).toBeUndefined();
  });
});

describe('objectui#8355 · half 2 — the retired spellings are REFUSED at the read door', () => {
  it('the aliased fixture is refused BY NAME, pointing at `startDateField`', () => {
    const issues = issuesAt(ALIASED_VIEW, 'calendar.dateField');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Did you mean `dateField` → `startDateField`?');
  });

  it('…and `endField` is refused in the same pass, pointing at `endDateField`', () => {
    const issues = issuesAt(ALIASED_VIEW, 'calendar.endField');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Did you mean `endField` → `endDateField`?');
  });

  it('the LEGACY nesting is refused too, with the same message', () => {
    const doc = { ...ALIASED_VIEW, calendar: undefined, options: { calendar: { dateField: 'kickoff' } } };
    const issues = issuesAt(doc, 'options.calendar.dateField');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Did you mean `dateField` → `startDateField`?');
  });

  it('DARK CONTROL: the canonical fixture parses GREEN through the same door', () => {
    const result = safeValidateSchema(asPageNode(CANONICAL_VIEW));
    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  });
});
