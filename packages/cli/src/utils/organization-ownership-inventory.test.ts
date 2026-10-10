// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 inventory's enumeration pin: every object of both #13564
 * censuses, of the platform registry as it stands, and of the cloud supplement
 * carries exactly one fate and a citation. A platform object that lands
 * without an inventory row turns this red by name — the plan would refuse its
 * table on a real database, and this says so before any database does.
 */

import { describe, expect, it } from 'vitest';
import { CLOUD_PROVIDED_OBJECT_NAMES, PLATFORM_OBJECTS_BY_PACKAGE } from '@objectstack/spec/system';
import {
  ORGANIZATION_OWNERSHIP_FATES,
  ORGANIZATION_OWNERSHIP_INVENTORY,
  inventoryEntryFor,
} from './organization-ownership-inventory.js';

/**
 * The first census's platform population — 59 carrying the column, 25 not —
 * as #13564 comment 5479883784 lists it (measured at `00d8f6541b`). Frozen:
 * it is a record of what was counted, not of the tree.
 */
const CENSUS_2026_08_31_PLATFORM_WITH_COLUMN = [
  // accidental (7) + global (1)
  'sys_file', 'sys_upload_session', 'sys_approval_request', 'sys_approval_action', 'sys_approval_approver',
  'sys_automation_run', 'sys_notification_delivery', 'sys_permission_set',
  // load-bearing confirmed beyond the ledger
  'sys_metadata', 'sys_view_definition',
  // split-verdict (7)
  'sys_position', 'sys_business_unit', 'sys_business_unit_member', 'sys_user_position',
  'sys_position_permission_set', 'sys_user_permission_set', 'sys_capability',
  // structural siblings (3)
  'sys_metadata_audit', 'sys_metadata_commit', 'sys_metadata_history',
  // not individually examined (39)
  'sys_activity', 'sys_approval_delegation', 'sys_approval_token', 'sys_attachment',
  'sys_audience_binding_suggestion', 'sys_audit_log', 'sys_comment', 'sys_email', 'sys_email_template',
  'sys_flow_dispatch', 'sys_http_delivery', 'sys_import_job', 'sys_inbox_message', 'sys_invitation', 'sys_job',
  'sys_job_queue', 'sys_job_run', 'sys_member', 'sys_metadata_activation', 'sys_migration', 'sys_migration_journal',
  'sys_notification', 'sys_notification_preference', 'sys_notification_receipt', 'sys_notification_subscription',
  'sys_notification_template', 'sys_presence', 'sys_record_share', 'sys_report_schedule', 'sys_saved_report',
  'sys_scim_connection_credential', 'sys_secret', 'sys_setting', 'sys_setting_audit', 'sys_share_link',
  'sys_sharing_rule', 'sys_team', 'sys_user_preference', 'sys_webhook',
] as const;

const CENSUS_2026_08_31_PLATFORM_WITHOUT_COLUMN = [
  'sys_account', 'sys_api_key', 'sys_device_code', 'sys_jwks', 'sys_oauth_access_token', 'sys_oauth_application',
  'sys_oauth_client_assertion', 'sys_oauth_client_resource', 'sys_oauth_consent', 'sys_oauth_refresh_token',
  'sys_oauth_resource', 'sys_organization', 'sys_scim_connection_binding', 'sys_scim_group', 'sys_scim_group_member',
  'sys_scim_identity_tombstone', 'sys_scim_projection_grant', 'sys_scim_subject', 'sys_scim_user', 'sys_session',
  'sys_team_member', 'sys_two_factor', 'sys_user', 'sys_verification', 'sys_sso_provider',
] as const;

/**
 * The census's "28 non-platform objects" — it counted the 28 files; they
 * declare these 33 objects, read at the census commit and unchanged on `main`.
 */
const CENSUS_2026_08_31_EXAMPLES = [
  'blank_note', 'crm_account', 'crm_activity', 'crm_contact', 'crm_lead', 'crm_opportunity',
  'crm_opportunity_line_item', 'dc_account', 'showcase_account', 'showcase_announcement', 'showcase_business_unit',
  'showcase_cascade', 'showcase_category', 'showcase_client_brief', 'showcase_contact', 'showcase_expense_line',
  'showcase_expense_report', 'showcase_ext_customer', 'showcase_ext_order', 'showcase_field_zoo', 'showcase_inquiry',
  'showcase_invoice', 'showcase_invoice_line', 'showcase_preference', 'showcase_private_note', 'showcase_product',
  'showcase_project', 'showcase_project_membership', 'showcase_semantic_zoo', 'showcase_semantic_zoo_legacy',
  'showcase_task', 'showcase_team', 'todo_task',
] as const;

/** #14570 and #15086, read in: each population's table has its own fate. */
const READ_IN = { sys_business_unit_member: '#14570', sys_business_unit: '#15086' } as const;

const unlisted = (names: readonly string[]): string[] => names.filter((name) => inventoryEntryFor(name) === undefined);

describe('ADR-0131 D10 inventory — every censused object has one fate and a citation', () => {
  it('the first census: 59 + 25 platform objects', () => {
    expect(CENSUS_2026_08_31_PLATFORM_WITH_COLUMN).toHaveLength(59);
    expect(CENSUS_2026_08_31_PLATFORM_WITHOUT_COLUMN).toHaveLength(25);
    expect(unlisted([...CENSUS_2026_08_31_PLATFORM_WITH_COLUMN, ...CENSUS_2026_08_31_PLATFORM_WITHOUT_COLUMN])).toEqual([]);
  });

  it('the first census: the example objects of its 28 files', () => {
    expect(unlisted(CENSUS_2026_08_31_EXAMPLES)).toEqual([]);
  });

  it('the platform registry as it stands — a platform object without a row reds here, by name', () => {
    const registered = Object.values(PLATFORM_OBJECTS_BY_PACKAGE).flat();
    expect(registered.length).toBeGreaterThan(80);
    expect(unlisted(registered)).toEqual([]);
  });

  it('the cloud supplement: listed as cloud-carried, fate 4, never a guessed fate', () => {
    expect(CLOUD_PROVIDED_OBJECT_NAMES.length).toBeGreaterThan(0);
    expect(unlisted(CLOUD_PROVIDED_OBJECT_NAMES)).toEqual([]);
    for (const name of CLOUD_PROVIDED_OBJECT_NAMES) {
      expect(inventoryEntryFor(name), name).toMatchObject({ fate: 'report', cloudCarried: true });
    }
  });

  it('#14570 and #15086 are read in, each with its own fate and citation', () => {
    for (const [object, card] of Object.entries(READ_IN)) {
      const entry = inventoryEntryFor(object);
      expect(entry?.fate, object).toBe('attribution');
      expect(entry?.citation, object).toContain(card);
    }
  });

  it('one row per object, a fate from the four, a non-empty citation', () => {
    const seen = new Set<string>();
    for (const entry of ORGANIZATION_OWNERSHIP_INVENTORY) {
      expect(seen.has(entry.object), `${entry.object} listed twice`).toBe(false);
      seen.add(entry.object);
      expect(ORGANIZATION_OWNERSHIP_FATES, entry.object).toContain(entry.fate);
      expect(entry.citation.trim().length, entry.object).toBeGreaterThan(20);
      expect(entry.census.length, entry.object).toBeGreaterThan(0);
    }
  });

  it('each fate carries only the fields that fate reads', () => {
    for (const entry of ORGANIZATION_OWNERSHIP_INVENTORY) {
      if (entry.anchors) expect(entry.fate, `${entry.object}: anchors outside fate 3`).toBe('attribution');
      if (entry.mirror) expect(entry.fate, `${entry.object}: a mirror selector outside fate 2`).toBe('mirror-deletion');
      if (entry.notNullExempt || entry.cloudCarried) expect(entry.fate, entry.object).toBe('report');
      if (entry.fate === 'attribution') expect(entry.anchors, `${entry.object}: fate 3 names its anchors`).toBeDefined();
    }
  });

  it('every parent and holder an anchor names is itself inventoried', () => {
    for (const entry of ORGANIZATION_OWNERSHIP_INVENTORY) {
      for (const anchor of entry.anchors ?? []) {
        const target = anchor.kind === 'parent' ? anchor.parentObject : anchor.kind === 'holder' ? anchor.holderObject : null;
        if (target) expect(inventoryEntryFor(target), `${entry.object} → ${target}`).toBeDefined();
      }
    }
  });
});
