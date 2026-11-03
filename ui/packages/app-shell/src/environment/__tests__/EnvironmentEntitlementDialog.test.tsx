/**
 * EnvironmentEntitlementDialog renders the friendly limit dialog and a CTA that
 * lands on the (control-plane-resolved) URL the server named.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { EnvironmentEntitlementDialog, resolveCtaHref } from '../EnvironmentEntitlementDialog';
import { entitlementDialogFromError, type EntitlementDialogSpec } from '../entitlements';

describe('resolveCtaHref', () => {
  it('passes absolute urls through (new tab); mailto is not a new tab', () => {
    expect(resolveCtaHref('https://x.com/p', '')).toEqual({ href: 'https://x.com/p', external: true });
    expect(resolveCtaHref('mailto:a@b.com', 'https://api')).toEqual({ href: 'mailto:a@b.com', external: false });
  });
  it('prefixes a relative url with the api base (dev split origin → new tab)', () => {
    expect(resolveCtaHref('/settings/billing', 'https://cp.example.com'))
      .toEqual({ href: 'https://cp.example.com/settings/billing', external: true });
  });
  it('keeps a relative url same-origin when no api base (prod)', () => {
    expect(resolveCtaHref('/settings/billing', '')).toEqual({ href: '/settings/billing', external: false });
  });
});

describe('EnvironmentEntitlementDialog', () => {
  it('renders the spec + a CTA anchor to the resolved url and closes on click', async () => {
    const onOpenChange = vi.fn();
    render(
      <EnvironmentEntitlementDialog
        apiBase=""
        onOpenChange={onOpenChange}
        state={{
          open: true,
          spec: {
            code: 'PRODUCTION_ENV_LIMIT',
            title: 'You already have your production environment',
            message: 'Each organization includes exactly one production environment.',
            cta: { label: 'Contact sales', url: '/contact-sales' },
          },
        }}
      />,
    );
    expect(await screen.findByText('You already have your production environment')).toBeTruthy();
    const cta = screen.getByTestId('entitlement-cta-primary');
    expect(cta.getAttribute('href')).toBe('/contact-sales');
    fireEvent.click(cta);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders nothing when closed', () => {
    render(<EnvironmentEntitlementDialog apiBase="" onOpenChange={vi.fn()} state={{ open: false }} />);
    expect(screen.queryByText('You already have your production environment')).toBeNull();
  });
});

// objectui#10437 — the dialog renders the spec the builder produces, so these
// pins go through the REAL builder: a spec hand-written without a `cta` would
// pass whether or not the builder still synthesizes a default URL.
describe('EnvironmentEntitlementDialog — no server URL, no CTA (objectui#10437)', () => {
  const SERVER_CONTACT_URL = 'https://cloud.example.com/contact-sales';

  const renderSpec = (spec: EntitlementDialogSpec | null) =>
    render(
      <EnvironmentEntitlementDialog
        apiBase=""
        onOpenChange={vi.fn()}
        state={{ open: true, spec: spec ?? undefined }}
      />,
    );

  it('a 403 without contact_url opens the dialog with no anchor', async () => {
    renderSpec(entitlementDialogFromError({ error: { code: 'PRODUCTION_ENV_LIMIT', details: { current: 1, limit: 1 } } }));
    expect(await screen.findByText('You already have your production environment')).toBeTruthy();
    expect(screen.queryByTestId('entitlement-cta-primary')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('control: a server-supplied contact_url renders the anchor to exactly that URL', async () => {
    renderSpec(
      entitlementDialogFromError({ error: { code: 'PRODUCTION_ENV_LIMIT', details: { contact_url: SERVER_CONTACT_URL } } }),
    );
    expect(await screen.findByText('You already have your production environment')).toBeTruthy();
    expect(screen.getByTestId('entitlement-cta-primary').getAttribute('href')).toBe(SERVER_CONTACT_URL);
  });
});
