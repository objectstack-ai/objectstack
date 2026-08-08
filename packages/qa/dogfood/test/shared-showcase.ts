// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Worker-scoped shared showcase stack for the `shared-showcase` vitest project.
//
// A plain `bootStack(showcaseStack)` costs ~7.8s per test file (~3.5s TS module
// graph + ~4.1s kernel assembly, metadata parse, security/seed bootstrap) —
// measured on a 4-vCPU class host. With the default isolated pool, each of the
// files that boot the IDENTICAL plain showcase paid that price separately:
// ~29 boots per suite run, ~25% of the whole gate's compute.
//
// The `shared-showcase` project runs with `isolate: false`, so files assigned
// to the same worker share one module registry — this module's memoized boot
// then runs once per WORKER (≤4 per run) instead of once per file. The suite
// process tears the worker down at the end of the run; the stack is in-memory
// SQLite, so no explicit stop() is needed (and shared files must NOT call
// stack.stop() — that would kill the instance under the worker's later files).
//
// [#5491] SECURITY WIRING — the shared stack boots the showcase the way the CLI
// boots it: the app's own `isDefault` profile (`showcase_member_default`) as the
// additive per-request baseline, resolved by NAME through
// `appDefaultPermissionSetName` exactly as `objectstack dev` does (ADR-0056 D7 /
// ADR-0090 D5). `showcase-d7-default-profile.dogfood.test.ts` pins that wiring
// itself; this file now USES it.
//
// It used to boot a vanilla `new SecurityPlugin()`, which meant a fresh sign-up
// was governed by the PLATFORM baseline — and the platform baseline used to ship
// a `'*'` object grant that handed every authenticated user create/read/edit on
// every object. That wildcard was the #5491 defect (it erased app-declared
// explicit-allow gates on three axes; HotCRM measured 21/21 create-denial probes
// returning 201), and it is gone. A vanilla boot therefore no longer models the
// showcase — it models a deployment that declared no default profile at all, in
// which a member correctly has no object access and every fixture below would be
// asserting against 403s.
//
// The showcase's declared default is not a workaround for that: it is what the
// app actually ships (`examples/app-showcase/src/security/permission-sets.ts`),
// and what a real `pnpm dev:showcase` puts in force. Naming it here makes these
// fixtures MORE faithful to the running app than they were before, not less.
//
// ELIGIBILITY — a file may use the shared stack ONLY if all of these hold:
//   1. It boots the showcase with the app-default security wiring below and
//      nothing else — no further custom security/plugins/automation/multiTenant
//      options.
//   2. It does not mutate shared global surfaces: no /meta writes, no
//      organization/business-unit creation, no permission-set metadata edits.
//   3. Its assertions tolerate other files' rows existing in shared objects:
//      no exact-count / exhaustive-list assertions over data it didn't create.
//      Scope every list assertion to records the file itself created (unique
//      emails / name prefixes).
// Anything else stays in the `isolated` project (plain vitest defaults).
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

/**
 * [#5491] The two scaffolding grants these shared fixtures add on top of the
 * app's declared default — named objects, never a wildcard.
 *
 * Both are SCAFFOLDING for a platform property, not a change to what the
 * showcase declares. Each fixture pins something about the ENGINE and merely
 * needs a NON-ADMIN member able to write the substrate object; before #5491 the
 * platform wildcard supplied that silently.
 *
 *  - `showcase_announcement` create/edit — `showcase-public-read-owd` proves the
 *    `public_read` OWD with TWO member owners. Announcements are read-only for
 *    members in the app's own profile, so the fixture could only ever create one
 *    through the wildcard. Its row-level assertion (bob may NOT edit alice's
 *    announcement) gets STRONGER with the CRUD bit granted: the refusal is now
 *    unambiguously the OWD gate rather than a missing object bit.
 *  - `showcase_contact` read/create/edit — `showcase-static-readonly` reproduces
 *    #3003, whose entire subject is "a logged-in, NON-ADMIN user forges a
 *    readonly column by direct REST". Handing that fixture an admin token would
 *    delete the property it exists to pin, so the member needs the grant.
 */
const SHARED_FIXTURE_GRANTS = {
  showcase_announcement: { allowRead: true, allowCreate: true, allowEdit: true },
  showcase_contact: { allowRead: true, allowCreate: true, allowEdit: true },
};

let booted: Promise<VerifyStack> | undefined;

/** Boot (once per worker) and return the shared plain-showcase stack. */
export function getSharedShowcase(): Promise<VerifyStack> {
  booted ??= bootStack(showcaseStack, { security: showcaseAppDefaultSecurity(SHARED_FIXTURE_GRANTS) }).then(async (stack) => {
    // First sign-in provisions the dev admin; later files' own signIn() calls
    // are idempotent (~0.16s) and just mint fresh admin tokens.
    await stack.signIn();
    return stack;
  });
  return booted;
}
