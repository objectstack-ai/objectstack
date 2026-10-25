/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:menubar` resolves an item's authored `icon` to a glyph (objectui#6326).
 *
 * The third member of the `MenuItem`-shaped family. The two twins were
 * repaired first — `dropdown-menu` by objectui#5930, `context-menu` by
 * objectui#6278 — and this suite ports `context-menu-item-icon.test.tsx` to
 * the menubar renderer, with the differences below made explicit.
 *
 * ## The defect is an ABSENT render
 *
 * `menubar.tsx` never referenced `icon` at all, so it drew NOTHING for an
 * authored name. `queryByText(name)` is a ghost here (null in both worlds); the
 * discriminating assertion is the presence of the RESOLVED GLYPH, named by the
 * identity lucide gives it — `svg.lucide-NAME`, derived from the AUTHORED name
 * (the independent input), never from the renderer under test.
 *
 * ## Every arm that draws an item is its own row
 *
 * objectui#5930 ruled that repairing the leaf arm and not the submenu-trigger
 * arm is "a narrower version of the same bug"; objectui#6278 applied it to
 * context-menu. The menubar renderer drew items in THREE places — a top-level
 * leaf, a submenu trigger, and a submenu child — so each is measured as a
 * separate row, and a partial repair cannot read as complete.
 *
 * ## The submenu trigger already contains an svg
 *
 * `MenubarSubTrigger` renders its own `ChevronRight` unconditionally (see
 * `src/ui/menubar.tsx`), so a bare `querySelector('svg')` on that arm is green
 * in both worlds. The chevron is asserted as a positive control ON THE
 * INSTRUMENT instead.
 *
 * ## Nesting deeper than one level
 *
 * `MenuCommandItem.children` is `MenuItem[]` — recursive by type, and the
 * component docs describe it as "drawn as a nested submenu". The renderer used
 * to walk exactly ONE level: a submenu child that itself carried `children`
 * was drawn as a plain leaf and its own children were silently dropped. That
 * rides this card (triage on objectui#6326: the nested arm "renders only one
 * level deep"), so the depth-2 rows below pin it.
 *
 * ## Harness
 *
 * Radix Menubar opens on a full pointer sequence, so the top-level menu is
 * opened through `userEvent` (the harness `menu-item-onclick-handler.test.tsx`
 * already uses for this renderer); a submenu opens on its trigger's click.
 * `expect(menu)` rows are harness controls so no "renders no glyph" row can
 * pass vacuously against content that never mounted.
 *
 * lucide is NOT mocked: `edit` is a retired spelling absent from the runtime
 * `icons` record, so it must draw NO glyph — the row that rules out the
 * `LazyIcon` surface, which would degrade it to the `Database` glyph.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — see
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

afterEach(() => cleanup());

/** Render a one-menu menubar and open it the way a user would. */
async function openMenu(items: unknown[]) {
  const user = userEvent.setup();
  const C = ComponentRegistry.get('menubar') as React.ComponentType<any>;
  render(<C schema={{ type: 'menubar', menus: [{ label: 'File', items }] }} />);
  await user.click(screen.getByText('File'));
  return user;
}

/** Open the submenu whose trigger carries `label`. */
async function openSub(label: string) {
  fireEvent.click(itemFor(label));
  fireEvent.keyDown(itemFor(label), { key: 'ArrowRight' });
}

/** The menu item element carrying `label`. Every arm renders `role="menuitem"`. */
function itemFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[role="menuitem"]');
  if (!el) throw new Error(`no [role="menuitem"] ancestor for ${label}`);
  return el as HTMLElement;
}

describe('ui:menubar item icon resolution (objectui#6326)', () => {
  describe('harness control — the menu actually opens', () => {
    it('mounts the content and its items after the trigger is clicked', async () => {
      await openMenu([{ label: 'Save', icon: 'save' }, { label: 'Plain' }]);
      expect(screen.getByRole('menu')).toBeTruthy();
      expect(itemFor('Save')).toBeTruthy();
      expect(itemFor('Plain')).toBeTruthy();
    });
  });

  describe('top-level leaf arm', () => {
    it('renders the resolved glyph for a live icon name', async () => {
      await openMenu([{ label: 'Save', icon: 'save' }]);
      // RED before the repair: the leaf item contained no svg whatsoever.
      expect(itemFor('Save').querySelector('svg.lucide-save')).not.toBeNull();
    });

    it('renders no glyph for a RETIRED spelling — the RECORD surface, not a fallback', async () => {
      await openMenu([{ label: 'Edit', icon: 'edit' }]);
      expect(itemFor('Edit').querySelector('svg')).toBeNull();
    });

    it('renders no glyph when no icon is authored', async () => {
      await openMenu([{ label: 'Plain' }]);
      expect(itemFor('Plain').querySelector('svg')).toBeNull();
    });
  });

  describe('submenu-trigger arm', () => {
    const submenu = [{ label: 'Share', icon: 'share', children: [{ label: 'Email' }] }];

    it('positive control on the instrument — the arm DOES contain a queryable svg', async () => {
      // Green in both worlds BY DESIGN: `MenubarSubTrigger` always draws a
      // chevron, so a red `lucide-share` row cannot be misread as a broken query.
      await openMenu(submenu);
      expect(itemFor('Share').querySelector('svg.lucide-chevron-right')).not.toBeNull();
    });

    it('renders the resolved glyph for a live icon name', async () => {
      await openMenu(submenu);
      // RED before the repair: the chevron was the arm's ONLY svg.
      expect(itemFor('Share').querySelector('svg.lucide-share')).not.toBeNull();
    });

    it('renders no glyph beside the chevron for a RETIRED spelling', async () => {
      await openMenu([{ label: 'Share', icon: 'edit', children: [{ label: 'Email' }] }]);
      expect(itemFor('Share').querySelectorAll('svg')).toHaveLength(1);
      expect(itemFor('Share').querySelector('svg.lucide-chevron-right')).not.toBeNull();
    });
  });

  describe('submenu-child arm', () => {
    it('renders the resolved glyph for a live icon name', async () => {
      await openMenu([
        { label: 'Share', children: [{ label: 'Email', icon: 'mail' }, { label: 'Plain child' }] },
      ]);
      await openSub('Share');
      expect(await screen.findByText('Email')).toBeTruthy();
      // RED before the repair: the nested child drew only its label.
      expect(itemFor('Email').querySelector('svg.lucide-mail')).not.toBeNull();
      expect(itemFor('Plain child').querySelector('svg')).toBeNull();
    });
  });

  describe('nesting deeper than one level (MenuItem.children is recursive by type)', () => {
    const deep = [
      {
        label: 'Share',
        children: [
          { label: 'Export', icon: 'download', children: [{ label: 'As CSV', icon: 'file' }] },
        ],
      },
    ];

    it('a submenu child WITH children is drawn as a submenu trigger, with its glyph', async () => {
      await openMenu(deep);
      await openSub('Share');
      expect(await screen.findByText('Export')).toBeTruthy();
      // RED before the repair: `Export` was drawn as a plain leaf — no chevron,
      // no glyph, and its own children unreachable.
      expect(itemFor('Export').querySelector('svg.lucide-chevron-right')).not.toBeNull();
      expect(itemFor('Export').querySelector('svg.lucide-download')).not.toBeNull();
    });

    it('the grandchild is reachable and draws its glyph', async () => {
      await openMenu(deep);
      await openSub('Share');
      await screen.findByText('Export');
      await openSub('Export');
      expect(await screen.findByText('As CSV')).toBeTruthy();
      expect(itemFor('As CSV').querySelector('svg.lucide-file')).not.toBeNull();
    });
  });
});
