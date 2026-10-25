/**
 * EmbeddableForm — security & UX guard tests.
 *
 * These tests cover the public-form hardening that was added on top of
 * EmbeddableForm: open-redirect guard, default max-length caps, honeypot,
 * minimum-fill-time, prefill whitelist, and the GDPR consent gate.
 *
 * The pure helpers (`isRedirectUrlSafe`, `applyDefaultMaxLengths`) are
 * tested in isolation. Behaviour that lives inside the React tree
 * (honeypot / min-fill-time / consent / prefill) is exercised through
 * `@testing-library/react`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import {
  EmbeddableForm,
  isRedirectUrlSafe,
  applyDefaultMaxLengths,
  type EmbeddableFormConfig,
} from '../EmbeddableForm';
import type { FormField } from '@object-ui/types';

// ObjectForm lazy-loads field widgets via the global registry — register
// them once for the whole suite.
registerAllFields();

/**
 * Minimal DataSource sufficient for ObjectForm to render `customFields`.
 * `create` is the only method we assert against; the rest are stubs that
 * return safe defaults so any incidental call doesn't throw.
 */
function buildMockDataSource() {
  return {
    create: vi.fn(async (_obj: string, data: Record<string, unknown>) => ({ id: '1', ...data })),
    update: vi.fn(),
    delete: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(async () => ({ data: [], total: 0 })),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
  } as any;
}

const baseFields: FormField[] = [
  { name: 'email', label: 'Email', type: 'email', required: true } as any,
];

function baseConfig(overrides: Partial<EmbeddableFormConfig> = {}): EmbeddableFormConfig {
  return {
    formId: 'test',
    objectName: 'lead',
    title: 'Contact us',
    customFields: baseFields,
    // Disable min-fill-time by default so each test opts in explicitly
    // and the happy path doesn't fight a 1.5s timer.
    minFillTime: 0,
    ...overrides,
  };
}

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe('isRedirectUrlSafe', () => {
  // happy-dom sets window.location to http://localhost:3000 by default
  it('accepts same-origin absolute URLs', () => {
    expect(isRedirectUrlSafe(`${window.location.origin}/thank-you`)).toBe(true);
  });

  it('accepts relative URLs (resolved against current origin)', () => {
    expect(isRedirectUrlSafe('/thank-you')).toBe(true);
    expect(isRedirectUrlSafe('thank-you')).toBe(true);
  });

  it('rejects cross-origin URLs that are not whitelisted', () => {
    expect(isRedirectUrlSafe('https://evil.example.com/phish')).toBe(false);
  });

  it('accepts cross-origin URLs whose exact host is whitelisted', () => {
    expect(isRedirectUrlSafe('https://trusted.example.com/ok', ['trusted.example.com'])).toBe(true);
  });

  it('honours `*.example.com` wildcard subdomains', () => {
    expect(isRedirectUrlSafe('https://app.example.com/ok', ['*.example.com'])).toBe(true);
    expect(isRedirectUrlSafe('https://api.deep.example.com/ok', ['*.example.com'])).toBe(true);
    // The bare apex MUST NOT match a `*.` wildcard (mirrors RFC-style cookie
    // domain rules and matches Airtable / Tally's behaviour).
    expect(isRedirectUrlSafe('https://example.com/ok', ['*.example.com'])).toBe(false);
  });

  it('rejects dangerous URL schemes even when the host appears safe', () => {
    expect(isRedirectUrlSafe('javascript:alert(1)')).toBe(false);
    expect(isRedirectUrlSafe('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects malformed URLs without throwing', () => {
    // Some URL constructors are surprisingly permissive — what matters here is
    // that the helper never throws.  We only require *one* of the inputs to be
    // rejected to confirm the catch-all branch is wired.
    expect(() => isRedirectUrlSafe('http://[invalid-host')).not.toThrow();
    expect(() => isRedirectUrlSafe('not a url at all')).not.toThrow();
    expect(isRedirectUrlSafe('http://[invalid-host')).toBe(false);
  });
});

describe('applyDefaultMaxLengths', () => {
  it('returns the same value when no fields are provided', () => {
    expect(applyDefaultMaxLengths(undefined)).toBeUndefined();
  });

  it('applies a default max-length to text-shaped fields', () => {
    const out = applyDefaultMaxLengths([
      { name: 'name', type: 'text' } as any,
      { name: 'note', type: 'textarea' } as any,
      { name: 'site', type: 'url' } as any,
      { name: 'phone', type: 'phone' } as any,
      { name: 'email', type: 'email' } as any,
    ]);
    expect((out![0] as any).maxLength).toBe(200);
    expect((out![1] as any).maxLength).toBe(5000);
    expect((out![2] as any).maxLength).toBe(2048);
    expect((out![3] as any).maxLength).toBe(32);
    expect((out![4] as any).maxLength).toBe(254);
  });

  it('preserves an explicit maxLength set by the spec author', () => {
    const out = applyDefaultMaxLengths([
      { name: 'name', type: 'text', maxLength: 50 } as any,
    ]);
    expect((out![0] as any).maxLength).toBe(50);
  });

  it('reads the spec `maxLength` only — the retired snake_case `max_length` is no opt-out (objectui#11070)', () => {
    // The snake_case spelling used to count as an authored cap here. The spec
    // refuses it by name and no objectui type declares it, so it no longer
    // opts a field out of the default: the field gets the long-text cap.
    const out = applyDefaultMaxLengths([
      { name: 'note', type: 'textarea', max_length: 1000 } as any,
    ]);
    expect((out![0] as any).maxLength).toBe(5000);
  });

  it('leaves non-text field types untouched', () => {
    const out = applyDefaultMaxLengths([
      { name: 'count', type: 'number' } as any,
      { name: 'active', type: 'boolean' } as any,
      { name: 'tag', type: 'select', options: [] } as any,
    ]);
    expect((out![0] as any).maxLength).toBeUndefined();
    expect((out![1] as any).maxLength).toBeUndefined();
    expect((out![2] as any).maxLength).toBeUndefined();
  });
});

// ─── Component behaviour ───────────────────────────────────────────────────

describe('EmbeddableForm — security & UX guards', () => {
  let ds: ReturnType<typeof buildMockDataSource>;

  beforeEach(() => {
    ds = buildMockDataSource();
    // Reset URL between tests so prefill cases don't leak into each other.
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks submission and shows the consent error when consent is required and unchecked', async () => {
    render(
      <EmbeddableForm
        config={baseConfig({
          consent: { required: true, label: 'I agree' },
          texts: { consentRequired: 'Please accept', submit: 'Submit' },
        })}
        // Prefill email so react-hook-form's required-field validation
        // passes synchronously and `onSuccess` (where the consent gate lives)
        // is actually reached. Without this, slower CI runners can flush the
        // submit click before the typed value is propagated to RHF state,
        // making the test flaky.
        prefillParams={{ email: 'a@b.com' }}
        dataSource={ds}
      />,
    );

    await screen.findByLabelText(/email/i);
    fireEvent.click(await screen.findByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Please accept')).toBeInTheDocument();
    });
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('allows submission once the consent checkbox is ticked', async () => {
    render(
      <EmbeddableForm
        config={baseConfig({
          consent: { required: true, label: 'I agree to the terms' },
          minFillTime: 0,
        })}
        prefillParams={{ email: 'a@b.com' }}
        dataSource={ds}
      />,
    );

    await screen.findByLabelText(/email/i);
    fireEvent.click(screen.getByLabelText(/I agree to the terms/i));
    fireEvent.click(await screen.findByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(ds.create).toHaveBeenCalledTimes(1);
    });
    expect(ds.create.mock.calls[0][1]).toMatchObject({ email: 'a@b.com' });
    expect(ds.create.mock.calls[0][1]).not.toHaveProperty('_company_website_2');
  });

  it('silently fakes a success when the honeypot is filled (no backend call)', async () => {
    const { container } = render(
      <EmbeddableForm
        config={baseConfig({
          texts: { thankYouTitle: 'Thanks!' },
        })}
        dataSource={ds}
      />,
    );

    const emailInput = await screen.findByLabelText(/email/i);

    // A bot blindly fills every input including the off-screen honeypot.
    const honeypot = container.querySelector(
      'input[name="_company_website_2"]',
    ) as HTMLInputElement | null;
    expect(honeypot).not.toBeNull();
    fireEvent.change(honeypot!, { target: { value: 'http://spam' } });

    fireEvent.change(emailInput, { target: { value: 'a@b.com' } });
    fireEvent.click(await screen.findByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Thanks!')).toBeInTheDocument();
    });
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('soft-rejects submissions that arrive faster than minFillTime', async () => {
    render(
      <EmbeddableForm
        config={baseConfig({
          minFillTime: 5_000, // generous threshold; the click happens immediately
          texts: { rateLimited: 'Slow down please' },
        })}
        dataSource={ds}
      />,
    );

    const emailInput = await screen.findByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: 'a@b.com' } });
    fireEvent.click(await screen.findByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Slow down please')).toBeInTheDocument();
    });
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('allows submission once the minFillTime threshold has passed', async () => {
    render(
      <EmbeddableForm
        config={baseConfig({ minFillTime: 50 })}
        dataSource={ds}
      />,
    );

    const emailInput = await screen.findByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: 'a@b.com' } });
    // Wait past the threshold so the timing guard lets us through.
    await new Promise((r) => setTimeout(r, 80));
    fireEvent.click(await screen.findByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(ds.create).toHaveBeenCalledTimes(1);
    });
  });

  it('prefills only whitelisted fields from the URL query string', async () => {
    window.history.replaceState({}, '', '/?email=allowed@x.com&secret=should-not-appear');

    render(
      <EmbeddableForm
        config={baseConfig({
          customFields: [
            { name: 'email', label: 'Email', type: 'email', required: true } as any,
            { name: 'secret', label: 'Secret', type: 'text' } as any,
          ],
          allowedPrefillFields: ['email'],
        })}
        dataSource={ds}
      />,
    );

    const emailInput = (await screen.findByLabelText(/email/i)) as HTMLInputElement;
    const secretInput = (await screen.findByLabelText(/secret/i)) as HTMLInputElement;
    expect(emailInput.value).toBe('allowed@x.com');
    expect(secretInput.value).toBe('');
  });

  it('ignores URL prefill entirely when no whitelist is configured', async () => {
    window.history.replaceState({}, '', '/?email=should-not-appear@x.com');

    render(<EmbeddableForm config={baseConfig()} dataSource={ds} />);

    const emailInput = (await screen.findByLabelText(/email/i)) as HTMLInputElement;
    expect(emailInput.value).toBe('');
  });
});
