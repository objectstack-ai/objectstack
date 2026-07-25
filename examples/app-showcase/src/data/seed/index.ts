// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed, SeedSchema } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';
import { Account } from '../objects/account.object.js';
import { Preference } from '../objects/preference.object.js';
import { Project } from '../objects/project.object.js';
import { Task } from '../objects/task.object.js';
import { Category } from '../objects/category.object.js';
import { BusinessUnit } from '../objects/business-unit.object.js';
import { Team, ProjectMembership } from '../objects/team.object.js';
import { Product, Invoice, InvoiceLine } from '../objects/invoice.object.js';
import { ExpenseReport, ExpenseLine } from '../objects/expense-report.object.js';
import { Contact } from '../objects/contact.object.js';
import { Inquiry } from '../objects/inquiry.object.js';
import { FieldZoo } from '../objects/field-zoo.object.js';
import { Announcement } from '../objects/announcement.object.js';

/**
 * Seed data sized to "feed every view": every Kanban column is populated,
 * tasks carry due/start/end/created dates (calendar, gantt, timeline) and a
 * work location (map), and projects span every status and health.
 */

/**
 * Local, offline-safe placeholder cover image. Task `cover` seeds used to
 * point at picsum.photos, which renders as a wall of broken images in
 * offline/restricted-network environments (Gallery, All Views). A data: URI
 * needs no network at all and still gives each card a distinct color + number.
 */
function placeholderCover(seed: number, color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='300'><rect width='480' height='300' fill='${color}'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='system-ui,sans-serif' font-size='96' font-weight='700' fill='#ffffff' fill-opacity='0.35'>${seed}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const accounts = defineSeed(Account, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    // `status` is required and no default is applied at seed-insert time, so it
    // must be set explicitly or the row is rejected (this is why Accounts was
    // empty). `hq` also exercises the location field.
    // `sales_region` + `signed_on` feed the Revenue Pulse filtered dashboard
    // (framework#2501): its region filter maps here via filterBindings
    // (`region → sales_region`) and its date range via `dateRange → signed_on`.
    // Prospects have no `signed_on` yet — date-scoped account charts exclude
    // them by design.
    { name: 'Northwind', industry: 'retail', annual_revenue: 8_000_000, website: 'https://northwind.example', status: 'active', sales_region: 'amer', signed_on: cel`daysAgo(80)`, hq: { lat: 47.6062, lng: -122.3321 }, tax_id: '91-1144442', billing_email: 'ap@northwind.example' },
    { name: 'Contoso', industry: 'technology', annual_revenue: 25_000_000, website: 'https://contoso.example', status: 'active', sales_region: 'amer', signed_on: cel`daysAgo(700)`, hq: { lat: 37.7749, lng: -122.4194 }, tax_id: '20-3399881', billing_email: 'billing@contoso.example' },
    { name: 'Fabrikam', industry: 'healthcare', annual_revenue: 12_000_000, website: 'https://fabrikam.example', status: 'prospect', sales_region: 'emea', hq: { lat: 40.7128, lng: -74.0060 }, tax_id: '46-7782013', billing_email: 'accounts@fabrikam.example' },
    // Extra accounts so the record picker has enough volume to exercise search,
    // sorting, pagination and the (non-churned) scoping filter on invoices.
    { name: 'Initech', industry: 'finance', annual_revenue: 5_400_000, website: 'https://initech.example', status: 'active', sales_region: 'amer', signed_on: cel`daysAgo(45)`, hq: { lat: 30.2672, lng: -97.7431 }, tax_id: '74-2233110', billing_email: 'ap@initech.example' },
    { name: 'Globex', industry: 'technology', annual_revenue: 42_000_000, website: 'https://globex.example', status: 'active', sales_region: 'amer', signed_on: cel`daysAgo(500)`, hq: { lat: 34.0522, lng: -118.2437 }, tax_id: '95-8841200', billing_email: 'billing@globex.example' },
    { name: 'Stark Industries', industry: 'technology', annual_revenue: 180_000_000, website: 'https://stark.example', status: 'active', sales_region: 'amer', signed_on: cel`daysAgo(800)`, hq: { lat: 40.7580, lng: -73.9855 }, tax_id: '13-5567421', billing_email: 'ap@stark.example' },
    // CJK-named account so pinyin search recall (#2486) is demonstrable out of
    // the box: with the zh-CN locale configured, `$search=huaning` / `hnkj`
    // must find 华宁科技 in the record picker and list quick-search.
    { name: '华宁科技', industry: 'technology', annual_revenue: 36_000_000, website: 'https://huaning.example', status: 'active', sales_region: 'apac', signed_on: cel`daysAgo(200)`, hq: { lat: 31.2304, lng: 121.4737 }, tax_id: '91-3100001', billing_email: 'billing@huaning.example' },
    { name: 'Wayne Enterprises', industry: 'finance', annual_revenue: 210_000_000, website: 'https://wayne.example', status: 'active', sales_region: 'amer', signed_on: cel`daysAgo(900)`, hq: { lat: 40.7128, lng: -74.0060 }, tax_id: '22-9087733', billing_email: 'billing@wayne.example' },
    { name: 'Acme Retail', industry: 'retail', annual_revenue: 3_200_000, website: 'https://acme.example', status: 'prospect', sales_region: 'amer', hq: { lat: 41.8781, lng: -87.6298 }, tax_id: '36-4471209', billing_email: 'accounts@acme.example' },
    { name: 'Soylent Foods', industry: 'healthcare', annual_revenue: 9_900_000, website: 'https://soylent.example', status: 'prospect', sales_region: 'emea', hq: { lat: 37.3382, lng: -121.8863 }, tax_id: '77-1029384', billing_email: 'ap@soylent.example' },
    { name: 'Hooli', industry: 'technology', annual_revenue: 96_000_000, website: 'https://hooli.example', status: 'active', sales_region: 'amer', signed_on: cel`daysAgo(150)`, hq: { lat: 37.3861, lng: -122.0839 }, tax_id: '45-7781230', billing_email: 'billing@hooli.example' },
    { name: 'Vandelay Industries', industry: 'finance', annual_revenue: 6_700_000, website: 'https://vandelay.example', status: 'active', sales_region: 'emea', signed_on: cel`daysAgo(160)`, hq: { lat: 40.6782, lng: -73.9442 }, tax_id: '11-3344556', billing_email: 'ap@vandelay.example' },
    { name: 'Umbrella Health', industry: 'healthcare', annual_revenue: 33_000_000, website: 'https://umbrella.example', status: 'churned', sales_region: 'amer', signed_on: cel`daysAgo(600)`, hq: { lat: 39.9526, lng: -75.1652 }, tax_id: '88-2200117', churn_reason: 'Switched to in-house platform', billing_email: 'accounts@umbrella.example' },
    { name: 'Wonka Brands', industry: 'retail', annual_revenue: 14_500_000, website: 'https://wonka.example', status: 'churned', sales_region: 'emea', signed_on: cel`daysAgo(60)`, hq: { lat: 41.4993, lng: -81.6944 }, tax_id: '52-7741093', churn_reason: 'Budget cuts', billing_email: 'ap@wonka.example' },
  ],
});

// Contacts spread across three accounts — the data behind the dependent
// (cascading) lookup demo: picking an Account on an invoice scopes its
// Contact picker to that account's people (invoice.contact dependsOn account).
const contacts = defineSeed(Contact, {
  mode: 'upsert',
  externalId: 'email',
  records: [
    { name: 'Nora West', email: 'nora@northwind.example', phone: '+1 555 010 1111', company: 'Northwind', title: 'Procurement Lead', account: 'Northwind', stage: 'qualified' },
    { name: 'Noah Bell', email: 'noah@northwind.example', phone: '+1 555 010 2222', company: 'Northwind', title: 'CFO', account: 'Northwind', stage: 'working' },
    { name: 'Cara Ito', email: 'cara@contoso.example', phone: '+1 555 020 1111', company: 'Contoso', title: 'IT Director', account: 'Contoso', stage: 'new' },
    { name: 'Carl Fox', email: 'carl@contoso.example', phone: '+1 555 020 2222', company: 'Contoso', title: 'Data Lead', account: 'Contoso', stage: 'qualified' },
    { name: 'Faye Lin', email: 'faye@fabrikam.example', phone: '+1 555 030 1111', company: 'Fabrikam', title: 'Compliance Officer', account: 'Fabrikam', stage: 'new' },
    // CJK-named contacts so pinyin search recall (#2486) is demonstrable out
    // of the box: `$search=zhangwei` (full pinyin), `zw` (initials) and `张`
    // (CJK) must all find 张伟 in the people picker / list quick-search.
    { name: '张伟', email: 'zhangwei@huaning.example', phone: '+86 21 5550 1111', company: '华宁科技', title: 'Engineering Manager', account: '华宁科技', stage: 'qualified' },
    { name: '王芳', email: 'wangfang@huaning.example', phone: '+86 21 5550 2222', company: '华宁科技', title: 'Procurement Director', account: '华宁科技', stage: 'working' },
    { name: '李雷', email: 'lilei@huaning.example', phone: '+86 21 5550 3333', company: '华宁科技', title: 'IT Specialist', account: '华宁科技', stage: 'new' },
    // Bulk prospects under ONE account (Northwind) so its Account → Contacts
    // related list exceeds a page and demonstrates server-side related-list
    // pagination ($top/$skip, objectui#2711) on a fresh boot — every other
    // account keeps a handful for a clean people picker.
    ...Array.from({ length: 24 }, (_, i) => ({
      name: `Prospect ${String(i + 1).padStart(2, '0')}`,
      email: `prospect${i + 1}@northwind.example`,
      company: 'Northwind',
      title: 'Sales Prospect',
      account: 'Northwind',
      stage: 'new',
    })),
  ],
});

/**
 * Projects span every populated status so the Kanban board, Gantt and
 * dashboards show a realistic spread on first boot — not just one column.
 *
 * `project_status_flow` (#3165) declares `initialStates: ['planned']`, and
 * seeds deliberately run validation. But a seed is a curated snapshot of
 * ESTABLISHED facts (a project already `active` / `on_hold` / `completed`),
 * not a record walking its lifecycle — so the platform exempts seed writes
 * from the `state_machine` rule (#3433). That lets each project be seeded
 * DIRECTLY at its real status; no FSM-walk workaround (this used to seed all
 * five as `planned` then upsert-hop them through legal transitions, #3415).
 * `mode: 'upsert'` keeps replay idempotent — an unchanged row no-ops, so
 * dev-server restarts and package re-publishes never churn or re-validate.
 */
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
    { cover: placeholderCover(1, '#10B981'), title: 'Audit current IA', project: 'Website Relaunch', assignee: 'ada@example.com', status: 'done', priority: 'medium', estimate_hours: 8, progress: 100, done: true, created_at: cel`daysAgo(20)`, start_date: cel`daysAgo(20)`, end_date: cel`daysAgo(18)`, due_date: cel`daysAgo(18)`, location: { lat: 47.6062, lng: -122.3321 } },
    { cover: placeholderCover(2, '#8B5CF6'), title: 'Design system', project: 'Website Relaunch', assignee: 'ada@example.com', status: 'in_review', priority: 'high', estimate_hours: 24, progress: 80, done: false, created_at: cel`daysAgo(14)`, start_date: cel`daysAgo(12)`, end_date: cel`daysFromNow(2)`, due_date: cel`daysFromNow(2)`, location: { lat: 37.7749, lng: -122.4194 } },
    { cover: placeholderCover(3, '#F59E0B'), title: 'Build homepage', project: 'Website Relaunch', assignee: 'sam@example.com', status: 'in_progress', priority: 'high', estimate_hours: 40, progress: 45, done: false, created_at: cel`daysAgo(8)`, start_date: cel`daysAgo(6)`, end_date: cel`daysFromNow(10)`, due_date: cel`daysFromNow(10)`, location: { lat: 40.7128, lng: -74.0060 } },
    { cover: placeholderCover(4, '#3B82F6'), title: 'SEO migration plan', project: 'Website Relaunch', assignee: 'sam@example.com', status: 'todo', priority: 'medium', estimate_hours: 16, progress: 0, done: false, created_at: cel`daysAgo(3)`, start_date: cel`daysFromNow(5)`, end_date: cel`daysFromNow(15)`, due_date: cel`daysFromNow(15)`, location: { lat: 30.2672, lng: -97.7431 } },
    { cover: placeholderCover(5, '#94A3B8'), title: 'Content backlog', project: 'Website Relaunch', assignee: 'grace@example.com', status: 'backlog', priority: 'low', estimate_hours: 12, progress: 0, done: false, created_at: cel`daysAgo(2)`, due_date: cel`daysFromNow(30)`, location: { lat: 41.8781, lng: -87.6298 } },
    { cover: placeholderCover(6, '#F59E0B'), title: 'Ingest pipeline', project: 'Data Platform', assignee: 'linus@example.com', status: 'in_progress', priority: 'urgent', estimate_hours: 60, progress: 55, done: false, created_at: cel`daysAgo(40)`, start_date: cel`daysAgo(35)`, end_date: cel`daysFromNow(20)`, due_date: cel`daysFromNow(20)`, location: { lat: 39.7392, lng: -104.9903 } },
    { cover: placeholderCover(7, '#8B5CF6'), title: 'Warehouse schema', project: 'Data Platform', assignee: 'linus@example.com', status: 'in_review', priority: 'high', estimate_hours: 30, progress: 90, done: false, created_at: cel`daysAgo(25)`, start_date: cel`daysAgo(22)`, end_date: cel`daysFromNow(3)`, due_date: cel`daysFromNow(3)`, location: { lat: 42.3601, lng: -71.0589 } },
    { cover: placeholderCover(8, '#3B82F6'), title: 'PII access review', project: 'Compliance Audit', assignee: 'grace@example.com', status: 'todo', priority: 'urgent', estimate_hours: 20, progress: 0, done: false, created_at: cel`daysAgo(5)`, start_date: cel`daysFromNow(2)`, end_date: cel`daysFromNow(12)`, due_date: cel`daysFromNow(12)`, location: { lat: 38.9072, lng: -77.0369 } },
    { cover: placeholderCover(9, '#94A3B8'), title: 'Evidence collection', project: 'Compliance Audit', assignee: 'grace@example.com', status: 'backlog', priority: 'medium', estimate_hours: 18, progress: 0, done: false, created_at: cel`daysAgo(1)`, due_date: cel`daysFromNow(25)`, location: { lat: 34.0522, lng: -118.2437 } },
    { cover: placeholderCover(10, '#10B981'), title: 'App wireframes', project: 'Mobile App', assignee: 'ada@example.com', status: 'done', priority: 'medium', estimate_hours: 16, progress: 100, done: true, created_at: cel`daysAgo(10)`, start_date: cel`daysAgo(10)`, end_date: cel`daysAgo(6)`, due_date: cel`daysAgo(6)`, location: { lat: 45.5152, lng: -122.6784 } },
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

// Org-chart hierarchy seeded by `name` external id; `parent` references another
// record's name, building a 3-level tree the `tree` view renders.
const businessUnits = defineSeed(BusinessUnit, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'Acme Corporation', kind: 'company', manager: 'Dana Wong', headcount: 0 },
    { name: 'Product & Engineering', parent: 'Acme Corporation', kind: 'division', manager: 'Lena Ortiz', headcount: 0 },
    { name: 'Platform', parent: 'Product & Engineering', kind: 'department', manager: 'Sam Patel', headcount: 12 },
    { name: 'Frontend Guild', parent: 'Product & Engineering', kind: 'department', manager: 'Yuki Tan', headcount: 9 },
    { name: 'Design Systems', parent: 'Frontend Guild', kind: 'team', manager: 'Priya Rao', headcount: 4 },
    { name: 'Go-To-Market', parent: 'Acme Corporation', kind: 'division', manager: 'Marcus Bell', headcount: 0 },
    { name: 'Sales', parent: 'Go-To-Market', kind: 'department', manager: 'Erin Cole', headcount: 18 },
    { name: 'Enterprise Sales', parent: 'Sales', kind: 'team', manager: 'Tom Nyx', headcount: 7 },
    { name: 'Marketing', parent: 'Go-To-Market', kind: 'department', manager: 'Aria Kim', headcount: 6 },
  ],
});

/**
 * The REAL org tree — `sys_business_unit` rows (platform identity object),
 * distinct from the `showcase_business_unit` DEMO object above (which only
 * feeds the `tree` view). This tree is what the ADR-0090 permission model
 * actually evaluates against:
 *   • depth grants (`readScope: 'unit' / 'unit_and_below'`) resolve membership
 *     through it (Setup → Access Control → Business Units, org-chart view);
 *   • the `share_new_inquiries_with_field_ops` sharing rule expands the
 *     `bu_field_ops` SUBTREE (Field Operations + West/East Coast);
 *   • the `showcase_field_ops_delegate` adminScope is bounded by it.
 *
 * Seeded with EXPLICIT ids so metadata can reference units statically (the
 * sharing-rule recipient wants the row id; the adminScope wants the `name`).
 * The tree is normally environment-owned admin data — seeding it here plays
 * the admin's part so the permission demos work on a fresh boot. Users can't
 * be seeded (they sign up), so user↔unit membership (`sys_business_unit_member`)
 * and position assignments stay runtime admin actions.
 */
const orgUnits = SeedSchema.parse({
  object: 'sys_business_unit',
  mode: 'upsert',
  externalId: 'id',
  records: [
    { id: 'bu_acme', name: 'Acme Corporation', code: 'ACME', kind: 'company', active: true },
    { id: 'bu_field_ops', name: 'Field Operations', code: 'FOPS', kind: 'division', parent_business_unit_id: 'bu_acme', active: true },
    { id: 'bu_west_coast', name: 'West Coast', code: 'FOPS-W', kind: 'office', parent_business_unit_id: 'bu_field_ops', active: true },
    { id: 'bu_east_coast', name: 'East Coast', code: 'FOPS-E', kind: 'office', parent_business_unit_id: 'bu_field_ops', active: true },
    { id: 'bu_hq_finance', name: 'HQ Finance', code: 'FIN', kind: 'department', parent_business_unit_id: 'bu_acme', active: true },
  ],
});

// [#2926 ②] Position ↔ permission-set bindings are NOT seeded here: the seed
// loader runs before the security bootstrap creates the sys_position /
// sys_permission_set rows, so the required name references cannot resolve.
// They are ensured imperatively on kernel:bootstrapped instead (after every
// kernel:ready handler, incl. the security bootstrap, has settled) — see
// `src/security/bind-position-sets.ts` (wired via `onEnable`).

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

// A junction row has no single natural key — the (team, project) PAIR is what's
// unique — so `mode: 'insert'` re-inserted all three rows on every replay boot,
// duplicating the table 3 → 6 → 9 (framework#3434). A COMPOSITE externalId over
// the two foreign keys lets `ignore` mode dedupe on replay: team/project are
// matched by their resolved ids, which stay stable across restarts.
const memberships = defineSeed(ProjectMembership, {
  mode: 'ignore',
  externalId: ['team', 'project'],
  records: [
    { team: 'Experience', project: 'Website Relaunch', engagement: 'owner', allocation_percent: 80 },
    { team: 'Platform', project: 'Data Platform', engagement: 'owner', allocation_percent: 100 },
    { team: 'Platform', project: 'Website Relaunch', engagement: 'contributor', allocation_percent: 20 },
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
    { name: 'INV-1001', account: 'Northwind', owner: 'ada@example.com', status: 'sent', issued_on: cel`daysAgo(10)`, tax_rate: 8, region: 'amer' },
    { name: 'INV-1002', account: 'Contoso', owner: 'ada@example.com', status: 'draft', tax_rate: 0, region: 'amer' },
    { name: 'INV-1003', account: 'Contoso', owner: 'linus@example.com', status: 'paid', issued_on: cel`daysAgo(30)`, paid_on: cel`daysAgo(2)`, tax_rate: 8, region: 'amer' },
    { name: 'INV-1004', account: 'Fabrikam', owner: 'grace@example.com', status: 'draft', tax_rate: 0, region: 'emea' },
    // Volume spread across months + regions so the Revenue Pulse filtered
    // dashboard (framework#2501) shows visible movement when the date range
    // or region filter changes — not just one bar. `issued_on` spans ~6
    // months; regions cover AMER / EMEA / APAC.
    { name: 'INV-1005', account: 'Contoso', owner: 'ada@example.com', status: 'paid', issued_on: cel`daysAgo(45)`, paid_on: cel`daysAgo(40)`, tax_rate: 8, region: 'amer' },
    { name: 'INV-1006', account: 'Globex', owner: 'linus@example.com', status: 'sent', issued_on: cel`daysAgo(15)`, tax_rate: 8, region: 'amer' },
    { name: 'INV-1007', account: '华宁科技', owner: 'grace@example.com', status: 'paid', issued_on: cel`daysAgo(60)`, paid_on: cel`daysAgo(50)`, tax_rate: 6, region: 'apac' },
    { name: 'INV-1008', account: '华宁科技', owner: 'ada@example.com', status: 'sent', issued_on: cel`daysAgo(5)`, tax_rate: 6, region: 'apac' },
    { name: 'INV-1009', account: 'Vandelay Industries', owner: 'linus@example.com', status: 'paid', issued_on: cel`daysAgo(100)`, paid_on: cel`daysAgo(90)`, tax_rate: 20, region: 'emea' },
    { name: 'INV-1010', account: 'Fabrikam', owner: 'grace@example.com', status: 'sent', issued_on: cel`daysAgo(75)`, tax_rate: 20, region: 'emea' },
    { name: 'INV-1011', account: 'Stark Industries', owner: 'ada@example.com', status: 'paid', issued_on: cel`daysAgo(130)`, paid_on: cel`daysAgo(120)`, tax_rate: 8, region: 'amer' },
    { name: 'INV-1012', account: 'Hooli', owner: 'linus@example.com', status: 'sent', issued_on: cel`daysAgo(170)`, tax_rate: 8, region: 'amer' },
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

// Expense reports + lines — the filtered-rollup demo (framework#1868). Line
// amounts, `billable`, and per-line `status` are chosen so the report's SIX
// summaries show visibly DIFFERENT values on first boot: the unfiltered total
// vs the approved-only sum vs the billable-only sum, etc. Drive the interactive
// story in the app by flipping a line's status in the inline grid and watching
// approved_amount / rejected_count move. Merchants are unique → externalId.
const expenseReports = defineSeed(ExpenseReport, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'EXP-2001', employee: 'Ada Lovelace', status: 'submitted', submitted_on: cel`daysAgo(5)` },
    { name: 'EXP-2002', employee: 'Linus Torvalds', status: 'approved', submitted_on: cel`daysAgo(12)` },
    { name: 'EXP-2003', employee: 'Grace Hopper', status: 'draft' },
    // High-value (> $5000) submitted report — the trigger record for the
    // High-Value Committee Quorum (2-of-3) flow, launched on boot by
    // src/security/seed-approval-demo.ts so a real pending request lands in the
    // inbox out of the box.
    { name: 'EXP-DEMO', employee: 'Grace Hopper', status: 'submitted', submitted_on: cel`daysAgo(1)` },
  ],
});

const expenseLines = defineSeed(ExpenseLine, {
  mode: 'upsert',
  externalId: 'merchant',
  records: [
    // EXP-2001 → total 1500.50 · approved 960 · reimbursable 512 · rejected 0 · over$500 2
    { merchant: 'United Airlines', expense_report: 'EXP-2001', category: 'travel', amount: 620, billable: false, status: 'approved', incurred_on: cel`daysAgo(9)` },
    { merchant: 'Marriott Downtown', expense_report: 'EXP-2001', category: 'lodging', amount: 340, billable: false, status: 'approved', incurred_on: cel`daysAgo(8)` },
    { merchant: 'Chipotle', expense_report: 'EXP-2001', category: 'meals', amount: 28.5, billable: false, status: 'submitted', incurred_on: cel`daysAgo(8)` },
    { merchant: 'AWS', expense_report: 'EXP-2001', category: 'software', amount: 512, billable: true, status: 'submitted', incurred_on: cel`daysAgo(7)` },
    // EXP-2002 → total 917 · approved 825 · reimbursable 825 · rejected 1 · over$500 1
    { merchant: 'Delta Air Lines', expense_report: 'EXP-2002', category: 'travel', amount: 780, billable: true, status: 'approved', incurred_on: cel`daysAgo(15)` },
    { merchant: 'Uber', expense_report: 'EXP-2002', category: 'travel', amount: 45, billable: true, status: 'approved', incurred_on: cel`daysAgo(14)` },
    { merchant: 'Staples', expense_report: 'EXP-2002', category: 'supplies', amount: 92, billable: false, status: 'rejected', incurred_on: cel`daysAgo(14)` },
    // EXP-2003 (draft) → total 225.75 · approved 0 · reimbursable 0 · rejected 0 · over$500 0
    { merchant: 'Hilton Garden Inn', expense_report: 'EXP-2003', category: 'lodging', amount: 210, billable: false, status: 'submitted', incurred_on: cel`daysAgo(3)` },
    { merchant: 'Starbucks', expense_report: 'EXP-2003', category: 'meals', amount: 15.75, billable: false, status: 'submitted', incurred_on: cel`daysAgo(2)` },
    // EXP-DEMO → total 8900 (≥ $5000, trips the committee-quorum threshold)
    { merchant: 'Dreamforce Conference', expense_report: 'EXP-DEMO', category: 'other', amount: 3200, billable: true, status: 'submitted', incurred_on: cel`daysAgo(4)` },
    { merchant: 'Lufthansa', expense_report: 'EXP-DEMO', category: 'travel', amount: 2400, billable: true, status: 'submitted', incurred_on: cel`daysAgo(4)` },
    { merchant: 'Grand Hyatt', expense_report: 'EXP-DEMO', category: 'lodging', amount: 1800, billable: true, status: 'submitted', incurred_on: cel`daysAgo(3)` },
    { merchant: 'Apple Store', expense_report: 'EXP-DEMO', category: 'software', amount: 1500, billable: true, status: 'submitted', incurred_on: cel`daysAgo(3)` },
  ],
});

// Inquiries so the staff triage list (inquiry views + Contact Form page)
// renders on first boot — the "every view renders real data" principle. One
// per status; the `closed` row doubles as live prey for InquiryPurgeFlow.
const inquiries = defineSeed(Inquiry, {
  mode: 'upsert',
  externalId: 'email',
  records: [
    { name: 'Priya Raman', email: 'priya@meridian.example', company: 'Meridian Labs', message: 'Interested in the delivery workspace for a 40-person team.', status: 'new', source: 'website' },
    { name: 'Tom Okafor', email: 'tom@brightline.example', company: 'Brightline Co', message: 'Following up on the demo — can we scope an invoicing pilot?', status: 'contacted', source: 'referral' },
    { name: 'Lena Fischer', email: 'lena@oldrequest.example', company: 'Archived GmbH', message: 'Old request, already resolved by support.', status: 'closed', source: 'website' },
  ],
});

const preferences = defineSeed(Preference, {
  mode: 'upsert',
  externalId: 'name',
  records: [
    { name: 'My Preferences', theme: 'light', default_landing: 'my_work', email_digest: 'daily', items_per_page: 50, notifications_enabled: true, compact_density: false },
  ],
});

/**
 * [#2926 ⑤] Announcements — the read-visibility demo object finally ships
 * with data, so its assertions stop dry-running on a fresh DB. The object has
 * NO `name` field (display name derives from `title`); `owner_id` stays
 * unset — users can't be seeded, and creation rights are deliberately narrow
 * (only `showcase_ops` may create; everyone else is read-only by design).
 */
const announcements = defineSeed(Announcement, {
  mode: 'upsert',
  externalId: 'title',
  records: [
    { title: 'Welcome to the Showcase workspace', body: 'This demo org exercises the full permission model: positions, permission sets, sharing rules and field-level security. Log in as different personas to compare what each can see and edit.' },
    { title: 'Q3 field-ops rollout', body: 'Field Operations onboards the new inquiry intake flow this quarter. New public inquiries are shared automatically with the Field Ops subtree.' },
  ],
});

export const ShowcaseSeedData = [accounts, contacts, inquiries, products, projects, tasks, categories, businessUnits, orgUnits, teams, memberships, fieldZoo, invoices, invoiceLines, expenseReports, expenseLines, preferences, announcements];
