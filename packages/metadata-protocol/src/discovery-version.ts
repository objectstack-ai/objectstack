// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Resolves the value `ObjectStackProtocolImplementation.getDiscovery()` serves
 * as the `DiscoverySchema` "System Identity" `version` field (`./protocol.ts`).
 *
 * ## #11235 — why the literal it replaces was provably not a contract value
 *
 * This producer hardcoded `version: '1.0'`. It is the SECOND
 * `DiscoverySchema`-conforming producer; the first
 * (`HttpDispatcher.getDiscoveryInfo()`, plus `GET /health`, both in
 * `@objectstack/runtime`) hardcoded `'1.0.0'` until #10993 derived it. The two
 * producers of the SAME `version: z.string()` field therefore disagreed with
 * each other — and that, not anyone's opinion about what `version` "should"
 * be, is the argument: if the field were a contract, two producers would not
 * each invent their own constant; if it is not a contract, it should not be
 * hardcoded at all.
 *
 * ## Why a package-local copy rather than an import
 *
 * `packages/runtime/src/runtime-version.ts` holds the identical resolver and
 * CANNOT be imported here: `@objectstack/runtime` depends on
 * `@objectstack/metadata-protocol`, not the reverse, so importing it would
 * invert the dependency direction. Hoisting a shared helper into
 * `@objectstack/types` or `@objectstack/core` (both already dependencies of
 * this package) was considered and declined at #11235 triage: a hoist widens
 * two packages' published surface for ~10 lines serving two call sites.
 * Consolidation rides a later card if a third caller ever appears.
 *
 * ## Why `OS_RUNTIME_VERSION` — the SAME variable the first producer reads
 *
 * One stamp, one meaning. A deployment that injects `OS_RUNTIME_VERSION` now
 * gets the same answer from both discovery producers and from `/health`, which
 * is exactly the disagreement above, closed at its source: the two producers
 * can no longer drift on a stamped host because there is nothing left for
 * either of them to invent. The variable is not new — `cloud-connection-
 * plugin.ts` already reads it, and #10993 made it `/health`'s source — and it
 * matches AGENTS.md Prime Directive #9's `OS_{DOMAIN}_{NAME}` config-value
 * shape (`RUNTIME` is the domain, `VERSION` the value; no `_ENABLED` /
 * `_ALLOW_` / `_SKIP_` shape applies, this being a value rather than a flag or
 * an escape hatch).
 *
 * The fallback is the one place this resolver differs from its sibling, and
 * necessarily so: it resolves THIS package's own installed version, because
 * `@objectstack/metadata-protocol` is the artifact whose identity this
 * producer can honestly report when no stamp was injected.
 */

import { createRequire } from 'node:module';
import { getEnv } from '@objectstack/core';

/**
 * `null` = not yet resolved. `undefined` is a legitimate resolved outcome (the
 * read failed), so it cannot double as the "unset" sentinel.
 */
let cachedPackageVersion: string | undefined | null = null;

/**
 * `@objectstack/metadata-protocol`'s own installed version, read from its
 * `package.json`.
 *
 * That file sits one directory above both `src/` (tests running against
 * source) and the built `dist/` output, so `../package.json` resolves the same
 * `package.json` from either shape. This package's `tsup.config.ts` uses
 * `splitting: true`, which emits `dist/chunk-*.js` alongside `dist/index.js` —
 * siblings at the same depth, so a chunked build resolves identically.
 *
 * `createRequire` (not a static `import … with { type: "json" }`) matches the
 * resolution style already used for this exact kind of read elsewhere in the
 * repo (`packages/runtime/src/runtime-version.ts`,
 * `packages/cli/src/utils/spec-version.ts`) and needs no JSON-module-assertion
 * support from the build target. Its CJS half depends on `shims: true` in this
 * package's tsup config — see the comment there.
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
 * The version this producer should report as the serving system's identity.
 *
 * 1. `OS_RUNTIME_VERSION` — an operator/build-pipeline-injected stamp (image
 *    tag, git sha, release version). Read live, not memoized: `getDiscovery()`
 *    builds a fresh document per call, so there is no construction moment to
 *    freeze against, and tests that set/unset the variable around a call must
 *    see it take effect without a stale cache.
 * 2. The resolved `@objectstack/metadata-protocol` package version, when no
 *    stamp was injected.
 * 3. `'unknown'` — only if BOTH of the above are unavailable (the package's own
 *    `package.json` is unreadable). Honest about not knowing, rather than a
 *    plausible-looking literal a caller could mistake for real identity — the
 *    exact failure mode #10993 and #11235 exist to close.
 */
export function resolveDiscoveryVersion(): string {
    return getEnv('OS_RUNTIME_VERSION') || resolvePackageVersion() || 'unknown';
}
