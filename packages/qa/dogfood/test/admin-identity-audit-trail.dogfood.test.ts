// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4940] What `sys_audit_log` actually holds after an admin identity
 * operation — measured on the real routes, with plugin-audit installed.
 *
 * Why this file exists. Two comments in `plugin-auth` justified their explicit
 * `sys_audit_log` insert with a mechanism claim: *"better-auth writes bypass
 * the ObjectQL lifecycle hooks that plugin-audit subscribes to, so admin
 * identity operations would otherwise leave no compliance trail."* That is the
 * same stale claim #4802 refuted one layer up (`AuthManagerOptions.
 * databaseHooks`): better-auth's adapter writes through the ordinary
 * `dataEngine.insert(...)`, `ObjectQL.insert()` fires `triggerHooks(
 * 'afterInsert')` inside `executeWithMiddleware()`, and plugin-audit registers
 * `writeAudit` as a bare `engine.registerHook('afterInsert', …)` with no
 * object filter. The hooks fire.
 *
 * The explicit rows are nevertheless CORRECT — for different reasons, which is
 * exactly why the claim being wrong is dangerous rather than harmless: the next
 * person to read it either deletes a row that is load-bearing, or keeps one for
 * a reason that will not survive contact with the code. So the reasons are
 * pinned here as measurements rather than left as prose:
 *
 *   W1  `sys_user` is NOT in plugin-audit's `SKIP_OBJECTS` → the generic writer
 *       DOES produce a row for a better-auth-created user. This is the
 *       refutation: an assertion that fails if the bypass claim were true.
 *   W2  …and the explicit row is a SECOND row on the same record. The overlap
 *       is real, measured, and accepted — the two carry disjoint payloads.
 *   W3  `sys_account` IS in `SKIP_OBJECTS` → the credential write behind
 *       `/admin/set-user-password` produces NO generic row. The explicit row is
 *       the only trail that a password was administratively reset. This is the
 *       reason that would be silently destroyed by "the hook covers it, drop
 *       the explicit insert".
 *   W4  The import's run-level row is `action: 'import'` with `record_id: null`
 *       — a shape plugin-audit's `actionFor` structurally cannot emit (it maps
 *       afterInsert/Update/Delete → create/update/delete and nothing else),
 *       alongside the per-row rows the hook does write.
 *
 * Harness notes:
 *  - `bootStack` installs no audit plugin, so `AuditPlugin` is added here —
 *    that is what turns better-auth's writes into generic audit rows at all.
 *  - The admin identity routes 501 unless better-auth's `admin` plugin is on,
 *    and `bootStack` exposes no auth-plugin override. `OS_SCIM_ENABLED` is the
 *    one env knob that reaches it: `AuthManager.buildPluginList` resolves
 *    `admin: pluginConfig.admin ?? scimEffective` (SCIM forces admin on), so
 *    this is a deliberate, documented derivation rather than a coincidence.
 *    Same shape as `two-factor-lockout.dogfood.test.ts`'s `OS_AUTH_TWO_FACTOR`:
 *    read when the auth manager is constructed, so it must precede `bootStack`.
 *  - Generic audit rows land ASYNCHRONOUSLY (better-auth may settle its writes
 *    after the response), so every read polls rather than reading once.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';

const SYSTEM_CTX = { isSystem: true };

async function findRows(ql: any, object: string, where: any, limit = 200): Promise<any[]> {
  const rows = await ql.find(object, { where, limit }, { context: SYSTEM_CTX });
  return Array.isArray(rows) ? rows : (rows?.records ?? []);
}

/** Audit rows recorded against one `sys_user` record. */
async function userAudit(ql: any, userId: string): Promise<any[]> {
  return findRows(ql, 'sys_audit_log', { object_name: 'sys_user', record_id: userId });
}

/** Poll until `predicate` holds over the rows, then return them. */
async function waitForRows(
  load: () => Promise<any[]>,
  predicate: (rows: any[]) => boolean,
  what: string,
): Promise<any[]> {
  let rows: any[] = [];
  for (let i = 0; i < 40; i++) {
    rows = await load();
    if (predicate(rows)) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what} — last saw ${rows.length} row(s): ${JSON.stringify(rows.map((r) => ({ a: r.action, m: r.metadata })))}`);
}

/** The row this endpoint writes itself: structured `metadata`, no field diff. */
const isExplicit = (row: any, event: string): boolean =>
  typeof row.metadata === 'string' && row.metadata.includes(event);

/** plugin-audit's generic row: a field diff, never a structured `metadata`. */
const isGeneric = (row: any): boolean => row.metadata == null;

describe('#4940: what an admin identity operation leaves in sys_audit_log', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminToken: string;
  let adminUserId: string;
  let priorScim: string | undefined;

  beforeAll(async () => {
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootStack(showcaseStack, { extraPlugins: [new AuditPlugin()] });
    adminToken = await stack.signIn(); // the seeded dev admin (platform admin)
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    const [admin] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
    adminUserId = String(admin.id);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  // ── W1 + W2: create-user writes TWO create rows, not one ────────────────

  it('POST /admin/create-user: plugin-audit\'s hook fires for the better-auth write, alongside the explicit row', async () => {
    const email = 'audited.4940@example.com';
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      name: 'Audited 4940',
      password: 'Audited!Pass123',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const userId = String((await res.json()).data.user.id);

    const creates = await waitForRows(
      async () => (await userAudit(ql, userId)).filter((r) => r.action === 'create'),
      (rows) => rows.length >= 2,
      'expected both a generic and an explicit create row',
    );

    // W1 — THE REFUTATION. If better-auth's writes really bypassed the
    // lifecycle hooks plugin-audit subscribes to, this row could not exist:
    // nothing but `engine.registerHook('afterInsert', writeAudit)` writes it.
    // It carries a full row snapshot in `new_value` and no `metadata`.
    const generic = creates.filter(isGeneric);
    expect(generic).toHaveLength(1);
    expect(String(generic[0].new_value)).toContain(email);

    // W2 — and the endpoint's own row is a SECOND row on the same record.
    // Kept deliberately: it records the admin's DECISIONS, none of which is
    // derivable from a field diff of the created row.
    const explicit = creates.filter((r) => isExplicit(r, 'user.admin_created'));
    expect(explicit).toHaveLength(1);
    expect(explicit[0].user_id).toBe(adminUserId);
    expect(String(explicit[0].metadata)).toContain('"mustChangePassword":true');
    expect(String(explicit[0].metadata)).toContain('"passwordGenerated":false');
    // The overlap is exactly two — measured, so a third writer appearing on
    // this path is a finding rather than a silent extra ledger row.
    expect(creates).toHaveLength(2);

    // Neither row is allowed to carry password material (the red line).
    for (const row of creates) {
      const blob = `${row.metadata ?? ''}${row.new_value ?? ''}${row.old_value ?? ''}`;
      expect(blob).not.toContain('Audited!Pass123');
    }
  }, 120_000);

  // ── W3: the credential write is invisible to plugin-audit ───────────────

  it('POST /admin/set-user-password: sys_account is in SKIP_OBJECTS, so the explicit row is the ONLY trail', async () => {
    const email = 'audited.pw.4940@example.com';
    const created = await stack.apiAs(adminToken, 'POST', '/auth/admin/create-user', {
      email,
      name: 'Audited PW 4940',
      password: 'Audited!Pass123',
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const userId = String((await created.json()).data.user.id);
    await waitForRows(
      async () => (await userAudit(ql, userId)).filter((r) => r.action === 'create'),
      (rows) => rows.length >= 2,
      'create rows for the password subject',
    );

    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/set-user-password', {
      userId,
      newPassword: 'Rotated!Pass456',
    });
    expect(res.status, await res.clone().text()).toBe(200);

    // The endpoint's own row — `action: 'update'` on `sys_user`, naming the
    // admin who reset the password.
    const [explicit] = await waitForRows(
      async () => (await userAudit(ql, userId)).filter((r) => isExplicit(r, 'user.admin_password_set')),
      (rows) => rows.length === 1,
      'the explicit password-reset row',
    );
    expect(explicit.action).toBe('update');
    expect(explicit.user_id).toBe(adminUserId);
    expect(String(explicit.metadata)).not.toContain('Rotated!Pass456');

    // W3 — the write this endpoint actually made is on `sys_account` (the
    // credential row), and `sys_account` is in plugin-audit's SKIP_OBJECTS.
    // Measured: ZERO generic rows for it. Delete the explicit insert on the
    // strength of "the hook covers it" and an administrative password reset
    // becomes untraceable — which is the concrete cost of the wrong comment.
    const accounts = await findRows(ql, 'sys_account', { user_id: userId });
    expect(accounts.length).toBeGreaterThan(0);
    expect(await findRows(ql, 'sys_audit_log', { object_name: 'sys_account' })).toHaveLength(0);
    for (const account of accounts) {
      expect(await findRows(ql, 'sys_audit_log', { record_id: String(account.id) })).toHaveLength(0);
    }
  }, 120_000);

  // ── W4: the run-level row is a shape the generic writer cannot emit ─────

  it('POST /admin/import-users: the run-level row complements the per-row rows the hook writes', async () => {
    const email = 'imported.4940@example.com';
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/import-users', {
      format: 'json',
      rows: [{ email, name: 'Imported 4940' }],
      passwordPolicy: 'temporary',
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json();
    expect(body.data.summary.created).toBe(1);
    const importedId = String(body.data.rows[0].id);

    // The hook DOES cover each imported row — same refutation as W1, on the
    // second of the two call sites whose comment claimed otherwise.
    const perRow = await waitForRows(
      async () => (await userAudit(ql, importedId)).filter((r) => r.action === 'create' && isGeneric(r)),
      (rows) => rows.length === 1,
      "plugin-audit's per-row create row for the imported user",
    );
    expect(String(perRow[0].new_value)).toContain(email);
    // The import writes NO explicit per-row audit row of its own.
    expect((await userAudit(ql, importedId)).filter((r) => !isGeneric(r))).toHaveLength(0);

    // W4 — what the import writes instead: one run-level row per run.
    // `action: 'import'` with `record_id: null` is outside plugin-audit's
    // vocabulary entirely (`actionFor` emits only create/update/delete), so
    // this is complement, not duplication — and it answers a question no
    // per-row ledger can: who ran which import, and what did it do overall.
    const runRows = await waitForRows(
      () => findRows(ql, 'sys_audit_log', { action: 'import' }),
      (rows) => rows.length === 1,
      'the run-level import row',
    );
    expect(runRows[0].object_name).toBe('sys_user');
    expect(runRows[0].record_id).toBeNull();
    expect(runRows[0].user_id).toBe(adminUserId);
    const metadata = JSON.parse(String(runRows[0].metadata));
    expect(metadata.event).toBe('user.import_run');
    expect(metadata).toMatchObject({ total: 1, created: 1, updated: 0, skipped: 0, errors: 0 });
    expect(metadata.delivery).toMatchObject({ temporary: 1 });
  }, 120_000);
});
