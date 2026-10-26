// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sign-in layout's "Powered by ObjectStack" mark.
 *
 * ObjectOS is the product, in three editions; ObjectStack is the protocol,
 * SDK and framework it is built on. The open-source Community Console keeps
 * the ObjectOS wordmark and, below the form, says what it is built on with a
 * small link to the developer site. A deployment that pushed its own
 * `branding.productName` — Cloud, Enterprise, a cloud-connected workspace —
 * shows its own name and no second brand line.
 *
 * The runtime-config singleton is the real one: branding arrives through a
 * stubbed `GET /api/v1/runtime/config`, exactly as it does at boot, so the
 * mark is judged on the same reading the wordmark uses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { initRuntimeConfig } from '@object-ui/app-shell';
import { resetRuntimeConfigForTesting } from '../../../../../../packages/app-shell/src/runtime-config';
import { AuthLayout } from '../AuthLayout';

afterEach(() => {
  cleanup();
  resetRuntimeConfigForTesting();
  vi.unstubAllGlobals();
});

async function bootWithBranding(branding: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ branding }) })) as unknown as typeof fetch,
  );
  await initRuntimeConfig();
}

function renderLayout() {
  return render(
    <AuthLayout>
      <p>form</p>
    </AuthLayout>,
  );
}

describe('AuthLayout — "Powered by ObjectStack" on the Community Console', () => {
  it('shows the mark, linking to the developer site, under the default wordmark', () => {
    renderLayout();

    expect(screen.getByTestId('auth-brand-name').textContent).toBe('ObjectOS');
    const mark = screen.getByTestId('auth-powered-by');
    expect(mark.textContent).toBe('Powered by ObjectStack');
    expect(mark.getAttribute('href')).toBe('https://objectstack.ai');
    expect(mark.getAttribute('rel')).toContain('noopener');
  });

  it('shows the mark when the runtime pushes branding that keeps the default name', async () => {
    await bootWithBranding({ productName: 'ObjectOS', brandColor: '#0EA5E9' });
    renderLayout();

    expect(screen.getByTestId('auth-brand-name').textContent).toBe('ObjectOS');
    expect(screen.getByTestId('auth-powered-by')).toBeTruthy();
  });

  it('shows no mark when the runtime pushes its own product name', async () => {
    await bootWithBranding({ productName: 'ObjectOS Cloud' });
    renderLayout();

    expect(screen.getByTestId('auth-brand-name').textContent).toBe('ObjectOS Cloud');
    expect(screen.queryByTestId('auth-powered-by')).toBeNull();
    expect(screen.queryByText(/Powered by/)).toBeNull();
  });

  it('shows no mark for an operator rebrand either', async () => {
    await bootWithBranding({ productName: 'Acme Studio', logoUrl: '/acme.svg' });
    renderLayout();

    expect(screen.getByTestId('auth-brand-name').textContent).toBe('Acme Studio');
    expect(screen.queryByTestId('auth-powered-by')).toBeNull();
  });
});
