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
  // [ADR-0015 §10] Under a walled tenancy posture every external object states
  // its organization scope. The remote `orders` table carries no organization
  // column — the deployment's shared analytics catalogue — so this object
  // declares itself shared, as `showcase_ext_customer` does.
  tenancy: { enabled: false },
  label: 'External Order',
  pluralLabel: 'External Orders',
  icon: 'shopping-cart',
  description: 'An order federated from the external analytics DB (ADR-0015). Bound to remote table `orders` via external.remoteName.',
  datasource: 'showcase_external',
  external: { remoteName: 'orders' },
  fields: {
    customer_id: Field.text({ label: 'Customer ID', group: 'order' }),
    amount: Field.currency({ label: 'Amount', group: 'order' }),
    status: Field.text({ label: 'Status', group: 'order' }),
    placed_on: Field.date({ label: 'Placed On', group: 'order' }),
  },

  // ADR-0085 §5: the form, detail and drawer layout is derived from these
  // groups, so each field is placed in a named section rather than left to the
  // untitled fallback, which the field-no-consumers rule credits to no one (#32168).
  fieldGroups: [
    { key: 'order', label: 'Order' },
  ],
});
