/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5125 — the "removing the shadowed renderer changes no reachable
 * behaviour" claim, as a test rather than an assertion.
 *
 * Two same-namespace duplicates were removed: `data-display/table.tsx`
 * (`SimpleTableRenderer`, shadowed by `complex/table.tsx`) and the `kbd` entry
 * in `basic/html-elements.tsx`'s `TAGS` loop (shadowed by
 * `data-display/kbd.tsx`). In both cases the SURVIVING renderer is the one that
 * already won at runtime, so every assertion below passes identically before
 * and after the deletion. That is the point: these pin the behaviour the
 * deletion must not move.
 *
 * The `bind` assertions also carry the finding recorded for objectui#5126: no
 * REACHABLE table renderer reads `bind`, while `list` and `tree-view` — the
 * other two `useDataScope` consumers — still do. If someone later teaches
 * `table` to read `bind` (deliberately NOT ruled on #5125, because it widens
 * the authorable key surface), the `table`-side assertion here goes red and
 * forces that expansion to be a decision instead of a side effect.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';
// Module-scope side-effect import, not a `beforeAll` — see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../index';
import type { DataSource } from '@object-ui/types';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are the `data` ROOT of the expression scope — the renderer binds
 * `SchemaRendererContext.dataSource` as `data` for every predicate, which is
 * the second meaning this one key carries.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

const PEOPLE = [
  { name: 'Ada', role: 'Engineer' },
  { name: 'Linus', role: 'Maintainer' },
];

const COLUMNS = [
  { header: 'Name', accessorKey: 'name' },
  { header: 'Role', accessorKey: 'role' },
];

// Each renderer is bound to data in the shape ITS contract documents:
// `table` takes record rows, `list` is data-as-nodes (`content`), `tree-view`
// takes `TreeNode`s (`label`). Binding all three to one record array would
// under-report `list`/`tree-view` as "renders nothing" for a reason that has
// nothing to do with whether `bind` was read.
const DATA_SOURCE = {
  users: PEOPLE,
  rows: [{ content: 'Ada' }, { content: 'Linus' }],
  treeNodes: [
    { id: 'ada', label: 'Ada' },
    { id: 'linus', label: 'Linus' },
  ],
};

const renderBound = (schema: Record<string, unknown>) =>
  render(
    <PredicateScopeProvider scope={DATA_SOURCE}>
      <SchemaRendererProvider dataSource={DATA_SOURCE as unknown as DataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>
    </PredicateScopeProvider>,
  );

describe('`table` keeps exactly the behaviour it has today (objectui#5125)', () => {
  it('renders inline `data` against `columns`', () => {
    const { container } = renderBound({ type: 'table', columns: COLUMNS, data: PEOPLE });

    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Linus')).toBeInTheDocument();
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.getByText('Maintainer')).toBeInTheDocument();
  });

  it('ignores `bind` — header renders, zero rows, and no "No results." row', () => {
    // Reproduces the probe that found #5125: a 2-row binding renders a header
    // and nothing else. The absent "No results." row is the discriminator —
    // the shadowed `SimpleTableRenderer` emitted one for empty data, so its
    // absence proves `complex/table.tsx` is what serves the `table` key.
    const { container } = renderBound({ type: 'table', columns: COLUMNS, bind: 'users' });

    expect(container.querySelectorAll('thead th')).toHaveLength(2);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(screen.queryByText('No results.')).not.toBeInTheDocument();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('still serves `caption` and `footer`, which only `complex/table.tsx` supports', () => {
    // A positive identity check on the surviving renderer, so this file cannot
    // be satisfied by *no* table renderer being registered at all.
    const { container } = renderBound({
      type: 'table',
      columns: COLUMNS,
      data: PEOPLE,
      caption: 'Team',
      footer: '2 people',
    });

    expect(container.querySelector('caption')).toHaveTextContent('Team');
    expect(container.querySelector('tfoot')).toHaveTextContent('2 people');
  });
});

describe('the other two `useDataScope` consumers still read `bind` (objectui#5125)', () => {
  it('`list` renders bound rows', () => {
    const { container } = renderBound({ type: 'list', bind: 'rows' });

    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Linus')).toBeInTheDocument();
  });

  it('`tree-view` renders bound nodes', () => {
    renderBound({ type: 'tree-view', bind: 'treeNodes' });

    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Linus')).toBeInTheDocument();
  });
});

describe('`kbd` keeps the renderer that already won (objectui#5125)', () => {
  it('renders one <kbd> per entry in the `keys` array', () => {
    // `data-display/kbd.tsx` reads `schema.keys`; the `basic/html-elements.tsx`
    // pass-through that was removed from the `TAGS` loop did not — it would
    // have rendered a single empty <kbd>. Two elements prove the surviving
    // renderer is the one that served this key before the removal too.
    const { container } = renderBound({ type: 'kbd', keys: ['Ctrl', 'K'] });

    expect(container.querySelectorAll('kbd')).toHaveLength(2);
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
  });
});
