/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36023 — a person's face never makes its list row taller.
 *
 * Measured in the browser before the fix: a list row holding a `user` cell
 * was 41 px tall (a 32 px face plus the cell's padding) while every row of
 * text was 33 px, and it dropped back to 33 px while the cell was edited, so
 * the list jumped. The face is now drawn at 24 px and laid out at 20 px (a
 * negative block margin), the line height of the cell's text, so the row is
 * the height of a row of text with and without the face. jsdom lays nothing
 * out; the pin is on the classes that decide it, and the browser reading is
 * the PR's.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UserCellRenderer } from '../index';

afterEach(cleanup);

// The face is the Avatar root (a rounded-full span); it carries no slot attribute.
const faces = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('span.rounded-full.overflow-hidden'));

describe('UserCellRenderer — the face is no taller than a line of text (objectstack#36023)', () => {
  it('one person: a 24 px face laid out at 20 px, never the 32 px one', () => {
    const { container } = render(<UserCellRenderer value={{ id: 'u_1', name: 'Ada Lovelace' }} field={{ name: 'owner', type: 'user' } as any} />);
    const [face] = faces(container);
    expect(face).toBeDefined();
    expect(face).toHaveClass('size-6', '-my-0.5');
    expect(face).not.toHaveClass('size-8');
    expect(container).toHaveTextContent('Ada Lovelace');
  });

  it('several people: every face in the stack and the "+N" face are the same size', () => {
    const people = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Edsger Dijkstra'].map((name, i) => ({ id: `u_${i}`, name }));
    const { container } = render(<UserCellRenderer value={people} field={{ name: 'watchers', type: 'user', multiple: true } as any} />);
    const all = faces(container);
    expect(all).toHaveLength(4);
    for (const face of all) {
      expect(face).toHaveClass('size-6', '-my-0.5');
      expect(face).not.toHaveClass('size-8');
    }
    expect(all[3]).toHaveTextContent('+1');
  });
});
