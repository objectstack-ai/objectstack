/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28156 — an `Esc` a field in the record takes is the field's:
 * below the stack's root it does not step the pane back, and maximized it
 * does not restore the pane. A bare `Esc` still does both (the controls).
 *
 * The drawer's Radix dialog layer hears `Esc` on the document in the capture
 * phase, ahead of the record's own handlers, so the fields are pinned in the
 * shapes they really take the key in:
 * - a cell editor cancels in a React `onKeyDown` and marks the key handled;
 * - the composer closes its mention list in a React `onKeyDown` and marks
 *   nothing;
 * - an enlarged face, which marks the key handled from a window capture
 *   listener, ahead of the layer: both its own `Esc` (it closes itself) and
 *   one pressed in a field inside it.
 * The split pane beside a list answers the same, from its document listener.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  NavigationOverlay,
  RECORD_SPLIT_MIN_CONTENT_PX,
  type NavigationOverlayProps,
} from '../custom/navigation-overlay';

/** What each field did with the `Esc` it got. */
let fieldLog: string[] = [];

/** The record's body: the fields, the face, and a control that owns no key. */
function RecordBody() {
  const faceRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !(e.target instanceof Node)) return;
      if (!faceRef.current?.contains(e.target)) return;
      fieldLog.push('face');
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
  return (
    <div>
      <input
        aria-label="Cell editor"
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          fieldLog.push('cell editor');
          e.preventDefault();
        }}
      />
      <textarea
        aria-label="Composer"
        onKeyDown={(e) => {
          if (e.key === 'Escape') fieldLog.push('mention list');
        }}
      />
      <div ref={faceRef} tabIndex={0} aria-label="Enlarged face">
        <input aria-label="Face field" />
      </div>
      <button type="button">Record action</button>
    </div>
  );
}

const FIELDS: Array<[label: string, logged: string]> = [
  ['Cell editor', 'cell editor'],
  ['Composer', 'mention list'],
  ['Face field', 'face'],
  ['Enlarged face', 'face'],
];

/** Rendered widths by test id; everything else measures 0 (unmeasured). */
let widths: Record<string, number> = {};
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  fieldLog = [];
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

function renderPane(props: Partial<NavigationOverlayProps> = {}) {
  const setIsOpen = vi.fn();
  const close = vi.fn();
  render(
    <NavigationOverlay
      isOpen
      isOverlay
      selectedRecord={{ id: 'r1' }}
      mode="drawer"
      close={close}
      setIsOpen={setIsOpen}
      title="Lead"
      {...props}
    >
      {() => <RecordBody />}
    </NavigationOverlay>,
  );
  return { setIsOpen, close };
}

/** The split pane beside a list wide enough to keep it there. */
const besideList: Partial<NavigationOverlayProps> = {
  mode: 'split',
  mainContent: <div>list</div>,
};

const esc = (target: Element | Document = document.body) => fireEvent.keyDown(target, { key: 'Escape' });
const field = (label: string) => screen.getByLabelText(label);
const maximize = () => fireEvent.click(screen.getByTestId('record-pane-maximize'));
const maximizedPane = () => document.querySelector('[data-maximized]');

describe('drawer, below the root: a field keeps its Esc, the level stays', () => {
  it.each(FIELDS)('Esc in the %s is the field’s; the drawer neither steps back nor closes', (label, logged) => {
    const onBack = vi.fn();
    const { setIsOpen, close } = renderPane({ onBack });
    esc(field(label));
    expect(fieldLog).toEqual([logged]);
    expect(onBack).not.toHaveBeenCalled();
    expect(setIsOpen).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Lead' })).toBeTruthy();
  });

  it('CONTROL: a bare Esc steps back one level, and does not close', () => {
    const onBack = vi.fn();
    const { setIsOpen } = renderPane({ onBack });
    esc();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(setIsOpen).not.toHaveBeenCalled();
  });

  it('CONTROL: an Esc on a control in the record that owns no key steps back too (the sheet’s own dialog owns nothing)', () => {
    const onBack = vi.fn();
    renderPane({ onBack });
    esc(screen.getByRole('button', { name: 'Record action' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(fieldLog).toEqual([]);
  });
});

describe('drawer, maximized: a field keeps its Esc, the pane stays maximized', () => {
  it.each(FIELDS)('Esc in the %s is the field’s; the drawer stays maximized and open', (label, logged) => {
    const { setIsOpen, close } = renderPane({ maximizable: true });
    maximize();
    expect(maximizedPane()).not.toBeNull();
    esc(field(label));
    expect(fieldLog).toEqual([logged]);
    expect(maximizedPane()).not.toBeNull();
    expect(setIsOpen).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('CONTROL: a bare Esc restores, and only the next Esc closes the root', () => {
    const { setIsOpen } = renderPane({ maximizable: true });
    maximize();
    esc();
    expect(maximizedPane()).toBeNull();
    expect(setIsOpen).not.toHaveBeenCalled();
    esc();
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});

describe('split pane beside the list: the same answers', () => {
  beforeEach(() => {
    widths = { 'record-split-host': RECORD_SPLIT_MIN_CONTENT_PX + 200, 'record-split-list': 600 };
  });

  it.each(FIELDS)('below the root, Esc in the %s keeps the level; a bare Esc steps back (CONTROL)', (label, logged) => {
    const onBack = vi.fn();
    renderPane({ ...besideList, onBack });
    expect(screen.getByTestId('record-split-pane')).toBeTruthy();
    esc(field(label));
    expect(fieldLog).toEqual([logged]);
    expect(onBack).not.toHaveBeenCalled();
    esc();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it.each(FIELDS)('maximized, Esc in the %s keeps it maximized; a bare Esc restores (CONTROL)', (label, logged) => {
    const { close } = renderPane({ ...besideList, maximizable: true });
    maximize();
    esc(field(label));
    expect(fieldLog).toEqual([logged]);
    expect(maximizedPane()).not.toBeNull();
    esc();
    expect(maximizedPane()).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
});
