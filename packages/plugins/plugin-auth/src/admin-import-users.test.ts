// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { runAdminImportUsers, IMPORT_USERS_MAX_ROWS, type IdentityImportDeps } from './admin-import-users.js';
import type { AdminActor } from './admin-user-endpoints.js';

const ACTOR: AdminActor = { id: 'admin-1', email: 'admin@example.com' };

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/auth/admin/import-users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeps(opts: {
  existingUsers?: Array<Record<string, any>>;
  phoneEnabled?: boolean;
  emailAvailable?: boolean;
  smsInviteAvailable?: boolean;
  resetFails?: boolean;
  smsFails?: boolean;
} = {}) {
  const existing = opts.existingUsers ?? [];
  let nextId = 1;
  const createUser = vi.fn(async ({ body }: any) => ({
    user: { id: `u-${nextId++}`, email: body.email, name: body.name },
  }));
  const requestPasswordReset = vi.fn(async () => {
    if (opts.resetFails) throw new Error('smtp down');
    return { status: true };
  });
  const find = vi.fn(async (_obj: string, q: any) => {
    const where = q?.where ?? {};
    return existing.filter((u) => Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return u[k] === v; }));
  });
  const update = vi.fn(async (_obj: string, data: any, options?: any) => {
    assertEngineUpdateDispatch(data, options);
    return {};
  });
  const insert = vi.fn(async () => ({}));
  const warn = vi.fn();
  const noteMustChangePasswordIssued = vi.fn();
  const sendInviteSms = vi.fn(async () => {
    if (opts.smsFails) throw new Error('sms provider down');
  });
  const deps: IdentityImportDeps = {
    getAuthApi: async () => ({ createUser, requestPasswordReset }),
    getDataEngine: () => ({ find, update, insert }),
    phoneNumberEnabled: () => opts.phoneEnabled ?? false,
    emailServiceAvailable: () => opts.emailAvailable ?? true,
    smsInviteAvailable: () => opts.smsInviteAvailable ?? false,
    sendInviteSms,
    noteMustChangePasswordIssued,
    logger: { warn },
  };
  return { deps, createUser, requestPasswordReset, sendInviteSms, find, update, insert, warn, noteMustChangePasswordIssued };
}

/** Red line: no generated password may reach any persistence/log surface. */
function expectNoPasswordLeak(m: ReturnType<typeof makeDeps>, passwords: string[]) {
  const surfaces = JSON.stringify([m.insert.mock.calls, m.update.mock.calls, m.warn.mock.calls]);
  for (const pw of passwords) {
    if (typeof pw === 'string' && pw.length > 0) expect(surfaces).not.toContain(pw);
  }
}

describe('runAdminImportUsers — request validation', () => {
  it('rejects an unknown passwordPolicy', async () => {
    const m = makeDeps();
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'plaintext', format: 'json', rows: [] }),
      ACTOR,
    );
    expect(res.status).toBe(400);
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it('defaults to the auto policy when passwordPolicy is omitted (#3236)', async () => {
    const m = makeDeps(); // email service available, no SMS
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ format: 'json', rows: [{ email: 'a@b.co' }] }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.summary.passwordPolicy).toBe('auto');
    // A deliverable email row is invited, not handed a temporary password.
    expect(m.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(data.rows[0].delivery).toBe('email');
    expect(data.rows[0].temporaryPassword).toBeUndefined();
    expect(data.summary.delivery).toEqual({ emailInvite: 1, smsInvite: 0, temporary: 0 });
  });

  it('rejects matchBy phone when the phoneNumber plugin is off', async () => {
    const m = makeDeps({ phoneEnabled: false });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'temporary', mode: 'upsert', matchBy: 'phone', format: 'json', rows: [] }),
      ACTOR,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('PHONE_NOT_ENABLED');
  });

  it('rejects the invite policy without an email service', async () => {
    const m = makeDeps({ emailAvailable: false });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'invite', format: 'json', rows: [{ email: 'a@b.co' }] }),
      ACTOR,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('EMAIL_SERVICE_REQUIRED');
    expect(m.createUser).not.toHaveBeenCalled();
  });

  it('rejects async: true explicitly (not silently)', async () => {
    const m = makeDeps();
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'temporary', async: true, format: 'json', rows: [{ email: 'a@b.co' }] }),
      ACTOR,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('ASYNC_NOT_SUPPORTED');
  });

  it('rejects payloads above the row cap with 413', async () => {
    const m = makeDeps();
    const rows = Array.from({ length: IMPORT_USERS_MAX_ROWS + 1 }, (_, i) => ({ email: `u${i}@x.co` }));
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'temporary', format: 'json', rows }),
      ACTOR,
    );
    expect(res.status).toBe(413);
    expect(m.createUser).not.toHaveBeenCalled();
  });
});

describe('runAdminImportUsers — row validation (also on dryRun)', () => {
  it('flags invite rows without a real email as INVITE_REQUIRES_EMAIL', async () => {
    const m = makeDeps({ phoneEnabled: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'invite', dryRun: true, format: 'json',
        rows: [
          { email: 'ok@x.co', name: 'OK' },
          { phone_number: '+8613800000000', name: 'PhoneOnly' },
          { name: 'Nobody' },
          { email: 'u-aaaaaaaaaaaaaaaaaaaa@placeholder.invalid' },
          { email: 'not-an-email' },
        ],
      }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const rows = (res.body.data as any).rows;
    expect(rows[0].action).toBe('created'); // dryRun projection
    expect(rows[1].code).toBe('INVITE_REQUIRES_EMAIL');
    expect(rows[2].code).toBe('NO_IDENTITY');
    expect(rows[3].code).toBe('INVALID_EMAIL');
    expect(rows[4].code).toBe('INVALID_EMAIL');
    expect((res.body.data as any).summary.errors).toBe(4);
    // dryRun writes nothing
    expect(m.createUser).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it('flags phone columns when the plugin is off, and bad phone formats', async () => {
    const m = makeDeps({ phoneEnabled: false });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'temporary', dryRun: true, format: 'json',
        rows: [{ phone_number: '+8613800000000' }],
      }),
      ACTOR,
    );
    expect((res.body.data as any).rows[0].code).toBe('PHONE_NOT_ENABLED');

    const m2 = makeDeps({ phoneEnabled: true });
    const res2 = await runAdminImportUsers(
      m2.deps,
      makeRequest({
        passwordPolicy: 'temporary', dryRun: true, format: 'json',
        rows: [{ phone_number: 'junk' }],
      }),
      ACTOR,
    );
    expect((res2.body.data as any).rows[0].code).toBe('INVALID_PHONE');
  });
});

describe('runAdminImportUsers — none policy (default: identity only, no credentials)', () => {
  it('creates credential-less accounts: no password sent to better-auth, no stamps, no invitations', async () => {
    const m = makeDeps({ phoneEnabled: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'none', format: 'json',
        rows: [
          { email: 'a@x.co', name: 'A' },
          { phone_number: '+8613800000001', name: 'B' },
        ],
      }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.summary.created).toBe(2);
    expect(data.summary.passwordPolicy).toBe('none');

    // better-auth receives NO password key at all → credential-less account.
    for (const call of m.createUser.mock.calls) {
      expect('password' in call[0].body).toBe(false);
    }
    // Phone-only row still gets a placeholder email.
    expect(m.createUser.mock.calls[1][0].body.email).toMatch(/@placeholder\.invalid$/);

    // No must_change_password stamps, no temporary passwords, no invitations.
    expect(m.update.mock.calls.filter((c) => c[1]?.must_change_password === true).length).toBe(0);
    expect(m.noteMustChangePasswordIssued).not.toHaveBeenCalled();
    expect(data.rows.every((r: any) => r.temporaryPassword === undefined)).toBe(true);
    expect(m.requestPasswordReset).not.toHaveBeenCalled();
    expect(m.sendInviteSms).not.toHaveBeenCalled();
  });

  it('does not require an email or SMS service (unlike invite)', async () => {
    const m = makeDeps({ emailAvailable: false, smsInviteAvailable: false });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'none', format: 'json', rows: [{ email: 'a@b.co' }] }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect((res.body.data as any).summary.created).toBe(1);
  });
});

describe('runAdminImportUsers — temporary policy', () => {
  it('creates each row through better-auth, stamps must_change_password, returns per-row temp passwords once', async () => {
    const m = makeDeps({ phoneEnabled: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'temporary', format: 'json',
        rows: [
          { email: 'a@x.co', name: 'A' },
          { phone_number: '+8613800000001', name: 'B' },
        ],
      }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.summary.created).toBe(2);
    expect(m.createUser).toHaveBeenCalledTimes(2);

    // Row 1: real email; row 2: placeholder that never contains the phone.
    const sent1 = m.createUser.mock.calls[0][0].body;
    const sent2 = m.createUser.mock.calls[1][0].body;
    expect(sent1.email).toBe('a@x.co');
    expect(typeof sent1.password).toBe('string');
    expect(sent2.email).toMatch(/@placeholder\.invalid$/);
    expect(sent2.email).not.toContain('138');
    expect(sent2.data.phoneNumber).toBe('+8613800000001');

    // must_change_password stamped per created user + gate cache primed.
    const stamps = m.update.mock.calls.filter((c) => c[1]?.must_change_password === true);
    expect(stamps.length).toBe(2);
    expect(m.noteMustChangePasswordIssued).toHaveBeenCalled();

    // Temp passwords: response-only, one per row, and they are the ones sent
    // to better-auth for hashing.
    const pw1 = data.rows[0].temporaryPassword;
    const pw2 = data.rows[1].temporaryPassword;
    expect(pw1).toBe(sent1.password);
    expect(pw2).toBe(sent2.password);
    expectNoPasswordLeak(m, [pw1, pw2]);

    // No invitation emails under the temporary policy.
    expect(m.requestPasswordReset).not.toHaveBeenCalled();

    // Run-level audit row without password material.
    const audit = m.insert.mock.calls.find((c) => c[0] === 'sys_audit_log');
    expect(audit).toBeTruthy();
    const meta = JSON.parse(audit![1].metadata);
    expect(meta.event).toBe('user.import_run');
    expect(meta.created).toBe(2);
  });
});

describe('runAdminImportUsers — invite policy', () => {
  it('creates with a throwaway password and requests a reset email per created row', async () => {
    const m = makeDeps();
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'invite', format: 'json',
        rows: [{ email: 'a@x.co' }, { email: 'b@x.co' }],
      }),
      ACTOR,
    );
    const data = res.body.data as any;
    expect(data.summary.created).toBe(2);
    expect(m.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(m.requestPasswordReset.mock.calls.map((c) => c[0].body.email).sort()).toEqual(['a@x.co', 'b@x.co']);
    // The throwaway password is not returned to the caller.
    expect(data.rows[0].temporaryPassword).toBeUndefined();
    // No must-change stamp for invite (users set their own password).
    expect(m.update.mock.calls.filter((c) => c[1]?.must_change_password === true).length).toBe(0);
    expectNoPasswordLeak(m, m.createUser.mock.calls.map((c) => c[0].body.password));
  });

  it('keeps the row created (with INVITE_EMAIL_FAILED) when the email fails — no rollback', async () => {
    const m = makeDeps({ resetFails: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'invite', format: 'json', rows: [{ email: 'a@x.co' }] }),
      ACTOR,
    );
    const row = (res.body.data as any).rows[0];
    expect(row.ok).toBe(true);
    expect(row.action).toBe('created');
    expect(row.code).toBe('INVITE_EMAIL_FAILED');
    expect((res.body.data as any).summary.created).toBe(1);
  });

  // #2780 — SMS invite variant for phone-only rows.
  it('sends an SMS invite (not a reset email) to phone-only rows when SMS is available', async () => {
    const m = makeDeps({ phoneEnabled: true, smsInviteAvailable: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'invite', format: 'json',
        rows: [
          { email: 'a@x.co', name: 'Mail' },
          { phone_number: '+86 138 0000 0002', name: 'PhoneOnly' },
        ],
      }),
      ACTOR,
    );
    const data = res.body.data as any;
    expect(data.summary.created).toBe(2);
    // Email row → reset email; phone-only row → invitation SMS to the
    // NORMALIZED number, never a reset email to the placeholder address.
    expect(m.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(m.requestPasswordReset.mock.calls[0][0].body.email).toBe('a@x.co');
    expect(m.sendInviteSms).toHaveBeenCalledTimes(1);
    expect(m.sendInviteSms.mock.calls[0][0]).toBe('+8613800000002');
    // The phone-only account got a placeholder email that never leaks the phone.
    const phoneCreate = m.createUser.mock.calls.find((c) => c[0].body?.data?.phoneNumber);
    expect(phoneCreate![0].body.email).toMatch(/@placeholder\.invalid$/);
    // No temp passwords under invite.
    expect(data.rows.every((r: any) => r.temporaryPassword === undefined)).toBe(true);
  });

  it('keeps the row created (with INVITE_SMS_FAILED) when the SMS fails — no rollback', async () => {
    const m = makeDeps({ phoneEnabled: true, smsInviteAvailable: true, smsFails: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'invite', format: 'json', rows: [{ phone_number: '+8613800000003' }] }),
      ACTOR,
    );
    const row = (res.body.data as any).rows[0];
    expect(row.ok).toBe(true);
    expect(row.action).toBe('created');
    expect(row.code).toBe('INVITE_SMS_FAILED');
    expect((res.body.data as any).summary.created).toBe(1);
  });

  it('with SMS but no email service: phone-only rows invite, email rows fail per-row', async () => {
    const m = makeDeps({ phoneEnabled: true, emailAvailable: false, smsInviteAvailable: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'invite', format: 'json',
        rows: [
          { email: 'a@x.co' },
          { phone_number: '+8613800000004' },
        ],
      }),
      ACTOR,
    );
    expect(res.status).toBe(200); // not rejected outright — one channel works
    const rows = (res.body.data as any).rows;
    expect(rows[0].code).toBe('EMAIL_SERVICE_REQUIRED');
    expect(rows[1].action).toBe('created');
    expect(m.sendInviteSms).toHaveBeenCalledTimes(1);
    expect(m.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('still rejects invite outright when NEITHER email nor SMS is wired', async () => {
    const m = makeDeps({ phoneEnabled: true, emailAvailable: false, smsInviteAvailable: false });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'invite', format: 'json', rows: [{ phone_number: '+8613800000005' }] }),
      ACTOR,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('EMAIL_SERVICE_REQUIRED');
    expect(m.createUser).not.toHaveBeenCalled();
  });
});

// #3236 — `auto` prefers the invite path per row and only falls back to a
// temporary password for rows with no deliverable channel. Unlike `invite`, it
// never rejects the request for missing infrastructure.
describe('runAdminImportUsers — auto policy (default)', () => {
  it('invites deliverable rows and falls back to temporary only for the unreachable ones — in ONE batch', async () => {
    // Email service up, SMS down. Row 1: real email → email invite. Row 2:
    // phone-only with no SMS → temporary fallback (the ONLY row that gets a
    // shared secret). That per-row split is the whole point of #3236.
    const m = makeDeps({ phoneEnabled: true, emailAvailable: true, smsInviteAvailable: false });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'auto', format: 'json',
        rows: [
          { email: 'reachable@x.co', name: 'Mail' },
          { phone_number: '+8613800000001', name: 'PhoneOnly' },
        ],
      }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.summary.created).toBe(2);
    expect(data.summary.passwordPolicy).toBe('auto');

    // Row 1 invited by email; no temporary password.
    expect(m.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(m.requestPasswordReset.mock.calls[0][0].body.email).toBe('reachable@x.co');
    expect(data.rows[0].delivery).toBe('email');
    expect(data.rows[0].temporaryPassword).toBeUndefined();

    // Row 2 fell back to temporary: a returned password + must_change stamp.
    expect(m.sendInviteSms).not.toHaveBeenCalled();
    expect(typeof data.rows[1].temporaryPassword).toBe('string');
    expect(data.rows[1].delivery).toBe('temporary');
    const stamps = m.update.mock.calls.filter((c) => c[1]?.must_change_password === true);
    expect(stamps.length).toBe(1);
    expect(m.noteMustChangePasswordIssued).toHaveBeenCalled();

    // Breakdown surfaced on the summary — one invite, one fallback.
    expect(data.summary.delivery).toEqual({ emailInvite: 1, smsInvite: 0, temporary: 1 });
    expectNoPasswordLeak(m, [data.rows[1].temporaryPassword]);
  });

  it('uses the SMS invite path for phone-only rows when SMS is wired', async () => {
    const m = makeDeps({ phoneEnabled: true, emailAvailable: true, smsInviteAvailable: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'auto', format: 'json',
        rows: [
          { email: 'a@x.co' },
          { phone_number: '+86 138 0000 0002' },
        ],
      }),
      ACTOR,
    );
    const data = res.body.data as any;
    expect(data.summary.created).toBe(2);
    // Email row → reset email; phone-only row → SMS invite. No temp passwords.
    expect(m.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(m.sendInviteSms).toHaveBeenCalledTimes(1);
    expect(m.sendInviteSms.mock.calls[0][0]).toBe('+8613800000002');
    expect(data.rows.every((r: any) => r.temporaryPassword === undefined)).toBe(true);
    expect(data.rows[0].delivery).toBe('email');
    expect(data.rows[1].delivery).toBe('sms');
    expect(data.summary.delivery).toEqual({ emailInvite: 1, smsInvite: 1, temporary: 0 });
  });

  it('never rejects for missing infrastructure — with no channels wired every row degrades to temporary', async () => {
    const m = makeDeps({ phoneEnabled: true, emailAvailable: false, smsInviteAvailable: false });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'auto', format: 'json',
        rows: [
          { email: 'a@x.co' },
          { phone_number: '+8613800000003' },
        ],
      }),
      ACTOR,
    );
    // Contrast with `invite`, which 400s here. `auto` provisions everyone.
    expect(res.status).toBe(200);
    const data = res.body.data as any;
    expect(data.summary.created).toBe(2);
    expect(m.requestPasswordReset).not.toHaveBeenCalled();
    expect(m.sendInviteSms).not.toHaveBeenCalled();
    expect(data.rows.every((r: any) => typeof r.temporaryPassword === 'string')).toBe(true);
    expect(data.rows.every((r: any) => r.delivery === 'temporary')).toBe(true);
    expect(data.summary.delivery).toEqual({ emailInvite: 0, smsInvite: 0, temporary: 2 });
    expectNoPasswordLeak(m, data.rows.map((r: any) => r.temporaryPassword));
  });

  it('surfaces INVITE_EMAIL_FAILED (no rollback) when a chosen email invite fails', async () => {
    const m = makeDeps({ resetFails: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'auto', format: 'json', rows: [{ email: 'a@x.co' }] }),
      ACTOR,
    );
    const row = (res.body.data as any).rows[0];
    expect(row.ok).toBe(true);
    expect(row.action).toBe('created');
    expect(row.code).toBe('INVITE_EMAIL_FAILED');
    expect(row.delivery).toBe('email');
    // A failed invite is NOT silently downgraded to a temporary password.
    expect(row.temporaryPassword).toBeUndefined();
  });

  it('writes nothing on dryRun but still projects the per-row plan', async () => {
    const m = makeDeps({ phoneEnabled: true, emailAvailable: true, smsInviteAvailable: false });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'auto', dryRun: true, format: 'json',
        rows: [{ email: 'a@x.co' }, { phone_number: '+8613800000006' }],
      }),
      ACTOR,
    );
    expect(res.status).toBe(200);
    expect(m.createUser).not.toHaveBeenCalled();
    expect(m.requestPasswordReset).not.toHaveBeenCalled();
    expect(m.sendInviteSms).not.toHaveBeenCalled();
    // dryRun does not deliver, so no per-row delivery is stamped.
    expect((res.body.data as any).summary.delivery).toEqual({ emailInvite: 0, smsInvite: 0, temporary: 0 });
  });
});

describe('runAdminImportUsers — upsert', () => {
  it('matches by email: updates profile fields only, never credentials or email', async () => {
    const m = makeDeps({
      existingUsers: [{ id: 'u-old', email: 'a@x.co', name: 'Old Name' }],
    });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'temporary', mode: 'upsert', matchBy: 'email', format: 'json',
        rows: [
          { email: 'a@x.co', name: 'New Name', password: 'Injected1!' }, // password column must be ignored
          { email: 'new@x.co', name: 'Fresh' },
        ],
      }),
      ACTOR,
    );
    const data = res.body.data as any;
    expect(data.summary.updated).toBe(1);
    expect(data.summary.created).toBe(1);

    // The existing user was patched with name only — no email, no password.
    const patch = m.update.mock.calls.find((c) => c[1]?.id === 'u-old');
    expect(patch).toBeTruthy();
    expect(patch![1]).toEqual({ id: 'u-old', name: 'New Name' });

    // The updated row never went through createUser; the new row did.
    expect(m.createUser).toHaveBeenCalledTimes(1);
    expect(m.createUser.mock.calls[0][0].body.email).toBe('new@x.co');

    // Updated (existing) users never get a temporary password back.
    expect(data.rows[0].temporaryPassword).toBeUndefined();
    expect(typeof data.rows[1].temporaryPassword).toBe('string');
  });

  it('matches by phone_number when enabled', async () => {
    const m = makeDeps({
      phoneEnabled: true,
      existingUsers: [{ id: 'u-p', email: 'p@x.co', phone_number: '+8613800000009', name: 'P' }],
    });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'temporary', mode: 'upsert', matchBy: 'phone', format: 'json',
        rows: [{ phone_number: '+86 138 0000 0009', name: 'P2' }],
      }),
      ACTOR,
    );
    const data = res.body.data as any;
    expect(data.summary.updated).toBe(1);
    expect(m.find).toHaveBeenCalledWith('sys_user', expect.objectContaining({
      where: { phone_number: '+8613800000009' },
    }));
  });

  it('skips upsert rows whose match key is blank instead of creating duplicates', async () => {
    const m = makeDeps({ phoneEnabled: true });
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({
        passwordPolicy: 'temporary', mode: 'upsert', matchBy: 'phone', format: 'json',
        rows: [{ email: 'email-only@x.co', name: 'NoPhone' }],
      }),
      ACTOR,
    );
    const row = (res.body.data as any).rows[0];
    expect(row.action).toBe('skipped');
    expect(m.createUser).not.toHaveBeenCalled();
  });
});

describe('runAdminImportUsers — CSV payloads', () => {
  it('accepts the same CSV shape as the generic import route', async () => {
    const m = makeDeps();
    const csv = 'email,name\nc1@x.co,C One\nc2@x.co,C Two\n';
    const res = await runAdminImportUsers(
      m.deps,
      makeRequest({ passwordPolicy: 'temporary', csv }),
      ACTOR,
    );
    const data = res.body.data as any;
    expect(data.summary.created).toBe(2);
    expect(m.createUser.mock.calls.map((c) => c[0].body.email).sort()).toEqual(['c1@x.co', 'c2@x.co']);
  });
});
