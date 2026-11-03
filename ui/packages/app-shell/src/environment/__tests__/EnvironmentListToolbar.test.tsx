/**
 * EnvironmentListToolbar renders the right create affordance per org state.
 * SchemaRenderer is stubbed to surface the action label/variant it would render
 * (the real action:bar + runner are covered elsewhere); we assert the decision,
 * not the rendering of the bar.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const CREATE_LOADING = 'environment-create-cta-loading';
/** The retired plan-locked development mark's test id — it must never render. */
const RETIRED_LOCKED_MARK = 'environment-development-locked';

vi.mock('@object-ui/react', async (importActual) => ({
  ...(await importActual<any>()),
  SchemaRenderer: ({ schema }: any) => (
    <div data-testid="action-bar">
      {(schema.actions || []).map((a: any) => (
        <button key={a.name} data-variant={a.variant} data-autotrigger={a.autoTrigger ? 'true' : undefined}>{a.label}</button>
      ))}
    </div>
  ),
}));

import { I18nProvider } from '@object-ui/i18n';
import { EnvironmentListToolbar } from '../EnvironmentListToolbar';
import type { EnvironmentEntitlementsState } from '../entitlements';

/**
 * The state-aware CTA labels resolve from the locale packs (objectui#2871),
 * so these renders need a real i18n context — asserting the English strings
 * without one would only be asserting the raw key. Pinned to `en` and
 * `detectBrowserLanguage: false` so the expectations stay deterministic.
 */
const renderToolbar = (ui: React.ReactElement) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      {ui}
    </I18nProvider>,
  );

const CREATE = {
  name: 'create_environment', label: 'Create Environment',
  type: 'api', variant: 'primary', locations: ['list_toolbar'],
};
const st = (o: Partial<EnvironmentEntitlementsState>): EnvironmentEntitlementsState =>
  ({ ready: true, hasProductionEnv: true, upgradeUrl: '/settings/billing', source: 'summary', ...o });

/**
 * The settled-but-no-signal state: the entitlements endpoint was unusable AND
 * the row derivation threw, so `useEnvironmentEntitlements` reports a resolved
 * object that carries nothing. Distinct from `null` (still in flight).
 */
const UNRESOLVED: EnvironmentEntitlementsState = {
  ready: false, hasProductionEnv: false, source: 'unknown',
};

const REFRESH = { name: 'refresh_all', label: 'Refresh', type: 'api', locations: ['list_toolbar'] };

describe('EnvironmentListToolbar', () => {
  it('no production env → "Set up your production environment" (primary)', () => {
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={st({ hasProductionEnv: false })} />);
    const btn = screen.getByText('Set up your production environment');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('data-variant')).toBe('primary');
    expect(screen.queryByTestId(RETIRED_LOCKED_MARK)).toBeNull();
  });

  it('has production env → the create action is withheld: no button, no bar, no text', () => {
    const { container } = renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={st({})} />);
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Create Environment')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('has production env → other toolbar actions still render through the bar', () => {
    renderToolbar(<EnvironmentListToolbar actions={[CREATE, REFRESH]} entitlements={st({})} />);
    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.queryByText('Create Environment')).toBeNull();
    expect(screen.queryByText('Set up your production environment')).toBeNull();
  });
});

/**
 * objectstack-ai/cloud#3487, ruling D: each organization has exactly one
 * environment, its production environment, and the development type is
 * retired. No state this toolbar can be handed draws a development door —
 * not the "Add development environment" button and not the plan-locked
 * "Development environments · Team plan and up" mark — for any plan, any
 * signal source, or any viewer role.
 */
describe('EnvironmentListToolbar — no development-environment door renders (cloud#3487 D)', () => {
  /** A manager's summary: the role-gated fields are present. */
  const manager = (o: Partial<EnvironmentEntitlementsState>) =>
    st({ plan: 'free', upgradeUrl: '/settings/billing', contactSalesUrl: 'mailto:sales@example.com', ...o });
  /** The same organization as a plain member reads it: capacity only. */
  const member = (o: Partial<EnvironmentEntitlementsState>) =>
    st({ ...o, plan: undefined, upgradeUrl: undefined, contactSalesUrl: undefined });

  const STATES: ReadonlyArray<readonly [string, EnvironmentEntitlementsState | null]> = [
    ['still resolving', null],
    ['settled with no signal', UNRESOLVED],
    ['no production env, summary, manager', manager({ hasProductionEnv: false })],
    ['no production env, summary, member', member({ hasProductionEnv: false })],
    ['no production env, rows', st({ hasProductionEnv: false, source: 'derived', upgradeUrl: undefined })],
    ['production env, free plan, manager', manager({ plan: 'free' })],
    ['production env, team plan, manager', manager({ plan: 'team' })],
    ['production env, member', member({})],
    ['production env, rows', st({ source: 'derived', upgradeUrl: undefined })],
  ];

  it.each(STATES)('%s: no development door, in en', (_name, entitlements) => {
    const { container } = renderToolbar(
      <EnvironmentListToolbar actions={[CREATE, REFRESH]} entitlements={entitlements} />,
    );
    expect(container.textContent ?? '').not.toMatch(/development/i);
    expect(screen.queryByTestId(RETIRED_LOCKED_MARK)).toBeNull();
    expect(screen.queryByText('Add development environment')).toBeNull();
  });

  it.each(STATES)('%s: no development door, in zh', async (_name, entitlements) => {
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <EnvironmentListToolbar actions={[CREATE, REFRESH]} entitlements={entitlements} />
      </I18nProvider>,
    );
    // Wait for the zh pack: the non-create action renders in every state.
    await waitFor(() => expect(screen.getByText('Refresh')).toBeTruthy());
    expect(container.textContent ?? '').not.toContain('开发环境');
    expect(screen.queryByTestId(RETIRED_LOCKED_MARK)).toBeNull();
  });

  it('a member and a manager of the same organization see the same toolbar', () => {
    const drawn = (entitlements: EnvironmentEntitlementsState) => {
      const { container, unmount } = renderToolbar(
        <EnvironmentListToolbar actions={[CREATE, REFRESH]} entitlements={entitlements} />,
      );
      const html = container.innerHTML;
      unmount();
      return html;
    };
    expect(drawn(member({}))).toBe(drawn(manager({})));
    expect(drawn(member({ hasProductionEnv: false }))).toBe(drawn(manager({ hasProductionEnv: false })));
  });
});

/**
 * cloud#1049 ruling A (objectui#3482): while entitlements are in flight the
 * create button must render NO text — the metadata label used to show and then
 * get overwritten by the state-aware one, which the user saw as the button
 * changing its wording mid-load.
 */
describe('EnvironmentListToolbar — loading state (objectui#3482)', () => {
  it('still resolving (null) → skeleton, no label of any kind, no upgrade button', () => {
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={null} />);
    expect(screen.getByTestId(CREATE_LOADING)).toBeTruthy();
    // The metadata label is the one that used to flash here.
    expect(screen.queryByText('Create Environment')).toBeNull();
    // …and no state-aware label is guessed at either — the bar isn't rendered.
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.queryByTestId(RETIRED_LOCKED_MARK)).toBeNull();
  });

  it('non-create toolbar actions still render while resolving (they never re-label)', () => {
    const REFRESH = { name: 'refresh_all', label: 'Refresh', type: 'api', locations: ['list_toolbar'] };
    renderToolbar(
      <EnvironmentListToolbar actions={[CREATE, REFRESH]} entitlements={null} />,
    );
    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.getByTestId(CREATE_LOADING)).toBeTruthy();
    expect(screen.queryByText('Create Environment')).toBeNull();
  });

  it('no create action in the toolbar → nothing can jump, so no skeleton', () => {
    const REFRESH = { name: 'refresh_all', label: 'Refresh', type: 'api', locations: ['list_toolbar'] };
    renderToolbar(<EnvironmentListToolbar actions={[REFRESH]} entitlements={null} />);
    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.queryByTestId(CREATE_LOADING)).toBeNull();
  });

  it('settled with NO usable signal (ready:false) → metadata label, skeleton gone', () => {
    // The skeleton must never be terminal: when both entitlement signals fail
    // the user still needs a working create button, and the producer's neutral
    // wording is the only honest text for an unknown state.
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={UNRESOLVED} />);
    expect(screen.getByText('Create Environment')).toBeTruthy();
    expect(screen.queryByTestId(CREATE_LOADING)).toBeNull();
    expect(screen.queryByTestId(RETIRED_LOCKED_MARK)).toBeNull();
  });

  it('resolving → resolved: the metadata label never appears in any render output', () => {
    // The reported flash, as a transition on one mounted tree. Asserted in `en`
    // because the mechanism is locale-independent (metadata label overwritten by
    // `environment.setUpProduction`); it was reported against the zh console,
    // whose key is covered by the all-locales key-parity test.
    const tree = (entitlements: EnvironmentEntitlementsState | null) => (
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <EnvironmentListToolbar actions={[CREATE]} entitlements={entitlements} />
      </I18nProvider>
    );

    const { rerender, container } = render(tree(null));
    // Intermediate render output carries no button text at all.
    expect(container.textContent).toBe('');
    expect(screen.getByTestId(CREATE_LOADING)).toBeTruthy();

    rerender(tree(st({ hasProductionEnv: false })));
    expect(screen.getByText('Set up your production environment')).toBeTruthy();
    expect(screen.queryByTestId(CREATE_LOADING)).toBeNull();
    // The metadata label never appeared — not before, not after.
    expect(container.textContent).not.toContain(CREATE.label);
  });
});

describe('EnvironmentListToolbar — ?runAction=create_environment deep link (#844)', () => {
  const withRunActionParam = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('runAction', 'create_environment');
    window.history.replaceState(null, '', url);
  };

  it('marks the create action autoTrigger once entitlements resolve, then strips the param', async () => {
    withRunActionParam();
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={st({ hasProductionEnv: false })} />);
    const btn = screen.getByText('Set up your production environment');
    // The SchemaRenderer stub surfaces autoTrigger as data-autotrigger.
    expect(btn.getAttribute('data-autotrigger')).toBe('true');
    // Param is consumed exactly once — stripped from the URL.
    await vi.waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('runAction')).toBeNull();
    });
  });

  it('production env exists: the deep link is consumed and runs nothing', async () => {
    // The org already owns its one environment, so the answer to "create" is
    // that nothing is left to create; the one-shot intent is spent on that
    // answer rather than left armed.
    withRunActionParam();
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={st({})} />);
    await vi.waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('runAction')).toBeNull();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByTestId(RETIRED_LOCKED_MARK)).toBeNull();
    // Nothing is auto-triggered either: no bar, so no autoTrigger action.
    expect(screen.queryByTestId('action-bar')).toBeNull();
  });
});
