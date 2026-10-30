/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545 — the record pane v4 mechanics `NavigationOverlay` owns
 * (maintainer rulings of 2026-10-29):
 *
 * 1. `split` draws the pane beside the list, non-modal and undimmed: the list
 *    is the one `mainContent` element in every state, so it never remounts,
 *    stays clickable, and reads the face it is narrowed to (`columns` at
 *    ≥ 440 px, `cards` below, `full` with no pane beside it).
 * 2. Below a 1000 px content area the split face falls back to the drawer,
 *    which is non-modal over the list too: no overlay, an outside click keeps
 *    it open. A drawer with no list stays the modal sheet (the control).
 * 3. `⤢` maximizes in place to the viewport less the LIVE sidebar width;
 *    `⤡` or `Esc` restores, `✕` closes, and a closed pane forgets it.
 * The drag range is 360 px to 60vw, and a remembered width is drawn inside it.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import {
  NavigationOverlay,
  RECORD_SPLIT_MIN_CONTENT_PX,
  SIDEBAR_WIDTH_FALLBACK,
  SIDEBAR_WIDTH_ICON_FALLBACK,
  type NavigationOverlayProps,
} from '../custom/navigation-overlay';
import { useRecordListFace, RECORD_LIST_CARD_FACE_BELOW_PX } from '../custom/record-list-face';
import { SidebarProvider } from '../ui/sidebar';

let listMounts = 0;

/** The list a host hands over: counts its mounts, prints its face. */
function ListProbe({ onRowClick }: { onRowClick?: () => void }) {
  React.useEffect(() => {
    listMounts += 1;
  }, []);
  const face = useRecordListFace();
  return (
    <div>
      <span data-testid="list-face">{face}</span>
      <button type="button" onClick={onRowClick}>
        Row two
      </button>
    </div>
  );
}

/** Rendered widths by test id; everything else measures 0 (unmeasured). */
let widths: Record<string, number> = {};
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  listMounts = 0;
  widths = {};
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const width = widths[this.dataset.testid ?? ''] ?? 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  try { window.localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = realRect;
});

const list = <ListProbe />;

function overlay(props: Partial<NavigationOverlayProps> = {}) {
  return (
    <NavigationOverlay
      isOpen
      isOverlay
      selectedRecord={{ id: 'r1' }}
      mode="split"
      close={() => {}}
      setIsOpen={() => {}}
      title="Lead"
      width="720px"
      mainContent={list}
      maximizable
      {...props}
    >
      {() => <div data-testid="payload">record body</div>}
    </NavigationOverlay>
  );
}

const pane = () => screen.queryByTestId('record-split-pane');
const listFace = () => screen.getByTestId('list-face').textContent;

describe('1 — split is beside the list, non-modal, and the list never remounts', () => {
  it('draws the pane as a landmark beside the list, no dialog, the list still clickable', () => {
    const onRowClick = vi.fn();
    render(overlay({ mainContent: <ListProbe onRowClick={onRowClick} /> }));
    expect(pane()).toBeTruthy();
    expect(pane()!.tagName).toBe('ASIDE');
    expect(screen.getByRole('complementary', { name: 'Lead' })).toBe(pane());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('payload')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Row two' }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('record-split-list').hasAttribute('inert')).toBe(false);
  });

  it('keeps one list element from closed to open to another record to closed', () => {
    const { rerender } = render(overlay({ isOpen: false, selectedRecord: null }));
    expect(pane()).toBeNull();
    const listNode = screen.getByTestId('record-split-list').firstElementChild;
    rerender(overlay());
    rerender(overlay({ selectedRecord: { id: 'r2' } }));
    rerender(overlay({ isOpen: false, selectedRecord: null }));
    expect(listMounts).toBe(1);
    expect(screen.getByTestId('record-split-list').firstElementChild).toBe(listNode);
  });

  it('a page-mode host still draws its list, and no record', () => {
    render(overlay({ mode: 'page' }));
    expect(screen.getByTestId('list-face')).toBeTruthy();
    expect(pane()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the list reads its narrowed face: columns, then cards below 440 px, full when closed', () => {
    widths = { 'record-split-host': 1440, 'record-split-list': 720 };
    render(overlay());
    expect(listFace()).toBe('columns');
    cleanup();
    widths = { 'record-split-host': 1100, 'record-split-list': RECORD_LIST_CARD_FACE_BELOW_PX - 1 };
    render(overlay());
    expect(listFace()).toBe('cards');
    cleanup();
    widths = { 'record-split-host': 1440, 'record-split-list': 720 };
    const { rerender } = render(overlay({ isOpen: false, selectedRecord: null }));
    expect(listFace()).toBe('full');
    rerender(overlay());
    expect(listFace()).toBe('columns');
  });
});

describe('2 — under a 1000 px content area the split face is the non-modal drawer', () => {
  it(`falls back below ${RECORD_SPLIT_MIN_CONTENT_PX} px, the list behind it full-width`, () => {
    widths = { 'record-split-host': RECORD_SPLIT_MIN_CONTENT_PX - 1, 'record-split-list': 999 };
    render(overlay());
    expect(pane()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Lead' })).toBeTruthy();
    expect(screen.getByTestId('payload')).toBeTruthy();
    expect(listFace()).toBe('full');
  });

  it('at exactly 1000 px the pane stays beside the list (control)', () => {
    widths = { 'record-split-host': RECORD_SPLIT_MIN_CONTENT_PX, 'record-split-list': 280 };
    render(overlay());
    expect(pane()).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the drawer draws no overlay and an outside click does not close it', () => {
    const setIsOpen = vi.fn();
    render(overlay({ mode: 'drawer', setIsOpen }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelector('[data-slot="sheet-overlay"], .bg-black\\/50, .bg-black\\/80')).toBeNull();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Row two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Row two' }));
    expect(setIsOpen).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('CONTROL: a drawer with no list is the modal, dimmed sheet over the page', () => {
    render(overlay({ mode: 'drawer', mainContent: undefined }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelector('.bg-black\\/80')).not.toBeNull();
  });
});

describe('3 — ⤢ maximizes in place to the viewport less the live sidebar', () => {
  const maximize = () => screen.getByTestId('record-pane-maximize');
  const paneWidth = () => pane()!.style.getPropertyValue('--ov-w').trim();

  it('⤢ maximizes over the list, ⤡ restores; the list keeps its element and goes inert', () => {
    render(overlay());
    expect(maximize().getAttribute('aria-label')).toBe('Maximize');
    expect(paneWidth()).toBe('720px');
    fireEvent.click(maximize());
    expect(pane()!.hasAttribute('data-maximized')).toBe(true);
    expect(paneWidth()).toBe('calc(100vw - 0px)');
    expect(screen.getByTestId('record-split-list').hasAttribute('inert')).toBe(true);
    expect(listFace()).toBe('full');
    expect(maximize().getAttribute('aria-label')).toBe('Restore size');
    fireEvent.click(maximize());
    expect(pane()!.hasAttribute('data-maximized')).toBe(false);
    expect(paneWidth()).toBe('720px');
    expect(listMounts).toBe(1);
  });

  it('Esc restores from maximized, and only the next Esc closes', () => {
    const close = vi.fn();
    render(overlay({ close }));
    fireEvent.click(maximize());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(pane()!.hasAttribute('data-maximized')).toBe(false);
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('✕ closes the whole path even while maximized', () => {
    const close = vi.fn();
    render(overlay({ close }));
    fireEvent.click(maximize());
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('is not remembered: a pane closed while maximized opens at its own width', () => {
    const { rerender } = render(overlay());
    fireEvent.click(maximize());
    rerender(overlay({ isOpen: false, selectedRecord: null }));
    rerender(overlay());
    expect(pane()!.hasAttribute('data-maximized')).toBe(false);
    expect(paneWidth()).toBe('720px');
  });

  it('reads the sidebar live: expanded, then collapsed to its icon rail', () => {
    function Shell({ open }: { open: boolean }) {
      return <SidebarProvider open={open} onOpenChange={() => {}}>{overlay()}</SidebarProvider>;
    }
    const { rerender } = render(<Shell open />);
    fireEvent.click(maximize());
    expect(paneWidth()).toBe(`calc(100vw - var(--sidebar-width, ${SIDEBAR_WIDTH_FALLBACK}))`);
    rerender(<Shell open={false} />);
    expect(paneWidth()).toBe(`calc(100vw - var(--sidebar-width-icon, ${SIDEBAR_WIDTH_ICON_FALLBACK}))`);
  });

  it('the fallbacks a portalled drawer reads are the sidebar provider’s own widths', () => {
    const { container } = render(<SidebarProvider><span /></SidebarProvider>);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue('--sidebar-width')).toBe(SIDEBAR_WIDTH_FALLBACK);
    expect(wrapper.style.getPropertyValue('--sidebar-width-icon')).toBe(SIDEBAR_WIDTH_ICON_FALLBACK);
  });
});

describe('the drag range: 360 px to 60vw, remembered per object, a remembered width clamped', () => {
  const paneWidth = () => pane()!.style.getPropertyValue('--ov-w').trim();

  it('a remembered 1300 is drawn inside the range', () => {
    window.localStorage.setItem('ov:drawer-width:lead', '1300');
    render(overlay({ storageKey: 'drawer-width:lead' }));
    expect(paneWidth()).toBe('min(1300px, 60vw)');
  });

  it('a drag stops at 60vw and at 360 px, and the width is remembered under the key', () => {
    render(overlay({ storageKey: 'drawer-width:lead' }));
    const handle = screen.getByRole('separator');
    const maxPx = Math.floor((window.innerWidth * 60) / 100);
    act(() => {
      fireEvent.mouseDown(handle);
      fireEvent.mouseMove(window, { clientX: -5000 });
    });
    expect(paneWidth()).toBe(`min(${maxPx}px, 60vw)`);
    act(() => {
      fireEvent.mouseMove(window, { clientX: 5000 });
      fireEvent.mouseUp(window);
    });
    expect(paneWidth()).toBe('min(360px, 60vw)');
    expect(window.localStorage.getItem('ov:drawer-width:lead')).toBe('360');
  });
});
