// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Resolves the value `HttpDispatcher` serves as `version` on `GET /health`
 * and in the discovery payload (`registerBuiltinDomains()` /
 * `getDiscoveryInfo()` in `./http-dispatcher.ts`).
 *
 * #10993 — both surfaces served a hardcoded `'1.0.0'` literal, unrelated to
 * the package, the build, or anything else actually running. cloud#1537
 * needed the SERVING PROCESS to name the artifact it runs (a production
 * container served a three-month-old image behind four green deploys, and
 * boot-freshness checks alone could not see it); `/health` was the natural
 * home but the field never changed, so cloud stamped its own response
 * header (`x-objectstack-build-sha`) instead. Fixed per the #10993 triage
 * ruling: an injected build stamp / env var, read once at dispatcher
 * construction, falling back to the resolved `@objectstack/runtime` package
 * version — never a literal. The liveness contract itself is unchanged
 * (framework#3756): this file only supplies the VALUE, `/health` still
 * checks nothing beyond "this process is executing code".
 *
 * `OS_RUNTIME_VERSION` is not a new name: `cloud-connection-plugin.ts`
 * already reads it (with a per-plugin literal fallback) to name the runtime
 * in a device-bind approval URL and the cloud-side bind payload. Reusing it
 * here — with a real package-version fallback instead of a fixed string —
 * keeps one env var meaning one thing across the codebase, per AGENTS.md
 * Prime Directive #9's `OS_{DOMAIN}_{NAME}` config-value shape (`RUNTIME` is
 * the domain, `VERSION` the value; no `_ENABLED`/`_ALLOW_`/`_SKIP_` shape
 * applies — this is a value, not a flag or an escape hatch).
 */

import { createRequire } from 'node:module';
import { getEnv } from '@objectstack/core';

/**
 * `null` = not yet resolved: `undefined` (a legitimate resolved outcome —
 * the read failed) would compare equal to "unset" if used as the sentinel.
 */
let cachedPackageVersion: string | undefined | null = null;

/**
 * `@objectstack/runtime`'s own installed version, read from its
 * `package.json`. That file sits one directory above both `src/` (tests
 * running against source) and the bundled `dist/index.{js,cjs}` (tsup,
 * single-entry, `splitting: false`, so the whole package collapses into one
 * file per format) — `../package.json` resolves the same package.json from
 * either shape. `createRequire` (not a static `import … with { type:
 * "json" }`) matches the resolution style already used for this exact kind
 * of read elsewhere in the repo (`packages/cli/src/utils/spec-version.ts`)
 * and needs no JSON-module-assertion support from the build target.
 */
function resolvePackageVersion(): string | undefined {
    if (cachedPackageVersion !== null) return cachedPackageVersion;
    try {
        const require = createRequire(import.meta.url);
        const pkg = require('../package.json') as { version?: unknown };
        cachedPackageVersion = typeof pkg.version === 'string' && pkg.version.length > 0
            ? pkg.version
            : undefined;
    } catch {
        cachedPackageVersion = undefined;
    }
    return cachedPackageVersion;
}

/**
 * The version this runtime process should report of itself.
 *
 * 1. `OS_RUNTIME_VERSION` — an operator/build-pipeline-injected stamp (image
 *    tag, git sha, release version). Read live (not memoized): a construction
 *    time env read is exactly what "at kernel construction" calls for, and
 *    tests that set/unset the variable around constructing a fresh
 *    `HttpDispatcher` must see it take effect without a stale cache.
 * 2. The resolved `@objectstack/runtime` package version, when no stamp was
 *    injected.
 * 3. `'unknown'` — only if BOTH of the above are unavailable (the package's
 *    own `package.json` is unreadable). Honest about not knowing, rather than
 *    a plausible-looking literal a caller could mistake for real identity —
 *    the exact failure mode #10993 exists to close.
 */
export function resolveRuntimeVersion(): string {
    return getEnv('OS_RUNTIME_VERSION') || resolvePackageVersion() || 'unknown';
}
