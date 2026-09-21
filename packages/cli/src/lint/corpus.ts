// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Golden metadata-generation eval corpus.
 *
 * Each case pairs a natural-language authoring prompt with a fixture stack that
 * represents the *ideal* generated output — schema-valid and following the
 * platform's modelling conventions (master-detail ownership, inlineEdit for
 * line items, relatedList/no-inlineEdit for associations, roll-up summaries,
 * select options, name fields, labels). Offline, the harness asserts these
 * golden stacks clear the quality bar; live, the same prompts benchmark a real
 * model against them.
 *
 * Keep these representative of common enterprise shapes — they double as
 * worked examples of the conventions the AI generator should target.
 */

import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import type { MetadataEvalCase } from './metadata-eval.js';

// `id` is a reverse-domain package identifier and `namespace` is a snake_case
// metadata prefix — one project, two identifiers, contradictory rules
// (`MANIFEST_ID_PATTERN` refuses the underscore a namespace may carry). The
// corpus is what the generator imitates, so each entry writes both correctly
// rather than reusing one for the other.
const manifest = (id: string, namespace: string, name: string) => ({
  id,
  namespace,
  version: '1.0.0',
  name,
  type: 'app' as const,
  // The golden corpus models best practice: declare the protocol range so the
  // ADR-0087 handshake can refuse an incompatible runtime at the boundary.
  engines: { protocol: `^${PROTOCOL_MAJOR}` },
});

export const DEFAULT_METADATA_EVAL_CORPUS: MetadataEvalCase[] = [
  {
    id: 'invoice_with_line_items',
    prompt:
      'Model an invoicing app: an invoice with multiple line items (product, quantity, unit price, amount). The invoice total should sum its line amounts, and line items are entered together with the invoice.',
    note: 'master_detail + inlineEdit + roll-up summary',
    fixture: {
      manifest: manifest('com.example.invoicing', 'invoicing', 'Invoicing'),
      objects: [
        {
          name: 'invoice',
          label: 'Invoice',
          sharingModel: 'private',
          fields: {
            name: { type: 'text', label: 'Invoice Number', required: true },
            account: { type: 'lookup', label: 'Account', reference: 'account' },
            status: {
              type: 'select',
              label: 'Status',
              options: [
                { label: 'Draft', value: 'draft' },
                { label: 'Sent', value: 'sent' },
                { label: 'Paid', value: 'paid' },
              ],
            },
            total: {
              type: 'summary',
              label: 'Total',
              summaryOperations: { object: 'invoice_line', field: 'amount', function: 'sum' },
            },
          },
        },
        {
          name: 'invoice_line',
          label: 'Invoice Line',
          sharingModel: 'controlled_by_parent',
          fields: {
            invoice: {
              type: 'master_detail',
              label: 'Invoice',
              reference: 'invoice',
              required: true,
              deleteBehavior: 'cascade',
              inlineEdit: true,
              relatedListTitle: 'Line Items',
            },
            product: { type: 'text', label: 'Product', required: true },
            quantity: { type: 'number', label: 'Quantity', required: true },
            unit_price: { type: 'currency', label: 'Unit Price', required: true },
            amount: { type: 'currency', label: 'Amount', required: true },
          },
        },
        {
          name: 'account',
          label: 'Account',
          sharingModel: 'private',
          fields: { name: { type: 'text', label: 'Account Name', required: true } },
        },
      ],
    },
  },

  {
    id: 'project_with_tasks',
    prompt:
      'A project management app: a project owns many tasks (title, status, estimate in hours). Tasks are edited inline within the project, and the project shows a task count and total estimate.',
    note: 'master_detail + inlineEdit + count/sum roll-ups',
    fixture: {
      manifest: manifest('com.example.pm', 'pm_app', 'Project Management'),
      objects: [
        {
          name: 'project',
          label: 'Project',
          sharingModel: 'private',
          fields: {
            name: { type: 'text', label: 'Project Name', required: true },
            status: {
              type: 'select',
              label: 'Status',
              options: [
                { label: 'Planned', value: 'planned' },
                { label: 'Active', value: 'active' },
                { label: 'Done', value: 'done' },
              ],
            },
            task_count: {
              type: 'summary',
              label: 'Tasks',
              summaryOperations: { object: 'task', field: 'estimate_hours', function: 'count' },
            },
            total_estimate: {
              type: 'summary',
              label: 'Total Estimate',
              summaryOperations: { object: 'task', field: 'estimate_hours', function: 'sum' },
            },
          },
        },
        {
          name: 'task',
          label: 'Task',
          sharingModel: 'controlled_by_parent',
          fields: {
            title: { type: 'text', label: 'Title', required: true },
            project: {
              type: 'master_detail',
              label: 'Project',
              reference: 'project',
              required: true,
              deleteBehavior: 'cascade',
              inlineEdit: true,
            },
            status: {
              type: 'select',
              label: 'Status',
              options: [
                { label: 'To Do', value: 'todo' },
                { label: 'In Progress', value: 'in_progress' },
                { label: 'Done', value: 'done' },
              ],
            },
            estimate_hours: { type: 'number', label: 'Estimate (h)' },
          },
        },
      ],
    },
  },

  {
    id: 'blog_post_with_comments',
    prompt:
      'A blog: posts have a title and body. Readers leave comments on a post (author, body). Comments belong to the post but are an activity stream, not something you fill in when writing the post.',
    note: 'association child: master_detail WITHOUT inlineEdit (related list on detail page)',
    fixture: {
      manifest: manifest('com.example.blog', 'blog_app', 'Blog'),
      objects: [
        {
          name: 'post',
          label: 'Post',
          sharingModel: 'private',
          fields: {
            title: { type: 'text', label: 'Title', required: true },
            body: { type: 'textarea', label: 'Body' },
          },
        },
        {
          name: 'post_comment',
          label: 'Comment',
          sharingModel: 'controlled_by_parent',
          fields: {
            // Association: owned by the post (cascade) but NOT inlineEdit —
            // surfaced as a related list on the post's detail page.
            post: {
              type: 'master_detail',
              label: 'Post',
              reference: 'post',
              required: true,
              deleteBehavior: 'cascade',
            },
            author: { type: 'text', label: 'Author', required: true },
            body: { type: 'textarea', label: 'Comment', required: true },
          },
        },
      ],
    },
  },

  {
    id: 'expense_report_with_lines',
    prompt:
      'An expense report app: a report has a title and a submitter. It contains expense lines (category, description, amount, date). The report total sums the line amounts and lines are entered inline.',
    note: 'master_detail + inlineEdit + sum roll-up + select options',
    fixture: {
      manifest: manifest('com.example.expenses', 'expenses', 'Expenses'),
      objects: [
        {
          name: 'expense_report',
          label: 'Expense Report',
          sharingModel: 'private',
          fields: {
            name: { type: 'text', label: 'Title', required: true },
            submitter: { type: 'text', label: 'Submitter', required: true },
            total: {
              type: 'summary',
              label: 'Total',
              summaryOperations: { object: 'expense_line', field: 'amount', function: 'sum' },
            },
          },
        },
        {
          name: 'expense_line',
          label: 'Expense Line',
          sharingModel: 'controlled_by_parent',
          fields: {
            expense_report: {
              type: 'master_detail',
              label: 'Expense Report',
              reference: 'expense_report',
              required: true,
              deleteBehavior: 'cascade',
              inlineEdit: true,
            },
            category: {
              type: 'select',
              label: 'Category',
              options: [
                { label: 'Travel', value: 'travel' },
                { label: 'Meals', value: 'meals' },
                { label: 'Lodging', value: 'lodging' },
              ],
            },
            description: { type: 'text', label: 'Description' },
            amount: { type: 'currency', label: 'Amount', required: true },
            spent_on: { type: 'date', label: 'Date' },
          },
        },
      ],
    },
  },

  {
    id: 'crm_account_with_contacts',
    prompt:
      'A simple CRM: accounts and their contacts. A contact belongs to an account but can exist independently and is not entered inline with the account.',
    note: 'lookup (independent child) — should NOT be master_detail/inlineEdit',
    fixture: {
      manifest: manifest('com.example.crm', 'crm_app', 'CRM'),
      objects: [
        {
          name: 'account',
          label: 'Account',
          sharingModel: 'private',
          fields: {
            name: { type: 'text', label: 'Account Name', required: true },
            industry: {
              type: 'select',
              label: 'Industry',
              options: [
                { label: 'Tech', value: 'tech' },
                { label: 'Retail', value: 'retail' },
              ],
            },
          },
        },
        {
          name: 'contact',
          label: 'Contact',
          sharingModel: 'private',
          fields: {
            full_name: { type: 'text', label: 'Full Name', required: true },
            email: { type: 'email', label: 'Email' },
            // Independent lifecycle → lookup, not master_detail.
            account: { type: 'lookup', label: 'Account', reference: 'account' },
          },
        },
      ],
    },
  },
];
