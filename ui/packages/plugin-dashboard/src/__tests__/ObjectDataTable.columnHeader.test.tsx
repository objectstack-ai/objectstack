/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectDataTable` resolves a column's DISPLAY TEXT at the producer, before
 * data-table (objectui#5351) — the header counterpart of the identity stamp
 * objectui#5120 put in the same function.
 *
 * The spec spells a column's text `ListColumnSchema.label`; the data-table
 * adapter spells it `TableColumn.header` and, since the maintainer ruling of
 * 2026-08-20, reads only that. So the translation happens HERE, once, or the
 * column arrives headerless.
 *
 * This is a FIX and not only a move, which is the part worth pinning: a
 * `label`-spelled column rendered a BLANK header on this widget even while the
 * adapter's alias still existed. `enrich` spreads `buildFieldMeta`'s result over
 * every column, and that result carries its own `label` (built from
 * `col.header`), so an authored `label` was overwritten with `undefined` before
 * it ever reached the alias. Measured on `origin/main`, not assumed:
 *
 *   { label: 'Stage', accessorKey: 'stage' }  ->  headers=[""]  cells=["Won","Lost"]
 *   { field: 'stage', label: 'Stage' }        ->  headers=[""]  cells=["Won","Lost"]
 *
 * Both now render "Stage".
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';

// The REAL renderers: `@object-ui/components` registers `data-table` as an
// import side effect, and these pins resolve through that seam rather than a
// stand-in that would re-implement the adapter's header rule.
import '@object-ui/components';

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    SchemaRenderer: ({ schema }: any) => {
      const Cmp = ComponentRegistry.get(schema.type) as any;
      if (!Cmp) throw new Error(`${schema.type} not registered`);
      return <Cmp schema={schema} />;
    },
    useDataScope: () => undefined,
    SchemaRendererContext: actual.SchemaRendererContext,
  };
});

import { ObjectDataTable, normalizeColumns } from '../ObjectDataTable';

const ROWS = [
  { id: '1', stage: 'Won' },
  { id: '2', stage: 'Lost' },
];

function renderWidget(columns: unknown[]) {
  return render(
    <ObjectDataTable
      schema={{ type: 'object-data-table', data: ROWS, columns, pagination: false, searchable: false } as any}
    />,
  );
}

const headers = () =>
  Array.from(document.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
const bodyCells = () =>
  Array.from(document.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());

describe('ObjectDataTable — normalizeColumns stamps the adapter header (#5351)', () => {
  it('maps the spec-canonical `label` onto the adapter key `header`', () => {
    expect(normalizeColumns([{ field: 'stage', label: 'Stage' }])).toEqual([
      { field: 'stage', label: 'Stage', accessorKey: 'stage', header: 'Stage' },
    ]);
  });

  it('never overwrites an author-supplied `header`, even against a divergent `label`', () => {
    // The same rule `accessorKey` gets: an author who wrote the adapter's own
    // key addressed the table directly and is not second-guessed.
    expect(normalizeColumns([{ field: 'stage', label: 'ignored', header: 'Stage' }])).toEqual([
      { field: 'stage', label: 'ignored', header: 'Stage', accessorKey: 'stage' },
    ]);
  });

  it('stamps a header even when the identity needs no stamping', () => {
    // The two halves are independent: an `accessorKey`-spelled column with a
    // `label` needs the header translation and nothing else.
    expect(normalizeColumns([{ accessorKey: 'stage', label: 'Stage' }])).toEqual([
      { accessorKey: 'stage', label: 'Stage', header: 'Stage' },
    ]);
  });

  it('invents no header for a column that carries no display text', () => {
    const bare = { field: 'stage' };
    expect(normalizeColumns([bare])).toEqual([{ field: 'stage', accessorKey: 'stage' }]);
    expect(normalizeColumns([bare])[0]).not.toHaveProperty('header');
  });

  it('returns an already-canonical entry BY REFERENCE', () => {
    // Load bearing, not a micro-optimisation: data-table re-seeds its column
    // state whenever the list is a new object (objectui#4618) and this widget
    // rebuilds its node on every render. The added header branch must not cost
    // that stability.
    const authored = { accessorKey: 'stage', header: 'Stage' };
    expect(normalizeColumns([authored])[0]).toBe(authored);
  });

  it('returns a wholly unresolvable entry BY REFERENCE too', () => {
    const orphan = { width: 120 };
    expect(normalizeColumns([orphan])[0]).toBe(orphan);
  });

  it('ignores a non-string `label` rather than stamping an object into the header', () => {
    // `asIdentity` in `column-identity.ts` accepts only a non-empty string, so
    // an i18n record or a stray number never becomes a header.
    const weird = { accessorKey: 'stage', label: { en: 'Stage' } };
    expect(normalizeColumns([weird as any])[0]).not.toHaveProperty('header');
  });
});

describe('ObjectDataTable to data-table — the header reaches the screen (#5351)', () => {
  beforeAll(() => {
    expect(ComponentRegistry.has('data-table')).toBe(true);
  });

  it('renders the header of a `label`-spelled column', () => {
    renderWidget([{ label: 'Stage', accessorKey: 'stage' }]);
    expect(headers()).toEqual(['Stage']);
    expect(bodyCells()).toEqual(['Won', 'Lost']);
    expect(screen.getByText('Stage')).toBeInTheDocument();
  });

  it('renders header AND cells for a fully spec-spelled column', () => {
    // Both halves of the ruling at once: `field` -> `accessorKey` (#5120) and
    // `label` -> `header` (#5351), resolved in one place before delivery.
    renderWidget([{ field: 'stage', label: 'Stage' }]);
    expect(headers()).toEqual(['Stage']);
    expect(bodyCells()).toEqual(['Won', 'Lost']);
  });

  it('renders a declared `header` / `accessorKey` column exactly as before', () => {
    renderWidget([{ header: 'Stage', accessorKey: 'stage' }]);
    expect(headers()).toEqual(['Stage']);
    expect(bodyCells()).toEqual(['Won', 'Lost']);
  });
});
