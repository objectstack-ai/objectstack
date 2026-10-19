// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 inventory — one fate, with its citation, for every object
 * the v18 organization-ownership ceremony has to account for.
 *
 * `os migrate organization-ownership` (the ceremony's read-only plan, D10
 * ceremony item 1) reads this table; C7b's apply and post-check will read the
 * same table. It is DATA, not a census: the census
 * (`scripts/platform-object-tenancy-census.json`) answers which objects the
 * tenancy machinery reaches today, and this answers what happens to each one's
 * existing rows at the upgrade. `organization-ownership-inventory.test.ts`
 * holds the two together — an object in either census without a row here
 * reds that pin, by name.
 *
 * ## The populations it covers
 *
 *  - `platform-census-2026-08-31` — the 84 platform objects of the first
 *    #13564 census (59 carrying the column, 25 not), measured at
 *    `00d8f6541b`. Three of them have since left the tree
 *    (`sys_view_definition`, `sys_saved_report`, `sys_report_schedule`); their
 *    physical tables can still exist on an upgraded database, so they keep a
 *    row.
 *  - `platform-census-main` — objects the gated census on `main` lists and
 *    the first census did not (`sys_comment_reaction`, `sys_flow_credential`,
 *    `sys_platform_setting`).
 *  - `retired-before-census` — platform objects retired from the tree before
 *    the first census was measured, so neither census counted them, whose
 *    physical tables a database that booted an earlier release still holds,
 *    `organization_id` included (`sys_scim_provider`, whose ADR-0087 entry
 *    leaves the table in place untouched). Without a row the plan would
 *    refuse every such database as carrying an uninventoried platform table.
 *    Each row is listed with fate 4 and cites the retirement's ADR-0087 entry.
 *  - `example-census-2026-08-31` — the non-platform objects the same census
 *    counted as "28" (it counted the 28 FILES; they declare 33 objects, the
 *    same 33 on `main` today).
 *  - `cloud-supplement` — cloud-declared objects. The 2026-09-03 cloud-side
 *    supplement is not readable from this repository, so the rows are the
 *    names this repository records as cloud-provided
 *    (`CLOUD_PROVIDED_OBJECT_NAMES`). Cloud's tenant databases run this
 *    ceremony (cloud ruling record 6146394952, A), and a cloud-provided
 *    object's fate is the host's to declare: each row carries fate 4,
 *    `cloudCarried`, never a guessed fate, until a host fate supplement
 *    replaces it (C10).
 *  - `host-supplement` — rows a host declares for the objects it provides,
 *    read from the file `os migrate organization-ownership --fate-supplement`
 *    names ({@link readHostFateSupplement}). They join this table on the same
 *    terms as the platform's rows; the row shape is the spec's
 *    `OrganizationOwnershipSupplementEntrySchema` (`@objectstack/spec/system`).
 *
 * Any other table carrying `organization_id` that a deployment holds is an
 * application object (a customer's own app): {@link APPLICATION_OBJECT_FATE}
 * covers it, the way the 33 example objects are covered. A platform-prefixed
 * table carrying the column with no row here is a gap, and the plan refuses it
 * by name rather than inventing a fate.
 *
 * ## The four fates (ADR-0131 D10), as this table spells them
 *
 *  1. `column-drop` — the object ends with no `organization_id` column (D1/D7).
 *     Already true for an object that never carried one; the plan reads the
 *     physical table to tell "nothing to drop" from "drop pending".
 *  2. `mirror-deletion` — rows re-derivable from code; deleted only after the
 *     id-to-name rewrite (D4) is verified. {@link InventoryEntry.mirror} says
 *     which rows are mirrors.
 *  3. `attribution` — NULL rows take their organization from a parent anchor
 *     ({@link Anchor}); under `single`, the Default Organization.
 *  4. `report` — rows are listed, never guessed and never deleted.
 *
 * ⛔ Nothing here performs a fate. The ceremony's apply is C7b; this file and
 * the plan that reads it never change a row or a column.
 */

import { readFile } from 'node:fs/promises';
import {
  OrganizationOwnershipFateSchema,
  OrganizationOwnershipSupplementSchema,
  type OrganizationOwnershipAnchor,
  type OrganizationOwnershipCategory,
  type OrganizationOwnershipDeparture,
  type OrganizationOwnershipFate as SpecOrganizationOwnershipFate,
  type OrganizationOwnershipRowCondition,
  type OrganizationOwnershipSupplement,
} from '@objectstack/spec/system';

// ── The row vocabulary, declared once in the spec ────────────────────────────
//
// Every shape a row is built from is the spec's
// (`@objectstack/spec`, `system/fate-supplement.zod.ts`): a host authors its rows against
// that schema, and the platform's rows below are typed by the same
// declarations, so the two cannot drift into two dialects. The top-level row
// keys are the one list kept here (`InventoryEntry` adds what only the platform
// states); `organization-ownership-inventory.test.ts` pins them equal to the
// spec's and parses every platform row through the spec's row schema.

/** The four D10 fates. */
export type OrganizationOwnershipFate = SpecOrganizationOwnershipFate;

export const ORGANIZATION_OWNERSHIP_FATES: readonly OrganizationOwnershipFate[] = OrganizationOwnershipFateSchema.options;

/** Where an inventory row's object was counted. */
export type InventoryCensus =
  | 'platform-census-2026-08-31'
  | 'platform-census-main'
  | 'retired-before-census'
  | 'example-census-2026-08-31'
  | 'cloud-supplement'
  | 'host-supplement';

/** Each arm of `T` with its list-valued fields read-only. */
type ReadonlyLists<T> = T extends unknown ? { [K in keyof T]: T[K] extends ReadonlyArray<infer U> ? readonly U[] : T[K] } : never;

/**
 * One condition on a row. A {@link RowPredicate} ANDs them. Spelled as data,
 * never as SQL text, so the plan binds every value and quotes every column.
 * The spec's arms, with `in` / `notIn` read-only: the platform's rows and the
 * ceremony's own selectors share constant value lists, and a spec-parsed row
 * (mutable lists) is assignable to it unchanged.
 */
export type RowCondition = ReadonlyLists<OrganizationOwnershipRowCondition>;

export type RowPredicate = readonly RowCondition[];

/**
 * Where a NULL row's organization comes from (D10 fate 3). Tried in order;
 * the first that answers wins: `parent` (`childKey` names a row of
 * `parentObject`, whose `organization_id` the row takes), `subject`
 * (`objectColumn` / `idColumn` name ANY record; that record's
 * `organization_id` is the row's), `holder` (rows of `holderObject` point at
 * this row through `holderKey`; when every stamped holder agrees on one
 * organization, the row takes it).
 */
export type Anchor = OrganizationOwnershipAnchor;

/**
 * A named row population the plan counts on a table: rows matching `where`
 * over the whole table, or with `conflictBy` the GROUPS of those rows holding
 * more than one row (or, with `distinct`, more than one distinct value of that
 * column) — the plan reports the group count and the rows in them.
 */
export type InventoryCategory = OrganizationOwnershipCategory;

/**
 * Rows that leave the table by another step of the ceremony before its NOT
 * NULL gate is read: they are neither attributed nor reported. `as` is fate 2
 * for mirrors, `moved` for rows a ceremony step re-homes elsewhere.
 */
export type InventoryDeparture = OrganizationOwnershipDeparture;

export interface InventoryEntry {
  object: string;
  census: readonly InventoryCensus[];
  fate: OrganizationOwnershipFate;
  /** The source of the fate. */
  citation: string;
  /** Fate 3: the anchors, in order. Empty = the Default Organization under `single`, else report. */
  anchors?: readonly Anchor[];
  /** Fate 2: which rows are mirrors. Absent = every row. */
  mirror?: RowPredicate;
  /** Fate 3 / 4: rows that leave the table before the NOT NULL gate. */
  departures?: readonly InventoryDeparture[];
  /**
   * Fate 3 only, platform-only: the NULL rows no anchor names leave the table
   * by the mirror-deletion step instead of being reported — on a table whose
   * runtime writer no longer writes a row it cannot attribute, so such a row
   * is one it would not write today. Classified after the anchors; under
   * `single` the Default Organization takes them first, and none leave. A
   * host declares no deletion, so the spec's supplement row has no such key.
   */
  underivableDeparture?: Omit<InventoryDeparture, 'as' | 'where'>;
  categories?: readonly InventoryCategory[];
  /**
   * Fate 4 only: the column is not the tenancy anchor, so it never receives
   * NOT NULL whatever its rows hold. The reason, in the operator's terms.
   */
  notNullExempt?: string;
  /** Fate 4 only: a cloud-provided object no host fate supplement has declared yet (C10). */
  cloudCarried?: boolean;
  /** Federated from another datasource; the planned database holds no table for it. */
  external?: boolean;
  note?: string;
}

// ── Citations, spelled once ───────────────────────────────────────────────────

const CENSUS_1 = 'census record 5479883784 (2026-08-31, at 00d8f6541b)';
const CENSUS_MAIN = 'scripts/platform-object-tenancy-census.json';
const BETTER_AUTH_NO_COLUMN =
  `${CENSUS_1} and ${CENSUS_MAIN}: managedBy 'better-auth' — better-auth owns the columns and no organization_id is ` +
  'injected (injected-system-columns.ts); ADR-0131 D1: no column, nothing to drop';
const D7 = 'ADR-0131 D7 (deployment-level state has no organization column)';
const D7_PLUMBING = `${D7}: operational plumbing whose rows no writer attributes`;
const METADATA_FAMILY =
  `${D7}, D6; triage record 6068052798 (the metadata family's schema change): declared field removed, systemFields.tenant: false, ` +
  'one column-retired ADR-0087 entry per object';
const C7_FATE_3 = 'ADR-0131 §8 C7, first named fate-3 members (ruled 2026-09-04)';
const D3_ORG_ROWS = 'ADR-0131 D3: an organization\'s own rows carry the authoring organization, NOT NULL';
const D3_CATALOG = 'ADR-0131 D3/D13: the catalog object retires; definitions live in the registry';
const D10_SINGLE = 'ADR-0131 D10 fate 3: under single, the Default Organization; otherwise reported';
const CLOUD =
  'cloud-provided (CLOUD_PROVIDED_OBJECT_NAMES, @objectstack/spec/system); the 2026-09-03 cloud-side supplement is ' +
  'not readable here. Cloud\'s tenant databases run this ceremony (cloud ruling record 6146394952, A), and the fate ' +
  'of an object the host provides is the host\'s to declare: a host fate supplement (--fate-supplement) replaces ' +
  'this row; without one it is listed, never given a guessed fate (C10)';
const EXAMPLE =
  `${CENSUS_1}: non-platform object, column auto-injected, presumptive accidental (no citable writer fact); ` +
  D10_SINGLE;

const P1: readonly InventoryCensus[] = ['platform-census-2026-08-31', 'platform-census-main'];
const P1_ONLY: readonly InventoryCensus[] = ['platform-census-2026-08-31'];
const PMAIN: readonly InventoryCensus[] = ['platform-census-main'];
const RETIRED: readonly InventoryCensus[] = ['retired-before-census'];
const EX: readonly InventoryCensus[] = ['example-census-2026-08-31'];

/** Rows a package or the platform seeded — the D10 fate-2 mirror selector on the catalog objects. */
const SEEDED = [{ column: 'managed_by', in: ['package', 'platform', 'system'] }] satisfies RowPredicate;
const AUTHORED = [{ column: 'managed_by', notIn: ['package', 'platform', 'system'] }] satisfies RowPredicate;

/**
 * The permission sets the security plugin ships (`securityDefaultPermissionSets`,
 * `@objectstack/plugin-security`), by name. `organization-ownership-inventory.test.ts`
 * holds this list equal to the plugin's.
 */
export const SHIPPED_PERMISSION_SET_NAMES: readonly string[] = [
  'admin_full_access', 'organization_admin', 'organization_admin_no_bypass', 'member_default', 'viewer_readonly',
  'mcp_agent_data_read', 'mcp_agent_data_write', 'mcp_agent_restricted',
];

/**
 * The shipped sets an install seeded before the seeder stamped its rows
 * `managed_by: 'platform'` (commit 712e185db, ruled 2026-08-15): the insert
 * omitted the column, so the object's `defaultValue: 'admin'` filled it, and
 * every install created earlier holds the shipped sets as `admin` rows that
 * read as Setup-authored. The ceremony adopts them as the platform seeds they
 * are — re-owned `platform` at the authored conversion, then deleted as mirrors
 * once the grants name them — so the shipped definition stands; an edit an
 * administrator made to one of them in Setup is not carried, and the plan and
 * the apply both warn, naming each row (ADR-0131, amendment 2026-10-16).
 */
export const LEGACY_SHIPPED_SET_SEEDS = [
  { column: 'managed_by', equals: 'admin' },
  { column: 'name', in: [...SHIPPED_PERMISSION_SET_NAMES] },
] satisfies RowPredicate;

/** The `sys_permission_set` category that counts {@link LEGACY_SHIPPED_SET_SEEDS}. */
export const LEGACY_SHIPPED_SET_SEEDS_CATEGORY = 'legacy-shipped-set-seeds';

const parent = (childKey: string, parentObject: string): Anchor => ({ kind: 'parent', childKey, parentObject });
const subject = (objectColumn: string, idColumn: string): Anchor => ({ kind: 'subject', objectColumn, idColumn });

const noColumn = (object: string, citation = BETTER_AUTH_NO_COLUMN): InventoryEntry => ({
  object,
  census: P1,
  fate: 'column-drop',
  citation,
});

const example = (object: string): InventoryEntry => ({ object, census: EX, fate: 'attribution', citation: EXAMPLE, anchors: [] });

const cloud = (object: string): InventoryEntry => ({
  object,
  census: ['cloud-supplement'],
  fate: 'report',
  citation: CLOUD,
  cloudCarried: true,
});

/**
 * The fate of an application object the inventory does not name — a
 * customer's own app, carrying the auto-injected column.
 */
export const APPLICATION_OBJECT_FATE: Omit<InventoryEntry, 'object' | 'census'> = {
  fate: 'attribution',
  citation:
    'application object (not platform-prefixed, not inventoried): the column is auto-injected and no writer fact ' +
    `names an anchor, as for the census's example objects; ${D10_SINGLE}`,
  anchors: [],
};

// ── The inventory ─────────────────────────────────────────────────────────────

export const ORGANIZATION_OWNERSHIP_INVENTORY: readonly InventoryEntry[] = [
  // ── Platform: better-auth tables with no organization column (fate 1, nothing to drop) ──
  ...[
    'sys_account', 'sys_device_code', 'sys_jwks', 'sys_oauth_access_token', 'sys_oauth_application',
    'sys_oauth_client_assertion', 'sys_oauth_client_resource', 'sys_oauth_consent', 'sys_oauth_refresh_token',
    'sys_oauth_resource', 'sys_organization', 'sys_scim_connection_binding', 'sys_scim_group',
    'sys_scim_group_member', 'sys_scim_identity_tombstone', 'sys_scim_projection_grant', 'sys_scim_subject',
    'sys_scim_user', 'sys_session', 'sys_team_member', 'sys_two_factor', 'sys_user', 'sys_verification',
  ].map((name) => noColumn(name)),
  noColumn(
    'sys_api_key',
    `${CENSUS_MAIN}: tenancy.enabled: false and no organization_id field (the row's organization is the ` +
      'active_organization_id stamp, not the tenancy anchor); ADR-0131 D1: no column',
  ),
  {
    object: 'sys_sso_provider',
    census: P1,
    fate: 'report',
    citation:
      `${CENSUS_1}: tenancy.enabled: false on a declared organization_id — better-auth's provider-to-organization ` +
      'relation, not the tenancy anchor (ADR-0066 D2)',
    notNullExempt: 'the column is better-auth\'s provider relation, not the tenancy anchor (tenancy.enabled: false)',
    note: 'A provider bound to no organization is a legitimate better-auth row; listed, never attributed.',
  },

  // ── Platform: better-auth organization-plugin tables that carry the anchor (fate 3) ──
  { object: 'sys_member', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; better-auth writes organizationId on every membership`, anchors: [] },
  { object: 'sys_team', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; better-auth writes organizationId on every team`, anchors: [] },
  {
    object: 'sys_invitation',
    census: P1,
    fate: 'attribution',
    citation: `${D3_ORG_ROWS}; better-auth writes organizationId on every invitation`,
    anchors: [parent('team_id', 'sys_team'), parent('business_unit_id', 'sys_business_unit')],
  },

  // ── Platform: deployment-level state (fate 1, D7) ──
  { object: 'sys_audit_log', census: P1, fate: 'column-drop', citation: `${D7}: the audit ledger; the organization a row is about becomes a plain attribution field` },
  ...['sys_job', 'sys_job_run', 'sys_job_queue', 'sys_flow_dispatch', 'sys_migration', 'sys_migration_journal'].map(
    (object): InventoryEntry => ({ object, census: P1, fate: 'column-drop', citation: D7_PLUMBING }),
  ),
  { object: 'sys_metadata_activation', census: P1, fate: 'column-drop', citation: `${D7}, D6, D14 (C0): the tenant-less activation ledger` },
  { object: 'sys_presence', census: P1, fate: 'column-drop', citation: `${CENSUS_MAIN}: systemFields.tenant: false; ${D7}` },
  {
    object: 'sys_platform_setting',
    census: PMAIN,
    fate: 'column-drop',
    citation: `${CENSUS_MAIN}: systemFields.tenant: false; ${D7}: the settings global rung's tenant-less holder (C6, record 6051723395)`,
  },
  {
    object: 'sys_metadata',
    census: P1,
    fate: 'column-drop',
    citation: METADATA_FAMILY,
    categories: [
      {
        id: 'organization-presentational-promotion',
        label:
          'organization-scoped rows of the five presentational types — promoted to environment rows (ruling record 6020163868, A), ' +
          'public-form withdrawals carried fail-closed (ruling record 6020151485, A), public-form view overlays among them (record 6081248392)',
        citation: 'ruling pointer 6020279837 (records 6020163868 and 6020151485, both A) and pointer 6081248392',
        where: [
          { column: 'organization_id', isNull: false },
          { column: 'type', in: ['view', 'dashboard', 'report', 'translation', 'email_template'] },
        ],
      },
      {
        id: 'organization-presentational-conflicts',
        label: 'one presentational (type, name) held by more than one organization — the conflict list, chosen per row by the operator',
        citation: 'ruling pointer 6020279837 (one conflict list covers all three categories)',
        where: [
          { column: 'organization_id', isNull: false },
          { column: 'type', in: ['view', 'dashboard', 'report', 'translation', 'email_template'] },
        ],
        conflictBy: { groupBy: ['type', 'name'], distinct: 'organization_id' },
      },
      {
        id: 'organization-scoped-other-types',
        label: 'organization-scoped rows of a non-overridable type — reported, never promoted',
        citation: 'ADR-0131 D6 (the per-organization overlay axis retires); stage-0 report 6067752061',
        where: [
          { column: 'organization_id', isNull: false },
          { column: 'type', notIn: ['view', 'dashboard', 'report', 'translation', 'email_template'] },
        ],
      },
      {
        id: 'environment-overlay-duplicates',
        label: 'active overlays sharing (type, name, package, bundle member) once the organization leaves the key — reported, never dropped',
        citation: 'triage pointer 6071418113 (the overlay index pre-flight joins the re-key stage); the bundle member is part of the overlay key (`sys_metadata`\'s overlay index)',
        where: [{ column: 'state', equals: 'active' }],
        conflictBy: { groupBy: ['type', 'name', 'package_id', 'bundle_member'] },
      },
    ],
  },
  { object: 'sys_metadata_audit', census: P1, fate: 'column-drop', citation: METADATA_FAMILY },
  { object: 'sys_metadata_commit', census: P1, fate: 'column-drop', citation: METADATA_FAMILY },
  {
    object: 'sys_metadata_history',
    census: P1,
    fate: 'column-drop',
    citation: METADATA_FAMILY,
    note: 'Its per-organization event_seq / version uniqueness is re-keyed in the same stage (6068052798).',
  },

  // ── Platform: the catalog (fate 2) ──
  {
    object: 'sys_position',
    census: P1,
    fate: 'mirror-deletion',
    citation: `${D3_CATALOG}; D10 fate 2: seeded catalog copies (per-organization and NULL residue alike)`,
    mirror: SEEDED,
    categories: [{ id: 'authored', label: 'Setup-authored positions — converted to environment metadata by C3, never deleted as mirrors', citation: 'ADR-0131 D3 (single: an environment metadata write)', where: AUTHORED }],
  },
  {
    object: 'sys_permission_set',
    census: P1,
    fate: 'mirror-deletion',
    citation: `${D3_CATALOG}; ADR-0094 D1 generalized (D2); D10 fate 2`,
    mirror: SEEDED,
    categories: [
      { id: 'authored', label: 'Setup-authored permission sets — converted to environment metadata by C3, never deleted as mirrors', citation: 'ADR-0131 D3', where: AUTHORED },
      {
        id: LEGACY_SHIPPED_SET_SEEDS_CATEGORY,
        label: 'shipped permission sets an install seeded before 2026-08-15 as managed_by admin — adopted as platform seeds and deleted as mirrors; a Setup edit to one of them is not carried',
        citation: 'seed provenance: commit 712e185db (ruled 2026-08-15); ADR-0131, amendment 2026-10-16',
        where: LEGACY_SHIPPED_SET_SEEDS,
      },
    ],
  },
  {
    object: 'sys_capability',
    census: P1,
    fate: 'mirror-deletion',
    citation: `${D3_CATALOG}; D10 fate 2: seeded capabilities`,
    mirror: SEEDED,
    categories: [{ id: 'authored', label: 'authored capabilities — converted by C3, never deleted as mirrors', citation: 'ADR-0131 D3', where: AUTHORED }],
  },
  {
    object: 'sys_position_permission_set',
    census: P1,
    fate: 'mirror-deletion',
    citation:
      `${D3_CATALOG}: a position's sets are its definition (PositionSchema.permissionSets); C3 migrates every ` +
      'binding row into the definition, after which the row is a mirror',
  },
  {
    object: 'sys_email_template',
    census: P1,
    fate: 'mirror-deletion',
    citation:
      'ADR-0131 §6 Q1 ruled C (ruling record 6020178017): customer-edited templates are promoted to environment ' +
      'Studio templates, after which the customized rows are mirrors; seeded templates are mirrors (D10 fate 2); ' +
      'the table retires under D13',
    categories: [
      { id: 'template-promotion', label: 'customized: true rows — promoted to environment templates before deletion (ruling record 6020178017, C)', citation: 'ruling pointer 6020279837', where: [{ column: 'customized', equals: true }] },
      { id: 'organization-stamped', label: 'organization-stamped rows — promoted with the customized population', citation: 'ADR-0131 §6 Q1 (C)', where: [{ column: 'organization_id', isNull: false }] },
    ],
  },
  {
    object: 'sys_view_definition',
    census: P1_ONLY,
    fate: 'report',
    citation:
      'ADR-0131 D13 / §7: retired as inert — verified 2026-09-04 that no writer and no reader exists; removed from ' +
      'the tree since. A physical table left by an older release is listed, its rows (expected none) reported',
  },
  {
    object: 'sys_saved_report',
    census: P1_ONLY,
    fate: 'report',
    citation: `${CENSUS_1}; removed from the tree since (re-verification record 6018712820). A physical table left by an older release is listed, its NULL rows reported`,
  },
  {
    object: 'sys_report_schedule',
    census: P1_ONLY,
    fate: 'report',
    citation: `${CENSUS_1}; removed from the tree since (re-verification record 6018712820). A physical table left by an older release is listed, its NULL rows reported`,
  },

  // ── Platform: retired before either census (fate 4) ──
  {
    object: 'sys_scim_provider',
    census: RETIRED,
    fate: 'report',
    citation:
      'ADR-0087 semantic entry scim-provider-object-retired (packages/spec/src/migrations/entries/semantic/' +
      '18.scim-provider-object-retired.ts): the rc.1-era @better-auth/scim connection object, retired before the ' +
      'first census with no data-migration path owed (maintainer ruling 2026-08-24), its tables in deployed ' +
      'databases left in place untouched by ruling. A physical table left by an older release is listed, its NULL ' +
      'rows reported, never attributed and never deleted',
    notNullExempt:
      'the object is retired and its table is left in place untouched, by ruling: no declaration anchors tenancy on ' +
      'the column, and a connection scoped to no organization was a legitimate row',
  },

  // ── Platform: attribution through a parent anchor (fate 3) ──
  {
    object: 'sys_file',
    census: P1,
    fate: 'attribution',
    citation: `${C7_FATE_3}; the shape of service-storage backfill-sys-file-organizations.ts (field reference, then attachment holders)`,
    anchors: [subject('ref_object', 'ref_id'), { kind: 'holder', holderObject: 'sys_attachment', holderKey: 'file_id' }],
  },
  { object: 'sys_upload_session', census: P1, fate: 'attribution', citation: `${C7_FATE_3}; the session's file carries the organization`, anchors: [parent('file_id', 'sys_file')] },
  {
    object: 'sys_approval_request',
    census: P1,
    fate: 'attribution',
    citation: `${C7_FATE_3}; plugin-approvals backfill-platform-row-organizations.ts (subject-derived)`,
    anchors: [subject('object_name', 'record_id')],
  },
  { object: 'sys_approval_action', census: P1, fate: 'attribution', citation: `${C7_FATE_3}; backfill-platform-row-organizations.ts (parent-derived)`, anchors: [parent('request_id', 'sys_approval_request')] },
  { object: 'sys_approval_approver', census: P1, fate: 'attribution', citation: `${C7_FATE_3}; backfill-platform-row-organizations.ts (parent-derived)`, anchors: [parent('request_id', 'sys_approval_request')] },
  { object: 'sys_approval_token', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS} (approvals); the token's request carries the organization`, anchors: [parent('request_id', 'sys_approval_request')] },
  { object: 'sys_approval_delegation', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS} (approvals); no anchor names the organization; ${D10_SINGLE}`, anchors: [] },
  {
    object: 'sys_automation_run',
    census: P1,
    fate: 'attribution',
    citation: `${C7_FATE_3}; backfill-platform-row-organizations.ts (the trigger record)`,
    anchors: [subject('trigger_object', 'trigger_record_id')],
  },
  { object: 'sys_notification', census: P1, fate: 'attribution', citation: `${D7} (the notification family is recipient-anchored); the source record carries the organization`, anchors: [subject('source_object', 'source_id')] },
  { object: 'sys_notification_delivery', census: P1, fate: 'attribution', citation: `${C7_FATE_3}; the delivery's notification carries the organization`, anchors: [parent('notification_id', 'sys_notification')] },
  { object: 'sys_notification_receipt', census: P1, fate: 'attribution', citation: `${D7} (recipient-anchored); the receipt's notification carries the organization`, anchors: [parent('notification_id', 'sys_notification')] },
  ...['sys_notification_preference', 'sys_notification_subscription', 'sys_inbox_message'].map(
    (object): InventoryEntry => ({ object, census: P1, fate: 'attribution', citation: `${D7} (recipient-anchored); no anchor names the organization; ${D10_SINGLE}`, anchors: [] }),
  ),
  {
    object: 'sys_notification_template',
    census: P1,
    fate: 'attribution',
    citation:
      `ADR-0131 §6 Q1 (C): notification templates have no metadata type, so their seed retires and no type is added. ` +
      `No column tells a seeded row from an authored one, so no row is selected as a mirror on a guess; ${D10_SINGLE}`,
    anchors: [],
  },
  {
    object: 'sys_record_share',
    census: P1,
    fate: 'attribution',
    citation: `${C7_FATE_3}; plugin-sharing backfill-sys-record-share-organizations.ts (the shared record)`,
    anchors: [subject('object_name', 'record_id')],
  },
  { object: 'sys_share_link', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; the linked record carries the organization`, anchors: [subject('object_name', 'record_id')] },
  { object: 'sys_attachment', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; the attachment's parent record carries the organization`, anchors: [subject('parent_object', 'parent_id')] },
  {
    object: 'sys_activity',
    census: P1,
    fate: 'attribution',
    citation: `${D3_ORG_ROWS}; the activity's record carries the organization (rotation-sharded storage)`,
    anchors: [subject('object_name', 'record_id')],
    // The mirror writes activity only when an organization is derivable, never
    // a NULL row (audit-writers.ts), so a NULL row no anchor names is one it
    // would not write today: 14-day telemetry, deleted rather than reported.
    underivableDeparture: {
      id: 'underivable-activity',
      label:
        'activity rows about a record no organization owns (a sign-up\'s user, a global setting) — telemetry the ' +
        'mirror no longer writes; deleted by the mirror-deletion step, the change itself stays in sys_audit_log',
      citation: 'ruling record 6257510973 item 3 (Q3 A: activity is never a NULL row; existing NULL rows are deleted); ADR-0131 D7, D9',
    },
  },
  { object: 'sys_comment', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; a reply's parent comment carries the organization`, anchors: [parent('parent_id', 'sys_comment')] },
  { object: 'sys_comment_reaction', census: PMAIN, fate: 'attribution', citation: `${CENSUS_MAIN} (in reach); the reaction's comment carries the organization`, anchors: [parent('comment_id', 'sys_comment')] },
  { object: 'sys_email', census: P1, fate: 'attribution', citation: `${D7}: sys_email is stamped at its producers; the related record carries the organization`, anchors: [subject('related_object', 'related_id')] },
  {
    object: 'sys_identity_email',
    census: PMAIN,
    fate: 'column-drop',
    citation: `${CENSUS_MAIN}: systemFields.tenant: false; ${D7}: sys_email's sibling for mail about a person (ruling record 6257510973, Q2 A)`,
  },
  { object: 'sys_http_delivery', census: P1, fate: 'attribution', citation: `${D7}: a delivery is stamped from its webhook's organization`, anchors: [parent('ref_id', 'sys_webhook')] },
  {
    object: 'sys_webhook',
    census: P1,
    fate: 'attribution',
    citation: `${D3_ORG_ROWS}; no anchor names the organization; ${D10_SINGLE}`,
    anchors: [],
    categories: [{ id: 'declared', label: 'boot-seeded declared webhooks (managed_by package) — not named by D10 fate 2, so they stay', citation: 'sys-webhook.object.ts (bootstrapDeclaredWebhooks)', where: [{ column: 'managed_by', equals: 'package' }] }],
  },
  {
    object: 'sys_sharing_rule',
    census: P1,
    fate: 'attribution',
    citation: `${D3_ORG_ROWS} (sharing rules an organization authors); ${D10_SINGLE}`,
    anchors: [],
    // Executed by the apply's mirror-deletion step (C3 stage 9, #23952 — ruling
    // β item 6 asks the label to name that card; the label names the stage and
    // the step instead, because a runtime string carries no tracker id): the
    // grants are renamed to the rule's name, then the rows go. Blocking until
    // then: DECLARED_SHARING_RULE_SEEDER_RUNS below.
    departures: [
      {
        id: 'declared-rule-mirrors',
        label:
          'uncustomized declared sharing rules — seeded copies of code, which the registry now serves; deleted by ' +
          'the mirror-deletion step (ADR-0131 C3 stage 9)',
        citation: 'ADR-0131 D2, D10 fate 2',
        as: 'mirror-deletion',
        where: [{ column: 'managed_by', in: ['package', 'platform'] }, { column: 'customized', notTrue: true }],
      },
    ],
  },
  {
    object: 'sys_business_unit',
    census: P1,
    fate: 'attribution',
    citation:
      'ADR-0131 D3: a seeded sys_business_unit is the organization\'s business unit (D9 derives the owner); the ' +
      'NULL-organization seeded unit an organization-stamped sharing rule cannot reach is read in (pointer 5536478573); ' +
      `the parent unit carries the organization; ${D10_SINGLE}`,
    anchors: [parent('parent_business_unit_id', 'sys_business_unit')],
  },
  {
    object: 'sys_business_unit_member',
    census: P1,
    fate: 'attribution',
    citation: 'the organization-less membership rows are read in (stage-0 report 6067123924): the ceremony owns the existing rows, natural fate the parent anchor (pointer 5536484221) — the membership\'s business unit carries the organization',
    anchors: [parent('business_unit_id', 'sys_business_unit')],
  },
  { object: 'sys_user_position', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS} (assignments are organization rows); the business unit carries the organization`, anchors: [parent('business_unit_id', 'sys_business_unit')] },
  { object: 'sys_user_permission_set', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS} (assignments are organization rows); ${D10_SINGLE}`, anchors: [] },
  {
    object: 'sys_audience_binding_suggestion',
    census: P1,
    fate: 'attribution',
    citation: `${D3_ORG_ROWS}; the suggestion record is deployment-level, owned by the Default Organization (ADR-0090 D5); ${D10_SINGLE}`,
    anchors: [],
  },
  {
    object: 'sys_setting',
    census: P1,
    fate: 'attribution',
    citation: `tenant and user rows written before the settings service stamped them carry NULL (pointer 6061638897); ${D10_SINGLE}; never hidden before attribution`,
    anchors: [],
    departures: [
      {
        id: 'global-rung-move',
        label: 'scope = global rows — moved to sys_platform_setting (value_enc copied verbatim, one row per key)',
        citation: 'pointer 6051723395 (C6 item 3); ADR-0131 D7',
        as: 'moved',
        where: [{ column: 'scope', equals: 'global' }],
      },
    ],
  },
  { object: 'sys_setting_audit', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; ${D10_SINGLE}`, anchors: [] },
  {
    object: 'sys_platform_setting_audit',
    census: PMAIN,
    fate: 'column-drop',
    citation: `${CENSUS_MAIN}: systemFields.tenant: false; ${D7}: the settings audit trail's global rung (ruling record 6257510973, Q4 A)`,
  },
  { object: 'sys_secret', census: P1, fate: 'attribution', citation: `re-verification 6018712820: sys_secret is tenant-attributed by one producer (moved here from C6); ${D10_SINGLE}`, anchors: [] },
  { object: 'sys_scim_connection_credential', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; ${D10_SINGLE}`, anchors: [] },
  { object: 'sys_flow_credential', census: PMAIN, fate: 'attribution', citation: `${CENSUS_MAIN} (in reach, added since the first census); ${D10_SINGLE}`, anchors: [] },
  // Inbound mail (`@objectstack/service-mailbox`): every row is written by the
  // system with the mailbox's organization stamped (ADR-0131 D9), so a NULL
  // row has no producer today; the parents below are where one would take it.
  { object: 'sys_mailbox', census: PMAIN, fate: 'attribution', citation: `${CENSUS_MAIN} (in reach, added since the first census); ${D10_SINGLE}`, anchors: [] },
  { object: 'sys_mail_message', census: PMAIN, fate: 'attribution', citation: `${CENSUS_MAIN} (in reach); the message's mailbox carries the organization`, anchors: [parent('mailbox_id', 'sys_mailbox')] },
  { object: 'sys_mail_association', census: PMAIN, fate: 'attribution', citation: `${CENSUS_MAIN} (in reach); the association's message carries the organization`, anchors: [parent('mail_message_id', 'sys_mail_message')] },
  { object: 'sys_import_job', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; ${D10_SINGLE}`, anchors: [] },
  { object: 'sys_user_preference', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; ${D10_SINGLE}`, anchors: [] },

  // ── Examples (the census's "28") ──
  ...[
    'crm_account', 'crm_activity', 'crm_contact', 'crm_lead', 'crm_opportunity', 'crm_opportunity_line_item',
    'showcase_account', 'showcase_announcement', 'showcase_business_unit', 'showcase_cascade', 'showcase_category',
    'showcase_client_brief', 'showcase_contact', 'showcase_expense_report', 'showcase_expense_line',
    'showcase_field_zoo', 'showcase_inquiry', 'showcase_product', 'showcase_invoice', 'showcase_invoice_line',
    'showcase_preference', 'showcase_private_note', 'showcase_project', 'showcase_semantic_zoo',
    'showcase_semantic_zoo_legacy', 'showcase_task', 'showcase_team', 'showcase_project_membership', 'todo_task',
    'blank_note', 'dc_account',
  ].map(example),
  ...['showcase_ext_customer', 'showcase_ext_order'].map(
    (object): InventoryEntry => ({
      object,
      census: EX,
      fate: 'report',
      citation:
        `${CENSUS_1}; federated read-only from the showcase_external datasource (ADR-0015): the remote table holds ` +
        'no organization column and is not in the planned database',
      external: true,
    }),
  ),

  // ── Cloud supplement ──
  ...[
    'sys_app', 'sys_environment', 'sys_environment_credential', 'sys_environment_member', 'sys_license',
    'sys_package', 'sys_package_installation', 'sys_package_version',
  ].map(cloud),
];

const BY_OBJECT: ReadonlyMap<string, InventoryEntry> = new Map(
  ORGANIZATION_OWNERSHIP_INVENTORY.map((entry) => [entry.object, entry]),
);

/** The inventory row for `object`, or `undefined`. */
export function inventoryEntryFor(object: string): InventoryEntry | undefined {
  return BY_OBJECT.get(object);
}

// ── The declared sharing-rule mirrors, and the seeder that wrote them ─────────

/**
 * Does a served boot of this release still write the package-declared sharing
 * rules into `sys_sharing_rule`?
 *
 * It does not. `@objectstack/plugin-sharing` reads declared rules from the
 * registry at enforcement and writes no row for them: ADR-0131 D2 retired its
 * seeder (`bootstrapDeclaredSharingRules`) at C3 stage 9. While that seeder
 * ran, every `os serve` / `os dev` boot wrote each declared rule
 * organization-less under `single`, as `managed_by 'package'`, uncustomized —
 * exactly the population the `declared-rule-mirrors` departure on
 * `sys_sharing_rule` names — so no step of such a release could remove them,
 * and the ceremony reported them as advisory ({@link advisoryDepartureReason})
 * under the ordering ruled for ADR-0131 C3 (ruling β: stage 9 first, the
 * verified marker after it).
 *
 * Now that departure is the apply's to perform: its mirror-deletion step
 * renames every grant naming a mirror to the rule's name and deletes the
 * mirrors, and until it has, they hold certification like every other NULL
 * row.
 *
 * ⛔ It was set to `false` in the change that retired that seeder, and in no
 * other: a release that seeds the rows must not hold certification on them,
 * and a release that has stopped seeding them holds it again until its
 * ceremony deletes them. `commands/migrate/organization-ownership.declared-rule-mirrors.integration.test.ts`
 * boots a served stack declaring one sharing rule and fails, naming this
 * constant, while what that boot writes disagrees with it.
 */
export const DECLARED_SHARING_RULE_SEEDER_RUNS: boolean = false;

/** The one departure {@link DECLARED_SHARING_RULE_SEEDER_RUNS} decides, by its table and its id. */
const DECLARED_RULE_MIRRORS = { object: 'sys_sharing_rule', departure: 'declared-rule-mirrors' } as const;

/**
 * Why the rows of `departureId` on `object` stay on this release without
 * holding the ceremony's certification, or `null` when they hold it — every
 * departure but the declared sharing-rule mirrors, and those too once their
 * seeder retires ({@link DECLARED_SHARING_RULE_SEEDER_RUNS}).
 *
 * Keyed on the table AND the id: a host fate supplement can declare a
 * departure under any id on its own table, and that departure's rows block
 * like every other. The answer is the ceremony's verdict rule, not inventory
 * data, so it is not part of the plan's `inventoryDigest`: a plan reviewed
 * under it executes the same writes either way.
 */
export function advisoryDepartureReason(
  object: string,
  departureId: string,
  seederRuns: boolean = DECLARED_SHARING_RULE_SEEDER_RUNS,
): string | null {
  if (!seederRuns || object !== DECLARED_RULE_MIRRORS.object || departureId !== DECLARED_RULE_MIRRORS.departure) return null;
  return (
    'this release\'s own boot still writes them (the declared-sharing-rule seeder runs on every served boot), so no ' +
    'step of this release can remove them; the release that retires that seeder (ADR-0131 D2) deletes them'
  );
}

// ── The host fate supplement ──────────────────────────────────────────────────

/** Why a host fate supplement cannot join the inventory. */
export type HostFateSupplementRefusalReason =
  /** The file is missing or cannot be read. */
  | 'fate-supplement-unreadable'
  /** The file is not JSON. */
  | 'fate-supplement-unparsable'
  /** The file is not an array of rows, or a row is one the spec's schema refuses. */
  | 'fate-supplement-invalid'
  /** Two rows name one object. */
  | 'fate-supplement-duplicate-object'
  /** A row names an object the platform inventory already gives a fate. */
  | 'fate-supplement-platform-object';

/**
 * The supplement cannot join the inventory. Thrown before anything is read
 * from the database, so nothing is planned or applied; the command answers it
 * as a refusal inside its `--json` envelope, naming the file and the row.
 */
export class HostFateSupplementRefusal extends Error {
  constructor(
    readonly reason: HostFateSupplementRefusalReason,
    message: string,
    readonly file: string,
    /** The refused row's zero-based index in the file's array. */
    readonly row?: number,
    readonly object?: string,
  ) {
    super(message);
    this.name = 'HostFateSupplementRefusal';
  }
}

const HOST: readonly InventoryCensus[] = ['host-supplement'];

/**
 * The inventory with a host's supplement rows joined to it, on the same terms
 * as the platform's rows: each takes census `host-supplement` and is planned,
 * and applied, exactly as a platform row with its fate is. ADR-0131 D10 drives
 * the ceremony from "the two censuses … cloud's supplement for cloud-declared
 * ones"; this is that supplement, declared by the host instead of guessed here.
 *
 *  - A row naming an object the platform inventory already gives a fate is
 *    refused: the platform's row stands, and a host declares only the objects
 *    it provides.
 *  - A row naming a cloud-provided placeholder (census `cloud-supplement`,
 *    `cloudCarried`, fate 4 with no declared fate) replaces it, in place. Those
 *    rows are C10's placeholder for exactly this declaration.
 *  - Any other row joins as a new row. A row whose table the planned database
 *    lacks is listed `absent` by the plan, as an inventoried object is, so one
 *    supplement serves every database kind a host runs.
 *  - Two rows naming one object are refused.
 *
 * The result is deterministic: a replaced row keeps its place and new rows are
 * appended in object-name order, so the plan's `inventoryDigest` — and the
 * apply's checkpoint, keyed on it — names the content, not the file's order.
 */
export function mergeHostFateSupplement(
  supplement: OrganizationOwnershipSupplement,
  file: string,
  inventory: readonly InventoryEntry[] = ORGANIZATION_OWNERSHIP_INVENTORY,
): readonly InventoryEntry[] {
  const at = new Map(inventory.map((entry, index) => [entry.object, index]));
  const seen = new Map<string, number>();
  const merged = [...inventory];
  const added: InventoryEntry[] = [];
  supplement.forEach((row, index) => {
    const first = seen.get(row.object);
    if (first !== undefined) {
      throw new HostFateSupplementRefusal(
        'fate-supplement-duplicate-object',
        `The host fate supplement ${file} declares ${row.object} twice (rows [${first}] and [${index}]); one object takes ` +
          'one fate.',
        file,
        index,
        row.object,
      );
    }
    seen.set(row.object, index);
    const { object, ...declared } = row;
    const entry: InventoryEntry = { object, census: HOST, ...declared };
    const existing = at.get(object);
    if (existing === undefined) {
      added.push(entry);
      return;
    }
    const platform = inventory[existing]!;
    if (!platform.census.includes('cloud-supplement')) {
      throw new HostFateSupplementRefusal(
        'fate-supplement-platform-object',
        `The host fate supplement ${file} row [${index}] names ${object}, which the platform inventory already gives ` +
          `a fate (${platform.fate}). A host declares fates only for the objects it provides; the platform's row ` +
          'stands, so remove this one.',
        file,
        index,
        object,
      );
    }
    merged[existing] = entry;
  });
  added.sort((a, b) => (a.object < b.object ? -1 : a.object > b.object ? 1 : 0));
  return [...merged, ...added];
}

/** `[3].anchors[0].kind` for a zod issue path. */
function issuePath(path: readonly PropertyKey[]): string {
  return path.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('').replace(/^\./, '');
}

/**
 * Read the host fate supplement at `file` — a JSON array of rows the spec's
 * `OrganizationOwnershipSupplementSchema` admits — and return the inventory
 * with it merged in ({@link mergeHostFateSupplement}). Called by the command
 * only when it is handed the file: the inventory has no ambient input.
 *
 * Every way of not using the file throws {@link HostFateSupplementRefusal},
 * naming the file and, for a row, its index and object: ⛔ a row is never
 * skipped and a file is never half-read.
 */
export async function readHostFateSupplement(
  file: string,
  inventory: readonly InventoryEntry[] = ORGANIZATION_OWNERSHIP_INVENTORY,
): Promise<readonly InventoryEntry[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new HostFateSupplementRefusal(
      'fate-supplement-unreadable',
      `The host fate supplement ${file} could not be read: ${error instanceof Error ? error.message : String(error)}.`,
      file,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new HostFateSupplementRefusal(
      'fate-supplement-unparsable',
      `The host fate supplement ${file} is not JSON: ${error instanceof Error ? error.message : String(error)}.`,
      file,
    );
  }
  const parsed = OrganizationOwnershipSupplementSchema.safeParse(json);
  if (!parsed.success) {
    const [issue, ...more] = parsed.error.issues;
    const row = typeof issue!.path[0] === 'number' ? issue!.path[0] : undefined;
    const named = row === undefined ? undefined : (json as Array<{ object?: unknown }>)[row]?.object;
    const object = typeof named === 'string' ? named : undefined;
    const where = issue!.path.length > 1 ? ` at ${issuePath(issue!.path.slice(1))}` : '';
    const others = more.length > 0 ? ` (and ${more.length} more issue(s))` : '';
    throw new HostFateSupplementRefusal(
      'fate-supplement-invalid',
      row === undefined
        ? `The host fate supplement ${file} must be a JSON array of fate rows (OrganizationOwnershipSupplementSchema, ` +
            `@objectstack/spec/system): ${issue!.message}${others}.`
        : `The host fate supplement ${file} row [${row}]${object ? ` (${object})` : ''} is refused${where}: ` +
            `${issue!.message}${others}.`,
      file,
      row,
      object,
    );
  }
  return mergeHostFateSupplement(parsed.data, file, inventory);
}
