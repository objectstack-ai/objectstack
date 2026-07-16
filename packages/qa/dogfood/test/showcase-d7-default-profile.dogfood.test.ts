// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// SHOWCASE proof for ADR-0056 D7 — the app-declared default profile, wired the
// way the CLI wires it. The showcase declares `showcase_member_default` with
// `isDefault: true`; `appDefaultPermissionSetName(stack.permissions)` (the helper the
// CLI calls) extracts its name, and passing it as the SecurityPlugin
// `fallbackPermissionSet` makes a fresh sign-up governed by THAT profile instead
// of the built-in `member_default` wildcard. Read-mostly default ⇒ the member
// can read announcements but is DENIED the private-note object (which the
// wildcard would have allowed) — proving the app's declared default is in force.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets, appDefaultPermissionSetName } from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';

// Mirror the CLI: pull the app-declared default profile (name + object) off the
// stack metadata via the same helper the CLI uses.
const stackPerms = ((showcaseStack as { permissions?: unknown[] }).permissions ?? []) as Array<{ name?: string }>;
const appDefault = appDefaultPermissionSetName(stackPerms);
const declaredDefault = stackPerms.find((p) => p?.name === appDefault) as unknown;

describe('showcase: app-declared default profile, CLI-wired (ADR-0056 D7)', () => {
  let stack: VerifyStack;
  let memberToken: string;

  beforeAll(async () => {
    // The full CLI boot loads stack permission sets into the metadata service, so
    // `fallbackPermissionSet: <name>` resolves there. The lightweight harness does
    // not seed permission metadata, so we hand the declared default to the plugin
    // directly — then wire it by NAME exactly as the CLI's appDefaultPermissionSetName
    // path does (constructor uses the explicit name, not its own isDefault scan).
    stack = await bootStack(showcaseStack, {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, PermissionSetSchema.parse(declaredDefault) as PermissionSet],
        fallbackPermissionSet: appDefault,
      }),
    });
    await stack.signIn();
    memberToken = await stack.signUp('d7-showcase-member@verify.test');
  }, 60_000);

  afterAll(async () => { await stack?.stop(); });

  it('appDefaultPermissionSetName extracts the showcase default profile from stack metadata', () => {
    expect(appDefault).toBe('showcase_member_default');
  });

  it('a fresh member is governed by the app-declared default (reads announcements)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/data/showcase_announcement');
    expect(r.status, 'declared default grants announcement read').toBe(200);
  });

  it('and NOT by the built-in member_default wildcard (contact is denied)', async () => {
    const r = await stack.apiAs(memberToken, 'GET', '/data/showcase_contact');
    // member_default has a wildcard grant → would be 200. The app default grants
    // no contact access → denied, proving the declared default is in force.
    // (private_note is no longer a valid canary: the ADR-0090 zoo deliberately
    // grants it in the baseline as the personal-data-on-private-OWD demo.)
    expect(r.status, 'declared default does NOT grant showcase_contact').not.toBe(200);
  });
});
