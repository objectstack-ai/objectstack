// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7001] `bootStack` must wire an app's DECLARED default permission set — the
// same profile `objectstack serve` wires for the same config.
//
// The asymmetry this file pins, measured on `origin/main` before the fix:
//
//   • `objectstack serve` (packages/cli/src/commands/serve.ts) reads
//     `appDefaultPermissionSetName(config.permissions)` and passes it as the
//     SecurityPlugin `fallbackPermissionSet`.
//   • `bootStack` constructed a vanilla `new SecurityPlugin()` and never read
//     `config.permissions` at all.
//
// So the profile an app declares was in force when a human ran the CLI and
// silently absent when the app's own suite booted it — a `declared ≠ enforced`
// split INSIDE the harness that exists to catch that split.
//
// It was invisible until #5491 (`9e9445ba`): the platform's `member_default`
// carried an `object_permissions['*']` wildcard, so a member with no
// application profile reached every object anyway and the declared fallback was
// never load-bearing. #5491 removed that floor deliberately and prescribed
// exactly one consumer action — ship an app default profile via
// `isDefault: true` — which `bootStack` had no way to express.
//
// The behavioural case below is the honest red: with the wildcard gone, the
// built-in baseline grants NO object access, so a fresh member reading the
// fixture object is denied unless the app's declared profile is actually wired.
// A name-only assertion could not tell "wired" from "wired but inert".

import { describe, it, expect, afterAll } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import {
  SecurityPlugin,
  appDefaultPermissionSetName,
  appSecurityPluginOptions,
} from '@objectstack/plugin-security';
// `.js` extension deliberate: under `moduleResolution: NodeNext` the
// extensionless form does not resolve, so every symbol it names silently
// becomes `any` (AGENTS.md §Build & Test). This package's older test files
// still carry that shape as measured TEST_DEBT — a shrink-only ratchet — so a
// new file must not add to it.
import { bootStack, type VerifyStack } from './harness.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

const APP_DEFAULT_SET = 'appdefault_member_default';

// `defineStack` enforces `${manifest.namespace}_${shortName}` on every object
// name, so the two fixtures below need one memo object each.
const memo = (namespace: string) =>
  ObjectSchema.create({
    name: `${namespace}_memo`,
    // [ADR-0090 D1] grandfather stamp: the gate under test is the BASELINE
    // profile the harness wires, not owner-sharing. `public_read_write` keeps
    // the OWD out of the way so the only thing that can deny the read is the
    // permission set — which is exactly the variable this file measures.
    sharingModel: 'public_read_write',
    label: 'Memo',
    pluralLabel: 'Memos',
    fields: {
      name: Field.text({ label: 'Name', required: true }),
    },
  });

/**
 * The app's declared default profile. Deliberately low-privilege: an
 * `isDefault` set is the `everyone` baseline suggestion (ADR-0090 D5) and the
 * D7 anchor gate refuses high-privilege bits on one.
 */
const AppDefaultProfile = PermissionSetSchema.parse({
  name: APP_DEFAULT_SET,
  label: 'App Member (Default)',
  isDefault: true,
  objects: {
    appdefault_memo: { allowRead: true, allowCreate: true },
  },
});

/** Declares an `isDefault` profile — the #5491 migration the CLI already honours. */
const appWithDeclaredDefault = defineStack({
  manifest: {
    id: 'com.example.app-default-profile',
    namespace: 'appdefault',
    version: '0.0.1',
    type: 'app',
    name: 'App Default Profile Fixture',
  },
  objects: [memo('appdefault')],
  permissions: [AppDefaultProfile],
});

/** Declares NO default profile — the shape the vast majority of apps still have. */
const appWithoutDeclaredDefault = defineStack({
  manifest: {
    id: 'com.example.no-default-profile',
    namespace: 'nodefault',
    version: '0.0.1',
    type: 'app',
    name: 'No Default Profile Fixture',
  },
  objects: [memo('nodefault')],
});

const started: VerifyStack[] = [];
const boot = async (...args: Parameters<typeof bootStack>): Promise<VerifyStack> => {
  const stack = await bootStack(...args);
  started.push(stack);
  return stack;
};

afterAll(async () => {
  for (const stack of started) await stack.stop().catch(() => undefined);
});

/** The baseline profile a booted kernel actually runs with. */
const wiredBaseline = (stack: VerifyStack): Promise<string | null> =>
  stack.kernel.getServiceAsync<string | null>('security.fallbackPermissionSet');

describe('bootStack honours the app-declared default permission set (#7001)', () => {
  it(
    'wires the SAME profile `serve` wires for the same config',
    async () => {
      const stack = await boot(appWithDeclaredDefault);

      // The exact expression `serve.ts` evaluates for its `fallbackPermissionSet`.
      const servesChoice = appDefaultPermissionSetName(appWithDeclaredDefault.permissions);
      expect(servesChoice, 'fixture precondition: the config declares an isDefault set')
        .toBe(APP_DEFAULT_SET);

      // RED before the fix: 'member_default' — the vanilla constructor's
      // derivation from the BUILT-IN sets, which cannot see the app's.
      await expect(wiredBaseline(stack)).resolves.toBe(servesChoice);
    },
    BOOT_TIMEOUT,
  );

  it(
    'and that profile is load-bearing: a fresh member holds the declared grants',
    async () => {
      const stack = await boot(appWithDeclaredDefault);
      await stack.signIn(); // first user is the seeded dev admin
      const memberToken = await stack.signUp('appdefault-member@verify.test');

      // RED before the fix: the built-in baseline grants no object access since
      // #5491 removed its `'*'` wildcard, so this was a denial.
      const read = await stack.apiAs(memberToken, 'GET', '/data/appdefault_memo');
      expect(read.status, 'the declared default grants memo read').toBe(200);
    },
    BOOT_TIMEOUT,
  );

  it(
    'leaves an app that declares no default on the built-in baseline',
    async () => {
      const stack = await boot(appWithoutDeclaredDefault);

      expect(appDefaultPermissionSetName(appWithoutDeclaredDefault.permissions)).toBeUndefined();
      // Unchanged by this fix — the resolution yields `undefined`, so the
      // SecurityPlugin keeps deriving its own default from the built-in sets.
      await expect(wiredBaseline(stack)).resolves.toBe('member_default');
    },
    BOOT_TIMEOUT,
  );

  it(
    'lets a suite opt OUT explicitly, by passing its own SecurityPlugin',
    async () => {
      // The vanilla baseline is still reachable — it is now the EXPLICIT
      // choice rather than the silent default. A caller-supplied plugin wins
      // whole: it already carries its own constructor options, and quietly
      // rewriting one of them would be a second, worse surprise.
      const stack = await boot(appWithDeclaredDefault, { security: new SecurityPlugin() });
      await expect(wiredBaseline(stack)).resolves.toBe('member_default');
    },
    BOOT_TIMEOUT,
  );
});

describe('the resolution helper is shared, not mirrored (#7001)', () => {
  // Both boot paths call `appSecurityPluginOptions`; a second copy of
  // `x ? { fallbackPermissionSet: x } : undefined` is how they drifted apart
  // the first time. The source-level pin that BOTH callers still route through
  // it lives in `packages/cli/src/commands/serve-verify-security-parity.contract.test.ts`
  // — this pair only fixes the helper's own contract.
  it('derives the plugin options from a config the same way the name helper does', () => {
    expect(appSecurityPluginOptions(appWithDeclaredDefault)).toEqual({
      fallbackPermissionSet: appDefaultPermissionSetName(appWithDeclaredDefault.permissions),
    });
  });

  it('yields undefined for a config with no declared default (built-in derivation kept)', () => {
    expect(appSecurityPluginOptions(appWithoutDeclaredDefault)).toBeUndefined();
  });
});
