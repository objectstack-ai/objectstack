/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `MenuItem`'s declared divider spelling (objectui#6523, maintainer ruling
 * 2026-08-27): `dropdown-menu` and `context-menu` now branch on the declared
 * `item.separator`, matching `menubar` — which already read it correctly and
 * is what the ruling's issue used as evidence the declaration, not the
 * renderer, was right.
 *
 * ## The blank-row regression this pins (ruling-required)
 *
 * Before this fix, an author who followed the SHIPPED TYPE and wrote the
 * declared `{ separator: true }` in a dropdown or context menu got a value
 * that validated, published, and rendered a BLANK MENU ROW: both renderers
 * branched on an undeclared `item.type === 'separator'` instead, so
 * `{ separator: true }` fell through to the ordinary item arm with no
 * `label` to draw. That is the exact defect objectui#6249 hit and fixed for
 * ONE fixture (menubar); this card is the renderer-level fix for the other
 * two containers. `'the declared spelling now draws a real divider, not a
 * blank row'` below is the regression pin — it is RED against the pre-fix
 * `item.type === 'separator'` branch (verified by reverting the renderer
 * change and re-running this file; see the PR body's ablation section).
 *
 * ## Why item COUNT is asserted, not just divider presence
 *
 * A renderer that draws a divider AND still emits a stray blank `menuitem`
 * for the same entry would pass a "does a separator exist" check while
 * shipping half of the regression. Asserting the exact `menuitem` count (no
 * more, no fewer than the labelled items) closes that gap.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there
// the cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

afterEach(() => cleanup());

/** `defaultOpen` is load-bearing — Radix mounts `DropdownMenuContent` lazily. */
function renderDropdown(items: unknown[]) {
  const C = ComponentRegistry.get('dropdown-menu') as React.ComponentType<any>;
  return render(<C schema={{ type: 'dropdown-menu', defaultOpen: true, items }} />);
}

/** Context menu content mounts only after a `contextmenu` event on the trigger. */
function renderContextMenu(items: unknown[]) {
  const C = ComponentRegistry.get('context-menu') as React.ComponentType<any>;
  const { container } = render(
    <C schema={{ type: 'context-menu', trigger: { type: 'text', content: 'AREA' }, items }} />,
  );
  fireEvent.contextMenu(container.firstElementChild as HTMLElement);
  return container;
}

describe('ui:dropdown-menu — the declared divider spelling (objectui#6523)', () => {
  it('`{ separator: true }` renders a real divider row', () => {
    renderDropdown([{ label: 'Profile' }, { separator: true }, { label: 'Logout' }]);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('the declared spelling draws no blank row alongside the divider — the regression pin', () => {
    renderDropdown([{ label: 'Profile' }, { separator: true }, { label: 'Logout' }]);
    // Exactly two labelled command items — not three, which is what the
    // pre-fix renderer produced (the divider entry fell through to a blank
    // `DropdownMenuItem` with no label).
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items.map((el) => el.textContent)).toEqual(['Profile', 'Logout']);
  });

  it('the retired `{ type: "separator" }` spelling no longer draws a divider', () => {
    // `type` is a declared refusal at the schema level (objectui#6523's zod
    // pin, `menu-item-union.test.ts`); this is the RENDERER half — even a
    // hand-built prop bypassing validation gets no special treatment, since
    // the renderer no longer reads `item.type` at all.
    renderDropdown([{ label: 'Profile' }, { type: 'separator' }, { label: 'Logout' }]);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });
});

describe('ui:context-menu — the declared divider spelling (objectui#6523)', () => {
  it('`{ separator: true }` renders a real divider row', () => {
    renderContextMenu([{ label: 'Copy' }, { separator: true }, { label: 'Delete' }]);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('the declared spelling draws no blank row alongside the divider — the regression pin', () => {
    renderContextMenu([{ label: 'Copy' }, { separator: true }, { label: 'Delete' }]);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items.map((el) => el.textContent)).toEqual(['Copy', 'Delete']);
  });

  it('the retired `{ type: "separator" }` spelling no longer draws a divider', () => {
    renderContextMenu([{ label: 'Copy' }, { type: 'separator' }, { label: 'Delete' }]);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });
});

describe('ui:menubar — `shortcut` rendering, parity not new capability (objectui#6523 rider)', () => {
  /** Opens the first menu the way a user would — clicking its trigger. Radix
   *  Menubar opens on a full pointer sequence, not a bare `fireEvent.click`,
   *  so this drives it through `userEvent`. */
  async function renderMenubar(items: unknown[]) {
    const user = userEvent.setup();
    const C = ComponentRegistry.get('menubar') as React.ComponentType<any>;
    render(
      <C schema={{ type: 'menubar', menus: [{ label: 'File', items }] }} />,
    );
    await user.click(screen.getByText('File'));
  }

  it('renders the declared `shortcut` string beside its item', async () => {
    await renderMenubar([{ label: 'New Tab', shortcut: 'Ctrl+T' }]);
    expect(screen.getByText('Ctrl+T')).toBeTruthy();
  });

  it('an item without `shortcut` draws no shortcut text', async () => {
    await renderMenubar([{ label: 'New Tab' }]);
    expect(screen.queryByText('Ctrl+T')).toBeNull();
  });
});
