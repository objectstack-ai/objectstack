/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack-ai/objectstack#37761 — a record title with a long unbroken token
 * (a pasted URL, a file name, a hash) stretched the delete confirm past the
 * viewport, and Cancel / Delete went off-screen.
 *
 * The content is a CSS grid with `w-full max-w-lg`; its single column track is
 * `auto`, so a grid item's min-content width (the token's width) set the track
 * width, past `max-w-lg`, and the right-aligned footer moved with it. Measured
 * in Chromium at 1440 px with Tailwind 4.3.3 compiling this file's classes and
 * a 5,000-character token: dialog client width 510 px, scroll width 51,248 px,
 * Cancel at x 51,540 on main; scroll width 510 px, Cancel at x 778 with the fix.
 *
 * jsdom does no layout, so this pins the two rules that do the work, on the
 * shared component every alert dialog renders through:
 *   - the content's grid items may shrink below their min-content width
 *     (`[&>*]:min-w-0`), so no child can widen the track;
 *   - the title and the description break an unbroken token
 *     (`overflow-wrap: anywhere`) instead of overflowing.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

afterEach(() => cleanup());

const TOKEN = 'x'.repeat(5000);

function renderConfirm(className?: { title?: string; description?: string }) {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={className?.title}>{`Delete lead “${TOKEN}”?`}</AlertDialogTitle>
          <AlertDialogDescription className={className?.description}>{`https://example.com/${TOKEN}`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
  const dialog = screen.getByRole('alertdialog');
  return {
    dialog,
    title: dialog.querySelector('h2') as HTMLElement,
    description: dialog.querySelector('p') as HTMLElement,
  };
}

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

describe('objectstack#37761 — a long unbroken token keeps the alert dialog inside max-w-lg', () => {
  it("the content's grid items may shrink below their min-content width", () => {
    const { dialog } = renderConfirm();
    expect(tokens(dialog)).toEqual(expect.arrayContaining(['grid', 'w-full', 'max-w-lg', '[&>*]:min-w-0']));
  });

  it('the title and the description break an unbroken token', () => {
    const { title, description } = renderConfirm();
    expect(title.textContent).toContain(TOKEN);
    expect(tokens(title)).toContain('[overflow-wrap:anywhere]');
    expect(tokens(description)).toContain('[overflow-wrap:anywhere]');
  });

  it("a caller's own classes merge onto the title and description, and the wrap rule stays", () => {
    const { title, description } = renderConfirm({ title: 'text-xl', description: 'text-base' });
    expect(tokens(title)).toEqual(expect.arrayContaining(['text-xl', 'font-semibold', '[overflow-wrap:anywhere]']));
    expect(tokens(title)).not.toContain('text-lg');
    expect(tokens(description)).toEqual(expect.arrayContaining(['text-base', '[overflow-wrap:anywhere]']));
  });

  it('CONTROL — both buttons are still rendered in the footer', () => {
    renderConfirm();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
