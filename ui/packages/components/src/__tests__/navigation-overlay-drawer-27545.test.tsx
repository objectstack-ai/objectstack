/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545 — the record drawer mechanics `NavigationOverlay` owns
 * (maintainer rulings of 2026-10-29), and objectstack#28915 — the split pane
 * retired (「默认改抽屉，分屏彻底退役，只留抽屉和整页」), so the drawer is the
 * one face over a list:
 *
 * 1. The drawer over a list is non-modal and undimmed: the list is the one
 *    `mainContent` element in every state, so it never remounts, keeps its
 *    full width (nothing narrows it), and stays clickable. A drawer with no
 *    list stays the modal sheet (the control).
 * 2. objectstack#35854 — the drawer is a floating card (8 px clear of the
 *    viewport's top, right and bottom, rounded, shadowed). It has no wider
 *    state: the bar's one `⤢` is the host's `onExpand`, which goes to the
 *    full page; `Esc` and `✕` close.
 * The drag range is 360 px to 60vw, and a remembered width is drawn inside it.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NavigationOverlay, type NavigationOverlayProps } from '../custom/navigation-overlay';
import * as overlayModule from '../custom/navigation-overlay';
import * as listFaceModule from '../custom/record-list-face';

let listMounts = 0;

/** The list a host hands over: counts its mounts. */
function ListProbe({ onRowClick }: { onRowClick?: () => void }) {
  React.useEffect(() => {
    listMounts += 1;
  }, []);
  return (
    <div data-testid="list-probe">
      <button type="button" onClick={onRowClick}>
        Row two
      </button>
    </div>
  );
}

beforeEach(() => {
  listMounts = 0;
  try { window.localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
});

const list = <ListProbe />;

function overlay(props: Partial<NavigationOverlayProps> = {}) {
  return (
    <NavigationOverlay
      isOpen
      isOverlay
      selectedRecord={{ id: 'r1' }}
      mode="drawer"
      close={() => {}}
      setIsOpen={() => {}}
      title="Lead"
      width="720px"
      mainContent={list}
      {...props}
    >
      {() => <div data-testid="payload">record body</div>}
    </NavigationOverlay>
  );
}

const drawer = () => screen.queryByRole('dialog', { name: 'Lead' });
const listHost = () => screen.getByTestId('record-list-host');

describe('1 — the drawer is over the list, non-modal, and the list never remounts or narrows', () => {
  it('draws the drawer over the list, undimmed, the list still clickable and not inert', () => {
    const onRowClick = vi.fn();
    render(overlay({ mainContent: <ListProbe onRowClick={onRowClick} /> }));
    expect(drawer()).toBeTruthy();
    expect(screen.getByTestId('payload')).toBeTruthy();
    expect(document.querySelector('[data-slot="sheet-overlay"], .bg-black\\/50, .bg-black\\/80')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Row two' }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(listHost().hasAttribute('inert')).toBe(false);
  });

  it('an outside click does not close it', () => {
    const setIsOpen = vi.fn();
    render(overlay({ setIsOpen }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Row two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Row two' }));
    expect(setIsOpen).not.toHaveBeenCalledWith(false);
    expect(drawer()).toBeTruthy();
  });

  it('keeps one list element from closed to open to another record to closed', () => {
    const { rerender } = render(overlay({ isOpen: false, selectedRecord: null }));
    expect(drawer()).toBeNull();
    const listNode = listHost().firstElementChild;
    rerender(overlay());
    rerender(overlay({ selectedRecord: { id: 'r2' } }));
    rerender(overlay({ isOpen: false, selectedRecord: null }));
    expect(listMounts).toBe(1);
    expect(listHost().firstElementChild).toBe(listNode);
  });

  it('the list keeps its full width: its host is one flex column with nothing drawn beside it', () => {
    render(overlay());
    const host = listHost();
    expect(host.className).toContain('flex-1');
    expect(host.className).toContain('flex-col');
    expect(host.children).toHaveLength(1);
    expect(host.parentElement?.querySelector('aside')).toBeNull();
    expect(screen.queryByTestId('record-split-pane')).toBeNull();
  });

  it('a page-mode host still draws its list, and no record', () => {
    render(overlay({ mode: 'page' }));
    expect(screen.getByTestId('list-probe')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('CONTROL: a drawer with no list is the modal, dimmed sheet over the page', () => {
    render(overlay({ mainContent: undefined }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.querySelector('.bg-black\\/80')).not.toBeNull();
  });

  it('the split face and its narrowed list faces are gone from the published surface', () => {
    expect('RECORD_SPLIT_MIN_CONTENT_PX' in overlayModule).toBe(false);
    for (const name of ['useRecordListFace', 'RecordListFaceProvider', 'recordListFaceFor', 'RECORD_LIST_CARD_FACE_BELOW_PX', 'RECORD_LIST_NARROW_COLUMN_COUNT']) {
      expect(name in listFaceModule).toBe(false);
    }
  });
});

describe('2 — the drawer is a floating card with one ⤢, which opens the page', () => {
  const drawerWidth = () => drawer()!.style.getPropertyValue('--ov-w').trim();

  it('is a card: clear of the viewport edges, rounded, shadowed, bordered all round', () => {
    render(overlay());
    const card = drawer()!;
    expect(card.hasAttribute('data-record-drawer-card')).toBe(true);
    for (const token of ['sm:inset-y-2', 'sm:right-2', 'sm:rounded-xl', 'sm:border', 'sm:shadow-2xl']) {
      expect(card.className.split(/\s+/)).toContain(token);
    }
    expect(drawerWidth()).toBe('720px');
  });

  it('⤢ is the host\'s open-the-page hop, and there is no maximize control or state', () => {
    const onExpand = vi.fn();
    render(overlay({ onExpand }));
    expect(screen.queryByTestId('record-pane-maximize')).toBeNull();
    const open = screen.getByTestId('record-pane-open-page');
    expect(open.getAttribute('aria-label')).toBe('Open as full page');
    fireEvent.click(open);
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(drawer()!.hasAttribute('data-maximized')).toBe(false);
    expect(drawerWidth()).toBe('720px');
    expect(listHost().hasAttribute('inert')).toBe(false);
  });

  it('with no host hop there is no ⤢ at all', () => {
    render(overlay());
    expect(screen.queryByTestId('record-pane-open-page')).toBeNull();
  });

  it('Esc closes at once', () => {
    const setIsOpen = vi.fn();
    render(overlay({ setIsOpen }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  it('✕ closes the whole path', () => {
    const close = vi.fn();
    render(overlay({ close }));
    // By `title`: the sheet primitive's own (CSS-hidden) close shares the name in jsdom.
    fireEvent.click(screen.getByTitle('Close'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('the maximize width helpers are gone from the published surface', () => {
    for (const name of ['SIDEBAR_WIDTH_FALLBACK', 'SIDEBAR_WIDTH_ICON_FALLBACK', 'maximizedWidthCss', 'useLiveSidebarWidth']) {
      expect(name in overlayModule).toBe(false);
    }
  });
});

describe('the drag range: 360 px to 60vw, remembered per object, a remembered width clamped', () => {
  const drawerWidth = () => drawer()!.style.getPropertyValue('--ov-w').trim();

  it('a remembered 1300 is drawn inside the range', () => {
    window.localStorage.setItem('ov:drawer-width:lead', '1300');
    render(overlay({ storageKey: 'drawer-width:lead' }));
    expect(drawerWidth()).toBe('min(1300px, 60vw)');
  });

  it('a drag stops at 60vw and at 360 px, and the width is remembered under the key', () => {
    render(overlay({ storageKey: 'drawer-width:lead' }));
    const handle = screen.getByRole('separator');
    const maxPx = Math.floor((window.innerWidth * 60) / 100);
    act(() => {
      fireEvent.mouseDown(handle);
      fireEvent.mouseMove(window, { clientX: -5000 });
    });
    expect(drawerWidth()).toBe(`min(${maxPx}px, 60vw)`);
    act(() => {
      fireEvent.mouseMove(window, { clientX: 5000 });
      fireEvent.mouseUp(window);
    });
    // The drawer's right edge is the viewport's: the handle's parent measures 0 in jsdom.
    expect(Number(window.localStorage.getItem('ov:drawer-width:lead'))).toBeGreaterThanOrEqual(360);
  });
});
