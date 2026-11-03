// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'connector-entry-url-credential-refused',
  surface: 'connector entries AUTHORED through defineStack `connectors:`, `os validate` / `os compile`, the artifact ' +
    'load and `PUT /meta/connector/:name` — a URL under `providerConfig` (`baseUrl`, `transport.url`, a URL `spec`, ' +
    'any other URL a provider keeps there) or under `auth` (`tokenUrl`, `authorizationUrl`, `resource`) that holds a ' +
    'userinfo or a credential query parameter',
  replacement: 'keep every authored connector URL credential-free and name the secret with `auth: { type, ' +
    'credentialRef }`: `bearer` for a token, `api-key` for a key (with `paramName` when the API takes it as a query ' +
    'parameter, which the provider then adds to every request), `basic` for a user and password. Set the value under ' +
    'the name `credentialRef` gives — an environment variable in the open tier, or Setup → Connector credentials — ' +
    'and delete it from the URL.',
  reason:
    'Connector metadata holds no credential at any position, and the read already withheld the credential parts of ' +
    'a URL under `providerConfig`. The write door now holds the same line: a URL holding a userinfo (`user@` or ' +
    '`user:password@`) or a credential query parameter (the datasource names, the conventional HTTP key and token ' +
    'names, and the instance\'s own `auth.paramName`) is refused with `422 INVALID_METADATA`, one issue per URL ' +
    'located at the URL, naming the parts it holds. The judgement and the walk are the read redactor\'s own, so the ' +
    'door refuses exactly what the read withholds, `auth` endpoints and `providerConfig` alike. A URL inside a header ' +
    'or environment map is judged by neither (the read withholds those maps whole). There is deliberately no ' +
    'mechanical rewrite: the value in the URL may be the only copy of the secret, and where it goes next is the ' +
    'administrator\'s act. A row stored before this refusal keeps working: a save of the served form keeps the ' +
    'stored URL, and an edit of the served URL stores the edit.',
  acceptanceCriteria:
    'Every authored connector entry parses through `DeclarativeConnectorEntrySchema` with no issue located at a ' +
    'URL under `providerConfig` or `auth`; each secret that sat in a URL is set under its `credentialRef` name and ' +
    'the instance still materializes (`GET /api/v1/automation/connectors` reports it `ready`).',
};
