// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10681 — do the new backup codes actually reach the user?
 *
 * ## The question this file answers, and the one it does not
 *
 * `sys_user.generate_backup_codes` now declares a `resultDialog` with
 * `{ path: 'backupCodes', format: 'code-list' }`. Asserting that the key is
 * present would re-state the diff. The fact that decides whether a user is
 * locked out is a JOIN between two things that live in different places and
 * can drift apart silently:
 *
 *   - the declared `path`, in `@objectstack/platform-objects`, and
 *   - the actual success-response shape of the live route, which is
 *     better-auth's (`disposition: 'sdk'` in `auth-route-ledger.ts`) and moves
 *     when better-auth is bumped.
 *
 * If those disagree the dialog opens and is EMPTY — the user still loses their
 * codes, and every declaration-shape test in the repo stays green. So this
 * file boots a real stack, calls the real route, and resolves the REAL declared
 * paths against the REAL response body.
 *
 * ⚠️ NOT a render test. The dialog DOM is objectui's (`ActionRunner` →
 * `ActionResultDialog`), so nothing here proves pixels appeared. What it proves
 * is that the value the renderer is told to read is present, non-empty, and
 * addressed correctly. The reachability half — that this action is on the
 * screen the card names — is pinned in
 * `packages/platform-objects/src/identity/two-factor-one-shot-reveal.test.ts`.
 *
 * ## Why the assertions are ordered the way they are
 *
 * The "codes are unrecoverable afterwards" leg greps the stored column for
 * plaintext. A grep that finds nothing proves nothing until the instrument is
 * shown to work, so the POSITIVE CONTROL runs first: the same codes, grepped
 * with the same matcher, ARE found in the HTTP response body. Only then is
 * their absence from storage evidence of encryption rather than evidence of a
 * broken matcher.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SysUser } from '@objectstack/platform-objects';
import { secretFromTotpUri, totp } from './totp.js';

const SYS = { context: { isSystem: true } };
const ADMIN_PASSWORD = 'admin123';

/** Resolve a dot path the way the console action runtime does. */
function resolvePath(payload: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    payload,
  );
}

/**
 * The payload `resultDialog` paths are resolved against: the runtime unwraps
 * the `{ success, data }` envelope before resolving, so paths address the INNER
 * object. Unwrap at most ONE level, and only when it looks like the envelope —
 * a `?? `-style "try both" here would hide exactly the double-nesting bug the
 * SysSsoProvider guard exists for.
 */
function actionResultData(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>).data;
  }
  return body;
}

/** The declared reveal for one sys_user action, read from the shipped definition. */
function declaredRevealPaths(actionName: string): string[] {
  const action = (SysUser.actions ?? []).find((a) => a.name === actionName);
  expect(action, `sys_user declares no action '${actionName}'`).toBeDefined();
  const fields = action?.resultDialog?.fields ?? [];
  expect(
    fields.length,
    `'${actionName}' declares no resultDialog fields — nothing would be revealed`,
  ).toBeGreaterThan(0);
  return fields.map((f) => f.path);
}

describe('#10681 — the declared reveal resolves against the live response', () => {
  let stack: VerifyStack;
  let ql: any;
  let priorTwoFactor: string | undefined;
  let token: string;
  let adminUserId: string;
  /** The codes the live route handed back, as the user would see them. */
  let revealedCodes: string[];
  /** The raw response body of generate-backup-codes. */
  let generateBody: unknown;

  beforeAll(async () => {
    // The two-factor plugin is opt-in and resolved when the auth manager is
    // constructed — this must precede bootStack.
    priorTwoFactor = process.env.OS_AUTH_TWO_FACTOR;
    process.env.OS_AUTH_TWO_FACTOR = 'true';

    stack = await bootStack(showcaseStack, {});
    ql = await stack.kernel.getServiceAsync<any>('objectql');

    token = await stack.signIn();
    const me = (await (await stack.apiAs(token, 'GET', '/auth/get-session')).json()) as any;
    adminUserId = String(me?.user?.id ?? '');
    expect(adminUserId, 'could not resolve the seeded admin id').toBeTruthy();

    // Enrol, so `generate-backup-codes` has an enrolment to regenerate for.
    const enabled = await stack.apiAs(token, 'POST', '/auth/two-factor/enable', {
      password: ADMIN_PASSWORD,
    });
    expect(enabled.status, `two-factor/enable: ${await enabled.clone().text()}`).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };

    // better-auth enrols with `verified: false`, and `generate-backup-codes`
    // refuses an unconfirmed enrolment with 400 TWO_FACTOR_NOT_ENABLED. This
    // call is the session path (`isSignIn: false`), so it touches no lockout
    // counter — it exists only to make the enrolment real, which is the state
    // a user regenerating codes is actually in.
    const confirmed = await stack.apiAs(token, 'POST', '/auth/two-factor/verify-totp', {
      code: totp(secretFromTotpUri(totpURI)),
    });
    expect(confirmed.status, `verify-totp (enrolment): ${await confirmed.clone().text()}`).toBe(200);

    // Take the token verify-totp hands back rather than reusing the pre-2FA
    // one. In better-auth's session-present branch `valid()` returns
    // `{ token, user }` for the now-two-factor-verified session; the bearer we
    // signed in with is not that, and `generate-backup-codes` (which sits
    // behind `sessionMiddleware`) answers it with 401. Re-signing in is not an
    // option either — with 2FA on, `/sign-in/email` returns a two-factor
    // redirect instead of a token, which is what `stack.signIn()` expects.
    const { token: verifiedToken } = (await confirmed.json()) as { token?: string };
    expect(
      verifiedToken,
      'verify-totp returned no session token — the enrolment handoff changed shape',
    ).toBeTruthy();
    token = verifiedToken as string;

    const generated = await stack.apiAs(token, 'POST', '/auth/two-factor/generate-backup-codes', {
      password: ADMIN_PASSWORD,
    });
    expect(
      generated.status,
      `generate-backup-codes: ${await generated.clone().text()}`,
    ).toBe(200);
    generateBody = await generated.json();
  }, 180_000);

  afterAll(async () => {
    if (priorTwoFactor === undefined) delete process.env.OS_AUTH_TWO_FACTOR;
    else process.env.OS_AUTH_TWO_FACTOR = priorTwoFactor;
    await stack?.stop?.();
  });

  it('generate_backup_codes: the declared path resolves to a non-empty list of codes', () => {
    const paths = declaredRevealPaths('generate_backup_codes');
    expect(paths).toContain('backupCodes');

    const data = actionResultData(generateBody);
    for (const path of paths) {
      const value = resolvePath(data, path);
      expect(
        value,
        `declared resultDialog path '${path}' resolves to nothing in the live response — the dialog would open EMPTY`,
      ).toBeDefined();
    }

    const codes = resolvePath(data, 'backupCodes');
    expect(Array.isArray(codes), 'backupCodes is not an array').toBe(true);
    // `format: 'code-list'` requires an array of strings; anything else renders
    // as nothing useful even though the path resolved.
    for (const code of codes as unknown[]) {
      expect(typeof code, 'a backup code is not a string').toBe('string');
      expect((code as string).length, 'an empty backup code').toBeGreaterThan(0);
    }
    expect((codes as string[]).length).toBeGreaterThan(0);
    revealedCodes = codes as string[];
  });

  it('the declared paths need no `data.` prefix — one unwrap, not two', () => {
    // The mirror of the above: if the runtime's single unwrap were wrong for
    // this route, `data.backupCodes` would ALSO resolve, and the declaration
    // would be ambiguous rather than correct.
    const doubleNested = resolvePath(actionResultData(generateBody), 'data.backupCodes');
    expect(
      doubleNested,
      'both `backupCodes` and `data.backupCodes` resolve — the envelope shape is not what the declaration assumes',
    ).toBeUndefined();
  });

  it('POSITIVE CONTROL: the matcher finds these codes in the response body', () => {
    // Proves the instrument before its silence is read as evidence, below.
    const responseText = JSON.stringify(generateBody);
    for (const code of revealedCodes) {
      expect(
        responseText.includes(code),
        `the matcher cannot find code ${code} in the response it came from — the instrument is broken`,
      ).toBe(true);
    }
  });

  it('and they are genuinely unrecoverable afterwards — storage holds no plaintext', async () => {
    const rows = await ql.find(
      'sys_two_factor',
      { where: { user_id: adminUserId }, limit: 1 },
      SYS,
    );
    const stored = String(rows[0]?.backup_codes ?? '');
    expect(stored.length, 'no backup_codes column value was stored at all').toBeGreaterThan(0);

    // Same matcher as the positive control, now expected to find nothing:
    // better-auth's twoFactor() defaults to `storeBackupCodes: 'encrypted'`
    // and auth-manager passes no override, so this column is one opaque
    // ciphertext. This is WHY the reveal has to happen at generation time —
    // reading the row back later cannot recover the codes.
    for (const code of revealedCodes) {
      expect(
        stored.includes(code),
        `backup code ${code} is stored in PLAINTEXT — the reveal is not the only copy, and this column is readable`,
      ).toBe(false);
    }
  });
});
