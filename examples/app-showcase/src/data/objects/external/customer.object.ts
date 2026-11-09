// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * A customer row federated LIVE from the external SQLite database
 * (`showcase_external`). The object name (`showcase_ext_customer`) deliberately
 * differs from the remote table (`customers`) — the binding is expressed by
 * `external.remoteName`, exercising ADR-0015's remote-table remap on the read
 * path. Read-only: the datasource sets `allowWrites: false`.
 */
export const ExternalCustomer = ObjectSchema.create({
  name: 'showcase_ext_customer',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  // [ADR-0015 §10] Under a walled tenancy posture every external object states
  // its organization scope. The remote `customers` table carries no
  // organization column — it is the deployment's analytics catalogue, read by
  // every organization alike — so this object declares itself shared. (The
  // other declaration is an `organization_id` field of its own, when the
  // remote rows carry one.)
  tenancy: { enabled: false },
  label: 'External Customer',
  pluralLabel: 'External Customers',
  icon: 'database',
  description: 'A customer federated from the external analytics DB (ADR-0015). Bound to remote table `customers` via external.remoteName.',
  datasource: 'showcase_external',
  external: { remoteName: 'customers' },
  fields: {
    name: Field.text({ label: 'Name', searchable: true }),
    email: Field.text({ label: 'Email' }),
    region: Field.text({ label: 'Region' }),
    lifetime_value: Field.currency({ label: 'Lifetime Value' }),
  },
});
