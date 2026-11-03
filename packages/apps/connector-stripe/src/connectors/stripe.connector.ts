// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConnector } from '@objectstack/spec/integration';

/**
 * The eight operations this app exposes: list and retrieve, for customers,
 * charges, invoices and payment intents. Every one is a GET; the packaged
 * document carries nothing else, because it was trimmed to exactly these by
 * the offline normalizer (`--include-pattern … --trim`, the README records the
 * command, the upstream commit and the sha256 it printed).
 *
 * Stripe's write operations take `application/x-www-form-urlencoded` bodies,
 * which the `openapi` provider's transport does not send (it sends JSON), so
 * this app is read only by construction, not by convention.
 */
export const STRIPE_READ_OPERATIONS = [
  'GetCustomers',
  'GetCustomersCustomer',
  'GetCharges',
  'GetChargesCharge',
  'GetInvoices',
  'GetInvoicesInvoice',
  'GetPaymentIntents',
  'GetPaymentIntentsIntent',
] as const;

/**
 * Stripe over its own OpenAPI document — recipe 1 of the integration recipes
 * (`skills/objectstack-automation/references/integration-recipes.md`): a
 * declarative `provider: 'openapi'` instance (ADR-0097, ADR-0023) the
 * `openapi` executor materializes at boot, one action per operation, keyed by
 * Stripe's `operationId`.
 *
 * The document is `stripe/openapi`'s `openapi/spec3.json` (MIT), normalized
 * and trimmed offline; its `servers[0].url` is `https://api.stripe.com/` and
 * its paths carry the `/v1` prefix. Stripe's document declares both `basic`
 * and `bearer` HTTP schemes (`Authorization: Bearer <api_key>`); the `bearer`
 * auth below is folded into exactly that header by the executor. The key is
 * never in this file — `credentialRef` names it, and the administrator
 * supplies the value (an environment variable of that name, or Setup →
 * Integrations → Connector Credentials).
 *
 * `include` repeats the trimmed document's whole operation set on purpose: an
 * entry the document does not carry is refused at materialization, so a
 * re-normalized document that lost an operation fails the boot loudly instead
 * of bringing the instance up without it.
 */
export const StripeConnector = defineConnector({
  name: 'stripe',
  label: 'Stripe (read only)',
  type: 'api',
  description:
    'Stripe API, read operations only: list and retrieve customers, charges, invoices and payment intents, ' +
    'authenticated by a restricted API key the administrator supplies.',
  provider: 'openapi',
  providerConfig: {
    spec: './openapi/stripe.openapi.json',
    include: [...STRIPE_READ_OPERATIONS],
  },
  auth: { type: 'bearer', credentialRef: 'STRIPE_RESTRICTED_KEY' },
});
