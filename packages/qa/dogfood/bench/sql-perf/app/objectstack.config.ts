// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SQL performance baseline's fixture app (epic "SQL performance", M0).
 *
 * Three levels of parents over one high-volume child, plus one lookup target:
 *
 *   bench_region  (L0, public)            20 rows
 *     bench_account (L1, private OWD)     lookup region          scale / 100
 *       bench_opportunity (L2, CBP)       master_detail account  scale / 10
 *         bench_line_item (child, CBP)    master_detail opportunity, lookup product   scale
 *   bench_product (lookup target, public) 200 rows
 *
 * `bench_account` is `private` and both details are `controlled_by_parent`, so a
 * non-admin member's read of a line item composes the nested master chain
 * (line item -> opportunity -> account owner). That is the read-scoped scenario.
 *
 * Rows are NOT seeded here: `../bench.mjs` bulk-loads them straight into the
 * tables after schema sync, because a million rows through the API would take
 * hours. See `../README.md`.
 */
import { defineStack } from '@objectstack/spec';

const readWrite = { allowRead: true, allowCreate: true, allowEdit: true };

export default defineStack({
  manifest: {
    id: 'com.objectstack.bench.sqlperf',
    namespace: 'bench',
    version: '0.0.0',
    type: 'app',
    name: 'SQL performance baseline fixture',
    description: 'Fixture for the SQL performance baseline: three parent levels over one high-volume child.',
    engines: { protocol: '^18' },
  },

  objects: [
    {
      name: 'bench_region',
      label: 'Region',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        code: { type: 'text', label: 'Code' },
      },
    },
    {
      name: 'bench_product',
      label: 'Product',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        family: {
          type: 'select',
          label: 'Family',
          options: [
            { label: 'Hardware', value: 'hardware' },
            { label: 'Software', value: 'software' },
            { label: 'Services', value: 'services' },
            { label: 'Training', value: 'training' },
          ],
        },
      },
    },
    {
      name: 'bench_account',
      label: 'Account',
      sharingModel: 'private',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        region: { type: 'lookup', label: 'Region', reference: 'bench_region' },
        industry: {
          type: 'select',
          label: 'Industry',
          options: [
            { label: 'Tech', value: 'tech' },
            { label: 'Finance', value: 'finance' },
            { label: 'Retail', value: 'retail' },
            { label: 'Health', value: 'health' },
            { label: 'Energy', value: 'energy' },
          ],
        },
        annual_revenue: { type: 'number', label: 'Annual revenue' },
      },
    },
    {
      name: 'bench_opportunity',
      label: 'Opportunity',
      sharingModel: 'controlled_by_parent',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        account: {
          type: 'master_detail',
          label: 'Account',
          reference: 'bench_account',
          required: true,
          deleteBehavior: 'cascade',
        },
        stage: {
          type: 'select',
          label: 'Stage',
          options: [
            { label: 'Prospecting', value: 'prospecting' },
            { label: 'Proposal', value: 'proposal' },
            { label: 'Negotiation', value: 'negotiation' },
            { label: 'Won', value: 'won' },
            { label: 'Lost', value: 'lost' },
          ],
        },
        amount: { type: 'number', label: 'Amount' },
        close_date: { type: 'date', label: 'Close date' },
      },
    },
    {
      name: 'bench_line_item',
      label: 'Line item',
      sharingModel: 'controlled_by_parent',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        opportunity: {
          type: 'master_detail',
          label: 'Opportunity',
          reference: 'bench_opportunity',
          required: true,
          deleteBehavior: 'cascade',
        },
        product: { type: 'lookup', label: 'Product', reference: 'bench_product' },
        quantity: { type: 'number', label: 'Quantity' },
        unit_price: { type: 'number', label: 'Unit price' },
        status: {
          type: 'select',
          label: 'Status',
          options: [
            { label: 'Open', value: 'open' },
            { label: 'Shipped', value: 'shipped' },
            { label: 'Invoiced', value: 'invoiced' },
            { label: 'Cancelled', value: 'cancelled' },
          ],
        },
      },
    },
  ],

  permissions: [
    {
      name: 'bench_member',
      label: 'Bench member',
      isDefault: true,
      objects: {
        bench_region: readWrite,
        bench_product: readWrite,
        // `own` on purpose: the member reads the accounts it owns, and the two
        // controlled_by_parent details follow — the read-scoped scenario.
        bench_account: { ...readWrite, readScope: 'own' },
        bench_opportunity: readWrite,
        bench_line_item: readWrite,
      },
    },
  ],
});
