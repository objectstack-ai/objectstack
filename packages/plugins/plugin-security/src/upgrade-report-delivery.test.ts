// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25413] The delivery of a boot upgrade report — pins for the walled
 * in-app copy `OS_PLATFORM_OWNER_ORGANIZATION` turns on, each beside a
 * CONTROL: the setting resolved by id and by slug, an unknown value, the
 * setting unset, a configured operator who cannot see the copy, an
 * administrator of the organization who is not an operator, and `single`,
 * which never reads the setting.
 *
 * The engine is an in-memory double of the two reads the delivery makes
 * (`find` by equality, `getObject`). The access report's own wiring, on a real
 * engine under `isolated` and `group`, is pinned in
 * `access-upgrade-report.wiring.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { deliverUpgradeReport, type UpgradeReportNotice, type UpgradeReportNotifier } from './upgrade-report-delivery.js';

const OWNER_EMAIL_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const OWNER_ORG_ENV = 'OS_PLATFORM_OWNER_ORGANIZATION';
const OPERATOR = 'operator@vendor.example';
const DEFAULT_ORG = 'org_default';
const OWNER_ORG = 'org_platform';
const TENANT_ORG = 'org_tenant';

afterEach(() => {
  delete process.env[OWNER_EMAIL_ENV];
  delete process.env[OWNER_ORG_ENV];
  resetPlatformAdminEmailMemo();
  vi.restoreAllMocks();
});

type Row = Record<string, unknown>;

const OBJECTS = ['sys_organization', 'sys_member', 'sys_user', 'sys_user_permission_set'];

/** Scalar equality only: a combinator or an operator object is refused, never answered silently wrong. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`fake engine: unsupported where '${k}'`);
    return row[k] === v;
  });
}

function fakeEngine(tables: Record<string, Row[]>, failOn?: string) {
  const getObject = (name: string) => (OBJECTS.includes(name) ? { name, fields: {} } : undefined);
  return {
    registry: { getObject },
    getObject,
    async find(object: string, options: Record<string, any>): Promise<Row[]> {
      if (failOn === object) throw new Error(`${object} is unreachable`);
      const where = (options.where ?? {}) as Row;
      const rows = (tables[object] ?? []).filter((row) => matches(row, where));
      return rows.slice(0, options.limit ?? rows.length);
    },
  };
}

/**
 * A walled deployment: a tenant organization with its own administrator, and
 * the operator's dedicated organization, which the operator (a verified
 * account) owns and nobody else administers.
 */
function deployment(edit: (t: Record<string, Row[]>) => void = () => {}) {
  const tables: Record<string, Row[]> = {
    sys_organization: [
      { id: DEFAULT_ORG, slug: 'default' },
      { id: OWNER_ORG, slug: 'platform-ops' },
      { id: TENANT_ORG, slug: 'tenant' },
    ],
    sys_user: [
      { id: 'usr_operator', email: OPERATOR, email_verified: true },
      { id: 'usr_tenant_admin', email: 'admin@tenant.example', email_verified: true },
    ],
    sys_member: [
      { id: 'm1', organization_id: OWNER_ORG, user_id: 'usr_operator', role: 'owner' },
      { id: 'm2', organization_id: TENANT_ORG, user_id: 'usr_tenant_admin', role: 'owner' },
    ],
    sys_user_permission_set: [
      { id: 'g1', user_id: 'usr_tenant_admin', permission_set: 'organization_admin', organization_id: TENANT_ORG },
      { id: 'g2', user_id: 'usr_default_admin', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG },
    ],
  };
  edit(tables);
  return tables;
}

const NOTICE: UpgradeReportNotice = {
  topic: 'security.access_upgrade',
  findingSet: 'security.access_upgrade:0123456789abcdef0123456789abcdef',
  subject: 'the access upgrade findings above',
  operatorReason: 'the activation ledger and the security catalog are shared by every organization — so only the operator can act on them, through the activation and clone doors.',
  payload: { title: 'An upgrade changed what your access settings cover', body: 'Nothing was changed.', counts: { orphans: 1 } },
};

const notifier = () => ({ emit: vi.fn(async (_input: Parameters<UpgradeReportNotifier['emit']>[0]) => ({ notificationId: 'n1' })) });
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

async function deliver(
  tables: Record<string, Row[]>,
  opts: { walled?: boolean; ownerOrganization?: string; failOn?: string; messaging?: { emit: any } | null } = {},
) {
  process.env[OWNER_EMAIL_ENV] = OPERATOR;
  if (opts.ownerOrganization !== undefined) process.env[OWNER_ORG_ENV] = opts.ownerOrganization;
  resetPlatformAdminEmailMemo();
  const messaging = opts.messaging === null ? undefined : opts.messaging ?? notifier();
  const log = logger();
  const delivery = await deliverUpgradeReport(
    fakeEngine(tables, opts.failOn),
    { walled: opts.walled ?? true, messaging, logger: log },
    NOTICE,
  );
  const errors = log.error.mock.calls.map(([m, , meta]) => ({ m: String(m), meta }));
  const warns = log.warn.mock.calls.map(([m, meta]) => ({ m: String(m), meta }));
  return { delivery, emit: messaging?.emit, errors, warns };
}

const operatorLine = (r: { errors: Array<{ m: string; meta: any }> }) =>
  r.errors.filter((l) => l.m.startsWith('[security] platform operator:'));

describe('walled, OS_PLATFORM_OWNER_ORGANIZATION naming a dedicated organization', () => {
  for (const [how, value] of [['its id', OWNER_ORG], ['its slug', 'platform-ops'], ['its id with stray spaces', `  ${OWNER_ORG} `]] as const) {
    it(`by ${how}: one notification in that organization, to the operator, with the operator line beside it`, async () => {
      const r = await deliver(deployment(), { ownerOrganization: value });
      expect(r.emit).toHaveBeenCalledTimes(1);
      const input = r.emit!.mock.calls[0][0];
      expect(input).toEqual({
        topic: NOTICE.topic, audience: [OPERATOR], severity: 'warning', dedupKey: NOTICE.findingSet,
        organizationId: OWNER_ORG, payload: NOTICE.payload,
      });
      expect(r.delivery).toEqual({ outcome: 'notified', recipients: [OPERATOR], findingSet: NOTICE.findingSet, organizationId: OWNER_ORG });
      const lines = operatorLine(r);
      expect(lines).toHaveLength(1);
      expect(lines[0].m).toContain('A copy is raised in-app in the organization OS_PLATFORM_OWNER_ORGANIZATION names');
      expect(lines[0].meta).toEqual({ findingSet: NOTICE.findingSet, operators: [OPERATOR], organizationId: OWNER_ORG });
      // A dedicated organization the operator owns: neither warning fires.
      expect(r.warns).toEqual([]);
      expect(r.errors).toHaveLength(1);
    });
  }
});

describe('walled, the setting unset or naming nothing: never a fallback', () => {
  it('unset (the CONTROL for the setting): the operator line only, worded as before — no emit', async () => {
    const r = await deliver(deployment());
    expect(r.emit).not.toHaveBeenCalled();
    expect(r.delivery).toEqual({ outcome: 'operator-log', recipients: [OPERATOR], findingSet: NOTICE.findingSet });
    expect(r.errors).toEqual([{
      m: '[security] platform operator: the access upgrade findings above are deployment-level — the activation ' +
        'ledger and the security catalog are shared by every organization — so only the operator can act on them, ' +
        'through the activation and clone doors. This tenancy posture has no in-app channel for a deployment-level ' +
        'notification, so this log is where they are raised; no organization is told. The configured operator(s) ' +
        'are named in this line.',
      meta: { findingSet: NOTICE.findingSet, operators: [OPERATOR] },
    }]);
  });

  it('blank counts as unset', async () => {
    const r = await deliver(deployment(), { ownerOrganization: '   ' });
    expect(r.emit).not.toHaveBeenCalled();
    expect(r.errors).toHaveLength(1);
  });

  it('a value naming no organization: one error naming the value and the fix, then the operator line — no emit, no other organization told', async () => {
    const r = await deliver(deployment(), { ownerOrganization: 'platform-opz' });
    expect(r.emit).not.toHaveBeenCalled();
    expect(r.delivery).toMatchObject({ outcome: 'operator-log', recipients: [OPERATOR], reason: '"platform-opz" names no organization by id or by slug' });
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].m).toBe(
      '[security] OS_PLATFORM_OWNER_ORGANIZATION is set, but the access upgrade findings above are not raised ' +
        'in-app: "platform-opz" names no organization by id or by slug. The operator line below is the only channel ' +
        'for this boot. Fix: set OS_PLATFORM_OWNER_ORGANIZATION to the id or slug of an existing organization that ' +
        'holds the platform operators only, or unset it.',
    );
    expect(r.errors[0].meta).toEqual({ findingSet: NOTICE.findingSet, value: 'platform-opz' });
    expect(operatorLine(r)[0].m).toContain('no organization is told');
  });

  it('CONTROL for the unknown value: the same deployment once the organization exists is told in-app', async () => {
    const r = await deliver(deployment((t) => { t.sys_organization.push({ id: 'org_opz', slug: 'platform-opz' }); }), { ownerOrganization: 'platform-opz' });
    expect(r.delivery).toMatchObject({ outcome: 'notified', organizationId: 'org_opz' });
  });

  it('the organizations cannot be read: said with the cause, the operator line stands — no emit', async () => {
    const r = await deliver(deployment(), { ownerOrganization: OWNER_ORG, failOn: 'sys_organization' });
    expect(r.emit).not.toHaveBeenCalled();
    expect(r.delivery.outcome).toBe('operator-log');
    expect(r.errors[0].m).toContain('the organizations could not be read (sys_organization is unreachable)');
    expect(operatorLine(r)).toHaveLength(1);
  });

  it('no messaging service: said with the fix, the operator line stands', async () => {
    const r = await deliver(deployment(), { ownerOrganization: OWNER_ORG, messaging: null });
    expect(r.delivery).toMatchObject({ outcome: 'operator-log', reason: 'this composition has no messaging service' });
    expect(r.errors[0].m).toContain('Fix: compose the messaging service.');
  });

  it('an emit the ingress refuses: said with its cause, never thrown — the operator line says no organization is told', async () => {
    const messaging = { emit: vi.fn(async () => { throw new Error('outbox down'); }) };
    const r = await deliver(deployment(), { ownerOrganization: OWNER_ORG, messaging });
    expect(r.delivery).toMatchObject({ outcome: 'operator-log', reason: 'the notification ingress refused it (outbox down)' });
    expect(operatorLine(r)[0].m).toContain('no organization is told');
  });

  it('no operator configured: nobody to address the copy to, so none is raised, and the fix names the operator variable', async () => {
    process.env[OWNER_ORG_ENV] = OWNER_ORG;
    resetPlatformAdminEmailMemo();
    const messaging = notifier();
    const log = logger();
    const delivery = await deliverUpgradeReport(fakeEngine(deployment()), { walled: true, messaging, logger: log }, NOTICE);
    expect(messaging.emit).not.toHaveBeenCalled();
    expect(delivery).toMatchObject({ outcome: 'operator-log', recipients: [], reason: 'no operator is configured to address it to' });
    const lines = log.error.mock.calls.map(([m]) => String(m));
    expect(lines[0]).toContain('Fix: set OS_PLATFORM_OWNER_EMAIL to name the platform operator.');
    expect(lines[1]).toContain('No operator is configured: set OS_PLATFORM_OWNER_EMAIL');
  });
});

describe('walled, who can see the in-app copy', () => {
  it('an operator who is not a member of the organization: a warning that the copy will not be visible to them — the copy still goes', async () => {
    const r = await deliver(deployment((t) => { t.sys_member = t.sys_member.filter((m) => m.user_id !== 'usr_operator'); }), { ownerOrganization: OWNER_ORG });
    expect(r.emit).toHaveBeenCalledTimes(1);
    const warn = r.warns.find((w) => w.m.includes('will not be visible to them'));
    expect(warn?.meta).toEqual({ organizationId: OWNER_ORG, operators: [{ email: OPERATOR, state: 'not-member' }] });
  });

  it('an operator with no account, and one whose account is not verified, are each named with their state', async () => {
    process.env[OWNER_EMAIL_ENV] = `${OPERATOR},second@vendor.example,third@vendor.example`;
    process.env[OWNER_ORG_ENV] = OWNER_ORG;
    resetPlatformAdminEmailMemo();
    const tables = deployment((t) => { t.sys_user.push({ id: 'usr_third', email: 'third@vendor.example', email_verified: false }); });
    const log = logger();
    await deliverUpgradeReport(fakeEngine(tables), { walled: true, messaging: notifier(), logger: log }, NOTICE);
    const warn = log.warn.mock.calls.find(([m]) => String(m).includes('will not be visible to them'));
    expect(warn?.[1]?.operators).toEqual([
      { email: 'second@vendor.example', state: 'no-account' },
      { email: 'third@vendor.example', state: 'unverified' },
    ]);
  });

  it('an administrator of it who is not a configured operator — by membership grade or by grant — is flagged', async () => {
    const r = await deliver(deployment((t) => {
      t.sys_member.push({ id: 'm3', organization_id: OWNER_ORG, user_id: 'usr_ops_admin', role: 'member,admin' });
      t.sys_member.push({ id: 'm4', organization_id: OWNER_ORG, user_id: 'usr_ops_member', role: 'member' });
      t.sys_user_permission_set.push({ id: 'g3', user_id: 'usr_granted', permission_set: 'admin_full_access', organization_id: OWNER_ORG });
    }), { ownerOrganization: OWNER_ORG });
    expect(r.emit).toHaveBeenCalledTimes(1);
    const warn = r.warns.find((w) => w.m.includes('are not configured operators'));
    expect(warn?.m).toContain('can read the in-app copy of the access upgrade findings above in Setup, Notification Events');
    expect(warn?.meta).toEqual({ organizationId: OWNER_ORG, administrators: ['usr_granted', 'usr_ops_admin'] });
  });

  it('CONTROL: a plain member, and the tenant organization\'s own administrator, are not flagged', async () => {
    const r = await deliver(deployment((t) => {
      t.sys_member.push({ id: 'm4', organization_id: OWNER_ORG, user_id: 'usr_ops_member', role: 'member' });
    }), { ownerOrganization: OWNER_ORG });
    expect(r.warns).toEqual([]);
  });

  it('the members cannot be read: a warning that the check did not run — the copy still goes', async () => {
    const r = await deliver(deployment(), { ownerOrganization: OWNER_ORG, failOn: 'sys_member' });
    expect(r.emit).toHaveBeenCalledTimes(1);
    expect(r.warns.some((w) => w.m.includes('could not be read (sys_member is unreachable)'))).toBe(true);
  });
});

describe('single never reads the setting', () => {
  it('set or unset, the Default Organization is stamped and its administrators are told', async () => {
    for (const ownerOrganization of [undefined, OWNER_ORG]) {
      const r = await deliver(deployment(), { walled: false, ...(ownerOrganization ? { ownerOrganization } : {}) });
      expect(r.emit!.mock.calls[0][0]).toMatchObject({ audience: [OPERATOR, 'usr_default_admin'], organizationId: DEFAULT_ORG });
      expect(r.delivery).toMatchObject({ outcome: 'notified', organizationId: DEFAULT_ORG });
      expect(operatorLine(r)).toEqual([]);
      expect(r.warns).toEqual([]);
      delete process.env[OWNER_ORG_ENV];
    }
  });
});
