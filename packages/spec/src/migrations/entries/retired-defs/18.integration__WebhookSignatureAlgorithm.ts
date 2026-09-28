// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/WebhookSignatureAlgorithm` (`hmac_sha256` / `hmac_sha512` /
// `none`) leaves with `integration/WebhookConfig`, whose `signatureAlgorithm` was
// its only carrier. A delivered webhook (the top-level `webhooks:` collection) is
// signed by the messaging outbox from its `secret`; nothing ever read this
// choice. See `retired-keys/18.integration__Connector__webhooks.ts` for the
// retirement record.
export const entry = 'integration/WebhookSignatureAlgorithm';
