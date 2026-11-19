// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform catalog a metadata-app project reads before it builds —
 * `skills/objectstack-project/references/platform-catalog.md`, emitted by
 * `build-skill-references.ts` and verified by `check:skill-refs`.
 *
 * ## Why it exists
 *
 * A suite's agent does not know what the platform already ships, so it builds
 * its own: a free-text unit, an SLA that counts wall-clock hours, a private
 * exchange-rate table. The domain skills teach how to write metadata and never
 * list what exists; the MCP `list_objects` tool hides system objects by
 * default, so "look it up at runtime" finds none of them. This page is the one
 * place that answers "does the platform own this?" — and it is GENERATED, so
 * it cannot name an object, a value domain or a capability token that the
 * contract package does not declare.
 *
 * ## What is generated and what is written by hand
 *
 * The NAMES come from the contract package, never from this file:
 *
 *   - object names from `PLATFORM_OBJECTS_BY_PACKAGE` / `PLATFORM_PROVIDED_OBJECT_NAMES`
 *     (`src/system/constants/platform-object-names.ts`), the owning package and
 *     the `requires` token that mounts it from `PLATFORM_CAPABILITY_PROVIDERS`;
 *   - value domains from `ValueDomainSchema` and the field names that should
 *     declare one from `VALUE_DOMAIN_FIELD_NAMES` (`src/shared/value-domain.zod.ts`);
 *   - capability tokens from `PLATFORM_CAPABILITY_TOKENS`, their provider
 *     package, edition and always-on status from `src/kernel/platform-capabilities.ts`.
 *
 * What is hand-written here is the APP-FACING SUBSET and the two prose
 * columns: "what you would otherwise build" and "how the app reaches it". The
 * subset is a list in this file, OUTSIDE `packages/spec/src/**` — the registry
 * gains no app-facing marker, and `platform-catalog.test.ts` pins that no row
 * names an object the registry does not hold, that every row carries both
 * columns, and that the capability and value-domain tables are exhaustive over
 * their registries. A row is refused by {@link catalogProblems} before anything
 * is emitted, so a typo cannot ship as a row.
 *
 * ## Two sections that are not platform objects
 *
 * "Not owned by the platform" lists party and item master data: each suite
 * owns its own, matched by key contract (the maintainer's ruling on the
 * shared-master-data decision). Without that section "check the platform
 * first" reads as "wait for the platform".
 *
 * "Planned" lists a concept the platform has carded but not shipped, each
 * marked **not available** with a link to its contract. A planned row never
 * reads as usable (ADR-0049); the PR that ships the capability moves the row
 * into the main table. The section is capped: a few rows, not a roadmap.
 */

import { PLATFORM_OBJECTS_BY_PACKAGE, PLATFORM_PROVIDED_OBJECT_NAMES } from '../../src/system/constants/platform-object-names';
import { VALUE_DOMAIN_FIELD_NAMES, ValueDomainSchema, type ValueDomain } from '../../src/shared/value-domain.zod';
import {
  PLATFORM_ALWAYS_ON_CAPABILITIES,
  PLATFORM_CAPABILITY_PROVIDERS,
  PLATFORM_CAPABILITY_TOKENS,
} from '../../src/kernel/platform-capabilities';

/** The repo-relative path of the emitted page — the one spelling the generator and the gates share. */
export const PLATFORM_CATALOG_PATH = 'skills/objectstack-project/references/platform-catalog.md';

/** One app-facing platform object: the name is checked against the registry, the two columns are prose. */
export interface AppFacingObjectRow {
  /** A member of `PLATFORM_PROVIDED_OBJECT_NAMES`. */
  readonly name: string;
  /** What an app would build if it did not know the platform ships this. */
  readonly builds: string;
  /** How the app reaches it: the metadata key, the door or the API. */
  readonly reach: string;
}

/**
 * The app-facing subset, grouped by the question an author asks. Every name
 * must be registered in `platform-object-names.ts`; the test refuses a row
 * that is not. Infrastructure objects (OAuth, SCIM, JWKS, migrations, metadata
 * storage) are deliberately absent — nothing an app would otherwise build.
 *
 * The `reach` column names the door as measured on each object's own
 * definition: `data API` means the object's `enable.apiMethods` (or its
 * absence, which is unrestricted) admits the generic `/api/v1/data/<object>`
 * routes; `read` means `get` and `list` only.
 */
export const APP_FACING_OBJECT_GROUPS: readonly { readonly title: string; readonly rows: readonly AppFacingObjectRow[] }[] = [
  {
    title: 'People and organizations',
    rows: [
      { name: 'sys_user', builds: 'a users or employees table', reach: '`user` fields (`owner_id`, assignees, approvers) reference it; data API read and update' },
      { name: 'sys_organization', builds: 'a tenant or company-settings object', reach: 'every row carries `organization_id`; data API read and update' },
      { name: 'sys_business_unit', builds: 'a department or org-chart tree', reach: 'the app seeds its rows; hierarchy scopes read it; data API' },
      { name: 'sys_team', builds: 'a teams or groups table', reach: 'approvers and sharing recipients name a team; data API read' },
      { name: 'sys_user_position', builds: 'a user-to-role assignment table', reach: 'positions the app\'s permission sets grant; data API' },
    ],
  },
  {
    title: 'Files, comments and history',
    rows: [
      { name: 'sys_file', builds: 'a file-storage table', reach: '`file` and `image` fields store its rows; uploads go through `/api/v1/storage`' },
      { name: 'sys_attachment', builds: 'an attachments table per object', reach: '`enable.files: true` on the object opens the Attachments panel; data API' },
      { name: 'sys_comment', builds: 'a comments or notes table', reach: '`enable.feeds` (default on) gives every object a discussion thread; data API' },
      { name: 'sys_activity', builds: 'a record timeline or history table', reach: '`enable.activities` (default on) mirrors every write; data API read' },
      { name: 'sys_audit_log', builds: 'a change-log or audit table', reach: 'written on every write; data API read, `view_all_audit_log` for rows the caller cannot open' },
      { name: 'sys_recycle_bin', builds: 'an `is_deleted` flag with a restore', reach: 'a by-id delete lands here; `POST /api/v1/data/OBJECT/recycle-bin/ENTRY/restore`; no data API' },
    ],
  },
  {
    title: 'Notifications and mail',
    rows: [
      { name: 'sys_notification', builds: 'a notifications table', reach: 'the flow `notify` node, `@mention` and assignment emit rows; data API read' },
      { name: 'sys_inbox_message', builds: 'a per-user inbox with read state', reach: 'the in-app delivery of a notification; the Console bell reads it; data API read' },
      { name: 'sys_email', builds: 'an outbound-mail log', reach: 'every email sent is logged here; templates are `emailTemplates` on the stack; data API read' },
      { name: 'sys_mailbox', builds: 'an inbound-mail setup table', reach: 'Setup declares mailboxes; data API read' },
      { name: 'sys_mail_message', builds: 'an inbound-mail mirror', reach: '`mailAssociation: true` on an email field links messages to records; data API read' },
    ],
  },
  {
    title: 'Money, imports and approvals',
    rows: [
      { name: 'sys_exchange_rate', builds: 'an exchange-rate table', reach: '`currencyConfig.homeAmount` converts at write; Setup edits rates; data API' },
      { name: 'sys_import_job', builds: 'a bulk-import job table', reach: '`POST /api/v1/data/OBJECT/import/jobs`; data API read' },
      { name: 'sys_approval_request', builds: 'an approvals table', reach: 'a flow approval node opens it; `/api/v1/approvals` routes decide; data API read' },
      { name: 'sys_approval_action', builds: 'an approval decision trail', reach: 'written per decision; data API read' },
      { name: 'sys_approval_delegation', builds: 'an out-of-office delegate table', reach: 'users author their own rows; data API' },
    ],
  },
  {
    title: 'Sharing, ownership and routing',
    rows: [
      { name: 'sys_record_share', builds: 'a shared-with junction per record', reach: '`sharingModel: \'private\'` plus the share action; data API read' },
      { name: 'sys_share_link', builds: 'public links by token', reach: 'the share-link service; data API read' },
      { name: 'sys_sharing_rule', builds: 'criteria-based sharing', reach: '`sharingRules` on the stack; an organization authors rows in Setup' },
      { name: 'sys_queue', builds: 'a work-queue or unassigned-pool table', reach: '`queues` on the stack; every `ownership: \'user\'` object has a `queue` column' },
      { name: 'sys_queue_member', builds: 'a queue-membership table', reach: 'an organization adds people to its queues here; data API' },
      { name: 'sys_assignment_rule', builds: 'a routing-rule table', reach: '`assignmentRules` on the stack; an organization authors rows in Setup' },
    ],
  },
  {
    title: 'Integration and settings',
    rows: [
      { name: 'sys_webhook', builds: 'an outbound-webhook table', reach: '`webhooks` on the stack; data API' },
      { name: 'sys_setting', builds: 'a key-value settings table', reach: 'declare a settings manifest (objectstack-platform); data API read' },
      { name: 'sys_personal_view', builds: 'a saved-filters table', reach: 'the Console saves a user\'s own list views here; data API' },
    ],
  },
];

/** Prose per value domain: what a hand-rolled field gets wrong. Keyed over the vocabulary, so a member added without a line fails to compile. */
export const VALUE_DOMAIN_ROWS: Readonly<Record<ValueDomain, { readonly builds: string; readonly example: string }>> = Object.freeze({
  iana_time_zone: { builds: 'a free-text or picklist time zone', example: '`Asia/Shanghai`' },
  iso_4217_currency: { builds: 'a free-text currency code', example: '`USD`' },
  iso_3166_alpha2: { builds: 'a free-text or picklist country', example: '`CN`' },
});

/** One line per `requires` token: what the switch mounts. The test pins this exhaustive over `PLATFORM_CAPABILITY_TOKENS`. */
export const CAPABILITY_ROWS: Readonly<Record<string, string>> = Object.freeze({
  ai: 'agents, tools and the AI runtime',
  'ai-studio': 'AI authoring in Studio',
  i18n: 'translations and locale resolution',
  ui: 'the Console',
  auth: 'sign-in, sessions, SSO, API keys',
  automation: 'flows, triggers, connectors',
  analytics: 'datasets, dashboards, reports',
  audit: 'the audit ledger, activity timeline, comments',
  cache: 'the cache service',
  storage: 'file storage, attachments',
  queue: 'the queue service',
  job: 'scheduled and background jobs',
  messaging: 'notification delivery, the inbox',
  triggers: 'record-change triggers',
  realtime: 'presence and live updates',
  mcp: 'the MCP server',
  marketplace: 'the package catalogue',
  'package-registry': 'installed-package persistence',
  email: 'outbound mail and templates',
  mailbox: 'inbound mail mirroring',
  sms: 'outbound SMS',
  push: 'mobile push',
  sharing: 'record shares, share links, queues, assignment rules',
  'pinyin-search': 'pinyin search for Chinese text',
  approvals: 'approval nodes and requests',
  settings: 'the settings store',
  webhooks: 'outbound webhooks',
  'hierarchy-security': 'hierarchy-relative permission scopes',
  'ai-seat': 'the cloud AI-seat tier',
  governance: 'the cloud governance tier',
  'audit-compliance': 'the cloud audit-compliance tier',
  'access-policy-console': 'the cloud access-policy console',
});

/** Master data each suite keeps, matched across suites by key contract. */
export const NOT_PLATFORM_ROWS: readonly { readonly concept: string; readonly rule: string }[] = [
  { concept: 'Party master data: customers, suppliers, contacts', rule: 'one app owns each entity; another app matches its records by the key contract (tax id, email), one way, with no platform party object' },
  { concept: 'Item master data: materials, products, plants', rule: 'the owning app\'s object is reused by key; the platform ships no item object' },
];

/** Carded, not shipped. Each row is **not available**; the shipping PR moves it into the main table. Capped at a few rows. */
export const PLANNED_ROWS: readonly { readonly concept: string; readonly state: string; readonly link: string }[] = [
  {
    concept: 'Units of measure (a standard unit table, organization units, a quantity field with its unit)',
    state: 'contract accepted, nothing shipped',
    link: 'https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0158-units-of-measure-standard-unit-table-org-units-quantity-unit-declaration-base-quantity.md',
  },
  {
    concept: 'Working calendars (business days, holidays, SLA clocks)',
    state: 'carded, contract in design',
    link: 'https://github.com/objectstack-ai/objectstack/issues/35340',
  },
];

// ── Guards ───────────────────────────────────────────────────────────────────

/** Same shape as `check-doc-authoring.mjs`'s internal id: `#` and three to five digits. A planned row links by URL, never by a bare id. */
const INTERNAL_ISSUE_ID = /(?<![#&])#[0-9]{3,5}(?![0-9A-Za-z])/;

/**
 * Every problem in the hand-written lists, or `[]`. Asked by the generator
 * before anything is emitted and by the test over fabricated inputs, so the
 * refusal is pinned in both directions.
 */
export function catalogProblems(input: {
  groups?: typeof APP_FACING_OBJECT_GROUPS;
  capabilityRows?: Readonly<Record<string, string>>;
  valueDomainRows?: Readonly<Record<string, { builds: string; example: string }>>;
  plannedRows?: typeof PLANNED_ROWS;
  registry?: ReadonlySet<string>;
  tokens?: readonly string[];
  domains?: readonly string[];
} = {}): string[] {
  const groups = input.groups ?? APP_FACING_OBJECT_GROUPS;
  const capabilityRows = input.capabilityRows ?? CAPABILITY_ROWS;
  const valueDomainRows = input.valueDomainRows ?? VALUE_DOMAIN_ROWS;
  const plannedRows = input.plannedRows ?? PLANNED_ROWS;
  const registry = input.registry ?? PLATFORM_PROVIDED_OBJECT_NAMES;
  const tokens = input.tokens ?? PLATFORM_CAPABILITY_TOKENS;
  const domains = input.domains ?? ValueDomainSchema.options;
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const group of groups) {
    if (group.rows.length === 0) problems.push(`group "${group.title}" has no rows`);
    for (const row of group.rows) {
      if (!registry.has(row.name)) problems.push(`${row.name}: not in PLATFORM_PROVIDED_OBJECT_NAMES (a row cannot name an object the registry does not hold)`);
      if (seen.has(row.name)) problems.push(`${row.name}: listed twice`);
      seen.add(row.name);
      if (!row.builds.trim()) problems.push(`${row.name}: empty "what you would otherwise build" column`);
      if (!row.reach.trim()) problems.push(`${row.name}: empty "how the app reaches it" column`);
    }
  }

  const tokenSet = new Set(tokens);
  for (const token of Object.keys(capabilityRows)) {
    if (!tokenSet.has(token)) problems.push(`capability ${token}: not in PLATFORM_CAPABILITY_TOKENS`);
    if (!capabilityRows[token].trim()) problems.push(`capability ${token}: empty description`);
  }
  for (const token of tokens) {
    if (!(token in capabilityRows)) problems.push(`capability ${token}: no catalog line (the table is exhaustive over PLATFORM_CAPABILITY_TOKENS)`);
  }

  const domainSet = new Set(domains);
  for (const domain of Object.keys(valueDomainRows)) {
    if (!domainSet.has(domain)) problems.push(`value domain ${domain}: not in ValueDomainSchema`);
  }
  for (const domain of domains) {
    if (!(domain in valueDomainRows)) problems.push(`value domain ${domain}: no catalog line`);
  }

  if (plannedRows.length > 4) problems.push(`planned section has ${plannedRows.length} rows; it is capped at a few (4)`);
  for (const row of plannedRows) {
    if (!/^https:\/\//.test(row.link)) problems.push(`planned "${row.concept}": the link must be an absolute URL`);
    if (INTERNAL_ISSUE_ID.test(`${row.concept} ${row.state}`)) problems.push(`planned "${row.concept}": carries a bare internal issue id; link by URL`);
    if (/\b(available|shipped|ready)\b/i.test(row.state) && !/not available|nothing shipped/i.test(row.state)) {
      problems.push(`planned "${row.concept}": its state reads as usable`);
    }
  }
  return problems;
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** The owning package of a registered object, from `PLATFORM_OBJECTS_BY_PACKAGE`; cloud-provided names have none. */
function owningPackage(name: string): string | null {
  for (const [pkg, names] of Object.entries(PLATFORM_OBJECTS_BY_PACKAGE)) {
    if (names.includes(name)) return pkg;
  }
  return null;
}

/** How a package is mounted: the `requires` token whose provider it is, and whether that token is always on. */
function mountedBy(pkg: string | null): string {
  if (pkg === null) return 'cloud runtime';
  const full = `@objectstack/${pkg}`;
  const token = Object.entries(PLATFORM_CAPABILITY_PROVIDERS).find(([, p]) => p.package === full)?.[0];
  if (token === undefined) return 'every boot';
  if (PLATFORM_ALWAYS_ON_CAPABILITIES.includes(token)) return `every boot (\`${token}\`)`;
  return `\`requires: ['${token}']\``;
}

/** The page, as markdown. Pure: the same bytes under write and `--check`. */
export function renderPlatformCatalog(): string {
  const problems = catalogProblems();
  if (problems.length > 0) {
    throw new Error(`platform catalog refused:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  const lines: string[] = [
    '# What the platform already ships',
    '',
    '> **Auto-generated** — do not edit. Maintainers regenerate this in the',
    '> framework repo with `pnpm --filter @objectstack/spec gen:skill-refs`',
    '> (not runnable in an installed app). Names come from `@objectstack/spec`;',
    '> the prose columns are authored beside the generator.',
    '',
    'Read this before adding an object, a field or a flow (objectstack-project §0,',
    'question 3). If the platform ships it, use it. `list_objects` over MCP hides',
    'system objects, so this page, not the runtime, is where to look.',
    '',
    '## Platform objects an app would otherwise build',
    '',
    '"Data API" means the generic `/api/v1/data/OBJECT` routes, as the object',
    'declares them; "read" means get and list only. A `sys_` object is referenced',
    'by name from the app\'s metadata (a `user` field, an action\'s `objectName`,',
    'a seed) without declaring it.',
    '',
  ];
  for (const group of APP_FACING_OBJECT_GROUPS) {
    lines.push(`### ${group.title}`, '', '| Object | Mounted by | What you would otherwise build | How the app reaches it |', '|:--|:--|:--|:--|');
    for (const row of group.rows) {
      lines.push(`| \`${row.name}\` | ${mountedBy(owningPackage(row.name))} | ${row.builds} | ${row.reach} |`);
    }
    lines.push('');
  }

  lines.push(
    '## Value domains: declare, never hand-roll',
    '',
    'A `text` field whose value is a code from a published standard declares',
    '`valueDomain`; the write path refuses a non-member, and Setup, forms and',
    'filters pick from the standard. A field named as in the second column',
    'without the domain is an `os lint` warning.',
    '',
    '| `valueDomain` | Field names that should declare it | What you would otherwise build | Example |',
    '|:--|:--|:--|:--|',
  );
  for (const domain of ValueDomainSchema.options) {
    const row = VALUE_DOMAIN_ROWS[domain];
    const names = VALUE_DOMAIN_FIELD_NAMES[domain].map((n) => `\`${n}\``).join(', ');
    lines.push(`| \`${domain}\` | ${names} | ${row.builds} | ${row.example} |`);
  }
  lines.push('');

  lines.push(
    '## Capability switches: `requires` on the stack',
    '',
    'Each token mounts a service plugin; a token marked "every boot" is mounted',
    'whether or not the stack lists it. Declare what the app uses instead of',
    'building the service (objectstack-platform teaches the switch).',
    '',
    '| Token | Mounts | Edition | Boot |',
    '|:--|:--|:--|:--|',
  );
  for (const token of PLATFORM_CAPABILITY_TOKENS) {
    const provider = PLATFORM_CAPABILITY_PROVIDERS[token];
    const boot = PLATFORM_ALWAYS_ON_CAPABILITIES.includes(token) ? 'every boot' : 'on `requires`';
    lines.push(`| \`${token}\` | ${CAPABILITY_ROWS[token]} | ${provider?.edition ?? 'unknown'} | ${boot} |`);
  }
  lines.push('');

  lines.push(
    '## Not owned by the platform',
    '',
    'These stay in each app. "Check the platform first" never means "wait for the',
    'platform" here.',
    '',
    '| Concept | Rule |',
    '|:--|:--|',
  );
  for (const row of NOT_PLATFORM_ROWS) lines.push(`| ${row.concept} | ${row.rule} |`);
  lines.push('');

  lines.push(
    '## Planned: carded, not shipped',
    '',
    'Each row is **not available**: nothing below can be declared or installed',
    'today. The app may build its own meanwhile, marked `// PLATFORM-CANDIDATE:`',
    'with the link (objectstack-project §0, question 3). The PR that ships a row',
    'moves it into the tables above.',
    '',
    '| Concept | State | Contract |',
    '|:--|:--|:--|',
  );
  for (const row of PLANNED_ROWS) lines.push(`| ${row.concept} | **not available** (${row.state}) | ${row.link} |`);
  lines.push('');
  return lines.join('\n');
}
