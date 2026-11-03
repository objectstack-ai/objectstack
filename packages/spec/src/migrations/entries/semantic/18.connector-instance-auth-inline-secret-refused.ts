// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'connector-instance-auth-inline-secret-refused',
  surface: 'connector.auth on AUTHORED entries of the four static kinds (`none`, `bearer`, `api-key`, ' +
    '`basic`) — defineStack `connectors:`, `PUT /meta/connector/:name` — an undeclared key, an inline ' +
    'secret (`token`, `key`, `password`) above all',
  replacement: 'keep only the keys the kind declares: `bearer` → `{ type, credentialRef }`; `api-key` → ' +
    '`{ type, credentialRef, headerName?, paramName? }`; `basic` → `{ type, username, credentialRef }`; ' +
    '`none` → `{ type }`. A secret written beside the reference goes into the secrets layer under the ' +
    'name `credentialRef` already gives (an environment variable in the open tier, or Setup → ' +
    'Connector credentials), and the key is deleted.',
  reason:
    'The four static kinds were plain objects, so an undeclared key was dropped at parse and the entry ' +
    'still validated, while the three ADR-0143 kinds (`oauth2`, `app-credential`, `signed`) refused one ' +
    'by name. All seven now refuse an undeclared key with a located error, and an inline secret meets the ' +
    '`credentialRef` prescription: the one refusal ADR-0143 D3 records for every variant. The platform ' +
    'never read such a key — a static kind resolves its secret from `credentialRef` alone at ' +
    'materialization — so moving the value changes no connector\'s behaviour. There is deliberately no ' +
    'mechanical rewrite: the inline value may be the only copy of the secret the author holds, so ' +
    'deleting it from a source is a judgement about where that secret goes next, not a rename. The ' +
    'metadata read now also withholds the undeclared `auth` keys, the non-`type` keys of a runtime ' +
    '`authentication` block, and the provider header and environment maps of a stored connector.',
  acceptanceCriteria:
    'Every authored connector entry parses through `DeclarativeConnectorEntrySchema` with no undeclared ' +
    'key under `auth`; each secret that sat inline is set under its `credentialRef` name and the instance ' +
    'still materializes (`GET /api/v1/automation/connectors` reports it `ready`); no stored `sys_metadata` ' +
    'connector row reports an undeclared `auth` key in its `_diagnostics`.',
};
