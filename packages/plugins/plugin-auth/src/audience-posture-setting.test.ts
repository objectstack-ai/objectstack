// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `auth.audience_*` — the console switch surface for the audience posture
 * (#11768, consuming the #11739 / PR #11767 contract).
 *
 * The three settings keys (`audience_posture`, `audience_allowed_email_domains`,
 * `audience_self_registration_permission_set`) are ONE atomic declaration that
 * `bindAuthSettings` maps to ONE `applyConfigPatch({ audience })` — the patch
 * replaces the whole audience object and validates the MERGED result
 * (`assertAudienceConfig`), so the settings channel can never reach a posture
 * the boot-config channel could not.
 *
 * The load-bearing pins here are the REFUSALS (#5152: explicit-only, loud
 * refusal, never coercion). A suite that only sets valid postures cannot tell
 * an enforcing binding from a pass-through, so each ruled invariant is driven
 * through the settings channel to its refusal:
 *
 *   - empty domain list under `email_domain`;
 *   - missing / forbidden (`admin_full_access`) self-registration permission set;
 *   - `email_domain` with verification explicitly off (any source), and `open`
 *     with verification off stored only through the console (#20389: the
 *     `OS_AUTH_REQUIRE_EMAIL_VERIFICATION` env override is the deployment's
 *     opt-out and is honoured under `open`).
 *
 * Envelope note: refusals at THIS seam are log-line refusals (the binding runs
 * inside `applySettings`, not on an HTTP surface), so the assertions pin the
 * logger level + message content. The settings channel's envelope-carrying
 * refusal (`SETTINGS_VALIDATION` + `invalid_option` on `setMany`) is pinned in
 * `service-settings`' auth.manifest.test.ts, and the admission-time envelope
 * (403 + `AUTH_CONFIG_ERROR`/`SELF_REGISTRATION_CLOSED`) is pinned in
 * audience-posture.test.ts — the settings channel converges on the same
 * `getAudience()` accessor those tests exercise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { AUDIENCE_POSTURES } from '@objectstack/spec/system';
import { AuthPlugin } from './auth-plugin.js';
import { AuthManager } from './auth-manager.js';
import { OPEN_POSTURE_VERIFICATION_OFF_WARNING } from './audience-posture.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/objectql';

const SECRET = 'test-secret-at-least-32-chars-long';

type SettingEntry = { value: unknown; source: string };

/** Minimal engine: enough for boot-time hooks (backfill sees zero users). */
function makeEngine() {
  return {
    insert: vi.fn(async (_object: string, row: any) => row),
    find: vi.fn(async () => []),
    findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; }),
  };
}

describe('auth.audience_* — the settings switch surface (#11768)', () => {
  let mockContext: PluginContext;
  let hookHandlers: Map<string, Array<() => Promise<void>>>;

  const settingsStore: { values: Record<string, SettingEntry> } = { values: {} };
  let subscribers: Array<() => void>;

  const makeSettings = () => ({
    getNamespace: vi.fn(async (namespace: string) =>
      namespace === 'auth' ? { values: settingsStore.values } : { values: {} },
    ),
    subscribe: vi.fn((namespace: string, cb: () => void) => {
      if (namespace === 'auth') subscribers.push(cb);
    }),
  });

  beforeEach(() => {
    settingsStore.values = {};
    subscribers = [];
    hookHandlers = new Map();
    mockContext = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'settings') return makeSettings();
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => {
        if (!hookHandlers.has(name)) hookHandlers.set(name, []);
        hookHandlers.get(name)!.push(handler);
      }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
  });

  const fire = async (name: string) => {
    for (const h of hookHandlers.get(name) ?? []) await h();
  };

  /** Boot exactly as a host does: init → start → kernel:ready (settings bind there). */
  const boot = async (opts: {
    settings?: Record<string, SettingEntry>;
    pluginOptions?: Record<string, unknown>;
  } = {}) => {
    settingsStore.values = opts.settings ?? {};
    const engine = makeEngine();
    (mockContext.getService as any).mockImplementation((name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'settings') return makeSettings();
      if (name === 'data' || name === 'objectql') return engine;
      return undefined;
    });

    const plugin = new AuthPlugin({
      secret: SECRET,
      baseUrl: 'http://localhost:3000',
      ...(opts.pluginOptions ?? {}),
    });
    await plugin.init(mockContext);
    const manager = (mockContext.registerService as any).mock.calls.find(
      ([name]: [string]) => name === 'auth',
    )?.[1] as AuthManager;
    await plugin.start(mockContext);
    await fire('kernel:ready');
    return { plugin, manager, engine };
  };

  const errorLines = () =>
    (mockContext.logger.error as any).mock.calls.map((c: any[]) => String(c[0]));
  const warnLines = () =>
    (mockContext.logger.warn as any).mock.calls.map((c: any[]) => String(c[0]));

  // ── 1. The declaration reaches the runtime, whole, through ONE patch ─────

  it('an explicit email_domain declaration patches the live audience in one stroke', async () => {
    const { manager } = await boot({
      settings: {
        audience_posture: { value: 'email_domain', source: 'global' },
        audience_allowed_email_domains: { value: 'acme.com\n Beta.Org , partner.example', source: 'global' },
        audience_self_registration_permission_set: { value: ' portal_user ', source: 'global' },
      },
    });
    const audience = manager.getAudience();
    expect(audience.posture).toBe('email_domain');
    // Newline- AND comma-separated, trimmed; case preserved (matching is
    // case-insensitive at admission, declaration keeps the typed form).
    expect(audience.allowedEmailDomains).toEqual(['acme.com', 'Beta.Org', 'partner.example']);
    expect(audience.selfRegistrationPermissionSet).toBe('portal_user');
  });

  it('re-applies on a settings change without a restart', async () => {
    const { manager } = await boot();
    expect(manager.getAudience().posture).toBe('invite_only');

    settingsStore.values = {
      audience_posture: { value: 'email_domain', source: 'global' },
      audience_allowed_email_domains: { value: 'acme.com', source: 'global' },
      audience_self_registration_permission_set: { value: 'member_default', source: 'global' },
    };
    expect(subscribers.length).toBeGreaterThan(0);
    for (const cb of subscribers) cb();
    await vi.waitFor(() => expect(manager.getAudience().posture).toBe('email_domain'));
  });

  // ── 2. Explicit-only (#5152): a UI default must not mask deployment config ─

  it('a manifest default does not mask a deployment that declared its audience in code', async () => {
    const { manager } = await boot({
      pluginOptions: {
        audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
      },
      settings: { audience_posture: { value: 'invite_only', source: 'default' } },
    });
    expect(manager.getAudience().posture).toBe('open');
  });

  // ── 3. Off-vocabulary: refused loudly, never coerced ─────────────────────

  it('an off-vocabulary posture is refused loudly, never coerced (#5152)', async () => {
    // `invite-only` is the MEMBERSHIP policy spelling — the most plausible
    // operator typo for this select's `invite_only`. Coercing it (to either
    // end of the vocabulary) would silently pick a posture the operator did
    // not declare; refusing keeps the standing config ruling and says so.
    const { manager } = await boot({
      pluginOptions: {
        audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
      },
      settings: { audience_posture: { value: 'invite-only', source: 'env' } },
    });
    expect(manager.getAudience().posture).toBe('open'); // standing, NOT a coerced guess
    const logged = errorLines();
    expect(logged.some((m: string) => m.includes("'invite-only'"))).toBe(true);
    expect(logged.some((m: string) => m.includes(AUDIENCE_POSTURES.join(', ')))).toBe(true);
  });

  // ── 4. The ruled invariants hold THROUGH the settings channel ────────────
  // `applyConfigPatch` validates the merged result and throws; the binding
  // catches and reports, and the standing config keeps ruling (fail closed).

  it('an EMPTY domain list under email_domain is refused through the settings channel', async () => {
    const { manager } = await boot({
      settings: {
        audience_posture: { value: 'email_domain', source: 'global' },
        // Explicit but blank (whitespace + separators only) — parses to [].
        audience_allowed_email_domains: { value: '  \n , ', source: 'global' },
        audience_self_registration_permission_set: { value: 'portal_user', source: 'global' },
      },
    });
    expect(manager.getAudience().posture).toBe('invite_only'); // standing default keeps ruling
    const logged = errorLines();
    expect(logged.some((m: string) => m.includes('audience settings REFUSED'))).toBe(true);
    expect(logged.some((m: string) => m.includes('allowedEmailDomains'))).toBe(true);
  });

  it('a MISSING self-registration permission set is refused through the settings channel', async () => {
    const { manager } = await boot({
      settings: { audience_posture: { value: 'open', source: 'global' } },
    });
    expect(manager.getAudience().posture).toBe('invite_only');
    const logged = errorLines();
    expect(logged.some((m: string) => m.includes('audience settings REFUSED'))).toBe(true);
    expect(logged.some((m: string) => m.includes('selfRegistrationPermissionSet'))).toBe(true);
  });

  it('admin_full_access as the self-registration permission set is refused', async () => {
    const { manager } = await boot({
      settings: {
        audience_posture: { value: 'open', source: 'global' },
        audience_self_registration_permission_set: { value: 'admin_full_access', source: 'global' },
      },
    });
    expect(manager.getAudience().posture).toBe('invite_only');
    expect(errorLines().some((m: string) => m.includes('admin_full_access'))).toBe(true);
  });

  it('open with verification OFF stored only through the CONSOLE is refused — the console cannot make the opt-out', async () => {
    // The audience patch is applied AFTER the main patch, so the merged-result
    // validation judges it against the `require_email_verification: false`
    // this same pass just applied. A console-stored value (source `global`) is
    // not the deployment's declaration, so under `open` it stays the #11739
    // contradiction (#20389 honours only the deployment's opt-out).
    const { manager } = await boot({
      settings: {
        require_email_verification: { value: false, source: 'global' },
        audience_posture: { value: 'open', source: 'global' },
        audience_self_registration_permission_set: { value: 'member_default', source: 'global' },
      },
    });
    // The main patch itself applied (legal under the standing invite_only)…
    expect((manager as any).config.emailAndPassword?.requireEmailVerification).toBe(false);
    // …and the audience that contradicts it was refused: standing rules.
    expect(manager.getAudience().posture).toBe('invite_only');
    expect(errorLines().some((m: string) => m.includes('requireEmailVerification'))).toBe(true);
    expect(errorLines().some((m: string) => m.includes('unless the DEPLOYMENT turns it off'))).toBe(true);
    expect(warnLines()).not.toContain(OPEN_POSTURE_VERIFICATION_OFF_WARNING);
  });

  it('open with the OS_AUTH_REQUIRE_EMAIL_VERIFICATION env override OFF is honoured — the deployment declared it', async () => {
    // Every key arrives as an env override (source `env`), the shape a
    // deployment that configures itself only through OS_AUTH_* produces.
    const { manager } = await boot({
      settings: {
        require_email_verification: { value: false, source: 'env' },
        audience_posture: { value: 'open', source: 'env' },
        audience_self_registration_permission_set: { value: 'member_default', source: 'env' },
      },
    });
    expect(manager.getAudience().posture).toBe('open');
    expect(manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(false);
    expect(errorLines().filter((m: string) => /audience|verification/i.test(m))).toEqual([]);
    // Loud: exactly one boot warning naming the posture and the consequence.
    expect(warnLines().filter((m: string) => m === OPEN_POSTURE_VERIFICATION_OFF_WARNING)).toHaveLength(1);
    expect(OPEN_POSTURE_VERIFICATION_OFF_WARNING).toContain("audience posture 'open'");
    expect(OPEN_POSTURE_VERIFICATION_OFF_WARNING).toContain('invitation');
    // A later settings pass re-applies the same declaration without a second warning.
    for (const cb of subscribers) cb();
    await vi.waitFor(() => expect(manager.getAudience().posture).toBe('open'));
    expect(warnLines().filter((m: string) => m === OPEN_POSTURE_VERIFICATION_OFF_WARNING)).toHaveLength(1);
  });

  it('stack-config open + false AND the same env override: both doors agree, and sibling settings still apply', async () => {
    // A host that maps the env var into its stack config (the constructor
    // door) while the settings service ALSO carries it as an env override:
    // the second door must agree, never refuse the pass — a refused main
    // patch drops every sibling auth setting in it.
    const { manager } = await boot({
      pluginOptions: {
        audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
        emailAndPassword: { requireEmailVerification: false },
      },
      settings: {
        require_email_verification: { value: false, source: 'env' },
        session_expiry_days: { value: 3, source: 'global' },
      },
    });
    expect(manager.getAudience().posture).toBe('open');
    expect(manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(false);
    expect((manager as any).config.session?.expiresIn).toBe(3 * 86_400);
    expect(warnLines().some((m: string) => m.includes('failed to apply auth settings'))).toBe(false);
    expect(warnLines().filter((m: string) => m === OPEN_POSTURE_VERIFICATION_OFF_WARNING)).toHaveLength(1);
  });

  it('email_domain with the env override OFF is still refused — no source can turn verification off there', async () => {
    const { manager } = await boot({
      settings: {
        require_email_verification: { value: false, source: 'env' },
        audience_posture: { value: 'email_domain', source: 'env' },
        audience_allowed_email_domains: { value: 'acme.com', source: 'env' },
        audience_self_registration_permission_set: { value: 'member_default', source: 'env' },
      },
    });
    expect(manager.getAudience().posture).toBe('invite_only'); // refused: standing rules
    expect(
      errorLines().some((m: string) =>
        m.includes("posture 'email_domain' opens self-registration, which FORCES email verification on"),
      ),
    ).toBe(true);
    expect(warnLines()).not.toContain(OPEN_POSTURE_VERIFICATION_OFF_WARNING);
  });

  it('CONTROL — no opt-out warning when open keeps verification on', async () => {
    const { manager } = await boot({
      pluginOptions: { audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' } },
    });
    expect(manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(true);
    expect(warnLines()).not.toContain(OPEN_POSTURE_VERIFICATION_OFF_WARNING);
  });

  it('CONTROL — no opt-out warning when invite_only turns verification off (nothing forced it there)', async () => {
    const { manager } = await boot({ pluginOptions: { emailAndPassword: { requireEmailVerification: false } } });
    expect(manager.getPublicConfig().emailPassword.requireEmailVerification).toBe(false);
    expect(warnLines()).not.toContain(OPEN_POSTURE_VERIFICATION_OFF_WARNING);
  });

  // ── 5. Composition: posture anchors the declaration ──────────────────────

  it('switching BACK to invite_only never fails on leftover sibling fields', async () => {
    // The console keeps stored values for fields the posture select now hides.
    // Sending them would make CLOSING the wall refusable (inert-declaration
    // refusal) while the previous, more open posture keeps ruling — the one
    // direction that must not fail. The binding composes the declaration from
    // the keys the selected posture READS: `{ posture: 'invite_only' }` alone.
    const { manager } = await boot({
      pluginOptions: {
        audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
      },
      settings: {
        audience_posture: { value: 'invite_only', source: 'global' },
        audience_allowed_email_domains: { value: 'acme.com', source: 'global' },
        audience_self_registration_permission_set: { value: 'member_default', source: 'global' },
      },
    });
    expect(manager.getAudience().posture).toBe('invite_only');
    expect(errorLines()).toEqual([]);
  });

  it('a domain list without an explicit posture is refused, not guessed', async () => {
    const { manager } = await boot({
      settings: { audience_allowed_email_domains: { value: 'acme.com', source: 'global' } },
    });
    expect(manager.getAudience().posture).toBe('invite_only');
    expect((manager as any).config.audience).toBeUndefined(); // no patch went out
    expect(errorLines().some((m: string) => m.includes('without a posture'))).toBe(true);
  });

  // ── 6. Blast radius: a refused audience never blocks sibling settings ────

  it('a refused audience declaration does not block sibling auth settings', async () => {
    const { manager } = await boot({
      settings: {
        session_expiry_days: { value: 3, source: 'global' },
        audience_posture: { value: 'open', source: 'global' }, // no permission set ⇒ refused
      },
    });
    expect((manager as any).config.session?.expiresIn).toBe(3 * 86_400);
    expect(manager.getAudience().posture).toBe('invite_only');
    expect(errorLines().some((m: string) => m.includes('audience settings REFUSED'))).toBe(true);
  });

  // ── 7. Dangling names are an ADMISSION-time refusal, same accessor ───────

  it('a well-formed but dangling permission-set name flows to the ONE accessor the admission gate reads', async () => {
    // The patch validator cannot resolve names (no data access); the dangling
    // declaration is refused at ADMISSION time with 403 AUTH_CONFIG_ERROR —
    // pinned in audience-posture.test.ts ("a DANGLING declared permission set
    // refuses admission…"). That gate reads `getAudience()`, so this pin —
    // the settings channel landing on the same accessor — is what connects
    // the two: no captured copy, no second read site.
    const { manager } = await boot({
      settings: {
        audience_posture: { value: 'open', source: 'global' },
        audience_self_registration_permission_set: { value: 'ghost', source: 'global' },
      },
    });
    const audience = manager.getAudience();
    expect(audience.posture).toBe('open');
    expect(audience.selfRegistrationPermissionSet).toBe('ghost');
  });
});
