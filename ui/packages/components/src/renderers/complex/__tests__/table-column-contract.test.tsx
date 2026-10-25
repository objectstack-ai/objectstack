/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5350 — the static `table` renderer reads ONLY the declared
 * `TableColumn` contract (`header` + `accessorKey`).
 *
 * This is the fourth site of the column-alias family ruled on #5120
 * (2026-08-20): "retire the consumer-side alias; unify the producers ...
 * declared `header`/`accessorKey` contract wins". Before that ruling this
 * renderer resolved a header as `col.header || col.label` and a cell as
 * `row[col.accessorKey || col.name]` — two undeclared aliases that
 * `packages/types/src/data-display.ts` never declared.
 *
 * The `name`/`label` assertions below are the ones that must FAIL before the
 * retirement and pass after it; the `header`/`accessorKey` assertions pin the
 * behaviour the retirement must NOT move.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Module-scope side-effect import, not a `beforeAll` — see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../index';

const ROWS = [{ name: 'Ada', role: 'Engineer' }];

const renderTable = (columns: unknown[]) =>
  render(<SchemaRenderer schema={{ type: 'table', columns, data: ROWS } as never} />);

describe('`table` resolves columns through the declared TableColumn contract only', () => {
  it('renders a column authored the declared way (header + accessorKey)', () => {
    const { container } = renderTable([
      { header: 'Name', accessorKey: 'name' },
      { header: 'Role', accessorKey: 'role' },
    ]);

    expect([...container.querySelectorAll('thead th')].map((e) => e.textContent)).toEqual([
      'Name',
      'Role',
    ]);
    expect([...container.querySelectorAll('tbody td')].map((e) => e.textContent)).toEqual([
      'Ada',
      'Engineer',
    ]);
  });

  it('does NOT resolve a cell through the retired `name` alias', () => {
    const { container } = renderTable([{ header: 'Name', name: 'name' }]);

    // The header is declared, so it still renders...
    expect(screen.getByText('Name')).toBeInTheDocument();
    // ...but `name` is not an accessor: the cell resolves to nothing.
    expect([...container.querySelectorAll('tbody td')].map((e) => e.textContent)).toEqual(['']);
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });

  it('does NOT resolve a header through the retired `label` alias', () => {
    const { container } = renderTable([{ label: 'Name', accessorKey: 'name' }]);

    // `accessorKey` is declared, so the cell still renders...
    expect(screen.getByText('Ada')).toBeInTheDocument();
    // ...but `label` is not a header: the heading resolves to nothing.
    expect([...container.querySelectorAll('thead th')].map((e) => e.textContent)).toEqual(['']);
    expect(screen.queryByText('Name')).not.toBeInTheDocument();
  });

  it('renders nothing for a fully alias-spelled column (the retired docs spelling)', () => {
    // Exactly the shape `content/docs/api/schema-reference.md` §TableSchema
    // published before this change: `{ name, label }`.
    const { container } = renderTable([{ name: 'name', label: 'Name' }]);

    expect([...container.querySelectorAll('thead th')].map((e) => e.textContent)).toEqual(['']);
    expect([...container.querySelectorAll('tbody td')].map((e) => e.textContent)).toEqual(['']);
  });

  it('legibility: an unresolvable column is kept, not dropped, and does not throw', () => {
    // Pinned as measured behaviour, NOT endorsed: the column keeps its slot and
    // its neighbour is unaffected. Unlike `data-table` (which keys cells by
    // `accessorKey` and so emits React's generic missing-key warning), this
    // renderer keys by index, so a retired-spelling column is fully SILENT.
    // Whether that silence should become a diagnostic is #5349's question, not
    // this card's — no diagnostic is implemented here.
    const { container } = renderTable([
      { name: 'name', label: 'Name' },
      { header: 'Role', accessorKey: 'role' },
    ]);

    expect(container.querySelectorAll('thead th')).toHaveLength(2);
    expect(container.querySelectorAll('tbody td')).toHaveLength(2);
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Engineer')).toBeInTheDocument();
  });
});
