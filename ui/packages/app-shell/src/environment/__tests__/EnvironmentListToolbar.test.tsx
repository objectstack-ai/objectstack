/**
 * EnvironmentListToolbar renders the right create affordance per org state.
 * SchemaRenderer is stubbed to surface the action label/variant it would render
 * (the real action:bar + runner are covered elsewhere); we assert the decision,
 * not the rendering of the bar.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const CREATE_LOADING = 'environment-create-cta-loading';
const LOCKED_MARK = 'environment-development-locked';

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

describe('EnvironmentListToolbar', () => {
  it('no production env → "Set up your production environment" (primary)', () => {
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={st({ hasProductionEnv: false })} />);
    const btn = screen.getByText('Set up your production environment');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('data-variant')).toBe('primary');
    expect(screen.queryByTestId(LOCKED_MARK)).toBeNull();
  });

  it('has prod + dev allowed (paid) → "Add development environment"', () => {
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={st({ canCreateDevelopmentEnv: true })} />);
    expect(screen.getByText('Add development environment')).toBeTruthy();
    expect(screen.queryByTestId(LOCKED_MARK)).toBeNull();
  });

});

/**
 * objectui#12190 — the maintainer's rule is that no primary button opens a
 * paywall dialog (objectstack-ai/cloud#2775). A plan-locked org gets an
 * outline, locked mark that LINKS to the summary's `upgradeUrl`; nothing on
 * this toolbar opens a dialog, from a click or from the deep link below.
 */
describe('EnvironmentListToolbar — plan-locked: a locked mark, no paywall dialog (objectui#12190)', () => {
  const LOCKED = st({ canCreateDevelopmentEnv: false, plan: 'free' });

  it('draws the locked mark as a link to upgradeUrl, and no button of any kind', () => {
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={LOCKED} />);
    const mark = screen.getByTestId(LOCKED_MARK);
    expect(mark.tagName).toBe('A');
    expect(mark.getAttribute('href')).toBe('/settings/billing');
    // Same-origin relative URL (no control-plane origin configured): same tab.
    expect(mark.getAttribute('target')).toBeNull();
    expect(mark.textContent).toBe('Development environments · Team plan and up');
    // The lock icon.
    expect(mark.querySelector('svg')).not.toBeNull();
    // No primary button stands in for create, and the create action itself is
    // NOT rendered as a bar button (no POST-then-403).
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('action-bar')).toBeNull();
    expect(screen.queryByText('Create Environment')).toBeNull();
    // Clicking it is plain navigation: the toolbar has no prop or handler
    // through which to ask for a dialog, and none renders.
    mark.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(mark);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('other toolbar actions still render through the bar beside the mark', () => {
    const REFRESH = { name: 'refresh_all', label: 'Refresh', type: 'api', locations: ['list_toolbar'] };
    renderToolbar(<EnvironmentListToolbar actions={[CREATE, REFRESH]} entitlements={LOCKED} />);
    expect(screen.getByText('Refresh')).toBeTruthy();
    expect(screen.getByTestId(LOCKED_MARK)).toBeTruthy();
    expect(screen.queryByText('Create Environment')).toBeNull();
  });

  it('an absolute upgradeUrl is linked verbatim and opens in a new tab', () => {
    const url = 'https://cloud.example.com/_console/apps/cloud_control/page/pricing';
    renderToolbar(
      <EnvironmentListToolbar actions={[CREATE]} entitlements={st({ canCreateDevelopmentEnv: false, upgradeUrl: url })} />,
    );
    const mark = screen.getByTestId(LOCKED_MARK);
    expect(mark.getAttribute('href')).toBe(url);
    expect(mark.getAttribute('target')).toBe('_blank');
    expect(mark.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('zh: the mark reads the ruled tier label', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <EnvironmentListToolbar actions={[CREATE]} entitlements={LOCKED} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId(LOCKED_MARK).textContent).toBe('开发环境 · 团队版起'));
  });
});

/**
 * objectui#12983 — ruling B on objectstack-ai/cloud#2917: the development
 * upsell reaches only whoever can upgrade. The control plane trims the summary
 * by role: `plan`, `seatCount`, `upgradeUrl` and `contactSalesUrl` are sent
 * only to a viewer who manages the organization. A summary without
 * `upgradeUrl` is therefore a plain member's, and that viewer cannot upgrade,
 * so the locked mark is not drawn for them. Nothing else on the toolbar
 * changes for anyone.
 */
describe('EnvironmentListToolbar — the locked mark reaches only a viewer who can upgrade (objectui#12983)', () => {
  const REFRESH = { name: 'refresh_all', label: 'Refresh', type: 'api', locations: ['list_toolbar'] };

  /** A manager's summary: the role-gated fields are present. */
  const manager = (o: Partial<EnvironmentEntitlementsState>) =>
    st({ plan: 'free', upgradeUrl: '/settings/billing', contactSalesUrl: 'mailto:sales@example.com', ...o });
  /** The same organization as a plain member reads it: capacity only. */
  const member = (o: Partial<EnvironmentEntitlementsState>) =>
    st({ ...o, plan: undefined, upgradeUrl: undefined, contactSalesUrl: undefined });

  /** Renders one toolbar, reads what it drew, and unmounts it. */
  const drawn = (actions: object[], entitlements: EnvironmentEntitlementsState) => {
    const { container, unmount } = renderToolbar(<EnvironmentListToolbar actions={actions} entitlements={entitlements} />);
    const bar = screen.queryByTestId('action-bar');
    const mark = screen.queryByTestId(LOCKED_MARK);
    const out = {
      bar: bar ? bar.outerHTML : null,
      mark: mark ? { tag: mark.tagName, href: mark.getAttribute('href'), text: mark.textContent } : null,
      text: container.textContent,
    };
    unmount();
    return out;
  };

  const FREE = { canCreateDevelopmentEnv: false } as const;

  it('free plan: a manager sees the mark, linked; a member sees no mark', () => {
    expect(drawn([CREATE], manager(FREE)).mark).toEqual({
      tag: 'A',
      href: '/settings/billing',
      text: 'Development environments · Team plan and up',
    });

    const asMember = drawn([CREATE], member(FREE));
    expect(asMember.mark).toBeNull();
    // Nothing else stands in for the create action either: no bar, no
    // metadata label, no text of any kind.
    expect(asMember.bar).toBeNull();
    expect(asMember.text).toBe('');
  });

  it('free plan, member: no link and no button of any kind is drawn', () => {
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={member(FREE)} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Create Environment')).toBeNull();
  });

  it('free plan: the other toolbar actions render the same for a manager and a member', () => {
    const asManager = drawn([CREATE, REFRESH], manager(FREE));
    const asMember = drawn([CREATE, REFRESH], member(FREE));
    expect(asManager.bar).not.toBeNull();
    expect(asMember.bar).toBe(asManager.bar);
    expect(asMember.bar).toContain('Refresh');
    expect(asMember.bar).not.toContain('Create Environment');
    expect(asManager.mark).not.toBeNull();
    expect(asMember.mark).toBeNull();
  });

  it.each([
    ['paid plan, development allowed', { canCreateDevelopmentEnv: true, plan: 'team' }, 'Add development environment'],
    ['development capacity unknown', { canCreateDevelopmentEnv: undefined }, 'Add development environment'],
    ['no production environment yet', { hasProductionEnv: false }, 'Set up your production environment'],
  ] as const)('%s: the create action renders the same for a member as for a manager', (_state, o, label) => {
    const asManager = drawn([CREATE, REFRESH], manager(o));
    const asMember = drawn([CREATE, REFRESH], member(o));
    expect(asManager.bar).toContain(label);
    expect(asMember.bar).toBe(asManager.bar);
    expect(asMember.mark).toBeNull();
    expect(asManager.mark).toBeNull();
  });

  it('zh, paid plan: a member still gets the add-development create action', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <EnvironmentListToolbar actions={[CREATE]} entitlements={member({ canCreateDevelopmentEnv: true })} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('新建开发环境')).toBeTruthy());
    expect(screen.queryByTestId(LOCKED_MARK)).toBeNull();
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
    expect(screen.queryByTestId(LOCKED_MARK)).toBeNull();
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
    expect(screen.queryByTestId(LOCKED_MARK)).toBeNull();
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

  it('upgrade state: the deep link is consumed and opens nothing (objectui#12190)', async () => {
    withRunActionParam();
    renderToolbar(<EnvironmentListToolbar actions={[CREATE]} entitlements={st({ canCreateDevelopmentEnv: false, plan: 'free' })} />);
    // Consumed exactly as before: the one-shot intent is spent on the mark,
    // which is the page's whole answer to "create" in this state.
    await vi.waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('runAction')).toBeNull();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId(LOCKED_MARK)).toBeTruthy();
    // Nothing is auto-triggered either: no bar, so no autoTrigger action.
    expect(screen.queryByTestId('action-bar')).toBeNull();
  });

  it('upgrade state, plain member: the deep link is consumed as before, and nothing is drawn (objectui#12983)', async () => {
    // Arming is unchanged by objectui#12983: it keys on the create action and
    // the resolved state, never on `upgradeUrl`. The member's answer to
    // "create" is that no development environment can be made here, and no
    // upsell is drawn for a viewer who cannot upgrade.
    withRunActionParam();
    renderToolbar(
      <EnvironmentListToolbar
        actions={[CREATE]}
        entitlements={st({ canCreateDevelopmentEnv: false, plan: undefined, upgradeUrl: undefined })}
      />,
    );
    await vi.waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('runAction')).toBeNull();
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByTestId(LOCKED_MARK)).toBeNull();
    expect(screen.queryByTestId('action-bar')).toBeNull();
  });
});
