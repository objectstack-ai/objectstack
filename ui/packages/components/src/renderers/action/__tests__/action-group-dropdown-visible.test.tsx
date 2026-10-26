/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: an `action:group` in `display: 'dropdown'` mode must honor each
 * action's `visible` (and `enabled`) CEL predicate — the same way the group's
 * inline mode (`InlineActionButton`) already does. Previously the dropdown
 * branch mapped `schema.actions` straight to `DropdownMenuItem`s, so an action
 * whose `visible` said to hide it showed anyway.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { DropdownActionItem } from '../action-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../../ui';

// Render a single dropdown action item inside a controlled-open menu so the
// portal content mounts deterministically (Radix triggers open on pointerdown,
// which is flaky to synthesize in happy-dom). `visible`/`enabled` resolve
// against the ambient ExpressionProvider scope, matching `InlineActionButton`.
function renderItem(action: any, scope: Record<string, any> = {}) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownActionItem action={action} index={0} onSelect={() => {}} />
        </DropdownMenuContent>
      </DropdownMenu>
    </PredicateScopeProvider>,
  );
}

describe('action:group dropdown item — visible / enabled CEL', () => {
  it('hides an action whose `visible` predicate is false', () => {
    renderItem(
      { name: 'archive', label: 'Archive', visible: 'features.canArchive == true' },
      { features: { canArchive: false } },
    );
    expect(screen.queryByText('Archive')).toBeNull();
  });

  it('shows an action whose `visible` predicate is true', () => {
    renderItem(
      { name: 'archive', label: 'Archive', visible: 'features.canArchive == true' },
      { features: { canArchive: true } },
    );
    expect(screen.getByText('Archive')).toBeInTheDocument();
  });

  it('renders an action with no `visible` predicate', () => {
    renderItem({ name: 'view', label: 'View' });
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('disables (but still renders) an action whose `enabled` CEL is false', () => {
    renderItem(
      { name: 'run', label: 'Run', enabled: 'features.ready == true' },
      { features: { ready: false } },
    );
    const item = screen.getByText('Run').closest('[role="menuitem"]');
    expect(item).toBeTruthy();
    expect(item).toHaveAttribute('data-disabled');
  });
});

// Spec field is `disabled` (boolean | CEL — disabled when TRUE). #1885 wired it
// in action-button only; the group/icon/menu leaves kept reading the legacy
// non-spec `enabled`, so a spec-authored `disabled` guard silently did nothing
// there. These pin the follow-through: `disabled` is the primary control and
// wins over the deprecated `enabled` fallback.
describe('action:group dropdown item — spec `disabled` CEL', () => {
  it('disables an action whose `disabled` predicate is TRUE', () => {
    renderItem(
      { name: 'close', label: 'Close', disabled: 'record.status == "closed"' },
      { record: { status: 'closed' } },
    );
    const item = screen.getByText('Close').closest('[role="menuitem"]');
    expect(item).toHaveAttribute('data-disabled');
  });

  it('keeps an action clickable when `disabled` is FALSE', () => {
    renderItem(
      { name: 'close', label: 'Close', disabled: 'record.status == "closed"' },
      { record: { status: 'open' } },
    );
    const item = screen.getByText('Close').closest('[role="menuitem"]');
    expect(item).not.toHaveAttribute('data-disabled');
  });

  it('`disabled` wins over the legacy `enabled` fallback when both are present', () => {
    renderItem(
      { name: 'close', label: 'Close', disabled: 'record.locked == true', enabled: 'true' },
      { record: { locked: true } },
    );
    const item = screen.getByText('Close').closest('[role="menuitem"]');
    expect(item).toHaveAttribute('data-disabled');
  });

  it('supports the boolean literal form (`disabled: true`)', () => {
    renderItem({ name: 'close', label: 'Close', disabled: true });
    const item = screen.getByText('Close').closest('[role="menuitem"]');
    expect(item).toHaveAttribute('data-disabled');
  });
});
