/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `data-table`'s cell layer (objectstack#35688): the editor, and the full
 * content of a cut-off selected cell, draw on a layer over the cell instead of
 * inside it, so the row keeps its height. Layout itself (row height 32, the
 * flip at the viewport's edge, painting above frozen columns) is a browser
 * reading on the PR; jsdom has no layout, so these pin the structure and the
 * gestures.
 *
 *   1. The editor sits in a fixed-position layer inside its cell, the cell is
 *      raised above the sticky cells, and nothing is drawn in the cell's flow.
 *      An injected (host) editor goes on the same layer.
 *   2. A selected cell whose content is cut off shows it in full on a layer;
 *      one that fits shows none.
 *   3. Enter on that preview opens the editor in its place, at least the
 *      preview's size; Esc there does not bring the preview back.
 *   4. Esc on the preview closes it and keeps the cell selected; an arrow key
 *      moves the selection and the preview with it.
 *   5. Enter on a two-state cell flips it and opens no layer.
 *   6. Scrolling the open editor's cell out of the table's box commits it.
 */
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Registers `data-table` at module scope, not in a hook (objectui#3010).
import '../renderers';
// `react-page` reaches a dynamic `import('@object-ui/react-runtime')`: pay its load
// at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@object-ui/react-runtime';
import { GridCellSelectionProvider } from '../context/gridCellSelection';

const LONG = 'A long note that runs well past the width of its column';

const ROWS = [
  { id: '1', name: 'Alpha', note: LONG, done: false },
  { id: '2', name: 'Beta', note: 'Short', done: true },
];

// jsdom draws nothing: a text longer than ten characters reads as cut off.
const proto = HTMLElement.prototype;
const saved = {
  scrollWidth: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'),
  clientWidth: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
};
beforeEach(() => {
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get() { return (this.textContent ?? '').length * 10; } });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get() { return 100; } });
});
afterEach(() => {
  cleanup();
  for (const [k, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(proto, k, d);
    else delete (proto as unknown as Record<string, unknown>)[k];
  }
});

function renderTable(extra: Record<string, unknown> = {}) {
  const DataTable = ComponentRegistry.get('data-table')!;
  const onCellChange = vi.fn();
  const schema = {
    type: 'data-table',
    columns: [
      { header: 'Name', accessorKey: 'name' },
      { header: 'Note', accessorKey: 'note' },
      { header: 'Done', accessorKey: 'done', type: 'boolean' },
    ],
    data: ROWS,
    editable: true,
    singleClickEdit: true,
    searchable: false,
    pagination: false,
    onCellChange,
    ...extra,
  };
  const utils = render(
    <GridCellSelectionProvider value={{}}>
      <DataTable schema={schema} />
    </GridCellSelectionProvider>,
  );
  const cell = (row: number, col: number) =>
    utils.container.querySelectorAll('tbody tr')[row].querySelectorAll('td[data-grid-cell]')[col] as HTMLElement;
  const catcher = () => utils.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
  const editorLayer = () => utils.container.querySelector<HTMLElement>('[data-slot="cell-editor-overlay"]');
  const previewLayer = () => utils.container.querySelector<HTMLElement>('[data-slot="cell-preview-overlay"]');
  return { ...utils, cell, catcher, editorLayer, previewLayer, onCellChange };
}

describe('data-table — the editor and a cut-off cell draw on a layer over the cell (objectstack#35688)', () => {
  it('1. the editor sits in a fixed-position layer inside its cell, and the cell is raised', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    const layer = t.editorLayer();
    expect(layer).not.toBeNull();
    // Inside the cell's DOM, so the grid's own `contains` reads hold.
    expect(t.cell(0, 0).contains(layer)).toBe(true);
    expect(layer!.querySelector('input')).toHaveValue('Alpha');
    // Out of the cell's flow: Radix places the layer's wrapper `fixed`.
    expect(layer!.closest<HTMLElement>('[data-radix-popper-content-wrapper]')!.style.position).toBe('fixed');
    expect(t.cell(0, 0).className).toMatch(/\bz-30\b/);
    expect(t.cell(1, 0).className).not.toMatch(/\bz-30\b/);
  });

  it('1b. a host-injected editor goes on the same layer', () => {
    const t = renderTable({
      renderCellEditor: ({ value, stage }: { value: unknown; stage: (v: unknown) => void }) => (
        <input data-testid="host-editor" defaultValue={String(value)} onChange={(e) => stage(e.target.value)} />
      ),
    });
    fireEvent.click(t.cell(0, 0));
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    expect(t.editorLayer()!.querySelector('[data-testid="host-editor"]')).not.toBeNull();
  });

  it('2. a selected cell that is cut off shows its whole content on a layer; one that fits shows none', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 1));
    expect(t.previewLayer()).toHaveTextContent(LONG);
    expect(t.cell(0, 1).contains(t.previewLayer())).toBe(true);
    fireEvent.click(t.cell(0, 0));
    expect(t.previewLayer()).toBeNull();
  });

  it('3. Enter on the preview opens the editor in its place, at least its size; Esc does not bring it back', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 1));
    const preview = t.previewLayer()!;
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 72, top: 0, left: 0, right: 300, bottom: 72, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    expect(t.previewLayer()).toBeNull();
    const layer = t.editorLayer()!;
    expect(layer.querySelector('input')).toHaveValue(LONG);
    expect(layer.style.getPropertyValue('--cell-overlay-min-w')).toBe('300px');
    expect(layer.style.getPropertyValue('--cell-overlay-min-h')).toBe('72px');
    fireEvent.keyDown(layer.querySelector('input')!, { key: 'Escape' });
    expect(t.editorLayer()).toBeNull();
    expect(t.previewLayer()).toBeNull();
    expect(t.cell(0, 1)).toHaveAttribute('data-selected-cell');
  });

  it('4. Esc closes the preview and keeps the selection; an arrow key moves on', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 1));
    fireEvent.keyDown(t.catcher(), { key: 'Escape' });
    expect(t.previewLayer()).toBeNull();
    expect(t.cell(0, 1)).toHaveAttribute('data-selected-cell');
    fireEvent.click(t.cell(1, 1));
    expect(t.previewLayer()).toBeNull();
    fireEvent.keyDown(t.catcher(), { key: 'ArrowUp' });
    expect(t.cell(0, 1)).toHaveAttribute('data-selected-cell');
    expect(t.previewLayer()).toHaveTextContent(LONG);
  });

  it('5. Enter on a two-state cell flips it and opens no layer', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 2));
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    expect(t.editorLayer()).toBeNull();
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'done', true, expect.anything());
  });

  it('6. scrolling the open editor\'s cell out of the table\'s box commits it', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    fireEvent.change(t.editorLayer()!.querySelector('input')!, { target: { value: 'Alpha 2' } });
    // The table's scroll box, and a cell scrolled past its left edge.
    const box = t.cell(0, 0).closest('table')!.parentElement!;
    box.style.overflowX = 'auto';
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 100 });
    vi.spyOn(t.cell(0, 0), 'getBoundingClientRect').mockReturnValue({ left: -200, top: 40, right: -50, bottom: 72, width: 150, height: 32, x: -200, y: 40, toJSON: () => ({}) } as DOMRect);
    act(() => { box.dispatchEvent(new Event('scroll')); });
    expect(t.editorLayer()).toBeNull();
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'name', 'Alpha 2', expect.anything());
  });
});
