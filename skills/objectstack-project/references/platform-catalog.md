# What the platform already ships

> **Auto-generated** — do not edit. Regenerate in the framework repo with
> `pnpm --filter @objectstack/spec gen:skill-refs`
> (not runnable in an installed app). Names come from `@objectstack/spec`.

Read this before adding an object, a field or a flow. `list_objects` over MCP
hides system objects, so look here.

## Platform objects an app would otherwise build

"Data API" means the generic `/api/v1/data/OBJECT` routes, as the object
declares them; "read" means get and list only. A `sys_` object is referenced
by name from the app's metadata (a `user` field, an action's `objectName`,
a seed) without declaring it.

### People and organizations

| Object | Mounted by | What you would otherwise build | How the app reaches it |
|:--|:--|:--|:--|
| `sys_user` | every boot | a users or employees table | `user` fields (`owner_id`, assignees, approvers) reference it; data API read and update |
| `sys_organization` | every boot | a tenant or company-settings object | every row carries `organization_id`; data API read and update |
| `sys_business_unit` | every boot | a department or org-chart tree | the app seeds its rows; hierarchy scopes read it; data API |
| `sys_team` | every boot | a teams or groups table | approvers and sharing recipients name a team; data API read |
| `sys_user_position` | every boot | a user-to-position assignment table | positions that distribute the app's permission sets; data API |

### Files, comments and history

| Object | Mounted by | What you would otherwise build | How the app reaches it |
|:--|:--|:--|:--|
| `sys_file` | every boot (`storage`) | a file-storage table | `file` and `image` fields store its rows; uploads go through `/api/v1/storage` |
| `sys_attachment` | every boot | an attachments table per object | `enable.files: true` on the object opens the Attachments panel; data API |
| `sys_comment` | `requires: ['audit']` | a comments or notes table | `enable.feeds` (default on) gives every object a discussion thread; data API |
| `sys_activity` | `requires: ['audit']` | a record timeline or history table | `enable.activities` (default on) mirrors every write; data API read |
| `sys_audit_log` | `requires: ['audit']` | a change-log or audit table | written on every write; data API read, `view_all_audit_log` for rows the caller cannot open |
| `sys_recycle_bin` | every boot | an `is_deleted` flag with a restore | a by-id delete lands here; `POST /api/v1/data/OBJECT/recycle-bin/ENTRY/restore`; no data API |

### Notifications and mail

| Object | Mounted by | What you would otherwise build | How the app reaches it |
|:--|:--|:--|:--|
| `sys_notification` | every boot | a notifications table | the flow `notify` node, `@mention` and assignment emit rows; data API read |
| `sys_inbox_message` | every boot (`messaging`) | a per-user inbox with read state | the in-app delivery of a notification; the Console bell reads it; data API read |
| `sys_email` | every boot | an outbound-mail log | every email sent is logged here; templates are `emailTemplates` on the stack; data API read |
| `sys_mailbox` | `requires: ['mailbox']` | an inbound-mailbox table | engine-owned; data API read for `manage_mailboxes` holders. `requires: ['mailbox']` mounts the objects and the ingest seam and syncs nothing: rows exist only where the host composes the mailbox service with an IMAP account source (no Setup entry) |
| `sys_mail_message` | `requires: ['mailbox']` | an inbound-mail mirror | rows arrive only from the host's IMAP sync (the `sys_mailbox` row); `mailAssociation: true` on an email field links messages to records; data API read |

### Money, imports and approvals

| Object | Mounted by | What you would otherwise build | How the app reaches it |
|:--|:--|:--|:--|
| `sys_exchange_rate` | every boot | an exchange-rate table | `currencyConfig.homeAmount` converts at write; Setup edits rates; data API |
| `sys_unit` | every boot | a unit table or picklist | `unitConfig` on a `number` field (`unitMode: 'fixed'` with `unit`, `'record'` with `unitField`) or a `text` field (`'code'`); a stored code is standard (UN/ECE Rec 20: `KGM`, `H87`) or a row added here in Setup; data API, no delete |
| `sys_work_calendar` | every boot | a business-hours calendar | kept per organization in Setup; an approval's `escalation.clock: 'working_time'` reads it; data API |
| `sys_work_calendar_exception` | every boot | a holiday table | a calendar's holidays and make-up workdays, kept in Setup; data API |
| `sys_import_job` | every boot | a bulk-import job table | `POST /api/v1/data/OBJECT/import/jobs`; data API read |
| `sys_approval_request` | `requires: ['approvals']` | an approvals table | a flow approval node opens it; `/api/v1/approvals` routes decide; data API read |
| `sys_approval_action` | `requires: ['approvals']` | an approval decision trail | written per decision; data API read |
| `sys_approval_delegation` | `requires: ['approvals']` | an out-of-office delegate table | users author their own rows; data API |

### Sharing, ownership and routing

| Object | Mounted by | What you would otherwise build | How the app reaches it |
|:--|:--|:--|:--|
| `sys_record_share` | every boot (`sharing`) | a shared-with junction per record | `sharingModel: 'private'` plus the share action; data API read |
| `sys_share_link` | every boot (`sharing`) | public links by token | the share-link service; data API read |
| `sys_sharing_rule` | every boot (`sharing`) | criteria-based sharing | `sharingRules` on the stack; an organization authors rows in Setup |
| `sys_queue` | every boot (`sharing`) | a work-queue or unassigned-pool table | `queues` on the stack; every `ownership: 'user'` object has a `queue` column |
| `sys_queue_member` | every boot (`sharing`) | a queue-membership table | an organization adds people to its queues here; data API |
| `sys_assignment_rule` | every boot (`sharing`) | a routing-rule table | `assignmentRules` on the stack; an organization authors rows in Setup |

### Integration and settings

| Object | Mounted by | What you would otherwise build | How the app reaches it |
|:--|:--|:--|:--|
| `sys_webhook` | `requires: ['webhooks']` | an outbound-webhook table | `webhooks` on the stack; data API |
| `sys_setting` | every boot | a key-value settings table | declare a settings manifest (objectstack-platform); data API read |
| `sys_personal_view` | every boot | a saved-filters table | the Console saves a user's own list views here; data API |

## Value domains: declare, never hand-roll

A `text` field whose value is a code from a published standard declares
`valueDomain`: the write path refuses a non-member. Forms pick the currency
code from ISO 4217; a time zone or a country is typed into a plain text
input, and no list or filter reads the domain. A field named as in the
second column without the domain is an `os lint` warning.

| `valueDomain` | Field names that should declare it | What you would otherwise build | Example |
|:--|:--|:--|:--|
| `iana_time_zone` | `time_zone`, `timezone`, `tz` | a free-text or picklist time zone | `Asia/Shanghai` |
| `iso_4217_currency` | `currency`, `currency_code` | a free-text currency code | `USD` |
| `iso_3166_alpha2` | `country`, `country_code` | a free-text or picklist country | `CN` |

## Capability switches: `requires` on the stack

Each token mounts a service plugin; a token marked "every boot" is mounted
whether or not the stack lists it. Declare what the app uses
(objectstack-platform teaches the switch).

| Token | Mounts | Edition | Boot |
|:--|:--|:--|:--|
| `ai` | agents, tools and the AI runtime | cloud | on `requires` |
| `ai-studio` | AI authoring in Studio | cloud | on `requires` |
| `i18n` | translations and locale resolution | open | on `requires` |
| `ui` | the Console | open | on `requires` |
| `auth` | sign-in, sessions, SSO, API keys | open | on `requires` |
| `automation` | flows, triggers, connectors | open | on `requires` |
| `analytics` | datasets, dashboards, reports | open | every boot |
| `audit` | the audit ledger, activity timeline, comments | open | on `requires` |
| `cache` | the cache service | open | every boot |
| `storage` | file storage, attachments | open | every boot |
| `queue` | the queue service | open | every boot |
| `job` | scheduled and background jobs | open | every boot |
| `messaging` | notification delivery, the inbox | open | every boot |
| `triggers` | record-change triggers | open | on `requires` |
| `realtime` | presence and live updates | open | on `requires` |
| `mcp` | the MCP server | open | on `requires` |
| `marketplace` | the package catalogue | open | on `requires` |
| `package-registry` | installed-package persistence | open | every boot |
| `email` | outbound mail and templates | open | every boot |
| `mailbox` | inbound mail mirroring | open | on `requires` |
| `sms` | outbound SMS | open | every boot |
| `push` | mobile push | open | on `requires` |
| `sharing` | record shares, share links, queues, assignment rules | open | every boot |
| `pinyin-search` | pinyin search for Chinese text | open | on `requires` |
| `approvals` | approval nodes and requests | open | on `requires` |
| `settings` | the settings store | open | every boot |
| `webhooks` | outbound webhooks | open | on `requires` |
| `hierarchy-security` | hierarchy-relative permission scopes | enterprise | on `requires` |
| `ai-seat` | the AI-seat tier | cloud | on `requires` |
| `governance` | the governance tier | cloud | on `requires` |
| `audit-compliance` | the audit-compliance tier | cloud | on `requires` |
| `access-policy-console` | the access-policy console | cloud | on `requires` |

## Not owned by the platform

These stay in each app. "Check the platform first" never means "wait for the
platform" here.

| Concept | Rule |
|:--|:--|
| Party master data: customers, suppliers, contacts | one app owns each entity; another app matches its records by the key contract (country plus credit code or registration number), one way |
| Item master data: materials, products, plants | the owning app's object is reused by key (material number, plant code) |

## Planned: carded, not shipped

Nothing below can be declared or installed. The app may build its own
meanwhile, marked `// PLATFORM-CANDIDATE:` with the link.

| Concept | State | Contract |
|:--|:--|:--|
| Unit display, totals and conversion | **not available** (contract accepted; a quantity shows and sums as a bare number) | https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0158-units-of-measure-standard-unit-table-org-units-quantity-unit-declaration-base-quantity.md |
| Working-day formulas | **not available** (contract accepted; no formula reads a calendar yet) | https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0157-working-calendars-are-org-editable-runtime-data-resolved-by-code-or-refused.md |
