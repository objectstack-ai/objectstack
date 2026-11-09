// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConnector } from '@objectstack/spec/integration';

/**
 * The three operations this app exposes, by DocuSign's own `operationId`:
 * create (and send) an envelope, read one envelope, and list the envelopes
 * whose status changed since a date. The packaged document carries nothing
 * else, because it was trimmed to exactly these by the offline normalizer
 * (`--include-pattern … --trim`; the README records the command, the upstream
 * commit and the sha256 it printed).
 */
export const DOCUSIGN_ENVELOPE_OPERATIONS = [
  'Envelopes_PostEnvelopes',
  'Envelopes_GetEnvelope',
  'Envelopes_GetEnvelopes',
] as const;

/**
 * DocuSign's developer (sandbox) environment. The ruling that shaped this app
 * puts the sandbox first: its account server and its one API host are fixed,
 * while a production account's API host is per account (DocuSign answers it
 * as `base_uri` from `/oauth/userinfo`), which a packaged instance cannot name.
 */
export const DOCUSIGN_SANDBOX = {
  authorizationUrl: 'https://account-d.docusign.com/oauth/auth',
  tokenUrl: 'https://account-d.docusign.com/oauth/token',
  baseUrl: 'https://demo.docusign.net/restapi',
} as const;

/**
 * DocuSign eSignature over its own OpenAPI document — recipe 6 of the
 * integration recipes (`skills/objectstack-automation/references/integration-recipes.md`,
 * recipe 1's shape with a grant-bearing `auth`): a declarative
 * `provider: 'openapi'` instance (ADR-0097, ADR-0023) the `openapi` executor
 * materializes at boot, one action per operation.
 *
 * The document is `docusign/OpenAPI-Specifications`
 * `esignature.rest.swagger-v2.1.json` (MIT), a Swagger 2.0 document converted
 * to OpenAPI 3.0 and trimmed offline. Its `servers[0].url` is DocuSign's
 * production host; `providerConfig.baseUrl` points the instance at the
 * sandbox's API host instead. The document declares no security scheme, so
 * the access token rides on every operation as `Authorization: Bearer`.
 *
 * `auth` is OAuth 2.0 `authorization_code` (ADR-0143 D2.1) with
 * `clientSource: 'installer'`: the definition names no client. A DocuSign
 * OAuth client is an integration key, registered in a DocuSign account
 * together with the redirect URIs it accepts, and the redirect URI belongs to
 * each deployment — so the administrator of each deployment registers their
 * own integration key against their deployment's callback and enters it when
 * they connect the instance (the README's Credentials section). ⛔ No client
 * id or secret of anyone's is in this package. Until an administrator
 * connects it, once per organization, the instance is degraded "not
 * connected"; the platform then refreshes the token per dispatch, and no
 * metadata key ever holds it.
 *
 * `include` repeats the trimmed document's whole operation set on purpose: an
 * entry the document does not carry is refused at materialization, so a
 * re-normalized document that lost an operation fails the boot loudly instead
 * of bringing the instance up without it.
 */
export const DocuSignConnector = defineConnector({
  name: 'docusign',
  label: 'DocuSign eSignature (sandbox)',
  type: 'api',
  description:
    'DocuSign eSignature API (developer sandbox): send an envelope for signature, read an envelope, and list ' +
    'envelope status changes, authorized by OAuth with the integration key your administrator registers.',
  provider: 'openapi',
  providerConfig: {
    spec: './openapi/docusign-esignature.openapi.json',
    baseUrl: DOCUSIGN_SANDBOX.baseUrl,
    include: [...DOCUSIGN_ENVELOPE_OPERATIONS],
  },
  auth: {
    type: 'oauth2',
    grant: 'authorization_code',
    authorizationUrl: DOCUSIGN_SANDBOX.authorizationUrl,
    tokenUrl: DOCUSIGN_SANDBOX.tokenUrl,
    scopes: ['signature'],
    clientSource: 'installer',
  },
});
