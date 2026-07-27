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
// ELIGIBILITY — a file may use the shared stack ONLY if all of these hold:
//   1. It boots `bootStack(showcaseStack)` or `bootStack(showcaseStack, {})` —
//      no custom security/plugins/automation/multiTenant options.
//   2. It does not mutate shared global surfaces: no /meta writes, no
//      organization/business-unit creation, no permission-set metadata edits.
//   3. Its assertions tolerate other files' rows existing in shared objects:
//      no exact-count / exhaustive-list assertions over data it didn't create.
//      Scope every list assertion to records the file itself created (unique
//      emails / name prefixes).
// Anything else stays in the `isolated` project (plain vitest defaults).
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

let booted: Promise<VerifyStack> | undefined;

/** Boot (once per worker) and return the shared plain-showcase stack. */
export function getSharedShowcase(): Promise<VerifyStack> {
  booted ??= bootStack(showcaseStack).then(async (stack) => {
    // First sign-in provisions the dev admin; later files' own signIn() calls
    // are idempotent (~0.16s) and just mint fresh admin tokens.
    await stack.signIn();
    return stack;
  });
  return booted;
}
