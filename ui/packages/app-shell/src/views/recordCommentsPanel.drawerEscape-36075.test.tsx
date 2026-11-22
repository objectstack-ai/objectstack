// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36075 — in the record drawer, Esc pressed in the comment panel
 * closes the panel and returns to the record, as ✕ does: the drawer neither
 * closes nor steps back on it, at the stack's root (a record opened from the
 * list) or below it. The focus goes back to the comments icon.
 *
 * Pinned through the REAL drawer (`NavigationOverlay`, whose dialog layer
 * hears Esc on the document in the capture phase, ahead of the panel) around
 * the REAL panel (`RecordCommentsAside` → `CommentsPanel`). The CONTROL: an
 * Esc pressed in the record outside the panel still does what it did.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { NavigationOverlay, type NavigationOverlayProps } from '@object-ui/components';
import { DiscussionContextProvider } from '@object-ui/react';
import { RecordCommentsAside } from './recordCommentsPanel';

const ITEMS = [
  { id: 'c1', type: 'comment', actor: 'Ada', body: 'first thread', createdAt: '2026-10-01T08:00:00.000Z' },
];

function Record() {
  const [open, setOpen] = React.useState(true);
  return (
    <DiscussionContextProvider
      items={ITEMS as any[]}
      mentionSuggestions={[{ id: 'u-zoe', label: 'Zoe' }]}
      onAddComment={vi.fn()}
      onAddReply={vi.fn()}
    >
      <div style={{ position: 'relative' }}>
        <button type="button" data-comments-button="" aria-pressed={open} onClick={() => setOpen(!open)}>
          Comments icon
        </button>
        <button type="button">Record action</button>
        {open && <RecordCommentsAside placement="cover" onClose={() => setOpen(false)} />}
      </div>
    </DiscussionContextProvider>
  );
}

function renderDrawer(props: Partial<NavigationOverlayProps> = {}) {
  const setIsOpen = vi.fn();
  const close = vi.fn();
  render(
    <NavigationOverlay
      isOpen
      isOverlay
      selectedRecord={{ id: 'r1' }}
      mode="drawer"
      mainContent={<div>list</div>}
      close={close}
      setIsOpen={setIsOpen}
      title="Account"
      {...props}
    >
      {() => <Record />}
    </NavigationOverlay>,
  );
  return { setIsOpen, close };
}

const panel = () => document.querySelector('[data-comments-panel]') as HTMLElement | null;
const composer = () => within(document.querySelector('[data-comments-composer]') as HTMLElement).getByRole('textbox');
const esc = (target: Element) => fireEvent.keyDown(target, { key: 'Escape' });

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* private mode */
  }
});
afterEach(cleanup);

describe.each([
  ['at the stack’s root (a record opened from the list)', false],
  ['below the root', true],
])('the record drawer, %s', (_label, below) => {
  it.each([
    ['the comment box', () => composer()],
    ['the panel’s ✕', () => screen.getByRole('button', { name: 'Close comments' })],
  ])('Esc in %s closes the panel and returns to the record', (_where, target) => {
    const onBack = vi.fn();
    const { setIsOpen, close } = renderDrawer(below ? { onBack } : {});
    const el = target();
    el.focus();
    esc(el);
    expect(panel()).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
    expect(setIsOpen).not.toHaveBeenCalledWith(false);
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comments icon' })).toHaveFocus();
  });

  it('Esc in the @ list closes the list only: the panel and the drawer stay', () => {
    const onBack = vi.fn();
    const { setIsOpen } = renderDrawer(below ? { onBack } : {});
    const box = composer();
    box.focus();
    fireEvent.change(box, { target: { value: 'ask @', selectionStart: 5 } });
    expect(screen.getByRole('button', { name: /Zoe/ })).toBeInTheDocument();
    esc(box);
    expect(screen.queryByRole('button', { name: /Zoe/ })).toBeNull();
    expect(panel()).not.toBeNull();
    expect(box).toHaveValue('ask @');
    expect(onBack).not.toHaveBeenCalled();
    expect(setIsOpen).not.toHaveBeenCalledWith(false);
  });

  it('CONTROL: Esc on a record control outside the panel does what the drawer always did', () => {
    const onBack = vi.fn();
    const { setIsOpen, close } = renderDrawer(below ? { onBack } : {});
    const action = screen.getByRole('button', { name: 'Record action' });
    action.focus();
    esc(action);
    if (below) {
      expect(onBack).toHaveBeenCalledTimes(1);
    } else {
      expect(setIsOpen.mock.calls.some(([v]) => v === false) || close.mock.calls.length > 0).toBe(true);
    }
  });
});
