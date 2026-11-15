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
 * Beside the chain, three roll-up pairs for the summary-recompute leg (R10), the
 * same parent/child shape with 0, 1 and 2 `summary` fields on the parent:
 *
 *   bench_roll0 <- bench_roll0_item   no summary field (the control)
 *   bench_roll1 <- bench_roll1_item   total_quantity = sum(quantity)
 *   bench_roll2 <- bench_roll2_item   total_quantity = sum(quantity), item_count = count
 *
 * All six are public, so a write there pays no read-scope cost; the only
 * difference between the pairs is the number of roll-ups a child write
 * recomputes. They are a fixed size (not `--scale`): see `../README.md`.
 *
 * Rows are NOT seeded here: `../bench.mjs` bulk-loads them straight into the
 * tables after schema sync, because a million rows through the API would take
 * hours. See `../README.md`.
 */
import { defineStack } from '@objectstack/spec';
import type { Field, ServiceObject } from '@objectstack/spec/data';

const readWrite = { allowRead: true, allowCreate: true, allowEdit: true };

/** One roll-up pair: a parent with `summaries` summary fields over a master-detail child. */
function rollupPair(n: 0 | 1 | 2): ServiceObject[] {
  const parent = `bench_roll${n}`;
  const child = `${parent}_item`;
  const summaries: Record<string, Field> = {};
  if (n >= 1) {
    summaries.total_quantity = {
      type: 'summary',
      label: 'Total quantity',
      summaryOperations: { object: child, field: 'quantity', function: 'sum' },
    };
  }
  if (n >= 2) {
    summaries.item_count = {
      type: 'summary',
      label: 'Item count',
      summaryOperations: { object: child, function: 'count' },
    };
  }
  return [
    {
      name: parent,
      label: `Roll-up parent (${n})`,
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        ...summaries,
      },
    },
    {
      name: child,
      label: `Roll-up item (${n})`,
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        parent: { type: 'master_detail', label: 'Parent', reference: parent, required: true, deleteBehavior: 'cascade' },
        quantity: { type: 'number', label: 'Quantity' },
        amount: { type: 'number', label: 'Amount' },
      },
    },
  ];
}

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
    ...rollupPair(0),
    ...rollupPair(1),
    ...rollupPair(2),
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
        bench_roll0: readWrite,
        bench_roll0_item: readWrite,
        bench_roll1: readWrite,
        bench_roll1_item: readWrite,
        bench_roll2: readWrite,
        bench_roll2_item: readWrite,
      },
    },
  ],
});
