/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12375 — a row's tint reaches every STICKY cell of the row: the
 * selection checkbox, the row number, the frozen columns and a right-pinned
 * column.
 *
 * A row carries its tint as the `--os-row-tint` custom property (`rowColor`
 * through `ObjectGrid`'s `rowClassName`). Each sticky cell paints an opaque
 * `bg-background` of its own, because content scrolls beneath it; it now
 * layers the row's tint over that fill as a background image, so it shows the
 * row's colour and stays opaque in both themes.
 *
 * happy-dom loads no stylesheet, so these pins read classes, not painted
 * colour; the painted colours were measured once in Chromium for the PR.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

function DataTable(props: { schema: Record<string, unknown> }) {
  const Impl = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: unknown }> | undefined;
  if (!Impl) throw new Error('data-table not registered');
  return <Impl schema={props.schema} />;
}

/** The layer every sticky body cell paints over its opaque fill. */
const STICKY_ROW_TINT =
  'bg-[image:linear-gradient(var(--os-row-tint,transparent),var(--os-row-tint,transparent))]';
/** What `useRowColor` hands the table for `red` (`@object-ui/plugin-grid`). */
const RED_TINT =
  'bg-[color:var(--os-row-tint)] [--os-row-tint:var(--color-red-100)] dark:[--os-row-tint:color-mix(in_oklab,var(--color-red-950)_40%,transparent)]';
/** A right-pinned column's cell classes, as `ObjectGrid` produces them. */
const PINNED_HEADER = 'sticky right-0 z-10 bg-background border-l border-border';
const PINNED_CELL = `sticky right-0 z-10 bg-background ${STICKY_ROW_TINT} border-l border-border`;

const tokens = (cls: string) => cls.split(/\s+/).filter(Boolean);

function renderTable() {
  render(
    <DataTable
      schema={{
        type: 'data-table',
        data: [
          { id: '1', name: 'Tinted', owner: 'O1', actions: 'A1', tint: true },
          { id: '2', name: 'Plain', owner: 'O2', actions: 'A2', tint: false },
        ],
        columns: [
          { header: 'Name', accessorKey: 'name' },
          { header: 'Owner', accessorKey: 'owner' },
          { header: 'Actions', accessorKey: 'actions', className: PINNED_HEADER, cellClassName: PINNED_CELL },
        ],
        selectable: true,
        showRowNumbers: true,
        frozenColumns: 1,
        rowClassName: (row: { tint: boolean }) => (row.tint ? RED_TINT : undefined),
        pagination: false,
        searchable: false,
      }}
    />,
  );
}

const rowOf = (label: string) => screen.getByText(label).closest('tr') as HTMLTableRowElement;
const cellsOf = (tr: HTMLTableRowElement) => Array.from(tr.querySelectorAll(':scope > td')) as HTMLElement[];
const stickyCells = (tr: HTMLTableRowElement) => cellsOf(tr).filter((td) => tokens(td.className).includes('sticky'));

afterEach(() => cleanup());

describe('data-table carries a row tint into the row\'s sticky cells (objectui#12375)', () => {
  it('CONTROL: the leading cell, the frozen column and the right-pinned column are the sticky cells', () => {
    renderTable();
    const tr = rowOf('Tinted');
    const cells = cellsOf(tr);
    // checkbox-and-number (one leading cell since objectui#12423) · Name · Owner · Actions
    expect(cells).toHaveLength(4);
    expect(stickyCells(tr)).toEqual([cells[0], cells[1], cells[3]]);
  });

  it('a tinted row\'s sticky cells layer the tint over an opaque fill', () => {
    renderTable();
    const tr = rowOf('Tinted');
    expect(tokens(tr.className)).toContain('[--os-row-tint:var(--color-red-100)]');
    expect(tokens(tr.className), 'the tint replaced the row\'s "no tint" default').not.toContain('[--os-row-tint:transparent]');
    for (const td of stickyCells(tr)) {
      const t = tokens(td.className);
      expect(t).toContain(STICKY_ROW_TINT);
      // Opaque: the cell's only unconditional background colour is the theme's.
      expect(t.filter((c) => c.startsWith('bg-') && !c.startsWith('bg-[image:'))).toEqual(['bg-background']);
    }
  });

  it('an untinted row sets no tint, so its sticky cells paint `bg-background` alone', () => {
    renderTable();
    const tr = rowOf('Plain');
    expect(tokens(tr.className)).toContain('[--os-row-tint:transparent]');
    for (const td of stickyCells(tr)) expect(tokens(td.className)).toContain('bg-background');
  });

  it('the tint gives way under hover and selection, as the row\'s own fill does', () => {
    renderTable();
    for (const label of ['Tinted', 'Plain']) {
      const t = tokens(rowOf(label).className);
      expect(t).toContain('hover:[--os-row-tint:transparent]');
      expect(t).toContain('data-[state=selected]:[--os-row-tint:transparent]');
    }
  });

  it('without frozen columns the checkbox and row number are not sticky and take the row fill directly', () => {
    render(
      <DataTable
        schema={{
          type: 'data-table',
          data: [{ id: '1', name: 'Tinted' }],
          columns: [{ header: 'Name', accessorKey: 'name' }],
          selectable: true,
          showRowNumbers: true,
          rowClassName: () => RED_TINT,
          pagination: false,
          searchable: false,
        }}
      />,
    );
    const tr = rowOf('Tinted');
    for (const td of cellsOf(tr)) {
      expect(tokens(td.className)).not.toContain('sticky');
      expect(tokens(td.className)).not.toContain('bg-background');
    }
  });
});
