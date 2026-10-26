/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12772 — a declared `ActionSchema.icon` is drawn on BOTH custom
 * row-action surfaces: the inline primary button (`RowActionInlineButton`) and
 * the "⋮" menu item (`RowActionMenuItem`). The producer that filed it is a
 * control-plane "Open" action declaring `icon: 'external-link'`.
 *
 * Three facts per surface:
 *  (a) a declared, known name draws its glyph AND keeps the label;
 *  (b) CONTROL — no `icon` declared ⇒ the element's markup is the label alone,
 *      exactly what this surface rendered before the icon was read;
 *  (c) an unknown name draws no glyph and does not throw — the label alone.
 *
 * The name goes through the shared icon seam (`resolveIcon` from
 * `@object-ui/components`), which draws its `<svg>` with lucide's classes in
 * the same tick, so the glyph is asserted by its `lucide-<kebab>` class without
 * awaiting the lazily loaded path data.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { RowActionMenu, type RowActionDef } from '../RowActionMenu';

const UNKNOWN_ICON = 'definitely-not-a-lucide-glyph';

function renderMenu(rowActionDefs: RowActionDef[]) {
  return render(
    <PredicateScopeProvider scope={{}}>
      <RowActionMenu row={{ id: 'e1' }} onActionDef={() => {}} rowActionDefs={rowActionDefs} />
    </PredicateScopeProvider>,
  );
}

describe('RowActionInlineButton draws a declared icon beside the label (objectui#12772)', () => {
  const OPEN = { name: 'open', label: 'Open', variant: 'primary' as const };

  it("(a) icon: 'external-link' renders the glyph and the label", () => {
    renderMenu([{ ...OPEN, icon: 'external-link' }]);
    const button = screen.getByTestId('row-action-inline-open');
    expect(button.querySelector('svg.lucide-external-link')).not.toBeNull();
    expect(button).toHaveTextContent('Open');
  });

  it('(b) CONTROL: no icon declared → the button holds the label alone', () => {
    renderMenu([OPEN]);
    const button = screen.getByTestId('row-action-inline-open');
    expect(button.querySelector('svg')).toBeNull();
    expect(button.innerHTML).toBe('Open');
  });

  it('(c) an unknown icon name → the label alone, no glyph, no throw', () => {
    expect(() => renderMenu([{ ...OPEN, icon: UNKNOWN_ICON }])).not.toThrow();
    const button = screen.getByTestId('row-action-inline-open');
    expect(button.querySelector('svg')).toBeNull();
    expect(button.innerHTML).toBe('Open');
  });
});

describe('RowActionMenuItem draws a declared icon beside the label (objectui#12772)', () => {
  const ARCHIVE = { name: 'archive', label: 'Archive', variant: 'secondary' as const };

  async function openMenu(def: RowActionDef) {
    renderMenu([def]);
    await userEvent.click(screen.getByTestId('row-action-trigger'));
    return screen.findByTestId('row-action-archive');
  }

  it("(a) icon: 'external-link' renders the glyph and the label", async () => {
    const item = await openMenu({ ...ARCHIVE, icon: 'external-link' });
    expect(item.querySelector('svg.lucide-external-link')).not.toBeNull();
    expect(item).toHaveTextContent('Archive');
  });

  it('(b) CONTROL: no icon declared → the item holds the label alone', async () => {
    const item = await openMenu(ARCHIVE);
    expect(item.querySelector('svg')).toBeNull();
    expect(item.innerHTML).toBe('Archive');
  });

  it('(c) an unknown icon name → the label alone, no glyph, no throw', async () => {
    const item = await openMenu({ ...ARCHIVE, icon: UNKNOWN_ICON });
    expect(item.querySelector('svg')).toBeNull();
    expect(item.innerHTML).toBe('Archive');
  });
});
