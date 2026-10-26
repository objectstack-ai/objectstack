/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A dashboard header action of type `url`, or of no declared type, goes
 * through the ActionRunner (objectui#12275).
 *
 * The click used to navigate by a url grammar of its own, and so bypassed the
 * runner's `classifyNavigationTarget`, the one answer to what a click may open
 * (ruling A+ on objectui#12191):
 *
 * - a protocol-relative `//host` was handed to `location.assign`;
 * - `mailto:` was handed to `history.pushState`, which throws on it;
 * - a bare relative value was pushed as a route;
 * - an omitted `actionType`, which the contract and the renderer's own
 *   `headerActionDefs` read as `url`, was dropped with a warning.
 *
 * The card's four pins, on a real render with the real runner, plus the
 * in-app path the old `pushState` branch served:
 *
 * 1. `//cdn.example.com/x` is refused at the click;
 * 2. `mailto:` opens (in place, as the runner opens it);
 * 3. a bare relative value is refused;
 * 4. an omitted-type header action with an `https://` target navigates;
 * 5. an in-app `/apps/...` path still navigates in the app.
 *
 * Each runs twice: under an `ActionProvider` wired as the console wires it
 * (`onNavigate` + `onToast`), and with no provider at all (a standalone embed,
 * where the runner has no navigation handler and hands an in-app path back as
 * `redirect`).
 *
 * "Refused" is read off the runner, not off prose: the error the dashboard
 * surfaces is the one a bare runner answers for the same target, and that
 * answer is a failure. No navigation sink is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DashboardComponentSchema } from '@object-ui/types';
import { ActionRunner } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { DashboardRenderer } from '../DashboardRenderer';

const LABEL = 'Open';

type HeaderAction = NonNullable<NonNullable<DashboardComponentSchema['header']>['actions']>[number];

function dashboardWith(action: Omit<HeaderAction, 'label'>): DashboardComponentSchema {
  return {
    type: 'dashboard',
    label: 'Ops',
    widgets: [],
    header: { actions: [{ label: LABEL, ...action }] },
  } satisfies DashboardComponentSchema;
}

/** What a bare runner answers for a `url` action with this target. */
async function runnerAnswer(target: string) {
  return new ActionRunner({}).execute({ type: 'url', target });
}

let originalLocation: Location;
let hrefSet: Mock<(url: string) => void>;
let openSpy: MockInstance<typeof window.open>;
let pushStateSpy: MockInstance<typeof window.history.pushState>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  originalLocation = window.location;
  hrefSet = vi.fn();
  Object.defineProperty(window, 'location', {
    writable: true,
    // The runner opens `mailto:` by assigning `window.location.href`.
    value: { ...originalLocation, set href(v: string) { hrefSet(v); } } as unknown as Location,
  });
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  openSpy.mockRestore();
  pushStateSpy.mockRestore();
  warnSpy.mockRestore();
  Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
});

function renderUnderProvider(action: Omit<HeaderAction, 'label'>) {
  const onNavigate = vi.fn();
  const onToast = vi.fn();
  render(
    <ActionProvider onNavigate={onNavigate} onToast={onToast}>
      <DashboardRenderer schema={dashboardWith(action)} />
    </ActionProvider>,
  );
  return { onNavigate, onToast };
}

async function click() {
  await userEvent.setup().click(screen.getByRole('button', { name: LABEL }));
}

/** No sink this header action could navigate through was touched. */
function expectNoNavigation(onNavigate?: Mock) {
  if (onNavigate) expect(onNavigate).not.toHaveBeenCalled();
  expect(hrefSet).not.toHaveBeenCalled();
  expect(openSpy).not.toHaveBeenCalled();
  expect(pushStateSpy).not.toHaveBeenCalled();
}

const REFUSED: Array<[string, string]> = [
  ['a protocol-relative //host', '//cdn.example.com/x'],
  ['a bare relative value', 'thanks'],
];

describe('dashboard header url action, under an ActionProvider (objectui#12275)', () => {
  it.each(REFUSED)('refuses %s at the click, with the runner\'s refusal', async (_what, target) => {
    const expected = await runnerAnswer(target);
    expect(expected.success).toBe(false);
    expect(expected.error).toBeTruthy();

    const { onNavigate, onToast } = renderUnderProvider({ actionUrl: target, actionType: 'url' });
    await click();

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expected.error, expect.objectContaining({ type: 'error' })),
    );
    expectNoNavigation(onNavigate);
  });

  it('opens mailto: in place, not through the router and not in a new tab', async () => {
    const target = 'mailto:sales@example.com';
    const { onNavigate, onToast } = renderUnderProvider({ actionUrl: target, actionType: 'url' });
    await click();

    await waitFor(() => expect(hrefSet).toHaveBeenCalledWith(target));
    expect(hrefSet).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
  });

  it('navigates an omitted-type header action with an https:// target, as a url action', async () => {
    const target = 'https://example.com/report';
    const { onNavigate, onToast } = renderUnderProvider({ actionUrl: target });
    await click();

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(target, expect.objectContaining({ external: true })),
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    // Following a link raises no success toast, as it raised none before.
    expect(onToast).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('missing actionType'),
      expect.anything(),
    );
  });

  it('still navigates an in-app /apps/... path in the app, through the host router', async () => {
    const target = '/apps/crm/dashboard/pipeline';
    const { onNavigate, onToast } = renderUnderProvider({ actionUrl: target, actionType: 'url' });
    await click();

    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(target, expect.objectContaining({ external: false })),
    );
    expect(hrefSet).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
  });
});

describe('dashboard header url action, with no ActionProvider (objectui#12275)', () => {
  it.each(REFUSED)('refuses %s at the click, with the runner\'s refusal', async (_what, target) => {
    const expected = await runnerAnswer(target);
    expect(expected.success).toBe(false);

    render(<DashboardRenderer schema={dashboardWith({ actionUrl: target, actionType: 'url' })} />);
    await click();

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith('[DashboardRenderer] action failed', expected.error),
    );
    expectNoNavigation();
  });

  it('opens mailto: in place', async () => {
    const target = 'mailto:sales@example.com';
    render(<DashboardRenderer schema={dashboardWith({ actionUrl: target, actionType: 'url' })} />);
    await click();

    await waitFor(() => expect(hrefSet).toHaveBeenCalledWith(target));
    expect(hrefSet).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('navigates an omitted-type header action with an https:// target', async () => {
    const target = 'https://example.com/report';
    render(<DashboardRenderer schema={dashboardWith({ actionUrl: target })} />);
    await click();

    // With no host router the runner opens an external target itself.
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(target, '_blank', 'noopener,noreferrer'));
    expect(hrefSet).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('follows the runner\'s redirect hand-off for an in-app /apps/... path, SPA-style', async () => {
    const target = '/apps/crm/dashboard/pipeline';
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate);
    try {
      render(<DashboardRenderer schema={dashboardWith({ actionUrl: target, actionType: 'url' })} />);
      await click();

      await waitFor(() => expect(pushStateSpy).toHaveBeenCalledWith({}, '', target));
      expect(pushStateSpy).toHaveBeenCalledTimes(1);
      expect(popstate).toHaveBeenCalledTimes(1);
      expect(hrefSet).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('popstate', popstate);
    }
  });
});
