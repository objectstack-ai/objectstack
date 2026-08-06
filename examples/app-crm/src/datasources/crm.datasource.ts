// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDatasource } from '@objectstack/spec/data';

/**
 * Primary CRM datasource — in-memory SQLite for the example.
 * In production, swap `driver` to 'postgres' and supply real `config`.
 *
 * No `pool` block: SQLite's connection strategy is owned by the driver (one
 * connection per database — a second connection to `:memory:` would open a
 * separate, empty one). This example declared `pool: { min: 1, max: 5 }` and
 * measurably ran on `{min:1,max:1}` with no indication at all, which is what
 * #5714 turned from a silent drop into a loud rejection.
 */
export const CrmDatasource = defineDatasource({
  name: 'crm_primary',
  label: 'CRM Primary Database',
  driver: 'sqlite',
  config: {
    filename: ':memory:',
  },
  active: true,
});

/**
 * Second datasource for analytics queries — demonstrates datasource routing.
 *
 * This used to declare `capabilities: { readOnly: true }` and call itself a read
 * replica. It was neither: the key had no reader, so the "read replica" accepted
 * writes exactly like the primary — the third spelling of the same defect, after
 * the same claim sat inertly in `config` (#4410) and then in `capabilities`
 * (#4465). #4583 removed the key rather than move it a fourth time.
 *
 * The label no longer promises read-only, because nothing here can deliver it:
 * `external.allowWrites: false` is the one enforced write gate and it applies
 * only to FEDERATED datasources, while this one is local and managed. Whether a
 * managed datasource should have a read-only gate at all is #4584 — until that
 * is answered, the honest demo is routing, not a safety claim.
 */
export const CrmAnalyticsDatasource = defineDatasource({
  name: 'crm_analytics',
  label: 'CRM Analytics',
  driver: 'sqlite',
  config: {
    filename: ':memory:',
  },
  active: true,
});
