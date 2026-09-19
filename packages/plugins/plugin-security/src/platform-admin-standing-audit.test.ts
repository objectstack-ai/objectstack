// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18412] The durable record of platform-admin standing.
 *
 * Two halves, pinned apart on purpose:
 *
 *  - the ROW SHAPE, tested through the writer's own builder rather than a
 *    hand-written copy of it — including the one property a later author is
 *    most likely to "repair": `organization_id` is NULL, by maintainer ruling
 *    (director batch #153 item 2, 2026-09-18) and by ADR-0131 §1.5, which
 *    rejects inventing a platform organization in its own words. A pin is the
 *    only thing that can notice that exception being undone, because every
 *    field on `sys_audit_log` is `readonly: true` and `validateRecord` skips
 *    readonly fields — nothing else in the stack refuses ANY value here.
 *  - the BOOT BEHAVIOUR: one entry per CHANGE of standing, plus the first-boot
 *    baseline, and silence in the two states where the ledger cannot answer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootstrapPlatformAdmin } from './bootstrap-platform-admin.js';
import {
  buildPlatformAdminStandingRow,
  platformAdminStandingChanged,
  platformAdminStandingSnapshot,
  readRecordedStandingSnapshot,
  serializePlatformAdminStandingSnapshot,
  PLATFORM_ADMIN_STANDING_ACTION,
  PLATFORM_ADMIN_STANDING_LEDGER,
  PLATFORM_ADMIN_STANDING_OBJECT_NAME,
} from './platform-admin-standing-audit.js';
import type { PlatformAdminStandingEntry } from './platform-admin-service.js';

const LEDGER = PLATFORM_ADMIN_STANDING_LEDGER;

/** The `sys_audit_log` field set a multi-tenant deployment declares. */
const TENANTED_LEDGER_FIELDS = [
  'created_at',
  'action',
  'user_id',
  'actor',
  'object_name',
  'record_id',
  'old_value',
  'new_value',
  'tenant_id',
  'metadata',
  'organization_id',
  'id',
];

/**
 * In-memory ql over the objects the walled bootstrap touches PLUS the ledger.
 *
 * `getSchema` is modelled because the writer's mount probe is three-valued and
 * the third state — an engine that cannot be ASKED — is a case below. Pass
 * `ledgerFields: null` for a deployment that never mounted `plugin-audit`, and
 * `schema: false` for an engine carrying no `getSchema` at all.
 */
function makeQl(
  seed: {
    users?: any[];
    audit?: any[];
    ledgerFields?: string[] | null;
    schema?: boolean;
    findRefusesLedger?: boolean;
    insertRefusesLedger?: boolean;
  } = {},
) {
  const tables = new Map<string, any[]>([
    ['sys_permission_set', []],
    ['sys_user', (seed.users ?? []).map((r) => ({ ...r }))],
    ['sys_user_permission_set', []],
    ['sys_account', []],
    [LEDGER, (seed.audit ?? []).map((r) => ({ ...r }))],
  ]);
  const ledgerFields = seed.ledgerFields === undefined ? TENANTED_LEDGER_FIELDS : seed.ledgerFields;
  const ql: any = {
    tables,
    async find(object: string, q: any) {
      if (object === LEDGER && seed.findRefusesLedger) {
        throw new Error('driver refused: no index for sys_audit_log.action');
      }
      const where = q?.where ?? {};
      const rows = (tables.get(object) ?? []).filter((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      );
      // The read is ordered IN THE QUERY (`orderBy`), so the double honours it
      // rather than handing back insertion order — a double that ignored the
      // order would make the "last recorded snapshot" read pass on a driver
      // where it cannot.
      const order = q?.orderBy?.[0];
      if (order) {
        rows.sort((a: any, b: any) => {
          const av = String(a[order.field] ?? '');
          const bv = String(b[order.field] ?? '');
          return order.order === 'desc' ? (av < bv ? 1 : av > bv ? -1 : 0) : av < bv ? -1 : av > bv ? 1 : 0;
        });
      }
      return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
    },
    async insert(object: string, data: any) {
      if (object === LEDGER && seed.insertRefusesLedger) {
        throw new Error('driver refused: table sys_audit_log is read-only here');
      }
      if (!tables.has(object)) tables.set(object, []);
      tables.get(object)!.push({ ...data });
      return { id: data.id };
    },
    async update() {
      return null;
    },
    auditRows(): any[] {
      return (tables.get(LEDGER) ?? []).filter((r) => r.action === PLATFORM_ADMIN_STANDING_ACTION);
    },
  };
  if (seed.schema !== false) {
    ql.getSchema = (name: string) =>
      name === LEDGER
        ? ledgerFields === null
          ? undefined
          : { name: LEDGER, fields: Object.fromEntries(ledgerFields.map((f) => [f, {}])) }
        : { name, fields: {} };
  }
  return ql;
}

const adminFullAccess = () =>
  ({ name: 'admin_full_access', label: 'Admin', objects: {}, systemPermissions: ['setup.access'] }) as any;

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

const user = (id: string, email: string, createdAt: string, extra: Record<string, any> = {}) => ({
  id,
  email,
  created_at: createdAt,
  ...extra,
});

const entry = (over: Partial<PlatformAdminStandingEntry> = {}): PlatformAdminStandingEntry => ({
  email: 'operator@corp.example',
  declaredSpelling: 'Operator@Corp.example',
  registered: true,
  verified: true,
  userId: 'u_owner',
  ...over,
});

const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const OLD_OWNER = process.env.OS_PLATFORM_OWNER_EMAIL;

beforeEach(() => {
  delete process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_PLATFORM_OWNER_EMAIL;
});
afterEach(() => {
  if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  if (OLD_OWNER === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
  else process.env.OS_PLATFORM_OWNER_EMAIL = OLD_OWNER;
});

// ───────────────────────────────────────────────────────────────────────────
// The row shape
// ───────────────────────────────────────────────────────────────────────────
describe('the platform-admin standing row (#18412)', () => {
  it('carries the declared entry, the holder and the delta — as a BASELINE when nothing precedes it', () => {
    const snapshot = platformAdminStandingSnapshot([entry()]);
    const row = buildPlatformAdminStandingRow({
      snapshot,
      previousSerialized: null,
      declaresOrganizationId: true,
      declaresActor: true,
    });
    expect(row.action).toBe('platform_admin_standing_change');
    expect(row.object_name).toBe(PLATFORM_ADMIN_STANDING_OBJECT_NAME);
    expect(row.record_id).toBeNull();
    expect(row.user_id).toBeNull();
    // `old_value` is null on the baseline row AND ONLY THERE, so "is this the
    // first record on this deployment?" is answerable from the row itself.
    expect(row.old_value).toBeNull();
    expect(JSON.parse(String(row.new_value))).toEqual([
      {
        email: 'operator@corp.example',
        declaredSpelling: 'Operator@Corp.example',
        registered: true,
        verified: true,
        userId: 'u_owner',
      },
    ]);
    expect(JSON.parse(String(row.metadata))).toEqual({
      event: 'platform_admin_standing.baseline',
      declared: 1,
      holders: 1,
    });
  });

  it('a later change carries BOTH sides, and says `changed` rather than `baseline`', () => {
    const previous = serializePlatformAdminStandingSnapshot(
      platformAdminStandingSnapshot([entry({ verified: false, userId: undefined })]),
    );
    const row = buildPlatformAdminStandingRow({
      snapshot: platformAdminStandingSnapshot([entry()]),
      previousSerialized: previous,
      declaresOrganizationId: true,
      declaresActor: true,
    });
    expect(row.old_value).toBe(previous);
    expect(JSON.parse(String(row.metadata)).event).toBe('platform_admin_standing.changed');
    expect(JSON.parse(String(row.old_value))[0].userId).toBeNull();
    expect(JSON.parse(String(row.new_value))[0].userId).toBe('u_owner');
  });

  /**
   * ⭐ The DECLARED EXCEPTION, pinned so undoing it cannot be silent.
   *
   * Nothing else can see this. Every `sys_audit_log` field is `readonly: true`
   * and `validateRecord` skips readonly fields, so a tenant id stamped here
   * would be accepted by the whole stack — and it would file a
   * deployment-level fact behind one tenant's wall. ADR-0131 §1.5 rejects the
   * alternative in its own words (「it is the natural repair and the wrong one
   * … exists only to give NULL a new name」); the maintainer ruled this exact
   * shape on 2026-09-18.
   */
  it('⛔ organization_id and tenant_id are NULL — the ruled deployment-level shape, not an oversight', () => {
    const row = buildPlatformAdminStandingRow({
      snapshot: platformAdminStandingSnapshot([entry()]),
      previousSerialized: null,
      declaresOrganizationId: true,
      declaresActor: true,
    });
    expect(
      row.organization_id,
      'the boot-time platform-admin standing row is DEPLOYMENT-LEVEL: there is no platform '
        + 'organization on this tree (ADR-0131 §1.5 rejects inventing one), a tenant id would '
        + 'file a whole-deployment fact behind one tenant, and the first-boot baseline is '
        + 'written before any sys_organization row exists at all. NULL is the ruled shape '
        + '(#18412, director batch #153 item 2) and the shape ADR-0131 D7 will later make '
        + 'structural by dropping the column.',
    ).toBeNull();
    expect(row.tenant_id).toBeNull();
    // ADR-0118 D1/D5 keeps `actor` two-valued; the boot is the system.
    expect(row.actor).toBeNull();
  });

  it('omits both conditional columns on a deployment whose ledger does not declare them', () => {
    const row = buildPlatformAdminStandingRow({
      snapshot: platformAdminStandingSnapshot([entry()]),
      previousSerialized: null,
      declaresOrganizationId: false,
      declaresActor: false,
    });
    // Stamping a column the table lacks fails the INSERT outright — the
    // reason every other sys_audit_log writer probes first.
    expect(Object.keys(row)).not.toContain('organization_id');
    expect(Object.keys(row)).not.toContain('actor');
  });

  it('an absent holder is stored as an explicit null, so present-vs-absent never reads as a change', () => {
    const a = serializePlatformAdminStandingSnapshot(
      platformAdminStandingSnapshot([entry({ userId: undefined })]),
    );
    const b = serializePlatformAdminStandingSnapshot(
      platformAdminStandingSnapshot([entry({ userId: undefined })]),
    );
    expect(a).toBe(b);
    expect(platformAdminStandingChanged(a, b)).toBe(false);
    expect(JSON.parse(a)[0]).toHaveProperty('userId', null);
  });

  it('a ledger row with no readable snapshot answers null, which writes a baseline rather than silence', () => {
    expect(readRecordedStandingSnapshot(undefined)).toBeNull();
    expect(readRecordedStandingSnapshot({ new_value: null })).toBeNull();
    expect(readRecordedStandingSnapshot({ new_value: '[]' })).toBe('[]');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The boot behaviour
// ───────────────────────────────────────────────────────────────────────────
describe('boot records a CHANGE of standing, and only a change (#18412)', () => {
  const walled = (owner: string) => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = owner;
  };

  it('first boot writes the BASELINE once — the record the config-derived migration dropped', async () => {
    walled('operator@corp.example');
    const log = logger();
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-09-01T02:00:00Z', { email_verified: true })],
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.reason).toBe('walled_config_derived');
    const rows = ql.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].old_value).toBeNull();
    expect(rows[0].organization_id).toBeNull();
    expect(JSON.parse(rows[0].new_value)[0]).toMatchObject({
      email: 'operator@corp.example',
      verified: true,
      userId: 'u_owner',
    });
  });

  it('a second boot with the SAME standing writes NOTHING — a restarted rig is not a change of standing', async () => {
    walled('operator@corp.example');
    const log = logger();
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-09-01T02:00:00Z', { email_verified: true })],
    });
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(ql.auditRows()).toHaveLength(1);
  });

  it('standing CHANGING writes a second row whose old_value is the first row\'s new_value', async () => {
    walled('operator@corp.example');
    const log = logger();
    // Boot 1: declared, registered, NOT verified — nobody holds standing.
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-09-01T02:00:00Z')],
    });
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(ql.auditRows()).toHaveLength(1);

    // Boot 2: the address verified. That IS a change of standing.
    ql.tables.get('sys_user')![0].email_verified = true;
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    const rows = ql.auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[1].old_value).toBe(rows[0].new_value);
    expect(JSON.parse(rows[1].old_value)[0].verified).toBe(false);
    expect(JSON.parse(rows[1].new_value)[0].verified).toBe(true);
    expect(JSON.parse(rows[1].metadata).holders).toBe(1);
  });

  it('a REVOKED administrator is recorded — the revocation that used to leave no trace at all', async () => {
    walled('operator@corp.example, second@corp.example');
    const log = logger();
    const ql = makeQl({
      users: [
        user('u_owner', 'operator@corp.example', '2026-09-01T02:00:00Z', { email_verified: true }),
        user('u_two', 'second@corp.example', '2026-09-01T03:00:00Z', { email_verified: true }),
      ],
    });
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    // The operator drops one address from the config and restarts — the exact
    // act that, before this record, left nothing on the data side at all.
    process.env.OS_PLATFORM_OWNER_EMAIL = 'operator@corp.example';
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    const rows = ql.auditRows();
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1].old_value).map((e: any) => e.email)).toEqual([
      'operator@corp.example',
      'second@corp.example',
    ]);
    expect(JSON.parse(rows[1].new_value).map((e: any) => e.email)).toEqual(['operator@corp.example']);
  });

  it('a deployment that never mounted the audit plugin writes nothing and complains about nothing', async () => {
    walled('operator@corp.example');
    const log = logger();
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-09-01T02:00:00Z', { email_verified: true })],
      ledgerFields: null,
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.reason).toBe('walled_config_derived');
    expect(ql.auditRows()).toHaveLength(0);
    // An unmounted ledger is a COMPOSITION choice, not a degradation.
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('⛔ a REFUSED read of the last snapshot writes nothing — "cannot tell" is not "first boot"', async () => {
    walled('operator@corp.example');
    const log = logger();
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-09-01T02:00:00Z', { email_verified: true })],
      findRefusesLedger: true,
    });
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    // Reading the refusal as "no record exists" would file a fresh baseline on
    // every boot of this rig — the per-boot noise the ruling rejected.
    expect(ql.auditRows()).toHaveLength(0);
    expect(String(log.error.mock.calls[0]?.[0])).toContain('refused the read');
  });

  it('a mounted ledger whose INSERT fails reports a durability degradation and never fails the boot', async () => {
    walled('operator@corp.example');
    const log = logger();
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-09-01T02:00:00Z', { email_verified: true })],
      insertRefusesLedger: true,
    });
    const r = await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    expect(r.reason).toBe('walled_config_derived');
    expect(ql.auditRows()).toHaveLength(0);
    expect(String(log.error.mock.calls[0]?.[0])).toContain('audit row was NOT written');
  });

  it('an engine that carries no getSchema is not read as "no ledger" — the write is still attempted', async () => {
    walled('operator@corp.example');
    const log = logger();
    const ql = makeQl({
      users: [user('u_owner', 'operator@corp.example', '2026-09-01T02:00:00Z', { email_verified: true })],
      schema: false,
    });
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    const rows = ql.auditRows();
    expect(rows).toHaveLength(1);
    // Nothing could be probed, so neither conditional column is stamped.
    expect(rows[0]).not.toHaveProperty('organization_id');
    expect(rows[0]).not.toHaveProperty('actor');
  });

  it('the `single` posture is untouched — it still writes a grant row and records no standing entry', async () => {
    process.env.OS_TENANCY_POSTURE = 'single';
    const log = logger();
    const ql = makeQl({
      users: [user('u_first', 'first@corp.example', '2026-09-01T02:00:00Z', { email_verified: true })],
    });
    await bootstrapPlatformAdmin(ql as any, [adminFullAccess()], { logger: log });
    // Standing under `single` still has a durable grant row of its own, which
    // is the property this card exists to restore for WALLED rigs only.
    expect(ql.auditRows()).toHaveLength(0);
  });
});
