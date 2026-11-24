// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the webhook method `GET`, retired from both
// authoring surfaces (ADR-0049 enforce-or-remove): `WebhookSchema.method` and
// the `sys_webhook` `method` select. No D2 conversion: no lossless rewrite
// exists, because sending another method to an endpoint configured for GET is
// a different request, and which method the receiver takes a body on is the
// owner's to say.
export const entry: SemanticMigration = {
  id: 'webhook-method-get-retired',
  surface:
    'automation.Webhook.method (a declared webhook, `defineStack({ webhooks })`) and the `sys_webhook` `method` '
    + 'field (a webhook saved in Setup or through the data API): the value `GET`',
  replacement:
    'Set `method` to the one the endpoint accepts a body on: `POST` (the default), `PUT`, `PATCH` or `DELETE`. A '
    + 'receiver that only answers GET cannot take a webhook',
  reason:
    'Every webhook delivery sends the event envelope as its request body, and a GET request carries none, so no GET '
    + 'webhook ever delivered an event: the outbox sent the body, the HTTP client refused a GET with a body, and the '
    + 'delivery retried until dead. `GET` is now refused where it is written: a declared webhook fails '
    + '`WebhookSchema` parse with the prescription, and a `sys_webhook` insert or update with `method: \'get\'` is '
    + 'refused 400 `VALIDATION_FAILED` by the select. A row already stored with `get` keeps loading and is parked: '
    + 'each event it matches is written to `sys_http_delivery` as a dead row with 0 attempts whose reason names the '
    + 'method and the fix, and nothing is sent. The stored method is never converted, at load, at save or by a '
    + 'migration, because a conversion would start sending another method to an endpoint configured for GET. There '
    + 'is no mechanical rewrite: only the owner knows which method the receiver accepts',
  acceptanceCriteria:
    'os validate reports no webhook whose `method` is `GET`; GET /api/v1/data/sys_webhook lists no row whose `method` '
    + 'is `get`; after a record change the webhook subscribes to, its sys_http_delivery row has status '
    + 'success or a receiver answer, never a dead row with 0 attempts naming the GET method.',
};
