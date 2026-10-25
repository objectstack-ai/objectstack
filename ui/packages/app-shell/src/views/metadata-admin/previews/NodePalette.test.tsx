// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * NodePalette (#1943) — search box, keyboard navigation, and the
 * "Recently used" group. Rendered controlled (`open`) with a fixture item
 * list that includes a synthetic plugin item to stand in for the
 * server-merged palette.
 */

import * as React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NodePalette, type PaletteItem } from './flow-canvas-parts';
import { readPaletteRecents } from './flowPaletteRecents';

beforeAll(() => {
  // Radix Popover / cmdk probe pointer-capture APIs the test DOM lacks.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

/** Multi-category fixture incl. a plugin-contributed (server-merged) item. */
const ITEMS: PaletteItem[] = [
  { type: 'create_record', label: 'Create record', hint: 'Insert a new record', category: 'Data' },
  { type: 'decision', label: 'Decision', hint: 'Branch on a condition', category: 'Logic' },
  { type: 'screen', label: 'Screen', hint: 'Collect input from a user', category: 'Human' },
  { type: 'plugin.http', label: 'HTTP Call', hint: 'Call an external API', category: 'Integration' },
  { type: 'end', label: 'End', hint: 'Terminate the flow', category: 'Flow' },
];

function renderPalette(
  overrides: { onPick?: (type: string) => void; open?: boolean; locale?: string } = {},
) {
  const onPick = overrides.onPick ?? vi.fn();
  const view = render(
    <NodePalette
      items={ITEMS}
      open={overrides.open ?? true}
      onOpenChange={() => {}}
      onPick={onPick}
      locale={overrides.locale}
    >
      <button type="button">Add node</button>
    </NodePalette>,
  );
  return { onPick, view };
}

/** The palette's search input (rendered by cmdk inside the portaled popover). */
function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText('Search nodes…') as HTMLInputElement;
}

describe('NodePalette search & filtering', () => {
  it('shows the full grouped list for an empty query', () => {
    renderPalette();
    for (const heading of ['Data', 'Logic', 'Human', 'Integration', 'Flow']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    for (const item of ITEMS) {
      expect(screen.getByText(item.label)).toBeTruthy();
    }
  });

  it('localizes the category headings for the active locale', () => {
    renderPalette({ locale: 'zh-CN' });
    // Headings are translated; the canonical English literals are gone.
    for (const heading of ['数据', '逻辑', '人工', '集成', '流程']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(screen.queryByText('Data')).toBeNull();
    expect(screen.queryByText('Logic')).toBeNull();
    // Built-in node types are localized (the zh label wins over the English
    // fixture label); plugin / unknown types fall back to their descriptor
    // label so they stay readable.
    expect(screen.getByText('创建记录')).toBeTruthy();
    expect(screen.queryByText('Create record')).toBeNull();
    expect(screen.getByText('HTTP Call')).toBeTruthy(); // plugin.http → fallback
  });

  it('filters across all categories and hides empty sections', async () => {
    renderPalette();
    // 'record' hits Create record's label (Data) and nothing else.
    fireEvent.change(searchInput(), { target: { value: 'record' } });
    await waitFor(() => {
      expect(screen.getByText('Create record')).toBeTruthy();
      expect(screen.queryByText('Decision')).toBeNull();
      expect(screen.queryByText('Logic')).toBeNull();
      expect(screen.queryByText('Flow')).toBeNull();
    });
  });

  it('matches on hint text', async () => {
    renderPalette();
    // 'condition' appears only in Decision's hint.
    fireEvent.change(searchInput(), { target: { value: 'condition' } });
    await waitFor(() => {
      expect(screen.getByText('Decision')).toBeTruthy();
      expect(screen.queryByText('Screen')).toBeNull();
    });
  });

  it('is case-insensitive', async () => {
    renderPalette();
    fireEvent.change(searchInput(), { target: { value: 'SCREEN' } });
    await waitFor(() => {
      expect(screen.getByText('Screen')).toBeTruthy();
      expect(screen.queryByText('End')).toBeNull();
    });
  });

  it('finds server-merged plugin items by label and by type', async () => {
    renderPalette();
    fireEvent.change(searchInput(), { target: { value: 'http' } });
    await waitFor(() => {
      expect(screen.getByText('HTTP Call')).toBeTruthy();
    });
    // Match by registered type, too (display name differs from type).
    fireEvent.change(searchInput(), { target: { value: 'plugin.' } });
    await waitFor(() => {
      expect(screen.getByText('HTTP Call')).toBeTruthy();
      expect(screen.queryByText('Screen')).toBeNull();
    });
  });

  it('shows the empty state when nothing matches', async () => {
    renderPalette();
    fireEvent.change(searchInput(), { target: { value: 'zzz-no-such-node' } });
    await waitFor(() => {
      expect(screen.getByText('No matching nodes.')).toBeTruthy();
      expect(screen.queryByText('Screen')).toBeNull();
    });
  });

  it('resets the query when reopened', async () => {
    const onPick = vi.fn();
    const { rerender } = render(
      <NodePalette items={ITEMS} open onOpenChange={() => {}} onPick={onPick}>
        <button type="button">Add node</button>
      </NodePalette>,
    );
    fireEvent.change(searchInput(), { target: { value: 'screen' } });
    await waitFor(() => expect(screen.queryByText('End')).toBeNull());
    rerender(
      <NodePalette items={ITEMS} open={false} onOpenChange={() => {}} onPick={onPick}>
        <button type="button">Add node</button>
      </NodePalette>,
    );
    rerender(
      <NodePalette items={ITEMS} open onOpenChange={() => {}} onPick={onPick}>
        <button type="button">Add node</button>
      </NodePalette>,
    );
    await waitFor(() => {
      expect(searchInput().value).toBe('');
      expect(screen.getByText('End')).toBeTruthy();
    });
  });
});

describe('NodePalette keyboard navigation', () => {
  it('ArrowDown + Enter picks the highlighted (second) item', async () => {
    const { onPick } = renderPalette();
    const input = searchInput();
    // cmdk auto-highlights the first item; one ArrowDown moves to the second.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(onPick).toHaveBeenCalledWith('decision');
    });
  });

  it('Enter picks the single match after narrowing', async () => {
    const { onPick } = renderPalette();
    const input = searchInput();
    fireEvent.change(input, { target: { value: 'terminate' } });
    await waitFor(() => expect(screen.queryByText('Decision')).toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(onPick).toHaveBeenCalledWith('end');
    });
  });
});

describe('NodePalette recently used', () => {
  it('surfaces stored recents (dropping unknown types) only while the query is empty', async () => {
    // 'ghost.type' stands in for a since-uninstalled plugin node.
    localStorage.setItem('flow-palette-recents', JSON.stringify(['plugin.http', 'ghost.type']));
    renderPalette();
    expect(screen.getByText('Recently used')).toBeTruthy();
    // The plugin item renders twice: once under recents, once in its category.
    expect(screen.getAllByText('HTTP Call')).toHaveLength(2);
    expect(screen.queryByText('ghost.type')).toBeNull();

    fireEvent.change(searchInput(), { target: { value: 'record' } });
    await waitFor(() => {
      expect(screen.queryByText('Recently used')).toBeNull();
    });
  });

  it('records a pick at the front of the MRU list', async () => {
    localStorage.setItem('flow-palette-recents', JSON.stringify(['end']));
    const { onPick } = renderPalette();
    fireEvent.click(screen.getByText('Decision'));
    await waitFor(() => {
      expect(onPick).toHaveBeenCalledWith('decision');
    });
    expect(readPaletteRecents()).toEqual(['decision', 'end']);
  });
});
