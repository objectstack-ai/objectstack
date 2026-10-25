/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `BulkActionBar` — ADR-0066 D4 `requiredPermissions` gate (objectui#3492).
 *
 * The selection bar is the FOURTH surface that renders actions and filters its
 * own list rather than going through `ActionEngine.getActionsForLocation`. The
 * other three already gate (`action-bar.tsx` for the list toolbar,
 * `containers.tsx` for the record header, `RowActionMenu.tsx` for the row
 * kebab); this one never did. The consequence was a contradiction on one
 * screen: the same action was hidden from an unentitled user in the row kebab
 * and offered to them in the bulk bar the moment they ticked a checkbox — and
 * for a `type: 'api'` action pointed at a custom endpoint, nothing behind it
 * was guaranteed to say no.
 *
 * The rule is the engine's, verbatim: an empty declaration always passes,
 * several are AND-ed, and unknown capabilities fail OPEN (the server is the
 * authority). See `useCapabilityGate`.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionProvider, PredicateScopeProvider } from '@object-ui/react';
import type { BulkActionDef } from '@object-ui/types';
import { BulkActionBar } from '../components/BulkActionBar';

const GATED: BulkActionDef = {
  name: 'push_down',
  label: 'Push Down',
  operation: 'custom',
  requiredPermissions: ['plan.push'],
};

const PLAIN: BulkActionDef = { name: 'tag', label: 'Tag', operation: 'custom' };

function renderBar(
  actionDefs: BulkActionDef[],
  user: unknown,
  opts: { scope?: Record<string, any>; actions?: string[] } = {},
) {
  const tree = (
    <ActionProvider context={{ user } as any}>
      <BulkActionBar
        selectedRows={[{ id: 'r1' }]}
        actions={opts.actions ?? []}
        actionDefs={actionDefs}
        onActionDef={() => {}}
        onAction={() => {}}
      />
    </ActionProvider>
  );
  return render(
    opts.scope ? <PredicateScopeProvider scope={opts.scope}>{tree}</PredicateScopeProvider> : tree,
  );
}

const gatedShown = () => !!screen.queryByTestId('bulk-action-push_down');

describe('BulkActionBar — ADR-0066 D4 capability gate (#3492)', () => {
  it('hides a bulk action whose requiredPermissions the caller lacks', () => {
    renderBar([GATED, PLAIN], { id: 'u1', systemPermissions: ['setup.access'] });

    expect(gatedShown()).toBe(false);
    // It filters, it does not blank the bar: the ungated def is untouched and
    // the selection count / Clear affordance still renders.
    expect(screen.getByTestId('bulk-action-tag')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument();
  });

  it('shows the action when every declared capability is held', () => {
    renderBar([GATED], { id: 'u1', systemPermissions: ['plan.push', 'setup.access'] });

    expect(gatedShown()).toBe(true);
  });

  it('requires ALL declared capabilities (AND, not OR)', () => {
    renderBar(
      [{ ...GATED, requiredPermissions: ['plan.push', 'plan.approve'] }],
      { id: 'u1', systemPermissions: ['plan.push'] },
    );

    expect(gatedShown()).toBe(false);
  });

  it('gates on an EMPTY held set — "holds nothing" is known, not unknown', () => {
    renderBar([GATED], { id: 'u1', systemPermissions: [] });

    expect(gatedShown()).toBe(false);
  });

  it('fails OPEN when the host never resolved capabilities', () => {
    renderBar([GATED], { id: 'u1' });

    expect(gatedShown()).toBe(true);
  });

  it('falls back to the ambient predicate scope when there is no runner user', () => {
    renderBar([GATED], undefined, { scope: { user: { id: 'u1', systemPermissions: ['other'] } } });

    expect(gatedShown()).toBe(false);
  });

  it('lets an empty declaration through', () => {
    renderBar([{ ...GATED, requiredPermissions: [] }], { id: 'u1', systemPermissions: [] });

    expect(gatedShown()).toBe(true);
  });

  it('leaves legacy by-name buttons alone — they carry no declaration to gate', () => {
    renderBar([GATED], { id: 'u1', systemPermissions: [] }, { actions: ['legacy_notify'] });

    expect(gatedShown()).toBe(false);
    expect(screen.getByTestId('bulk-action-legacy_notify')).toBeInTheDocument();
  });
});
