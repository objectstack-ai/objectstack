/**
 * Tests for LoginForm — specifically the server-gated "Sign in with SSO"
 * button. The button must only render when the server's `/auth/config`
 * reports `features.sso`, mirroring how social providers are gated. Otherwise
 * a self-hosted / local deployment (where `@better-auth/sso` isn't wired)
 * shows a button whose `/sign-in/sso` route 404s, surfacing the misleading
 * "No SSO provider is configured for this email domain." only at click time.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../AuthProvider';
import { LoginForm, type LoginFormProps } from '../LoginForm';
import type { AuthClient, AuthPublicConfig } from '../types';

const SSO_BUTTON = { name: 'Sign in with SSO' } as const;

function createMockClient(
  config: AuthPublicConfig,
  overrides: Partial<AuthClient> = {},
): AuthClient {
  return {
    signIn: vi.fn().mockResolvedValue({
      user: { id: '1', name: 'Test User', email: 'test@test.com' },
      session: { token: 'tok123' },
    }),
    signUp: vi.fn().mockResolvedValue({ user: { id: '2' }, session: null, requiresVerification: false }),
    signOut: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
    forgotPassword: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    updateUser: vi.fn().mockResolvedValue({ id: '1', name: 'Updated', email: 'test@test.com' }),
    getConfig: vi.fn().mockResolvedValue(config),
    ...overrides,
  } as unknown as AuthClient;
}

function renderLogin(client: AuthClient, props: LoginFormProps = {}) {
  return render(
    <AuthProvider authUrl="/api/auth" client={client}>
      <LoginForm {...props} />
    </AuthProvider>,
  );
}

describe('LoginForm — server-gated SSO button', () => {
  it('hides the SSO button when the server does not report features.sso', async () => {
    renderLogin(createMockClient({ features: { sso: false } }));

    // Email/password form is always present…
    await screen.findByLabelText('Email');
    // …but the SSO button must not render.
    expect(screen.queryByRole('button', SSO_BUTTON)).toBeNull();
  });

  it('hides the SSO button when features is absent entirely (older server)', async () => {
    renderLogin(createMockClient({}));

    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', SSO_BUTTON)).toBeNull();
  });

  it('shows the SSO button only when the server reports features.sso = true', async () => {
    renderLogin(createMockClient({ features: { sso: true } }));

    await waitFor(() => {
      expect(screen.getByRole('button', SSO_BUTTON)).toBeTruthy();
    });
  });

  it('keeps the button hidden when the config fetch fails (SSO is an enhancement)', async () => {
    renderLogin(
      createMockClient({}, { getConfig: vi.fn().mockRejectedValue(new Error('boom')) }),
    );

    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', SSO_BUTTON)).toBeNull();
  });
});

// objectui#11634 — `registerUrl` has no default. Both console login pages pass
// `undefined` when the server reports `emailPassword.disableSignUp`; a
// `'/register'` default brought the link back on exactly that value, so a
// sign-up-disabled deployment still offered "Sign up".
describe('LoginForm — the sign-up link renders only for a passed registerUrl (objectui#11634)', () => {
  const SIGN_UP_LINK = { name: 'Sign up' } as const;

  it.each([
    ['left out', {}],
    ['passed as undefined', { registerUrl: undefined }],
  ] as const)('renders no sign-up link when registerUrl is %s', async (_shape, props) => {
    renderLogin(createMockClient({}), props);

    // The config gate has resolved and the form is painted…
    await screen.findByLabelText('Email');
    // …and there is no "Don't have an account? Sign up" row.
    expect(screen.queryByRole('link', SIGN_UP_LINK)).toBeNull();
    expect(screen.queryByText("Don't have an account?")).toBeNull();
  });

  it('links to the passed registerUrl', async () => {
    renderLogin(createMockClient({}), { registerUrl: '/x' });

    await screen.findByLabelText('Email');
    expect(screen.getByText("Don't have an account?")).toBeTruthy();
    expect(screen.getByRole('link', SIGN_UP_LINK).getAttribute('href')).toBe('/x');
  });
});

describe('LoginForm — SSO-only (enforced) mode', () => {
  const BREAK_GLASS = { name: 'Use a password instead' } as const;

  it('hides the password form + sign-up and shows a break-glass link when features.ssoEnforced', async () => {
    // `registerUrl` is passed so the sign-up assertion below measures the
    // enforced-mode guard: without it no link renders at all (objectui#11634).
    renderLogin(createMockClient({ features: { sso: true, ssoEnforced: true } }), {
      registerUrl: '/register',
    });

    // The break-glass link appears (federated buttons are the path)…
    await screen.findByRole('button', BREAK_GLASS);
    // …the local password form is hidden…
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
    // …and the sign-up link is hidden (no self-registration under enforced).
    expect(screen.queryByText('Sign up')).toBeNull();
  });

  it('treats emailPassword.enabled === false as enforced (belt-and-suspenders)', async () => {
    renderLogin(createMockClient({ emailPassword: { enabled: false } }));

    await screen.findByRole('button', BREAK_GLASS);
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('reveals the password form when the break-glass link is clicked', async () => {
    renderLogin(createMockClient({ features: { ssoEnforced: true } }));

    fireEvent.click(await screen.findByRole('button', BREAK_GLASS));

    // Password form now visible, plus a way back to SSO-only.
    await screen.findByLabelText('Email');
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to single sign-on' })).toBeTruthy();
  });

  it('shows the password form normally when not enforced', async () => {
    renderLogin(createMockClient({ features: { ssoEnforced: false } }));

    await screen.findByLabelText('Email');
    expect(screen.queryByRole('button', BREAK_GLASS)).toBeNull();
  });
});

// framework#2780 — the phone-OTP sign-in mode is gated by
// `features.phoneNumberOtp` (phoneNumber plugin + deliverable SMS service),
// exactly like the SSO button: never render an entry point whose
// verification code can never arrive.
describe('LoginForm — server-gated phone-OTP sign-in', () => {
  const OTP_LINK = { name: 'Sign in with verification code' } as const;

  it('hides the phone-OTP link when the server does not report features.phoneNumberOtp', async () => {
    renderLogin(createMockClient({ features: { phoneNumber: true, phoneNumberOtp: false } }));
    // phoneNumber:true relabels the identifier field (phone+password enabled).
    await screen.findByLabelText('Email or phone number');
    expect(screen.queryByRole('button', OTP_LINK)).toBeNull();
  });

  it('shows the phone-OTP link when the server reports features.phoneNumberOtp = true', async () => {
    renderLogin(createMockClient({ features: { phoneNumber: true, phoneNumberOtp: true } }));
    await waitFor(() => {
      expect(screen.getByRole('button', OTP_LINK)).toBeTruthy();
    });
  });

  it('switches to the phone form, sends the OTP, verifies, and calls back', async () => {
    const sendPhoneOtp = vi.fn().mockResolvedValue(undefined);
    const signInWithPhoneOtp = vi.fn().mockResolvedValue({
      user: { id: 'u1', name: '13800000000', email: 'u-x@placeholder.invalid' },
      session: { token: 'tok-otp' },
    });
    const client = createMockClient(
      { features: { phoneNumber: true, phoneNumberOtp: true } },
      { sendPhoneOtp, signInWithPhoneOtp },
    );
    renderLogin(client);

    fireEvent.click(await screen.findByRole('button', OTP_LINK));

    const phoneInput = await screen.findByLabelText('Phone number');
    fireEvent.change(phoneInput, { target: { value: '+8613800000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get code' }));
    await waitFor(() => expect(sendPhoneOtp).toHaveBeenCalledWith('+8613800000000'));

    // The resend button now counts down (mirrors the server-side cooldown).
    await screen.findByRole('button', { name: /Resend in \d+s/ });

    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() =>
      expect(signInWithPhoneOtp).toHaveBeenCalledWith('+8613800000000', '123456'),
    );
  });

  it('surfaces the cooldown 429 message from send-otp instead of crashing', async () => {
    const err = Object.assign(
      new Error('Too many verification codes requested for this phone number. Retry in 60s.'),
      { status: 429, code: 'TOO_MANY_REQUESTS' },
    );
    const client = createMockClient(
      { features: { phoneNumberOtp: true } },
      { sendPhoneOtp: vi.fn().mockRejectedValue(err) },
    );
    renderLogin(client);

    fireEvent.click(await screen.findByRole('button', OTP_LINK));
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+8613800000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get code' }));

    await screen.findByText(/Retry in 60s/);
  });

  it('switches back to the password form', async () => {
    renderLogin(createMockClient({ features: { phoneNumberOtp: true } }));
    fireEvent.click(await screen.findByRole('button', OTP_LINK));
    await screen.findByLabelText('Phone number');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password instead' }));
    await screen.findByLabelText('Email');
  });
});

// Phone + password (framework#2780): the password-mode identifier accepts an
// email OR a phone number, gated on `features.phoneNumber` (plugin on — no SMS
// needed). The form routes by identifier shape to /sign-in/email vs
// /sign-in/phone-number.
describe('LoginForm — phone + password sign-in (framework#2780)', () => {
  it('keeps the "Email" label when features.phoneNumber is off', async () => {
    renderLogin(createMockClient({ features: { phoneNumber: false } }));
    await screen.findByLabelText('Email');
    expect(screen.queryByLabelText('Email or phone number')).toBeNull();
  });

  it('relabels the identifier field when features.phoneNumber is on', async () => {
    renderLogin(createMockClient({ features: { phoneNumber: true } }));
    await screen.findByLabelText('Email or phone number');
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('routes a phone-shaped identifier to signInWithPhonePassword (normalized like the backend)', async () => {
    const signIn = vi.fn();
    const signInWithPhonePassword = vi.fn().mockResolvedValue({
      user: { id: 'u2' },
      session: { token: 'pw-tok' },
    });
    renderLogin(createMockClient({ features: { phoneNumber: true } }, { signIn, signInWithPhonePassword }));

    fireEvent.change(await screen.findByLabelText('Email or phone number'), {
      target: { value: '+86 138-0013-8000' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() =>
      expect(signInWithPhonePassword).toHaveBeenCalledWith('+8613800138000', 'S3cret!'),
    );
    expect(signIn).not.toHaveBeenCalled();
  });

  it('routes an email identifier to signIn even when phone is enabled', async () => {
    const signIn = vi.fn().mockResolvedValue({ user: { id: '1' }, session: { token: 't' } });
    const signInWithPhonePassword = vi.fn();
    renderLogin(createMockClient({ features: { phoneNumber: true } }, { signIn, signInWithPhonePassword }));

    fireEvent.change(await screen.findByLabelText('Email or phone number'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    // client.signIn takes a { email, password } credentials object.
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({ email: 'user@example.com', password: 'pw' }),
    );
    expect(signInWithPhonePassword).not.toHaveBeenCalled();
  });
});

// #3238: autofill/copy-paste smuggle leading/trailing whitespace into the
// identifier; the server then rejects it ("Invalid email"). The form must trim
// before validating, routing, or sending.
describe('LoginForm — identifier whitespace trimming (#3238)', () => {
  it('trims whitespace around the email before signIn', async () => {
    const signIn = vi.fn().mockResolvedValue({ user: { id: '1' }, session: { token: 't' } });
    renderLogin(createMockClient({}, { signIn }));

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: '  admin@objectos.ai  ' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({ email: 'admin@objectos.ai', password: 'pw' }),
    );
  });

  it('trims whitespace around the email in the SSO request body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ message: 'nope' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }));
    try {
      renderLogin(createMockClient({ features: { sso: true } }));
      const button = await screen.findByRole('button', SSO_BUTTON);

      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: '  a@corp.example  ' },
      });
      fireEvent.click(button);

      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)) as { email: string };
      expect(body.email).toBe('a@corp.example');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('still routes a whitespace-padded phone identifier to signInWithPhonePassword', async () => {
    const signIn = vi.fn();
    const signInWithPhonePassword = vi.fn().mockResolvedValue({
      user: { id: 'u2' },
      session: { token: 'pw-tok' },
    });
    renderLogin(createMockClient({ features: { phoneNumber: true } }, { signIn, signInWithPhonePassword }));

    fireEvent.change(await screen.findByLabelText('Email or phone number'), {
      target: { value: '  +86 138-0013-8000  ' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'S3cret!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() =>
      expect(signInWithPhonePassword).toHaveBeenCalledWith('+8613800138000', 'S3cret!'),
    );
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('LoginForm — SSO button pending state (objectui#2458 item 1)', () => {
  it('disables the SSO button while /sign-in/sso is in flight and surfaces failure inline', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    try {
      renderLogin(createMockClient({ features: { sso: true } }));
      const button = await screen.findByRole('button', SSO_BUTTON);

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@corp.example' } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
      });
      // A second click while pending must not fire another request.
      fireEvent.click(button);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      resolveFetch(new Response(JSON.stringify({ message: 'No SSO provider is configured for this email domain.' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(/No SSO provider/);
      expect(button).not.toBeDisabled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('LoginForm — config-loading gate (#2625)', () => {
  it('holds a loading state instead of painting the password form while config resolves', async () => {
    let resolveConfig!: (c: AuthPublicConfig) => void;
    const pending = new Promise<AuthPublicConfig>((resolve) => { resolveConfig = resolve; });
    renderLogin(createMockClient({}, { getConfig: vi.fn().mockReturnValue(pending) }));

    // While pending: spinner, NO password form (an SSO-only server must never
    // flash a password wall at users who have no password).
    expect(screen.getByTestId('login-config-loading')).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();

    resolveConfig({ features: { ssoEnforced: true } });
    await waitFor(() => expect(screen.queryByTestId('login-config-loading')).toBeNull());
    // Enforced mode honoured on FIRST paint after resolve: password form
    // hidden, break-glass link offered.
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.getByRole('button', { name: 'Use a password instead' })).toBeTruthy();
  });

  it('falls back to the password form when config ultimately fails (break-glass beats lock-out)', async () => {
    renderLogin(createMockClient({}, { getConfig: vi.fn().mockRejectedValue(new Error('config down')) }));
    await screen.findByLabelText('Email');
    expect(screen.queryByTestId('login-config-loading')).toBeNull();
  });
});
