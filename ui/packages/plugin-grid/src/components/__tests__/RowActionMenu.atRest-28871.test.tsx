/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28871 — the row's ⋯ trigger is visible at rest.
 *
 * The list grid always draws its Actions header, so a trigger hidden until the
 * pointer reaches a row left a headed column of cells that looked empty, read
 * as "no actions available". The trigger is now drawn on every row at rest in
 * the muted tone, on every pointer type alike, and rises to full strength on
 * row hover, focus-within, a selected row, its own focus, an open menu and a
 * coarse pointer (which cannot hover).
 *
 * jsdom applies no stylesheet, so "visible" is read off the classes that decide
 * it: no `opacity-0` / `invisible` / `hidden` at rest, the muted tone as the
 * resting colour, and the reveal variants that lift it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { RowActionMenu } from '../RowActionMenu';

const ARCHIVE = { name: 'archive', label: 'Archive', variant: 'secondary' as const };

function renderMenu(props: Record<string, any> = {}) {
  return render(
    <PredicateScopeProvider scope={{}}>
      <RowActionMenu row={{ id: 'r1' }} onActionDef={() => {}} rowActionDefs={[ARCHIVE]} {...props} />
    </PredicateScopeProvider>,
  );
}

describe('RowActionMenu trigger at rest (objectstack#28871)', () => {
  it('is drawn at rest: nothing hides it before the pointer reaches the row', () => {
    renderMenu();
    const trigger = screen.getByTestId('row-action-trigger');
    for (const hiding of ['opacity-0', 'invisible', 'hidden', 'sr-only']) {
      expect(trigger).not.toHaveClass(hiding);
    }
    // No class carrying an opacity of zero under any variant either: a hover
    // reveal written as `opacity-0 hover:opacity-100` is still empty at rest.
    expect(trigger.className.split(/\s+/).filter((c) => /(^|:)opacity-0$/.test(c))).toEqual([]);
    expect(trigger).toHaveAccessibleName();
  });

  it('rests in the muted tone and lifts to full strength on hover, focus, selection and an open menu', () => {
    renderMenu();
    const trigger = screen.getByTestId('row-action-trigger');
    expect(trigger).toHaveClass(
      'text-muted-foreground',
      'group-hover/row:text-foreground',
      'group-focus-within/row:text-foreground',
      'group-data-[state=selected]/row:text-foreground',
      'data-[state=open]:text-foreground',
      'focus-visible:text-foreground',
    );
  });

  it('is drawn at rest on every pointer type alike; a coarse pointer, which cannot hover, gets full strength', () => {
    renderMenu();
    const trigger = screen.getByTestId('row-action-trigger');
    const coarse = trigger.className.split(/\s+/).filter((c) => c.startsWith('pointer-coarse:'));
    // The coarse pointer only strengthens the tone; it is never the thing that
    // makes the trigger appear.
    expect(coarse).toEqual(['pointer-coarse:text-foreground']);
  });

  it('control: the open menu marks the trigger open, the state the full-strength variant keys on', async () => {
    renderMenu();
    const trigger = screen.getByTestId('row-action-trigger');
    expect(trigger).toHaveAttribute('data-state', 'closed');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('data-state', 'open');
    expect(await screen.findByText('Archive')).toBeInTheDocument();
  });
});
