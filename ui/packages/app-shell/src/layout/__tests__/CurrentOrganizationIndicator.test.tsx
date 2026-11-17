// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CurrentOrganizationIndicator — objectui#5287.
 *
 * A user on a walled (isolated / group) deployment gets the active organization
 * name read-only, at one membership and at two or more alike (the switcher is
 * in the avatar menu, objectstack-ai/objectstack#34591, so this is the bar's
 * only organization name); every other configuration renders nothing. The two
 * halves are equally load-bearing and fail in opposite directions:
 *
 *   - miss the render and the reported defect survives — no other top-bar
 *     surface names the organization, so nothing else would show the miss;
 *   - miss the GATE and every existing single-tenant console grows an
 *     organization name in its top bar, which is a visible regression for
 *     users who have no organization context at all.
 *
 * ## Why the negative cases wait for something first
 *
 * The posture arrives from an async config fetch, so "nothing rendered" is
 * indistinguishable from "the fetch has not resolved yet" if asserted
 * immediately — a negative that would pass even against a component with no
 * gate whatsoever. Each negative case therefore waits until the posture has
 * actually been applied (a probe renders the resolved value) or, where the
 * server reports no posture at all and nothing observable changes, until the
 * config call has resolved and React has flushed. The positive case uses the
 * identical harness, which is what proves these queries can see the indicator
 * when it is there.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

let organizations: Array<Record<string, unknown>> = [];
let features: Record<string, unknown> = {};
const getAuthConfig = vi.fn(() => Promise.resolve({ features }));

/**
 * ONE stable `getAuthConfig` identity for the whole file — both this component
 * and `useTenancyPosture` resolve it inside `useEffect(..., [getAuthConfig])`
 * ending in `setState`, so a fresh closure per render would loop effect →
 * setState → render → effect until the heap dies.
 */
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    organizations,
    activeOrganization: organizations[0] ?? null,
    getAuthConfig,
  }),
}));

import { CurrentOrganizationIndicator } from '../CurrentOrganizationIndicator';
import { useTenancyPosture } from '../../hooks/useTenancyPosture';

const SOLO = { id: 'org_solo', name: 'Titanwind EHR', slug: 'titanwind' };
const SECOND = { id: 'org_two', name: 'Globex', slug: 'globex' };

/** Renders the posture the component is gating on, so negatives can wait for it. */
function PostureProbe() {
  return <span data-testid="posture">{String(useTenancyPosture() ?? 'unresolved')}</span>;
}

function mount() {
  return render(
    <>
      <CurrentOrganizationIndicator />
      <PostureProbe />
    </>,
  );
}

/** Waits until the posture fetch has resolved AND React has flushed its state. */
async function settleConfig() {
  await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  getAuthConfig.mockClear();
  organizations = [SOLO];
  features = { multiOrgEnabled: true, tenancyPosture: 'isolated' };
});

describe('CurrentOrganizationIndicator — renders (walled posture, any membership count)', () => {
  it('isolated posture: shows the active organization name', async () => {
    mount();

    expect(await screen.findByTestId('current-organization-indicator')).toBeInTheDocument();
    expect(screen.getByText('Titanwind EHR')).toBeInTheDocument();
  });

  it('group posture: also walled, so the write-target organization is named', async () => {
    features = { multiOrgEnabled: true, tenancyPosture: 'group' };
    mount();

    expect(await screen.findByTestId('current-organization-indicator')).toBeInTheDocument();
    expect(screen.getByText('Titanwind EHR')).toBeInTheDocument();
  });

  it('two or more memberships, isolated posture: names the ACTIVE organization, read-only', async () => {
    // The harness's active organization is the first membership: Globex here.
    organizations = [SECOND, SOLO];
    mount();

    const indicator = await screen.findByTestId('current-organization-indicator');
    expect(indicator).toHaveAttribute('title', 'Current organization: Globex');
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.queryByText('Titanwind EHR')).not.toBeInTheDocument();
    // Still a name, not a switcher, at two memberships.
    expect(indicator.querySelector('button, a, [role="button"], [role="menuitem"]')).toBeNull();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('two or more memberships, group posture: the write-target organization is named', async () => {
    organizations = [SECOND, SOLO];
    features = { multiOrgEnabled: true, tenancyPosture: 'group' };
    mount();

    expect(await screen.findByTestId('current-organization-indicator')).toHaveAttribute(
      'title',
      'Current organization: Globex',
    );
  });

  it('is genuinely read-only — no control, no menu, no click target', async () => {
    mount();

    const indicator = await screen.findByTestId('current-organization-indicator');
    expect(indicator.tagName).toBe('SPAN');
    // Nothing focusable or activatable anywhere in it: the rejected option was
    // a switcher with one disabled entry, and a disabled control is still a
    // control. This is context, not navigation.
    expect(indicator.querySelector('button, a, [role="button"], [role="menuitem"], input, select'))
      .toBeNull();
    expect(indicator).not.toHaveAttribute('onclick');
    expect(indicator).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-switcher')).not.toBeInTheDocument();
  });

  it('names the datum for assistive tech, not just visually', async () => {
    mount();

    const indicator = await screen.findByTestId('current-organization-indicator');

    expect(indicator).toHaveAttribute('title', 'Current organization: Titanwind EHR');
    expect(indicator).toHaveTextContent('Current organization');
  });
});

describe('CurrentOrganizationIndicator — renders nothing (the regression guards)', () => {
  it('single-tenant posture: the top bar stays organization-silent', async () => {
    features = { multiOrgEnabled: false, tenancyPosture: 'single' };
    mount();

    // Wait for the gate's input to have actually arrived before reading the
    // absence — otherwise this passes on timing alone.
    await waitFor(() => expect(screen.getByTestId('posture')).toHaveTextContent('single'));
    expect(screen.queryByTestId('current-organization-indicator')).not.toBeInTheDocument();
    expect(screen.queryByText('Titanwind EHR')).not.toBeInTheDocument();
  });

  it('no posture reported (older server / degraded config): renders nothing', async () => {
    features = { multiOrgEnabled: true };
    mount();

    await settleConfig();
    expect(screen.getByTestId('posture')).toHaveTextContent('unresolved');
    expect(screen.queryByTestId('current-organization-indicator')).not.toBeInTheDocument();
  });

  it('unrecognized posture from a newer server: renders nothing', async () => {
    features = { multiOrgEnabled: true, tenancyPosture: 'weird-future-value' };
    mount();

    await settleConfig();
    expect(screen.queryByTestId('current-organization-indicator')).not.toBeInTheDocument();
  });

  it('config fetch fails outright: renders nothing', async () => {
    getAuthConfig.mockRejectedValueOnce(new Error('offline'));
    mount();

    await settleConfig();
    expect(screen.queryByTestId('current-organization-indicator')).not.toBeInTheDocument();
  });

  it('no memberships at all: no organization context to name', async () => {
    organizations = [];
    mount();

    await waitFor(() => expect(screen.getByTestId('posture')).toHaveTextContent('isolated'));
    expect(screen.queryByTestId('current-organization-indicator')).not.toBeInTheDocument();
  });
});
