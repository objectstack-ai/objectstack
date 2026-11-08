// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The per-provider SSO sign-in options, read off their own inputs — see
 * `sso-sign-in-options.ts`. The end-to-end pins (a real `AuthManager` and the
 * real `sso()` plugin) live with the sign-in harnesses:
 * `sso-saml-refusal-landing.test.ts`, `sso-oidc-refusal-cause.test.ts`, and the
 * real-SQL writes in `sso-register-platform-admin-gate.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  SSO_PROVIDER_SIGN_IN_FIELDS,
  applyIdpInitiatedToOidcConfigOnRead,
  isSsoProviderSource,
  readSsoProviderSignInOptions,
  runWithSamlIdpInitiated,
  ssoProviderIdOfSource,
  ssoSamlOptions,
  stripIdpInitiatedFromOidcConfigOnWrite,
} from './sso-sign-in-options';

const OFF = { allowIdpInitiated: false, allowJit: false };

describe('the vendor declaration', () => {
  it('both toggles are boolean provider fields, default off, writable through the vendor doors', () => {
    expect(SSO_PROVIDER_SIGN_IN_FIELDS).toEqual({
      allowIdpInitiated: { type: 'boolean', required: false, defaultValue: false, input: true },
      allowJit: { type: 'boolean', required: false, defaultValue: false, input: true },
    });
  });
});

describe('reading one provider', () => {
  const reader = (rows: unknown[] | Error) => ({
    calls: [] as unknown[],
    async find(object: string, query: Record<string, unknown>) {
      this.calls.push([object, query]);
      if (rows instanceof Error) throw rows;
      return rows;
    },
  });

  it('reads the row by provider_id, in the carrier better-auth stores (1 / 0) or as booleans', async () => {
    const r = reader([{ provider_id: 'acme', allow_idp_initiated: 1, allow_jit: 0 }]);
    expect(await readSsoProviderSignInOptions(r, 'acme')).toEqual({ allowIdpInitiated: true, allowJit: false });
    expect(r.calls).toEqual([['sys_sso_provider', { where: { provider_id: 'acme' }, limit: 1 }]]);
    expect(await readSsoProviderSignInOptions(reader([{ provider_id: 'acme', allow_idp_initiated: false, allow_jit: true }]), 'acme')).toEqual({
      allowIdpInitiated: false,
      allowJit: true,
    });
  });

  it('fails closed: no row, another row, a failed read, no reader, no id, or a value that is not on', async () => {
    expect(await readSsoProviderSignInOptions(reader([]), 'acme')).toEqual(OFF);
    expect(await readSsoProviderSignInOptions(reader([{ provider_id: 'other', allow_jit: 1 }]), 'acme')).toEqual(OFF);
    expect(await readSsoProviderSignInOptions(reader(new Error('store down')), 'acme')).toEqual(OFF);
    expect(await readSsoProviderSignInOptions(undefined, 'acme')).toEqual(OFF);
    expect(await readSsoProviderSignInOptions(reader([{ provider_id: '', allow_jit: 1 }]), '')).toEqual(OFF);
    for (const value of ['1', 'true', 2, null, undefined, {}]) {
      expect(await readSsoProviderSignInOptions(reader([{ provider_id: 'acme', allow_jit: value }]), 'acme'), String(value)).toEqual(OFF);
    }
  });
});

describe('which creations come through an SSO provider', () => {
  it('sso-oidc and sso-saml, with the provider they name', () => {
    expect(isSsoProviderSource({ method: 'sso-oidc', sso: { providerId: 'a' } })).toBe(true);
    expect(isSsoProviderSource({ method: 'sso-saml' })).toBe(true);
    expect(ssoProviderIdOfSource({ method: 'sso-saml', sso: { providerId: 'a' } })).toBe('a');
    expect(ssoProviderIdOfSource({ method: 'sso-oidc' })).toBe('');
    for (const source of [{ method: 'oauth', oauth: { providerId: 'okta' } }, { method: 'scim' }, { method: 'email-password' }, undefined]) {
      expect(isSsoProviderSource(source)).toBe(false);
      expect(ssoProviderIdOfSource(source)).toBe('');
    }
  });
});

describe('OIDC: the column carried in the blob the vendor reads', () => {
  const blob = (config: Record<string, unknown>) => JSON.stringify(config);

  it('on read, the blob says what the column says, whatever the blob held', () => {
    const on = { provider_id: 'a', allow_idp_initiated: 1, oidc_config: blob({ clientId: 'c' }) };
    applyIdpInitiatedToOidcConfigOnRead('sys_sso_provider', on);
    expect(JSON.parse(on.oidc_config)).toEqual({ clientId: 'c', allowIdpInitiated: true });

    const smuggled = { provider_id: 'a', allow_idp_initiated: 0, oidc_config: blob({ clientId: 'c', allowIdpInitiated: true }) };
    applyIdpInitiatedToOidcConfigOnRead('sys_sso_provider', smuggled);
    expect(JSON.parse(smuggled.oidc_config)).toEqual({ clientId: 'c', allowIdpInitiated: false });

    const parsed = { provider_id: 'a', oidc_config: { clientId: 'c' } as Record<string, unknown> };
    applyIdpInitiatedToOidcConfigOnRead('sys_sso_provider', parsed);
    expect(parsed.oidc_config).toEqual({ clientId: 'c', allowIdpInitiated: false });
  });

  it('on read, leaves a SAML row, an unusable blob and another object alone', () => {
    const saml = { provider_id: 'a', allow_idp_initiated: 1, saml_config: blob({ entryPoint: 'x' }), oidc_config: null };
    const before = JSON.stringify(saml);
    applyIdpInitiatedToOidcConfigOnRead('sys_sso_provider', saml);
    expect(JSON.stringify(saml)).toBe(before);
    const broken = { oidc_config: '{not json', allow_idp_initiated: 1 };
    applyIdpInitiatedToOidcConfigOnRead('sys_sso_provider', broken);
    expect(broken.oidc_config).toBe('{not json');
    const other = { oidc_config: blob({}), allow_idp_initiated: 1 };
    applyIdpInitiatedToOidcConfigOnRead('sys_account', other);
    expect(other.oidc_config).toBe(blob({}));
  });

  it('on write, the blob never stores the member; a write without it is untouched', () => {
    const write = { oidc_config: blob({ clientId: 'c', allowIdpInitiated: true }) };
    stripIdpInitiatedFromOidcConfigOnWrite('sys_sso_provider', write);
    expect(JSON.parse(write.oidc_config)).toEqual({ clientId: 'c' });
    const clean = { oidc_config: blob({ clientId: 'c' }) };
    stripIdpInitiatedFromOidcConfigOnWrite('sys_sso_provider', clean);
    expect(clean.oidc_config).toBe(blob({ clientId: 'c' }));
    const columnOnly: Record<string, unknown> = { allow_jit: 1 };
    stripIdpInitiatedFromOidcConfigOnWrite('sys_sso_provider', columnOnly);
    expect(columnOnly).toEqual({ allow_jit: 1 });
  });
});

describe('SAML: the vendor option answers the ACS request in scope', () => {
  it('off outside a scope, and the scope’s own value inside it, concurrent scopes kept apart', async () => {
    const saml = ssoSamlOptions();
    expect(saml.allowIdpInitiated).toBe(false);
    const read = async () => {
      await new Promise((r) => setTimeout(r, 1));
      return saml.allowIdpInitiated;
    };
    expect(await Promise.all([runWithSamlIdpInitiated(true, read), runWithSamlIdpInitiated(false, read)])).toEqual([true, false]);
    expect(saml.allowIdpInitiated).toBe(false);
  });

  it('is an enumerable getter, so the vendor reads it at request time, not once', () => {
    const saml = ssoSamlOptions();
    const descriptor = Object.getOwnPropertyDescriptor(saml, 'allowIdpInitiated');
    expect(typeof descriptor?.get).toBe('function');
    expect(descriptor?.enumerable).toBe(true);
  });
});
