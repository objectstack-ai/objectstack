/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6557 — the object page's seven view-config `titleField` seams answer
 * with ONE shape.
 *
 * Five of them used to carry a three-rung chain with an object-level
 * `objectDef.titleField` in the middle (timeline, kanban, map, gallery, tree),
 * while calendar and gantt in the same object literal already used two rungs
 * (`viewDef.<kind>?.titleField || 'name'`). So this is not a removal — it is
 * five sites converging on the shape two sibling sites already had.
 *
 * WHY THE MIDDLE RUNG COULD NEVER FIRE LEGALLY. `@objectstack/spec`'s object
 * schema is a `strictObject`: `ObjectSchema.safeParse({…, titleField: 'x' })`
 * is REJECTED with `unrecognized_keys` — the same issue code a nonsense key
 * gets — while `nameField`, `displayNameField` and `titleFormat` all parse
 * (measured against `@objectstack/spec@17.2.0`, the dist this repo installs).
 * objectui#6531 established that and dropped the twin read inside
 * `getRecordDisplayName`.
 *
 * BOTH DIRECTIONS ARE PINNED, because proving only the first is
 * evidence-identical to having broken the fallback chain outright:
 *
 *   - THE FIX — an object carrying the contract-rejected `titleField` no longer
 *     has it honoured anywhere. The value used here is `'headline'`, chosen so
 *     it is DISTINGUISHABLE from the `'name'` floor; a fixture spelling
 *     `titleField: 'name'` cannot tell the two worlds apart, which is exactly
 *     how the retired fixtures in `ObjectView.timelineBinding.test.tsx` and
 *     `useRecordSearch.test.ts` passed while measuring nothing.
 *   - THE CONTROLS — a LEGAL config resolves identically before and after: a
 *     view that declares its own `titleField` still wins on every kind, and a
 *     view that declares none still floors at `'name'`. Both are green in
 *     either world.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed; see
 * the PR body. Restore any one of the five middle rungs and the "does not
 * honour" case goes RED for that kind alone (it reads `'headline'`), while both
 * control cases and the calendar/gantt columns stay green.
 *
 * ⚠️ FIXTURE TRIAGE, objectui#7029. The `calendar` column below used to read
 * `'name'` for a view that declared nothing, and was cited here as one of the
 * two seams that "already used two rungs". objectui#7029 (ruled on
 * objectstack#13748) deleted the calendar seam outright: a view with no
 * `calendar:` block now yields NO `options.calendar` at all, because the
 * fabricated `startDateField: 'due_date'` / `titleField: 'name'` pair made
 * `ObjectCalendar`'s refusal screen unreachable. So this file's calendar column
 * is `undefined` for an undeclared view — the assertions were RETARGETED, not
 * respelled, and the seam count below dropped from seven to six. What objectui#6557
 * actually owns is unchanged and still pinned: no seam reads `objectDef`, and
 * every seam that still HAS a floor is a chain of view-declared rungs. The
 * declared-config control two cases down is the one that proves the retarget
 * did not simply delete coverage: `calendar: 'v_calendar'` still resolves.
 *
 * The last case is structural rather than behavioural on purpose: the four
 * inline seams are closures inside `ObjectViewInner`, and "these five now have
 * the same SHAPE as those two" is a statement about the expressions, not about
 * one pair of values. Same posture as `view-filter-fold.ratchet.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      isLoaded: false,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

/** The list schema this page hands down — captured, not rendered. */
let captured: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    captured = props.schema;
    return null;
  },
}));

// The plugin owns the view chrome; this page owns `renderListView`, which is
// what builds the `options` payload under test. The stub drives that render
// prop directly so the assertion is about THIS file's seams.
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: (props: any) =>
    props.renderListView?.({
      schema: props.schema ?? {},
      dataSource: props.dataSource,
      onEdit: props.onEdit,
      className: '',
      refreshKey: 0,
    }) ?? null,
  ViewTabBar: () => null,
  ManageViewsDialog: () => null,
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'showcase_invoice';

/** The contract-rejected object-level key, spelled so it cannot be the floor. */
const REJECTED = 'headline';

function objectsWith(objectExtra: Record<string, unknown>, view: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Invoice',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        headline: { type: 'text', label: 'Headline' },
      },
      listViews: {
        primary: { label: 'All', type: 'grid', columns: ['name'], ...view },
      },
      ...objectExtra,
    },
  ];
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** Render the object list and return the seven resolved seams. */
async function resolveSeams(objects: any[]) {
  captured = null;
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={makeDataSource()} objects={objects} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await waitFor(() => {
    expect(captured?.options).toBeTruthy();
  });
  const o = captured.options;
  return {
    timeline: o.timeline?.titleField,
    kanban: o.kanban?.titleField,
    map: o.map?.titleField,
    gallery: o.gallery?.titleField,
    tree: o.tree?.labelField,
    // The two that were already two-rung — the evidence, never edited.
    calendar: o.calendar?.titleField,
    gantt: o.gantt?.titleField,
  };
}

beforeEach(() => {
  cleanup();
  captured = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ObjectView view-config `titleField` — the middle rung is gone (objectui#6557)', () => {
  it('THE FIX: an object-level `titleField` is honoured by NO view kind', async () => {
    const seams = await resolveSeams(objectsWith({ titleField: REJECTED }, {}));

    // Every kind floors at 'name'. Before this change the five would each read
    // 'headline' while calendar/gantt read 'name' — the divergence itself.
    expect(seams).toEqual({
      timeline: 'name',
      kanban: 'name',
      map: 'name',
      gallery: 'name',
      tree: 'name',
      // objectui#7029: the calendar seam no longer exists — an undeclared view
      // gets no `options.calendar` bag, so there is no title to floor.
      calendar: undefined,
      gantt: 'name',
    });
  });

  it("CONTROL: a legal view that declares nothing still floors at 'name'", async () => {
    const seams = await resolveSeams(objectsWith({}, {}));

    expect(seams).toEqual({
      timeline: 'name',
      kanban: 'name',
      map: 'name',
      gallery: 'name',
      tree: 'name',
      // objectui#7029: the calendar seam no longer exists — an undeclared view
      // gets no `options.calendar` bag, so there is no title to floor.
      calendar: undefined,
      gantt: 'name',
    });
  });

  it("CONTROL: a legal view's OWN declared `titleField` still wins on every kind", async () => {
    // Declared per-kind view keys — real, spec-declared, and untouched by this
    // change. Each is distinct so a seam reading the wrong kind's config fails
    // here instead of passing by coincidence. The object ALSO carries the
    // rejected key, so this doubles as proof the removal did not simply
    // hard-code the floor.
    const seams = await resolveSeams(
      objectsWith(
        { titleField: REJECTED },
        {
          timeline: { titleField: 'v_timeline' },
          kanban: { titleField: 'v_kanban' },
          map: { titleField: 'v_map' },
          gallery: { titleField: 'v_gallery' },
          tree: { labelField: 'v_tree' },
          calendar: { titleField: 'v_calendar' },
          gantt: { titleField: 'v_gantt' },
        },
      ),
    );

    expect(seams).toEqual({
      timeline: 'v_timeline',
      kanban: 'v_kanban',
      map: 'v_map',
      gallery: 'v_gallery',
      tree: 'v_tree',
      calendar: 'v_calendar',
      gantt: 'v_gantt',
    });
  });

  it("the tree's retired `tree.titleField` rung answers nothing (objectui#6152 round 14)", async () => {
    // The tree seam used to be the only one with TWO view-declared rungs, and
    // this case pinned that dropping the object rung had not collapsed them. The
    // second rung read a key the spec refuses by name on the tree block
    // (objectui#8841), and objectui#6152 round 14 retired it, so a stored
    // `tree.titleField` now floors at 'name' like an undeclared label. The
    // declared `labelField` still wins (the CONTROL above).
    const seams = await resolveSeams(
      objectsWith({ titleField: REJECTED }, { tree: { titleField: 'v_tree_title' } }),
    );
    expect(seams.tree).toBe('name');
  });
});

describe('the seven seams share ONE expression shape (objectui#6557)', () => {
  const SOURCE = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ObjectView.tsx'),
    'utf8',
  );

  /** Every `titleField:` / `labelField:` assignment in the file. */
  const seamLines = SOURCE.split('\n').filter((l) => /^\s*(titleField|labelField):/.test(l));

  it('there are exactly six of them', () => {
    // Seven until objectui#7029 removed the calendar seam. The count is the
    // tripwire: a new view kind copied from a sibling shows up here first.
    expect(seamLines).toHaveLength(6);
  });

  it('and the calendar seam is not one of them', () => {
    // Pinned explicitly rather than left implicit in the count above, so a
    // future edit that re-adds a calendar title floor fails with the reason
    // rather than with an off-by-one (objectui#7029).
    expect(seamLines.filter((l) => /calendar/.test(l))).toEqual([]);
  });

  it('none reads the object definition', () => {
    // The invariant this card restores. A new view kind copied from a sibling
    // cannot reintroduce the rung without failing here.
    for (const line of seamLines) expect(line).not.toMatch(/objectDef/);
  });

  it("each is a chain of view-declared rungs floored at 'name'", () => {
    for (const line of seamLines) {
      expect(line).toMatch(/viewDef/);
      expect(line.trimEnd()).toMatch(/\|\| 'name',$/);
    }
  });
});
