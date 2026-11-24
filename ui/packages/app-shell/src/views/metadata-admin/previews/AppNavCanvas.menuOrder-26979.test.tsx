// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26979 — the nav canvas shows an app's nav entries in the order
 * the running menu draws them.
 *
 * The menu sorts every level by `order` (`byNavOrder` in
 * `packages/layout/src/navOrder.ts`: lower first, an absent `order` as `0`,
 * ties in authored order), at the top level and inside each group. The nav
 * canvas (`AppNavCanvas`, which Setup's app editor mounts) lists a level
 * through `inMenuOrder`, which states the menu's rule; `byNavOrder` is
 * internal to its package, so these pins are what hold the two rules
 * together: each renders the menu (`NavigationRenderer`) beside the canvas
 * over the same entries.
 *
 * Moved out of `StudioDesignSurface.railLabels.test.tsx` when objectstack#36502
 * retired the Interfaces pillar; its rail, the third surface these pins read,
 * went with the pillar.
 *
 *  - entries with `order` [3, 1, 2] (and a group whose children carry
 *    [2, 1]) read in one order on both surfaces;
 *  - a drag in the canvas leaves both agreeing, writing `order` on the moved
 *    entry only;
 *  - CONTROL: entries with no `order` keep their array order, and a drag
 *    among them writes no `order` at all.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { AppNavCanvas } from './AppNavCanvas';

describe('AppNavCanvas.menuOrder-26979', () => {
  const page = (label: string, order?: number) => ({
    id: `nav_${label.toLowerCase()}`,
    type: 'page',
    label,
    pageName: label.toLowerCase(),
    ...(order === undefined ? {} : { order }),
  });

  /** Authored out of menu order: the menu reads Bravo, Charlie, Alpha, Folder (Yankee, Xray). */
  const ORDERED = [
    page('Alpha', 3),
    page('Bravo', 1),
    page('Charlie', 2),
    { id: 'nav_folder', type: 'group', label: 'Folder', order: 4, expanded: true, children: [page('Xray', 2), page('Yankee', 1)] },
  ];

  /** No `order` anywhere: the menu reads the array as authored. */
  const UNORDERED = [page('Alpha'), page('Bravo'), page('Charlie')];

  const LABELS = ['Alpha', 'Bravo', 'Charlie', 'Folder', 'Xray', 'Yankee'];

  afterEach(cleanup);

  /** The labels `el` shows, in the order it shows them; each must show once. */
  function orderIn(el: HTMLElement): string[] {
    const text = el.textContent ?? '';
    const shown = LABELS.filter((l) => text.includes(l));
    for (const l of shown) expect(text.indexOf(l)).toBe(text.lastIndexOf(l));
    return shown.sort((a, b) => text.indexOf(a) - text.indexOf(b));
  }

  /** The running app's sidebar over `nav`. */
  function menuOrder(nav: unknown[]): string[] {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/apps/acme_app']}>
        <SidebarProvider defaultOpen>
          <NavigationRenderer items={nav as NavigationItem[]} basePath="/apps/acme_app" />
        </SidebarProvider>
      </MemoryRouter>,
    );
    const order = orderIn(container);
    unmount();
    return order;
  }

  /** The nav canvas over `nav`, holding its patches as the host's draft does. */
  function renderCanvas(nav: unknown[]) {
    const patches: unknown[][] = [];
    function Host() {
      const [draft, setDraft] = React.useState<Record<string, unknown>>({ navigation: nav });
      return (
        <div data-testid="nav-canvas">
          <AppNavCanvas
            draft={draft}
            rootKey="navigation"
            selection={null}
            onPatch={(patch) => {
              patches.push(patch.navigation as unknown[]);
              setDraft((d) => ({ ...d, ...patch }));
            }}
          />
        </div>
      );
    }
    render(<Host />);
    return { canvas: screen.getByTestId('nav-canvas'), patches };
  }

  /** The canvas card for `label`: the row button whose text starts with it. */
  const card = (label: string) =>
    screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.startsWith(label))!;

  /** Drag the card `label` and drop it before the card `before`, as a pointer does. */
  function dragBefore(label: string, before: string) {
    // The canvas's own drag type (`DND_MIME` in `AppNavCanvas.tsx`); a drop of any other type is ignored.
    const dataTransfer = { types: ['text/x-objectui-nav'], setData: vi.fn(), getData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(card(label), { dataTransfer });
    fireEvent.dragOver(card(before), { dataTransfer });
    fireEvent.drop(card(before), { dataTransfer });
  }

  it('the fixtures are what the spec accepts', () => {
    for (const item of [...ORDERED, ...UNORDERED]) expect(NavigationItemSchema.safeParse(item).success).toBe(true);
  });

  it('entries with order [3, 1, 2] read in the menu order on the canvas and the menu', () => {
    const menu = menuOrder(ORDERED);
    // Measured on the menu first: it sorts the top level and the group's children.
    expect(menu).toEqual(['Bravo', 'Charlie', 'Alpha', 'Folder', 'Yankee', 'Xray']);
    const { canvas } = renderCanvas(ORDERED);
    expect(orderIn(canvas)).toEqual(menu);
  });

  it('a drag in the canvas leaves the canvas and the menu agreeing, and writes order on the moved entry only', () => {
    const { canvas, patches } = renderCanvas(ORDERED);
    // Alpha (order 3, shown third) to the top, before Bravo (order 1).
    dragBefore('Alpha', 'Bravo');
    expect(patches).toHaveLength(1);
    const next = patches[0] as Array<Record<string, unknown>>;
    expect(orderIn(canvas)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Folder', 'Yankee', 'Xray']);
    // One `order` write: Alpha takes the weight of the entry it now precedes.
    // Every other entry is the object it was.
    const before = new Map(ORDERED.map((it) => [it.id, it]));
    for (const it of next) {
      if (it.id === 'nav_alpha') expect(it).toEqual({ ...before.get('nav_alpha'), order: 1 });
      else expect(it).toBe(before.get(it.id as string));
    }
    cleanup();
    const menu = menuOrder(next);
    expect(menu).toEqual(['Alpha', 'Bravo', 'Charlie', 'Folder', 'Yankee', 'Xray']);
  });

  it('CONTROL: entries with no order keep their array order, and a drag among them writes no order', () => {
    const menu = menuOrder(UNORDERED);
    expect(menu).toEqual(['Alpha', 'Bravo', 'Charlie']);
    const { canvas, patches } = renderCanvas(UNORDERED);
    expect(orderIn(canvas)).toEqual(menu);
    dragBefore('Charlie', 'Alpha');
    const next = patches[0] as Array<Record<string, unknown>>;
    expect(next.map((it) => it.id)).toEqual(['nav_charlie', 'nav_alpha', 'nav_bravo']);
    for (const it of next) expect(it).not.toHaveProperty('order');
    expect(orderIn(canvas)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    cleanup();
    expect(menuOrder(next)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });
});
