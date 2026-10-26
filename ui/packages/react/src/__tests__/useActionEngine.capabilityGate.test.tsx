/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0066 D4 capability gate — end to end through the PROVIDER, not just the
 * engine (framework#3923).
 *
 * `ActionEngine.getActionsForLocation` has its own unit coverage, but every real
 * surface reaches it the long way round: a host seeds `<ActionProvider>` with
 * `context.user`, a renderer (`record:quick_actions`, `action:bar`) then calls
 * `useActionEngine({ actions, context: { record, recordId, objectName } })` with
 * a per-render context of its own, and the hook merges that into the SHARED
 * runner. That merge is where the gate died in #3923's sibling failure mode: a
 * caller context without `user` must not erase the provider's, or every gated
 * action silently reappears (`undefined` systemPermissions → fail open).
 *
 * These pin the composed contract: what the host seeds is what the gate sees.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ActionProvider } from '../context/ActionContext';
import { useActionEngine } from '../hooks/useActionEngine';

const gated = {
  name: 'set_parallel_positions',
  label: 'Set parallel reviewers',
  type: 'api' as const,
  locations: ['record_header'],
  requiredPermissions: ['ehr_probe_capability'],
};
const ungated = { name: 'print', label: 'Print', type: 'api' as const, locations: ['record_header'] };

/** The shape a record surface really mounts: provider seeds the user, the
 *  renderer passes only record-scoped keys. */
function wrapperFor(user: unknown) {
  return ({ children }: { children: React.ReactNode }) => (
    <ActionProvider context={{ record: { id: 'r1' }, objectName: 'ehr_case', user } as any}>
      {children}
    </ActionProvider>
  );
}

const renderInProvider = (user: unknown) =>
  renderHook(
    () =>
      useActionEngine({
        actions: [gated, ungated] as any,
        context: { record: { id: 'r1' }, recordId: 'r1', objectName: 'ehr_case' } as any,
      }),
    { wrapper: wrapperFor(user) },
  );

const names = (r: ReturnType<typeof renderInProvider>) =>
  r.result.current.getActionsForLocation('record_header' as any).map((a: any) => a.name);

describe('useActionEngine + ActionProvider — ADR-0066 D4 capability gate (#3923)', () => {
  it('hides a gated action when the seeded user lacks the capability', () => {
    expect(names(renderInProvider({ id: 'u1', systemPermissions: [] }))).toEqual(['print']);
  });

  it('shows a gated action when the seeded user holds the capability', () => {
    const held = renderInProvider({ id: 'u1', systemPermissions: ['ehr_probe_capability'] });
    expect(names(held)).toEqual(['set_parallel_positions', 'print']);
  });

  it('does not let the renderer-supplied context erase the provider user', () => {
    // The regression itself: the hook merges `{record, recordId, objectName}`
    // into the shared runner. If that merge replaced the context wholesale, the
    // gate would read `undefined` and fail open.
    const r = renderInProvider({ id: 'u1', systemPermissions: [] });
    const ctx = r.result.current.engine.getRunner().getContext() as any;
    expect(ctx.user?.systemPermissions).toEqual([]);
    expect(names(r)).not.toContain('set_parallel_positions');
  });

  it('fails OPEN when the host seeds a user with no systemPermissions at all', () => {
    // Unknown ≠ denied — the documented contract for hosts that never resolved
    // permissions. The server still rejects the invocation with 403.
    expect(names(renderInProvider({ id: 'u1' }))).toContain('set_parallel_positions');
  });
});
