/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7218 — the object-view host relays the active view's `rowColor`.
 *
 * ## The defect this pins
 *
 * `rowColor` is a declared member of `ListViewSchema` (imported by reference
 * from `@objectstack/spec`'s `ListViewSchema`, shape `{ field, colors? }`), and
 * `ListView` READS it: `ListView.tsx` seeds `rowColorConfig` state from
 * `schema.rowColor` and hands it to the grid, which colours whole rows from a
 * field value. The delegation branch below relays 46 keys off the active view
 * and `rowColor` had NO rung, so an authored per-view row colour could not
 * reach the renderer through this host at all.
 *
 * It is the "declared and inert" shape — the same one objectui#7199 fixed for
 * `description`: nothing errors, every authoring gate passes, the API serves
 * the value, and the only symptom is that the rows are not coloured. An author
 * has no way to notice short of diffing the DOM.
 *
 * ## Why this is a relay and not an intent question
 *
 * A sibling host already ships the key with no fence:
 * `packages/app-shell/src/views/InterfaceListPage.tsx` relays
 * `rowColor: view.rowColor` alongside `grouping` and `pagination` into a
 * schema typed `ListViewSchema`. So `rowColor` is demonstrably author-reachable
 * on the interface route already; the object-view route simply did not use the
 * delivery path. The rung added here copies that precedent verbatim.
 *
 * The legacy shorthand for the same feature — bare `color`, which
 * `list-view-spec-parity` records as "legacy row/text coloring shorthand
 * (spec-canonical: `rowColor`)" — was ALREADY relayed by this literal. Only the
 * spec-canonical spelling was missing.
 *
 * ## ⛔ The rung is view-sourced ONLY, and that is load-bearing
 *
 * The relay reads `activeView?.rowColor` and deliberately does NOT fall back to
 * `(schema as any).rowColor`. A cast read off the object-view NODE would add a
 * 28th key to the objectui#5097 HOST-COMPOSITION exemption — the maintainer
 * ruling of 2026-08-18 that fixed that set at 27 — and that is a ruling, not a
 * refactor. The last case in this file pins the narrowness so the shortcut
 * cannot be taken later without a test going red and naming the ledger.
 *
 * `grouping: activeView?.grouping` is the in-fence precedent for a view-only
 * rung carrying no cast read, and it is the control used below.
 *
 * ## Direction, written before the run (reverse verification)
 *
 * Deleting the `rowColor:` rung was PREDICTED to turn the two FIX cases RED
 * (`captured.rowColor` `undefined`) and to leave the three controls GREEN — the
 * `grouping` control rides its own untouched rung, and the two absence cases
 * assert `undefined`, which is what a missing rung produces. Predicted 2 red /
 * 3 passing. Measured outcome is recorded on the PR.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>,
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

const mockDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

/**
 * The row-colour configuration an author writes on a view — the spec's
 * `RowColorConfigSchema` shape (`field` plus an optional value/colour map).
 */
const ROW_COLOR = { field: 'stage', colors: { won: '#16a34a', lost: '#dc2626' } };
/** A grouping config on the SAME view — the control's payload. */
const GROUPING = { fields: [{ field: 'owner' }] };

/**
 * Render through the delegated `renderListView` slot and return the `list-view`
 * schema the host handed down. `views` is the prop segment `activeView` is
 * drawn from, which is the segment this relay reads.
 */
function delegatedSchema(
  views: any[] | undefined,
  nodeExtra: Record<string, unknown> = {},
): any {
  const seen: any[] = [];
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task', ...nodeExtra } as unknown as ObjectViewSchema}
      views={views}
      activeViewId={views?.[0]?.id}
      dataSource={mockDataSource() as any}
      renderListView={({ schema: s }: any) => {
        seen.push(s);
        return <div data-testid="delegated" />;
      }}
    />,
  );
  expect(seen.length).toBeGreaterThan(0);
  return seen[0];
}

/** One view entry, carrying whatever the case authors on it. */
const viewWith = (extra: Record<string, unknown>) => [
  { id: 'v1', label: 'By stage', type: 'grid' as const, columns: ['name'], ...extra },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ObjectView relays the active view rowColor (objectui#7218)', () => {
  it('THE FIX: a per-view `rowColor` reaches the host list renderer', () => {
    // Before the rung existed this was `undefined` for every view, which is the
    // whole of the reported defect.
    expect(delegatedSchema(viewWith({ rowColor: ROW_COLOR })).rowColor).toEqual(ROW_COLOR);
  });

  it('THE FIX: the config is relayed VERBATIM, not rebuilt or flattened', () => {
    // `ListView` seeds its `rowColorConfig` state from this value and reads
    // `.field` and `.colors` off it. A relay that reached for `.field` alone
    // would satisfy "a rowColor arrives" while dropping the author's palette.
    const relayed = delegatedSchema(viewWith({ rowColor: ROW_COLOR })).rowColor;
    expect(relayed).toEqual(ROW_COLOR);
    expect(relayed.colors).toEqual(ROW_COLOR.colors);
  });

  it('CONTROL: the neighbouring `grouping` rung still relays — green in both states', () => {
    // Legal before AND after the change: `grouping: activeView?.grouping` is an
    // existing view-only rung this diff does not touch. It proves the harness
    // actually exercises the relay, so a red FIX case above means "no rung",
    // not "the delegation branch never ran".
    const s = delegatedSchema(viewWith({ rowColor: ROW_COLOR, grouping: GROUPING }));
    expect(s.grouping).toEqual(GROUPING);
  });

  it('CONTROL: a view that authors no `rowColor` gets none — the relay invents nothing', () => {
    expect(delegatedSchema(viewWith({})).rowColor).toBeUndefined();
  });

  it('⛔ `rowColor` on the object-view NODE stays unreachable (the objectui#5097 ledger)', () => {
    // The rung is view-sourced only. Reading `(schema as any).rowColor` here
    // would promote a 28th key onto the HOST-COMPOSITION exemption whose count
    // the 2026-08-18 maintainer ruling fixed at 27, and
    // `objectViewHostSurface.test.tsx` would fail BY NAME. This case is the
    // early, readable half of that: it fails here first, and says why.
    expect(delegatedSchema(undefined, { rowColor: ROW_COLOR }).rowColor).toBeUndefined();
  });
});
