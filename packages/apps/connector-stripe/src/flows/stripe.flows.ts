// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * Read one customer. Run it with
 * `POST /api/v1/automation/stripe_get_customer/trigger` and a body of
 * `{ "params": { "customer_id": "cus_123" } }`; Stripe's answer is the run's
 * `customer.body` output (`customer.status` is the HTTP status).
 *
 * An `openapi` action takes its path parameters as one `path` object, so the
 * value slot is a single CEL map literal, not a map of envelopes.
 */
export const StripeGetCustomerFlow = defineFlow({
  name: 'stripe_get_customer',
  label: 'Stripe: get customer',
  description: 'Retrieves one Stripe customer by id through the stripe connector.',
  type: 'autolaunched',
  status: 'active',
  variables: [
    { name: 'customer_id', type: 'text', isInput: true },
    { name: 'customer.body', type: 'json', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'customer',
      type: 'connector_action',
      label: 'GetCustomersCustomer',
      connectorConfig: {
        connectorId: 'stripe',
        actionId: 'GetCustomersCustomer',
        input: { path: { dialect: 'cel', source: '{"customer": customer_id}' } },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'customer' },
    { id: 'e2', source: 'customer', target: 'end' },
  ],
});

/**
 * List one customer's open invoices, newest first, at most ten. Run it with
 * `POST /api/v1/automation/stripe_list_open_invoices/trigger` and a body of
 * `{ "params": { "customer_id": "cus_123" } }`; Stripe's list object is the
 * run's `invoices.body` output (`invoices.body.data` holds the invoices).
 */
export const StripeListOpenInvoicesFlow = defineFlow({
  name: 'stripe_list_open_invoices',
  label: 'Stripe: list open invoices',
  description: "Lists a Stripe customer's open invoices (at most ten) through the stripe connector.",
  type: 'autolaunched',
  status: 'active',
  variables: [
    { name: 'customer_id', type: 'text', isInput: true },
    { name: 'invoices.body', type: 'json', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'invoices',
      type: 'connector_action',
      label: 'GetInvoices',
      connectorConfig: {
        connectorId: 'stripe',
        actionId: 'GetInvoices',
        input: {
          query: { dialect: 'cel', source: '{"customer": customer_id, "status": "open", "limit": 10}' },
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'invoices' },
    { id: 'e2', source: 'invoices', target: 'end' },
  ],
});

export const allFlows = [StripeGetCustomerFlow, StripeListOpenInvoicesFlow];
