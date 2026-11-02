/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The sign-in and forgot-password forms at phone width (objectstack#29080).
 *
 * Below the `sm` breakpoint every control the forms draw is a 44 px touch
 * target, and every field's text is 16 px, under which WebKit zooms the page on
 * focus. jsdom lays nothing out, so the classes that carry each rule are read:
 * `min-h-[44px]` with `sm:min-h-0` (desktop keeps its 40 px controls) and
 * `text-base` with `sm:text-sm`. The pixels were measured in a real Console at
 * 375 and 390 px; that run record is on the pull request.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm } from '../LoginForm';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import type { AuthClient, AuthPublicConfig } from '../types';

function createMockClient(config: AuthPublicConfig = {}): AuthClient {
  return {
    signIn: vi.fn().mockResolvedValue({ user: { id: '1' }, session: { token: 't' } }),
    getSession: vi.fn().mockResolvedValue(null),
    getConfig: vi.fn().mockResolvedValue(config),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthClient;
}

function withProvider(node: React.ReactNode, config: AuthPublicConfig = {}) {
  return render(
    <AuthProvider authUrl="/api/auth" client={createMockClient(config)}>
      {node}
    </AuthProvider>,
  );
}

/** Each class token, so `sm:min-h-0` is not read as `min-h-0`. */
function tokens(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/);
}

function expectPhoneTarget(el: Element) {
  const t = tokens(el);
  expect(t, el.outerHTML.slice(0, 120)).toContain('min-h-[44px]');
  expect(t, el.outerHTML.slice(0, 120)).toContain('sm:min-h-0');
}

function expectPhoneFieldText(el: Element) {
  const t = tokens(el);
  expect(t).toContain('text-base');
  expect(t).toContain('sm:text-sm');
  expect(t).not.toContain('text-sm');
}

describe('LoginForm at phone width (objectstack#29080)', () => {
  it('draws every control as a 44 px target and every field at 16 px', async () => {
    const { container } = withProvider(
      <LoginForm forgotPasswordUrl="/forgot-password" registerUrl="/register" />,
      { features: { sso: true, phoneNumberOtp: true } as AuthPublicConfig['features'] },
    );
    await screen.findByLabelText('Email');

    const inputs = container.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    inputs.forEach((input) => {
      expectPhoneTarget(input);
      expectPhoneFieldText(input);
    });

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    buttons.forEach((button) => {
      if (button.getAttribute('data-testid') === 'login-password-toggle') return;
      expectPhoneTarget(button);
    });

    // The reveal toggle is a 44 px square on a phone and 28 px above it.
    const toggle = screen.getByTestId('login-password-toggle');
    expect(tokens(toggle)).toEqual(expect.arrayContaining(['size-11', 'sm:size-7']));

    // "Forgot password?" stands alone beside its label, so it is a target too;
    // "Sign up" sits inside a sentence (WCAG 2.5.5's inline exception).
    const forgot = screen.getByRole('link', { name: 'Forgot password?' });
    expectPhoneTarget(forgot);
    expect(tokens(forgot)).toContain('inline-flex');
  });
});

describe('ForgotPasswordForm at phone width (objectstack#29080)', () => {
  it('draws the field at 16 px and the submit as a 44 px target', async () => {
    const { container } = withProvider(<ForgotPasswordForm loginUrl="/login" />);
    const email = await screen.findByLabelText(/email/i);
    expectPhoneTarget(email);
    expectPhoneFieldText(email);
    expectPhoneTarget(container.querySelector('button[type="submit"]') as Element);
  });
});
