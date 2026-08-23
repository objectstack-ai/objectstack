// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10681 — the one-shot 2FA reveal, pinned as a CLASS on the surface a user
 * can actually reach.
 *
 * ## What the defect was, and why the obvious test would not have caught it
 *
 * `sys_user.generate_backup_codes` toasted "New backup codes generated — save
 * them somewhere safe", issued the request, and dropped the response. The
 * previous code set dies the instant that request succeeds, so the reachable
 * path was: old codes destroyed, new codes discarded into a toast, no way to
 * get them back. `sys_two_factor` carried correct `resultDialog` declarations
 * the whole time — and is mounted in NO app, which is exactly why nobody saw
 * it. A per-action assertion that `generate_backup_codes.resultDialog` is
 * defined would re-state the diff and would not have caught the original bug
 * either, because the bug was never "this key is missing" — it was "the key is
 * present on the copy nobody can reach".
 *
 * So this file pins the two facts that actually decide whether a user sees
 * their codes, and pins them over a DERIVED set rather than a literal one:
 *
 *   1. REACHABILITY — the chain from the Setup navigation down to the action
 *      name is walked here, not assumed. If `nav_users` is dropped, or the
 *      Security tab stops naming these actions, or the page stops filtering at
 *      `record_section`, the chain breaks and this file reddens.
 *   2. COVERAGE — every action ANYWHERE in the identity object set that targets
 *      a route known to return an unrecoverable secret must declare a
 *      `resultDialog` covering the secret-bearing keys. The route table below
 *      is the input; the actions are discovered. A fourth 2FA surface added
 *      tomorrow is held to the same rule with no edit here.
 *
 * ⚠️ What this file does NOT establish: that the dialog RENDERS. The renderer
 * lives in the sibling `objectui` repo (`ActionRunner` → `ActionResultDialog`),
 * so no test in this repo can drive that DOM. The data half of the render path
 * — that the declared `path` resolves against the real HTTP response — is
 * measured over a booted stack in
 * `packages/qa/dogfood/test/two-factor-backup-code-reveal.dogfood.test.ts`.
 * Between them they cover "declared, reachable, and the value is really there";
 * the pixels are objectui's to pin.
 */

import { describe, expect, it } from 'vitest';
import type { Action } from '@objectstack/spec/ui';
import * as identityObjects from './index.js';
import { SETUP_NAV_CONTRIBUTIONS } from '../apps/setup-nav.contributions.js';
import { SysUserDetailPage } from '../pages/sys-user.page.js';

/**
 * Routes whose SUCCESS RESPONSE carries a value the user can never obtain
 * again, mapped to the response keys that carry it.
 *
 * Derivation, re-measured for #10681 rather than quoted from the card:
 *  - better-auth's `twoFactor()` defaults to `storeBackupCodes: 'encrypted'`
 *    and `auth-manager.ts` passes no `backupCodeOptions`, so `backup_codes`
 *    holds `symmetricEncrypt(JSON.stringify(codes))` — one opaque ciphertext.
 *  - `auth-route-ledger.ts` publishes `generate-backup-codes` and NO route
 *    that reads codes back; there is no re-reveal endpoint to add.
 *  - `/two-factor/enable` returns the otpauth URI carrying the plaintext TOTP
 *    secret, which is likewise stored encrypted and never re-served.
 *
 * ⛔ Adding a row here without a `resultDialog` on the actions that target it
 * is meant to fail. That is the point of the table.
 */
const ONE_SHOT_ROUTES: Record<string, readonly string[]> = {
  '/api/v1/auth/two-factor/enable': ['totpURI', 'backupCodes'],
  '/api/v1/auth/two-factor/generate-backup-codes': ['backupCodes'],
};

/** Every action declared on every exported identity object, tagged with its object. */
function allIdentityActions(): { object: string; action: Action }[] {
  const out: { object: string; action: Action }[] = [];
  for (const [exportName, def] of Object.entries(identityObjects)) {
    const actions = (def as { actions?: Action[] } | undefined)?.actions;
    if (!Array.isArray(actions)) continue;
    for (const action of actions) out.push({ object: exportName, action });
  }
  return out;
}

describe('#10681 — one-shot 2FA reveals on the navigable surface', () => {
  // ── 1. Reachability: the chain, walked ────────────────────────────────
  describe('the Setup → People & Organization → Users chain reaches these actions', () => {
    it('Setup navigation mounts sys_user (and still mounts no sys_two_factor)', () => {
      const items = SETUP_NAV_CONTRIBUTIONS.flatMap((c) => c.items ?? []);
      const users = items.find((i) => (i as { objectName?: string }).objectName === 'sys_user');
      expect(users, 'sys_user is not mounted in the Setup navigation').toBeDefined();

      // The other half of the card's finding, kept live: `sys_two_factor`
      // declares the same reveals and is reachable from nowhere. If someone
      // mounts it later this flips, and the duplication becomes a real
      // question to answer rather than a latent one.
      const twoFactorMounted = items.some(
        (i) => (i as { objectName?: string }).objectName === 'sys_two_factor',
      );
      expect(
        twoFactorMounted,
        'sys_two_factor is now navigable — the sys_user duplicates in this file are no longer the only reachable 2FA surface, so decide which one is canonical',
      ).toBe(false);
    });

    it('the sys_user record page names the 2FA actions in a record_section quick-actions bar', () => {
      // Walk the page tree for `record:quick_actions` nodes. Derived, not
      // hard-coded to a tab index: the Security tab can move.
      const quickActionNodes: { location?: string; actionNames?: string[] }[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return void node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        const n = node as Record<string, unknown>;
        if (n.type === 'record:quick_actions') {
          quickActionNodes.push((n.properties ?? {}) as { location?: string; actionNames?: string[] });
        }
        for (const value of Object.values(n)) walk(value);
      };
      walk(SysUserDetailPage);

      const named = quickActionNodes
        .filter((p) => p.location === 'record_section')
        .flatMap((p) => p.actionNames ?? []);

      // Guard the guard: if the walker stopped finding nodes (page schema
      // reshaped), `named` would be empty and every `toContain` below would
      // fail — but assert it positively so the reason is legible.
      expect(named.length, 'no record_section quick-actions found on the sys_user page').toBeGreaterThan(0);
      expect(named).toContain('generate_backup_codes');
      expect(named).toContain('enable_two_factor');
    });

    it('those names resolve to sys_user actions declared at record_section', () => {
      const actions = (identityObjects.SysUser.actions ?? []) as Action[];
      for (const name of ['enable_two_factor', 'generate_backup_codes']) {
        const action = actions.find((a) => a.name === name);
        expect(action, `sys_user declares no action '${name}'`).toBeDefined();
        // The page filters by location; a declaration that stopped listing
        // `record_section` would render nothing while still existing.
        expect(action?.locations, `'${name}' is not declared at record_section`).toContain('record_section');
      }
    });
  });

  // ── 2. Coverage: the class, derived ───────────────────────────────────
  describe('every action targeting a one-shot-secret route reveals what it returns', () => {
    it('the route table matches at least one action per row — the instrument is live', () => {
      // Positive control, FIRST. If a target string is renamed, the coverage
      // test below would iterate an empty set and pass while checking nothing.
      for (const route of Object.keys(ONE_SHOT_ROUTES)) {
        const matches = allIdentityActions().filter(({ action }) => action.target === route);
        expect(matches.length, `no identity action targets ${route} — the table is stale`).toBeGreaterThan(0);
      }
    });

    it('each one carries a resultDialog covering the secret-bearing response keys', () => {
      for (const { object, action } of allIdentityActions()) {
        const secretKeys = action.target ? ONE_SHOT_ROUTES[action.target] : undefined;
        if (!secretKeys) continue;

        const where = `${object}.${action.name} (${action.target})`;
        expect(
          action.resultDialog,
          `${where} returns values that cannot be retrieved again, but declares no resultDialog — the response is discarded and the user is locked out`,
        ).toBeDefined();

        const paths = (action.resultDialog?.fields ?? []).map((f) => f.path);
        for (const key of secretKeys) {
          expect(paths, `${where} does not reveal '${key}'`).toContain(key);
        }

        // Paths address the INNER data payload — the console action runtime
        // unwraps `{ success, data }` before resolving them, so a `data.`
        // prefix double-nests and blanks the dialog. Same regression class as
        // the SysSsoProvider guard in `platform-objects.test.ts`.
        for (const path of paths) {
          expect(path.startsWith('data.'), `${where} path '${path}' is double-nested`).toBe(false);
        }
      }
    });

    it('none of them also declares a successMessage — resultDialog suppresses it', () => {
      // Not tidiness: the runtime shows the dialog INSTEAD of the toast, so a
      // successMessage here is unreachable text that still ships to every
      // translator and still reads, to the next author, like the thing the
      // user sees. This is the exact string that made the original defect look
      // handled ("save them somewhere safe" — for codes never shown).
      for (const { object, action } of allIdentityActions()) {
        if (!action.target || !ONE_SHOT_ROUTES[action.target]) continue;
        expect(
          action.successMessage,
          `${object}.${action.name} declares both a resultDialog and a successMessage; the toast is suppressed, so the message is dead text`,
        ).toBeUndefined();
      }
    });
  });
});
