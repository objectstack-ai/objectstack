// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5491] The showcase's OWN default profile, wired the way the CLI wires it.
//
// Until #5491 the platform baseline (`member_default`) shipped an
// `object_permissions['*'] = {allowCreate, allowRead, allowEdit}` grant that was
// union-merged into every authenticated member. A dogfood fixture could boot a
// vanilla `new SecurityPlugin()`, sign up a grant-less member, and that member
// could create and edit anything — so "the actor can write the substrate object"
// never had to be declared anywhere.
//
// That wildcard erased app-declared explicit-allow gates on three axes (HotCRM's
// GA sweep: 21 of 21 create-DENIAL probes returned 201; `security/explain` said
// "granted by [member_default]" for a profile carrying an all-false deny), and
// the maintainer removed it (2026-08-07): the platform baseline is explicit-allow
// and object access comes from OWDs plus profile / permission-set declarations.
//
// A vanilla boot therefore no longer models the showcase — it models a
// deployment that declared no default profile, in which a member correctly has
// no object access at all. This helper models the REAL one: the app's `isDefault`
// profile, resolved by NAME through `appDefaultPermissionSetName`, exactly as
// `objectstack dev` does (ADR-0056 D7 / ADR-0090 D5).
// `showcase-d7-default-profile.dogfood.test.ts` pins that wiring; this module
// USES it, so fixtures are now more faithful to the running app than they were.
//
// The lightweight verify harness does not seed permission metadata, so the
// declared set is handed to the plugin directly — the identical note that test
// carries.
import showcaseStack from '@objectstack/example-showcase';
import {
  SecurityPlugin,
  appDefaultPermissionSetName,
  securityDefaultPermissionSets,
} from '@objectstack/plugin-security';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';

type ObjectGrants = Record<
  string,
  { allowRead?: boolean; allowCreate?: boolean; allowEdit?: boolean; allowDelete?: boolean }
>;

const stackPermissions = ((showcaseStack as { permissions?: unknown[] }).permissions ?? []) as Array<{ name?: string }>;

/** The app's declared default profile name — `showcase_member_default`. */
export const showcaseAppDefaultName = appDefaultPermissionSetName(stackPermissions);

const declaredDefault = stackPermissions.find((p) => p?.name === showcaseAppDefaultName) as unknown;

/**
 * A `SecurityPlugin` whose additive per-request baseline is the showcase's own
 * declared default profile.
 *
 * `extraObjectGrants` adds NAMED objects on top, for a fixture whose actor must
 * write a substrate object the app's profile does not open. Use it only for
 * scaffolding a platform property, always naming the objects — a fixture that
 * re-adds a `'*'` wildcard here would re-open #5491 under a different name, and
 * a grant nobody can point at is the defect this issue is about.
 */
export function showcaseAppDefaultSecurity(extraObjectGrants?: ObjectGrants): SecurityPlugin {
  if (!showcaseAppDefaultName || !declaredDefault) {
    // The showcase declares one. If that ever stops being true, every fixture
    // built on this helper would silently degrade to "the member has no access",
    // which reads as a security regression rather than a missing declaration.
    throw new Error(
      '[dogfood] the showcase stack declares no `isDefault` permission set — the CLI wiring ' +
        'these fixtures model cannot be reproduced (#5491)',
    );
  }
  const appDefault = PermissionSetSchema.parse(declaredDefault) as PermissionSet;
  if (!extraObjectGrants) {
    return new SecurityPlugin({
      defaultPermissionSets: [...securityDefaultPermissionSets, appDefault],
      fallbackPermissionSet: appDefault.name,
    });
  }
  const baseline = PermissionSetSchema.parse({
    ...appDefault,
    name: 'dogfood_showcase_member',
    label: 'Dogfood showcase member (app default + named fixture scaffolding)',
    isDefault: false,
    objects: { ...(appDefault.objects ?? {}), ...extraObjectGrants },
  }) as PermissionSet;
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, baseline],
    fallbackPermissionSet: baseline.name,
  });
}
