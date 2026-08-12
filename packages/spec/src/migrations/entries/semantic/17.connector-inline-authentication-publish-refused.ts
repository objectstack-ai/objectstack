// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'connector-inline-authentication-publish-refused',
  surface: 'connector.authentication on AUTHORED entries (defineStack `connectors:`, ' +
    '`PUT /meta/connector/:name`) — previously refused only on provider-bound instances ' +
    '(ADR-0097 §3), now refused on catalog descriptors too',
  replacement: 'a catalog descriptor drops `authentication` (or sets `{ type: "none" }`) ' +
    'and documents the auth scheme in `description`; a dispatchable instance declares ' +
    '`provider` and references its credential with `auth: { type, credentialRef }` ' +
    '(ADR-0097 §3). Runtime `registerConnector` calls are unaffected — the runtime shape ' +
    'still carries resolved secrets inline.',
  reason:
    'A published connector row lands whole in `sys_metadata`, so an inline `token` / `key` ' +
    '/ `password` / `clientSecret` is cleartext at rest, readable through the data API ' +
    '(#7990). No mechanical rewrite exists: whether the entry should become a `none` ' +
    'descriptor or a provider-bound instance with a `credentialRef` — and which secret ' +
    'store receives the credential — is a judgment about the connector, not a rename.',
  acceptanceCriteria:
    'Every authored connector entry parses through `DeclarativeConnectorEntrySchema`; no ' +
    'authored entry carries a non-`none` `authentication`; formerly inline credentials are ' +
    'reachable through `credentialRef` resolution and the connector still materializes.',
};
