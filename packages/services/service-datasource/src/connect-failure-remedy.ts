// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The remedy clause of a fail-fast datasource connect failure — and the one
 * cause that needs a DIFFERENT remedy (#5794).
 *
 * ## The failure this exists for
 *
 * `handleFailure`'s fail-fast throw used to end on exactly one sentence, for
 * every cause: *"Fix the datasource configuration, or set
 * OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway and serve errors until it is
 * reachable."* That is correct advice for the cause it was written for — a
 * database that is genuinely unreachable, a wrong DSN, a rotated password.
 *
 * It is **harmful, in both halves, for one specific cause**: booting an
 * unbuilt workspace, where the driver's `dist/` does not exist and the failure
 * is `ERR_MODULE_NOT_FOUND` rather than a refused connection. Measured on an
 * unbuilt worktree (#5726, and re-measured for #5794):
 *
 * ```text
 * ✗ datasource 'default': connect failed — Cannot find module
 *   '…/node_modules/@objectstack/driver-sql/dist/index.mjs' imported from …
 *   Fix the datasource configuration, or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1
 *   to boot anyway and serve errors until it is reachable.
 * ```
 *
 *  - **"Fix the datasource configuration"** sends the reader to edit a
 *    configuration that is *already correct*. Nothing they can write there
 *    creates a `dist/` directory.
 *  - **"set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway"** is worse than
 *    useless: it does not work around the problem, it *hides* it. A half-built
 *    workspace then reports itself started and fails every request with
 *    `ERR_DATASOURCE_UNAVAILABLE`, which is a strictly harder thing to diagnose
 *    than the honest refusal to boot. That flag exists for a database that is
 *    unreachable — a fact about the world, which may resolve itself. A missing
 *    build artifact is a fact about this checkout, and no env var should boot
 *    past it. (Same line #5714 drew for an unhonourable `pool` block.)
 *
 * And the one fix that *does* work — `pnpm build` — was never mentioned.
 *
 * This is #5217's invariant in a second place: **one unmet precondition is one
 * precondition, not N content problems.** The local worktree is the first place
 * anyone reproduces a CI red, so this message is handed to the reader at
 * precisely their least-informed moment; CI never produces this shape at all,
 * because a build always runs ahead of it there.
 *
 * ## Message discipline: ONE correct fix, and no escape hatch
 *
 * The unbuilt remedy names `pnpm install && pnpm build` once and stops. It does
 * not mention `OS_ALLOW_DRIVER_CONNECT_FAILURE` — not even to warn against it.
 * Naming an escape hatch is how it gets used: a reader who is already stuck
 * skims for the shortest line that looks like it will let them continue. Same
 * discipline as `datasource-pool-support.ts` (#5714 / #5931) and as
 * `scripts/check-dev-prereqs.mjs` (#5795), whose own pin asserts its red text
 * mentions its fix exactly once.
 *
 * `pnpm install && pnpm build` rather than a bare `pnpm build` is the complete
 * form: `ERR_MODULE_NOT_FOUND` cannot distinguish "installed but unbuilt" from
 * "never installed", and the combined command is correct for both — the same
 * choice `check-dev-prereqs` makes for a workspace with no `node_modules`.
 *
 * ## Scope: a message branch, nothing else
 *
 * This changes no behaviour. The fail-fast verdict, when it fires, which error
 * type is thrown, the retained connection state, and the degraded-boot path
 * under `OS_ALLOW_DRIVER_CONNECT_FAILURE` are all untouched — only the closing
 * sentence differs, and only for this one cause.
 */

import { isModuleNotFoundError } from '@objectstack/types';

/**
 * The remedy for every cause except the unbuilt workspace — a database that is
 * genuinely unreachable, a wrong DSN, a credential that will not resolve.
 *
 * **Byte-for-byte the sentence this message has always ended on.** Pinned as a
 * constant rather than left inline so that "the other causes are unchanged" is
 * a thing the tests can assert against one declaration instead of a copy.
 */
export const GENERIC_CONNECT_FAILURE_REMEDY =
  `Fix the datasource configuration, or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway and ` +
  `serve errors until it is reachable.`;

/**
 * The remedy when the driver package could not be loaded at all.
 *
 * Deliberately mentions no environment variable and no configuration key — see
 * the module note. One fix, stated once.
 */
export const UNBUILT_WORKSPACE_REMEDY =
  `The driver package could not be LOADED at all — it is not installed, or its build output is ` +
  `missing. That is a build precondition, not a datasource fault: the configuration is fine, and ` +
  `no boot-time override can make a driver that does not exist answer a query. Run ` +
  `\`pnpm install && pnpm build\`, then start again.`;

/**
 * Did this connect fail because the driver's module could not be RESOLVED, as
 * opposed to a connection that was attempted and refused?
 *
 * Delegates to `@objectstack/types`' shared classifier — the single owner of
 * this judgement since framework#3265, already relied on by the CLI's
 * optional-plugin guards and its `requires` capability resolver. A second copy
 * here would be free to drift from it, and the way it would drift is by
 * mis-reading ESM's `Cannot find package` as a crash (the framework#1595 bug
 * that classifier was written to end).
 *
 * That classifier checks the **structured** signal first (`err.code` is
 * `ERR_MODULE_NOT_FOUND` under ESM `import()`, `MODULE_NOT_FOUND` under CJS
 * `require()`) and only then falls back to the message text. The fallback earns
 * its place on this path specifically: the factory's `sqlite-wasm` and `mongo`
 * arms re-throw a `new Error(...)` that interpolates the original message but
 * drops its `code`, so those two arms reach here with the text signal alone.
 *
 * `undefined` — the call sites that have no thrown value to classify, such as
 * an unsupported driver id — is never a module-resolution failure.
 */
export function isUnbuiltWorkspaceFailure(cause: unknown): boolean {
  if (cause === undefined) return false;
  return isModuleNotFoundError(cause);
}

/**
 * The sentence a fail-fast connect failure ends on, chosen by cause.
 *
 * @param cause the value `connect()`/the factory threw, when there is one.
 */
export function connectFailureRemedy(cause: unknown): string {
  return isUnbuiltWorkspaceFailure(cause) ? UNBUILT_WORKSPACE_REMEDY : GENERIC_CONNECT_FAILURE_REMEDY;
}
