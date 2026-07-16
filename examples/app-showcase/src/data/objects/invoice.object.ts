// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { cel, P } from '@objectstack/spec';

/**
 * Product — a small price-book / catalog. The invoice line's `product` lookup
 * points here; selecting a product auto-fills the line's `description` and
 * `unit_price` (the line-item grid copies matching field names from the chosen
 * record — the catalog typeahead every invoicing tool has: QuickBooks
 * "Product/Service", Stripe price catalog, NetSuite item column).
 */
export const Product = ObjectSchema.create({
  name: 'showcase_product',
  // [ADR-0090 D1] grandfather stamp: public demo catalog data.
  sharingModel: 'public_read_write',
  label: 'Product',
  pluralLabel: 'Products',
  icon: 'package',
  description: 'A sellable product with a catalog price.',

  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true, maxLength: 120 }),
    sku: Field.text({ label: 'SKU', searchable: true, maxLength: 40 }),
    description: Field.text({ label: 'Description', maxLength: 200 }),
    unit_price: Field.currency({ label: 'Unit Price', scale: 2, min: 0 }),
    active: Field.boolean({ label: 'Active', defaultValue: true }),
  },
});

/**
 * Invoice + Invoice Line — the canonical master-detail "header + line items"
 * shape. Unlike project↔task (a task is added to a project over time), an
 * invoice is meaningless without its lines: you enter the header AND its lines
 * together, in one atomic transaction. So `invoice_line.invoice` declares
 * `inlineEdit: 'grid'` — every standard New/Edit Invoice form renders an
 * editable line-item grid, and the invoice `total` rolls the line amounts up
 * server-side. This is where inline master-detail entry belongs.
 */
export const Invoice = ObjectSchema.create({
  name: 'showcase_invoice',
  // [ADR-0090 D1] grandfather stamp: isolation is RLS-owned (owner == current_user.email); lines derive via controlled_by_parent.
  sharingModel: 'public_read_write',
  label: 'Invoice',
  pluralLabel: 'Invoices',
  icon: 'receipt',
  description: 'A customer invoice entered together with its line items.',

  fields: {
    name: Field.text({ label: 'Invoice Number', required: true, searchable: true, maxLength: 60 }),
    // Forward record-picker config (spec lookup* props). The renderer
    // auto-derives columns from the Account schema, but here we curate them and
    // — crucially — SCOPE the picker so a rep can't invoice a churned account.
    // `lookupFilters` is the structured, picker-honoured form of referenceFilters.
    account: Field.lookup('showcase_account', {
      label: 'Account',
      required: true,
      descriptionField: 'industry',
      // Read side: a CORE relationship (`relatedList: 'primary'`) → its own
      // "Invoices" tab on the Account detail page, derived from this lookup with
      // NO hand-built page. Title/columns declared here on the relationship.
      relatedList: 'primary',
      relatedListTitle: 'Invoices',
      relatedListColumns: ['name', 'status', 'total', 'issued_on'],
      lookupColumns: [
        'name',
        { field: 'industry', label: 'Industry', type: 'select' },
        { field: 'status', label: 'Lifecycle', type: 'select' },
        { field: 'annual_revenue', label: 'Annual Revenue', type: 'currency' },
      ],
      lookupFilters: [{ field: 'status', operator: 'ne', value: 'churned' }],
    }),
    // Dependent (cascading) lookup — the billing contact must belong to the
    // selected account. `dependsOn: ['account']` scopes this picker by the
    // invoice's own `account` value: string form = same key on both sides
    // (invoice.account ↔ showcase_contact.account). Until an account is
    // chosen the picker has nothing to scope by; after switching accounts the
    // candidate list changes with it.
    contact: Field.lookup('showcase_contact', {
      label: 'Contact',
      descriptionField: 'email',
      dependsOn: ['account'],
    }),
    // Owner email — the row-level-security anchor. The `showcase_contributor`
    // permission set scopes invoice SELECT to `owner = current_user.email` (email
    // is the unique, seedable identifier), so a contributor sees only their own
    // invoices; because `showcase_invoice_line` is `controlled_by_parent`, the
    // lines follow automatically (ADR-0055). Mirror of `project.owner`.
    owner: Field.text({ label: 'Owner', maxLength: 200 }),
    // Region the sale was booked in — the invoice-side target of the Revenue
    // Pulse dashboard's shared "region" filter (framework#2501): accounts map
    // the same filter to their own `sales_region` via `filterBindings`.
    region: Field.select({
      label: 'Region',
      options: [
        { label: 'AMER', value: 'amer', default: true },
        { label: 'EMEA', value: 'emea' },
        { label: 'APAC', value: 'apac' },
      ],
    }),
    status: Field.select({
      label: 'Status',
      required: true,
      options: [
        { label: 'Draft', value: 'draft', default: true, color: '#94A3B8' },
        { label: 'Sent', value: 'sent', color: '#3B82F6' },
        { label: 'Paid', value: 'paid', color: '#10B981' },
        { label: 'Void', value: 'void', color: '#EF4444' },
      ],
    }),
    // Conditional rule (B2): an invoice must carry an issue date once it leaves
    // Draft. Authored as a CEL `requiredWhen`; the client makes the field show a
    // required marker + blocks submit, and the server's rule-validator enforces
    // the same predicate over the merged record — one rule, both ends agree.
    issued_on: Field.date({
      label: 'Issued On',
      requiredWhen: P`record.status in ['sent', 'paid']`,
    }),
    // Conditional rule (B2): once an invoice is Paid, its tax rate is locked.
    // `readonlyWhen` makes the client render the field read-only, and the
    // server's `stripReadonlyWhenFields` drops any incoming change to it (the
    // persisted value is kept) rather than rejecting the write.
    // Header tax rate (percent). The line-item entry form reads it live to show
    // a Subtotal / Tax / Total stack under the grid as lines are entered.
    tax_rate: Field.number({
      label: 'Tax Rate (%)',
      min: 0,
      max: 100,
      defaultValue: 0,
      readonlyWhen: P`record.status == 'paid'`,
    }),
    // Conditional rule (B2): "Paid On" is only meaningful — and only shown —
    // once the invoice is Paid, and then it is required. `visibleWhen` is a
    // pure client UX concern (the server has no visibility notion); the
    // `requiredWhen` half is enforced on both ends.
    paid_on: Field.date({
      label: 'Paid On',
      visibleWhen: P`record.status == 'paid'`,
      requiredWhen: P`record.status == 'paid'`,
    }),
    // Roll-up: recomputed server-side as line items are inserted/updated/deleted
    // (child FK auto-detected: showcase_invoice_line.invoice). This is the line
    // subtotal; the tax-inclusive grand total is shown live during entry.
    total: Field.summary({
      label: 'Subtotal',
      summaryOperations: { object: 'showcase_invoice_line', field: 'amount', function: 'sum' },
    }),
  },
});

/** Invoice line item — owned by its invoice, entered inline in the grid. */
export const InvoiceLine = ObjectSchema.create({
  name: 'showcase_invoice_line',
  label: 'Invoice Line',
  pluralLabel: 'Invoice Lines',
  icon: 'list',
  description: 'A single billable line on an invoice.',

  // ADR-0055: a line's access is CONTROLLED BY ITS PARENT invoice — a user sees
  // and edits a line only if they can see/edit its `invoice` master. No RLS is
  // authored here; the security layer derives it from the required master_detail
  // relationship (`invoice`). This is the canonical master-detail use of
  // controlled_by_parent (a line is meaningless apart from its invoice).
  sharingModel: 'controlled_by_parent',

  fields: {
    invoice: Field.masterDetail('showcase_invoice', {
      label: 'Invoice',
      required: true,
      deleteBehavior: 'cascade',
      // Thin, high-volume line items → the editable grid form factor.
      inlineEdit: 'grid',
      inlineTitle: 'Line Items',
    }),
    // Catalog lookup. Picking a product auto-fills `description` + `unit_price`
    // (the grid copies same-named fields from the selected product record).
    // Line sort position — stamped by the grid on drag-reorder so the order
    // persists. Excluded from the editable columns (it's not hand-entered).
    position: Field.number({ label: 'Position', defaultValue: 0 }),
    // Conditional rule (B2 in grids, PARENT-scoped): once the header invoice is
    // Paid, its lines are frozen. `readonlyWhen` here references the header as
    // `parent`, so the inline grid evaluates it per row against the live invoice
    // record and locks the cell — the "paid invoice → lock lines" case (#1581).
    product: Field.lookup('showcase_product', {
      label: 'Product',
      required: true,
      readonlyWhen: P`parent.status == 'paid'`,
    }),
    // Conditional rule (B2 in grids): a bulk line (large quantity) must carry a
    // description note. `requiredWhen` here is ROW-scoped — it references the
    // line's own `record`, so the inline grid flags this cell required per row
    // as the quantity crosses the threshold. (A header-driven lock referencing
    // `parent` — see `product`/`quantity`/`unit_price` — is the parent-scoped
    // counterpart; both are evaluated by the inline grid. See ADR-0036 / #1581.)
    description: Field.text({
      label: 'Description',
      maxLength: 200,
      requiredWhen: P`record.quantity >= 100`,
    }),
    quantity: Field.number({
      label: 'Qty',
      required: true,
      min: 0,
      defaultValue: 1,
      readonlyWhen: P`parent.status == 'paid'`,
    }),
    unit_price: Field.currency({
      label: 'Unit Price',
      scale: 2,
      min: 0,
      readonlyWhen: P`parent.status == 'paid'`,
    }),
    // Per-line attachment (objectui#2360): the inline line-item grid renders a
    // real upload cell for `file` fields — the "attach the receipt to each
    // expense line" pattern. Exercises upload-in-grid end-to-end (auto-derived
    // column, compact picker, persistence through the storage service).
    receipt: Field.file({ label: 'Receipt' }),
    // Amount = Qty × Unit Price. Kept as a *stored* currency column (so the
    // parent Invoice.total summary can roll it up — summary aggregation reads
    // stored columns, not on-read formula fields), but the `expression` makes
    // the line-item grid render it READ-ONLY and recompute it live client-side
    // as quantity/unit_price change, then persist the computed value. The
    // server does not treat a non-`formula` field's expression as computed, so
    // the client-sent value is stored as-is.
    amount: Field.currency({
      label: 'Amount',
      scale: 2,
      min: 0,
      expression: cel`record.quantity * record.unit_price`,
    }),
  },
});
