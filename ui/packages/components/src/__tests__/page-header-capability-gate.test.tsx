/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:header` — ADR-0066 D4 `requiredPermissions` gate (framework#3923).
 *
 * `record_header` / `record_more` actions render through THIS component, which
 * filters its own action list rather than calling
 * `ActionEngine.getActionsForLocation`. So the engine's capability gate never
 * ran on the one surface those locations exist on: an action declaring a
 * capability nobody holds rendered as a live button, and the only thing behind
 * it was the server's 403 — which covers platform action routes only, never a
 * `type: 'api'` action pointed at a custom endpoint.
 *
 * The gate reads the ActionProvider's runner user (the same object the engine
 * reads), falls back to the ambient predicate scope, and fails OPEN when
 * neither knows — unknown is not denied.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, PredicateScopeProvider } from '@object-ui/react';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- registry component is stable
  return <Component schema={schema} />;
}

const schema = {
  type: 'page:header',
  title: 'Invoice',
  actions: [
    { name: 'gated', locations: ['record_header'], label: 'Set Parallel Reviewers', type: 'api', requiredPermissions: ['ehr_probe_capability'] },
    { name: 'plain', locations: ['record_header'], label: 'Print', type: 'api' },
  ],
};

const renderWithUser = (user: unknown, scope?: Record<string, any>) => {
  const tree = <ActionProvider context={{ user } as any}><PageHeader schema={schema} /></ActionProvider>;
  return render(scope ? <PredicateScopeProvider scope={scope}>{tree}</PredicateScopeProvider> : tree);
};

const gatedShown = () => !!screen.queryByRole('button', { name: /Set Parallel Reviewers/i });

describe('page:header — ADR-0066 D4 capability gate (#3923)', () => {
  it('hides an action whose requiredPermissions the caller lacks', () => {
    renderWithUser({ id: 'u1', systemPermissions: ['setup.access'] });
    expect(gatedShown()).toBe(false);
    // The ungated action is untouched — this filters, it does not blank the bar.
    expect(screen.getByRole('button', { name: /Print/i })).toBeTruthy();
  });

  it('shows the action when every declared capability is held', () => {
    renderWithUser({ id: 'u1', systemPermissions: ['ehr_probe_capability', 'setup.access'] });
    expect(gatedShown()).toBe(true);
  });

  it('requires ALL declared capabilities (AND, not OR)', () => {
    render(
      <ActionProvider context={{ user: { id: 'u1', systemPermissions: ['a'] } } as any}>
        <PageHeader
          schema={{
            type: 'page:header',
            title: 'Invoice',
            actions: [{ name: 'both', locations: ['record_header'], label: 'Needs Both', type: 'api', requiredPermissions: ['a', 'b'] }],
          }}
        />
      </ActionProvider>,
    );
    expect(screen.queryByRole('button', { name: /Needs Both/i })).toBeNull();
  });

  it('gates on an EMPTY held set — "holds nothing" is known, not unknown', () => {
    renderWithUser({ id: 'u1', systemPermissions: [] });
    expect(gatedShown()).toBe(false);
  });

  it('fails OPEN when the host never resolved capabilities', () => {
    renderWithUser({ id: 'u1' });
    expect(gatedShown()).toBe(true);
  });

  it('falls back to the ambient predicate scope when there is no runner user', () => {
    renderWithUser(undefined, { user: { id: 'u1', systemPermissions: ['setup.access'] } });
    expect(gatedShown()).toBe(false);
  });
});
