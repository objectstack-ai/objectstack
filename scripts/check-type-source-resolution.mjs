#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-type-source-resolution — a package's TYPES must be a verdict about the
// source in the checkout, never about a sibling package's build artifact.
//
// ── The asymmetry this closes (#7849, #8021, #8180) ─────────────────────────
//
// `check:test-source-alias` made the source-resolution invariant mechanical on
// the RUNTIME axis: it reads every package's `vitest.config.*`, simulates
// Vite's resolution, and demands that anything still landing on `dist/` be
// registered. Its header states why a sweep is the wrong terminal state — "it
// leaves the NEXT package unguarded, and the symptom of the omission is a
// green test, so nothing would report the gap".
//
// That reasoning is axis-independent. The gate was not: it reads
// `vitest.config.*` and nothing else, so the identical exposure on the TYPE
// axis was unguarded repo-wide, and its symptom is likewise a green
// `typecheck`. `.github/workflows/lint.yml` even documents the exposure as the
// expected state, beside the type-check-debt re-measure step — "tsc resolves
// workspace imports through each dependency's built `dist/*.d.ts`".
//
// Measured end to end on `packages/qa/downstream-contract` (#8021). Identical
// checkout, identical stale `dist`, a narrowing injected into
// `packages/spec/src/integration/connector.zod.ts` in SOURCE ONLY, no rebuild:
//
//   without a `paths` block   `tsc --noEmit` -> exit 0, CLEAN
//   with a `paths` block      src/additional-domains.fixtures.ts(35,3): error
//                             TS2322: Type 'string' is not assignable to type
//                             'number'.
//
// That package is the repo's backward-compatibility gate, whose README
// promises "a removed or NARROWED export fails here" — so it was the loudest
// instance, not the only one. Ordering does not reach any of them: `turbo.json`
// orders `typecheck` after `^build`, so `turbo run typecheck` and CI were never
// the failing paths. What breaks is every path turbo does not mediate —
// `pnpm --filter PKG typecheck` inside a package, an editor's TS server, an
// agent in a tree built at an older commit. Those are exactly the paths a type
// contract is re-read on WHILE someone is changing the dependency.
//
// ── Why this is NOT a port of the vitest gate ──────────────────────────────
//
// Four things differ, and each one is a way a copied gate would be wrong:
//
//   1. THE RESOLUTION ALGORITHM. Vite's is first-match-wins with prefix
//      matching. tsc's is: an EXACT (star-free) key wins outright regardless of
//      declaration order; otherwise the pattern key with the LONGEST MATCHING
//      PREFIX wins, and the captured text substitutes into the target's star.
//      #8020 and #8108 are both defects in how the vitest gate read a CORRECT
//      config — a resolution simulator that is wrong reads compliant packages
//      as broken, so the algorithm is written here from tsc's rules and pinned
//      by `--self-test`, never inherited.
//
//   2. THE TRAP HAS A DIFFERENT SPELLING AND IS WORSE. A `paths` key without a
//      `*` is an EXACT match, so a bare `@objectstack/spec` entry cannot
//      swallow `@objectstack/spec/ui` the way a Vite object-form alias does
//      (that one is `ENOTDIR`, loud, at run time). The tsconfig-shaped mistake
//      is `@objectstack/spec*` — star NOT preceded by a slash — which matches
//      every namespace AND the bare name and folds them all onto whatever the
//      target names. It does not crash: `spec/src/index.ts` re-exports most of
//      the namespace surface, so it type-checks against the WRONG MODULE and
//      stays green. A gate that does not flag that spelling certifies the exact
//      defect it exists to find; `--self-test` fixture (5) is that case.
//
//   3. `tsconfig.json` IS JSONC AND IT INHERITS. 55 of this repo's 76 package
//      tsconfigs carry comments and 66 use `extends` — both are the norm here,
//      not an edge case, and `vitest.config.*` has neither property. Comments
//      are stripped before `JSON.parse` (the same whole-line rule
//      `scripts/check-type-check-coverage.mjs` uses), and the `extends` chain
//      is resolved before `paths` is read. `compilerOptions` merge SHALLOWLY,
//      so a child's `paths` REPLACES the parent's rather than adding to it, and
//      relative targets resolve against `baseUrl` if declared and otherwise
//      against the directory of the config that ORIGINATED them — which is not
//      necessarily the package's own tsconfig.
//
//   4. TYPE-ONLY IMPORTS COUNT HERE. They are the exact inversion of the
//      vitest gate's rule 1: `import type { X } from 'y'` is erased before
//      anything resolves at run time, so that gate does not count it — and on
//      this axis it is precisely what tsc resolves, to `y`'s `.d.ts`. A port
//      that kept the type-only filter would go blind on the majority of the
//      imports it exists to judge.
//
// ── What this checks ───────────────────────────────────────────────────────
//
// For every tsc PROGRAM a workspace package runs — its `tsconfig.json` plus
// every `tsconfig*.json` its `typecheck` script NAMES (#11490; see
// `programConfigsFor` for why named and not globbed):
//
//   1. Determine the files tsc puts in the program (`files` / `include` /
//      `exclude`, with TS's defaults), and collect the workspace packages they
//      import — ALL imports, type-only included (see 4 above).
//   2. Keep only the deps whose TYPES can go stale: the dep's declaration entry
//      resolves under `dist/`. A dep whose types already point at source is not
//      an artifact and needs no `paths` rule — counting it would be a false
//      positive the registry then has to carry forever.
//   3. Resolve each specifier through the effective `paths` using TSC'S
//      algorithm (1 above). A specifier whose winning target lands under `src/`
//      — and exists on disk — is safe. A target that does NOT exist is not
//      safe: tsc falls back to node resolution, i.e. to `dist`, silently.
//   4. Anything left resolves through a build artifact, and the package must be
//      registered in `KNOWN_DIST_RESOLVED_TYPE_IMPORTS` below with EXACTLY that
//      set — the UNION over the package's programs, since the registry is keyed
//      by package and an exposure is an exposure whichever program reaches it.
//      Unregistered ⇒ red.
//
// Rules are judged INDIVIDUALLY, never "does a `paths` block exist". Measured
// on #8021: with the subpath rule kept and only the bare-entry rule deleted,
// tsc stayed clean while `src/stack.ts`'s `defineStack` types came from `dist`.
// A `paths` block that covers eight of nine specifiers is eight-ninths of a
// verdict, and the ninth is silent.
//
// ── The registry, and what its SIZE means ──────────────────────────────────
//
// `KNOWN_DIST_RESOLVED_TYPE_IMPORTS` is the measured state of the repo on the
// day this gate landed, and it is LARGE: exactly one package (`downstream-
// contract`, fixed by #8021) declares a `paths` rule for a workspace dep at
// all. So this gate finds no new offender today — it is a RATCHET, and that is
// the whole of its value: the list of remediation cards is now finite, audited
// in both directions, and unable to grow behind anyone's back. That is the same
// trade `check:test-source-alias` made and its header argues for; it is stated
// plainly here so a large registry is not read as a large finding.
//
// ⛔ SHRINK-ONLY, audited in BOTH directions, like `UNRESOLVED_ADR_CITATIONS`
// in `check-adr-anchors.mjs`: an entry that is no longer needed FAILS and names
// itself for deletion, so the registry cannot rot into a grandfather clause.
// Each entry carries the exact set of dist-resolved deps and the audit demands
// set EQUALITY — a bare list of package names would license a listed package to
// acquire ten NEW artifact imports with nothing going red, which is the silent
// regression headroom the type-check DEBT ledger paid 273 raw errors for.
//
// ⛔ Two things this gate deliberately does NOT do:
//   - It does not add or edit any package's `tsconfig.json`. Remediation is
//     per-package and lands as its own card, because the switch is not free:
//     putting a dependency's SOURCE into a consumer's program makes tsc check
//     that source under the CONSUMER's `compilerOptions`, which on #8021
//     surfaced 2 `TS2591` (spec source needs `types: ["node"]`) and 247
//     `TS6059` from a `rootDir` that emits nothing under `noEmit` and is still
//     enforced. The gate's job is to make the list of cards finite.
//   - It does not fail a package for having no `paths` block. A package that
//     imports no stale-able workspace dep needs none, and demanding one would
//     be cargo cult. The predicate is the import, not the file.
//
// Usage:
//   node scripts/check-type-source-resolution.mjs
//   node scripts/check-type-source-resolution.mjs --list      # registry-shaped
//   node scripts/check-type-source-resolution.mjs --self-test

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isExclusionGlob,
  readWorkspaceGlobs,
  selfTest as workspaceEnumeratorSelfTest,
} from './workspace-enumerator.mjs';
// The `typecheck`-script -> tsconfig program set, shared with
// `check-type-check-coverage.mjs` (#11490). Imported rather than re-derived:
// two copies of that predicate drift, and the symptom of drift is a green gate
// on either side.
import { configsNamedByTypecheck, selfTest as typecheckConfigsSelfTest } from './typecheck-configs.mjs';
import { tmpdir } from 'node:os';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * Packages whose tsc program imports a workspace package whose declarations
 * resolve to `dist/`, with no `paths` rule redirecting it to source — i.e.
 * packages whose type verdicts are currently a function of build state.
 *
 * MEASURED, not curated: this is what `--list` printed on the day the gate
 * landed. Each value is the exact set of dist-resolved type imports for that
 * package.
 *
 * ⛔ SHRINK-ONLY. Adding an entry, or widening one, is not how a red build gets
 * fixed — add the rule to that package's `tsconfig.json` instead (see the
 * header for the two rules `downstream-contract` uses and the `@pkg*` spelling
 * that must never be used). Entries are audited in both directions, so one that
 * is no longer needed fails the gate and names itself for deletion.
 *
 * ## The one thing that is NOT a violation of that: a re-baseline (#11490)
 *
 * This registry grew when the gate's POPULATION widened from "each package's
 * `tsconfig.json`" to "every `tsconfig*.json` its `typecheck` script names".
 * Nothing about the repo changed and no new exposure was admitted — the same
 * imports were always there, in tsc programs CI has been running on every PR,
 * and the instrument could not see them. The measured before/after, both from
 * `--list` on the same checkout:
 *
 *   before   77 programs / 77 packages, 51 entries, 221 package-dep pairs
 *   after    93 programs / 77 packages, 54 entries, 233 package-dep pairs
 *
 * so +16 programs, +3 entries (`plugin-webhooks`, `service-messaging`,
 * `service-realtime`, all reached only through `tsconfig.scripts.json`) and
 * +12 pairs. The ratchet is shrink-only from the NEW number; the widening is
 * the only thing that may ever move it up, and a widening states its numbers
 * here or it is indistinguishable from a ratchet quietly reset.
 *
 * ⛔ Do NOT reach for this precedent to admit an exposure your change created.
 * The test is whether the SET OF PROGRAMS changed.
 *
 * ## Who may move the program set (this paragraph was falsified by #11490)
 *
 * ⚠️ That test used to end "…and that is a change to this file, not to a
 * package". It was true only while the population was each package's single
 * `tsconfig.json`: no package COULD move the set. #11490 made the population
 * every `tsconfig*.json` a `typecheck` script names — which handed the move to
 * the packages. A package whose `typecheck` script begins naming a
 * `tsconfig.test.json` has moved the set BY DEFINITION, because that is what
 * onboarding a test layer IS. The sentence outlived its invariant, and while it
 * stood it forbade the only correct action for that case: #11491 measured 14 of
 * the 18 remaining `TEST_DEBT` entries as arriving exactly here the moment
 * their tests enter a program.
 *
 * So the re-baseline limb is open to a package too — on the terms this registry
 * already imposes on itself, and no others:
 *
 *   1. Every dep admitted is reached ONLY through the program the change
 *      ONBOARDED. A dep newly reached through a program that was ALREADY
 *      counted is the exposure this ratchet exists to catch, and onboarding
 *      something else in the same PR does not launder it. The provenance
 *      annotation (`via <config>`) in `--list` and in the failure text is what
 *      tells the two apart; if you cannot point at the program, you do not have
 *      this case.
 *   2. The numbers are stated in place — `--list` before and after — the way
 *      the #11490 re-baseline above states its own. A widening that does not is
 *      indistinguishable from a ratchet quietly reset.
 *   3. It is a RE-BASELINE reviewed as one, not an escape from a red build. The
 *      failure text goes on refusing the widening deliberately: an author who is
 *      merely red cannot tell these two cases apart from inside the failure, and
 *      this doc-block plus a reviewer is where they are told apart.
 *
 * Landed instances, each stating its program provenance in place:
 * `@objectstack/client` and `@objectstack/trigger-record-change` (the #11490
 * re-baseline), and `@objectstack/rest` (#12542 / PR #12570 at `3f41a215`, the
 * first package to take the #5286 sibling route for this reason).
 *
 * ⛔ Still NOT open: `paths` remains the fix for a dep exposed through an
 * EXISTING program, and no widening may silence one. For the onboarding case
 * `paths` is additionally the WRONG tool, measured on PR #12570 rather than
 * argued: redirecting those six deps to source took that package's test layer
 * from 37 errors to 42, the +5 being `TS6133` in other packages' source billed
 * to a ledger those packages cannot see — and a ledger holding another
 * package's diagnostics is a ledger nobody can pay down.
 */
const KNOWN_DIST_RESOLVED_TYPE_IMPORTS = {
  '@objectstack/account': ['@objectstack/platform-objects'],
  // #11490 re-baseline. Everything after `@objectstack/core` here arrives from
  // `tsconfig.test.json`, a program CI has run on every PR since PR #5546 and
  // which this gate could not see until its population became per-PROGRAM.
  '@objectstack/client': [
    '@objectstack/core', '@objectstack/driver-sqlite-wasm', '@objectstack/objectql',
    '@objectstack/plugin-hono-server', '@objectstack/runtime', '@objectstack/spec',
  ],
  '@objectstack/client-react': ['@objectstack/client', '@objectstack/spec'],
  '@objectstack/connector-mcp': ['@objectstack/core', '@objectstack/spec'],
  '@objectstack/connector-openapi': ['@objectstack/core', '@objectstack/spec'],
  '@objectstack/connector-rest': ['@objectstack/core', '@objectstack/spec'],
  '@objectstack/connector-slack': [
    '@objectstack/core', '@objectstack/service-automation', '@objectstack/spec',
  ],
  '@objectstack/core': ['@objectstack/metadata-core', '@objectstack/spec'],
  '@objectstack/dogfood': [
    '@objectstack/connector-mcp', '@objectstack/connector-openapi',
    '@objectstack/connector-rest', '@objectstack/core', '@objectstack/driver-sql',
    '@objectstack/driver-sqlite-wasm', '@objectstack/mcp', '@objectstack/metadata',
    '@objectstack/metadata-core', '@objectstack/objectql', '@objectstack/platform-objects',
    '@objectstack/plugin-audit', '@objectstack/plugin-auth', '@objectstack/plugin-email',
    '@objectstack/plugin-security', '@objectstack/plugin-webhooks', '@objectstack/service-analytics',
    '@objectstack/service-messaging', '@objectstack/service-storage', '@objectstack/spec',
    '@objectstack/types', '@objectstack/verify',
  ],
  '@objectstack/driver-memory': ['@objectstack/core', '@objectstack/spec', '@objectstack/types'],
  '@objectstack/driver-mongodb': ['@objectstack/core', '@objectstack/spec', '@objectstack/types'],
  '@objectstack/driver-sql': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/observability', '@objectstack/spec',
    '@objectstack/types',
  ],
  '@objectstack/driver-sqlite-wasm': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/formula', '@objectstack/spec',
  ],
  // [#13513] `@objectstack/verify` shrank out of this entry when
  // `src/date-bucket-parity.test.ts` moved to `packages/qa/dogfood`. That test
  // was the driver's only importer of it, and its devDependency was the one
  // edge that made this workspace's manifest graph cyclic
  // (runtime -peer(optional)-> driver-turso -dev-> verify -dep-> runtime), which
  // left every `pnpm --filter 'PKG^...' build` with no topological order.
  '@objectstack/driver-turso': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/spec',
  ],
  '@objectstack/embedder-openai': ['@objectstack/spec'],
  '@objectstack/example-crm': ['@objectstack/driver-sql', '@objectstack/objectql', '@objectstack/spec'],
  '@objectstack/example-embed-objectql': [
    '@objectstack/driver-memory', '@objectstack/objectql', '@objectstack/spec',
  ],
  // #8990 / PR #9280 — `@objectstack/formula` came OUT of this entry (a shrink) when
  // the app's tsconfig gained a `paths` rule pointing at formula's SOURCE. The test
  // added there typechecks against the CEL engine's contract, and a stale `dist/*.d.ts`
  // would typecheck GREEN over a contract that has since moved — the dangerous
  // direction this file's header names. Same pair examples/app-crm moved through on
  // PR #9166.
  '@objectstack/example-showcase': [
    '@objectstack/cloud-connection', '@objectstack/connector-mcp', '@objectstack/connector-openapi',
    '@objectstack/connector-rest', '@objectstack/connector-slack', '@objectstack/core',
    '@objectstack/driver-sql', '@objectstack/objectql',
    '@objectstack/plugin-approvals', '@objectstack/runtime', '@objectstack/service-automation',
    '@objectstack/service-datasource', '@objectstack/service-messaging', '@objectstack/spec',
  ],
  '@objectstack/example-todo': [
    '@objectstack/core', '@objectstack/driver-sqlite-wasm', '@objectstack/mcp', '@objectstack/objectql',
    '@objectstack/runtime', '@objectstack/service-automation', '@objectstack/spec',
    '@objectstack/trigger-record-change',
  ],
  '@objectstack/formula': ['@objectstack/spec'],
  '@objectstack/hono': ['@objectstack/plugin-hono-server', '@objectstack/runtime', '@objectstack/types'],
  '@objectstack/http-conformance': ['@objectstack/core'],
  '@objectstack/knowledge-memory': ['@objectstack/core', '@objectstack/spec'],
  '@objectstack/knowledge-ragflow': ['@objectstack/core', '@objectstack/spec'],
  '@objectstack/lint': ['@objectstack/formula', '@objectstack/sdui-parser', '@objectstack/spec'],
  '@objectstack/mcp': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/metadata': [
    '@objectstack/core', '@objectstack/driver-sqlite-wasm', '@objectstack/metadata-core',
    '@objectstack/metadata-fs', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/metadata-core': ['@objectstack/spec'],
  '@objectstack/metadata-fs': ['@objectstack/metadata-core'],
  '@objectstack/metadata-protocol': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/lint', '@objectstack/metadata',
    '@objectstack/metadata-core', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/objectql': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/metadata', '@objectstack/metadata-core',
    '@objectstack/metadata-protocol', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/platform-objects': ['@objectstack/metadata-core', '@objectstack/spec'],
  '@objectstack/plugin-approvals': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/plugin-audit': ['@objectstack/core', '@objectstack/objectql', '@objectstack/spec'],
  // #11490 re-baseline: `@objectstack/plugin-hono-server` arrives from
  // `tsconfig.examples.json`.
  '@objectstack/plugin-auth': [
    '@objectstack/core', '@objectstack/platform-objects', '@objectstack/plugin-hono-server',
    '@objectstack/rest', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/plugin-email': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/objectql', '@objectstack/platform-objects',
    '@objectstack/service-queue', '@objectstack/service-settings', '@objectstack/spec',
  ],
  '@objectstack/plugin-hono-server': [
    '@objectstack/core', '@objectstack/observability', '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/plugin-pinyin-search': ['@objectstack/core', '@objectstack/objectql', '@objectstack/types'],
  '@objectstack/plugin-reports': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/objectql',
    '@objectstack/platform-objects', '@objectstack/spec',
  ],
  // #13176 re-baseline, on the onboarding limb above. The five deps after
  // `@objectstack/metadata-core` here arrive from `tsconfig.test.json` — a
  // program this repo had no equivalent of in this package until that card, and
  // whose 89 test files were read by NO tsc program at all (measured per program
  // with `--listFiles`: 0 of them in `tsconfig.json`, 0 in
  // `tsconfig.scripts.json`). Every one of the five is annotated `via
  // tsconfig.test.json` by this gate's own failure text, which is condition 1:
  // none is newly reached through a program that was already counted.
  // `paths` is not the tool here, by the doc-block's own measurement on
  // PR #12570 rather than by preference — and `vitest.config.ts` aliases four of
  // these to source already, so the RUNTIME axis is covered where it matters.
  // The numbers, as condition 2 requires them stated in place (`--list`,
  // workspace closure built):
  //
  //   before  94 programs / 77 packages, 54 entries, 238 package-dep pairs
  //   after   95 programs / 77 packages, 54 entries, 243 package-dep pairs
  //
  // so +1 program, +0 entries (this package already had one) and +5 pairs — the
  // five below and nothing else.
  '@objectstack/plugin-security': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/formula',
    '@objectstack/metadata-core', '@objectstack/metadata-protocol', '@objectstack/objectql',
    '@objectstack/platform-objects', '@objectstack/plugin-sharing', '@objectstack/service-i18n',
    '@objectstack/spec',
  ],
  // #11490 re-baseline: a NEW entry — reached only through `tsconfig.scripts.json`.
  '@objectstack/plugin-webhooks': ['@objectstack/spec'],
  '@objectstack/plugin-sharing': [
    '@objectstack/core', '@objectstack/formula', '@objectstack/metadata-core', '@objectstack/objectql',
    '@objectstack/platform-objects', '@objectstack/spec', '@objectstack/types',
  ],
  // #12542: `packages/rest` had NO tsc program compiling any of its 149 test
  // files, and its new `tsconfig.test.json` (the #5286 sibling route) is the
  // first one that does. The six deps after `@objectstack/core` here arrive
  // from that program, exactly as `@objectstack/client`'s and
  // `@objectstack/trigger-record-change`'s test-program deps do above.
  //
  // ⚠️ This is a program-set widening and its numbers are stated, per this
  // registry's own rule: before, at 5fbd58e0d, `--list` reported 93 programs /
  // 77 packages, 54 entries, 233 pairs; after, 94 programs / 77 packages, 54
  // entries, 239 pairs. +1 program, +0 entries, +6 pairs, all six in this one
  // package and all six reached only through `tsconfig.test.json`.
  //
  // Why the entry and not `paths` rules, which is what this gate's failure text
  // asks for: MEASURED both ways on the same checkout. `paths` redirecting
  // these six to source puts their `src` trees in the program and takes the
  // test layer from 37 errors to 42 — the +5 being TS6133 in
  // `../plugins/plugin-hono-server/src/{hono-plugin,current-user-endpoints}.ts`
  // and `../drivers/driver-sql/src/sql-driver.ts`, i.e. OTHER packages' source
  // billed to `packages/rest/test-typecheck-debt.json`, where they would then
  // red on those packages' PRs. It would also make the type program diverge
  // from the runtime one: `packages/rest/vitest.config.ts` aliases exactly two
  // of the six (`plugin-hono-server`, `service-datasource`) to source and
  // resolves the other four through `dist/`, so blanket `paths` here is not
  // fidelity to vitest either.
  '@objectstack/rest': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/metadata',
    '@objectstack/metadata-core', '@objectstack/objectql', '@objectstack/observability',
    '@objectstack/platform-objects', '@objectstack/plugin-hono-server', '@objectstack/plugin-security',
    '@objectstack/service-analytics', '@objectstack/service-datasource', '@objectstack/service-package',
    '@objectstack/spec', '@objectstack/types',
  ],
  '@objectstack/runtime': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/metadata', '@objectstack/metadata-core',
    '@objectstack/metadata-protocol', '@objectstack/objectql', '@objectstack/observability',
    '@objectstack/plugin-auth', '@objectstack/plugin-security', '@objectstack/rest',
    '@objectstack/service-cluster', '@objectstack/service-datasource', '@objectstack/spec',
    '@objectstack/types',
  ],
  // #11490 re-baseline: NEW entries — reached only through `tsconfig.scripts.json`.
  '@objectstack/service-messaging': ['@objectstack/spec'],
  '@objectstack/service-realtime': ['@objectstack/spec'],
  '@objectstack/service-sms': ['@objectstack/core', '@objectstack/plugin-auth', '@objectstack/spec'],
  '@objectstack/setup': ['@objectstack/platform-objects', '@objectstack/spec'],
  '@objectstack/studio': ['@objectstack/platform-objects', '@objectstack/spec'],
  '@objectstack/trigger-api': ['@objectstack/core', '@objectstack/spec'],
  // #11490 re-baseline, and the card's own measurement: these four arrive from
  // `tsconfig.test.json`. They were REPORTED when the identical 7 test files
  // were put through the build config and SILENT through the prescribed
  // sibling — the asymmetry this widening closes.
  '@objectstack/trigger-record-change': [
    '@objectstack/core', '@objectstack/driver-sql', '@objectstack/formula', '@objectstack/objectql',
    '@objectstack/service-automation', '@objectstack/spec',
  ],
  '@objectstack/trigger-schedule': [
    '@objectstack/core', '@objectstack/service-automation', '@objectstack/spec',
  ],
  '@objectstack/types': ['@objectstack/spec'],
  '@objectstack/verify': [
    '@objectstack/objectql', '@objectstack/platform-objects', '@objectstack/plugin-auth',
    '@objectstack/plugin-hono-server', '@objectstack/plugin-security', '@objectstack/plugin-sharing',
    '@objectstack/rest', '@objectstack/runtime', '@objectstack/service-analytics',
    '@objectstack/service-automation', '@objectstack/service-datasource', '@objectstack/service-settings',
    '@objectstack/spec', '@objectstack/types',
  ],
};

// ── workspace enumeration ───────────────────────────────────────────────────

/**
 * The workspace globs from pnpm-workspace.yaml, spelled AS GLOBS.
 *
 * ## Why the `/*` is written out rather than left to the comment (#9955)
 *
 * This array IS this gate's declared population: every package it walks lives
 * directly under one of these parents. `scripts/pm/dispatch-gates.mjs` derives
 * the gate list a dispatch brief pastes by scanning each gate's module body for
 * the path literals it operates on — so this array is the only thing that tells
 * that tool which cards should be sent here.
 *
 * Its covering rule refuses a literal with NO path separator (`packages`,
 * `apps`, `examples`) as too generic, deliberately and measured: admitting bare
 * top-level words takes that tool from 19k watch-hint pairs to 158k, because
 * `packages` is a path COMPONENT in dozens of gates that never read the root.
 * The sanctioned escape is for a gate to declare its own subtree in a spelling
 * with a separator in it, which is what these entries now do.
 *
 * Written as bare directory names, 8 of the 11 entries carried a separator and
 * 3 did not, so the derivation's answer for this gate was decided by WHERE a
 * package happens to sit: measured on this tree, 1832 of the 4844 tracked files
 * under packages/ derived this gate, and the ones that did not were exactly the
 * flat `packages/<pkg>` layouts plus all of apps/ and examples/. A new test in
 * a nested package named this gate; the identical test in a flat one did not,
 * and nothing in the output said so. That is worse than an honest blind spot —
 * it works for a third of the tree, so it reads as working.
 *
 * The dropped `/*` is re-derived below, so the walk is unchanged and there is
 * no second list to keep in sync. Keep the separator in every entry: a tidy-up
 * back to bare directory names re-opens the blind spot silently, and the
 * self-test case at the bottom of this file is what makes that loud instead.
 */
const WORKSPACE_PARENT_GLOBS = [
  'packages/*',
  'packages/apps/*',
  'packages/adapters/*',
  'packages/connectors/*',
  'packages/drivers/*',
  'packages/plugins/*',
  'packages/qa/*',
  'packages/services/*',
  'packages/triggers/*',
  'apps/*',
  'examples/*',
];

/** The parent directories those globs enumerate — each glob minus its leaf. */
const WORKSPACE_PARENT_DIRS = WORKSPACE_PARENT_GLOBS.map((glob) => glob.replace(/\/\*$/, ''));

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache']);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

class UnreadableConfig extends Error {}

function listWorkspacePackages(root) {
  const out = [];
  for (const parent of WORKSPACE_PARENT_DIRS) {
    const abs = join(root, parent);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      const dir = join(abs, name);
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      let json;
      try {
        json = JSON.parse(readFileSync(manifest, 'utf8'));
      } catch {
        continue;
      }
      if (!json.name) continue;
      out.push({ name: json.name, dir, rel: relative(root, dir), json });
    }
  }
  return out;
}

/**
 * Every declaration entry point this package publishes. Explicit `types` wins
 * where it exists — `types`, `typings`, and any `types` condition anywhere in
 * `exports`. Only when a package declares none of those does tsc fall back to
 * the JS entry's sibling `.d.ts`, so only then do the JS entries answer.
 */
function declarationTargets(json) {
  const explicit = [];
  if (typeof json.types === 'string') explicit.push(json.types);
  if (typeof json.typings === 'string') explicit.push(json.typings);

  const walk = (node, underTypes) => {
    if (typeof node === 'string') {
      if (underTypes) explicit.push(node);
      return;
    }
    if (node == null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      walk(value, underTypes || key === 'types');
    }
  };
  walk(json.exports, false);
  if (explicit.length > 0) return explicit;

  const fallback = [];
  const walkAll = (node) => {
    if (typeof node === 'string') {
      fallback.push(node);
      return;
    }
    if (node == null || typeof node !== 'object') return;
    for (const value of Object.values(node)) walkAll(value);
  };
  walkAll(json.exports);
  if (typeof json.main === 'string') fallback.push(json.main);
  if (typeof json.module === 'string') fallback.push(json.module);
  return fallback;
}

/**
 * Does importing this package's TYPES land on a build artifact? Any declaration
 * entry under `dist/` is enough: a stale build can then decide a consumer's
 * verdict through that entry, and which entry a given specifier reaches is the
 * consumer's business, not this predicate's.
 */
function typesResolveToArtifact(json) {
  return declarationTargets(json).some((target) => /(^|[^a-z])dist\//.test(target.replace(/\\/g, '/')));
}

// ── tsconfig reading: JSONC, `extends`, and where relative targets resolve ──

/**
 * `tsconfig.json` is JSONC. Whole-line `//` comments are stripped before
 * `JSON.parse`, exactly as `scripts/check-type-check-coverage.mjs` does — and
 * this is not a nicety here: 55 of 76 package tsconfigs in this repo carry
 * comments, several of them long rationale blocks that NAME the very specifiers
 * being matched. A gate that cannot parse them reads every one of those
 * packages as unreadable.
 */
function parseJsonc(raw, file) {
  const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
  try {
    return JSON.parse(stripped);
  } catch (error) {
    throw new UnreadableConfig(`${file} is not parseable as JSONC: ${error.message}`);
  }
}

function resolveExtendsTarget(spec, fromDir) {
  if (spec.startsWith('.')) {
    const base = resolve(fromDir, spec);
    for (const candidate of [base, base + '.json', join(base, 'tsconfig.json')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    throw new UnreadableConfig(`\`extends\` target does not exist: ${spec}`);
  }
  // Bare specifier — resolved out of node_modules, walking up.
  let dir = fromDir;
  for (;;) {
    for (const candidate of [
      join(dir, 'node_modules', spec),
      join(dir, 'node_modules', spec + '.json'),
      join(dir, 'node_modules', spec, 'tsconfig.json'),
    ]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new UnreadableConfig(`\`extends\` target cannot be resolved without node_modules: ${spec}`);
}

/**
 * The effective config for one tsconfig file, with its `extends` chain applied.
 *
 * `compilerOptions` merge SHALLOWLY — a child's `paths` REPLACES the parent's
 * whole map rather than merging into it — and `files` / `include` / `exclude`
 * are replaced outright by any config that declares them. Each option remembers
 * the config file it ORIGINATED in, because relative `paths` targets and
 * `baseUrl` resolve against that file's directory, which is not necessarily the
 * package's own tsconfig.
 */
function loadTsconfig(file, seen = new Set()) {
  const abs = resolve(file);
  if (seen.has(abs)) throw new UnreadableConfig(`\`extends\` chain is cyclic at ${abs}`);
  seen.add(abs);

  const json = parseJsonc(readFileSync(abs, 'utf8'), abs);
  const dir = dirname(abs);

  let compilerOptions = {};
  let originOf = {};
  let fileSet = {};

  const bases = json.extends == null ? [] : Array.isArray(json.extends) ? json.extends : [json.extends];
  for (const base of bases) {
    const parent = loadTsconfig(resolveExtendsTarget(base, dir), new Set(seen));
    compilerOptions = { ...compilerOptions, ...parent.compilerOptions };
    originOf = { ...originOf, ...parent.originOf };
    fileSet = { ...fileSet, ...parent.fileSet };
  }

  for (const [key, value] of Object.entries(json.compilerOptions ?? {})) {
    compilerOptions[key] = value;
    originOf[key] = dir;
  }
  for (const key of ['files', 'include', 'exclude']) {
    if (json[key] !== undefined) fileSet[key] = { value: json[key], dir };
  }

  return { file: abs, dir, compilerOptions, originOf, fileSet };
}

/**
 * Where a relative `paths` target is resolved from: `baseUrl` when declared
 * (itself relative to the config that declared IT), otherwise the directory of
 * the config that declared `paths`.
 */
function pathsBaseDir(config) {
  const pathsOrigin = config.originOf.paths ?? config.dir;
  const baseUrl = config.compilerOptions.baseUrl;
  if (typeof baseUrl === 'string') return resolve(config.originOf.baseUrl ?? config.dir, baseUrl);
  return pathsOrigin;
}

// ── the file set tsc actually puts in the program ───────────────────────────

/** A tsconfig glob as a RegExp over POSIX-separated paths relative to its dir. */
function globToRegExp(glob) {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:[^/]*/)*';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$');
}

const DEFAULT_EXCLUDES = ['node_modules', 'bower_components', 'jspm_packages'];

function walkFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(path, acc);
    } else if (entry.isFile()) {
      acc.push(path);
    }
  }
  return acc;
}

/**
 * The source files tsc puts in the program for this config: `files` plus
 * everything matching `include` (default `**​/*`), minus `exclude` (default
 * node_modules and friends, plus `outDir`). Directory-shaped excludes exclude
 * everything beneath them, as tsc's do.
 *
 * This is the type axis's ENTRY SET, and it is deliberately wider than the
 * vitest gate's: that one starts at test files and follows relative imports,
 * because a specifier only decides a runtime verdict if a test can reach it.
 * Here every file in the program is checked, so every import in it decides a
 * verdict — there is nothing to walk from.
 */
function programFiles(pkgDir, config) {
  const rel = (abs) => relative(pkgDir, abs).split(sep).join('/');

  const includeSpec = config.fileSet.include;
  const excludeSpec = config.fileSet.exclude;
  const filesSpec = config.fileSet.files;

  const excludes = (excludeSpec?.value ?? DEFAULT_EXCLUDES).map((g) => ({ glob: g, re: globToRegExp(g) }));
  const outDir = config.compilerOptions.outDir;
  if (typeof outDir === 'string') excludes.push({ glob: outDir, re: globToRegExp(outDir) });

  const isExcluded = (path) => {
    for (const { glob, re } of excludes) {
      if (re.test(path)) return true;
      const bare = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
      if (!/[*?]/.test(bare) && (path === bare || path.startsWith(bare + '/'))) return true;
    }
    return false;
  };

  const out = new Set();

  for (const entry of filesSpec?.value ?? []) {
    const abs = resolve(filesSpec.dir, entry);
    if (existsSync(abs)) out.add(abs);
  }

  // `files` alone, with no `include`, means exactly those files.
  if (filesSpec?.value?.length > 0 && includeSpec === undefined) return [...out];

  const includes = (includeSpec?.value ?? ['**/*']).map((g) => globToRegExp(g));
  const includeDir = includeSpec?.dir ?? pkgDir;
  for (const abs of walkFiles(includeDir)) {
    if (!SOURCE_FILE.test(abs)) continue;
    const path = relative(includeDir, abs).split(sep).join('/');
    if (isExcluded(rel(abs))) continue;
    if (includes.some((re) => re.test(path))) out.add(abs);
  }
  return [...out];
}

// ── import extraction ───────────────────────────────────────────────────────

/**
 * The clause capture is bounded to ONE statement by `[^;'"]` (#12555). This gate
 * carried the byte-identical first alternative to
 * `scripts/check-test-source-alias.mjs`, whose header block states the defect and
 * why excluding `;` alone is not enough (ASI leaves nothing for a `;`-class to
 * stop on; excluding the quotes is what closes it, because every intervening
 * specifier is quoted). The rest of THIS regex is deliberately not identical —
 * the dynamic-import alternative admits `:` and `<` as leading delimiters so that
 * `import('y').X` in a type annotation and inside a generic argument are seen —
 * and that half is untouched here.
 *
 * The consequence differs from the runtime gate's even though the regex bug is
 * the same. `extractTypeImports` reads only the SPECIFIER captures and never
 * `match[1]`, so an over-greedy clause could not corrupt a verdict here; it could
 * only make one disappear. A side-effect `import 'x';` followed by any
 * `import … from …` was swallowed whole, so a specifier this package really makes
 * tsc resolve went uncounted — a false GREEN, in the fail-closed direction this
 * gate is otherwise careful about. Bounding the clause can therefore only add
 * specifiers to the scan, never remove one.
 */
const IMPORT_PATTERNS =
  /(?:^|[\s;})])(?:import|export)\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|[\s;{(=,:<])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;{(=,])require\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;}])import\s+['"]([^'"]+)['"]/g;

/**
 * Every module specifier this file makes tsc resolve — INCLUDING type-only
 * imports, which is the inversion of the runtime gate's rule (see header note
 * 4). `import type { X } from 'y'` never resolves at run time and always
 * resolves at type time; filtering it here would go blind on the majority of
 * this axis's imports. `import('y').X` in type position is caught by the
 * dynamic-import branch.
 */
function extractTypeImports(text) {
  const specs = [];
  IMPORT_PATTERNS.lastIndex = 0;
  let match;
  while ((match = IMPORT_PATTERNS.exec(text))) {
    const spec = match[2] ?? match[3] ?? match[4] ?? match[5];
    if (spec) specs.push(spec);
  }
  return specs;
}

// ── tsc's `paths` resolution ────────────────────────────────────────────────

/**
 * Resolve `specifier` through `paths` the way TSC does — deliberately NOT the
 * way Vite does:
 *
 *   - an EXACT (star-free) key that equals the specifier wins outright,
 *     whatever the declaration order;
 *   - otherwise, among pattern keys whose prefix and suffix both match, the one
 *     with the LONGEST MATCHING PREFIX wins — again independent of order;
 *   - the captured text substitutes for the star in the target.
 *
 * Vite's algorithm is first-match-wins with prefix matching, and a gate that
 * used it would read correct configs as wrong (the #8020 / #8108 failure).
 *
 * Returns `null` when nothing matches, and null is a REAL ANSWER: it means tsc
 * falls through to node resolution, i.e. to `dist`.
 *
 * Only the FIRST target of a key is followed. tsc tries the list in order and
 * takes the first that exists, so a fallback list can only ever land somewhere
 * the first entry did not — reported below as "does not exist", never as safe.
 */
function resolveThroughPaths(specifier, paths, baseDir) {
  const exact = paths[specifier];
  if (exact && !specifier.includes('*') && exact.length > 0) {
    return { key: specifier, target: resolve(baseDir, exact[0]) };
  }

  let best = null;
  for (const [key, targets] of Object.entries(paths)) {
    const star = key.indexOf('*');
    if (star === -1 || !targets || targets.length === 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    if (best && best.prefixLength >= prefix.length) continue;
    const captured = specifier.slice(prefix.length, specifier.length - suffix.length);
    best = { prefixLength: prefix.length, key, target: resolve(baseDir, targets[0].replace('*', captured)) };
  }
  return best ? { key: best.key, target: best.target } : null;
}

const MODULE_SUFFIXES = ['', '.ts', '.tsx', '.d.ts', '.mts', '.cts', '.d.mts', '.d.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Does this `paths` target name something tsc can actually load? A rule whose
 * target does not exist is not a rule: tsc falls back to node resolution — to
 * `dist` — and says nothing. That silent fallthrough is the same failure class
 * as having no rule at all, so it is reported as one.
 */
function existsAsModule(target) {
  for (const suffix of MODULE_SUFFIXES) {
    const candidate = target + suffix;
    try {
      if (statSync(candidate).isFile()) return true;
    } catch {
      /* next candidate */
    }
  }
  for (const suffix of MODULE_SUFFIXES) {
    if (suffix === '') continue;
    try {
      if (statSync(join(target, 'index' + suffix)).isFile()) return true;
    } catch {
      /* next candidate */
    }
  }
  return false;
}

function pointsAtSource(path) {
  const posix = path.split(sep).join('/');
  return /(^|\/)src(\/|$)/.test(posix) && !/(^|\/)dist(\/|$)/.test(posix);
}

/**
 * The `@objectstack/spec*` trap: a pattern key whose star is NOT preceded by a
 * separator, matching a workspace package NAME. Such a key folds the bare
 * entry, every subpath and every sibling package sharing the prefix onto one
 * target. Unlike the Vite object-form trap it does not crash — the target
 * re-exports most of the surface, so it type-checks against the wrong module
 * and stays GREEN. This is the one spelling a type-axis gate must refuse
 * outright, whatever the rest of the config does.
 */
function starTraps(paths, workspaceNames) {
  const traps = [];
  for (const key of Object.keys(paths)) {
    const star = key.indexOf('*');
    if (star <= 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (prefix.endsWith('/')) continue;
    const swallowed = [...workspaceNames].filter(
      (name) => name.startsWith(prefix) && name.endsWith(suffix) && name.length >= prefix.length + suffix.length,
    );
    if (swallowed.length > 0) traps.push({ key, swallowed: swallowed.sort() });
  }
  return traps;
}

// ── the scan ────────────────────────────────────────────────────────────────

/**
 * Every tsc program a package runs, as config basenames — `tsconfig.json`
 * first, the rest alphabetical.
 *
 * ## Why this is not just `tsconfig.json` (#11490)
 *
 * This gate read `join(pkg.dir, 'tsconfig.json')` and nothing else, so every
 * other tsc program in the package was outside its declared population. That
 * is not an exotic case here: the repair this repo PRESCRIBES for a hidden
 * test layer — stated in AGENTS.md and in `check-type-check-coverage.mjs`'s
 * TESTS_COVERED docs — is precisely a SIBLING `tsconfig.test.json` named in
 * the `typecheck` script, and CI runs it on every PR.
 *
 * Measured on `packages/triggers/trigger-record-change` before this widening,
 * both spellings of the same 7 test files with the same four dist-resolved
 * type imports:
 *
 *   through the BUILD config    ✗ NEW dist-resolved type import(s): driver-sql,
 *                                 formula, objectql, service-automation
 *   through the SIBLING config  exit 0, count unchanged
 *
 * So following the house pattern was what made the exposure invisible, and an
 * author with a genuine choice between the two spellings got a green gate for
 * picking the one that hides more. Same files, same exposure, two answers — a
 * gate that is per-package where it needs to be per-PROGRAM.
 *
 * ## Why NAMED, not every `tsconfig*.json` on disk
 *
 * The criterion is "the `typecheck` script names it", never "the glob matches
 * it". A config no script invokes is decorative: putting it in the population
 * would report imports no tsc program ever resolves, and a gate that looks
 * stronger while measuring something nobody runs is worse than the state it
 * replaced, because it READS as covered. Measured on this tree at the widening:
 * 16 configs across 15 packages join the population, and
 * `packages/cli/tsconfig.build.json` — present on disk, named by no script —
 * correctly stays out.
 *
 * `configsNamedByTypecheck` answers in BASENAMES (see that module's header), so
 * every name is resolved against this package's own directory and dropped when
 * no file is there. `tsconfig.json` is always a candidate even when no
 * `typecheck` script exists at all: this population may only grow here, and a
 * package whose primary config stopped being read because its manifest lost a
 * script would be a SILENT narrowing.
 */
function programConfigsFor(pkg) {
  const named = configsNamedByTypecheck(pkg.json?.scripts ?? {});
  const present = [...new Set(['tsconfig.json', ...named])].filter((file) => existsSync(join(pkg.dir, file)));
  return present.sort((a, b) => (a === 'tsconfig.json' ? -1 : b === 'tsconfig.json' ? 1 : a.localeCompare(b)));
}

/**
 * One tsc program's verdict: which workspace deps its file set imports whose
 * types resolve through a build artifact, plus the config defects found on the
 * way. Resolution is per PROGRAM and cannot be hoisted to the package: `paths`,
 * `baseUrl` and the `extends` chain are properties of the config that was
 * loaded, and a sibling config that re-declares `compilerOptions` replaces its
 * parent's `paths` map outright rather than merging into it.
 */
function scanProgram(root, pkg, file, names, artifactPackages) {
  const empty = { file, fileCount: 0, distResolved: [], traps: [], missingTargets: [] };

  let config;
  try {
    config = loadTsconfig(join(pkg.dir, file));
  } catch (error) {
    if (!(error instanceof UnreadableConfig)) throw error;
    return { ...empty, unreadable: error.message };
  }

  const paths = config.compilerOptions.paths ?? {};
  const baseDir = pathsBaseDir(config);
  const files = programFiles(pkg.dir, config);

  /** bare workspace name -> the specifiers actually written */
  const imports = new Map();
  for (const source of files) {
    let text;
    try {
      text = readFileSync(source, 'utf8');
    } catch {
      continue;
    }
    for (const spec of extractTypeImports(text)) {
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      const scoped = spec.match(/^(@[^/]+\/[^/]+)(?:\/.*)?$/);
      const bare = scoped ? scoped[1] : spec.split('/')[0];
      if (bare === pkg.name || !names.has(bare)) continue;
      if (!imports.has(bare)) imports.set(bare, new Set());
      imports.get(bare).add(spec);
    }
  }

  const distResolved = [];
  const missingTargets = [];
  for (const [dep, specs] of [...imports].sort(([a], [b]) => a.localeCompare(b))) {
    if (!artifactPackages.has(dep)) continue; // types already point at source
    let anyDistResolved = false;
    for (const spec of [...specs].sort()) {
      const resolved = resolveThroughPaths(spec, paths, baseDir);
      if (!resolved) {
        anyDistResolved = true;
        continue;
      }
      if (!existsAsModule(resolved.target)) {
        missingTargets.push({ spec, key: resolved.key, target: relative(root, resolved.target) });
        anyDistResolved = true;
        continue;
      }
      if (!pointsAtSource(resolved.target)) anyDistResolved = true;
    }
    if (anyDistResolved) distResolved.push(dep);
  }

  return {
    file,
    fileCount: files.length,
    unreadable: null,
    distResolved,
    traps: starTraps(paths, names),
    missingTargets,
  };
}

function scan(root) {
  const workspace = listWorkspacePackages(root);
  const names = new Set(workspace.map((p) => p.name));
  const artifactPackages = new Set(workspace.filter((p) => typesResolveToArtifact(p.json)).map((p) => p.name));

  const packages = [];
  for (const pkg of workspace) {
    const configFiles = programConfigsFor(pkg);
    if (configFiles.length === 0) continue;

    const programs = configFiles.map((file) => scanProgram(root, pkg, file, names, artifactPackages));

    // dep -> the config(s) whose program reaches it, so a diagnostic can say
    // WHICH program to look in. Without it an author reads the build config,
    // finds no such import, and concludes the gate is wrong.
    const distResolvedBy = new Map();
    for (const program of programs) {
      for (const dep of program.distResolved) {
        if (!distResolvedBy.has(dep)) distResolvedBy.set(dep, []);
        distResolvedBy.get(dep).push(program.file);
      }
    }

    packages.push({
      name: pkg.name,
      rel: pkg.rel,
      programs,
      fileCount: programs.reduce((n, program) => n + program.fileCount, 0),
      unreadable: programs.find((program) => program.unreadable)?.unreadable ?? null,
      distResolved: [...distResolvedBy.keys()].sort((a, b) => a.localeCompare(b)),
      distResolvedBy,
    });
  }

  return {
    packages,
    artifactPackages,
    totalPackages: workspace.length,
    totalPrograms: packages.reduce((n, p) => n + p.programs.length, 0),
  };
}

// ── the gate ────────────────────────────────────────────────────────────────

function check(root, registry) {
  const failures = [];
  const { packages, artifactPackages, totalPackages, totalPrograms } = scan(root);

  // Census guard. Every reading below is a scan result, and a scan that has
  // quietly stopped matching reports a spotless repo. Zero is never the good
  // news it looks like.
  if (totalPackages === 0)
    failures.push('scanner found NO workspace packages at all — the scan is broken, not the repo');
  if (artifactPackages.size === 0)
    failures.push('scanner found NO package whose types resolve to `dist/` — entry detection is broken, not the repo');
  if (packages.length === 0)
    failures.push('scanner found NO package with a tsc program — config discovery is broken, not the repo');
  if (packages.length > 0 && packages.every((p) => p.fileCount === 0 && !p.unreadable))
    failures.push('scanner put NO file in ANY program — include/exclude handling is broken, not the repo');
  // The census leg the #11490 widening needs. Sibling-config discovery failing
  // is INVISIBLE without it: this gate reverts to exactly its old per-package
  // behaviour, every remaining program still scans, and the summary reads like
  // a clean repo. `configsNamedByTypecheck` returning an empty set for every
  // package — a regex that stopped matching, a manifest reader that stopped
  // seeing `scripts` — is that failure, and it is silent by construction.
  if (packages.length > 0 && packages.every((p) => p.programs.length <= 1))
    failures.push(
      'scanner found NO package running more than one tsc program — sibling-config discovery is broken, not\n' +
        '    the repo. The prescribed `tsconfig.test.json` route is the one this gate exists to be able to see.',
    );

  const measured = new Map(packages.filter((p) => p.distResolved.length > 0).map((p) => [p.name, p.distResolved]));

  for (const pkg of packages) {
    for (const program of pkg.programs) {
      if (program.unreadable) {
        failures.push(
          `${pkg.rel}/${program.file} cannot be read (${program.unreadable}).\n` +
            '    This gate must be able to resolve every `extends` chain and read every `paths` block.',
        );
      }
      for (const trap of program.traps) {
        failures.push(
          `${pkg.rel}/${program.file}: \`paths\` key \`${trap.key}\` puts its star where a separator belongs, so it ` +
            `swallows ${trap.swallowed.join(', ')}\n` +
            '    and every subpath of them, folding all of it onto one target. This does NOT crash — the target\n' +
            '    re-exports most of the surface, so the program type-checks against the WRONG MODULE and stays\n' +
            `    green. Split it into an exact key and a \`/*\` key:\n` +
            `      "${trap.swallowed[0]}": ["<relative>/src/index.ts"],\n` +
            `      "${trap.swallowed[0]}/*": ["<relative>/src/*/index.ts"]`,
        );
      }
      for (const missing of program.missingTargets) {
        failures.push(
          `${pkg.rel}/${program.file}: \`paths\` key \`${missing.key}\` maps \`${missing.spec}\` to ` +
            `\`${missing.target}\`, which does not exist.\n` +
            '    A rule whose target is missing is not a rule: tsc falls back to node resolution — i.e. to `dist`\n' +
            '    — and reports nothing. Fix the target or delete the rule; a rule that matches nothing is worse\n' +
            '    than no rule, because it reads as coverage.',
        );
      }
    }
  }

  /**
   * A dep list annotated with the program that reaches it, when that is not the
   * build config (#11490). Without it the widening produces a diagnostic an
   * author cannot act on: they open `tsconfig.json`, find no such import, and
   * conclude the gate is wrong. Plain names are kept in the copy-paste snippets
   * below — those are `paths` keys and a parenthetical would be pasted in.
   */
  const withProvenance = (pkg, deps) =>
    deps.map((dep) => {
      const via = pkg.distResolvedBy.get(dep) ?? [];
      const siblings = via.filter((file) => file !== 'tsconfig.json');
      return siblings.length > 0 && !via.includes('tsconfig.json') ? `${dep} (via ${siblings.join(', ')})` : dep;
    });

  for (const [name, deps] of measured) {
    const registered = registry[name];
    if (!registered) {
      const pkg = packages.find((p) => p.name === name);
      failures.push(
        `${pkg.rel} (${name}): its tsc program imports ${deps.length} workspace package(s) whose declarations\n` +
          `    resolve to \`dist/\` with no \`paths\` rule pointing at source:\n` +
          `    ${withProvenance(pkg, deps).join(', ')}\n` +
          '    Every type verdict in this package — including whatever `typecheck` reports — is currently a\n' +
          '    function of build state, and the dangerous case is SILENT (a dist merely BEHIND the source\n' +
          '    type-checks GREEN against old declarations). Add the rules to its tsconfig.json:\n' +
          `      "paths": { "${deps[0]}": ["<relative>/src/index.ts"], "${deps[0]}/*": ["<relative>/src/*/index.ts"] }\n` +
          '    ⚠️ Never spell that key `<pkg>*`: the star must follow a separator. See this file\'s header.',
      );
      continue;
    }
    const added = deps.filter((d) => !registered.includes(d));
    const gone = registered.filter((d) => !deps.includes(d));
    if (added.length > 0)
      failures.push(
        `${name}: NEW dist-resolved type import(s) since this entry was measured: ` +
          `${withProvenance(packages.find((p) => p.name === name), added).join(', ')}.\n` +
          "    Add the `paths` rules to the package's tsconfig.json — widening the registry entry is not the fix.\n" +
          // The REASON for that refusal, in the text the author actually reads (#8576).
          // Mirrors `KNOWN_DIST_RESOLVED_TYPE_IMPORTS`'s own words verbatim rather than
          // restating them: one rule in two voices becomes two rules by the next reading.
          '    That registry is ⛔ SHRINK-ONLY: entries are audited in both directions, so one that is no\n' +
          '    longer needed fails the gate and names itself for deletion.\n' +
          // #12572: that refusal is right for the case it was written for and WRONG as the last
          // word, because since #11490 a package can move the program set itself. The exception is
          // NAMED here and deliberately not OFFERED: the route stays a reviewed re-baseline spelled
          // out over `KNOWN_DIST_RESOLVED_TYPE_IMPORTS`, not a door this message opens for an author
          // who is merely red. Keeping the refusal above intact is also what keeps this gate the
          // `refused` precedent `check-ratchet-remedy-authority` pins it as (#8435).
          '    ⚠️ One case is not covered by that refusal: if a `(via …)` above names a program this\n' +
          '    change ONBOARDED — a `tsconfig*.json` the `typecheck` script here did not name before —\n' +
          '    then the program set itself moved, which since #11490 a package can do, and `paths` is\n' +
          '    measured to be the wrong tool for it: on PR #12570 it billed source diagnostics from\n' +
          '    other packages into this ledger. That case is a re-baseline, and it is\n' +
          '    settled by the doc-block over the registry, not by this message. Read it first.',
      );
    if (gone.length > 0)
      failures.push(
        `${name}: registry entry is STALE — no longer dist-resolved: ${gone.join(', ')}.\n` +
          `    Narrow the entry to exactly: ${JSON.stringify(deps)}`,
      );
  }

  for (const name of Object.keys(registry)) {
    if (measured.has(name)) continue;
    const known = packages.some((p) => p.name === name);
    failures.push(
      known
        ? `${name}: registry entry is no longer needed — every workspace type import resolves to source now. Delete the entry.`
        : `${name}: registry entry names a package with no tsconfig.json (or no such package). Delete the entry.`,
    );
  }

  return { failures, packages, measured, programs: totalPrograms };
}

// ── reporting ───────────────────────────────────────────────────────────────

function printList(root) {
  const { packages, totalPrograms: programs } = scan(root);
  const offenders = packages.filter((p) => p.distResolved.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  console.log('const KNOWN_DIST_RESOLVED_TYPE_IMPORTS = {');
  for (const pkg of offenders) {
    console.log(`  '${pkg.name}': [${pkg.distResolved.map((d) => `'${d}'`).join(', ')}],`);
  }
  console.log('};');
  console.error(
    `\n${offenders.length} of ${packages.length} packages (${programs} tsc program(s)) have >=1 workspace type import ` +
      `resolving through \`dist/\` (${offenders.reduce((n, p) => n + p.distResolved.length, 0)} package-dependency pairs); ` +
      `${packages.length - offenders.length} are clean.`,
  );
}

// ── self-test ───────────────────────────────────────────────────────────────
//
// Every reader this repo has written for a resolution config has been wrong at
// least once, and always in the same shape: the instrument was validated
// against the spelling its author had in mind and not against the spelling the
// repo actually uses. So each case below pins the CORRECT form as well as the
// WRONG one — a gate that only proves it catches the defect has not shown it
// leaves compliant configs alone, and a false red on 76 packages is worse than
// the exposure.

function fixture(root, rel, files) {
  const dir = join(root, rel);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return dir;
}

const ARTIFACT_MANIFEST = (name) =>
  JSON.stringify(
    { name, main: 'dist/index.js', types: 'dist/index.d.ts', exports: { '.': { types: './dist/index.d.ts' } } },
    null,
    2,
  );

function buildFixtureTree() {
  const root = join(tmpdir(), `os-type-source-resolution-selftest-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'packages'), { recursive: true });

  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, exclude: ['node_modules'] }, null, 2),
    'utf8',
  );

  // The stale-able dependency the fixtures import, with the namespace shape
  // `@objectstack/spec` really has.
  fixture(root, 'packages/spec', {
    'package.json': ARTIFACT_MANIFEST('@fx/spec'),
    'src/index.ts': 'export const alive = 1;\n',
    'src/ui/index.ts': 'export const ui = 1;\n',
    'src/integration/index.ts': 'export const integration = 1;\n',
  });

  // A sibling sharing the prefix — what `@fx/spec*` also swallows.
  fixture(root, 'packages/spec-tools', {
    'package.json': ARTIFACT_MANIFEST('@fx/spec-tools'),
    'src/index.ts': 'export const tools = 1;\n',
  });

  // (1) violating: imports the artifact, no `paths` at all.
  fixture(root, 'packages/violator', {
    'package.json': ARTIFACT_MANIFEST('@fx/violator'),
    'tsconfig.json': JSON.stringify({ include: ['src/**/*'] }, null, 2),
    'src/thing.ts': "import { alive } from '@fx/spec';\nexport const thing = alive;\n",
  });

  // (2) compliant: the two-rule shape, exact key + `/*` key.
  fixture(root, 'packages/compliant', {
    'package.json': ARTIFACT_MANIFEST('@fx/compliant'),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          paths: { '@fx/spec': ['../spec/src/index.ts'], '@fx/spec/*': ['../spec/src/*/index.ts'] },
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
    'src/thing.ts': "import { alive } from '@fx/spec';\nimport { ui } from '@fx/spec/ui';\nexport const t = alive + ui;\n",
  });

  // (3) TYPE-ONLY imports count on this axis — the inversion of the runtime
  // gate's rule. A gate that inherited the type-only filter reports this
  // package as clean while its declarations come from `dist`.
  fixture(root, 'packages/type-only', {
    'package.json': ARTIFACT_MANIFEST('@fx/type-only'),
    'tsconfig.json': JSON.stringify({ include: ['src/**/*'] }, null, 2),
    'src/thing.ts': "import type { Alive } from '@fx/spec';\nexport type T = Alive;\n",
  });

  // (4) JSONC — the CORRECT spelling, buried in the comment style this repo
  // really writes (55 of 76 tsconfigs). A reader that cannot strip comments
  // reports this compliant package as unreadable.
  fixture(root, 'packages/jsonc', {
    'package.json': ARTIFACT_MANIFEST('@fx/jsonc'),
    'tsconfig.json':
      '{\n' +
      '  "compilerOptions": {\n' +
      '    // Why `paths` at all: the dep resolves through `exports` to dist,\n' +
      '    // so `@fx/spec` and `@fx/spec/ui` would be a verdict about the last\n' +
      '    // build. Both rules are load-bearing and fail INDEPENDENTLY.\n' +
      '    "paths": {\n' +
      '      "@fx/spec": ["../spec/src/index.ts"],\n' +
      '      "@fx/spec/*": ["../spec/src/*/index.ts"]\n' +
      '    }\n' +
      '  },\n' +
      '  "include": ["src/**/*"]\n' +
      '}\n',
    'src/thing.ts': "import { alive } from '@fx/spec';\nimport { ui } from '@fx/spec/ui';\nexport const t = alive + ui;\n",
  });

  // ── (5) THE TRAP ──────────────────────────────────────────────────────────
  //
  // `@fx/spec*` — star NOT preceded by a separator. It matches the bare name,
  // every namespace, AND the sibling `@fx/spec-tools`, folding all of them onto
  // one target. It does not crash and it type-checks green, which is why it is
  // strictly worse than the Vite `ENOTDIR` trap. Every specifier here resolves
  // to a path under `src/`, so a gate that only asks "did it land on source"
  // certifies this config as correct — which is the exact defect this gate
  // exists to find.
  fixture(root, 'packages/star-trap', {
    'package.json': ARTIFACT_MANIFEST('@fx/star-trap'),
    'tsconfig.json': JSON.stringify(
      { compilerOptions: { paths: { '@fx/spec*': ['../spec/src/index.ts'] } }, include: ['src/**/*'] },
      null,
      2,
    ),
    'src/thing.ts':
      "import { alive } from '@fx/spec';\nimport { ui } from '@fx/spec/ui';\n" +
      "import { tools } from '@fx/spec-tools';\nexport const t = alive + ui + tools;\n",
  });

  // (6) `extends`, with the `paths` living in the PARENT and relative targets
  // resolved from the PARENT's directory. Correct spelling; must stay quiet.
  fixture(root, 'packages/inherits', {
    'package.json': ARTIFACT_MANIFEST('@fx/inherits'),
    'base/tsconfig.base.json': JSON.stringify(
      { compilerOptions: { paths: { '@fx/spec': ['../../spec/src/index.ts'] } } },
      null,
      2,
    ),
    'tsconfig.json': JSON.stringify({ extends: './base/tsconfig.base.json', include: ['src/**/*'] }, null, 2),
    'src/thing.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
  });

  // (7) `compilerOptions` merge SHALLOWLY: a child's `paths` REPLACES the
  // parent's whole map. The parent aliases `@fx/spec`; the child redeclares
  // `paths` for something else, so the inherited rule is GONE — and a gate that
  // deep-merged would report this package as compliant when tsc does not.
  fixture(root, 'packages/shadowed', {
    'package.json': ARTIFACT_MANIFEST('@fx/shadowed'),
    'base.json': JSON.stringify({ compilerOptions: { paths: { '@fx/spec': ['./spec-shim.ts'] } } }, null, 2),
    'spec-shim.ts': 'export const alive = 1;\n',
    'tsconfig.json': JSON.stringify(
      { extends: './base.json', compilerOptions: { paths: { '#internal/*': ['./src/*'] } }, include: ['src/**/*'] },
      null,
      2,
    ),
    'src/thing.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
  });

  // (8) tsc's algorithm, not Vite's — part one: an EXACT key wins outright even
  // when a pattern key is declared FIRST and also matches. Vite is
  // first-match-wins, so a ported resolver sends this to `dist` and reports a
  // compliant package.
  fixture(root, 'packages/exact-wins', {
    'package.json': ARTIFACT_MANIFEST('@fx/exact-wins'),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          paths: { '@fx/*': ['../spec/dist/*'], '@fx/spec': ['../spec/src/index.ts'] },
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
    'src/thing.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
  });

  // (9) …part two: among pattern keys the LONGEST MATCHING PREFIX wins, again
  // regardless of order. The short `@fx/*` is declared first and lands on
  // `dist`; tsc picks `@fx/spec/*`.
  fixture(root, 'packages/longest-prefix-wins', {
    'package.json': ARTIFACT_MANIFEST('@fx/longest-prefix-wins'),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          paths: { '@fx/*': ['../spec/dist/*'], '@fx/spec/*': ['../spec/src/*/index.ts'] },
        },
        include: ['src/**/*'],
      },
      null,
      2,
    ),
    'src/thing.ts': "import { ui } from '@fx/spec/ui';\nexport const t = ui;\n",
  });

  // (10) a `paths` rule is a spelling, not a licence: one landing on `dist/` is
  // still a dist-resolved type import.
  fixture(root, 'packages/paths-to-dist', {
    'package.json': ARTIFACT_MANIFEST('@fx/paths-to-dist'),
    'tsconfig.json': JSON.stringify(
      { compilerOptions: { paths: { '@fx/spec': ['../spec/dist/index.d.ts'] } }, include: ['src/**/*'] },
      null,
      2,
    ),
    'src/thing.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
  });

  // (11) a rule whose target does not exist is not a rule — tsc silently falls
  // back to node resolution. Reported as its own failure so the diagnostic
  // names the typo rather than the package.
  fixture(root, 'packages/missing-target', {
    'package.json': ARTIFACT_MANIFEST('@fx/missing-target'),
    'tsconfig.json': JSON.stringify(
      { compilerOptions: { paths: { '@fx/spec': ['../spec/source/index.ts'] } }, include: ['src/**/*'] },
      null,
      2,
    ),
    'src/thing.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
  });

  // (12) FALSE-POSITIVE GUARD: a package with a tsconfig and no workspace dep
  // resolving through `dist/` must not appear at all. A gate that flags
  // everything is as useless as one that flags nothing.
  fixture(root, 'packages/no-workspace-dep', {
    'package.json': ARTIFACT_MANIFEST('@fx/no-workspace-dep'),
    'tsconfig.json': JSON.stringify({ include: ['src/**/*'] }, null, 2),
    'src/thing.ts': "import { readFileSync } from 'node:fs';\nexport const t = readFileSync;\n",
  });

  // (13) …and a dep whose own types already point at SOURCE is not an artifact.
  fixture(root, 'packages/source-dep', {
    'package.json': JSON.stringify({ name: '@fx/source-dep', types: 'src/index.ts', exports: { '.': './src/index.ts' } }, null, 2),
    'src/index.ts': 'export const s = 1;\n',
  });
  fixture(root, 'packages/consumes-source', {
    'package.json': ARTIFACT_MANIFEST('@fx/consumes-source'),
    'tsconfig.json': JSON.stringify({ include: ['src/**/*'] }, null, 2),
    'src/thing.ts': "import { s } from '@fx/source-dep';\nexport const t = s;\n",
  });

  // (14) `include` is a real filter: a file OUTSIDE the program cannot decide a
  // type verdict, so its imports are not this package's exposure.
  fixture(root, 'packages/outside-program', {
    'package.json': ARTIFACT_MANIFEST('@fx/outside-program'),
    'tsconfig.json': JSON.stringify({ include: ['src/**/*'], exclude: ['src/generated'] }, null, 2),
    'src/thing.ts': "export const t = 1;\n",
    'src/generated/gen.ts': "import { alive } from '@fx/spec';\nexport const g = alive;\n",
    'scripts/tool.ts': "import { alive } from '@fx/spec';\nexport const s = alive;\n",
  });

  // (15) `baseUrl` moves where relative targets resolve FROM. Same rule, same
  // package, correct — a reader that ignores `baseUrl` calls this a missing
  // target and reports a compliant package.
  fixture(root, 'packages/base-url', {
    'package.json': ARTIFACT_MANIFEST('@fx/base-url'),
    'tsconfig.json': JSON.stringify(
      { compilerOptions: { baseUrl: '..', paths: { '@fx/spec': ['./spec/src/index.ts'] } }, include: ['src/**/*'] },
      null,
      2,
    ),
    'src/thing.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
  });

  // (16) fail-closed: a tsconfig this gate cannot parse is UNREADABLE, never a
  // package that resolves nothing.
  fixture(root, 'packages/unparseable', {
    'package.json': ARTIFACT_MANIFEST('@fx/unparseable'),
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@fx/spec": ["../spec/src/index.ts"] } } /* trailing */ ,,}\n',
    'src/thing.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
  });

  // ── #11490: the population is per PROGRAM, and "named" is the criterion ──
  //
  // (17) THE CARD'S SHAPE. The build config excludes the test layer — which
  // ci.yml requires, so no test file reaches the published artifact — and the
  // repo's prescribed repair is a SIBLING config named in `typecheck`. The
  // exposure lives ONLY in that sibling's program. Before the widening this
  // package was silent.
  const testLayerFiles = {
    'src/thing.ts': 'export const thing = 1;\n',
    'src/thing.test.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
  };
  fixture(root, 'packages/sibling-config', {
    'package.json': JSON.stringify(
      {
        name: '@fx/sibling-config',
        types: 'dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts' } },
        scripts: { typecheck: 'tsc --noEmit && tsc --noEmit -p tsconfig.test.json' },
      },
      null,
      2,
    ),
    'tsconfig.json': JSON.stringify({ include: ['src/**/*'], exclude: ['**/*.test.ts'] }, null, 2),
    'tsconfig.test.json': JSON.stringify({ extends: './tsconfig.json', include: ['src/**/*'], exclude: [] }, null, 2),
    ...testLayerFiles,
  });

  // (18) THE TWIN, and the two-sided acceptance test. The SAME files with the
  // SAME import, reached through the BUILD config because this one keeps no
  // exclusion. The card's whole finding was that (17) and (18) are the same
  // exposure reported in one spelling and silent in the other, so the assertion
  // is not "both are reported" but that they are reported IDENTICALLY.
  fixture(root, 'packages/build-config-twin', {
    'package.json': JSON.stringify(
      {
        name: '@fx/build-config-twin',
        types: 'dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts' } },
        scripts: { typecheck: 'tsc --noEmit' },
      },
      null,
      2,
    ),
    'tsconfig.json': JSON.stringify({ include: ['src/**/*'] }, null, 2),
    ...testLayerFiles,
  });

  // (19) THE FALSE-POSITIVE GUARD ON THE WIDENING ITSELF. Byte-identical to
  // (17) except that NO script names the sibling. A config nothing runs decides
  // no type verdict, so its imports are not this package's exposure — and a
  // widening spelled as `tsconfig*.json` on disk would report this package,
  // producing a gate that looks stronger while measuring a program nobody runs.
  // That is worse than the state it replaced, because it READS as covered.
  fixture(root, 'packages/decorative-config', {
    'package.json': JSON.stringify(
      {
        name: '@fx/decorative-config',
        types: 'dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts' } },
        scripts: { typecheck: 'tsc --noEmit', 'some:other': 'tsc -p tsconfig.test.json' },
      },
      null,
      2,
    ),
    'tsconfig.json': JSON.stringify({ include: ['src/**/*'], exclude: ['**/*.test.ts'] }, null, 2),
    'tsconfig.test.json': JSON.stringify({ extends: './tsconfig.json', include: ['src/**/*'], exclude: [] }, null, 2),
    ...testLayerFiles,
  });

  return root;
}

function selfTest() {
  const root = buildFixtureTree();
  const problems = [];
  const expect = (condition, message) => {
    if (!condition) problems.push(message);
  };
  const has = (failures, needle) => failures.some((f) => f.includes(needle));
  const reported = (result, rel) => result.failures.some((f) => f.includes(rel));

  try {
    const bare = check(root, {});

    // ── the defect is caught ──────────────────────────────────────────────
    expect(reported(bare, 'packages/violator'), 'a package with no `paths` at all was not reported');
    expect(
      reported(bare, 'packages/type-only'),
      'a TYPE-ONLY import of a dist-resolving dep was not counted — the runtime gate\'s filter must NOT be inherited',
    );
    expect(reported(bare, 'packages/shadowed'), "a child `paths` block that REPLACES the parent's was deep-merged");
    expect(reported(bare, 'packages/paths-to-dist'), 'a `paths` rule landing on `dist/` was read as aliased to source');

    // ── THE TRAP: `@fx/spec*`, star not after a separator ─────────────────
    // Every specifier in this fixture lands under `src/`, so "did it reach
    // source" says yes. The gate must still refuse the spelling.
    expect(reported(bare, 'packages/star-trap'), 'the `@pkg*` trap (star not preceded by a separator) was NOT flagged');
    expect(
      has(bare.failures, '@fx/spec-tools'),
      'the `@pkg*` trap diagnostic did not name the sibling package the key also swallows',
    );

    // ── a rule that matches nothing is not coverage ───────────────────────
    expect(reported(bare, 'packages/missing-target'), 'a `paths` target that does not exist was accepted as a rule');
    expect(has(bare.failures, 'does not exist'), 'the missing-target diagnostic did not say the target is missing');

    // ── the CORRECT spellings must stay quiet ─────────────────────────────
    expect(!reported(bare, 'packages/compliant'), 'the two-rule compliant config was reported');
    expect(!reported(bare, 'packages/jsonc'), 'a CORRECT config was reported because its comments were not stripped');
    expect(!reported(bare, 'packages/inherits'), 'a correct `paths` block inherited through `extends` was not seen');
    expect(!reported(bare, 'packages/base-url'), '`baseUrl` was ignored, so a correct config read as a missing target');
    expect(
      !reported(bare, 'packages/exact-wins'),
      "an EXACT key declared after a matching pattern key did not win — that is Vite's algorithm, not tsc's",
    );
    expect(
      !reported(bare, 'packages/longest-prefix-wins'),
      'the LONGEST matching prefix did not win among pattern keys — first-match-wins is Vite, not tsc',
    );

    // ── false positives ───────────────────────────────────────────────────
    expect(!reported(bare, 'packages/no-workspace-dep'), 'a package with no workspace dep at all was flagged');
    expect(!reported(bare, 'packages/consumes-source'), 'a dep whose types already point at source was flagged');
    expect(
      !reported(bare, 'packages/outside-program'),
      '`include`/`exclude` were ignored, so a file outside the program decided the verdict',
    );

    // ── fail-closed ───────────────────────────────────────────────────────
    expect(reported(bare, 'packages/unparseable'), 'an unparseable tsconfig was read as resolving nothing');
    expect(has(bare.failures, 'cannot be read'), 'an unparseable tsconfig did not fail as unreadable');

    // ── #11490: the population is per PROGRAM ─────────────────────────────
    //
    // The card's own measurement, in fixture form and TWO-SIDED. "The gate
    // still passes" was explicitly not the test: the same files with the same
    // import were REPORTED through the build config and SILENT through the
    // prescribed sibling, so what has to hold is that the two spellings now
    // report the SAME THING.
    expect(
      reported(bare, 'packages/sibling-config'),
      'an exposure reachable only through the sibling `tsconfig.test.json` this repo PRESCRIBES was not '
        + 'reported — the gate is per-package again where it must be per-program',
    );
    expect(reported(bare, 'packages/build-config-twin'), 'the build-config spelling of the identical files was not reported');
    expect(
      JSON.stringify(bare.measured.get('@fx/sibling-config')) ===
        JSON.stringify(bare.measured.get('@fx/build-config-twin')),
      'the sibling-config spelling and the build-config spelling of the SAME files with the SAME import did '
        + `not report identically: ${JSON.stringify(bare.measured.get('@fx/sibling-config'))} vs `
        + `${JSON.stringify(bare.measured.get('@fx/build-config-twin'))}`,
    );
    expect(
      JSON.stringify(bare.measured.get('@fx/sibling-config')) === JSON.stringify(['@fx/spec']),
      'the sibling-config exposure was not measured as exactly the dep the test file imports',
    );
    // The widening's own false positive: a config on disk that no script runs.
    expect(
      !reported(bare, 'packages/decorative-config'),
      'a `tsconfig*.json` NO script names was put in the population — a gate that looks stronger while '
        + 'measuring a program nobody runs reads as covered and is worse than the state it replaced',
    );
    // The diagnostic must say WHICH program, or the author opens the build
    // config, finds no such import, and concludes the gate is wrong.
    expect(
      has(bare.failures, '(via tsconfig.test.json)'),
      'the diagnostic did not name the program the exposure was reached through',
    );

    // ── the registry, audited in BOTH directions ──────────────────────────
    const measuredNames = {
      '@fx/violator': ['@fx/spec'],
      '@fx/type-only': ['@fx/spec'],
      '@fx/shadowed': ['@fx/spec'],
      '@fx/paths-to-dist': ['@fx/spec'],
      '@fx/star-trap': ['@fx/spec'],
      '@fx/missing-target': ['@fx/spec'],
      // #11490 — both spellings of the same exposure, registered identically.
      '@fx/sibling-config': ['@fx/spec'],
      '@fx/build-config-twin': ['@fx/spec'],
    };
    const registered = check(root, measuredNames);
    expect(
      !has(registered.failures, 'resolve to `dist/` with no'),
      'correctly registered packages still failed the unregistered check',
    );
    // Registration silences the REGISTRY complaint and nothing else: the trap
    // and the dead rule are config defects, not measured state to grandfather.
    expect(reported(registered, 'packages/star-trap'), 'registering a package suppressed the `@pkg*` trap failure');
    expect(reported(registered, 'packages/missing-target'), 'registering a package suppressed the dead-rule failure');

    const stale = check(root, { ...measuredNames, '@fx/compliant': ['@fx/spec'] });
    expect(has(stale.failures, 'no longer needed'), 'a registry entry for an already-fixed package did not fail');

    const ghost = check(root, { ...measuredNames, '@fx/ghost': ['@fx/spec'] });
    expect(has(ghost.failures, '@fx/ghost'), 'a registry entry for a non-existent package did not fail');

    fixture(root, 'packages/other', {
      'package.json': ARTIFACT_MANIFEST('@fx/other'),
      'src/index.ts': 'export const other = 1;\n',
    });
    fixture(root, 'packages/violator', {
      'src/second.ts': "import { other } from '@fx/other';\nexport const s = other;\n",
    });
    const grown = check(root, measuredNames);
    expect(has(grown.failures, 'NEW dist-resolved type import'), 'a new dist-resolved import under an entry did not fail');
    // #8576. The refusal above turns the registry remedy down; this pins that it
    // also says WHY, in the text the author reads. Asserted on the planted
    // violation, never on a green run — the string only ever prints on failure.
    expect(
      has(grown.failures, '⛔ SHRINK-ONLY'),
      'the refusal no longer states WHY it refuses — the registry\'s shrink-only nature is back to being '
        + 'comment-only, which tells the maintainer reading the script and not the author tripping the gate',
    );

    // #12572. The same failure carries TWO more load-bearing sentences, and they
    // pull against each other on purpose — which is exactly why both need pinning
    // from this side rather than being left to a reader's judgement.
    //
    //   THE REFUSAL is a cross-gate contract. `check-ratchet-remedy-authority`
    //   hand-classifies this file as `refused` (#8435), and it earns that verdict
    //   from this literal: its PREDICATION shape ("widening … is not the fix") is
    //   what tells a refusal apart from mere discouragement. Soften this sentence
    //   and this gate silently becomes an UNMARKED offer of a ratchet-expanding
    //   remedy — a violation reported over THERE, naming a file whose author was
    //   editing prose here and had no reason to look.
    //
    //   THE EXCEPTION is what keeps the refusal honest. Since #11490 a package CAN
    //   move the program set, so an unqualified refusal forbids the only correct
    //   action for an onboarding — the state #11491 measured 14 remaining
    //   `TEST_DEBT` entries as walking into.
    //
    // Neither may be dropped to make room for the other.
    expect(
      has(grown.failures, 'widening the registry entry is not the fix'),
      'the refusal PREDICATION is gone — `check-ratchet-remedy-authority` classifies this file as '
        + '`refused` from that exact shape, so losing it turns this gate into an unmarked ratchet offer '
        + 'and reds a DIFFERENT gate, naming this file',
    );
    expect(
      has(grown.failures, 'ONBOARDED'),
      'the failure text no longer names the one case the refusal does not cover — a package that moved '
        + 'the program set itself, which #11490 made possible and 14 queued onboardings each arrive at',
    );

    const wide = check(root, { ...measuredNames, '@fx/violator': ['@fx/spec', '@fx/other', '@fx/gone'] });
    expect(has(wide.failures, 'STALE'), 'a registry entry listing a dep that is no longer dist-resolved did not fail');

    // ── census guard: sibling-config discovery going quiet is INVISIBLE ────
    //
    // The zero this leg exists for needs its own positive control: a tree in
    // which no package runs a second program must trip it, or the guard is a
    // line nobody has ever seen fire. Same shape as (17) minus the `typecheck`
    // script that names the sibling — which is also exactly what the whole
    // widening looks like after a regression.
    const singleProgram = join(tmpdir(), `os-type-source-resolution-single-${process.pid}`);
    rmSync(singleProgram, { recursive: true, force: true });
    mkdirSync(join(singleProgram, 'packages'), { recursive: true });
    fixture(singleProgram, 'packages/spec', {
      'package.json': ARTIFACT_MANIFEST('@fx/spec'),
      'src/index.ts': 'export const alive = 1;\n',
    });
    fixture(singleProgram, 'packages/lonely', {
      'package.json': ARTIFACT_MANIFEST('@fx/lonely'),
      'tsconfig.json': JSON.stringify({ include: ['src/**/*'] }, null, 2),
      'src/thing.ts': "import { alive } from '@fx/spec';\nexport const t = alive;\n",
    });
    const single = check(singleProgram, { '@fx/lonely': ['@fx/spec'] });
    expect(
      has(single.failures, 'sibling-config discovery is broken'),
      'a tree where no package runs a second tsc program did not trip the census guard — the #11490 widening '
        + 'can go quiet and the summary still reads like a clean repo',
    );
    rmSync(singleProgram, { recursive: true, force: true });
    // ...and it must NOT fire on the real fixture tree, where (17) runs two.
    expect(
      !has(bare.failures, 'sibling-config discovery is broken'),
      'the multi-program census guard fired on a tree that does have a second program',
    );

    // The shared `typecheck`-script predicate is a plain module with no CI
    // invocation of its own; the gates that consolidated onto it fold in its
    // cases (#11490).
    for (const failure of typecheckConfigsSelfTest()) expect(false, failure);

    // ── census guard: an empty tree is a broken scanner, never a clean repo ─
    const empty = join(tmpdir(), `os-type-source-resolution-empty-${process.pid}`);
    rmSync(empty, { recursive: true, force: true });
    mkdirSync(empty, { recursive: true });
    const emptyResult = check(empty, {});
    expect(has(emptyResult.failures, 'the scan is broken'), 'an empty tree did not trip the census guard');
    rmSync(empty, { recursive: true, force: true });

    // ── the declared population must stay READABLE by the dispatch deriver ─
    //
    // scripts/pm/dispatch-gates.mjs decides which cards are told to run this
    // gate by scanning this file's module body for the path literals it
    // operates on, and its covering rule refuses a literal carrying no path
    // separator (after the leading ./ or ../ an extractor strips) as too
    // generic. WORKSPACE_PARENT_GLOBS is this gate's WHOLE declared
    // population, so an entry that loses its separator takes every package
    // under that parent out of the derived gate list SILENTLY: the gate keeps
    // working, CI keeps failing on it, and no dispatch brief sends anyone
    // here. That is what the bare spelling cost, measured in that constant's
    // docblock (#9955). Asserted here rather than left to review because the
    // regression is a tidy-up nobody would flag.
    for (const glob of WORKSPACE_PARENT_GLOBS) {
      expect(
        glob.replace(/^(?:\.\.?(?:\/|$))+/, '').includes('/'),
        `workspace parent ${glob} carries no path separator, so scripts/pm/dispatch-gates.mjs refuses it as too generic and every package under it drops out of the derived gate list`,
      );
    }

    // ── the import clause is bounded to ONE statement (#12555) ────────────
    //
    // The same three rows the sibling gate pins, because this file carried the
    // byte-identical first alternative. The consequence here is narrower —
    // `extractTypeImports` reads only the specifier captures, so an over-greedy
    // clause could not corrupt a verdict, only make one vanish — but vanishing is
    // a false GREEN on an axis whose whole job is fail-closed, so it is pinned
    // just as hard. A detector that silently stops matching reports a spotless
    // repo.
    const typeSpecs = (code) => [...new Set(extractTypeImports(code))].sort();
    const tA = typeSpecs("import 'pkg/kernel';\nconst x = 1;\n");
    const tB = typeSpecs("import 'pkg/kernel';\nimport { X } from 'other';\n");
    const tC = typeSpecs("import { X } from 'other';\nimport 'pkg/kernel';\n");
    expect(tA.join() === 'pkg/kernel', 'row A: a lone side-effect import was not seen at all');
    expect(
      tB.join() === 'other,pkg/kernel',
      'row B: the side-effect import was swallowed by the NEXT statement\'s clause — the #12555 defect itself',
    );
    expect(
      tB.join() === tC.join(),
      'rows B/C disagree: the same two statements read differently when reordered, so the verdict is a function of import ORDER',
    );
    expect(
      typeSpecs("import 'pkg/kernel'\nimport { X } from 'other'\n").join() === 'other,pkg/kernel',
      'a semicolon-less (ASI) pair still spans two statements — a `;`-only clause class would pass row B and fail here',
    );
    // This gate's INVERSION of the runtime gate's rule must survive the bound: a
    // type-only import always resolves at type time and is counted here on
    // purpose (header note 4). The narrowed clause must not have dropped it.
    expect(
      typeSpecs("import type { A } from '@fx/types';\n").join() === '@fx/types',
      'a type-only import stopped being counted — the statement bound went blind on the majority of this axis',
    );
    expect(
      typeSpecs('import {\n  a,\n  b,\n} from \'@fx/multi\';\n').join() === '@fx/multi',
      'a multi-line import clause stopped matching — the statement bound broke line-spanning clauses',
    );
    // The dynamic-import alternative is NOT the one that changed, and its extra
    // `:` / `<` delimiters are why this regex is not byte-identical to the
    // sibling's. Pinned so a later "sync the two gates" edit cannot quietly drop
    // them.
    expect(
      typeSpecs('let v: import(\'@fx/anno\').T;\n').join() === '@fx/anno',
      '`import(…)` in a type ANNOTATION stopped being seen — the `:` delimiter was lost from the dynamic alternative',
    );
    expect(
      typeSpecs('type G = Box<import(\'@fx/generic\').T>;\n').join() === '@fx/generic',
      '`import(…)` inside a GENERIC argument stopped being seen — the `<` delimiter was lost from the dynamic alternative',
    );

    // ── the declaration must still BE the workspace (#11510) ──────────────
    //
    // WORKSPACE_PARENT_GLOBS is a hand-written copy of the `packages:` block,
    // and the case above only checks each entry's SHAPE. Nothing checked that
    // the entries were still the right ones. Two gates carried byte-identical
    // 11-entry copies of this array with the same blind spot in both, which is
    // exactly what a hand-maintained mirror does: a workspace root added to
    // pnpm-workspace.yaml leaves both walking the old set, both green, and no
    // dispatch brief naming either gate for the new root.
    //
    // The array is NOT replaced by the live parse. It is this gate's declared
    // population, the only thing that tells scripts/pm/dispatch-gates.mjs which
    // cards belong here, and a runtime parse spells no literal at all — the
    // #11190 measurement that made consolidation safe in the first place. So
    // the declaration stays and the live parse becomes its CHECK, in both
    // directions, the shape check-published-files.mjs already uses.
    const declaredParents = WORKSPACE_PARENT_GLOBS.map((g) => g.replace(/\/\*+$/, ''));
    const liveParents = readWorkspaceGlobs(REPO_ROOT)
      .filter((g) => !isExclusionGlob(g))
      .map((g) => g.replace(/\/\*+$/, ''));
    for (const parent of liveParents) {
      expect(
        declaredParents.includes(parent),
        `pnpm-workspace.yaml declares the workspace root ${parent}, which WORKSPACE_PARENT_GLOBS does not — this gate walks it but no card is dispatched here for it`,
      );
    }
    for (const parent of declaredParents) {
      expect(
        liveParents.includes(parent),
        `WORKSPACE_PARENT_GLOBS declares ${parent}, which pnpm-workspace.yaml does not — a declaration that can drift from the workspace is worse than none, it replaces a silent gate with a lying one`,
      );
    }

    // The shared enumerator is a plain module with no CI invocation of its own
    // (#11510 — being a gate is exactly what it must not be); every script that
    // consolidated onto it folds in its checks.
    for (const failure of workspaceEnumeratorSelfTest({ root: REPO_ROOT })) expect(false, failure);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    console.error('check-type-source-resolution --self-test FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-type-source-resolution --self-test OK');
}

// ── entry point ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) {
  selfTest();
} else if (argv.includes('--list')) {
  printList(REPO_ROOT);
} else {
  const { failures, packages, measured, programs } = check(REPO_ROOT, KNOWN_DIST_RESOLVED_TYPE_IMPORTS);
  if (failures.length > 0) {
    console.error('check-type-source-resolution FAILED\n');
    for (const failure of failures) console.error(`  ✗ ${failure}\n`);
    console.error(
      "A package's types must be a verdict about the source in the checkout. See this file's header for\n" +
        'why the dangerous case is a typecheck that PASSES.',
    );
    process.exit(1);
  }
  console.log(
    `check-type-source-resolution OK — ${programs} tsc program(s) across ${packages.length} packages scanned ` +
      `(every \`tsconfig*.json\` each package's \`typecheck\` script names, #11490); ` +
      `${measured.size} registered as still resolving a workspace dep's types through \`dist/\`.`,
  );
}
