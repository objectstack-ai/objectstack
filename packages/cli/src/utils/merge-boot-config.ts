// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4002] Merge a boot result over the authored stack config.
 *
 * `objectstack serve` (and `dev`, which spawns it) assembles the effective
 * config as `{ ...authored, ...bootResult }`, where `bootResult` comes from
 * `createStandaloneStack()` / `createDefaultHostConfig()`. Those builders return
 * an `api` block carrying only the environment-scoping decision:
 *
 * ```js
 * api: { enableProjectScoping: false, projectResolution: 'auto' }
 * ```
 *
 * (`projectResolution` was the undeclared `'none'` until #11999 — see
 * `StandaloneStackResult.api` in `@objectstack/runtime` for why it moved.
 * `merge-boot-config.test.ts` pins that this block parses clean against
 * `RestApiConfigSchema`, the check whose absence let the three packages
 * disagree about this key's vocabulary for as long as nothing executed
 * the schema.)
 *
 * Under a shallow spread that object REPLACED the author's entire `api` block,
 * silently discarding every key it did not itself set. Two of those keys are
 * live knobs the CLI reads a few lines later:
 *
 * - `api.requireAuth` — the documented one-line opt-out for serving data
 *   publicly (ADR-0056 D2, the v12 migration note). Authoring it did nothing:
 *   the value never reached the REST plugin, so the boot warning that is supposed
 *   to make a fail-open posture visible never fired either.
 * - `api.enforceProjectMembership` — the ADR-0024 D9 opt-out from the
 *   `sys_environment_member` 403 gate. Silently fell back to the dispatcher
 *   default.
 *
 * So `api` merges PER KEY: the author's declarations survive, and the boot
 * builder still wins on the keys it actually decides (scoping is not the
 * author's call on a standalone host). Every other top-level key keeps the
 * previous whole-value semantics — for `objects` / `permissions` / `manifest` /
 * `plugins` the artifact-serve path deliberately serves the boot result's
 * version, so those are not swept into this change.
 */
export function mergeBootConfig<A extends object, B extends object>(authored: A, bootResult: B): A & B {
    const merged = { ...authored, ...bootResult } as any;
    const authoredApi = (authored as any)?.api;
    const bootApi = (bootResult as any)?.api;
    // Only synthesize the key when at least one side has one, so a config with
    // no `api` block anywhere does not gain an empty object.
    if (isPlainObject(authoredApi) || isPlainObject(bootApi)) {
        merged.api = {
            ...(isPlainObject(authoredApi) ? authoredApi : {}),
            ...(isPlainObject(bootApi) ? bootApi : {}),
        };
    }
    return merged as A & B;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
