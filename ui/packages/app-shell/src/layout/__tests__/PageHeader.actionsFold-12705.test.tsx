/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12705 — the console page header folds its actions before it cuts
 * its text. A page that declares `foldedActions` gets them drawn in place of
 * `actions` once `actions` would clip the title or the description, and gets
 * `actions` back once both fit again. The header measures its own width.
 *
 * happy-dom lays nothing out, so each case installs a small layout model for
 * the header (`installLayout`): the header is `width` px wide, a labelled
 * button is 100 px and an icon button 32 px with 8 px between them, a title
 * character is 10 px and a description character 7 px, and the row's padding
 * and gap take 60 px. The model answers the four readings the header makes —
 * the actions cluster's width, the text block's width, the title's content
 * width and the description's content width (a `Range`) — from the DOM the
 * header actually drew, so a fold that draws different actions reads
 * different widths, as in a browser.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { PageHeader } from '../PageHeader';

const DESCRIPTION = 'User accounts for authentication';

let headerWidth = 600;
const observers = new Set<() => void>();
const restores: Array<() => void> = [];

function installLayout() {
  const clusterWidth = (cluster: Element) => {
    const buttons = Array.from(cluster.querySelectorAll('button'));
    return (
      buttons.reduce((sum, b) => sum + ((b.textContent ?? '').trim() ? 100 : 32), 0) +
      8 * Math.max(0, buttons.length - 1)
    );
  };
  const textBlockOf = (header: Element) => {
    const h1 = header.querySelector('h1');
    if (!h1) return null;
    return header.getAttribute('data-posture') === 'setup' ? h1.parentElement!.parentElement : h1.parentElement;
  };
  const rectWidth = (el: Element): number => {
    if (el.matches('[data-testid="page-header-actions"]')) return clusterWidth(el);
    if (!el.closest('[data-testid="page-header"]')) return 0;
    if (el.tagName === 'H1') return (el.textContent ?? '').length * 10;
    if (el.matches('span[aria-hidden="true"]')) return 1;
    return 0;
  };
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = rectWidth(this);
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const range = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    const width = (this.startContainer.textContent ?? '').length * 7;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const define = (prop: 'clientWidth' | 'scrollWidth', get: (el: HTMLElement) => number) => {
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return get(this);
      },
    });
    restores.push(() => {
      if (own) Object.defineProperty(HTMLElement.prototype, prop, own);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    });
  };
  define('clientWidth', (el) => {
    const header = el.closest('[data-testid="page-header"]');
    if (!header || el !== textBlockOf(header)) return 0;
    const cluster = header.querySelector('[data-testid="page-header-actions"]');
    const tile = header.getAttribute('data-posture') === 'setup' ? 44 : 0;
    return headerWidth - 60 - tile - (cluster ? clusterWidth(cluster) : 0);
  });
  define('scrollWidth', (el) => (el.tagName === 'H1' ? (el.textContent ?? '').length * 10 : 0));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private cb: () => void;
      constructor(cb: () => void) {
        this.cb = () => cb();
      }
      observe() {
        observers.add(this.cb);
      }
      unobserve() {}
      disconnect() {
        observers.delete(this.cb);
      }
    },
  );
  restores.push(() => {
    rect.mockRestore();
    range.mockRestore();
    vi.unstubAllGlobals();
  });
}

/** The header is resized to `width` px, and its observer fires. */
function resizeTo(width: number) {
  headerWidth = width;
  act(() => observers.forEach((cb) => cb()));
}

afterEach(() => {
  cleanup();
  while (restores.length) restores.pop()!();
  observers.clear();
  headerWidth = 600;
});

/** Three labelled actions and the page's own `⋯`, as the object list draws them. */
function Actions({ onImport }: { onImport: () => void }) {
  return (
    <>
      <Button data-testid="new">New</Button>
      <Button data-testid="import" onClick={onImport}>Import</Button>
      <Button data-testid="update-stage">Update Stage</Button>
      <PageMenu />
    </>
  );
}

/** The same actions folded: New labelled, the other two in the page's `⋯` above its own entry. */
function FoldedActions({ onImport }: { onImport: () => void }) {
  return (
    <>
      <Button data-testid="new">New</Button>
      <PageMenu>
        <DropdownMenuItem data-testid="folded-import" onSelect={onImport}>Import</DropdownMenuItem>
        <DropdownMenuItem data-testid="folded-update-stage" disabled>Update Stage</DropdownMenuItem>
      </PageMenu>
    </>
  );
}

function PageMenu({ children }: { children?: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="More actions" data-testid="more" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {children}
        <DropdownMenuItem data-testid="favorite">Add to favorites</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function mount({ appName = 'crm', fold = true, onImport = vi.fn() } = {}) {
  installLayout();
  render(
    <MemoryRouter initialEntries={[`/apps/${appName}/page`]}>
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={
            <PageHeader
              title="Users"
              subtitle={DESCRIPTION}
              actions={<Actions onImport={onImport} />}
              foldedActions={fold ? <FoldedActions onImport={onImport} /> : undefined}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  const header = screen.getByTestId('page-header');
  const cluster = within(header).getByTestId('page-header-actions');
  const labelled = () =>
    within(cluster)
      .getAllByRole('button')
      .map((b) => (b.textContent ?? '').trim())
      .filter(Boolean);
  return { header, cluster, labelled, onImport };
}

/** The description's room in the model: the text block less the title, the hairline and their gaps. */
function descriptionFits(header: HTMLElement) {
  const text = header.querySelector('h1')!.parentElement!;
  return DESCRIPTION.length * 7 <= text.clientWidth - 'Users'.length * 10 - 1;
}

describe('the console page header folds its actions before its text (objectui#12705)', () => {
  it('three actions in a 600 px header fold to one labelled action and the ⋯; the description is whole', () => {
    headerWidth = 600;
    const { header, cluster, labelled } = mount();
    expect(cluster.getAttribute('data-folded')).toBe('true');
    expect(labelled()).toEqual(['New']);
    expect(within(cluster).getByTestId('more')).toBeTruthy();
    const description = within(header).getByText(DESCRIPTION);
    expect(description.textContent).toBe(DESCRIPTION);
    expect(descriptionFits(header)).toBe(true);
  });

  it('in a 1280 px header all three actions stay labelled', () => {
    headerWidth = 1280;
    const { cluster, labelled } = mount();
    expect(cluster.getAttribute('data-folded')).toBe('false');
    expect(labelled()).toEqual(['New', 'Import', 'Update Stage']);
  });

  it('a folded action in the ⋯ runs its handler, and keeps its disabled state', () => {
    headerWidth = 600;
    const { cluster, onImport } = mount();
    fireEvent.pointerDown(within(cluster).getByTestId('more'), { button: 0, pointerType: 'mouse' });
    expect(screen.getByTestId('folded-update-stage').getAttribute('data-disabled')).not.toBeNull();
    fireEvent.click(screen.getByTestId('folded-import'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('follows the header’s own width both ways: unfolds when it widens and folds again when it narrows', () => {
    headerWidth = 600;
    const { cluster, labelled } = mount();
    expect(labelled()).toEqual(['New']);
    resizeTo(1280);
    expect(cluster.getAttribute('data-folded')).toBe('false');
    expect(labelled()).toEqual(['New', 'Import', 'Update Stage']);
    resizeTo(600);
    expect(labelled()).toEqual(['New']);
  });

  it('a width where the folded face fits but `actions` would clip the text stays folded (no flip-flop)', () => {
    // Unfolded the text needs 51 + 224 = 275 px beside 356 px of actions:
    // 691 px. Folded, beside 140 px, it fits from 475 px. At 650 px it fits
    // folded and would clip unfolded, so the fold holds.
    headerWidth = 600;
    const { labelled } = mount();
    resizeTo(650);
    expect(labelled()).toEqual(['New']);
    resizeTo(691);
    expect(labelled()).toEqual(['New', 'Import', 'Update Stage']);
  });

  it('folds in the Setup posture too, where the description is its own line', () => {
    headerWidth = 600;
    const { header, cluster, labelled } = mount({ appName: 'setup' });
    expect(header.getAttribute('data-posture')).toBe('setup');
    expect(cluster.getAttribute('data-folded')).toBe('true');
    expect(labelled()).toEqual(['New']);
    expect(within(header).getByTestId('page-header-description').textContent).toBe(DESCRIPTION);
  });

  it('CONTROL — a page passing only `actions` keeps them at 600 px, as before', () => {
    headerWidth = 600;
    const { cluster, labelled } = mount({ fold: false });
    expect(cluster.getAttribute('data-folded')).toBeNull();
    expect(labelled()).toEqual(['New', 'Import', 'Update Stage']);
  });
});
