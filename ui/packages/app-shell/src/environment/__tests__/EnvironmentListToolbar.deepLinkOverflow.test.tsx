/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #4162 — the `?runAction=create_environment` deep link when the create action
 * OVERFLOWS, measured end-to-end on the real toolbar.
 *
 * This is #4123's signature one layer deeper. #4166 fixed what ARMS the deep
 * link (the create action's presence, not "any toolbar action"); arming keys on
 * the post-gate list, which INCLUDES the actions `action:bar` is about to move
 * into the overflow menu. So arming is correct here — it fires, the param is
 * stripped, `autoTrigger` is attached — and the action is then handed to
 * `action:menu`, which used to have no `autoTrigger` handling at all. Measured
 * on the filing's setup before the fix:
 *
 *     PROBE-OVERFLOW: urlParam=null execute=0 buttons=["a1","a2","a3",""]
 *
 * The same end state as #4123 (`urlParam=null execute=0`, the intent spent on
 * nothing and unrecoverable because the strip IS the consumption), reached
 * through a different mechanism and NOT closed by #4166.
 *
 * The fix is in `@object-ui/components` (`action:menu` consumes `autoTrigger`
 * by executing); this file is the consumer-side proof that the #844 welcome-page
 * flow now survives a toolbar shape where the create action is fourth. The
 * sibling `EnvironmentListToolbar.deepLinkArming.test.tsx` (#4123/#4166) pins
 * the arming half and is deliberately untouched.
 *
 * The registry import is at module scope (not in a `beforeAll`) per AGENTS.md
 * §测试纪律 — `action:bar` resolves its members through the ComponentRegistry at
 * render time, and the cost belongs in the import phase where no hook timeout
 * applies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
// Side-effect import: registers `action:bar` / `action:button` / `action:menu`
// in the ComponentRegistry that the real `SchemaRenderer` resolves against.
import '@object-ui/components';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { EnvironmentListToolbar } from '../EnvironmentListToolbar';
import type { EnvironmentEntitlementsState } from '../entitlements';
import type { ActionContext, ActionDef } from '@object-ui/core';

/**
 * The card's shape: a create action that declares neither `order` nor
 * `variant: 'primary'`, registered LAST. `action:bar`'s `needsOrdering` is then
 * false, so registration order stands and the 4th action lands past the desktop
 * `maxVisible: 3` — in the overflow menu.
 *
 * The `setup_production` state is safe today only by accident: the toolbar's own
 * label override gives the create action `variant: 'primary'`, which flips
 * `needsOrdering` and floats it into the primary slot. `add_development` applies
 * no variant, which is why this file uses it.
 */
const CREATE = {
  name: 'create_environment',
  label: 'Create Environment',
  type: 'api',
  locations: ['list_toolbar'],
};
const FILLERS = [
  { name: 'a1', label: 'a1', type: 'api', locations: ['list_toolbar'] },
  { name: 'a2', label: 'a2', type: 'api', locations: ['list_toolbar'] },
  { name: 'a3', label: 'a3', type: 'api', locations: ['list_toolbar'] },
];

/** ready + has production + may create a dev env → `add_development`, no variant override. */
const ADD_DEVELOPMENT: EnvironmentEntitlementsState = {
  ready: true,
  hasProductionEnv: true,
  canCreateDevelopmentEnv: true,
  upgradeUrl: '/settings/billing',
  source: 'summary',
} as EnvironmentEntitlementsState;

const runActionParam = () => new URL(window.location.href).searchParams.get('runAction');

let origReplaceState: typeof window.history.replaceState;

function deepLink() {
  const url = new URL(window.location.href);
  url.searchParams.set('runAction', 'create_environment');
  origReplaceState.call(window.history, null, '', url);
}

beforeEach(() => {
  origReplaceState = window.history.replaceState.bind(window.history);
});

afterEach(() => {
  vi.restoreAllMocks();
  origReplaceState.call(window.history, null, '', '/');
});

function mountStack(actions: any[]) {
  // Parameters spelled out even though the body reads neither: a zero-arity
  // `vi.fn` infers `Mock<() => …>`, whose `mock.calls` is the EMPTY tuple, so
  // the `execute.mock.calls[0][0]` assertions below were reading element 0 of
  // an empty tuple as far as the compiler was concerned (objectui#4040).
  const execute = vi.fn(async (_action: ActionDef, _ctx?: ActionContext) => ({ success: true }));
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionProvider context={{ user: { id: 'u1' } } as any} handlers={{ api: execute as any }}>
        <EnvironmentListToolbar actions={actions} entitlements={ADD_DEVELOPMENT} />
      </ActionProvider>
    </I18nProvider>,
  );
  return { execute, ...view };
}

describe('the create deep link survives the create action overflowing (#4162)', () => {
  it("the card's probe: create action 4th → rendered by action:menu → still executes, once", async () => {
    deepLink();
    const { execute } = mountStack([...FILLERS, CREATE]);

    // The overflow really happened — three inline buttons and a "More" trigger,
    // with no create button of its own. This is the card's `buttons=[…]` line.
    expect(await screen.findByRole('button', { name: 'a1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'a3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add environment/i })).toBeNull();
    expect(screen.getByRole('button', { name: /more actions/i })).toBeTruthy();

    // Was `execute=0`. The param is still consumed exactly once — that half was
    // never the defect — but now something actually runs.
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect((execute.mock.calls[0][0] as any).name).toBe('create_environment');
    await waitFor(() => expect(runActionParam()).toBeNull());
  });

  it('and it does not open the menu to do it', async () => {
    deepLink();
    const { execute } = mountStack([...FILLERS, CREATE]);

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('no deep link → the overflowed create action just sits in the menu', async () => {
    // The refusal half at this layer: nothing about overflow makes an action run
    // on its own. Without `?runAction`, `useAutoRunCreate` never arms, so no
    // `autoTrigger` is attached and the menu executes nothing.
    const { execute } = mountStack([...FILLERS, CREATE]);

    expect(await screen.findByRole('button', { name: 'a1' })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(execute).not.toHaveBeenCalled();
    expect(runActionParam()).toBeNull();
  });

  it('the inline case is unchanged: create action first → action:button runs it, once', async () => {
    // #4166's path, re-measured here so a regression in either direction is
    // visible from one file.
    deepLink();
    const { execute } = mountStack([CREATE, ...FILLERS.slice(0, 2)]);

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runActionParam()).toBeNull());
    expect((execute.mock.calls[0][0] as any).name).toBe('create_environment');
  });
});
