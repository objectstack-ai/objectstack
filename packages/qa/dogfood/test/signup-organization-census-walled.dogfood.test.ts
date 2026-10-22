// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D9] The organization census of a self-registration on a WALLED
// boot (`group` and `isolated`), end to end on the real stack with the audit
// and email plugins composed together. The `single` leg is
// `signup-organization-census.dogfood.test.ts`; this file is its walled
// sibling, one boot per posture.
//
// The journey is the whole sign-up a walled deployment sees: a stranger
// self-registers (the verification mail is sent), creates their organization
// (their first membership), and invites a second stranger (the invitation
// mail is sent), who self-registers and accepts it (their first membership).
// Three framework writers act on tenant-column objects along the way, and on
// a wall none of them may fall back to an organization-less row:
//
//   - the self-registration grant (`sys_user_permission_set`) settles on each
//     registrant's FIRST MEMBERSHIP, owned by that membership's organization
//     (ADR-0131 D3) — never at sign-up, when there is no organization yet;
//   - the activity writer (`sys_activity`) stamps the organization of the
//     record it is about, and writes NO row about a record that has none
//     (ADR-0131 D9; ruling of record 6257510973 item 3, Q3 A);
//   - the verification mail is identity mail, written to
//     `sys_identity_email`, which carries no organization column (ADR-0131
//     D7; ruling of record 6257510973, Q2 A); the invitation mail is tenant
//     mail, written to `sys_email`, owned by the inviting organization.
//
// The census reads the STORE, not the registry: every table of the sqlite
// database that carries an `organization_id` column — activity shards and
// tables no object names included — is derived from the schema at run time,
// so a new table joins the census on its own. Since 18.x the engine creates a
// tenant column NOT NULL, so "0 NULL rows" alone could hold vacuously (a
// refused write leaves no row, and no NULL either); every writer's own row is
// therefore also required to EXIST and to name the organization the user
// joined.
//
// The boot is `multiTenant: 'posture-only'`: a real, non-degraded walled
// posture. Every writer here keys on the posture (whether an organization is
// derivable), never on row isolation, so the stand-in's lack of a row wall
// measures nothing away. `OS_TENANCY_POSTURE` selects `group`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { EmailServicePlugin } from '@objectstack/plugin-email';
import { AuditPlugin } from '@objectstack/plugin-audit';

const SYS = { context: { isSystem: true } };
const SET = 'member_default';
const PASSWORD = 'Census-Passw0rd!';

/** A transport that accepts every message, so every mail persists as sent. */
const acceptingTransport = {
  async send() {
    return { messageId: `census-${Math.random().toString(36).slice(2, 10)}` };
  },
};

type Row = Record<string, unknown>;

for (const posture of ['group', 'isolated'] as const) {
  describe(`[ADR-0131 D9] ${posture}: a walled self-registration leaves no organization-less row`, () => {
    const REGISTRANT = `census-registrant-${posture}@dogfood.test`;
    const INVITEE = `census-invitee-${posture}@dogfood.test`;
    const SLUG = `census-${posture}`;
    let stack: VerifyStack;
    let ql: any;
    let orgId: string;
    let registrantId: string;
    let inviteeId: string;
    let invitationId: string;
    /** `table/id` of every row the store held on a tenant-column table BEFORE the journey. */
    const beforeJourney = new Set<string>();
    const previous = process.env.OS_TENANCY_POSTURE;

    /** A raw statement on the default datasource — the store as it is, below every engine read path. */
    const sql = async (statement: string): Promise<Row[]> => {
      const rows = await ql.getDriverForObject('sys_user').execute(statement);
      return Array.isArray(rows) ? (rows as Row[]) : [];
    };
    /** Every table of the store that carries an `organization_id` column, read from the schema now. */
    const tenantColumnTables = async (): Promise<string[]> => {
      const tables = (await sql("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => String(r.name));
      const out: string[] = [];
      for (const table of tables) {
        const columns = await sql(`PRAGMA table_info("${table}")`);
        if (columns.some((c) => c.name === 'organization_id')) out.push(table);
      }
      return out;
    };
    /** Every row of every tenant-column table, keyed `table/id`. */
    const storeRows = async (): Promise<Map<string, Row & { table: string }>> => {
      const out = new Map<string, Row & { table: string }>();
      for (const table of await tenantColumnTables()) {
        for (const row of await sql(`SELECT * FROM "${table}"`)) out.set(`${table}/${String(row.id)}`, { ...row, table });
      }
      return out;
    };
    const journeyRows = async () => [...(await storeRows()).entries()].filter(([key]) => !beforeJourney.has(key)).map(([, row]) => row);
    const userIdOf = async (email: string): Promise<string> => {
      const user = await ql.findOne('sys_user', { where: { email }, ...SYS });
      expect(user?.id, `${email} exists`).toBeTruthy();
      return String(user.id);
    };
    /** Self-register through the public door; the address is then marked verified in place, so the user can sign in. */
    const selfRegister = async (email: string, name: string): Promise<{ id: string; token: string }> => {
      const signedUp = await stack.api('/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD, name }),
      });
      expect(signedUp.status, `sign-up ${email}: ${await signedUp.clone().text()}`).toBe(200);
      const id = await userIdOf(email);
      await ql.update('sys_user', { id, email_verified: true }, SYS);
      return { id, token: await stack.signIn(email, PASSWORD) };
    };

    beforeAll(async () => {
      process.env.OS_TENANCY_POSTURE = posture;
      stack = await bootStack(crmStack as never, {
        multiTenant: 'posture-only',
        extraPlugins: [new AuditPlugin(), new EmailServicePlugin({
          transport: acceptingTransport as never,
          defaultFrom: { address: 'no-reply@example.test', name: 'Census' },
        })],
      });
      const adminToken = await stack.signIn();
      ql = await stack.kernel.getServiceAsync<any>('objectql');

      // An open audience: a stranger self-registers, is owed the declared set,
      // and is sent the verification mail the open posture requires.
      const opened = await stack.raw('/api/settings/auth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ values: { audience_posture: 'open', audience_self_registration_permission_set: SET } }),
      });
      expect(opened.status, `open the audience: ${await opened.clone().text()}`).toBe(200);

      // The census is of what the JOURNEY writes; the boot's own rows are set
      // aside here, by table and id (they are still read by the whole-store
      // NULL census below).
      for (const key of (await storeRows()).keys()) beforeJourney.add(key);

      // 1. The registrant self-registers and creates their organization.
      const registrant = await selfRegister(REGISTRANT, 'Census Registrant');
      registrantId = registrant.id;
      const created = await stack.apiAs(registrant.token, 'POST', '/auth/organization/create', { name: `Census ${posture}`, slug: SLUG });
      expect(created.status, `organization/create: ${await created.clone().text()}`).toBe(200);
      orgId = String(((await created.json()) as { id?: string }).id ?? '');
      expect(orgId, 'the organization was created').not.toBe('');

      // 2. They invite a second stranger, who self-registers and accepts.
      const invited = await stack.apiAs(registrant.token, 'POST', '/auth/organization/invite-member', {
        email: INVITEE, role: 'member', organizationId: orgId,
      });
      expect(invited.status, `invite-member: ${await invited.clone().text()}`).toBe(200);
      invitationId = String(((await invited.json()) as { id?: string }).id ?? '');
      expect(invitationId, 'the invitation was issued').not.toBe('');
      const invitee = await selfRegister(INVITEE, 'Census Invitee');
      inviteeId = invitee.id;
      const accepted = await stack.apiAs(invitee.token, 'POST', '/auth/organization/accept-invitation', { invitationId });
      expect(accepted.status, `accept-invitation: ${await accepted.clone().text()}`).toBe(200);
    }, 180_000);

    afterAll(async () => {
      await stack?.stop?.();
      if (previous === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previous;
    });

    it('guard: a real walled posture, and each registrant\'s first membership is the organization of the journey', async () => {
      const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean; isolationActive: boolean }>('tenancy');
      expect(tenancy.posture).toBe(posture);
      expect(tenancy.degraded).toBe(false);
      expect(tenancy.isolationActive).toBe(true);
      for (const userId of [registrantId, inviteeId]) {
        const memberships = await ql.find('sys_member', { where: { user_id: userId }, ...SYS });
        expect(memberships.map((m: Row) => m.organization_id), `${userId}: memberships`).toEqual([orgId]);
      }
      // The census's own reach: the store's tenant-column tables include every
      // one the three writers write.
      const tables = await tenantColumnTables();
      for (const table of ['sys_user_permission_set', 'sys_email', 'sys_member', 'sys_invitation']) expect(tables).toContain(table);
      expect(tables.some((t) => t === 'sys_activity' || t.startsWith('sys_activity__')), 'an activity table carries the column').toBe(true);
    });

    it('the whole store holds 0 rows without an organization on every table that carries the column', async () => {
      const orgLess = [...(await storeRows()).values()]
        .filter((r) => r.organization_id == null || r.organization_id === '')
        .map((r) => `${r.table}/${String(r.id)}`);
      expect(orgLess, 'rows without an organization').toEqual([]);
    });

    it('every row the journey wrote on a tenant-column table names the organization the users joined', async () => {
      const written = await journeyRows();
      expect(written.length, 'the journey wrote tenant rows').toBeGreaterThan(0);
      const foreign = written.filter((r) => r.organization_id !== orgId).map((r) => `${r.table}/${String(r.id)} -> ${String(r.organization_id)}`);
      expect(foreign, 'rows owned by an organization other than the journey\'s').toEqual([]);
    });

    it('the grant writer: each registrant holds exactly one declared grant, owned by their first membership', async () => {
      for (const userId of [registrantId, inviteeId]) {
        const grants = await ql.find('sys_user_permission_set', { where: { user_id: userId }, ...SYS });
        expect(grants.map((g: Row) => [g.permission_set, g.organization_id]), `${userId}: grants`).toEqual([[SET, orgId]]);
      }
    });

    it('the activity writer: activity about each grant and about the invitation mail names the organization', async () => {
      const written = await journeyRows();
      const activity = written.filter((r) => r.table === 'sys_activity' || r.table.startsWith('sys_activity__'));
      const grants = await ql.find('sys_user_permission_set', { where: { user_id: { $in: [registrantId, inviteeId] } }, ...SYS });
      expect(grants.length).toBe(2);
      for (const grant of grants) {
        const about = activity.filter((a) => a.object_name === 'sys_user_permission_set' && a.record_id === grant.id);
        expect(about.length, `activity about the grant ${String(grant.id)}`).toBeGreaterThan(0);
        expect(about.map((a) => a.organization_id)).toEqual(about.map(() => orgId));
      }
      const [invitationMail] = await ql.find('sys_email', { where: { related_object: 'sys_invitation', related_id: invitationId }, ...SYS });
      expect(invitationMail?.id, 'the invitation mail persisted').toBeTruthy();
      const aboutMail = activity.filter((a) => a.object_name === 'sys_email' && a.record_id === invitationMail.id);
      expect(aboutMail.length, 'activity about the invitation mail').toBeGreaterThan(0);
      expect(aboutMail.map((a) => a.organization_id)).toEqual(aboutMail.map(() => orgId));
      // A record with no organization of its own (the registrant) on a wall
      // takes none: no activity row about it, never a NULL one.
      expect(activity.filter((a) => a.object_name === 'sys_user' && [registrantId, inviteeId].includes(String(a.record_id)))).toEqual([]);
    });

    it('the mail writers: the invitation is tenant mail owned by the organization; each verification mail is identity mail', async () => {
      const [invitationMail] = await ql.find('sys_email', { where: { related_object: 'sys_invitation', related_id: invitationId }, ...SYS });
      expect(invitationMail?.organization_id).toBe(orgId);
      for (const userId of [registrantId, inviteeId]) {
        const identity = await ql.find('sys_identity_email', { where: { related_object: 'sys_user', related_id: userId }, ...SYS });
        expect(identity.length, `${userId}: the verification mail persisted, in the identity-mail log`).toBeGreaterThan(0);
        expect(identity.every((m: Row) => !('organization_id' in m))).toBe(true);
        const tenantMail = await ql.find('sys_email', { where: { related_object: 'sys_user', related_id: userId }, ...SYS });
        expect(tenantMail, `${userId}: no verification mail in the tenant mail log`).toEqual([]);
      }
      const identityColumns = (await sql('PRAGMA table_info("sys_identity_email")')).map((c) => c.name);
      expect(identityColumns.length, 'sys_identity_email is in the store').toBeGreaterThan(0);
      expect(identityColumns).not.toContain('organization_id');
    });
  });
}
