/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The BASIS of the objectui#5321 exemption, measured — plus the one behaviour
 * the card changed.
 *
 * ## What this file is for
 *
 * The maintainer ruled on 2026-08-20 that `tree` and `chart` stay
 * HOST-COMPOSITION-ONLY view types: recorded, not added to
 * `ObjectViewSchema.defaultViewType` / `NamedListView.type`. That record lives
 * in `OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES` (ObjectView.tsx) and is pinned
 * by `objectViewHostSurface.test.tsx`.
 *
 * An exemption of that shape is a claim about REACHABILITY — "an author cannot
 * select these, a host still can" — so the second half has to keep being
 * measured or the record quietly becomes a statement about nothing. That is
 * this file: a host `views` prop still drives `generateViewSchema` into both
 * branches, and both still emit their renderer schema.
 *
 * ## Why the other half is NOT tested here
 *
 * There is deliberately no "an author cannot reach it" runtime test. Types are
 * erased before this suite runs, so a schema with `defaultViewType: 'tree'`
 * force-cast past the compiler WOULD reach the branch at runtime — a test
 * asserting otherwise could only pass by testing something else. The authored
 * half is a compile-time claim and is pinned where it can actually fail: the
 * type-level assertions in `objectViewHostSurface.test.tsx`, which go red under
 * `pnpm --filter @object-ui/plugin-view type-check` the day either union grows
 * a `tree` or `chart` member.
 *
 * ## The behaviour the card changed
 *
 * `viewSwitcherSchema`'s `iconMap` had a `chart` key (added by objectui#2916)
 * and no `tree` one, so a host-supplied tree view fell through to the
 * `'table'` fallback and was labelled with the GRID icon. The console reaches
 * this: `CreateViewDialog` offers `tree` among the view types a user can
 * create, and those records arrive here as the `views` prop.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { icons } from 'lucide-react';
import type { ObjectViewSchema, ViewType } from '@object-ui/types';
import { ObjectView, OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES } from '../ObjectView';

/** Every schema handed to SchemaRenderer, in order. */
const rendered: any[] = [];
/** Every schema handed to the ViewSwitcher, in order. */
const switcherSchemas: any[] = [];

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
// The switcher is captured rather than rendered: the claim is about the icon
// NAME this component computes, and reading it off the props is the only way to
// see it without going through lucide's rendering.
vi.mock('../ViewSwitcher', () => ({
  ViewSwitcher: ({ schema }: any) => {
    switcherSchemas.push(schema);
    return <div data-testid="view-switcher" />;
  },
}));

const dataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

/** Compose the component the way a HOST does — the only path to these types. */
async function renderWithViews(
  views: Array<Record<string, unknown>>,
  schemaExtra: Record<string, unknown> = {},
) {
  rendered.length = 0;
  switcherSchemas.length = 0;
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task', ...schemaExtra } as ObjectViewSchema}
      views={views as never}
      dataSource={dataSource() as never}
    />,
  );
  await waitFor(() => expect(rendered.length + switcherSchemas.length).toBeGreaterThan(0));
}

// ---------------------------------------------------------------------------
// 1. The exemption's basis: a host `views` prop still reaches both branches.
// ---------------------------------------------------------------------------

describe('the host-only view types stay reachable from a `views` prop (objectui#5321)', () => {
  it('`tree` reaches the object-tree branch, with its `viewOptions.tree.*` surface', async () => {
    await renderWithViews([
      { id: 't', label: 'Tree', type: 'tree', tree: { parentField: 'parent_id', defaultExpandedDepth: 2 } },
    ]);
    const schema = rendered[rendered.length - 1];

    expect(
      schema?.type,
      'A host `views` prop no longer reaches `generateViewSchema`\'s `tree` branch. That branch being\n'
        + 'host-reachable IS the objectui#5321 exemption: the maintainer ruled `tree` recorded rather\n'
        + 'than declared BECAUSE hosts can still select it. With the reachability gone the record\n'
        + 'describes nothing, and the question goes back to the maintainer — it is not fixed by\n'
        + 'deleting this test.',
    ).toBe('object-tree');
    // The config surface the exemption specifically covers: host config, not
    // authoring surface, but read and forwarded all the same.
    expect(schema.parentField).toBe('parent_id');
    expect(schema.defaultExpandedDepth).toBe(2);
  });

  it('`chart` reaches the object-chart branch, in the ADR-0021 dataset shape', async () => {
    await renderWithViews([
      { id: 'c', label: 'Chart', type: 'chart', chart: { dataset: 'tasks_by_stage', dimensions: ['stage'], values: ['amount'] } },
    ]);
    const schema = rendered[rendered.length - 1];

    expect(
      schema?.type,
      'A host `views` prop no longer reaches `generateViewSchema`\'s `chart` branch — the same\n'
        + 'objectui#5321 reachability claim as `tree` above.',
    ).toBe('object-chart');
    expect(schema.dataset).toBe('tasks_by_stage');
    expect(schema.dimensions).toEqual(['stage']);
    expect(schema.xAxisKey).toBe('stage');
  });

  it('both recorded host-only types are covered by the two tests above', () => {
    // Guards the pair, not the prose: a third name joining the record without a
    // reachability test would leave the exemption half-measured.
    expect([...OBJECT_VIEW_HOST_COMPOSITION_VIEW_TYPES].sort()).toEqual(['chart', 'tree']);
  });
});

// ---------------------------------------------------------------------------
// 2. The behaviour objectui#5321 changed: the missing `tree` icon.
// ---------------------------------------------------------------------------

const switcherIcons = (): Record<string, string> =>
  Object.fromEntries(
    (switcherSchemas[switcherSchemas.length - 1]?.views ?? []).map(
      (v: { type: string; icon: string }) => [v.type, v.icon],
    ),
  );

/** Two views and the toggle on — the switcher's own preconditions. */
const renderSwitcherWith = (type: string) =>
  renderWithViews(
    [
      { id: 'g', label: 'Grid', type: 'grid' },
      { id: 'x', label: 'Other', type },
    ],
    { showViewSwitcher: true },
  );

describe('the view switcher labels every composed view type (objectui#5321)', () => {
  it('a host `tree` view gets the tree icon, not the `table` fallback', async () => {
    await renderSwitcherWith('tree');

    expect(
      switcherIcons().tree,
      'The `tree` entry is gone from `iconMap` again. Without it `tree` falls through to the\n'
        + "`|| 'table'` fallback and a tree view is labelled with the GRID icon — the objectui#5321\n"
        + 'gap, and the exact shape objectui#2916 already fixed once for `chart`.',
    ).toBe('list-tree');
    expect(switcherIcons().tree).not.toBe('table');
  });

  it('that name resolves to a real lucide icon', () => {
    // Load-bearing, and NOT implied by the assertion above: `ViewSwitcher`
    // renders `icons[toPascalCase(name)]` and draws NOTHING when the lookup
    // misses, so an icon name can be present, spelled plausibly, and still
    // produce no icon at all. Measured on lucide-react 1.31: `list-tree` is
    // `ListTree` and resolves.
    //
    // Scoped to `tree` here because this file is about the objectui#5321
    // exemption. The widening this comment used to forbid HAS LANDED: the two
    // sibling entries that did not resolve — `chart: 'bar-chart-3'` and
    // `gantt: 'gantt-chart'`, dropped from lucide's `icons` record while
    // surviving as deprecated named exports — are fixed by objectui#5586,
    // which pins EVERY name both maps supply in `ViewSwitcher.test.tsx`. The
    // pin lives there because the real component renders the names there, so
    // no hand-copied PascalCase mirror of `resolveIcon` can drift out from
    // under it (this file mocks `../ViewSwitcher` away).
    expect(icons.ListTree, '`list-tree` no longer resolves in lucide-react.').toBeTruthy();
  });

  it('agrees with the icon ViewSwitcher itself already names for `tree`', () => {
    // Why `list-tree` and not some other plausible glyph: the consumer of these
    // strings already answers that. Read from source rather than imported —
    // `DEFAULT_VIEW_ICONS` is module-private, and the point is that the two
    // sides of the same package do not drift apart silently.
    const path = [
      resolve(process.cwd(), 'src/ViewSwitcher.tsx'),
      resolve(process.cwd(), 'packages/plugin-view/src/ViewSwitcher.tsx'),
    ].find((candidate) => existsSync(candidate));
    expect(path, 'cannot locate plugin-view/src/ViewSwitcher.tsx').toBeTruthy();
    expect(
      readFileSync(path as string, 'utf8'),
      "`ViewSwitcher.DEFAULT_VIEW_ICONS` no longer maps `tree` to `ListTree`, so `iconMap`'s\n"
        + "`tree: 'list-tree'` has stopped agreeing with the default for the same view type. Move both\n"
        + 'or neither.',
    ).toContain('tree: ListTree');
  });

  it('an unrecognised type still falls back to `table` — the control', async () => {
    // Without this, "tree is not `table`" would also pass against a build where
    // the fallback had been deleted, and the fallback is what keeps an
    // unvalidated host prop from rendering a broken switcher.
    await renderSwitcherWith('not-a-view-type' as ViewType);
    expect(switcherIcons()['not-a-view-type']).toBe('table');
  });
});
