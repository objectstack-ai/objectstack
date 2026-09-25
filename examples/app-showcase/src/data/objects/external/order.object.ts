// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * An order row federated from the external SQLite database. Object name
 * (`showcase_ext_order`) ≠ remote table (`orders`); bound via
 * `external.remoteName`. Read-only.
 */
export const ExternalOrder = ObjectSchema.create({
  name: 'showcase_ext_order',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  label: 'External Order',
  pluralLabel: 'External Orders',
  icon: 'shopping-cart',
  description: 'An order federated from the external analytics DB (ADR-0015). Bound to remote table `orders` via external.remoteName.',
  datasource: 'showcase_external',
  external: { remoteName: 'orders' },
  fields: {
    customer_id: Field.text({ label: 'Customer ID' }),
    amount: Field.currency({ label: 'Amount' }),
    status: Field.text({ label: 'Status' }),
    placed_on: Field.date({ label: 'Placed On' }),
  },
});
