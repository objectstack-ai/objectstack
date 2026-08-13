// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8145, from #7675] `PUT /api/settings/branding` must land on `sys_audit_log`
 * as a `config_change` row — the parent bug's reproduction, INVERTED.
 *
 * ## The reproduction this file owns
 *
 * #7675 step 2, verbatim: *"`PUT /api/settings/branding {"workspace_name":"X"}`
 * → 200, then filter `{"action":"config_change"}` → **total 0**; the event went
 * to `sys_setting_audit` with action `set` instead."* Every declared
 * `config_change` surface was therefore permanently empty — the enum member, the
 * shipped `config_changes` list view, and the console filter that offers the
 * value.
 *
 * The maintainer's 2026-08-12 ruling allowed a dual-write or a reroute and left
 * the choice to the implementation (以实现定契约). This lane chose **dual-write**,
 * so this file asserts BOTH halves of one settings write:
 *
 *   A. a `sys_audit_log` row with `action: 'config_change'` now exists — the
 *      inverted repro, red on `origin/main` at the very first assertion;
 *   B. the `sys_setting_audit` row is STILL written, unchanged — the half that
 *      would silently disappear under a reroute, and the one the platform QA
 *      checklist (`docs/qa/platform-checklist/areas/platform-core.json`) reads.
 *
 * ## Why it has to be here rather than in `service-settings`
 *
 * `sys_audit_log` is `@objectstack/plugin-audit`'s object, and service-settings
 * must not depend on that plugin — the write is best-effort precisely because
 * the plugin is OPTIONAL. So the package's own suite
 * (`packages/services/service-settings/src/config-change-audit.test.ts`) pins
 * the WIRING and the ROW SHAPE at the engine seam, and can see neither the real
 * object, nor its real `action` enum, nor the shipped list view. Only a booted
 * stack with plugin-audit installed can, and only through the real routes is
 * this the reported bug rather than a restatement of the fix. Neither file is
 * sufficient alone.
 *
 * Harness notes:
 *  - `bootStack` installs no audit plugin, so `AuditPlugin` is added here — the
 *    same reason `admin-identity-audit-trail.dogfood.test.ts` adds it.
 *  - The settings route and the audit insert are both awaited inside the
 *    request, but the row is written through a separate engine call, so reads
 *    poll rather than reading once (same shape as the sibling audit fixture).
 *  - NOT eligible for the shared showcase project: it writes org-wide settings.
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
  throw new Error(`${what} — last saw ${rows.length} row(s)`);
}

describe('#8145: a settings write reaches sys_audit_log as config_change', () => {
  let stack: VerifyStack;
  let ql: any;
  let token: string;
  const WORKSPACE_NAME = 'ObjectStack 8145';

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { extraPlugins: [new AuditPlugin()] });
    token = await stack.signIn(); // the seeded dev admin (platform admin)
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    // The parent's step 2, unchanged.
    const put = await stack.raw('/api/settings/branding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspace_name: WORKSPACE_NAME }),
    });
    expect(put.status, await put.clone().text()).toBe(200);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  // ── A. The inverted reproduction ────────────────────────────────────────

  it('the `{"action":"config_change"}` filter returns the event (was total 0)', async () => {
    // Read it exactly as the bug report did: the real REST data route, the real
    // filter, as the real admin — not through the engine.
    const rows = await waitForRows(
      async () => {
        const res = await stack.apiAs(
          token,
          'GET',
          `/data/sys_audit_log?$filter=${encodeURIComponent(JSON.stringify({ action: 'config_change' }))}`,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        return (body?.data ?? body?.records ?? []) as any[];
      },
      (r) => r.length >= 1,
      'expected at least one config_change row after PUT /api/settings/branding',
    );

    // `total 0` on `origin/main` — this is the assertion the card inverts.
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const mine = rows.filter((r) => String(r.metadata ?? '').includes('"key":"workspace_name"'));
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const row = mine[0];
    expect(row.action).toBe('config_change');
    expect(row.object_name).toBe('sys_setting');
    // The admin who made the call is attributed on both channels (ADR-0014 D2).
    expect(row.user_id).toBeTruthy();
    expect(row.actor).toBe(row.user_id);

    const meta = JSON.parse(String(row.metadata));
    expect(meta).toMatchObject({
      event: 'settings.set',
      namespace: 'branding',
      key: 'workspace_name',
      encrypted: false,
    });
    // A digest, never the value — the ledger describes the change, not the data.
    expect(JSON.parse(String(row.new_value)).digest).toBeTruthy();
  });

  it('the shipped `config_changes` list view — its OWN declared filter — now matches', async () => {
    // The view's filter is read off the registered object rather than retyped,
    // so this cannot pass against a filter that agrees only with this test. It
    // is `action IN ['config_change','import']` today; whatever it becomes, the
    // question stays "does the shipped view return rows".
    const schema: any = ql.getSchema('sys_audit_log');
    const view = schema?.listViews?.config_changes;
    expect(view, 'the config_changes list view must still be declared').toBeTruthy();

    const clause = (view.filter ?? []).find((f: any) => f.field === 'action');
    expect(clause?.operator).toBe('in');
    expect(clause.value).toContain('config_change');

    const rows = await findRows(ql, 'sys_audit_log', { action: { $in: clause.value } });
    // Empty for the whole life of the enum member before this card.
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.action === 'config_change')).toBe(true);
  });

  // ── B. Dual-write: the settings-specific ledger is untouched ─────────────

  it('`sys_setting_audit` still records the same write (dual-write, not reroute)', async () => {
    const rows = await waitForRows(
      () => findRows(ql, 'sys_setting_audit', { namespace: 'branding', key: 'workspace_name' }),
      (r) => r.length >= 1,
      'expected the pre-existing sys_setting_audit row to still be written',
    );

    // Asserted as a PRESENCE against real stored rows: a reroute would empty
    // this table, and an "unchanged" claim measured on a fixture that never
    // wrote here would pass emptily.
    const row = rows[0];
    expect(row.action).toBe('set');
    expect(row.source).toBe('api');
    expect(row.scope).toBeTruthy();
    expect(row.new_hash).toBeTruthy();

    // The two rows are complements, not copies: each carries what the other's
    // columns cannot hold.
    const ledger = await findRows(ql, 'sys_audit_log', { action: 'config_change' });
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    expect(row.object_name).toBeUndefined();
    expect(ledger[0].new_hash).toBeUndefined();
  });

  it('the setting itself is readable back — the audit is a complement, not the write', async () => {
    // The settings routes are mounted at `/api/settings`, outside `/api/v1`.
    const res = await stack.raw('/api/settings/branding', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.values.workspace_name.value).toBe(WORKSPACE_NAME);
  });
});
