/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RowActionMenu — ADR-0066 D4 `requiredPermissions` gate (framework#3923).
 *
 * `list_item` actions render here, and this component filters its own set
 * instead of going through `ActionEngine.getActionsForLocation` — so the
 * engine's capability gate never reached the row surface. A row action
 * declaring a capability nobody holds showed up in the "⋮" menu (and, for a
 * primary, as the row's inline CTA) and clicking it just produced whatever the
 * server said — or nothing at all when the action targets a custom endpoint the
 * platform's action route never sees.
 *
 * The gate is applied ONCE to the declared set, so the inline slot, the
 * overflow menu, and the "is there a menu at all?" decision can't disagree.
 * Assertions use `variant: 'primary'` (always-mounted inline buttons) plus the
 * overflow trigger, mirroring the sibling suite — dropdown items only mount
 * once the menu opens.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionProvider, PredicateScopeProvider } from '@object-ui/react';
import { RowActionMenu } from '../RowActionMenu';

const GATED = {
  name: 'gated',
  label: 'Set Reviewers',
  variant: 'primary' as const,
  requiredPermissions: ['ehr_probe_capability'],
} as any;
const PLAIN = { name: 'plain', label: 'Print', variant: 'primary' as const } as any;

function renderMenu(user: unknown, defs: any[], maxInlineActions = 2) {
  return render(
    <PredicateScopeProvider scope={{}}>
      <ActionProvider context={{ user } as any}>
        <RowActionMenu
          row={{ id: 'e1' }}
          onActionDef={() => {}}
          rowActionDefs={defs}
          maxInlineActions={maxInlineActions}
        />
      </ActionProvider>
    </PredicateScopeProvider>,
  );
}

const inline = (name: string) => screen.queryByTestId(`row-action-inline-${name}`);

describe('RowActionMenu — ADR-0066 D4 capability gate (#3923)', () => {
  it('hides a row action whose capability the caller lacks', () => {
    renderMenu({ id: 'u1', systemPermissions: ['setup.access'] }, [GATED, PLAIN]);
    expect(inline('gated')).not.toBeInTheDocument();
    // Filtering, not blanking — the ungated action is untouched.
    expect(inline('plain')).toBeInTheDocument();
  });

  it('shows it when the capability is held', () => {
    renderMenu({ id: 'u1', systemPermissions: ['ehr_probe_capability'] }, [GATED, PLAIN]);
    expect(inline('gated')).toBeInTheDocument();
  });

  it('requires ALL declared capabilities (AND, not OR)', () => {
    const both = { ...GATED, name: 'both', requiredPermissions: ['a', 'b'] };
    renderMenu({ id: 'u1', systemPermissions: ['a'] }, [both]);
    expect(inline('both')).not.toBeInTheDocument();
  });

  it('gates on an EMPTY held set — "holds nothing" is known, not unknown', () => {
    renderMenu({ id: 'u1', systemPermissions: [] }, [GATED]);
    expect(inline('gated')).not.toBeInTheDocument();
  });

  it('renders no overflow trigger when the gate empties the whole set', () => {
    // `hasMenu` must see the GATED set — otherwise the row grows a "⋮" button
    // that opens an empty menu.
    renderMenu({ id: 'u1', systemPermissions: [] }, [{ ...GATED, variant: 'secondary' }]);
    expect(screen.queryByTestId('row-action-trigger')).not.toBeInTheDocument();
  });

  it('still renders the overflow trigger for a gated action the caller holds', () => {
    renderMenu({ id: 'u1', systemPermissions: ['ehr_probe_capability'] }, [
      { ...GATED, variant: 'secondary' },
    ]);
    expect(screen.getByTestId('row-action-trigger')).toBeInTheDocument();
  });

  it('fails OPEN when the host never resolved capabilities', () => {
    renderMenu({ id: 'u1' }, [GATED]);
    expect(inline('gated')).toBeInTheDocument();
  });
});
