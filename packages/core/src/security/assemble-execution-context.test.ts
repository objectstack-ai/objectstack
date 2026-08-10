// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6216 — the ExecutionContext assembly converges onto ONE module, and the
// maintainer ruling of 2026-08-08 (Option A) is explicit that **neither surface
// changes runtime behaviour**: what changes is that the anonymous divergence
// becomes named API instead of drift.
//
// A green suite proves nothing about that on its own — the suite was green
// before the change too. So the load-bearing test here is a PARITY PIN: the
// pre-#6216 assembly of each face is transcribed VERBATIM below, frozen, and
// every shape either face can serve is assembled both ways and compared.
//
// ⚠ The two `legacy*` functions are FROZEN TRANSCRIPTIONS of code that no
// longer exists (runtime `resolve-execution-context.ts` and REST
// `rest-server.ts` `computeExecCtx`, at `origin/main@0caf122f0`). They are a
// pin, NOT a second live implementation: nothing imports them, and they must
// never be "kept up to date" with the shared assembler — the day they need
// editing is the day a face's output changed and the change must be argued on
// its own merits, not absorbed here.

import { describe, it, expect } from 'vitest';
import { ExecutionContextSchema } from '@objectstack/spec/kernel';

import {
  assembleExecutionContext,
  assembleExecutionContextOrGuest,
  ENTRY_EXECUTION_CONTEXT_FIELDS,
  type EntryLocalization,
  type OAuthTokenProvenance,
} from './assemble-execution-context.js';
import type { ResolvedAuthzContext } from './resolve-authz-context.js';

// ───────────────────────── frozen pre-#6216 transcriptions ─────────────────────────

/** Runtime / MCP dispatcher assembly, verbatim, pre-#6216. FROZEN — see header. */
function legacyDispatcherAssembly(
  authz: ResolvedAuthzContext,
  oauthPrincipal: OAuthTokenProvenance | undefined,
  localization: EntryLocalization | undefined,
  requestLocale: string | undefined,
): any {
  const ctx: any = {
    positions: authz.positions,
    permissions: authz.permissions,
    systemPermissions: authz.systemPermissions,
    isSystem: false,
  };
  if (authz.userId) {
    if (oauthPrincipal?.clientId) {
      ctx.principalKind = 'agent';
      ctx.onBehalfOf = { userId: authz.userId, principalKind: 'human' };
      // Pre-#6216 these two read `scopesToAgentPermissionSets(oauthPrincipal.scopes)`
      // and `oauthPrincipal.scopes?.includes(MCP_OAUTH_SCOPE_ACTIONS)` inline.
      // Both are now interpreted at the `/mcp` door and arrive pre-derived; the
      // scope→ceiling mapping itself is pinned end-to-end through the real
      // resolver in `packages/runtime/src/security/resolve-execution-context.test.ts`
      // ("ADR-0090 D10 agent principal"). What THIS pin freezes is unchanged:
      // which envelope fields the ceiling replaces.
      ctx.permissions = oauthPrincipal.scopePermissions;
      ctx.positions = [];
      ctx.systemPermissions = oauthPrincipal.delegatesActions
        ? (authz.systemPermissions ?? [])
        : [];
    } else {
      ctx.principalKind = 'human';
    }
  } else {
    ctx.principalKind = 'guest';
    ctx.positions = ['guest'];
  }
  if (authz.userId) ctx.userId = authz.userId;
  if (authz.tenantId) ctx.tenantId = authz.tenantId;
  if (authz.email) ctx.email = authz.email;
  if (authz.accessToken) ctx.accessToken = authz.accessToken;
  if (authz.tabPermissions) ctx.tabPermissions = authz.tabPermissions;
  if (authz.posture) ctx.posture = authz.posture;
  ctx.org_user_ids = authz.org_user_ids;
  ctx.accessible_org_ids = authz.accessible_org_ids;
  if (oauthPrincipal && ctx.userId === oauthPrincipal.userId) {
    ctx.oauthScopes = oauthPrincipal.scopes;
  }
  if (authz.userId) {
    ctx.timezone = localization?.timezone;
    ctx.locale = requestLocale ?? localization?.locale;
    if (localization?.currency) ctx.currency = localization.currency;
  }
  return ctx;
}

/**
 * REST `computeExecCtx` assembly, verbatim, pre-#6216. FROZEN — see header.
 * `authGate` / `__kernel` are deliberately outside: neither is an
 * `ExecutionContext` field, and the REST face still adds them after assembly.
 */
function legacyRestAssembly(
  authz: ResolvedAuthzContext,
  localization: EntryLocalization,
  requestLocale: string | undefined,
): any {
  if (!authz.userId) return undefined; // anonymous → no ctx → 401
  const effectiveLocale = requestLocale ?? localization.locale;
  return {
    userId: authz.userId,
    tenantId: authz.tenantId,
    email: authz.email,
    positions: authz.positions,
    permissions: authz.permissions,
    systemPermissions: authz.systemPermissions,
    ...(authz.tabPermissions ? { tabPermissions: authz.tabPermissions } : {}),
    ...(authz.posture ? { posture: authz.posture } : {}),
    principalKind: 'human',
    isSystem: false,
    org_user_ids: authz.org_user_ids,
    accessible_org_ids: authz.accessible_org_ids,
    ...(localization.timezone ? { timezone: localization.timezone } : {}),
    ...(effectiveLocale ? { locale: effectiveLocale } : {}),
    ...(localization.currency ? { currency: localization.currency } : {}),
  };
}

// ───────────────────────── comparison + fixtures ─────────────────────────

/**
 * What a CONSUMER of the envelope can observe: every key carrying a defined
 * value, and that value. Key insertion order and keys explicitly set to
 * `undefined` are invisible to `ctx.x` reads, to `JSON.stringify`, and to
 * object spread of the result — the shared assembler emits in its own declared
 * order and omits undefined-valued keys, which is exactly the delta this helper
 * normalizes away. The undefined-key residual is asserted separately below so
 * it is measured, not waved off.
 */
function observable(ctx: any): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined));
}

const baseAuthz = (over: Partial<ResolvedAuthzContext> = {}): ResolvedAuthzContext => ({
  positions: [],
  permissions: [],
  systemPermissions: [],
  org_user_ids: [],
  accessible_org_ids: [],
  ...over,
});

const ANONYMOUS = baseAuthz();

const HUMAN_MINIMAL = baseAuthz({
  userId: 'u1',
  positions: ['member_default'],
  permissions: ['task.read'],
  systemPermissions: [],
  org_user_ids: ['u1', 'u2'],
  accessible_org_ids: ['org1'],
});

const HUMAN_FULL = baseAuthz({
  userId: 'u1',
  tenantId: 'org1',
  email: 'u1@example.com',
  accessToken: 'sess_token_abc',
  positions: ['member_default', 'sales'],
  permissions: ['task.read', 'task.write'],
  systemPermissions: ['admin_full_access'],
  tabPermissions: { task: 'visible' },
  posture: 'PLATFORM_ADMIN',
  org_user_ids: ['u1', 'u2'],
  accessible_org_ids: ['org1', 'org2'],
});

const LOCALIZATIONS: Array<[string, EntryLocalization | undefined]> = [
  ['no localization', undefined],
  ['empty localization', {}],
  ['timezone only', { timezone: 'Asia/Shanghai' }],
  ['full localization', { timezone: 'Asia/Shanghai', locale: 'zh-CN', currency: 'CNY' }],
];

const REQUEST_LOCALES: Array<[string, string | undefined]> = [
  ['no request locale', undefined],
  ['request locale wins', 'en-US'],
];

// ───────────────────────── the parity pins ─────────────────────────

describe('#6216 — runtime/dispatcher face: byte-for-byte parity with the pre-#6216 assembly', () => {
  const AUTHZ_SHAPES: Array<[string, ResolvedAuthzContext]> = [
    ['anonymous', ANONYMOUS],
    ['minimal human', HUMAN_MINIMAL],
    ['full human (tenant/email/token/tabs/posture)', HUMAN_FULL],
  ];

  const OAUTH_SHAPES: Array<[string, OAuthTokenProvenance | undefined]> = [
    ['no oauth', undefined],
    ['agent, read-only ceiling', {
      userId: 'u1', scopes: ['data:read'], clientId: 'cli1',
      scopePermissions: ['agent_data_read'], delegatesActions: false,
    }],
    ['agent, read+write ceiling', {
      userId: 'u1', scopes: ['data:write'], clientId: 'cli1',
      scopePermissions: ['agent_data_read', 'agent_data_write'], delegatesActions: false,
    }],
    ['agent delegating actions', {
      userId: 'u1', scopes: ['data:read', 'actions:execute'], clientId: 'cli1',
      scopePermissions: ['agent_data_read'], delegatesActions: true,
    }],
    ['agent with an EMPTY ceiling (no data scope)', {
      userId: 'u1', scopes: ['actions:execute'], clientId: 'cli1',
      scopePermissions: [], delegatesActions: true,
    }],
    ['bearer WITHOUT a client (azp) — still human', {
      userId: 'u1', scopes: ['data:read'],
      scopePermissions: ['agent_data_read'], delegatesActions: false,
    }],
    ['bearer for a DIFFERENT user — scopes withheld', {
      userId: 'other', scopes: ['data:read'],
      scopePermissions: ['agent_data_read'], delegatesActions: false,
    }],
  ];

  for (const [authzName, authz] of AUTHZ_SHAPES) {
    for (const [oauthName, oauth] of OAUTH_SHAPES) {
      for (const [locName, localization] of LOCALIZATIONS) {
        for (const [rlName, requestLocale] of REQUEST_LOCALES) {
          it(`${authzName} · ${oauthName} · ${locName} · ${rlName}`, () => {
            const now = assembleExecutionContextOrGuest({
              authz,
              oauth,
              localization,
              requestLocale,
              accessToken: authz.accessToken,
            });
            const before = legacyDispatcherAssembly(authz, oauth, localization, requestLocale);
            expect(observable(now)).toEqual(observable(before));
          });
        }
      }
    }
  }
});

describe('#6216 — REST face: byte-for-byte parity with the pre-#6216 assembly', () => {
  const AUTHZ_SHAPES: Array<[string, ResolvedAuthzContext]> = [
    ['anonymous', ANONYMOUS],
    ['minimal human', HUMAN_MINIMAL],
    ['full human (tenant/email/token/tabs/posture)', HUMAN_FULL],
  ];

  for (const [authzName, authz] of AUTHZ_SHAPES) {
    for (const [locName, localization] of LOCALIZATIONS) {
      for (const [rlName, requestLocale] of REQUEST_LOCALES) {
        it(`${authzName} · ${locName} · ${rlName}`, () => {
          const now = assembleExecutionContext({
            authz,
            oauth: undefined,
            localization,
            requestLocale,
            // The named per-face divergence: REST has never carried the
            // session bearer, and #6216 preserves that.
            accessToken: undefined,
          });
          const before = legacyRestAssembly(authz, localization ?? {}, requestLocale);
          if (before === undefined) {
            expect(now).toBeUndefined();
            return;
          }
          expect(now).toBeDefined();
          expect(observable(now)).toEqual(observable(before));
        });
      }
    }
  }
});

describe('#6216 — the anonymous face, in BOTH directions', () => {
  it('the DEFAULT entry is fail-closed: no principal → no context (the surface answers 401)', () => {
    expect(
      assembleExecutionContext({
        authz: ANONYMOUS,
        oauth: undefined,
        localization: { timezone: 'Asia/Shanghai', locale: 'zh-CN', currency: 'CNY' },
        requestLocale: 'en-US',
        accessToken: 'sess_token_abc',
      }),
    ).toBeUndefined();
  });

  it('the GUEST entry produces the dispatcher guest envelope, unchanged', () => {
    const ctx = assembleExecutionContextOrGuest({
      authz: ANONYMOUS,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    });
    // The exact envelope, key set included — `explain-engine.ts` reads
    // `principalKind === 'guest'` for its EXTERNAL posture floor, and the
    // `guest` position is the declared vocabulary for what anonymous may do.
    expect(ctx).toEqual({
      positions: ['guest'],
      permissions: [],
      systemPermissions: [],
      isSystem: false,
      principalKind: 'guest',
      org_user_ids: [],
      accessible_org_ids: [],
    });
    expect(Object.keys(ctx)).not.toContain('userId');
    expect(Object.keys(ctx)).not.toContain('posture');
  });

  it('an authenticated request is unaffected by WHICH entry the face chose', () => {
    const input = {
      authz: HUMAN_FULL,
      oauth: undefined,
      localization: { timezone: 'Asia/Shanghai', locale: 'zh-CN' },
      requestLocale: undefined,
      accessToken: HUMAN_FULL.accessToken,
    } as const;
    expect(assembleExecutionContextOrGuest(input)).toEqual(assembleExecutionContext(input));
  });
});

describe('#6216 — the named per-face divergences are values, not switches', () => {
  it('a face that withholds the session bearer emits NO accessToken key', () => {
    const ctx = assembleExecutionContext({
      authz: HUMAN_FULL,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    })!;
    expect(Object.keys(ctx)).not.toContain('accessToken');
  });

  it('a face that carries it emits the bearer verbatim', () => {
    const ctx = assembleExecutionContext({
      authz: HUMAN_FULL,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: HUMAN_FULL.accessToken,
    })!;
    expect(ctx.accessToken).toBe('sess_token_abc');
  });

  it('a face that accepts no OAuth token cannot produce an agent principal', () => {
    const ctx = assembleExecutionContext({
      authz: HUMAN_FULL,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    })!;
    expect(ctx.principalKind).toBe('human');
    expect(Object.keys(ctx)).not.toContain('onBehalfOf');
    expect(Object.keys(ctx)).not.toContain('oauthScopes');
  });
});

describe('#6216 — the field set is CLOSED', () => {
  /**
   * The non-entry partition, spelled again here on purpose: the module's
   * `NonEntryExecutionContextField` is a type and cannot be read at runtime, so
   * this list is the runtime mirror of it. A new `ExecutionContext` field makes
   * this test red until it is added to ONE of the two lists — the same decision
   * the compiler demands of `ExecutionContextEntryFields`, enforced a second
   * way in case someone reaches for `as any` to get past the first.
   */
  const NON_ENTRY_FIELDS = [
    'actor',
    'attributedUserId',
    'rlsMembership',
    'transaction',
    'traceId',
    'flowRunId',
    'skipTriggers',
    'skipAutomations',
    'seedReplay',
    'skipStateMachine',
    'preserveAudit',
  ];

  it('every ExecutionContext field is either assembled at the entry or declared non-entry', () => {
    const schemaFields = Object.keys((ExecutionContextSchema as any).shape).sort();
    const decided = [...ENTRY_EXECUTION_CONTEXT_FIELDS, ...NON_ENTRY_FIELDS].sort();
    expect(decided).toEqual(schemaFields);
  });

  it('no field is decided twice', () => {
    const decided = [...ENTRY_EXECUTION_CONTEXT_FIELDS, ...NON_ENTRY_FIELDS];
    expect(new Set(decided).size).toBe(decided.length);
  });

  it('every assembled key belongs to the closed set — nothing leaks in', () => {
    const ctx = assembleExecutionContextOrGuest({
      authz: HUMAN_FULL,
      oauth: {
        userId: 'u1', scopes: ['data:write', 'actions:execute'], clientId: 'cli1',
        scopePermissions: ['agent_data_read', 'agent_data_write'], delegatesActions: true,
      },
      localization: { timezone: 'Asia/Shanghai', locale: 'zh-CN', currency: 'CNY' },
      requestLocale: 'en-US',
      accessToken: 'sess_token_abc',
    });
    for (const key of Object.keys(ctx)) {
      expect(ENTRY_EXECUTION_CONTEXT_FIELDS).toContain(key);
    }
  });
});

describe('#6216 — the measured residual: keys that were present-with-undefined', () => {
  // Reported rather than hidden. The pre-#6216 dispatcher assigned
  // `ctx.timezone` / `ctx.locale` unconditionally inside its authenticated
  // branch, and the REST literal always spelled `tenantId` / `email` — so both
  // faces could emit a key whose value was `undefined`. The shared assembler
  // omits those keys instead. This is invisible to `ctx.x` reads, to
  // `JSON.stringify`, and to spreading the envelope; it is visible to
  // `Object.keys` / `in`, so it is pinned here rather than left to be
  // rediscovered.
  it('dispatcher: an authenticated request with no localization no longer spells timezone/locale as undefined', () => {
    const input = {
      authz: HUMAN_MINIMAL,
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
    } as const;
    const before = legacyDispatcherAssembly(HUMAN_MINIMAL, undefined, undefined, undefined);
    const now = assembleExecutionContextOrGuest(input);

    expect(Object.keys(before)).toContain('timezone');
    expect(before.timezone).toBeUndefined();
    expect(Object.keys(now)).not.toContain('timezone');
    expect((now as any).timezone).toBeUndefined();
    // …and nothing observable moved.
    expect(observable(now)).toEqual(observable(before));
    expect(JSON.stringify(now)).toBe(JSON.stringify(observable(before)));
  });

  it('REST: a principal with no tenant no longer spells tenantId/email as undefined', () => {
    const before = legacyRestAssembly(HUMAN_MINIMAL, {}, undefined);
    const now = assembleExecutionContext({
      authz: HUMAN_MINIMAL,
      oauth: undefined,
      localization: {},
      requestLocale: undefined,
      accessToken: undefined,
    })!;

    expect(Object.keys(before)).toContain('tenantId');
    expect(before.tenantId).toBeUndefined();
    expect(Object.keys(now)).not.toContain('tenantId');
    expect(observable(now)).toEqual(observable(before));
  });
});
