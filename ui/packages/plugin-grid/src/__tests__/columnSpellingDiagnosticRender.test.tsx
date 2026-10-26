/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A dropped column now leaves a receipt (objectui#5349) — measured through a
 * real render, not through the pure helper.
 *
 * `columnSpellingDiagnostics.test.ts` pins the message. This file pins the two
 * things only a render can answer: that the DIAGNOSTIC fires where the grid
 * actually drops a column, and — the half that matters more — that it stays
 * quiet on every configuration that legitimately renders. `object-grid` draws
 * its rows from five different places, and a diagnostic that painted a
 * configuration error over one of them would be worse than the silence it
 * replaces, so each is pinned here with BOTH legs: clean columns → no
 * diagnostic and rows on screen, then the same configuration with one
 * mis-spelled column → exactly one diagnostic naming it.
 *
 * That second leg is also the counter-probe for every zero asserted here: the
 * capture that reports "no diagnostics" is the same capture that reports one a
 * moment later, in the same configuration.
 *
 * The rendering itself is UNCHANGED by this card — the header/cell readings
 * below are byte-identical to the ones objectui#5349 measured on `main` before
 * it. The diagnostic is additive.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';

registerAllFields();

const ROWS = [
  { id: '1', name: 'Ada', amount: 100 },
  { id: '2', name: 'Grace', amount: 200 },
];

/** The one channel this card adds — matched by its prefix, so unrelated console noise cannot pass for it. */
const DIAGNOSTIC_PREFIX = '[ObjectUI] ObjectGrid columns:';

/**
 * Render a grid and capture the diagnostics it emits.
 *
 * `props` carries the host-side halves — the `data` React prop a host like
 * `plugin-list`'s `ListView` passes down — so the same helper covers a
 * schema-driven grid and a host-driven one.
 */
function renderGrid(
  schema: Record<string, unknown>,
  options: { props?: Record<string, unknown>; scopeData?: unknown } = {},
): { diagnostics: string[]; headers: string[] } {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const grid = <ObjectGrid schema={{ type: 'object-grid', ...schema } as any} {...(options.props ?? {})} />;
  render(
    <ActionProvider>
      {options.scopeData !== undefined
        ? (
          // objectui#9308 — `bind` resolves the ambient predicate scope, not the
          // injected adapter. The adapter seam is still crossed (it is what a
          // real host mounts) and is inert for this assertion.
          <PredicateScopeProvider scope={options.scopeData as Record<string, unknown>}>
            <SchemaRendererProvider dataSource={options.scopeData as any}>{grid}</SchemaRendererProvider>
          </PredicateScopeProvider>
        )
        : grid}
    </ActionProvider>,
  );
  const diagnostics = warn.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith(DIAGNOSTIC_PREFIX));
  warn.mockRestore();
  return {
    diagnostics,
    // `queryAll`, not `getAll`: a grid with no row draws its empty state in
    // place of the table (objectui#13142), so it has no header to read. Every
    // row that reads headers asserts the exact list, which an empty one fails.
    headers: screen.queryAllByRole('columnheader').map((h) => (h.textContent ?? '').trim()),
  };
}

/**
 * ⭐ objectui#8348 — the SCHEMA-carried inline rows below are spelled
 * `data: { provider: 'value', items: ROWS }`, not the bare `data: ROWS` this
 * file used to write. `object-grid`'s published `data` row is the `ViewData`
 * union, whose own spec description says "the bare-array shortcut is refused",
 * so `getDataConfig` no longer lifts an array. The declared form resolves to the
 * identical config, which is why nothing this file measures moves.
 *
 * ⛔ TWO ROWS DELIBERATELY KEEP THE BARE ARRAY, and they are not oversights:
 * the host-prop row passes rows through the `data` REACT PROP, a different
 * carrier that requires an array (`passedData`'s `Array.isArray`) and is
 * untouched by the ruling; and the row named for objectui#8348 keeps the bare
 * array under the schema key precisely to assert that it no longer carries
 * rows.
 */

afterEach(() => cleanup());

describe('objectui#5349 — the four-way matrix, rendering and diagnostic together', () => {
  it('field-only: renders both columns, says nothing', () => {
    const { headers, diagnostics } = renderGrid({
      objectName: 'opportunities',
      data: { provider: 'value', items: ROWS },
      columns: [{ field: 'name', label: 'Name' }, { field: 'amount', label: 'Amount' }],
    });
    expect(headers).toEqual(['#', 'Name', 'Amount']);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(diagnostics).toEqual([]);
  });

  it('accessorKey-only: header-only grid — and now a diagnostic that says which columns and why', () => {
    // THE card. Before this landed the reading below was identical except for
    // an empty `diagnostics` array: a grid with its row-number column, no data
    // columns, and no error, no warning, no empty state.
    const { headers, diagnostics } = renderGrid({
      objectName: 'opportunities',
      data: { provider: 'value', items: ROWS },
      columns: [{ accessorKey: 'name', header: 'Name' }, { accessorKey: 'amount', header: 'Amount' }],
    });
    expect(headers).toEqual(['#']);
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("object-grid (objectName: 'opportunities')");
    expect(diagnostics[0]).toContain('2 of 2 authored columns resolve to nothing');
    expect(diagnostics[0]).toContain('row-number column and NO data columns');
    expect(diagnostics[0]).toContain("columns[0]: keys seen: `accessorKey`, `header`");
    expect(diagnostics[0]).toContain("Write `{ field: 'name', label: 'Name' }` instead.");
    expect(diagnostics[0]).toContain("Write `{ field: 'amount', label: 'Amount' }` instead.");
  });

  it('mixed, declared first: drops the second — and names the second', () => {
    const { headers, diagnostics } = renderGrid({
      objectName: 'opportunities',
      data: { provider: 'value', items: ROWS },
      columns: [{ field: 'name', label: 'Name' }, { accessorKey: 'amount', header: 'Amount' }],
    });
    expect(headers).toEqual(['#', 'Name']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('1 of 2 authored columns resolve to nothing');
    expect(diagnostics[0]).toContain('columns[1]');
    expect(diagnostics[0]).not.toContain('columns[0]');
  });

  it('mixed, undeclared first: same drop, same address — order does not change the answer', () => {
    // The retired tolerance branch sniffed `columns[0]` alone, so this ordering
    // used to THROW mid-render while the other silently dropped a column. The
    // diagnostic inherits the per-column judgement, not the sniff.
    const { headers, diagnostics } = renderGrid({
      objectName: 'opportunities',
      data: { provider: 'value', items: ROWS },
      columns: [{ accessorKey: 'amount', header: 'Amount' }, { field: 'name', label: 'Name' }],
    });
    expect(headers).toEqual(['#', 'Name']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('columns[0]');
    expect(diagnostics[0]).not.toContain('columns[1]');
  });
});

describe('objectui#5349 — the column-side fallbacks that keep their silence', () => {
  it('a `string[]` column list is the other declared spelling: renders, says nothing', () => {
    const { headers, diagnostics } = renderGrid({
      objectName: 'opportunities',
      data: { provider: 'value', items: ROWS },
      columns: ['name', 'amount'],
    });
    expect(headers).toEqual(['#', 'Name', 'Amount']);
    expect(diagnostics).toEqual([]);
  });

  it('no `columns` at all: the grid auto-derives them and is not scolded for it', () => {
    const { headers, diagnostics } = renderGrid({ objectName: 'opportunities', data: { provider: 'value', items: ROWS } });
    expect(headers).toEqual(['#', 'Id', 'Name', 'Amount']);
    expect(diagnostics).toEqual([]);
  });

  it('an empty `columns` array: same auto-derivation, same silence', () => {
    const { headers, diagnostics } = renderGrid({ objectName: 'opportunities', data: { provider: 'value', items: ROWS }, columns: [] });
    expect(headers).toEqual(['#', 'Id', 'Name', 'Amount']);
    expect(diagnostics).toEqual([]);
  });

  it('`hidden: true` on every column: authored intent, not a defect', () => {
    // Renders exactly like the accessorKey-only case above — header-only — and
    // is the reason the diagnostic cannot be "the grid ended up with no
    // columns". The author asked for this one.
    const { headers, diagnostics } = renderGrid({
      objectName: 'opportunities',
      data: { provider: 'value', items: ROWS },
      columns: [{ field: 'name', label: 'Name', hidden: true }],
    });
    expect(headers).toEqual(['#']);
    expect(diagnostics).toEqual([]);

    // Counter-probe: the same grid, one column mis-spelled instead of hidden.
    cleanup();
    const probe = renderGrid({
      objectName: 'opportunities',
      data: { provider: 'value', items: ROWS },
      columns: [{ accessorKey: 'name', header: 'Name' }],
    });
    expect(probe.headers).toEqual(['#']);
    expect(probe.diagnostics).toHaveLength(1);
  });
});

describe('objectui#5349 — the row-side fallbacks a `needs columns` predicate would have broken', () => {
  /**
   * Each of the five places `object-grid` gets rows from, twice: clean columns
   * must render and stay silent, and the same configuration with one bad
   * column must produce exactly one diagnostic. The second leg is what makes
   * the first leg's zero mean something.
   */
  const GOOD = [{ field: 'name', label: 'Name' }];
  const BAD = [{ accessorKey: 'name', header: 'Name' }];

  it('⭐ objectui#8348 — a bare `data` array no longer carries inline rows, and the diagnostic is unmoved', () => {
    // This row used to read "inline rows as a bare `data` array" and assert that
    // `Ada` was on screen. `object-grid`'s published `data` row is the `ViewData`
    // union — its own spec description says "the bare-array shortcut is refused"
    // — so `getDataConfig` no longer lifts the array and this grid resolves its
    // `objectName` instead (with no dataSource here, that draws no rows).
    //
    // The file's own subject is unaffected, which is the point of keeping the
    // row: the column-spelling diagnostic is a statement about `columns`, not
    // about the row carrier, so it stays silent for GOOD and fires once for BAD
    // on a grid with no rows at all.
    const ok = renderGrid({ objectName: 'opportunities', data: ROWS, columns: GOOD });
    // No row, so the grid draws its own empty state in place of the table and
    // its headers (objectui#13142): the block rendered, with nothing to show.
    expect(screen.getByTestId('object-grid-empty-state')).toBeInTheDocument();
    expect(ok.headers).toEqual([]);
    expect(screen.queryByText('Ada')).toBeNull();
    expect(ok.diagnostics).toEqual([]);

    cleanup();
    expect(renderGrid({ objectName: 'opportunities', data: ROWS, columns: BAD }).diagnostics).toHaveLength(1);
  });

  it("inline rows as `data: { provider: 'value', items }` — the declared shape", () => {
    const schema = { objectName: 'opportunities', data: { provider: 'value', items: ROWS } };
    const ok = renderGrid({ ...schema, columns: GOOD });
    expect(ok.headers).toEqual(['#', 'Name']);
    expect(screen.getByText('Grace')).toBeInTheDocument();
    expect(ok.diagnostics).toEqual([]);

    cleanup();
    expect(renderGrid({ ...schema, columns: BAD }).diagnostics).toHaveLength(1);
  });

  it('legacy `staticData`', () => {
    const ok = renderGrid({ objectName: 'opportunities', staticData: ROWS, columns: GOOD });
    expect(ok.headers).toEqual(['#', 'Name']);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(ok.diagnostics).toEqual([]);

    cleanup();
    expect(renderGrid({ objectName: 'opportunities', staticData: ROWS, columns: BAD }).diagnostics).toHaveLength(1);
  });

  it('`bind` — rows resolved from the surrounding data scope', () => {
    const scopeData = { rows: ROWS };
    const ok = renderGrid({ bind: 'rows', columns: GOOD }, { scopeData });
    expect(ok.headers).toEqual(['#', 'Name']);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(ok.diagnostics).toEqual([]);

    cleanup();
    expect(renderGrid({ bind: 'rows', columns: BAD }, { scopeData }).diagnostics).toHaveLength(1);
  });

  it('a HOST that owns the fetch and passes the window down as a `data` React prop', () => {
    // What `plugin-list`'s `ListView` does. Note the schema carries NO data key
    // at all here — the rows arrive as a prop, which is why a predicate built
    // on `'data' in props` would have been wrong in both directions.
    const ok = renderGrid({ objectName: 'opportunities', columns: GOOD }, { props: { data: ROWS } });
    expect(ok.headers).toEqual(['#', 'Name']);
    expect(screen.getByText('Grace')).toBeInTheDocument();
    expect(ok.diagnostics).toEqual([]);

    cleanup();
    expect(
      renderGrid({ objectName: 'opportunities', columns: BAD }, { props: { data: ROWS } }).diagnostics,
    ).toHaveLength(1);
  });
});
