// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0131 D10 inventory's enumeration pin: every object of both #13564
 * censuses, of the platform registry as it stands, of the objects retired
 * before either census, and of the cloud supplement carries exactly one fate
 * and a citation. A platform object that lands
 * without an inventory row turns this red by name — the plan would refuse its
 * table on a real database, and this says so before any database does.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLOUD_PROVIDED_OBJECT_NAMES,
  OrganizationOwnershipSupplementEntrySchema,
  PLATFORM_OBJECTS_BY_PACKAGE,
  type OrganizationOwnershipSupplementEntry,
} from '@objectstack/spec/system';
import { MIGRATIONS_BY_MAJOR } from '@objectstack/spec/migrations';
import { securityDefaultPermissionSets } from '@objectstack/plugin-security';
import {
  HostFateSupplementRefusal,
  LEGACY_SHIPPED_SET_SEEDS,
  ORGANIZATION_OWNERSHIP_FATES,
  ORGANIZATION_OWNERSHIP_INVENTORY,
  SHIPPED_PERMISSION_SET_NAMES,
  inventoryEntryFor,
  mergeHostFateSupplement,
  readHostFateSupplement,
  type InventoryEntry,
} from './organization-ownership-inventory.js';
import { PRESENTATIONAL_TYPES } from './organization-ownership-plan.js';

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

/**
 * Platform objects retired from the tree before the first census was
 * measured: neither census counted them and the registry no longer names
 * them, yet a database that booted an earlier release still holds the table,
 * `organization_id` included. Frozen: a record of what was retired, keyed to
 * the ADR-0087 entry each row's citation names.
 */
const RETIRED_BEFORE_CENSUS = { sys_scim_provider: 'scim-provider-object-retired' } as const;

/**
 * Platform objects the first census counted that have since retired by an
 * ADR-0087 entry leaving their table in place untouched: the registry no
 * longer names them, yet an upgraded database still holds the table. Frozen,
 * keyed to the entry each row's citation names.
 */
const RETIRED_AFTER_FIRST_CENSUS = { sys_notification_subscription: 'sys-notification-subscription-retired' } as const;

/**
 * #14570 and #15086, read in: each population's table has its own fate, citing
 * the record that read it in (a runtime string carries no tracker number).
 */
const READ_IN = { sys_business_unit_member: '6067123924', sys_business_unit: '5536478573' } as const;

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
    // (The four retired catalog row objects left the registry with C3 stage 8.)
    expect(registered.length).toBeGreaterThan(75);
    expect(unlisted(registered)).toEqual([]);
  });

  it('retired before either census: listed with fate 4, citing its ADR-0087 entry and no tracker number', () => {
    const retired = Object.keys(RETIRED_BEFORE_CENSUS);
    const counted = [...CENSUS_2026_08_31_PLATFORM_WITH_COLUMN, ...CENSUS_2026_08_31_PLATFORM_WITHOUT_COLUMN] as readonly string[];
    const registered = new Set(Object.values(PLATFORM_OBJECTS_BY_PACKAGE).flat());
    expect(unlisted(retired)).toEqual([]);
    for (const [object, adr0087Entry] of Object.entries(RETIRED_BEFORE_CENSUS)) {
      // The population's premise: no census counted it and the tree no longer declares it.
      expect(counted, object).not.toContain(object);
      expect(registered.has(object), object).toBe(false);
      // The entry the citation names exists, and its ruling is what licenses fate 4: the table stays untouched.
      const semantic = Object.values(MIGRATIONS_BY_MAJOR).flatMap((step) => step.semantic).find((s) => s.id === adr0087Entry);
      expect(semantic?.acceptanceCriteria, adr0087Entry).toContain('left in place untouched');
      const entry = inventoryEntryFor(object)!;
      expect(entry, object).toMatchObject({ census: ['retired-before-census'], fate: 'report' });
      expect(entry.citation, object).toContain(adr0087Entry);
      // A runtime string carries no tracker number.
      expect(entry.citation, object).not.toMatch(/#\d/);
      expect(entry.notNullExempt, object).toBeTruthy();
    }
    // Control: no other row claims the population.
    expect(
      ORGANIZATION_OWNERSHIP_INVENTORY.filter((e) => e.census.includes('retired-before-census')).map((e) => e.object).sort(),
    ).toEqual([...retired].sort());
  });

  it('counted by the first census, retired since with the table left in place: fate 4, citing its ADR-0087 entry', () => {
    const counted = [...CENSUS_2026_08_31_PLATFORM_WITH_COLUMN, ...CENSUS_2026_08_31_PLATFORM_WITHOUT_COLUMN] as readonly string[];
    const registered = new Set(Object.values(PLATFORM_OBJECTS_BY_PACKAGE).flat());
    for (const [object, adr0087Entry] of Object.entries(RETIRED_AFTER_FIRST_CENSUS)) {
      // The population's premise: the first census counted it and the tree no longer declares it.
      expect(counted, object).toContain(object);
      expect(registered.has(object), object).toBe(false);
      // The entry the citation names exists, and its ruling is what licenses fate 4: the table stays untouched.
      const semantic = Object.values(MIGRATIONS_BY_MAJOR).flatMap((step) => step.semantic).find((s) => s.id === adr0087Entry);
      expect(semantic?.acceptanceCriteria, adr0087Entry).toContain('left in place untouched');
      const entry = inventoryEntryFor(object)!;
      expect(entry, object).toMatchObject({ census: ['platform-census-2026-08-31'], fate: 'report' });
      expect(entry.citation, object).toContain(adr0087Entry);
      expect(entry.citation, object).not.toMatch(/#\d/);
      expect(entry.notNullExempt, object).toBeTruthy();
    }
  });

  it('the cloud supplement: listed as cloud-carried, fate 4, never a guessed fate', () => {
    expect(CLOUD_PROVIDED_OBJECT_NAMES.length).toBeGreaterThan(0);
    expect(unlisted(CLOUD_PROVIDED_OBJECT_NAMES)).toEqual([]);
    for (const name of CLOUD_PROVIDED_OBJECT_NAMES) {
      expect(inventoryEntryFor(name), name).toMatchObject({ fate: 'report', cloudCarried: true });
    }
  });

  it('#14570 and #15086 are read in, each with its own fate and citation', () => {
    for (const [object, record] of Object.entries(READ_IN)) {
      const entry = inventoryEntryFor(object);
      expect(entry?.fate, object).toBe('attribution');
      expect(entry?.citation, object).toContain(record);
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

  it('the shipped permission set names are the security plugin\'s, so every legacy admin-stamped seed is adopted', () => {
    expect([...SHIPPED_PERMISSION_SET_NAMES].sort()).toEqual(securityDefaultPermissionSets.map((set) => set.name).sort());
    expect(LEGACY_SHIPPED_SET_SEEDS).toEqual([
      { column: 'managed_by', equals: 'admin' },
      { column: 'name', in: [...SHIPPED_PERMISSION_SET_NAMES] },
    ]);
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

// ── The host fate supplement (ADR-0131 D10, the inventory's C10 stage) ────────

/**
 * The keys a host authors are the inventory row's keys minus what only the
 * platform states. Compile-time: both directions of `extends` must hold, so a
 * key added to either side without the other fails `tsc` on this file.
 */
type HostAuthoredKeys = Exclude<keyof InventoryEntry, 'census' | 'cloudCarried' | 'external' | 'underivableDeparture'>;
type SpecRowKeys = OrganizationOwnershipSupplementEntry extends infer Row ? (Row extends unknown ? keyof Row : never) : never;
const KEYS_AGREE: [HostAuthoredKeys] extends [SpecRowKeys] ? ([SpecRowKeys] extends [HostAuthoredKeys] ? true : false) : false = true;

const FILE = 'host-fates.json';
const CITE = 'fixture: a host-declared fate (test data, not any host\'s declaration)';
/** A supplement row; fate 4 unless `extra` says otherwise. */
const host = (object: string, extra: Record<string, unknown> = {}): OrganizationOwnershipSupplementEntry =>
  ({ object, fate: 'report', citation: CITE, ...extra }) as OrganizationOwnershipSupplementEntry;

function refusalOf(run: () => unknown): HostFateSupplementRefusal {
  try {
    run();
  } catch (error) {
    if (error instanceof HostFateSupplementRefusal) return error;
    throw error;
  }
  throw new Error('the supplement was not refused');
}

async function refusalOfAsync(run: () => Promise<unknown>): Promise<HostFateSupplementRefusal> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HostFateSupplementRefusal) return error;
    throw error;
  }
  throw new Error('the supplement was not refused');
}

describe('the inventory row and the spec\'s supplement row are one shape', () => {
  it('the host-authored keys equal the spec row\'s keys (compile-time)', () => {
    expect(KEYS_AGREE).toBe(true);
  });

  it('every platform row, less what only the platform states, is a row the spec admits', () => {
    // The CLI's vocabulary as the platform actually uses it (every condition,
    // anchor, category and departure form) is declared in the spec: a host can
    // author anything the platform's own rows say.
    const refused: string[] = [];
    for (const { census: _census, cloudCarried: _cloud, external: _external, underivableDeparture: _underivable, ...row } of ORGANIZATION_OWNERSHIP_INVENTORY) {
      const result = OrganizationOwnershipSupplementEntrySchema.safeParse(row);
      if (!result.success) refused.push(`${row.object}: ${result.error.issues[0]?.message}`);
    }
    expect(refused).toEqual([]);
  });
});

describe('mergeHostFateSupplement — host rows join the inventory on the platform\'s terms', () => {
  it('a host row joins with census host-supplement and the fields it declared', () => {
    const merged = mergeHostFateSupplement(
      [host('sys_fixture_quota', { fate: 'attribution', anchors: [{ kind: 'parent', childKey: 'environment_id', parentObject: 'sys_environment' }] })],
      FILE,
    );
    expect(merged).toHaveLength(ORGANIZATION_OWNERSHIP_INVENTORY.length + 1);
    expect(merged.find((e) => e.object === 'sys_fixture_quota')).toEqual({
      object: 'sys_fixture_quota',
      census: ['host-supplement'],
      fate: 'attribution',
      citation: CITE,
      anchors: [{ kind: 'parent', childKey: 'environment_id', parentObject: 'sys_environment' }],
    });
    // Control: the platform's own inventory is untouched.
    expect(inventoryEntryFor('sys_fixture_quota')).toBeUndefined();
  });

  it('without a supplement the inventory is exactly the platform\'s', () => {
    expect(mergeHostFateSupplement([], FILE)).toEqual(ORGANIZATION_OWNERSHIP_INVENTORY);
  });

  it('a row naming a platform object is refused, naming the row and the object', () => {
    const r = refusalOf(() => mergeHostFateSupplement([host('sys_fixture_ok'), host('sys_file')], FILE));
    expect(r).toMatchObject({ reason: 'fate-supplement-platform-object', file: FILE, row: 1, object: 'sys_file' });
    // An example object the inventory gives a fate is a platform row too.
    expect(refusalOf(() => mergeHostFateSupplement([host('crm_account')], FILE)).reason).toBe('fate-supplement-platform-object');
    // Control: the same row naming an object the inventory does not hold joins.
    expect(() => mergeHostFateSupplement([host('sys_fixture_ok'), host('sys_fixture_file')], FILE)).not.toThrow();
  });

  it('a row naming a cloud-provided placeholder replaces it in place; without one the placeholder stands', () => {
    const at = ORGANIZATION_OWNERSHIP_INVENTORY.findIndex((e) => e.object === 'sys_environment');
    expect(ORGANIZATION_OWNERSHIP_INVENTORY[at]).toMatchObject({ census: ['cloud-supplement'], fate: 'report', cloudCarried: true });
    const merged = mergeHostFateSupplement([host('sys_environment', { fate: 'column-drop' })], FILE);
    expect(merged).toHaveLength(ORGANIZATION_OWNERSHIP_INVENTORY.length);
    expect(merged[at]).toEqual({ object: 'sys_environment', census: ['host-supplement'], fate: 'column-drop', citation: CITE });
    // Control: every other placeholder still carries no declared fate.
    for (const name of CLOUD_PROVIDED_OBJECT_NAMES.filter((n) => n !== 'sys_environment')) {
      expect(merged.find((e) => e.object === name), name).toMatchObject({ fate: 'report', cloudCarried: true });
    }
  });

  it('two rows naming one object are refused', () => {
    const r = refusalOf(() => mergeHostFateSupplement([host('sys_fixture_a'), host('sys_fixture_b'), host('sys_fixture_a')], FILE));
    expect(r).toMatchObject({ reason: 'fate-supplement-duplicate-object', row: 2, object: 'sys_fixture_a' });
    expect(r.message).toContain('[0]');
  });

  it('new rows are appended in object order, so the merged list names the content, not the file order', () => {
    const forward = mergeHostFateSupplement([host('sys_fixture_a'), host('sys_fixture_b')], FILE);
    const backward = mergeHostFateSupplement([host('sys_fixture_b'), host('sys_fixture_a')], FILE);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });
});

describe('readHostFateSupplement — a file it cannot use is refused, naming the file and the row', () => {
  let dir: string;
  const write = (name: string, body: string): string => {
    const path = join(dir, name);
    writeFileSync(path, body);
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-fate-supplement-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a valid file into the merged inventory', async () => {
    const file = write('ok.json', JSON.stringify([host('sys_fixture_a')]));
    const merged = await readHostFateSupplement(file);
    expect(merged.find((e) => e.object === 'sys_fixture_a')).toMatchObject({ census: ['host-supplement'], fate: 'report' });
  });

  it('a missing file', async () => {
    const file = join(dir, 'absent.json');
    expect(await refusalOfAsync(() => readHostFateSupplement(file))).toMatchObject({ reason: 'fate-supplement-unreadable', file });
  });

  it('a file that is not JSON', async () => {
    const file = write('bad.json', '[{ "object": ');
    expect(await refusalOfAsync(() => readHostFateSupplement(file))).toMatchObject({ reason: 'fate-supplement-unparsable', file });
  });

  it('a file that is not an array of rows', async () => {
    const file = write('object.json', JSON.stringify({ rows: [host('sys_fixture_a')] }));
    const r = await refusalOfAsync(() => readHostFateSupplement(file));
    expect(r).toMatchObject({ reason: 'fate-supplement-invalid', file });
    expect(r.row).toBeUndefined();
  });

  it('a row the spec refuses, by index and object, with where in the row', async () => {
    const file = write('row.json', JSON.stringify([host('sys_fixture_a'), { object: 'sys_fixture_b', fate: 'attribution', citation: CITE }]));
    const r = await refusalOfAsync(() => readHostFateSupplement(file));
    expect(r).toMatchObject({ reason: 'fate-supplement-invalid', file, row: 1, object: 'sys_fixture_b' });
    expect(r.message).toContain('anchors');
  });

  it('the merge refusals reach the caller from the file too', async () => {
    const file = write('platform.json', JSON.stringify([host('sys_member')]));
    expect(await refusalOfAsync(() => readHostFateSupplement(file))).toMatchObject({ reason: 'fate-supplement-platform-object', file, row: 0, object: 'sys_member' });
  });
});

describe('the promotion population is the inventory\'s', () => {
  it('PRESENTATIONAL_TYPES, which the apply promotes, is the list the sys_metadata promotion category names', () => {
    const category = inventoryEntryFor('sys_metadata')!.categories!.find((c) => c.id === 'organization-presentational-promotion')!;
    const types = category.where!.find((c) => c.column === 'type') as { in?: readonly string[] };
    expect([...PRESENTATIONAL_TYPES].sort()).toEqual([...(types.in ?? [])].sort());
  });
});
