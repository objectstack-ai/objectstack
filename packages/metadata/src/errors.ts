// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata/errors` — the shared driver-error discriminators for
 * the metadata storage seams (#4728 / #4825 / #4867 family).
 *
 * ## Why this subpath exists
 *
 * The "which driver failures may be silenced?" question is not local to one
 * package. It was answered first for DDL in `@objectstack/metadata`
 * (`ensureSchema`, #4728), then for reads on the legacy `DatabaseLoader` path
 * (`nextEventSeq`, #4825) — and the *canonical* transactional producer of the
 * very same numbers, `SysMetadataRepository`, lives in a different package
 * (`@objectstack/metadata-protocol`, #4867) and carried the identical defect.
 *
 * Three ways to serve that second package were considered; the third is the
 * one taken, and the first is the one this module exists to prevent:
 *
 *  1. **Copy the predicate.** Rejected. Two hand-rolled vocabularies of
 *     "benign driver error" is precisely the dual-source debt #4825 killed:
 *     a driver quirk taught to one copy and not the other produces two
 *     packages that disagree about whether data may be silently invented.
 *  2. **Sink it into a common dependency** (`@objectstack/types`,
 *     `@objectstack/spec/shared`). Architecturally attractive and explicitly
 *     *not* precluded by this module — but out of scope on the round that
 *     needed it (spec was frozen; types was under concurrent change).
 *     ⇒ **TAKEN, by the maintainer's 2026-08-30 ruling on #13279.** The
 *     predicate now lives in `@objectstack/types`
 *     (`driver-error-classification.ts`); what forced it was a consumer this
 *     file could never serve — `resolveAuthzContext` in `@objectstack/core`,
 *     which metadata **depends on**, so the edge could not point that way.
 *  3. **Export it deliberately from its current home** — this file. One
 *     declaration, one implementation, one place a new driver quirk is taught.
 *
 * ## What this file is now
 *
 * Option 2 is taken, so this is the compatibility seam it always said it would
 * become — "a single, greppable seam to delete if the maintainer later takes
 * option 2". It is NOT deleted: `@objectstack/metadata/errors` is a published
 * subpath with out-of-repo consumers, and #13279 is a fix, not a removal. It
 * re-exports the one symbol it always exported, from the new home. Everything
 * below still describes why the subpath exists and why it stays narrow.
 *
 * ## Why a subpath and not the package entry
 *
 * `@objectstack/metadata`'s root entry pulls the manager, every loader and the
 * YAML/filesystem machinery behind them. A consumer that wants a 40-line
 * predicate should not have to load any of that, and the weight is exactly
 * what would tempt the next author back to option 1. This entry re-exports
 * one leaf module and nothing else, so the cross-package edge stays a leaf
 * edge — and stays a single, greppable seam to delete if the maintainer later
 * takes option 2.
 *
 * ## What the subpath actually loads — measured, and only half as promised
 *
 * The paragraph above is about the manager and the YAML machinery, and that
 * half is accurate. MEASURED 2026-09-08 on `origin/main` 8c1515e847, with
 * `scripts/check-lean-entry-closure.mjs`'s exported `measure()`/`byPackage()`
 * (one fresh child per published condition, module set collected through
 * `module.registerHooks` unioned with `require.cache`): both conditions load
 * FOUR packages, and the manager, every loader, `chokidar`, `glob`, `js-yaml`
 * and `readdirp` are all absent from every one of them.
 *
 * What does NOT follow — and is the general conclusion a reader takes from
 * the paragraph above — is that the entry is therefore light:
 *
 *     condition        packages   modules       bytes
 *     import (ESM)            4        83   2,201,709
 *     require (CJS)           4        83   2,355,405
 *
 *     the four: `@objectstack/spec`, `zod`, `@objectstack/types`, and
 *     `@objectstack/metadata` — this file, 143 B of the ESM total.
 *
 * ⛔ Those figures are PROVENANCE, dated and tree-pinned in the manner the
 * script above keeps its own: nothing derives from them and nothing compares
 * against them. They rot. The same measurement at `6e67b86c0` four days
 * earlier found the same 83 modules but 2,487,842 bytes — 286,133 more —
 * without this file changing at all. ⇒ re-take them with that script rather
 * than quote them, and note what #9803 concluded for the neighbouring
 * boundary: the claim worth making is the EXCLUSION above, never a size.
 *
 * The weight arrives through the re-export, not through anything this package
 * ships. `@objectstack/types` builds to one bundled module which imports
 * `@objectstack/spec/api` (1,401,253 B) and `@objectstack/spec/security`
 * (195,367 B) at module top, both as VALUES; the two spec entries are
 * independent of each other and each pulls `zod`. `api` is thus the dominant
 * edge at 7x `security` — a chain wider than the `security`-only one #15346
 * recorded.
 *
 * ⚠️ Two different costs, and ⛔ never one. IN-REPO this entry's marginal
 * contribution is 143 bytes: the only current consumer of the subpath,
 * `@objectstack/metadata-protocol`, declares `@objectstack/spec` itself and
 * pays for that closure regardless. The megabytes are what an OUT-OF-REPO
 * consumer pays for a 40-line predicate — unmeasurable from here, which is
 * ⛔ not a reason to treat it as zero.
 *
 * Recorded, not repaired. Collapsing the chain means a lazy or type-only edge
 * from the predicate's home in `@objectstack/types` to `@objectstack/spec`,
 * which is a `packages/types` + `packages/spec` change and the `domain:spec`
 * seat's call rather than this lane's (#15346).
 *
 * ## Scope of the promise
 *
 * Only {@link isMissingTableError} is re-exported HERE. Its sibling
 * `isSchemaAlreadyExistsError` moved to `@objectstack/types` with it (they are
 * two signatures over one matcher and cannot be separated without re-rolling
 * it), but it does not need a second door: nothing imports it through
 * `@objectstack/metadata/errors`, and an exported symbol nobody imports is a
 * promise made for nothing (Prime Directive #10, pointed at our own API
 * surface). Anything that needs it reads `@objectstack/types` directly.
 */

export { isMissingTableError } from '@objectstack/types';
