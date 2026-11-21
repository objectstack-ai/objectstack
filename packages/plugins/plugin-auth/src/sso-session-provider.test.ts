// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The halves of `sso-session-provider.ts` on their own: which sign-in source
 * names a provider, and what the settle step writes on the session. The
 * end-to-end pin, through a real SAML sign-in and the vendor's real delete,
 * lives in `sso-saml-refusal-landing.test.ts`; the delete and the boot sweep
 * in `sso-provider-lifecycle.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import {
  SESSION_SSO_PROVIDER_FIELD,
  settleSsoSignInProvider,
  ssoSignInProviderOf,
  stageSsoSignInProvider,
} from './sso-session-provider.js';

describe('which sign-in source names the provider a session is signed in through', () => {
  it('an @better-auth/sso OIDC or SAML sign-in, on every action', () => {
    for (const method of ['sso-oidc', 'sso-saml']) {
      for (const action of ['create-user', 'link-account', 'sign-in']) {
        expect(ssoSignInProviderOf({ method, action, sso: { providerId: 'acme-entra', profile: {} } })).toBe('acme-entra');
      }
    }
  });

  it('none for another sign-in method, or a source that names no provider', () => {
    expect(ssoSignInProviderOf({ method: 'oauth', oauth: { providerId: 'google' } })).toBeUndefined();
    expect(ssoSignInProviderOf({ method: 'email' })).toBeUndefined();
    expect(ssoSignInProviderOf({ method: 'sso-oidc', sso: {} })).toBeUndefined();
    expect(ssoSignInProviderOf({ method: 'sso-saml', sso: { providerId: '' } })).toBeUndefined();
    expect(ssoSignInProviderOf(undefined)).toBeUndefined();
  });
});

describe('the session an SSO sign-in mints records its provider', () => {
  const session = async (engine: ReturnType<typeof createMemoryEngine>, id: string) => {
    await engine.insert('sys_session', { id, user_id: 'usr_1', token: `tok_${id}` });
  };
  const row = (engine: ReturnType<typeof createMemoryEngine>, id: string) =>
    engine.tables.get('sys_session')!.find((r: any) => r.id === id);

  it('the provider staged by the request is written on the session that request mints, once', async () => {
    const engine = createMemoryEngine();
    await session(engine, 'ses_1');
    const ctx = {};
    stageSsoSignInProvider({ source: { method: 'sso-saml', sso: { providerId: 'acme-entra' } } }, ctx);
    const error = vi.fn();
    await settleSsoSignInProvider({ id: 'ses_1' }, ctx, engine as never, error);
    expect(row(engine, 'ses_1')[SESSION_SSO_PROVIDER_FIELD]).toBe('acme-entra');
    expect(error).not.toHaveBeenCalled();

    // The staged entry is spent: a second session of the same request names nothing.
    await session(engine, 'ses_2');
    await settleSsoSignInProvider({ id: 'ses_2' }, ctx, engine as never, error);
    expect(row(engine, 'ses_2')[SESSION_SSO_PROVIDER_FIELD]).toBeUndefined();
  });

  it('CONTROL: a session another request mints, or one no SSO sign-in staged for, names no provider', async () => {
    const engine = createMemoryEngine();
    await session(engine, 'ses_1');
    await session(engine, 'ses_2');
    stageSsoSignInProvider({ source: { method: 'sso-oidc', sso: { providerId: 'acme-okta' } } }, {});
    const passwordCtx = {};
    stageSsoSignInProvider({ source: { method: 'email' } }, passwordCtx);
    const error = vi.fn();
    await settleSsoSignInProvider({ id: 'ses_1' }, {}, engine as never, error);
    await settleSsoSignInProvider({ id: 'ses_2' }, passwordCtx, engine as never, error);
    expect(row(engine, 'ses_1')[SESSION_SSO_PROVIDER_FIELD]).toBeUndefined();
    expect(row(engine, 'ses_2')[SESSION_SSO_PROVIDER_FIELD]).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('a record that cannot be written is said once at error, naming the provider and the session; the sign-in is not failed', async () => {
    const ctx = {};
    stageSsoSignInProvider({ source: { method: 'sso-oidc', sso: { providerId: 'acme-okta' } } }, ctx);
    const error = vi.fn();
    await expect(settleSsoSignInProvider({ id: 'ses_1' }, ctx, undefined, error)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain("'acme-okta'");
    expect(error.mock.calls[0]![0]).toContain('ses_1');
  });
});
