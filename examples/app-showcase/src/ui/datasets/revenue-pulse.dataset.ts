// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Datasets backing the Revenue Pulse dashboard (framework#2501) — two
 * DIFFERENT base objects on one dashboard, so the dashboard-level filters
 * demonstrably re-scope cross-object: the date range hits `issued_on` on
 * invoices vs `signed_on` on accounts, and the shared "region" filter hits
 * `region` vs `sales_region`, each mapped per widget via `filterBindings`.
 */

/** Invoice analytics — counts by status / month / region over showcase_invoice. */
export const ShowcaseInvoiceDataset = defineDataset({
  name: 'showcase_invoice_metrics',
  label: 'Invoice Metrics',
  object: 'showcase_invoice',
  // Every member carries its ADR-0149 D1 business vocabulary: `synonyms`, the
  // words a person types in a question, every language in the one list
  // (matched, never translated), and `description`, a plain business
  // definition, translated at `datasets.<name>.{dimensions,measures}.<member>.description`.
  dimensions: [
    {
      name: 'status', label: 'Status', field: 'status', type: 'string',
      description: 'Where the invoice stands: Draft, Sent, Paid or Void.',
      synonyms: ['invoice status', '发票状态'],
    },
    {
      name: 'region', label: 'Region', field: 'region', type: 'string',
      description: 'The billing region the invoice belongs to: AMER, EMEA or APAC.',
      synonyms: ['billing region', '区域', '地区'],
    },
    {
      name: 'issued_on', label: 'Issued', field: 'issued_on', type: 'date', dateGranularity: 'month',
      description: 'The date the invoice was issued, grouped by calendar month.',
      synonyms: ['issue date', 'invoice month', '开票日期', '开票月份'],
    },
    {
      name: 'account', label: 'Account', field: 'account', type: 'lookup',
      description: 'The customer company the invoice is billed to; results show the account name.',
      synonyms: ['customer', 'client', '客户'],
    },
  ],
  measures: [
    {
      name: 'invoice_count', label: 'Invoices', aggregate: 'count',
      description: 'How many invoices there are, at every status: drafts and void invoices are counted too.',
      synonyms: ['number of invoices', '发票数', '发票数量'],
    },
    // Invoices bill in different currencies (`showcase_invoice.currency_code`),
    // so a sum of their own amounts (or of the line Subtotal, entered in each
    // invoice's currency) adds euros to yen. The consolidated figure sums the
    // HOME-currency amount the engine stored at write: one currency, the
    // organization's, whatever each invoice was billed in.
    {
      name: 'total_home_sum', label: 'Total incl. Tax (Home Currency)', aggregate: 'sum', field: 'amount_home', format: '0,0',
      description:
        'The tax-inclusive total of the invoices at every status, each converted into the organization\'s home '
        + 'currency so that invoices billed in different currencies add up.',
      synonyms: ['invoiced amount', 'billed amount', '开票金额', '含税总额'],
    },
    // A RATE — the percent-scale case (objectui#3136). `paid_rate` is a 0–1
    // ratio by construction, and grouping by `status` makes the Paid bucket
    // exactly 1: the value a magnitude-guessing renderer printed as "1.0%"
    // instead of "100.0%". The server annotates the column's scale from the
    // `ratio` operator, so display no longer has to infer it.
    {
      name: 'paid_count', label: 'Paid Invoices', aggregate: 'count', filter: { status: 'paid' },
      description: 'How many invoices are in the Paid status.',
      synonyms: ['invoices paid', 'settled invoices', '已付发票数'],
    },
    {
      name: 'paid_rate',
      label: 'Paid Rate',
      derived: { op: 'ratio', of: ['paid_count', 'invoice_count'] },
      format: '0.0%',
      description: 'The share of invoices that are Paid: Paid Invoices divided by Invoices, shown as a percentage.',
      synonyms: ['payment rate', 'share of invoices paid', '付款率'],
    },
  ],
});

/** Account analytics — counts / revenue by industry / region over showcase_account. */
export const ShowcaseAccountDataset = defineDataset({
  name: 'showcase_account_metrics',
  label: 'Account Metrics',
  object: 'showcase_account',
  // Every member carries its ADR-0149 D1 business vocabulary: `synonyms`, the
  // words a person types in a question, every language in the one list
  // (matched, never translated), and `description`, a plain business
  // definition, translated at `datasets.<name>.{dimensions,measures}.<member>.description`.
  dimensions: [
    {
      name: 'industry', label: 'Industry', field: 'industry', type: 'string',
      description: 'The industry the customer company works in: Technology, Finance, Healthcare or Retail.',
      synonyms: ['sector', 'vertical', '行业'],
    },
    {
      name: 'status', label: 'Lifecycle', field: 'status', type: 'string',
      description: 'Where the account stands as a customer: Prospect, Active or Churned.',
      synonyms: ['account status', 'lifecycle stage', '客户状态', '生命周期'],
    },
    {
      name: 'sales_region', label: 'Sales Region', field: 'sales_region', type: 'string',
      description: 'The sales territory that owns the account: AMER, EMEA or APAC.',
      synonyms: ['territory', 'sales territory', '销售区域'],
    },
    {
      name: 'signed_on', label: 'Customer Since', field: 'signed_on', type: 'date', dateGranularity: 'month',
      description: 'The date the company became a customer, grouped by calendar month.',
      synonyms: ['signing date', 'signed date', '签约日期', '签约月份'],
    },
  ],
  measures: [
    {
      name: 'account_count', label: 'Accounts', aggregate: 'count',
      description: 'How many accounts there are: prospects and churned customers are counted too.',
      synonyms: ['number of accounts', 'customer count', '客户数', '客户数量'],
    },
    {
      name: 'revenue_sum', label: 'Annual Revenue', aggregate: 'sum', field: 'annual_revenue', format: '0,0',
      description:
        'The sum of the Annual Revenue of the account companies, prospects and churned customers included; '
        + 'it is each company\'s own yearly revenue, not what it is billed.',
      synonyms: ['revenue', 'yearly revenue', '年营收', '年收入'],
    },
  ],
});
