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
 *  - `example-census-2026-08-31` — the non-platform objects the same census
 *    counted as "28" (it counted the 28 FILES; they declare 33 objects, the
 *    same 33 on `main` today).
 *  - `cloud-supplement` — cloud-declared objects. The 2026-09-03 cloud-side
 *    supplement is not readable from this repository, so the rows are the
 *    names this repository records as cloud-provided
 *    (`CLOUD_PROVIDED_OBJECT_NAMES`). Cloud stays on v17 (ruling 6094175435 on
 *    #15211), so no v18 ceremony runs against a cloud database: each carries
 *    fate 4, `cloudCarried`, never a guessed fate.
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

/** The four D10 fates. */
export type OrganizationOwnershipFate = 'column-drop' | 'mirror-deletion' | 'attribution' | 'report';

export const ORGANIZATION_OWNERSHIP_FATES: readonly OrganizationOwnershipFate[] = [
  'column-drop',
  'mirror-deletion',
  'attribution',
  'report',
];

/** Where an inventory row's object was counted. */
export type InventoryCensus =
  | 'platform-census-2026-08-31'
  | 'platform-census-main'
  | 'example-census-2026-08-31'
  | 'cloud-supplement';

/**
 * One condition on a row. A {@link RowPredicate} ANDs them. Spelled as data,
 * never as SQL text, so the plan binds every value and quotes every column.
 */
export type RowCondition =
  | { column: string; equals: string | number | boolean }
  | { column: string; in: readonly string[] }
  | { column: string; notIn: readonly string[] }
  | { column: string; isNull: boolean }
  /** The column is NULL or holds anything but `true`. */
  | { column: string; notTrue: true };

export type RowPredicate = readonly RowCondition[];

/**
 * Where a NULL row's organization comes from (D10 fate 3). Tried in order;
 * the first that answers wins.
 */
export type Anchor =
  /** `childKey` names a row of `parentObject`, whose `organization_id` the row takes. */
  | { kind: 'parent'; childKey: string; parentObject: string }
  /** `objectColumn` / `idColumn` name ANY record; that record's `organization_id` is the row's. */
  | { kind: 'subject'; objectColumn: string; idColumn: string }
  /**
   * Rows of `holderObject` point at this row through `holderKey`; when every
   * stamped holder agrees on one organization, the row takes it.
   */
  | { kind: 'holder'; holderObject: string; holderKey: string };

/** A named row population the plan counts on a table. */
export interface InventoryCategory {
  id: string;
  label: string;
  /** The ruling or record that names the population. */
  citation: string;
  /** Rows of the population — counted over the whole table. */
  where?: RowPredicate;
  /**
   * Count GROUPS instead: rows matching `where`, grouped by these columns, in
   * groups holding more than one row (or, with `distinct`, more than one
   * distinct value of that column). The plan reports the group count and the
   * rows in them.
   */
  conflictBy?: { groupBy: readonly string[]; distinct?: string };
}

/**
 * Rows that leave the table by another step of the ceremony before its NOT
 * NULL gate is read: they are neither attributed nor reported.
 */
export interface InventoryDeparture {
  id: string;
  label: string;
  citation: string;
  /** Fate 2 for mirrors; `moved` for rows a ceremony step re-homes elsewhere. */
  as: 'mirror-deletion' | 'moved';
  where: RowPredicate;
}

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
  categories?: readonly InventoryCategory[];
  /**
   * Fate 4 only: the column is not the tenancy anchor, so it never receives
   * NOT NULL whatever its rows hold. The reason, in the operator's terms.
   */
  notNullExempt?: string;
  /** Fate 4 only: a cloud-declared object; cloud stays on v17. */
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
  'not readable here. Cloud stays on v17 (ruling record 6094175435): no v18 ceremony runs against a cloud ' +
  'database, so the row is listed, never given a guessed fate; C10 assigns it when cloud moves';
const EXAMPLE =
  `${CENSUS_1}: non-platform object, column auto-injected, presumptive accidental (no citable writer fact); ` +
  D10_SINGLE;

const P1: readonly InventoryCensus[] = ['platform-census-2026-08-31', 'platform-census-main'];
const P1_ONLY: readonly InventoryCensus[] = ['platform-census-2026-08-31'];
const PMAIN: readonly InventoryCensus[] = ['platform-census-main'];
const EX: readonly InventoryCensus[] = ['example-census-2026-08-31'];

/** Rows a package or the platform seeded — the D10 fate-2 mirror selector on the catalog objects. */
const SEEDED: RowPredicate = [{ column: 'managed_by', in: ['package', 'platform', 'system'] }];
const AUTHORED: RowPredicate = [{ column: 'managed_by', notIn: ['package', 'platform', 'system'] }];

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
        label: 'active overlays sharing (type, name, package) once the organization leaves the key — reported, never dropped',
        citation: 'triage pointer 6071418113 (the overlay index pre-flight joins the re-key stage)',
        where: [{ column: 'state', equals: 'active' }],
        conflictBy: { groupBy: ['type', 'name', 'package_id'] },
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
    categories: [{ id: 'authored', label: 'Setup-authored permission sets — converted to environment metadata by C3, never deleted as mirrors', citation: 'ADR-0131 D3', where: AUTHORED }],
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
  { object: 'sys_activity', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; the activity's record carries the organization (rotation-sharded storage)`, anchors: [subject('object_name', 'record_id')] },
  { object: 'sys_comment', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; a reply's parent comment carries the organization`, anchors: [parent('parent_id', 'sys_comment')] },
  { object: 'sys_comment_reaction', census: PMAIN, fate: 'attribution', citation: `${CENSUS_MAIN} (in reach); the reaction's comment carries the organization`, anchors: [parent('comment_id', 'sys_comment')] },
  { object: 'sys_email', census: P1, fate: 'attribution', citation: `${D7}: sys_email is stamped at its producers; the related record carries the organization`, anchors: [subject('related_object', 'related_id')] },
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
    departures: [
      {
        id: 'declared-rule-mirrors',
        label: 'uncustomized declared sharing rules — seeded copies of code (D2 retires bootstrapDeclaredSharingRules)',
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
    citation: `${D3_ORG_ROWS}; an organization resolves its own suggestions (ADR-0090 D9); ${D10_SINGLE}`,
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
  { object: 'sys_secret', census: P1, fate: 'attribution', citation: `re-verification 6018712820: sys_secret is tenant-attributed by one producer (moved here from C6); ${D10_SINGLE}`, anchors: [] },
  { object: 'sys_scim_connection_credential', census: P1, fate: 'attribution', citation: `${D3_ORG_ROWS}; ${D10_SINGLE}`, anchors: [] },
  { object: 'sys_flow_credential', census: PMAIN, fate: 'attribution', citation: `${CENSUS_MAIN} (in reach, added since the first census); ${D10_SINGLE}`, anchors: [] },
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
