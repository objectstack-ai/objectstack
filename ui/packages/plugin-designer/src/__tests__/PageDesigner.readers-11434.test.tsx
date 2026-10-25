/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page-designer` DRAWS the members objectui#11434 ruled READ.
 *
 * The card's measurement found `DesignerComponent`'s `children`, `locked`,
 * `visible` and `zIndex`, and `DesignerPaletteCategory.icon`,
 * `DesignerPaletteItem.icon` and `DesignerPaletteItem.preview` declared on both
 * faces of `@object-ui/types` and drawn by nothing: `PageDesigner` drew a flat
 * list of components and a palette of labels. The seat ruled each READ.
 * (`DesignerCanvasConfig.backgroundColor`, shared by three canvases, is pinned
 * in `DesignerCanvas.backgroundColor-11434.test.tsx`.)
 *
 * "Read" is measured the way the card measured "unread": a render probe
 * through the real `SchemaRenderer` and the real registry, one document with
 * the member and one without it, compared as drawn markup. On top of that
 * diff, each row names WHAT is drawn.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import '../index';

type Doc = Record<string, unknown>;

afterEach(() => cleanup());

const CANVAS = { width: 800, height: 600 };
const PARENT = { id: 'parent', type: 'container', label: 'Box', position: { x: 10, y: 10, width: 300, height: 200 }, props: {} };
const CHILD = { id: 'child', type: 'button', label: 'Go', position: { x: 20, y: 30, width: 80, height: 40 }, props: {} };
const PALETTE = [{ name: 'basic', label: 'Basic', items: [{ type: 'button', label: 'Button' }] }];

function doc(overrides: { parent?: Doc; root?: Doc } = {}): Doc {
  return {
    type: 'page-designer',
    canvas: CANVAS,
    components: [{ ...PARENT, ...overrides.parent }],
    palette: PALETTE,
    ...overrides.root,
  };
}

function mount(node: Doc): HTMLElement {
  return render(<SchemaRenderer schema={node as never} />).container;
}

/** The drawn markup, with React's generated ids normalised away. */
function drawn(node: Doc): string {
  const html = mount(node).innerHTML.replace(/:r[0-9a-z]+:/g, ':rID:').replace(/«r[0-9a-z]+»/g, '«rID»');
  cleanup();
  return html;
}

const byTestId = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`);

describe('DesignerComponent members are drawn on the canvas and in the tree (objectui#11434)', () => {
  it('`children` are drawn inside their parent and indented under it in the component tree', () => {
    expect(drawn(doc({ parent: { children: [CHILD] } }))).not.toBe(drawn(doc()));
    const container = mount(doc({ parent: { children: [CHILD] } }));
    const parent = byTestId(container, 'page-component-parent');
    expect(parent?.querySelector('[data-testid="page-component-child"]')).toBeTruthy();
    expect(byTestId(container, 'page-tree-item-child')?.getAttribute('data-depth')).toBe('1');
    expect(byTestId(container, 'page-tree-item-parent')?.getAttribute('data-depth')).toBe('0');
    cleanup();
    expect(byTestId(mount(doc()), 'page-component-child')).toBeNull();
  });

  it('`locked` holds the component: no drag, no canvas delete, and a lock', () => {
    expect(drawn(doc({ parent: { locked: true } }))).not.toBe(drawn(doc()));
    const locked = byTestId(mount(doc({ parent: { locked: true } })), 'page-component-parent');
    expect(locked?.getAttribute('draggable')).toBe('false');
    expect(locked?.querySelector('[aria-label="Locked"]')).toBeTruthy();
    expect(locked?.querySelector('[aria-label="Delete Box"]')).toBeNull();
    cleanup();
    const free = byTestId(mount(doc()), 'page-component-parent');
    expect(free?.getAttribute('draggable')).toBe('true');
    expect(free?.querySelector('[aria-label="Delete Box"]')).toBeTruthy();
  });

  it('`visible: false` draws the component faded, dashed, with a hidden marker', () => {
    expect(drawn(doc({ parent: { visible: false } }))).not.toBe(drawn(doc()));
    const hidden = byTestId(mount(doc({ parent: { visible: false } })), 'page-component-parent');
    expect(hidden?.className).toContain('opacity-40');
    expect(hidden?.querySelector('[aria-label="Hidden"]')).toBeTruthy();
    cleanup();
    // `visible: true` is the default, drawn as if unset.
    expect(drawn(doc({ parent: { visible: true } }))).toBe(drawn(doc()));
  });

  it('`zIndex` sets the stacking order of the component', () => {
    expect(drawn(doc({ parent: { zIndex: 7 } }))).not.toBe(drawn(doc()));
    const stacked = byTestId(mount(doc({ parent: { zIndex: 7 } })), 'page-component-parent') as HTMLElement;
    expect(stacked.style.zIndex).toBe('7');
  });
});

describe('the palette draws its icons and previews (objectui#11434)', () => {
  it('`DesignerPaletteCategory.icon` is drawn beside the category label', () => {
    const palette = [{ ...PALETTE[0], icon: 'Database' }];
    expect(drawn(doc({ root: { palette } }))).not.toBe(drawn(doc()));
    const icon = byTestId(mount(doc({ root: { palette } })), 'palette-category-icon-basic');
    expect(icon?.getAttribute('class')).toContain('lucide-database');
    cleanup();
    expect(byTestId(mount(doc()), 'palette-category-icon-basic')).toBeNull();
  });

  it('`DesignerPaletteItem.icon` replaces the generic glyph on the item', () => {
    const palette = [{ ...PALETTE[0], items: [{ ...PALETTE[0].items[0], icon: 'MousePointerClick' }] }];
    expect(drawn(doc({ root: { palette } }))).not.toBe(drawn(doc()));
    const item = byTestId(mount(doc({ root: { palette } })), 'palette-item-button');
    expect(item?.querySelector('svg')?.getAttribute('class')).toContain('lucide-mouse-pointer-click');
    cleanup();
    const plain = byTestId(mount(doc()), 'palette-item-button');
    expect(plain?.querySelector('svg')?.getAttribute('class')).toContain('lucide-plus');
  });

  it('`DesignerPaletteItem.preview` is drawn as a thumbnail on the item', () => {
    const preview = 'https://example.invalid/button.png';
    const palette = [{ ...PALETTE[0], items: [{ ...PALETTE[0].items[0], preview }] }];
    expect(drawn(doc({ root: { palette } }))).not.toBe(drawn(doc()));
    expect(byTestId(mount(doc({ root: { palette } })), 'palette-item-preview-button')?.getAttribute('src')).toBe(preview);
    cleanup();
    expect(byTestId(mount(doc()), 'palette-item-preview-button')).toBeNull();
  });
});

describe('a lock is never removed by a delete (objectui#11434)', () => {
  const LOCKED = { id: 'locked', type: 'card', label: 'Pinned', locked: true, position: { x: 10, y: 10, width: 120, height: 80 }, props: {} };
  const FREE = { id: 'free', type: 'card', label: 'Loose', position: { x: 200, y: 10, width: 120, height: 80 }, props: {} };

  function page(components: Doc[]): HTMLElement {
    return mount({ type: 'page-designer', canvas: CANVAS, components, palette: PALETTE });
  }

  /** Select a component the way a user does: a click on its box, shift for each one after the first. */
  function select(container: HTMLElement, id: string, extend = false) {
    act(() => {
      fireEvent.click(byTestId(container, `page-component-${id}`) as Element, { shiftKey: extend });
    });
  }

  /** Run a delete path, and confirm the dialog if it opens — the user who means it. */
  async function deleteVia(container: HTMLElement, how: 'key' | 'toolbar') {
    await act(async () => {
      if (how === 'key') {
        fireEvent.keyDown(container.querySelector('[tabindex="0"]') as Element, { key: 'Delete' });
      } else {
        fireEvent.click(container.querySelector('[aria-label="Delete selected"]') as Element);
      }
      await new Promise((r) => setTimeout(r, 0));
    });
    const confirm = Array.from(container.querySelectorAll('dialog button')).find((b) => b.textContent === 'Delete');
    if (confirm) {
      await act(async () => {
        fireEvent.click(confirm);
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  it.each(['key', 'toolbar'] as const)('a selected locked component survives a delete by %s', async (how) => {
    const container = page([LOCKED]);
    select(container, 'locked');
    await deleteVia(container, how);
    expect(byTestId(container, 'page-component-locked')).toBeTruthy();
  });

  it('the unlocked rest of the same selection IS deleted — the control', async () => {
    const container = page([LOCKED, FREE]);
    select(container, 'locked');
    select(container, 'free', true);
    await act(async () => {
      fireEvent.click(container.querySelector('[aria-label="Delete selected"]') as Element);
      await new Promise((r) => setTimeout(r, 0));
    });
    // The dialog counts only what it will delete.
    expect(container.querySelector('dialog')?.textContent).toContain('delete 1 component?');
    await act(async () => {
      fireEvent.click(Array.from(container.querySelectorAll('dialog button')).find((b) => b.textContent === 'Delete') as Element);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(byTestId(container, 'page-component-free')).toBeNull();
    expect(byTestId(container, 'page-component-locked')).toBeTruthy();
  });

  it('a parent holding a locked component is kept, and offers no delete button', async () => {
    const container = page([{ ...PARENT, children: [{ ...CHILD, locked: true }] }]);
    const parent = byTestId(container, 'page-component-parent');
    expect(parent?.querySelector('[aria-label="Delete Box"]')).toBeNull();
    select(container, 'parent');
    await deleteVia(container, 'toolbar');
    expect(byTestId(container, 'page-component-parent')).toBeTruthy();
    expect(byTestId(container, 'page-component-child')).toBeTruthy();
  });
});
