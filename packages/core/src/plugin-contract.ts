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
 * ## What this refuses: the NINE declared keys, and `null` on any of them
 *
 * `PluginSchema` (`@objectstack/spec`, `kernel/plugin.zod.ts`) declares nine
 * optional keys, and since #16365 this function reaches ALL NINE — the
 * `version` filter that stood here was a stopgap and is gone (see below). Each
 * is reported as `at '<key>'`:
 *
 * - `id` — a non-string, or the empty string (`z.string().min(1)`).
 * - `type` — outside the closed set `'standard'` + `CORE_PLUGIN_TYPES`.
 * - `staticPath` — a non-string.
 * - `slug` — a non-string, or not matching `/^[a-z0-9-_]+$/`.
 * - `default` — a non-boolean.
 * - `version` — a non-string, or a string outside the SemVer 2.0.0 grammar
 *   `/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/`.
 * - `description` — a non-string.
 * - `author` — a non-string; an object such as `{ name }` is refused.
 * - `homepage` — a non-string, or a string that is not a URL.
 *
 * All nine are `.optional()`, which admits absence and `undefined` but
 * never an explicit `null` — so `null` on any of the nine is refused too.
 *
 * Since #16334 the schema carries ONE conditional requirement on top of
 * the nine: `type: 'ui'` owes `staticPath` and `slug`, and `PluginSchema`
 * refuses a `ui` plugin missing either with `PLUGIN_UI_REQUIRED_KEY_MISSING`
 * at the head of the issue message (`packages/spec/src/kernel/plugin.zod.ts`).
 * That refusal rides this function's envelope unchanged — reported as
 * `at 'staticPath'` / `at 'slug'` with the spec's code inside the message —
 * because this function surfaces `path` and `message` and reads nothing
 * else. `plugin-contract-enforcement.test.ts` group F pins the surfacing on
 * `ObjectKernel`; group G pins the same envelope on `LiteKernel`.
 *
 * ⛔ ENUMERATE ALL NINE wherever this is restated. The changeset ships to
 * consumers as `CHANGELOG.md` and is what an upgrading author greps after
 * the refusal, so a shorter enumeration there does not merely omit keys —
 * it tells an author refused `at 'author'` that their key is not enforced.
 * ⚠️ `CHANGELOG.md` is NOT a live document and is deliberately not corrected:
 * `@objectstack/core@17.4.0` shipped with both enforcement entries enumerating
 * EIGHT and saying `version` is excluded, which is what that release did. The
 * #16365 changeset carries the ninth key and supersedes them BY VERSION rather
 * than by rewriting them. ⇒ This comment is the authority on the CURRENT set;
 * a released entry is the authority on the release it names.
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
 * ## `version`: the ninth key, and why admitting it refused nothing new
 *
 * This function used to filter `version` issues out. It did so because the two
 * declarations disagreed: `PluginSchema.version` was `/^\d+\.\d+\.\d+$/` and
 * refused the prerelease and build-metadata forms SemVer 2.0.0 defines, while
 * `PluginLoader.isSemverShapedVersion` — the check the loader has always run —
 * implemented the full grammar and accepted them. Enforcing the narrow spelling
 * would have RETIRED a pinned capability under a card that ruled on `type`, so
 * the disagreement was declared here rather than performed.
 *
 * #16365 settled it in `packages/spec`, the direction its triage ruled: the
 * SPEC widened. `PluginSchema.version` now carries the loader's grammar
 * character for character, so the filter had nothing left to filter and is
 * gone. ⭐ The widening is a strict SUPERSET of the regex it replaced, so
 * admitting `version` to this function's reach refused NOTHING that loaded
 * before — the direct measurement is that the three versions group E and group
 * G pin (`1.0.0-alpha.1`, `1.0.0+20230101`, `0.0.0-fixture`) still load, on
 * both kernels, with the filter removed.
 *
 * What did NOT converge, deliberately: the loader's STRUCTURAL checks. On
 * `ObjectKernel`, `validatePluginStructure` judges `version` before this
 * function is reached and refuses `v1.0.0` with its own `Invalid semantic
 * version` message, not `PLUGIN_CONTRACT_VIOLATION`; that ordering is
 * unchanged and is pinned. `LiteKernel` has never run `validatePluginStructure`
 * and still does not — so on that kernel a malformed `version` is refused for
 * the first time here, by the schema, which is exactly the convergence #16721
 * ruled for the other eight keys.
 */
const PLUGIN_CONTRACT_VIOLATION_CODE = 'PLUGIN_CONTRACT_VIOLATION';

/**
 * Refuse `plugin` when the DECLARED plugin contract refuses it; return when
 * it does not. Reads `PluginSchema.safeParse` for `success` and for the first
 * issue, and NOTHING else — see the module comment for the nine keys this
 * reaches and the envelope.
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

    const first = result.error.issues[0];
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
