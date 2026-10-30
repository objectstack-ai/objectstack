/**
 * objectstack#27521 row 5 — a Setup header tag (Admin config, Platform
 * schema, System-managed, Identity) explains itself in a tooltip, and that
 * explanation is reachable from the keyboard: the tag takes focus, and focus
 * opens the tooltip as hover does.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagedByBadge } from '../ManagedByBadge';

describe('ManagedByBadge — the explanation is reachable from the keyboard (objectstack#27521)', () => {
  it('Tab focuses the tag and opens its explanation', async () => {
    render(<ManagedByBadge managedBy="config" />);
    const badge = screen.getByTestId('managed-by-badge');
    expect(screen.queryByRole('tooltip')).toBeNull();

    await userEvent.tab();
    expect(badge).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Administrator configuration');
  });

  it('CONTROL: a platform object draws no tag, so there is nothing to focus', async () => {
    render(<ManagedByBadge managedBy="platform" />);
    expect(screen.queryByTestId('managed-by-badge')).toBeNull();
  });
});
