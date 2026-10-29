/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27052 / objectstack#27241 — `PanelToggles`: ONE named segmented
 * control, each segment an icon and its label, announcing whether its panel
 * is shown (`aria-pressed`), filled with the accent tint when it is, and
 * naming its shortcut in the tooltip.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PanelToggles, type PanelToggleItem } from './panel-toggles';

const Icon = ({ className }: { className?: string }) => <svg className={className} data-testid="icon" />;

function Host({ initial = { timeline: true, related: false } }: { initial?: { timeline: boolean; related: boolean } }) {
  const [shown, setShown] = React.useState(initial);
  const items: PanelToggleItem[] = [
    {
      id: 'timeline',
      label: 'Timeline',
      icon: Icon,
      pressed: shown.timeline,
      onPressedChange: (timeline) => setShown((s) => ({ ...s, timeline })),
      shortcut: ['⌘', '⇧', '.'],
      ariaKeyShortcuts: 'Meta+Shift+.',
    },
    {
      id: 'related',
      label: 'Related',
      icon: Icon,
      pressed: shown.related,
      onPressedChange: (related) => setShown((s) => ({ ...s, related })),
    },
  ];
  return <PanelToggles items={items} label="Panels" />;
}

afterEach(() => cleanup());

describe('PanelToggles (objectstack#27052)', () => {
  it('draws a named group of toggles whose pressed state is the panel shown', () => {
    render(<Host />);
    expect(screen.getByRole('group', { name: 'Panels' })).toBeTruthy();
    const timeline = screen.getByRole('button', { name: 'Timeline' });
    const related = screen.getByRole('button', { name: 'Related' });
    expect(timeline.getAttribute('aria-pressed')).toBe('true');
    expect(related.getAttribute('aria-pressed')).toBe('false');
    expect(timeline.getAttribute('aria-keyshortcuts')).toBe('Meta+Shift+.');
    // The pressed state is the accent fill with foreground text; an off
    // segment is muted text (objectstack#27241).
    expect(timeline.className).toContain('aria-pressed:bg-accent');
    expect(timeline.className).toContain('aria-pressed:text-accent-foreground');
    expect(related.className).toContain('text-muted-foreground');
  });

  it('each segment draws its icon and its label as visible text (objectstack#27241)', () => {
    render(<Host />);
    const timeline = screen.getByRole('button', { name: 'Timeline' });
    expect(timeline.textContent).toBe('Timeline');
    expect(timeline.querySelector('[data-testid="icon"]')).not.toBeNull();
    // One control: both segments in the one group.
    const group = screen.getByRole('group', { name: 'Panels' });
    expect(group.querySelectorAll('[data-panel-toggle]')).toHaveLength(2);
  });

  it('a click flips its own panel and no other', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByRole('button', { name: 'Timeline' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Related' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Related' }));
    expect(screen.getByRole('button', { name: 'Related' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the tooltip names the panel and its shortcut', async () => {
    render(<Host />);
    fireEvent.focus(screen.getByRole('button', { name: 'Timeline' }));
    const tip = await waitFor(() => {
      const el = document.querySelector('[data-slot="kbd-group"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(Array.from(tip.querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['⌘', '⇧', '.']);
  });

  it('draws nothing with no panels', () => {
    const { container } = render(<PanelToggles items={[]} label="Panels" />);
    expect(container.innerHTML).toBe('');
  });
});
