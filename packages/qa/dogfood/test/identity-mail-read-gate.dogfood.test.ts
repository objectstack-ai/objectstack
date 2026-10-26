// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24625] Identity-mail bodies are read only by the platform capability, on
// every door, over an 18.0 database the ownership ceremony has upgraded.
//
// ## What was measured
//
// An 18.0 install wrote its identity mail (password reset, account invitation,
// verification, magic link, email-change notice) into `sys_email`, stamped with
// the organization, and `sys_email` declared no read gate of its own. An
// organization administrator without `manage_platform_settings` read those
// bodies — and the reset and sign-in links in them — on the data API, in
// global search, and in the `sys_activity` / `sys_audit_log` mirrors. New
// identity mail goes to `sys_identity_email` (object-gated on the capability),
// but its mirror rows held the body in clear at rest.
//
// ## The fix pinned here
//
// No column tells an 18.0 identity row apart from tenant mail reliably (a magic
// link carries no `related_object`; the log has no template column), so the
// gate is on the BODY columns of both mail logs: field `requiredPermissions:
// ['manage_platform_settings']`. The mirror writers mask the same columns.
//
// ## Over a ceremonied fixture (#24581)
//
// The boot guard serves an 18.0 database only once the ownership ceremony has
// certified it, so the matrix boots a copy the ceremony ran on
// (`ceremoniedFixture`). Its `sibling-moves` step moved the 18.0 identity row
// — the password reset — into `sys_identity_email`, id for id, and re-pointed
// its `sys_activity` rows there; the identity probes follow it. The
// organization invitation is tenant mail and stays in `sys_email`, and the
// pre-fix `sys_audit_log` copies of the reset still name `sys_email`: both keep
// their `sys_email` probes. Every door closed before the ceremony stays
// closed.
//
// ## The matrix, principal × door
//
//   - anonymous: refused on the data API;
//   - member: refused on the data API, no hit in search, no body in a mirror;
//   - organization admin (no platform capability): the identity row AND the
//     organization's own non-identity row are served — envelope, subject and
//     delivery state — without either body; a filter on a body is refused; a
//     body term finds nothing in search; the mirrors serve no body; the
//     identity log refuses outright;
//   - platform admin (the control): the bodies on every door, so each "absent"
//     above is a gate and not an empty fixture.
//
// And the writers: a mirror row written for a mail-log row on HEAD carries no
// body in clear, for the identity log and the tenant log alike.
//
// ⛔ No body, link or token value appears in a test title, an assertion
// message or a log line: every probe compares a value read as the system
// against a response by inclusion, and reports a boolean.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VerifyStack } from '@objectstack/verify';
import { ceremoniedFixture } from './upgrade-harness/ceremony.js';
import { FIXTURE_PEOPLE, bootFixture } from './upgrade-harness/populate-fixture.js';

const FIXTURE = new URL('./upgrade-harness/fixture-18.0/', import.meta.url);
const fixtureSql = readFileSync(new URL('database.sql', FIXTURE), 'utf8');

const SYS = { context: { isSystem: true } } as const;
const BODY_FIELDS = ['body_text', 'body_html'] as const;

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => (Array.isArray(body) ? body : (body?.records ?? body?.data ?? body?.value ?? []));
const recordOf = (body: any): Row => body?.record ?? body?.data ?? body;
const filterOf = (where: Record<string, unknown>) => encodeURIComponent(JSON.stringify(where));
const hasBodyKey = (row: Row) => BODY_FIELDS.some((f) => f in row);

/**
 * The longest run of link-token characters in a stored body that no other
 * column of the row carries — the part of a reset or invitation link that IS
 * the credential (an invitation link also names the invitation, which the row
 * keeps in clear in `related_id`). A response "contains the body" exactly when
 * it contains this span; JSON escaping cannot hide it.
 */
function credentialSpanOf(row: Row): string {
  const elsewhere = JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !(BODY_FIELDS as readonly string[]).includes(k))));
  const runs = (String(row.body_text ?? '').match(/[A-Za-z0-9_-]{16,}/g) ?? []).filter((r) => !elsewhere.includes(r));
  const longest = runs.sort((a, b) => b.length - a.length)[0];
  if (!longest) throw new Error('the stored body carries no link token to probe with');
  return longest;
}

describe('[#24625] identity-mail bodies over a ceremonied 18.0 database: principal × door', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-identity-mail-gate-'));
  let stack: VerifyStack;
  let ql: any;
  const tok: Record<'platform' | 'orgAdmin' | 'member', string> = { platform: '', orgAdmin: '', member: '' };
  /**
   * The fixture's two 18.0 mail rows: the password reset, which the ceremony
   * moved to `sys_identity_email`, and the organization invitation, still in
   * `sys_email`.
   */
  let reset: Row;
  let invitation: Row;
  let resetSpan = '';
  let invitationSpan = '';

  const call = async (who: keyof typeof tok | 'anonymous', method: string, path: string, body?: unknown) => {
    const res = who === 'anonymous'
      ? await stack.api(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      : await stack.apiAs(tok[who], method, path, body);
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, text, json };
  };

  beforeAll(async () => {
    const { file } = await ceremoniedFixture(dir, fixtureSql, 'identity-mail-gate');
    stack = await bootFixture(file);
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    const mails: Row[] = await ql.find('sys_email', { where: {}, limit: 50, ...SYS });
    const identity: Row[] = await ql.find('sys_identity_email', { where: {}, limit: 50, ...SYS });
    reset = identity.find((m) => m.related_object === 'sys_user')!;
    invitation = mails.find((m) => m.related_object === 'sys_invitation')!;
    expect(reset, 'the ceremony moved the 18.0 password-reset row to the identity log').toBeTruthy();
    expect(mails.some((m) => m.id === reset.id), 'the moved row left sys_email').toBe(false);
    expect(invitation, 'the organization-invitation row stays in sys_email').toBeTruthy();
    resetSpan = credentialSpanOf(reset);
    invitationSpan = credentialSpanOf(invitation);

    // The organization administrator: fixture member A, promoted to the
    // organization's `admin` role. The membership hook grants the scoped
    // organization-admin set; nothing grants the platform capability.
    const [userA] = await ql.find('sys_user', { where: { email: FIXTURE_PEOPLE.memberA.email }, limit: 1, ...SYS });
    const [membership] = await ql.find('sys_member', { where: { user_id: userA.id }, limit: 1, ...SYS });
    expect(membership?.organization_id, 'member A belongs to the fixture organization').toBe(invitation.organization_id);
    await ql.update('sys_member', { id: membership.id, role: 'admin' }, SYS);

    tok.platform = await stack.signIn(FIXTURE_PEOPLE.admin.email, FIXTURE_PEOPLE.admin.password);
    tok.orgAdmin = await stack.signIn(FIXTURE_PEOPLE.memberA.email, FIXTURE_PEOPLE.memberA.password);
    tok.member = await stack.signIn(FIXTURE_PEOPLE.memberB.email, FIXTURE_PEOPLE.memberB.password);
    for (const who of ['platform', 'orgAdmin', 'member'] as const) {
      await call(who, 'POST', '/auth/organization/set-active', { organizationId: invitation.organization_id });
    }
  }, 600_000);

  afterAll(async () => {
    await stack?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('the data API: list, get and query of the two mail logs', () => {
    it.each(['sys_email', 'sys_identity_email'] as const)('anonymous is refused %s', async (object) => {
      expect((await call('anonymous', 'GET', `/data/${object}`)).status).toBe(401);
    });

    it.each(['sys_email', 'sys_identity_email'] as const)('a member is refused %s', async (object) => {
      const res = await call('member', 'GET', `/data/${object}`);
      expect(res.status).toBe(403);
      expect(res.text.includes(resetSpan)).toBe(false);
      expect(res.text.includes(invitationSpan)).toBe(false);
    });

    it('the organization admin lists its own invitation without a body, and the moved identity row is not in sys_email', async () => {
      const res = await call('orgAdmin', 'GET', '/data/sys_email');
      expect(res.status).toBe(200);
      const rows = rowsOf(res.json);
      // The row is served, with its envelope and state: the gate is on the body only.
      const row = rows.find((r) => r.id === invitation.id);
      expect(row, 'the row is listed').toBeTruthy();
      expect(row!.subject).toBe(invitation.subject);
      expect(row!.status).toBe(invitation.status);
      expect(hasBodyKey(row!)).toBe(false);
      expect(rows.some((r) => r.id === reset.id)).toBe(false);
      expect(res.text.includes(resetSpan)).toBe(false);
      expect(res.text.includes(invitationSpan)).toBe(false);
    });

    it('the organization admin gets the invitation by id without a body, even naming the body in select', async () => {
      for (const path of [`/data/sys_email/${invitation.id}`, `/data/sys_email/${invitation.id}?select=id,subject,body_text,body_html`]) {
        const res = await call('orgAdmin', 'GET', path);
        expect(res.text.includes(invitationSpan)).toBe(false);
        if (res.status === 200) expect(hasBodyKey(recordOf(res.json))).toBe(false);
        else expect(res.status).toBe(403);
      }
    });

    it('the organization admin is refused the moved identity row by id, on either log, naming the body or not', async () => {
      for (const path of [
        `/data/sys_identity_email/${reset.id}`,
        `/data/sys_identity_email/${reset.id}?select=id,subject,body_text,body_html`,
        `/data/sys_email/${reset.id}`,
      ]) {
        const res = await call('orgAdmin', 'GET', path);
        expect(res.status, path.split('?')[0]).not.toBe(200);
        expect(res.text.includes(resetSpan)).toBe(false);
      }
    });

    it('the organization admin queries the invitation without a body, and a filter on a body is refused', async () => {
      const byId = await call('orgAdmin', 'POST', '/data/sys_email/query', { where: { id: invitation.id } });
      expect(byId.status).toBe(200);
      expect(rowsOf(byId.json).map((r) => r.id)).toEqual([invitation.id]);
      expect(hasBodyKey(rowsOf(byId.json)[0])).toBe(false);
      // A body predicate would disclose the body by row presence: refused, not answered.
      for (const span of [invitationSpan, resetSpan]) {
        const probe = await call('orgAdmin', 'POST', '/data/sys_email/query', { where: { body_text: { $contains: span } } });
        expect(probe.status).toBe(403);
      }
      const identity = await call('orgAdmin', 'POST', '/data/sys_identity_email/query', { where: { body_text: { $contains: resetSpan } } });
      expect(identity.status).toBe(403);
    });

    it('the platform admin is served the bodies on both logs (control)', async () => {
      for (const [object, mail, span] of [
        ['sys_identity_email', reset, resetSpan],
        ['sys_email', invitation, invitationSpan],
      ] as const) {
        const list = await call('platform', 'GET', `/data/${object}`);
        expect(list.status).toBe(200);
        const row = rowsOf(list.json).find((r) => r.id === mail.id);
        expect(row && BODY_FIELDS.every((f) => typeof row[f] === 'string' && row[f].length > 0), object).toBe(true);
        expect(list.text.includes(span)).toBe(true);
        const probe = await call('platform', 'POST', `/data/${object}/query`, { where: { body_text: { $contains: span } } });
        expect(probe.status).toBe(200);
        expect(rowsOf(probe.json).map((r) => r.id)).toEqual([mail.id]);
      }
    });
  });

  describe('global search', () => {
    const mailHits = (json: any): string[] =>
      (Array.isArray(json?.hits) ? json.hits : [])
        .filter((h: any) => h?.object === 'sys_email' || h?.object === 'sys_identity_email')
        .map((h: any) => String(h.id));
    const terms = () => [[resetSpan, reset.id], [invitationSpan, invitation.id]] as const;

    it.each(['member', 'orgAdmin'] as const)('a body term finds nothing for the %s', async (who) => {
      for (const [span, id] of terms()) {
        const res = await call(who, 'GET', `/search?q=${encodeURIComponent(span)}`);
        expect(res.status).toBe(200);
        expect(mailHits(res.json)).not.toContain(id);
        // The hits only: the body echoes the query term itself.
        expect(JSON.stringify((res.json as any)?.hits ?? []).includes(span)).toBe(false);
      }
    });

    it('the same terms find both rows for the platform admin (control)', async () => {
      for (const [span, id] of terms()) {
        const res = await call('platform', 'GET', `/search?q=${encodeURIComponent(span)}`);
        expect(res.status).toBe(200);
        expect(mailHits(res.json)).toContain(id);
      }
    });
  });

  describe('the mirrors: sys_activity and sys_audit_log of the 18.0 identity row', () => {
    // The ceremony re-pointed the activity rows at the identity log; the
    // pre-fix audit copies keep naming the log the row was written to.
    const parentOf = { sys_activity: 'sys_identity_email', sys_audit_log: 'sys_email' } as const;
    const mirrorPath = (object: 'sys_activity' | 'sys_audit_log') =>
      `/data/${object}?$filter=${filterOf({ object_name: parentOf[object], record_id: reset.id })}`;

    it.each(['sys_activity', 'sys_audit_log'] as const)('%s: the organization admin is served the rows without the body', async (object) => {
      const res = await call('orgAdmin', 'GET', mirrorPath(object));
      expect(res.status).toBe(200);
      expect(res.text.includes(resetSpan)).toBe(false);
    });

    it.each([
      ['sys_activity', 'metadata'],
      ['sys_audit_log', 'new_value'],
    ] as const)('%s: a body probe on the copy is refused to the organization admin, named parent or not', async (object, column) => {
      for (const where of [{ [column]: { $contains: resetSpan } }, { object_name: parentOf[object], [column]: { $contains: resetSpan } }]) {
        expect((await call('orgAdmin', 'POST', `/data/${object}/query`, { where })).status).toBe(403);
      }
    });

    it.each(['sys_activity', 'sys_audit_log'] as const)('%s: a member is served no body', async (object) => {
      const res = await call('member', 'GET', mirrorPath(object));
      expect(res.text.includes(resetSpan)).toBe(false);
    });

    it.each(['sys_activity', 'sys_audit_log'] as const)('%s: the platform admin reads the 18.0 copy (control: the redaction is per reader)', async (object) => {
      const res = await call('platform', 'GET', mirrorPath(object));
      expect(res.status).toBe(200);
      expect(rowsOf(res.json).length).toBeGreaterThan(0);
      expect(res.text.includes(resetSpan)).toBe(true);
    });
  });

  describe('sys_identity_email and the mirror writers on HEAD', () => {
    let identityRow: Row;
    let identitySpan = '';
    let tenantRow: Row;
    let tenantSpan = '';

    beforeAll(async () => {
      // HEAD's own identity mail, through the real door: a password reset.
      const requested = await stack.api('/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: FIXTURE_PEOPLE.memberB.email, redirectTo: '/reset-password' }),
      });
      expect(requested.status).toBe(200);
      [identityRow] = await ql.find('sys_identity_email', { where: {}, orderBy: [{ field: 'created_at', order: 'desc' }], limit: 1, ...SYS });
      expect(identityRow, 'HEAD wrote the reset to the identity log').toBeTruthy();
      identitySpan = credentialSpanOf(identityRow);

      // HEAD's own tenant mail: an organization invitation.
      const before = new Set((await ql.find('sys_email', { where: {}, limit: 100, ...SYS })).map((r: Row) => r.id));
      const invite = await call('platform', 'POST', '/auth/organization/invite-member', {
        email: 'identity-mail-gate.invitee@verify.test', role: 'member', organizationId: invitation.organization_id,
      });
      expect(invite.status).toBe(200);
      tenantRow = (await ql.find('sys_email', { where: {}, limit: 100, ...SYS })).find((r: Row) => !before.has(r.id));
      expect(tenantRow, 'HEAD wrote the invitation to the tenant log').toBeTruthy();
      tenantSpan = credentialSpanOf(tenantRow);
    }, 60_000);

    it.each(['orgAdmin', 'member'] as const)('the %s is refused the identity log', async (who) => {
      const res = await call(who, 'GET', '/data/sys_identity_email');
      expect(res.status).toBe(403);
      expect(res.text.includes(identitySpan)).toBe(false);
    });

    it('the platform admin reads the identity log, bodies included (control)', async () => {
      const res = await call('platform', 'GET', `/data/sys_identity_email/${identityRow.id}`);
      expect(res.status).toBe(200);
      expect(res.text.includes(identitySpan)).toBe(true);
    });

    it.each([
      ['sys_identity_email', () => identityRow, () => identitySpan],
      ['sys_email', () => tenantRow, () => tenantSpan],
    ] as const)('the mirror rows written for a %s row hold no body in clear, at rest', async (object, row, span) => {
      const activity: Row[] = await ql.find('sys_activity', { where: { object_name: object, record_id: row().id }, limit: 50, ...SYS });
      const audit: Row[] = await ql.find('sys_audit_log', { where: { object_name: object, record_id: row().id }, limit: 50, ...SYS });
      // Non-vacuity: the writers did mirror the row.
      expect(activity.length + audit.length).toBeGreaterThan(0);
      expect(JSON.stringify([activity, audit]).includes(span())).toBe(false);
    });
  });
});
