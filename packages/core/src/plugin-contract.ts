// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { PluginSchema } from '@objectstack/spec/kernel';
import type { Plugin } from './types.js';

/**
 * The DECLARED plugin contract, enforced at `use()` on BOTH kernels — one
 * statement, shared by `LiteKernel.use()` and by
 * `PluginLoader.validatePluginContract` on the `ObjectKernel.use()` path
 * (#16721, maintainer ruling 2026-09-08, option A).
 *
 * ## Why it is written down here rather than in each kernel
 *
 * It was previously written once, in `PluginLoader` — and `PluginLoader` is
 * reached from `ObjectKernel.use()` alone. `LiteKernel.use()` wrote the plugin
 * straight into its registry, so the same plugin object was accepted by one
 * published kernel and refused by the other: a `type: 'ui'` plugin with no
 * `slug` was refused by `ObjectKernel` with `PLUGIN_CONTRACT_VIOLATION` and
 * mounted a route on `LiteKernel`. `AGENTS.md` assigns `LiteKernel` to tests,
 * so the lenient kernel was the one authors develop against and the strict one
 * was production — a plugin could be green in vitest and refused at boot.
 *
 * This is the fifth measured instance of one contract implemented twice across
 * `ObjectKernel`/`LiteKernel` (#5170, #5282, #8357, #9864 before it), and it
 * takes the mechanism #9864 chose: `ObjectKernel` does not extend
 * `ObjectKernelBase`, so a shared base class is not available; a module both
 * kernels import by relative path is, the same way `plugin-registration.ts`,
 * `plugin-order.ts` and `hook-dispatch.ts` carry the contracts they own.
 *
 * ⛔ Deliberately NOT exported from the package barrel. Under the ruling this
 * module converges EXISTING enforcement onto the second kernel; it does not
 * mint a public validation API. Both kernels import it by relative path.
 *
 * ## What this refuses: the EIGHT declared keys, and `null` on any of them
 *
 * `PluginSchema` (`@objectstack/spec`, `kernel/plugin.zod.ts`) declares nine
 * optional keys; the filter below drops `version` (see below), so the
 * accept-set narrowing this function performs covers exactly these eight, each
 * reported as `at '<key>'`:
 *
 * - `id` — a non-string, or the empty string (`z.string().min(1)`).
 * - `type` — outside the closed set `'standard'` + `CORE_PLUGIN_TYPES`.
 * - `staticPath` — a non-string.
 * - `slug` — a non-string, or not matching `/^[a-z0-9-_]+$/`.
 * - `default` — a non-boolean.
 * - `description` — a non-string.
 * - `author` — a non-string; an object such as `{ name }` is refused.
 * - `homepage` — a non-string, or a string that is not a URL.
 *
 * All eight are `.optional()`, which admits absence and `undefined` but
 * never an explicit `null` — so `null` on any of the eight is refused too.
 *
 * Since #16334 the schema carries ONE conditional requirement on top of
 * the eight: `type: 'ui'` owes `staticPath` and `slug`, and `PluginSchema`
 * refuses a `ui` plugin missing either with `PLUGIN_UI_REQUIRED_KEY_MISSING`
 * at the head of the issue message (`packages/spec/src/kernel/plugin.zod.ts`).
 * That refusal rides this function's envelope unchanged — reported as
 * `at 'staticPath'` / `at 'slug'` with the spec's code inside the message —
 * because this function surfaces `path` and `message` and reads nothing
 * else. `plugin-contract-enforcement.test.ts` group F pins the surfacing on
 * `ObjectKernel`; group G pins the same envelope on `LiteKernel`.
 *
 * ⛔ ENUMERATE ALL EIGHT wherever this is restated. The changeset ships to
 * consumers as `CHANGELOG.md` and is what an upgrading author greps after
 * the refusal, so a shorter enumeration there does not merely omit keys —
 * it tells an author refused `at 'author'` that their key is not enforced.
 * This comment, the #16049 changeset and the `PLUGIN_CONTRACT_VIOLATION` row
 * in `dispatcher-error-vocabulary.ts` are the three places that restate it.
 *
 * What this does NOT refuse, which is what bounds the narrowing: UNKNOWN
 * keys. `PluginSchema` is a plain `z.object` with no `.strict()` — the
 * strip posture — and the parse output is discarded here, so a plugin
 * carrying keys the schema never declares still loads, stored verbatim.
 *
 * ## ⛔ safeParse for VALIDATION ONLY — the parse output is discarded
 *
 * The returned object is a COPY, and `PluginLoader.toPluginMetadata` exists
 * precisely because a copy "destroys the prototype chain for Class-based
 * plugins". Substituting the parse output for the plugin would break every
 * class-based plugin in the ecosystem while leaving every refusal test green,
 * so the result is read for `success` and for nothing else, and NEITHER
 * kernel writes anything back onto the object it was handed.
 * `plugin-contract-enforcement.test.ts` pins a class-based plugin's prototype
 * surviving `use()` on both kernels, which is what makes that a measurement
 * rather than a promise.
 *
 * ## The envelope, and what each kernel does with it
 *
 * ONE refusal, from either kernel: the stable code `PLUGIN_CONTRACT_VIOLATION`
 * at the head of the message and on the error's `code` property, naming the
 * plugin and the first violated key:
 *
 *     PLUGIN_CONTRACT_VIOLATION: plugin '@acme/console' is refused by the
 *     declared plugin contract at 'type': <the schema's own issue message>
 *
 * `LiteKernel.use()` is synchronous and throws this error as-is, so an
 * in-process catcher sees the `code` property. `ObjectKernel.use()` runs it
 * inside `PluginLoader.loadPlugin` and re-wraps a failed load into a fresh
 * `Error` carrying only `result.error?.message` — its existing wrapper for
 * EVERY load failure, unchanged here — so on that kernel the text above
 * arrives behind a `Failed to load plugin: <name> - ` prefix and the code
 * survives only because it is repeated at the head of the message. Group G's
 * parity case pins that the `LiteKernel` message is exactly the tail of the
 * `ObjectKernel` one for the same input.
 *
 * The FIRST issue only: a boot refusal is read by a human reading one log
 * line, and the first violated key is the one to fix.
 *
 * ⚠️ The code is spelled the ADR-0112 way and is deliberately NOT wire
 * vocabulary, exactly like `SERVICE_NOT_REGISTERED_CODE` one module over: it
 * is raised while the kernel is still assembling itself, before any HTTP
 * boundary exists, and `dispatcher-error-vocabulary.ts` classifies it
 * `door: 'none'` / `boot-refusal` for that reason.
 *
 * ## Why `version` is excluded, and why that is not a weakening
 *
 * MEASURED, not assumed. `PluginSchema.version` is `/^\d+\.\d+\.\d+$/`, which
 * refuses the prerelease and build-metadata forms SemVer 2.0.0 defines — while
 * `PluginLoader.isValidSemanticVersion`, the check the loader has always run,
 * implements the full grammar and accepts them. Two declarations in this
 * repository disagree about what a version is, and `plugin-loader.test.ts`
 * pins the wider one deliberately: "should accept versions with pre-release
 * tags" (`1.0.0-alpha.1`) and "should accept versions with build metadata"
 * (`1.0.0+20230101`). Two in-repo class-based plugin fixtures ship
 * `version = '0.0.0-fixture'` and boot through the real kernel.
 *
 * So enforcing the schema's `version` here would not enforce the protocol —
 * it would RETIRE a pinned capability, silently, under a card that ruled on
 * `type`. Version is not among the eight keys enumerated above. On
 * `ObjectKernel` the loader's own `validatePluginStructure` still judges
 * `version` with the wider grammar; `LiteKernel` has never judged `version`
 * and, under this convergence, still does not — the convergence is on the
 * SCHEMA (#16721 ruled on `PluginSchema`), not on the loader's structural
 * checks (`name`, `init`, semver), which stay `PluginLoader`'s own.
 * Reconciling the two `version` spellings belongs in `packages/spec` beside
 * #16334; until then this exclusion is declared here rather than performed by
 * leaving the disagreement unmeasured.
 */
const PLUGIN_CONTRACT_VIOLATION_CODE = 'PLUGIN_CONTRACT_VIOLATION';

/**
 * Refuse `plugin` when the DECLARED plugin contract refuses it; return when
 * it does not. Reads `PluginSchema.safeParse` for `success` and for the first
 * non-`version` issue, and NOTHING else — see the module comment for the
 * eight keys this reaches, the `version` exclusion and the envelope.
 *
 * @throws an `Error` whose `code` is `PLUGIN_CONTRACT_VIOLATION` and whose
 *         message carries the same code at its head, the plugin's name (and
 *         `id`, when it declares one) and the first violated key.
 */
export function assertPluginContract(plugin: Plugin): void {
    const result = PluginSchema.safeParse(plugin);
    if (result.success) {
        return;
    }

    const issues = result.error.issues.filter((issue) => issue.path[0] !== 'version');
    if (issues.length === 0) {
        return;
    }

    const first = issues[0];
    const at = first.path.length > 0 ? first.path.join('.') : '(root)';
    const id = (plugin as { id?: unknown }).id;
    const named = typeof id === 'string' && id.length > 0
        ? `'${plugin.name}' (id: ${id})`
        : `'${plugin.name}'`;

    const error = new Error(
        `${PLUGIN_CONTRACT_VIOLATION_CODE}: plugin ${named} is refused by the declared plugin `
        + `contract at '${at}': ${first.message}`,
    ) as Error & { code?: string };
    error.code = PLUGIN_CONTRACT_VIOLATION_CODE;
    throw error;
}
