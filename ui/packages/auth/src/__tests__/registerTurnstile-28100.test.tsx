/**
 * objectstack#28100 — the opt-in Turnstile challenge on sign-up.
 *
 * When the server's auth config serves `features.turnstileSiteKey`, its
 * `/sign-up/email` door refuses a request without a token in the
 * `x-captcha-response` header. `RegisterForm`, given that key, renders the
 * challenge, keeps submit disabled until it is solved, and sends the token on
 * the WIRE: `RegisterForm` → `useAuth().signUp` → `AuthProvider` → the real
 * `createAuthClient` → the better-auth client → the request headers (the
 * `registerVerificationCallback-10893` seam, for the same reason).
 *
 * Without the key the form is unchanged: no widget, no header. A failed,
 * expired or refused challenge shows one retry message — never Cloudflare's
 * own code or the plugin's English text.
 *
 * Cloudflare's script is never loaded: `window.turnstile` is a double that
 * records the options the widget renders with, so a test can solve, fail or
 * expire the challenge by calling the callbacks it was handed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { RegisterForm } from '../RegisterForm';
import { createAuthClient } from '../createAuthClient';
import type { TurnstileApi } from '../TurnstileWidget';

type RenderOptions = Parameters<TurnstileApi['render']>[1];

function turnstileDouble() {
  const rendered: RenderOptions[] = [];
  const api = {
    render: vi.fn((_el: HTMLElement, options: RenderOptions) => {
      rendered.push(options);
      return `widget-${rendered.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return { api, rendered };
}

/** A sign-up server; `refuse` answers the captcha plugin's refusal instead. */
function server(refuse?: { status: number; code: string; message: string }) {
  const captchaHeaders: Array<string | null> = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/sign-up/email')) {
      captchaHeaders.push(new Headers(init?.headers).get('x-captcha-response'));
      if (refuse) {
        return new Response(JSON.stringify({ code: refuse.code, message: refuse.message }), {
          status: refuse.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ user: { id: 'u_new', name: 'New', email: 'new@example.com' }, token: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(null), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetchFn, captchaHeaders };
}

async function fill(ui: React.ReactElement, fetchFn: typeof fetch) {
  const client = createAuthClient({ baseURL: 'http://localhost/api/v1/auth', fetchFn });
  render(
    <AuthProvider authUrl="http://localhost/api/v1/auth" client={client}>
      {ui}
    </AuthProvider>,
  );
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'New' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'hunter2hunter2' } });
}

const submit = () => screen.getByRole('button', { name: 'Create Account' });
const FAILED = 'The security check did not complete. Please try it again.';

let double: ReturnType<typeof turnstileDouble>;
beforeEach(() => {
  double = turnstileDouble();
  window.turnstile = double.api;
});
afterEach(() => {
  delete window.turnstile;
});

describe('RegisterForm without a site key (objectstack#28100)', () => {
  it('renders no challenge and sends no captcha header', async () => {
    const { fetchFn, captchaHeaders } = server();
    const onVerificationRequired = vi.fn();
    await fill(<RegisterForm onVerificationRequired={onVerificationRequired} />, fetchFn as unknown as typeof fetch);

    expect(screen.queryByTestId('turnstile-widget')).toBeNull();
    expect(double.api.render).not.toHaveBeenCalled();
    expect(submit()).not.toBeDisabled();
    fireEvent.click(submit());

    await waitFor(() => expect(onVerificationRequired).toHaveBeenCalled());
    expect(captchaHeaders).toEqual([null]);
  });
});

describe('RegisterForm with a site key (objectstack#28100)', () => {
  it('renders the challenge with that key, holds submit until it is solved, and sends the token as x-captcha-response', async () => {
    const { fetchFn, captchaHeaders } = server();
    const onVerificationRequired = vi.fn();
    await fill(
      <RegisterForm turnstileSiteKey="site-key-1" onVerificationRequired={onVerificationRequired} />,
      fetchFn as unknown as typeof fetch,
    );

    expect(screen.getByTestId('turnstile-widget')).toBeTruthy();
    await waitFor(() => expect(double.rendered).toHaveLength(1));
    expect(double.rendered[0].sitekey).toBe('site-key-1');
    expect(submit()).toBeDisabled();

    double.rendered[0].callback('token-1');
    await waitFor(() => expect(submit()).not.toBeDisabled());
    fireEvent.click(submit());

    await waitFor(() => expect(onVerificationRequired).toHaveBeenCalled());
    expect(captchaHeaders).toEqual(['token-1']);
    // The token is single-use: a fresh challenge is drawn after the answer.
    await waitFor(() => expect(double.api.reset).toHaveBeenCalledWith('widget-1'));
  });

  it('a failed or expired challenge shows the retry message, never the provider code, and Retry draws a fresh one', async () => {
    const { fetchFn } = server();
    await fill(<RegisterForm turnstileSiteKey="site-key-1" />, fetchFn as unknown as typeof fetch);
    await waitFor(() => expect(double.rendered).toHaveLength(1));

    double.rendered[0].callback('token-1');
    await waitFor(() => expect(submit()).not.toBeDisabled());
    // Cloudflare hands its error code to the callback; the widget does not show it.
    (double.rendered[0]['error-callback'] as (code?: string) => boolean | void)('110200');

    const alert = await screen.findByText(FAILED);
    expect(alert).toBeTruthy();
    expect(screen.queryByText(/110200/)).toBeNull();
    expect(submit()).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(double.api.reset).toHaveBeenCalledWith('widget-1');
    await waitFor(() => expect(screen.queryByText(FAILED)).toBeNull());

    double.rendered[0]['expired-callback']();
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(submit()).toBeDisabled();
  });

  it('a token the server refuses reads as the retry message, not the plugin text, and the challenge is redrawn', async () => {
    const { fetchFn, captchaHeaders } = server({ status: 403, code: 'VERIFICATION_FAILED', message: 'Captcha verification failed' });
    const onError = vi.fn();
    await fill(<RegisterForm turnstileSiteKey="site-key-1" onError={onError} />, fetchFn as unknown as typeof fetch);
    await waitFor(() => expect(double.rendered).toHaveLength(1));

    double.rendered[0].callback('token-1');
    await waitFor(() => expect(submit()).not.toBeDisabled());
    fireEvent.click(submit());

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(captchaHeaders).toEqual(['token-1']);
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(screen.queryByText('Captcha verification failed')).toBeNull();
    expect(double.api.reset).toHaveBeenCalledWith('widget-1');
    // The spent token is gone: submit waits for the fresh challenge.
    await waitFor(() => expect(submit()).toBeDisabled());
  });
});
