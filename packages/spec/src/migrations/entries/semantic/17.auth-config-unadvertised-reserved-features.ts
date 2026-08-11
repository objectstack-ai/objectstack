// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'auth-config-unadvertised-reserved-features',
  surface: 'api.authConfig.features.passkeys / api.authConfig.features.magicLink',
  replacement: '(removed — no replacement flag; the capabilities are not advertised)',
  reason:
    'Both flags were served by `GET /api/v1/auth/config` from introduction and read by no '
    + 'client: no login UI anywhere renders a passkey or magic-link affordance off them, so '
    + 'the payload advertised two sign-in methods a user could never reach, and a deployer '
    + 'setting `plugins.passkeys` / `plugins.magicLink` flipped a switch with no observable '
    + 'effect (ADR-0049 enforce-or-remove; maintainer ruling 2026-08-11 on #7481 chose remove '
    + 'over keep-as-reserved). The two are not equally empty: nothing at all is wired behind '
    + '`passkeys`, whereas `magicLink`\'s better-auth endpoints are live and only their '
    + 'advertisement was withdrawn. This is a RESPONSE surface — nobody authors or persists '
    + 'an `AuthFeaturesConfig` — so there is no source for the chain to rewrite; the schema '
    + 'tombstones both keys via retiredKey() and consumers drop their read. The withdrawal is '
    + 'conditional: both return to the payload in the change that ships the login UI '
    + '(objectui#4179). ADR-0049, #7481.',
  acceptanceCriteria:
    'No client reads `features.passkeys` or `features.magicLink` off `/api/v1/auth/config`; '
    + 'a client that gated UI on either now treats the capability as absent rather than '
    + 'reading `undefined` as false by accident, and constructing an `AuthFeaturesConfig` '
    + 'with either key fails to parse with its own prescription instead of being silently '
    + 'stripped. Magic-link deployments keep working: `plugins.magicLink` still mounts '
    + '`/api/v1/auth/magic-link/send` and `/magic-link/verify`, which a custom UI may call '
    + 'directly.',
};
