// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';
import { Account } from '../objects/account.object.js';
import { Preference } from '../objects/preference.object.js';
import { Project } from '../objects/project.object.js';
import { Task } from '../objects/task.object.js';
import { Category } from '../objects/category.object.js';
import { Team, ProjectMembership } from '../objects/team.object.js';
import { Product, Invoice, InvoiceLine } from '../objects/invoice.object.js';
import { FieldZoo } from '../objects/field-zoo.object.js';

/**
 * Seed data sized to "feed every view": every Kanban column is populated,
 * tasks carry due/start/end/created dates (calendar, gantt, timeline) and a
 * work location (map), and projects span every status and health.
 */

const accounts = defineSeed(Account, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    // `status` is required and no default is applied at seed-insert time, so it
    // must be set explicitly or the row is rejected (this is why Accounts was
    // empty). `hq` also exercises the location field.
    { name: 'Northwind', industry: 'retail', annual_revenue: 8_000_000, website: 'https://northwind.example', status: 'active', hq: { lat: 47.6062, lng: -122.3321 }, tax_id: '91-1144442', billing_email: 'ap@northwind.example' },
    { name: 'Contoso', industry: 'technology', annual_revenue: 25_000_000, website: 'https://contoso.example', status: 'active', hq: { lat: 37.7749, lng: -122.4194 }, tax_id: '20-3399881', billing_email: 'billing@contoso.example' },
    { name: 'Fabrikam', industry: 'healthcare', annual_revenue: 12_000_000, website: 'https://fabrikam.example', status: 'prospect', hq: { lat: 40.7128, lng: -74.0060 }, tax_id: '46-7782013', billing_email: 'accounts@fabrikam.example' },
  ],
});

const projects = defineSeed(Project, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Website Relaunch', account: 'Northwind', status: 'active', health: 'green', budget: 150_000, spent: 60_000, owner: 'ada@example.com', start_date: cel`daysAgo(30)`, end_date: cel`daysFromNow(60)` },
    { name: 'Data Platform', account: 'Contoso', status: 'active', health: 'yellow', budget: 600_000, spent: 420_000, owner: 'linus@example.com', start_date: cel`daysAgo(90)`, end_date: cel`daysFromNow(120)` },
    { name: 'Compliance Audit', account: 'Fabrikam', status: 'on_hold', health: 'red', budget: 90_000, spent: 88_000, owner: 'grace@example.com', start_date: cel`daysAgo(15)`, end_date: cel`daysFromNow(30)` },
    { name: 'Mobile App', account: 'Contoso', status: 'planned', health: 'green', budget: 200_000, spent: 0, owner: 'ada@example.com', start_date: cel`daysFromNow(14)`, end_date: cel`daysFromNow(140)` },
    { name: 'Legacy Sunset', account: 'Northwind', status: 'completed', health: 'green', budget: 50_000, spent: 48_000, owner: 'linus@example.com', start_date: cel`daysAgo(180)`, end_date: cel`daysAgo(20)` },
  ],
});

// Tasks across all five board columns, with dates + locations to drive every view.
const tasks = defineSeed(Task, {
  mode: 'upsert',
  externalId: 'title',
  records: [
    { cover: 'https://picsum.photos/seed/showcasetask1/480/300', title: 'Audit current IA', project: 'Website Relaunch', assignee: 'ada@example.com', status: 'done', priority: 'medium', estimate_hours: 8, progress: 100, done: true, created_at: cel`daysAgo(20)`, start_date: cel`daysAgo(20)`, end_date: cel`daysAgo(18)`, due_date: cel`daysAgo(18)`, location: { lat: 47.6062, lng: -122.3321 } },
    { cover: 'https://picsum.photos/seed/showcasetask2/480/300', title: 'Design system', project: 'Website Relaunch', assignee: 'ada@example.com', status: 'in_review', priority: 'high', estimate_hours: 24, progress: 80, done: false, created_at: cel`daysAgo(14)`, start_date: cel`daysAgo(12)`, end_date: cel`daysFromNow(2)`, due_date: cel`daysFromNow(2)`, location: { lat: 37.7749, lng: -122.4194 } },
    { cover: 'https://picsum.photos/seed/showcasetask3/480/300', title: 'Build homepage', project: 'Website Relaunch', assignee: 'sam@example.com', status: 'in_progress', priority: 'high', estimate_hours: 40, progress: 45, done: false, created_at: cel`daysAgo(8)`, start_date: cel`daysAgo(6)`, end_date: cel`daysFromNow(10)`, due_date: cel`daysFromNow(10)`, location: { lat: 40.7128, lng: -74.0060 } },
    { cover: 'https://picsum.photos/seed/showcasetask4/480/300', title: 'SEO migration plan', project: 'Website Relaunch', assignee: 'sam@example.com', status: 'todo', priority: 'medium', estimate_hours: 16, progress: 0, done: false, created_at: cel`daysAgo(3)`, start_date: cel`daysFromNow(5)`, end_date: cel`daysFromNow(15)`, due_date: cel`daysFromNow(15)`, location: { lat: 30.2672, lng: -97.7431 } },
    { cover: 'https://picsum.photos/seed/showcasetask5/480/300', title: 'Content backlog', project: 'Website Relaunch', assignee: 'grace@example.com', status: 'backlog', priority: 'low', estimate_hours: 12, progress: 0, done: false, created_at: cel`daysAgo(2)`, due_date: cel`daysFromNow(30)`, location: { lat: 41.8781, lng: -87.6298 } },
    { cover: 'https://picsum.photos/seed/showcasetask6/480/300', title: 'Ingest pipeline', project: 'Data Platform', assignee: 'linus@example.com', status: 'in_progress', priority: 'urgent', estimate_hours: 60, progress: 55, done: false, created_at: cel`daysAgo(40)`, start_date: cel`daysAgo(35)`, end_date: cel`daysFromNow(20)`, due_date: cel`daysFromNow(20)`, location: { lat: 39.7392, lng: -104.9903 } },
    { cover: 'https://picsum.photos/seed/showcasetask7/480/300', title: 'Warehouse schema', project: 'Data Platform', assignee: 'linus@example.com', status: 'in_review', priority: 'high', estimate_hours: 30, progress: 90, done: false, created_at: cel`daysAgo(25)`, start_date: cel`daysAgo(22)`, end_date: cel`daysFromNow(3)`, due_date: cel`daysFromNow(3)`, location: { lat: 42.3601, lng: -71.0589 } },
    { cover: 'https://picsum.photos/seed/showcasetask8/480/300', title: 'PII access review', project: 'Compliance Audit', assignee: 'grace@example.com', status: 'todo', priority: 'urgent', estimate_hours: 20, progress: 0, done: false, created_at: cel`daysAgo(5)`, start_date: cel`daysFromNow(2)`, end_date: cel`daysFromNow(12)`, due_date: cel`daysFromNow(12)`, location: { lat: 38.9072, lng: -77.0369 } },
    { cover: 'https://picsum.photos/seed/showcasetask9/480/300', title: 'Evidence collection', project: 'Compliance Audit', assignee: 'grace@example.com', status: 'backlog', priority: 'medium', estimate_hours: 18, progress: 0, done: false, created_at: cel`daysAgo(1)`, due_date: cel`daysFromNow(25)`, location: { lat: 34.0522, lng: -118.2437 } },
    { cover: 'https://picsum.photos/seed/showcasetask10/480/300', title: 'App wireframes', project: 'Mobile App', assignee: 'ada@example.com', status: 'done', priority: 'medium', estimate_hours: 16, progress: 100, done: true, created_at: cel`daysAgo(10)`, start_date: cel`daysAgo(10)`, end_date: cel`daysAgo(6)`, due_date: cel`daysAgo(6)`, location: { lat: 45.5152, lng: -122.6784 } },
  ],
});

const categories = defineSeed(Category, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Engineering', sort_order: 1, color: '#3B82F6' },
    { name: 'Frontend', parent: 'Engineering', sort_order: 1, color: '#06B6D4' },
    { name: 'Backend', parent: 'Engineering', sort_order: 2, color: '#8B5CF6' },
    { name: 'Operations', sort_order: 2, color: '#10B981' },
  ],
});

const teams = defineSeed(Team, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Platform', lead: 'linus@example.com', capacity_hours: 200 },
    { name: 'Experience', lead: 'ada@example.com', capacity_hours: 160 },
  ],
});

// Catalog products the invoice line's `product` lookup picks from. Selecting
// one auto-fills the line's description + unit_price (matching field names).
const products = defineSeed(Product, {
  mode: 'upsert',
  externalId: 'sku',
  records: [
    { sku: 'WIDGET-A', name: 'Widget A', description: 'Standard widget', unit_price: 29.99, active: true },
    { sku: 'WIDGET-B', name: 'Widget B', description: 'Deluxe widget', unit_price: 49.99, active: true },
    { sku: 'GADGET-X', name: 'Gadget X', description: 'Premium gadget', unit_price: 99.0, active: true },
    { sku: 'SERVICE-HR', name: 'Consulting Hour', description: 'Professional services, per hour', unit_price: 150.0, active: true },
  ],
});

const memberships = defineSeed(ProjectMembership, {
  mode: 'insert',
  records: [
    { team: 'Experience', project: 'Website Relaunch', role: 'owner', allocation_percent: 80 },
    { team: 'Platform', project: 'Data Platform', role: 'owner', allocation_percent: 100 },
    { team: 'Platform', project: 'Website Relaunch', role: 'contributor', allocation_percent: 20 },
  ],
});

// Field Zoo specimens — one record per "look" exercising EVERY input-able
// field type with a real value. This is both a demo (the gallery finally
// renders populated) and a regression guard: the seed inserts at boot, so a
// field type that can't persist (e.g. the array-serialization / `time` bugs
// found here) makes the app fail to start instead of silently shipping broken.
// Relational/computed fields (lookup/master_detail/tree/record-map, formula/
// summary/autonumber) resolve or generate at runtime. `f_master_detail` is the
// owning Project; `f_lookup` the Account — referenced by their seed externalId.
const fieldZoo = defineSeed(FieldZoo, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    {
      name: 'Specimen — Full',
      f_textarea: 'Line one\nLine two', f_email: 'zoo@example.com', f_url: 'https://objectstack.ai',
      // NOTE: `f_secret` (encryption-at-rest) is intentionally omitted — the
      // seed path has no CryptoProvider, so a secret value is (correctly)
      // refused fail-closed. The field type is still covered by the schema.
      f_phone: '+1 555 010 2030', f_password: 'hunter2',
      f_markdown: '# Heading\n\n- a\n- b', f_html: '<b>bold</b> & <i>italic</i>', f_richtext: '<p>Rich <strong>text</strong></p>',
      f_number: 420, f_currency: 1299.95, f_percent: 75,
      f_date: '2026-06-17', f_datetime: '2026-06-17T14:30:00Z', f_time: '14:30',
      f_boolean: true, f_toggle: true,
      f_select: 'high', f_multiselect: ['red', 'green'], f_radio: 'yes', f_checkboxes: ['email', 'push'], f_tags: ['alpha', 'beta'],
      f_lookup: 'Northwind', f_master_detail: 'Website Relaunch',
      f_location: { lat: 47.6062, lng: -122.3321 }, f_address: { street: '1 Main St', city: 'Seattle', state: 'WA', postal_code: '98101', country: 'US' },
      f_code: '{\n  "ok": true\n}', f_json: { nested: { k: 'v' }, list: [1, 2, 3] }, f_color: '#2563EB',
      f_rating: 4, f_slider: 60, f_progress: 80,
      f_composite: { width: 10, height: 20 }, f_repeater: [{ label: 'one', qty: 1 }, { label: 'two', qty: 2 }],
      f_record: { primary: { name: 'A', score: 9 }, backup: { name: 'B', score: 7 } },
      f_vector: [0.12, 0.34, 0.56, 0.78],
    },
    {
      name: 'Specimen — Minimal',
      f_number: 7, f_select: 'low', f_radio: 'no', f_time: '09:05:30',
      f_multiselect: ['blue'], f_checkboxes: ['sms'], f_tags: [],
      f_boolean: false, f_rating: 2, f_slider: 0, f_progress: 0,
      f_master_detail: 'Data Platform',
    },
  ],
});

// Invoices owned by different contributors — the controlled-by-parent demo
// (ADR-0055). Under the `showcase_contributor` permission set's owner RLS, a
// contributor (e.g. ada@example.com) sees only the invoices they OWN; because
// `showcase_invoice_line` is `controlled_by_parent`, the lines below follow
// automatically — ada sees INV-1001/1002's lines but never linus's INV-1003.
const invoices = defineSeed(Invoice, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'INV-1001', account: 'Northwind', owner: 'ada@example.com', status: 'sent', issued_on: cel`daysAgo(10)`, tax_rate: 8 },
    { name: 'INV-1002', account: 'Contoso', owner: 'ada@example.com', status: 'draft', tax_rate: 0 },
    { name: 'INV-1003', account: 'Contoso', owner: 'linus@example.com', status: 'paid', issued_on: cel`daysAgo(30)`, paid_on: cel`daysAgo(2)`, tax_rate: 8 },
    { name: 'INV-1004', account: 'Fabrikam', owner: 'grace@example.com', status: 'draft', tax_rate: 0 },
  ],
});

// Line items — `product` resolves by SKU (the Product seed's externalId), and
// `invoice` by invoice number. A contributor reaches a line only through its
// master invoice, so these inherit the invoice's owner scoping.
const invoiceLines = defineSeed(InvoiceLine, {
  mode: 'upsert',
  externalId: 'description',
  records: [
    { description: 'INV-1001 \u00b7 Consulting hours', invoice: 'INV-1001', product: 'SERVICE-HR', position: 0, quantity: 10, unit_price: 150, amount: 1500 },
    { description: 'INV-1001 \u00b7 Widget A units', invoice: 'INV-1001', product: 'WIDGET-A', position: 1, quantity: 4, unit_price: 29.99, amount: 119.96 },
    { description: 'INV-1002 \u00b7 Gadget X units', invoice: 'INV-1002', product: 'GADGET-X', position: 0, quantity: 2, unit_price: 99, amount: 198 },
    { description: 'INV-1003 \u00b7 Widget B units', invoice: 'INV-1003', product: 'WIDGET-B', position: 0, quantity: 6, unit_price: 49.99, amount: 299.94 },
    { description: 'INV-1004 \u00b7 Consulting hours', invoice: 'INV-1004', product: 'SERVICE-HR', position: 0, quantity: 3, unit_price: 150, amount: 450 },
  ],
});

const preferences = defineSeed(Preference, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'My Preferences', theme: 'light', default_landing: 'my_work', email_digest: 'daily', items_per_page: 50, notifications_enabled: true, compact_density: false },
  ],
});

export const ShowcaseSeedData = [accounts, products, projects, tasks, categories, teams, memberships, fieldZoo, invoices, invoiceLines, preferences];
