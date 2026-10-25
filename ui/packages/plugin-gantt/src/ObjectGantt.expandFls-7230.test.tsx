/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7230 — field-level security on `ObjectGantt`'s `$expand`.
 *
 * ## The site
 *
 * objectui#7215 / PR #7229 gated the two PROJECTION sites in its scope
 * (`ObjectGrid`, `ListView`). This is one of the call sites it did not reach,
 * and like the calendar's it passes **no column list**:
 *
 *     const expand = buildExpandFields(objectSchema?.fields);
 *
 * `buildExpandFields` reads an absent column list as "no column restriction"
 * and falls back to **every declared relation on the object**, denied ones
 * included — so this is the maximal ask, issued by default rather than by
 * configuration.
 *
 * ## Grading — the same defence-in-depth reading #7215 recorded
 *
 * `FieldMasker.maskRecord` deletes every unreadable key and objectql writes the
 * expanded record back under that same key, so ObjectStack's own server strips
 * both the expansion and the bare id in one statement; the expansion sub-read
 * takes the referenced object's full CRUD + RLS + FLS treatment
 * (objectstack#7626). The value is that the invariant stops resting on every
 * future backend having enforced it — and the client-request side is real
 * either way.
 *
 * ## The gate is on the OUTPUT — copied from #7229, not re-derived
 *
 * There is no input to gate here (the call passes `undefined`), and gating the
 * output makes the "`checkField` answers false for an undeclared key" trap
 * structurally unreachable: every name judged is a DECLARED reference-bearing
 * field, because that is all the helper returns.
 *
 * The stub `checkField` is an ALLOWLIST for the reason `expandFls-7215.test.tsx`
 * records: the real provider answers `true` for a field no policy mentions, so
 * a denial can only be modelled by enumerating what is readable.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/** Stable stub identity — `perms` rides `reload`'s dependency list. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { isLoaded: boolean; readable: string[] } = { isLoaded: true, readable: [] };
  return {
    state,
    permsStub: {
      get isLoaded() { return state.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? state.readable.includes(field) : true,
      check: () => ({ allowed: true }),
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      systemPermissions: undefined,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

/** The chart itself is orthogonal to the query parameters this file observes. */
vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => <div data-testid="gantt-view" data-count={tasks.length} />,
}));

import { ObjectGantt } from './ObjectGantt';

const TASKS = [
  { id: '1', name: 'Alpha', start: '2024-01-01', end: '2024-01-05' },
  { id: '2', name: 'Beta', start: '2024-02-01', end: '2024-02-10' },
];

/**
 * Two relations of DIFFERENT declared types, so the pins cover the family:
 * `project` is the readable `lookup` control, `owner_dept` the denied
 * `master_detail`, `secret_project` the denied `lookup` under test.
 */
const TASK_FIELDS: Record<string, any> = {
  name: { type: 'text' },
  start: { type: 'date' },
  end: { type: 'date' },
  project: { type: 'lookup', reference: 'projects' },
  secret_project: { type: 'lookup', reference: 'projects' },
  owner_dept: { type: 'master_detail', reference: 'departments' },
};

const GANTT_SCHEMA = {
  type: 'gantt',
  objectName: 'task',
  startDateField: 'start',
  endDateField: 'end',
  titleField: 'name',
} as any;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: TASKS })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: TASK_FIELDS }),
  } as any;
}

/**
 * Mount and hand back the `$expand` of the SCHEMA-DEPENDENT query. The
 * `waitFor` targets a `find('task', …)` issued after `getObjectSchema` settled,
 * so "the gantt stopped fetching" times out rather than reading as an empty
 * expansion — the ghost-assertion guard this family of pins requires.
 *
 * ⭐ THE SECOND `waitFor` READS "AT LEAST ONE CALL", NOT "MORE THAN ONE", and
 * the difference is the whole reason this helper needed re-expressing when
 * objectui#7225 landed beside it. What this file pins is the CONTENT of
 * `$expand`; the call COUNT was only ever the means of telling the
 * schema-dependent query apart from the one the gantt used to issue BEFORE the
 * schema arrived. objectui#7225 ask 2 deleted that first query — the object
 * schema now GATES the fetch instead of refining it afterwards, so `reload`
 * fires once, with the schema already in hand, and
 * `ObjectGantt.fetchGate-7225.test.tsx` pins that count at exactly one.
 * `toBeGreaterThan(1)` was therefore not a stronger assertion under the gate,
 * it was an unsatisfiable one: it waited for a second query that no longer
 * exists, and the six pins below timed out while the behaviour they grade —
 * FLS on the expansion — was fully intact.
 *
 * Nothing is given up by the change. Every recorded `find` is now
 * schema-dependent by construction, so "read the last call" reads the right
 * one; and a gantt that stopped fetching altogether still TIMES OUT here rather
 * than returning `[]`, which is the guard the paragraph above exists for. This
 * is the shape the sibling pin in the same family already uses for a component
 * whose fetch was gated first — `__tests__/ObjectCalendar.expandFls-7230.test.tsx`.
 */
async function expandFor(): Promise<string[]> {
  const ds = makeDataSource();
  render(<ObjectGantt schema={GANTT_SCHEMA} dataSource={ds} />);
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  return (ds.find.mock.calls.at(-1)?.[1]?.$expand ?? []) as string[];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.isLoaded = true;
  state.readable = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectGantt — `$expand` is FLS-gated (objectui#7230)', () => {
  // ── PIN 1: the defect itself ────────────────────────────────────────────
  it('does NOT ask the server to EXPAND a lookup the principal cannot read', async () => {
    state.readable = ['id', 'name', 'start', 'end', 'project'];
    const expand = await expandFor();
    expect(
      expand,
      'with no column list this component expands EVERY declared relation, so a denied '
        + 'lookup is asked for by default rather than by configuration',
    ).not.toContain('secret_project');
  });

  // ── PIN 2: the live control — the gate narrows, it never empties ────────
  it('still expands a lookup the principal CAN read', async () => {
    state.readable = ['id', 'name', 'start', 'end', 'project'];
    const expand = await expandFor();
    expect(
      expand,
      'a gate that killed all expansion would paint raw foreign-key ids in every bar',
    ).toContain('project');
  });

  // ── PIN 3: `master_detail`, not only `lookup` ───────────────────────────
  it('gates a denied `master_detail` root too, not only `lookup`', async () => {
    state.readable = ['id', 'name', 'start', 'end', 'project'];
    const expand = await expandFor();
    expect(expand).not.toContain('owner_dept');
    expect(expand).toContain('project');
  });

  // ── PIN 4: the whole set, asserted exactly ─────────────────────────────
  it('sends exactly the readable relations — asserted as a set, not merely by absence', async () => {
    state.readable = ['id', 'name', 'start', 'end', 'project'];
    const expand = await expandFor();
    expect(
      expand.slice().sort(),
      'an absence assertion alone would also pass if the expansion had gone empty',
    ).toEqual(['project']);
  });

  // ── PIN 5: every relation denied → no widened expansion ────────────────
  it('sends no `$expand` when every declared relation is denied', async () => {
    state.readable = ['id', 'name', 'start', 'end'];
    const expand = await expandFor();
    expect(expand).toEqual([]);
  });

  // ── PIN 6: deferral — an unanswered policy filters nothing ─────────────
  it('filters NOTHING while `/me/permissions` has not answered', async () => {
    state.isLoaded = false;
    state.readable = [];
    const expand = await expandFor();
    expect(
      expand,
      'never filter on an unanswered policy — the no-provider default is `isLoaded: false` '
        + 'forever, and a gantt with no PermissionProvider must keep expanding',
    ).toEqual(expect.arrayContaining(['project', 'secret_project', 'owner_dept']));
  });
});
