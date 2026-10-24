/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/auth` ↔ `@objectstack/spec` symbol-collision guards
 * (objectui#3159, objectstack#4115 burn-down batch 5).
 *
 * Six symbols in this package were declared under names the spec already owns.
 * Their doc comments claimed alignment with the spec's auth contract; reading
 * the two side by side, three genuinely WERE the spec's (and are now its
 * binding), two were different objects wearing the spec's name (renamed), and
 * one is a React component whose name collides with a spec enum by pure
 * coincidence (excused in the guard's ALLOW, pinned here).
 *
 * ## Why the spec's names are read through the compiler, not `import * as`
 *
 * A runtime namespace import sees VALUES only, and almost every symbol here is
 * a TYPE. A tripwire built on `Object.keys(await import('@objectstack/spec/…'))`
 * would pass for all of them while proving nothing — the mistake the guard's own
 * header records making in its first draft. So this reads each subpath's `.d.ts`
 * through the TypeScript checker, exactly as
 * `scripts/check-spec-symbol-derivation.mjs` does.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import type { AuthUser, AuthClientSession, AuthProviderOptions, DelegableScope, TenancyPosture } from '../types';
import type {
  AuthUser as SpecAuthUser,
  AuthSession as SpecAuthSession,
  DelegableScope as SpecDelegableScope,
} from '@objectstack/spec/contracts';
import type { TenancyPosture as SpecTenancyPosture } from '@objectstack/spec/security';
import type { AuthProviderConfig as SpecAuthProviderConfig } from '@objectstack/spec/system';

/** Every name `@objectstack/spec` exports from any subpath — types AND values. */
function specExportNames(): Set<string> {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@objectstack/spec/package.json');
  const pkgDir = dirname(pkgPath);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    exports?: Record<string, { import?: { types?: string }; require?: { types?: string } }>;
  };

  const files: string[] = [];
  for (const cond of Object.values(pkg.exports ?? {})) {
    if (typeof cond !== 'object' || cond === null) continue;
    const dts = cond.import?.types ?? cond.require?.types;
    if (dts) files.push(resolve(pkgDir, dts));
  }

  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();

  const names = new Set<string>();
  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) names.add(exported.getName());
  }
  return names;
}

const SPEC_NAMES = specExportNames();

/**
 * Sanity: if this set came back empty (bad resolve, changed `exports` map),
 * every "the spec does not own X" assertion below would pass vacuously.
 */
describe('the spec export-name probe itself works', () => {
  it('reads a non-trivial number of names', () => {
    expect(SPEC_NAMES.size).toBeGreaterThan(1000);
  });

  it('sees TYPE-only exports, not just runtime values', () => {
    // `AuthUser` is an interface — invisible to a runtime `import()`.
    expect(SPEC_NAMES.has('AuthUser')).toBe(true);
  });
});

/**
 * The two renames. Each entry is `[local dialect name, the spec name it used to
 * collide with, what the spec's symbol actually means]` — the last column is the
 * claim the old name silently made.
 */
const RENAMES: Array<[local: string, formerly: string, specMeaning: string]> = [
  [
    'AuthClientSession',
    'AuthSession',
    "the SERVER's session record ({ id, userId, expiresAt: ISO string, token? })",
  ],
  [
    'AuthProviderOptions',
    'AuthProviderConfig',
    'an OAuth/OIDC provider registration ({ id, clientId, clientSecret, scope? })',
  ],
];

describe('renamed local dialects do not collide with a spec export', () => {
  it.each(RENAMES)('the spec does not own `%s`', (local) => {
    expect(
      SPEC_NAMES.has(local),
      `@objectstack/spec now exports \`${local}\`. This package declares its own ` +
        `\`${local}\`, so the rename that fixed objectstack#4115 has re-created the ` +
        `collision under the new name. Rename again (and check the new name here ` +
        `FIRST — objectui#3074 landed a rename onto another spec export exactly ` +
        `this way), or derive from the spec if the two really are the same thing.`,
    ).toBe(false);
  });

  /**
   * The other half of the ratchet. If the spec ever RETIRES the name that forced
   * a rename, the rename is no longer load-bearing and the local dialect can go
   * back to the natural name — this fails and says so, so the workaround cannot
   * outlive its reason.
   */
  it.each(RENAMES)('the spec still owns `%s` (second value: %s)', (_local, formerly) => {
    expect(
      SPEC_NAMES.has(formerly),
      `@objectstack/spec no longer exports \`${formerly}\`, which is the only ` +
        `reason this package renamed it. Either the spec dropped it (then take the ` +
        `plain name back) or it moved (then re-check what it means now).`,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins. A violation is a `tsc` error, not a runtime failure.      */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
/** The `unknown` erasure the `any` probe reports `false` for (objectui#3155). */
type IsUnknown<T> = [unknown] extends [T] ? ([T] extends [unknown] ? true : false) : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

describe('TenancyPosture and DelegableScope ARE the spec bindings', () => {
  it('is pinned at compile time', () => {
    // Guard against the probe lying: an `any`/`unknown` erasure on either side
    // makes every assignability assertion below vacuous (objectstack#4171).
    type _SpecPostureNotAny = Assert<Equal<IsAny<SpecTenancyPosture>, false>>;
    type _SpecPostureNotUnknown = Assert<Equal<IsUnknown<SpecTenancyPosture>, false>>;
    type _SpecScopeNotAny = Assert<Equal<IsAny<SpecDelegableScope>, false>>;
    type _SpecScopeNotUnknown = Assert<Equal<IsUnknown<SpecDelegableScope>, false>>;

    type _PostureIsSpec = Assert<Equal<TenancyPosture, SpecTenancyPosture>>;
    type _ScopeIsSpec = Assert<Equal<DelegableScope, SpecDelegableScope>>;

    expect(true).toBe(true);
  });

  it('still carries the three postures the org wall is switched on (ADR-0105 D1)', () => {
    const all: TenancyPosture[] = ['single', 'group', 'isolated'];
    expect(all).toHaveLength(3);
  });
});

describe('AuthUser extends the spec principal, adding only display fields', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecAuthUser>, false>>;
    type _SpecNotUnknown = Assert<Equal<IsUnknown<SpecAuthUser>, false>>;

    // Not `Extends<SpecAuthUser, AuthUser>`: an interface never satisfies an
    // index signature in TypeScript, so that assertion would be `false` for a
    // purely nominal reason and prove nothing either way. What matters is that
    // no spec key is missing and none has been re-typed.
    type _NoMissingSpecKeys = Assert<Equal<Exclude<keyof SpecAuthUser, keyof AuthUser>, never>>;

    // Before the derivation, `positions` and `tenantId` were simply absent from
    // this declaration — and the index signature made that invisible at every
    // call site, which is why the drift needed a compiler pin rather than a
    // structural comparison.
    type _HasPositions = Assert<Equal<AuthUser['positions'], SpecAuthUser['positions']>>;
    type _HasTenantId = Assert<Equal<AuthUser['tenantId'], SpecAuthUser['tenantId']>>;
    type _IdIsSpecId = Assert<Equal<AuthUser['id'], SpecAuthUser['id']>>;
    type _EmailIsSpecEmail = Assert<Equal<AuthUser['email'], SpecAuthUser['email']>>;
    type _NameIsSpecName = Assert<Equal<AuthUser['name'], SpecAuthUser['name']>>;

    expect(true).toBe(true);
  });

  /**
   * The index signature is the objectstack#4075 mechanism — it absorbs any extra
   * member, so a structural comparison of these two types would read "identical"
   * no matter how far apart they drifted. It is deliberate here (better-auth
   * projects an app's custom user columns onto this object), which is exactly
   * why the spec keys must be inherited rather than compared.
   */
  it('acknowledges the index signature that would otherwise hide drift', () => {
    type _HasIndexSignature = Assert<Equal<string extends keyof AuthUser ? true : false, true>>;
    type _SpecHasNone = Assert<Equal<string extends keyof SpecAuthUser ? true : false, false>>;
    expect(true).toBe(true);
  });
});

describe('AuthClientSession is NOT the spec session (the rename is load-bearing)', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecAuthSession>, false>>;

    // Neither direction holds: the spec requires `id`/`userId` this never has,
    // and types `expiresAt` as an ISO string where this holds a JS `Date`. If
    // either of these ever becomes `true`, re-triage — the rename may be over.
    type _NotSpecShape = Assert<Equal<Extends<AuthClientSession, SpecAuthSession>, false>>;
    type _SpecNotLocalShape = Assert<Equal<Extends<SpecAuthSession, AuthClientSession>, false>>;

    type _ExpiryIsADate = Assert<Equal<AuthClientSession['expiresAt'], Date | undefined>>;
    type _SpecExpiryIsAString = Assert<Equal<SpecAuthSession['expiresAt'], string>>;

    expect(true).toBe(true);
  });
});

describe('AuthProviderOptions is NOT the spec provider registration', () => {
  it('is pinned at compile time', () => {
    type _SpecNotAny = Assert<Equal<IsAny<SpecAuthProviderConfig>, false>>;

    // Zero key overlap — the collision was the word "auth provider", nothing else.
    type _NoSharedKeys = Assert<
      Equal<Extract<keyof AuthProviderOptions, keyof SpecAuthProviderConfig>, never>
    >;

    expect(true).toBe(true);
  });
});

/**
 * `AuthProvider` stays under the spec's name — it is the React context provider
 * component, and the spec's `AuthProvider` is an enum of provider IDS. That
 * exemption lives in the guard's ALLOW map; this pins the fact it rests on, so
 * the day the spec repurposes the name for something a JSX element COULD be
 * confused with, the exemption is re-examined instead of inherited.
 */
describe('the AuthProvider exemption rests on the spec symbol being an id enum', () => {
  it('the spec still exports it, and still as a value (a zod enum)', async () => {
    expect(SPEC_NAMES.has('AuthProvider')).toBe(true);
    const spec = await import('@objectstack/spec/api');
    const specAuthProvider = (spec as Record<string, unknown>).AuthProvider;
    expect(
      specAuthProvider,
      "@objectstack/spec/api's `AuthProvider` is no longer a runtime zod schema. The " +
        'ALLOW entry for @object-ui/auth:AuthProvider assumes it is an enum of provider ' +
        'ids — re-read what it means now before keeping the exemption.',
    ).toBeTruthy();
    expect(Object.keys((specAuthProvider as { def: { entries: Record<string, string> } }).def.entries).sort()).toEqual(
      ['github', 'google', 'ldap', 'local', 'microsoft', 'saml'],
    );
  });

  it('our AuthProvider is a React component, not a schema', async () => {
    const local = await import('../AuthProvider');
    expect(typeof local.AuthProvider).toBe('function');
  });
});

/**
 * `PreviewModeConfig` — the doc-provenance ratchet (objectui#6748) FIRED and is
 * retired here, which is the disposition its own docblock prescribed.
 *
 * The ratchet guarded one sentence: `packages/auth/README.md` claimed this
 * package's preview-mode prop "aligns with the `PreviewModeConfig` from
 * `@objectstack/spec/kernel`". Its instruction on going red was exact —
 * "correct `packages/auth/README.md` … and then delete this guard, which has no
 * reason to outlive the sentence it protects".
 *
 * It went red on the `@objectstack/spec` 17.3.0 bump (objectui#7122): the
 * symbol left the PUBLISHED set there. ⚠️ Worth recording rather than
 * smoothing over — the docblock expected that to happen at major 18, because
 * objectstack#11846 registered the retirement in `RETIRED_DEFS_BY_MAJOR[18]`.
 * It arrived in a MINOR instead, one of four public type exports 17.3.0
 * removed without a major-version signal.
 *
 * The README sentence is corrected and the guard is gone. The capability is
 * untouched: `AuthProvider`'s `previewMode` prop is host-supplied and stays
 * (objectui#6654). No absence pin replaces this one — the symbol was never
 * declared in this package, so there is no local name for the spec to collide
 * with; the names this repo DOES own are pinned in
 * `page-nav-misc-spec-parity.test.ts`.
 */
