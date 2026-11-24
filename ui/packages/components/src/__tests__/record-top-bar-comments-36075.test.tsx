/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36075, item 2 — the record's comments switch sits in the record
 * row of the top bar, ahead of the record's button group, on the page and in
 * the drawer (`NavigationOverlay` hands it on); the one-row bar draws it
 * ahead of the button group too.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordTopBar } from '../custom/record-top-bar';

afterEach(() => cleanup());

function Bar({ twoRows }: { twoRows: boolean }) {
  const [, setSlot] = React.useState<HTMLElement | null>(null);
  return (
    <RecordTopBar
      record={twoRows ? <span>Wayne Enterprise License</span> : undefined}
      actionSlotRef={setSlot}
      comments={<button type="button" data-testid="comments">💬</button>}
      toggles={<span data-testid="toggles">⊟</span>}
    />
  );
}

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the comments switch in the record top bar', () => {
  it('two rows: in the record row, ahead of the button group', () => {
    render(<Bar twoRows />);
    const row = document.querySelector('[data-record-top-bar-record]') as HTMLElement;
    const comments = screen.getByTestId('comments');
    expect(row.contains(comments)).toBe(true);
    expect(follows(comments, row.querySelector('[data-record-top-bar-actions]')!)).toBe(true);
  });

  it('one row: ahead of the button group', () => {
    render(<Bar twoRows={false} />);
    const comments = screen.getByTestId('comments');
    expect(follows(comments, document.querySelector('[data-record-top-bar-actions]')!)).toBe(true);
  });
});
