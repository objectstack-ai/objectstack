/**
 * #4123 — what ARMS the `?runAction=create_environment` deep link, and what
 * happens when the thing it names is not on the bar.
 *
 * Consumption of this deep link is modelled as "strip the param from the URL",
 * so arming is destructive: whatever arms it spends a one-shot user intent that
 * a reload cannot recreate. The arming predicate must therefore agree with what
 * actually renders — if it can arm while the create action is absent, the
 * intent is spent on nothing and is gone for good (`urlParam=null execute=0`,
 * the measurement on the card).
 *
 * ## Why this file drives the REAL bar
 *
 * The sibling `EnvironmentListToolbar.test.tsx` stubs `SchemaRenderer` to
 * inspect the schema the toolbar hands down. That stub cannot see this defect
 * class at all, because the divergence lives INSIDE `action:bar`: the ADR-0066
 * D4 capability gate (`useCapabilityGate` over `requiredPermissions`) filters
 * the actions the bar RENDERS, and the toolbar used to arm off a list computed
 * before that gate ran. Two filters over one list is the bug; only the real bar
 * can demonstrate it. Same reason #3803's investigation had to swap the stub
 * out before it could measure the runner's consumption order.
 *
 * The registry import is at module scope (not in a `beforeAll`) per AGENTS.md
 * §测试纪律 — `action:bar` resolves its members through the ComponentRegistry at
 * render time, and the cost belongs in the import phase where no hook timeout
 * applies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
// Side-effect import: registers `action:bar` / `action:button` in the
// ComponentRegistry that the real `SchemaRenderer` resolves against.
import '@object-ui/components';
import { ActionProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { EnvironmentListToolbar } from '../EnvironmentListToolbar';
import type { EnvironmentEntitlementsState } from '../entitlements';
import type { ActionContext, ActionDef } from '@object-ui/core';

const CREATE = {
  name: 'create_environment',
  label: 'Create Environment',
  type: 'api',
  variant: 'primary',
  locations: ['list_toolbar'],
};
/** A perfectly ordinary second toolbar action — the one the old predicate counted. */
const REFRESH = {
  name: 'refresh_environments',
  label: 'Refresh',
  type: 'api',
  locations: ['list_toolbar'],
};

const st = (o: Partial<EnvironmentEntitlementsState>): EnvironmentEntitlementsState =>
  ({ ready: true, hasProductionEnv: true, upgradeUrl: '/settings/billing', source: 'summary', ...o });

/** The state that makes the create action a live "set up production" CTA. */
const SETUP_PRODUCTION = st({ hasProductionEnv: false });

const runActionParam = () => new URL(window.location.href).searchParams.get('runAction');

let events: string[] = [];
let origReplaceState: typeof window.history.replaceState;

function deepLink() {
  const url = new URL(window.location.href);
  url.searchParams.set('runAction', 'create_environment');
  // Set the param BEFORE the instrumentation goes on, so the toolbar's own
  // consume-and-strip is the only `replaceState` the events log can see.
  origReplaceState.call(window.history, null, '', url);
}

beforeEach(() => {
  events = [];
  origReplaceState = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, 'replaceState').mockImplementation(((...args: unknown[]) => {
    events.push('parent:consumed+strip');
    return (origReplaceState as any)(...args);
  }) as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  origReplaceState.call(window.history, null, '', '/');
});

/**
 * Mounts the toolbar over the real action runtime. `held` is the caller's
 * `user.systemPermissions` — `undefined` means the host never supplied any,
 * which `useCapabilityGate` treats as unknown and fails OPEN on.
 */
function mountStack(opts: {
  actions: any[];
  entitlements: EnvironmentEntitlementsState | null;
  held?: string[];
}) {
  // The implementation spells out the `(action, ctx)` parameters `handlers`
  // entries are called with, even though it reads neither: a zero-arity
  // `vi.fn` infers `Mock<() => …>`, whose `mock.calls` is the EMPTY tuple — so
  // the `execute.mock.calls[0][0]` assertions below were reading element 0 of
  // an empty tuple as far as the compiler was concerned (objectui#4040).
  const execute = vi.fn(async (_action: ActionDef, _ctx?: ActionContext) => {
    events.push('runner:execute');
    return { success: true };
  });
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ActionProvider
        context={{ user: { id: 'u1', ...(opts.held ? { systemPermissions: opts.held } : {}) } } as any}
        handlers={{ api: execute as any }}
      >
        <EnvironmentListToolbar
          actions={opts.actions}
          entitlements={opts.entitlements}
        />
      </ActionProvider>
    </I18nProvider>,
  );
  return { execute, ...view };
}

describe('EnvironmentListToolbar — deep-link arming keys on the create action (#4123)', () => {
  it('happy path is unchanged: create present → arms, triggers exactly once, then strips', async () => {
    deepLink();
    const { execute } = mountStack({ actions: [CREATE], entitlements: SETUP_PRODUCTION });

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runActionParam()).toBeNull());
    expect(execute.mock.calls[0][0]).toMatchObject({ name: 'create_environment' });
  });

  it('keeps the #3803 ordering: the runner consumes autoTrigger BEFORE the parent strips', async () => {
    // Measured and ruled correct on #3803 (`["runner:execute","parent:consumed+strip"]`)
    // — React flushes passive effects child-before-parent, so the button's
    // auto-trigger effect runs first. Re-pinned here because this card moves the
    // predicate that feeds `autoTrigger`; the ordering machinery must not move.
    deepLink();
    const { execute } = mountStack({ actions: [CREATE], entitlements: SETUP_PRODUCTION });

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runActionParam()).toBeNull());
    expect(events).toEqual(['runner:execute', 'parent:consumed+strip']);
  });

  it('toolbar has actions but NO create action → the param is not swallowed, nothing runs', async () => {
    // The card's measurement, as the red→green pin: before the fix this was
    // `urlParam=null execute=0` — the intent spent on an action that does not
    // exist, and unrecoverable because consumption IS the strip.
    deepLink();
    const { execute } = mountStack({ actions: [REFRESH], entitlements: SETUP_PRODUCTION });

    expect(await screen.findByText('Refresh')).toBeTruthy();
    await waitFor(() => expect(events).toEqual([]));
    expect(execute).not.toHaveBeenCalled();
    expect(runActionParam()).toBe('create_environment');
  });

  it('create action filtered out by the ADR-0066 D4 capability gate → same: not swallowed', async () => {
    // The card's candidate reachability path, measured. `toolbarActions` used to
    // be computed from `locations` alone — before the gate — so the toolbar
    // counted an action the bar was about to drop, and armed on it.
    deepLink();
    const gatedCreate = { ...CREATE, requiredPermissions: ['manage_environments'] };
    const { execute } = mountStack({
      actions: [REFRESH, gatedCreate],
      entitlements: SETUP_PRODUCTION,
      held: ['view_environments'],
    });

    expect(await screen.findByText('Refresh')).toBeTruthy();
    // The gate really did drop it: neither the metadata label nor the
    // state-aware override reaches the DOM.
    expect(screen.queryByText('Set up your production environment')).toBeNull();
    expect(screen.queryByText('Create Environment')).toBeNull();
    await waitFor(() => expect(events).toEqual([]));
    expect(execute).not.toHaveBeenCalled();
    expect(runActionParam()).toBe('create_environment');
  });

  it('a capability the caller HOLDS still arms — the gate is the only thing that stops it', async () => {
    // The mirror of the case above: same declaration, caller holds it, so the
    // bar renders the create action and arming must go through as normal.
    deepLink();
    const gatedCreate = { ...CREATE, requiredPermissions: ['manage_environments'] };
    const { execute } = mountStack({
      actions: [REFRESH, gatedCreate],
      entitlements: SETUP_PRODUCTION,
      held: ['view_environments', 'manage_environments'],
    });

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runActionParam()).toBeNull());
  });

  it('unsatisfiable arming is RECOVERABLE: a later mount with the create action still runs it', async () => {
    // Why "leave the param alone" is the honest degradation rather than a
    // silent strip: the intent survives, so the next mount that CAN act on it
    // does. A reload of the same URL is exactly this.
    deepLink();
    const first = mountStack({ actions: [REFRESH], entitlements: SETUP_PRODUCTION });
    expect(await screen.findByText('Refresh')).toBeTruthy();
    expect(first.execute).not.toHaveBeenCalled();
    expect(runActionParam()).toBe('create_environment');
    first.unmount();

    const second = mountStack({ actions: [REFRESH, CREATE], entitlements: SETUP_PRODUCTION });
    await waitFor(() => expect(second.execute).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(runActionParam()).toBeNull());
  });

  it('no toolbar action is capability-permitted → renders nothing, and still no strip', async () => {
    deepLink();
    const gatedCreate = { ...CREATE, requiredPermissions: ['manage_environments'] };
    const gatedRefresh = { ...REFRESH, requiredPermissions: ['manage_environments'] };
    const { execute, container } = mountStack({
      actions: [gatedRefresh, gatedCreate],
      entitlements: SETUP_PRODUCTION,
      held: [],
    });

    expect(container.textContent).toBe('');
    await waitFor(() => expect(events).toEqual([]));
    expect(execute).not.toHaveBeenCalled();
    expect(runActionParam()).toBe('create_environment');
  });
});

describe('EnvironmentListToolbar — the non-arming affordances read the same list (#4123)', () => {
  it('loading skeleton is held only for a create action the bar will actually render', () => {
    // The skeleton stands in for the create button. A capability-gated create
    // action never becomes that button, so holding its slot promises a button
    // that can never arrive.
    const gatedCreate = { ...CREATE, requiredPermissions: ['manage_environments'] };
    mountStack({
      actions: [REFRESH, gatedCreate],
      entitlements: null,
      held: ['view_environments'],
    });

    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.queryByTestId('environment-create-cta-loading')).toBeNull();
  });

  it('the locked mark stands in for the create action, so a gated-out create shows none', () => {
    // `environment-development-locked` is the plan-locked org's stand-in for
    // the create action (objectui#12190). With no create action on the bar
    // there is nothing for it to stand in for.
    const gatedCreate = { ...CREATE, requiredPermissions: ['manage_environments'] };
    mountStack({
      actions: [REFRESH, gatedCreate],
      entitlements: st({ canCreateDevelopmentEnv: false, plan: 'free' }),
      held: ['view_environments'],
    });

    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.queryByTestId('environment-development-locked')).toBeNull();
  });

  it('…and still shows it when the caller holds the capability', () => {
    const gatedCreate = { ...CREATE, requiredPermissions: ['manage_environments'] };
    mountStack({
      actions: [REFRESH, gatedCreate],
      entitlements: st({ canCreateDevelopmentEnv: false, plan: 'free' }),
      held: ['manage_environments'],
    });

    expect(screen.getByTestId('environment-development-locked')).toBeTruthy();
  });
});
