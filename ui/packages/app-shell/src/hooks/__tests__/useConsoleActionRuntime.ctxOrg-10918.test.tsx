/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10918 regression pin — the console action runtime supplies the
 * spec-declared `${ctx.org.*}` interpolation scope.
 *
 * `ActionSchema.target` in `@objectstack/spec` (`ui/action.zod.ts`) declares
 * `${ctx.org.id}` as a member of the action context, and the `onSuccess`
 * contract lists the same scope as "`ctx.user.*`, `ctx.org.*`, `ctx.recordId`,
 * `ctx.selection`". The runtime used to publish the active organization only
 * under the undeclared key `activeOrganization`, so `ActionRunner`'s
 * interpolation scope carried an empty `org` and a declared target such as
 * `/apps/cloud_control/sys_organization/record/${ctx.org.id}` navigated to a
 * path with the id blanked out.
 *
 * Driven end-to-end: the REAL `ConsoleActionRuntimeProvider` (and so the real
 * `<ActionProvider>` and `ActionRunner` target interpolation) runs a
 * `type: 'url'` action from a `useAction()` consumer, and the navigation the
 * runtime hands to the router is what is asserted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateSpy }));

// `activeOrganization` is what `useAuth()` answers — the auth layer's own
// `AuthOrganization` shape. Each test sets it before rendering.
let activeOrganization: Record<string, unknown> | null = null;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'User', image: null }, activeOrganization }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    fieldLabel: (_o: any, _n: any, l: any) => l,
    fieldOptionLabel: (_o: any, _f: any, _v: any, l: any) => l,
    actionParamText: (_o: any, _a: any, _p: any, _attr: any, fallback: any) => fallback,
    actionParamOptionLabel: (_o: any, _a: any, _p: any, _v: any, fallback: any) => fallback,
    actionDescription: (_o: any, _a: any, fallback: any) => fallback,
  }),
  useObjectTranslation: () => ({
    t: (key: string, options?: any) => String(options?.defaultValue ?? key),
  }),
}));

// The client modal transport and the dialogs are not exercised here — inert
// stubs keep the hook module's import graph cheap.
vi.mock('../useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));
vi.mock('../../views/ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('../../views/ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('../../views/ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('../../views/FlowRunner', () => ({ FlowRunner: () => null }));

import { ConsoleActionRuntimeProvider } from '../useConsoleActionRuntime';
import { useAction } from '@object-ui/react';

// The shape cloud's welcome-page "invite members" CTA declares (objectui#10918).
const ORG_RECORD_TARGET = '/apps/cloud_control/sys_organization/record/${ctx.org.id}';

function Probe() {
  const { execute } = useAction();
  return (
    <button onClick={() => execute({ type: 'url', name: 'open_org', target: ORG_RECORD_TARGET } as any)}>
      run
    </button>
  );
}

function runOrgTargetAction() {
  render(
    <ConsoleActionRuntimeProvider dataSource={{}} objects={[]}>
      <Probe />
    </ConsoleActionRuntimeProvider>,
  );
  fireEvent.click(screen.getByText('run'));
}

beforeEach(() => {
  navigateSpy.mockReset();
  activeOrganization = null;
});

describe('useConsoleActionRuntime — the spec-declared ctx.org scope (objectui#10918)', () => {
  it('interpolates ${ctx.org.id} in an action target to the active organization id', async () => {
    activeOrganization = { id: 'org_acme', slug: 'acme', name: 'Acme Inc.' };

    runOrgTargetAction();

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/cloud_control/sys_organization/record/org_acme');
  });

  it('interpolates ${ctx.org.id} to an empty segment, never a literal null, when no organization is active', async () => {
    runOrgTargetAction();

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy.mock.calls[0][0]).toBe('/apps/cloud_control/sys_organization/record/');
  });
});
