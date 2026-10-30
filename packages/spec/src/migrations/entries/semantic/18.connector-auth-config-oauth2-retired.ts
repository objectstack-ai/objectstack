// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0143 D7 (Accepted 2026-10-28): the runtime `oauth2` variant of
// `ConnectorAuthConfigSchema` — `ConnectorOAuth2Schema`, the `authentication`
// shape a plugin hands to registerConnector — is retired, not redefined as a
// resolved shape. It inlined a client secret and a refresh token, and nothing
// consumed it: every provider factory takes the four static kinds, and the
// authoring door refused any non-`none` `authentication`. OAuth2 moves onto a
// provider-bound instance's `auth` (ADR-0143 D2.1), where the secret is a
// `credentialRef` and the tokens are runtime state. No D2 conversion: the
// replacement lives on another surface and needs the inline secret moved into
// the secrets layer, which no mechanical edit may do; the union's own error map
// refuses the variant at parse with the prescription.
export const entry: SemanticMigration = {
  id: 'connector-auth-config-oauth2-retired',
  surface: "connector.authentication (`type: 'oauth2'`, with its inline `clientSecret`, `refreshToken`, "
    + '`tokenExpiry` and `redirectUri`) — the runtime auth of a connector definition, as `defineConnector` '
    + 'and registerConnector parse it; the exported ConnectorOAuth2Schema leaves with it',
  replacement: "A provider-bound connector instance (`provider: 'openapi' | 'rest' | 'mcp'`) declaring "
    + "`auth: { type: 'oauth2', grant: 'authorization_code' | 'client_credentials', tokenUrl, clientId, "
    + 'credentialRef, ... }`, where `credentialRef` names the client secret in the secrets layer and the '
    + 'platform obtains, stores and refreshes the tokens; `authentication` becomes `{ type: \'none\' }` or is dropped.',
  reason: 'There is no mechanical rewrite. The variant carried a client secret and a refresh token inline, and '
    + 'its replacement carries neither: the secret moves into the secrets layer under a reference the author '
    + 'names, and a refresh token is never declared at all — an administrator connects an `authorization_code` '
    + 'instance once and the platform keeps the grant in its connection record. Which provider serves the '
    + "vendor (an OpenAPI document, a REST base URL or an MCP server) is the author's call too, because a "
    + 'connector registered from plugin code with this variant never had its credential applied by anything: '
    + 'its own handlers carried their transport. So the parse refuses the variant by name with the '
    + 'prescription, and the author decides for each such connector whether it becomes a provider-bound '
    + 'instance or keeps its hand-written handlers with `authentication: { type: \'none\' }`.',
  acceptanceCriteria: "No connector definition passed to `defineConnector` or registerConnector carries "
    + "`authentication.type: 'oauth2'`, and no source imports ConnectorOAuth2Schema; the connector parse refuses "
    + 'one with the prescription at `authentication.type`. Every vendor such a connector reached through OAuth2 '
    + "is either a provider-bound instance whose `auth` is `{ type: 'oauth2', ... }` with its client secret "
    + 'behind `credentialRef` and no token in the definition, or a hand-written connector whose handlers carry '
    + 'their own transport and whose `authentication` is `none`.',
};
