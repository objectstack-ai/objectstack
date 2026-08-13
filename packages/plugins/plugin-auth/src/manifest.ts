// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical plugin-auth manifest source.
 *
 * Both `objectstack.config.ts` (compile-time) and `auth-plugin.ts`
 * (runtime `manifest.register`) import from this file so the two
 * registration paths cannot drift (D7).
 */

import {
  SysAccount,
  SysApiKey,
  SysDeviceCode,
  SysInvitation,
  SysMember,
  SysJwks,
  SysOauthAccessToken,
  SysOauthApplication,
  SysOauthClientAssertion,
  SysOauthClientResource,
  SysOauthConsent,
  SysOauthRefreshToken,
  SysOauthResource,
  SysOrganization,
  SysSession,
  SysSsoProvider,
  SysScimProvider,
  SysTeam,
  SysTeamMember,
  SysTwoFactor,
  SysUser,
  SysUserPreference,
  SysVerification,
} from '@objectstack/platform-objects/identity';
import { Field } from '@objectstack/spec/data';

export const AUTH_PLUGIN_ID = 'com.objectstack.plugin-auth';
export const AUTH_PLUGIN_VERSION = '3.0.1';

/** Identity objects owned by plugin-auth. */
export const authIdentityObjects: any[] = [
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
  SysApiKey,
  SysTwoFactor,
  SysUserPreference,
  SysOauthApplication,
  SysOauthAccessToken,
  SysOauthRefreshToken,
  SysOauthConsent,
  SysOauthResource,
  SysOauthClientResource,
  SysOauthClientAssertion,
  SysJwks,
  SysDeviceCode,
  SysSsoProvider,
  SysScimProvider,
];

/**
 * [#8009] Fields plugin-auth adds to identity objects it registers.
 *
 * `sys_sso_provider.oidc_client_secret` is the encrypted home of the OIDC
 * `clientSecret`, which was measured landing BYTE-FOR-BYTE IN CLEARTEXT inside
 * the `oidc_config` JSON textarea (#8009 step 0). `type: 'secret'` puts it on
 * the engine's encrypted credential channel: the engine wraps the value with the
 * registered `ICryptoProvider`, persists the ciphertext as a `sys_secret` row,
 * keeps only an opaque `secret:` ref on this column, and returns the mask on
 * every generic read. `plugin-auth/src/sso-client-secret.ts` is the seam that
 * moves the value in and out; `objectql-adapter.ts` calls it.
 *
 * ⚠️ Declared HERE rather than on the object itself because the definition file
 * (`sys-sso-provider.object.ts`) lives in `packages/platform-objects`, which is
 * `domain:metadata`'s package, while this object is registered and owned by
 * plugin-auth (`authIdentityObjects` below) and the mechanism is `domain:identity`'s.
 * The engine merges an `objectExtensions` field into the resolved schema exactly
 * as if it had been declared inline — measured on #8009, including DDL, the
 * encrypt-on-write path and the privileged dereference. Consolidating the
 * declaration onto the object file is the tidier end state and is worth doing
 * the next time that file is opened; it is a move, not a behaviour change.
 */
export const authObjectExtensions = [
  {
    extend: 'sys_sso_provider',
    fields: {
      oidc_client_secret: Field.secret({
        label: 'OIDC Client Secret',
        required: false,
        description:
          'OAuth client secret issued by the IdP, in the engine\'s encrypted credential channel. '
          + 'Encrypted at rest into sys_secret; reads return a mask, never the secret. Written and '
          + 'read back only by the better-auth adapter seam (register / update-provider / callback).',
        group: 'Protocol',
      }),
    },
  },
];

/** Manifest header shared by compile-time config and runtime registration. */
export const authPluginManifestHeader = {
  id: AUTH_PLUGIN_ID,
  namespace: 'sys',
  version: AUTH_PLUGIN_VERSION,
  type: 'plugin' as const,
  scope: 'system' as const,
  defaultDatasource: 'cloud',
  name: 'Authentication & Identity Plugin',
  description: 'Core authentication objects for ObjectStack (User, Session, Account, Verification)',
};
