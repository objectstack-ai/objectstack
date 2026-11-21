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

function renderTable(extra: Record<string, unknown> = {}, selection: React.ComponentProps<typeof GridCellSelectionProvider>['value'] = {}) {
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
    <GridCellSelectionProvider value={selection}>
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
    // Its height cap keeps the space-available cap (one class, not two that merge away).
    expect(t.previewLayer()!.className).toContain('max-h-[min(16rem,var(--radix-popper-available-height))]');
    expect(t.previewLayer()!.className).not.toMatch(/(^|\s)max-h-64(\s|$)/);
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
    // The utility that reads the seed survives the per-type floor, which rides an inner box.
    expect(layer.className).toContain('min-w-[max(var(--radix-popper-anchor-width),var(--cell-overlay-min-w,0px))]');
    expect(layer.className).not.toMatch(/(^|\s)min-w-40(\s|$)/);
    // objectstack#36023 — a typed value takes no per-type floor: it starts at the cell's width.
    expect(layer.querySelector('.min-w-40')).toBeNull();
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

describe('data-table — typed values edit flat in the cell; a rating is set in place (objectstack#36023)', () => {
  it('the built-in text editor is the flat face, and the layer drops its padding, radius and shadow for it', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    const layer = t.editorLayer()!;
    const input = layer.querySelector<HTMLInputElement>('[data-in-cell-face="input"] input[data-in-cell-input]')!;
    expect(input).toHaveValue('Alpha');
    expect(input.className).toMatch(/\bborder-0\b/);
    expect(input.className).toMatch(/\brounded-none\b/);
    expect(input.className).not.toMatch(/(^|\s)h-10(\s|$)/);
    // The layer reads the marked face (`:has()` utilities, spelled in full for Tailwind).
    expect(layer.className).toContain('has-[[data-in-cell-face=input]]:p-0');
    expect(layer.className).toContain('has-[[data-in-cell-face=input]]:rounded-none');
    expect(layer.className).toContain('has-[[data-in-cell-face=input]]:border-2');
    // The form-density height skips the flat input.
    expect(layer.className).toContain(':not([data-in-cell-input])]:h-8');
  });

  function renderRating() {
    const onCellChange = vi.fn();
    const t = renderTable(
      {
        columns: [
          { header: 'Name', accessorKey: 'name' },
          {
            header: 'Score',
            accessorKey: 'score',
            // The stars the rating cell renderer draws, one hit target each.
            cell: (value: number) => (
              <span>{[1, 2, 3, 4, 5].map((n) => <svg key={n} data-rating-star={n} data-filled={n <= value ? '' : undefined} />)}</span>
            ),
          },
        ],
        data: [{ id: '1', name: 'Alpha', score: 2 }],
        onCellChange,
      },
      { describeCell: (_row, key) => (key === 'score' ? { stars: 5 } : null) },
    );
    return { ...t, onCellChange };
  }

  it('a digit on the selected rating sets that many stars, at most the scale; 0 and Backspace clear', () => {
    const t = renderRating();
    fireEvent.click(t.cell(0, 1));
    fireEvent.keyDown(t.catcher(), { key: '3' });
    expect(t.onCellChange).toHaveBeenLastCalledWith(0, 'score', 3, expect.anything());
    fireEvent.keyDown(t.catcher(), { key: '9' });
    expect(t.onCellChange).toHaveBeenLastCalledWith(0, 'score', 5, expect.anything());
    fireEvent.keyDown(t.catcher(), { key: '0' });
    expect(t.onCellChange).toHaveBeenLastCalledWith(0, 'score', null, expect.anything());
    fireEvent.keyDown(t.catcher(), { key: '4' });
    fireEvent.keyDown(t.catcher(), { key: 'Backspace' });
    expect(t.onCellChange).toHaveBeenLastCalledWith(0, 'score', null, expect.anything());
    expect(t.editorLayer()).toBeNull();
  });

  it('Enter, F2 and a double-click open no editor on a rating', () => {
    const t = renderRating();
    fireEvent.click(t.cell(0, 1));
    fireEvent.keyDown(t.catcher(), { key: 'Enter' });
    fireEvent.keyDown(t.catcher(), { key: 'F2' });
    fireEvent.doubleClick(t.cell(0, 1));
    expect(t.editorLayer()).toBeNull();
    expect(t.onCellChange).not.toHaveBeenCalled();
  });

  it('the first click on a star only selects; a click on a star of the selected cell sets it', () => {
    const t = renderRating();
    const star = (n: number) => t.cell(0, 1).querySelector(`[data-rating-star="${n}"]`)!;
    fireEvent.click(star(4));
    expect(t.cell(0, 1)).toHaveAttribute('data-selected-cell');
    expect(t.onCellChange).not.toHaveBeenCalled();
    fireEvent.click(star(4));
    expect(t.onCellChange).toHaveBeenCalledWith(0, 'score', 4, expect.anything());
  });

  it('CONTROL: without the stars fact a digit opens the editor as typing does', () => {
    const t = renderTable();
    fireEvent.click(t.cell(0, 0));
    fireEvent.keyDown(t.catcher(), { key: '3' });
    expect(t.onCellChange).not.toHaveBeenCalled();
  });
});
