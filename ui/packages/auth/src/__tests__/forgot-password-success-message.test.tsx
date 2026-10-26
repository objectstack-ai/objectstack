/**
 * objectui#4135 — the maintainer's 2026-08-11 ruling converged
 * `auth.forgotPassword.successDescription`'s downstream-filled hole on
 * SINGLE braces (`{email}`), matching the repo-wide convention that `{{x}}`
 * is reserved for i18next and any hole a component fills itself (after
 * `t()` has already returned) is spelled `{x}` — outside i18next's syntax,
 * safe by construction.
 *
 * This pins `ForgotPasswordForm`'s two-stage substitution itself: the
 * `{email}` marker is filled exactly once, on both label paths the
 * component can reach (its own built-in default, and a caller-supplied
 * translated label), and a label with no marker at all falls back to the
 * append branch — also exactly once. The regression this guards against is
 * the one the issue named: a call site that mistakenly passes `email` as
 * an i18next interpolation argument would (with the old `{{email}}`
 * spelling) let i18next consume the hole, so `includes('{{email}}')` would
 * then miss and the fallback branch would append the address a SECOND
 * time — `...link to a@b.com. Please check your inbox. a@b.com`. With the
 * single-brace spelling this is no longer reachable: `{email}` is not
 * i18next syntax, so i18next never touches it regardless of what argument
 * a call site passes, and the marker always survives to the component.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { ForgotPasswordForm } from '../ForgotPasswordForm';
import type { AuthClient, AuthPublicConfig } from '../types';

function createMockClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue({} as AuthPublicConfig),
    ...overrides,
  } as unknown as AuthClient;
}

function renderForgotPassword(props: React.ComponentProps<typeof ForgotPasswordForm> = {}) {
  return render(
    <AuthProvider authUrl="/api/auth" client={createMockClient()}>
      <ForgotPasswordForm {...props} />
    </AuthProvider>,
  );
}

async function submit(email: string) {
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));
}

/** Every occurrence of `needle` in `haystack` — a double-append shows up as 2. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('ForgotPasswordForm — success message substitution (objectui#4135)', () => {
  it("fills the component's own built-in {email} marker exactly once (no labels prop)", async () => {
    renderForgotPassword();
    await submit('user@example.com');

    const description = await screen.findByText(/password reset link/i);
    expect(occurrences(description.textContent ?? '', 'user@example.com')).toBe(1);
    // No leftover marker in either spelling.
    expect(description.textContent).not.toMatch(/\{email\}|\{\{email\}\}/);
  });

  it('fills a caller-supplied translated {email} marker exactly once', async () => {
    renderForgotPassword({
      labels: {
        successDescription: 'We mailed a reset link to {email} — check your inbox.',
      },
    });
    await submit('translated@example.com');

    const description = await screen.findByText(/we mailed a reset link/i);
    expect(occurrences(description.textContent ?? '', 'translated@example.com')).toBe(1);
    expect(description.textContent).not.toMatch(/\{email\}/);
  });

  it('appends the address exactly once when the label carries no marker at all', async () => {
    renderForgotPassword({
      labels: { successDescription: 'Check your inbox for the reset link.' },
    });
    await submit('noholes@example.com');

    const description = await screen.findByText(/check your inbox/i);
    expect(occurrences(description.textContent ?? '', 'noholes@example.com')).toBe(1);
  });

  it('positive control: never pastes the address twice, the double-append shape the issue described', async () => {
    // The failure mode objectui#4135 named: a label whose hole i18next has
    // already consumed carries no marker of any kind by the time it reaches
    // the component (exactly what "passing `email` to `t()`" would produce
    // under the OLD `{{email}}` spelling). That falls to the append branch —
    // which must still paste the address only once, not zero and not twice.
    renderForgotPassword({
      labels: {
        successDescription: "We've already sent a link — no marker left to fill here.",
      },
    });
    await submit('control@example.com');

    const description = await screen.findByText(/no marker left to fill/i);
    expect(occurrences(description.textContent ?? '', 'control@example.com')).toBe(1);
  });
});
