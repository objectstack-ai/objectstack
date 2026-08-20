#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-cross-package-test-inputs -- keeps CI's idea of a test's inputs equal
// to the test's REAL inputs, for the tests that read outside their own package.
//
// ── The defect this exists to make impossible (#7802) ────────────────────────
//
// `packages/spec/src/data/api-methods-batch-conformance.test.ts` resolves the
// repo root and walks every `*.object.ts` in the monorepo. Its home package is
// `spec`; its input set is the whole repo. #7769 changed ONE object under
// `packages/platform-objects`, the scan's verdict flipped to red -- and the
// change reached `main` anyway, because BOTH of CI's scoping layers judge the
// scan by where it LIVES:
//
//   Layer A -- `turbo ls --affected` in ci.yml's `test` job (the PR path).
//     Affected packages come from the dependency GRAPH. `packages/spec` declares
//     no dependency on `packages/platform-objects` (and should not -- the scan
//     reads source text precisely to avoid inverting the spec -> * direction),
//     so a platform-objects-only diff can never reach spec. Measured on
//     turbo 2.10.7: 51 packages affected, `@objectstack/spec` not among them.
//
//   Layer B -- turbo's task cache. `test` declares `inputs: ["$TURBO_DEFAULT$",
//     ...]`, which is PACKAGE-LOCAL. `@objectstack/spec#test` therefore hashes
//     the same before and after any change outside `packages/spec`, so even the
//     merge-queue and push builds -- which deliberately partition the FULL
//     package list, not the affected subset -- replay a cached green.
//     Measured: `turbo run test --filter=@objectstack/spec` after the
//     platform-objects edit printed `>>> FULL TURBO`, 42ms, replaying the
//     previous run's log, while `--force` on the same tree failed the scan.
//
// Layer B is why the merge queue did not catch it. The `filter` job's
// `dorny/paths-filter` gate -- which DOES open up on `merge_group` -- was never
// the leak: `core` matches `packages/**`, so it was `true` throughout.
//
// ── The mechanism ───────────────────────────────────────────────────────────
//
// A package whose tests read outside itself declares that radius ONCE, in
// CROSS_PACKAGE_TEST_INPUTS below, and both layers are driven from it:
//
//   Layer A: `--union-into <turbo-ls.json>` adds the declaring package to the
//            shard's package set when the diff touches its declared globs.
//   Layer B: `--verify` requires turbo.json to carry a matching
//            `<pkg>#test` task whose `inputs` include the same globs as
//            `$TURBO_ROOT$/...` entries, so the cache hash moves with them.
//
// ── Why this is not just another hand-maintained list ───────────────────────
//
// It IS a list, and a list you must remember to update is exactly the failure
// mode that produced #7802. So the list does not depend on anyone remembering:
// `--verify` finds the escaping tests ITSELF, statically, and fails naming any
// package that has one and no declaration. Add a new cross-package scan and the
// gate goes red with the package name and what to write; the default for an
// undeclared scan is a RED GATE, never a silent skip. The reverse rots too, so
// it is checked in the same pass: a declaration whose package no longer has an
// escaping test fails as stale.
//
// What the list buys over "just always run those packages" is the radius. A
// declared glob of `packages/**/*.object.ts` keeps spec's 5-minute suite off
// every PR that does not touch an object; `always-run` would put it on all of
// them, which is the affected-subset optimisation the 3-way shard exists for
// (ci.yml `test`) traded away to fix eight packages.
//
// ── What holds a radius, and the day it turned out to be prose (#9763) ──────
//
// A narrow glob is only safe while the gate can check it against the paths the
// tests really read, so `verify()` builds a ROSTER per package and fails naming
// any path outside the declared globs. That roster used to come from one flat
// regex over the source, which sees a path only when the WHOLE repo-relative
// path sits inside ONE quoted string and starts at a known top-level directory.
//
// Three live spellings do not, and the shortfall read as "covered" rather than
// as "unrecognised" -- silently, exit 0. Measured on 06f9848f9: for
// `create-objectstack`, dropping the declared glob AND unquoting two header
// COMMENTS made this gate pass, while the two tests that genuinely load
// `scripts/sync-template-versions.mjs` went right on loading it. Prose was
// holding the radius; an innocent reword would have unforced it.
//
// So the roster now has two halves, and the fix is a reconstruction rather than
// a wider regex:
//
//   FLAT      -- `repoRelativeLiterals()`, unchanged in kind, sees quoted whole
//                paths. Its one data defect was a missing top-level directory:
//                `skills/` was absent from the alternation, so formula's read of
//                its own published skill was invisible twice over.
//   RESOLVED  -- `scanPathExpressions()` walks the SAME recognised expressions
//                the escape detector already walks, and keeps the segment NAMES
//                alongside the depth (`walkLiteral`). A path split across
//                `join('scripts', 'x.mjs')` arguments and an ascent-relative
//                `new URL('../../../scripts/x.mjs', import.meta.url)` both come
//                out as the repo-relative string an author would have quoted.
//
// This needed no parser: the resolver was already there, computing depths for
// the escape verdict, and a name is that same walk in another coordinate. The
// gate stays dependency-free, which is what keeps it un-mutable in CI.
//
// What it still does not see, stated rather than discovered later: a path built
// by template literal (`${repoRoot}/scripts/x.mjs`), one whose segments come
// from a variable or an array the scan cannot fold, and a directory read whose
// path is only a loop variable. Each yields NO name -- never a wrong one; an
// unreadable argument costs the name and keeps the depth, so the escape verdict
// is unaffected and the roster never gains an entry pointing at a file nobody
// reads. Reads that reach another package through Node's RESOLVER rather than
// through `fs` are outside this gate entirely.
//
// Usage:
//   node scripts/check-cross-package-test-inputs.mjs --verify
//   node scripts/check-cross-package-test-inputs.mjs --union-into <turbo-ls.json> --changed <file>
//   node scripts/check-cross-package-test-inputs.mjs --list-escapes
//   node scripts/check-cross-package-test-inputs.mjs --self-test

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, dirname, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * Packages whose test suites read files outside their own directory, with the
 * repo-relative globs they really read. Keep a glob as NARROW as the evidence
 * allows and no narrower: too wide only costs cache invalidation, too narrow
 * silently restores the #7802 blind spot for that package.
 *
 * Every entry names the test that justifies it, so the next person can check
 * the radius against the code rather than trusting the glob.
 */
const CROSS_PACKAGE_TEST_INPUTS = {
  '@objectstack/spec': {
    globs: [
      // api-methods-batch-conformance.test.ts + system/constants/platform-object-names.test.ts
      'packages/**/*.object.ts',
      // src/identity/position-delegatable-enforcer.pin.test.ts reads the lint rule sources
      'packages/lint/src/**',
      // scripts/root-index.test.ts reads the index; scripts/category-title.test.ts and
      // scripts/file-description.test.ts walk the whole references tree by category.
      'content/docs/references/**',
      // scripts/dist-freshness.test.ts stages a fixture around the root scripts dir
      'scripts/**',
      // `serve.ts` is named in a comment rather than read, the same shape as
      // `check-nul-bytes.mjs` / the realtime protocol page below, and settled
      // the same way: the literal collector takes quoted paths without parsing,
      // so a mention forces a declaration, and declaring the file is cheaper
      // than rewording prose to dodge the scanner.
      // scripts/publish-smoke-port-collision.test.ts cites it for the
      // measurement that justifies its whole existence — `serve.ts` auto-shifts
      // off a busy port whenever `flags.dev` is set, which is the only reason
      // publish-smoke.sh cannot trust the port it asked for. One file, not the
      // commands tree: the test reads publish-smoke.sh and nothing else.
      'packages/cli/src/commands/serve.ts',
      // scripts/liveness/evidence.test.ts resolves the evidence paths the
      // liveness ledgers cite, so those files' existence is a spec input.
      'packages/runtime/src/**',
      'packages/objectql/src/validation/**',
      'packages/metadata-protocol/src/**',
      'packages/plugins/plugin-audit/src/**',
      // Both of these were read all along and declared by nobody -- they are
      // what #9763's reconstruction found the first time it ran, not radii this
      // package grew. Each is spelled ascent-relative, which is exactly the
      // spelling the flat literal regex below cannot start a match on:
      //   src/api/error-catalog-docs.test.ts reads the error-catalog page as
      //     `resolve(__dirname, '../../../../content/docs/api/error-catalog.mdx')`
      //     and asserts it documents every `StandardErrorCode`. Per-page rather
      //     than `content/docs/**` for the reason the @objectstack/cli entry
      //     gives: docs are edited far more often than any package here.
      //   scripts/strictness-ledger.test.ts reads the audit ledger as
      //     `resolve(SPEC, '../../docs/audits/...')` and ratchets it against the
      //     schema files it inventories, so the ledger IS an input to the ratchet.
      'content/docs/api/error-catalog.mdx',
      'docs/audits/2026-07-unknown-key-strictness-ledger.md',
    ],
  },
  '@objectstack/core': {
    // src/security/operation-private-keys.pin.test.ts walks `git ls-files` over
    // the whole repo and reads every matching source file.
    globs: ['packages/**/*.ts'],
  },
  '@objectstack/cli': {
    // src/commands/serve-verify-security-parity.contract.test.ts diffs
    // cli's serve.ts against verify's harness.ts.
    // It also pins plugin-security's permission-set test as a third witness.
    //
    // src/commands/serve-multi-node-cap-advisory.pin.test.ts reads the
    // multi-node gate's own `ResolvedMultiNodeVerdict` declaration: serve.ts
    // mirrors that shape by hand (the CLI has no static dependency on the
    // cluster package), and the pin exists to fail when the two drift. It only
    // does that if a producer-only change re-runs cli's tests, which is exactly
    // what this declaration buys.
    //
    // The `examples/` globs are the showcase modules two i18n tests import LIVE
    // across the workspace boundary, each named per file because the two read
    // DIFFERENT namespaces and are not interchangeable:
    //   test/i18n-section-coverage.test.ts dynamically imports `contact.view`
    //     and `semantic-zoo.object` and asserts `toEqual` over an exhaustive
    //     hardcoded `_sections` key list, so any newly NAMED section in either
    //     module goes red -- this is what PR #8742 broke in queue build
    //     31825946401, where the merge queue was the first signal.
    //   test/i18n-tab-coverage.test.ts dynamically imports `task-triage.page`
    //     and asserts the same way over `_tabs`, so it moves with that page's
    //     filter-only presets and is untouched by `_sections` edits.
    // Per-file rather than `examples/app-showcase/**`: the modules above have no
    // relative imports of their own, so the read set IS the file set, and the
    // wider glob would put cli's suite on every showcase edit. Adding a live
    // import outside these paths fails `check:examples-live-imports`, which
    // matches each coupling target against these globs -- so narrowing here
    // cannot quietly reopen the blind spot.
    //
    // The `content/docs` globs are hand-written prose three e2e tests pin, to
    // enforce the #6730 ruling that the NDJSON exception "stays declared, not just
    // implemented" -- the declaration has to be findable in the page a script
    // author actually meets, so the page IS an input. All three were invisible to
    // this gate until #8995 taught the detector their seed spelling, and the miss
    // is not theoretical: PR #8983 reworded `deployment/index.mdx` to "one compact
    // JSON document per line", which every fact survived but the literal
    // `/one\s+per\s+line/i` pin did not. Undeclared, cli was outside the affected
    // set, so PR CI was green and the merge queue was the first signal -- it
    // dequeued the PR and took two unrelated PRs down as batch collateral.
    //   test/cloud-login-json-ndjson.e2e.test.ts reads deployment/cli.mdx and
    //     deployment/index.mdx.
    //   test/login-json-ndjson.e2e.test.ts reads deployment/cli.mdx and
    //     permissions/authentication.mdx (the page describing the device flow).
    //   test/login-json-noninteractive.e2e.test.ts reads deployment/cli.mdx.
    // Per-page rather than `content/docs/**`: docs are edited far more often than
    // any package here, and a subtree glob would put cli's e2e suite on every
    // documentation PR.
    //
    // `connector-mcp-plugin.ts` is read by test/serve-capability-identity.test.ts,
    // which pins that the connector still registers the name the #7652 repro uses
    // rather than importing the class. It surfaced with the three above and has the
    // same shape of blind spot. The gate could not name it until #9763: the test
    // spells the path ASCENT-RELATIVE (`resolve(HERE, '../../connectors/...')`),
    // which the flat literal regex cannot start a match on. The collector now
    // reconstructs it, so this glob is held by the read rather than by this
    // comment — it was the one entry that already documented the hole, as a fact
    // about itself rather than as the general gap it turned out to be.
    //
    // `check-nul-bytes.mjs` is the one entry no test READS -- it is named in a
    // comment in login-json-noninteractive.e2e.test.ts. The literal collector takes
    // quoted paths without parsing, so a mention forces a declaration; that is the
    // designed trade (over-collection can only widen a radius, never narrow one),
    // and declaring one rarely-touched file is cheaper than teaching the scanner to
    // tell prose from code, or than rewording a comment to dodge a scanner.
    globs: [
      'packages/verify/src/**',
      'packages/plugins/plugin-security/src/**',
      'packages/services/service-cluster/src/**',
      'packages/connectors/connector-mcp/src/connector-mcp-plugin.ts',
      'examples/app-showcase/src/ui/views/contact.view.ts',
      'examples/app-showcase/src/data/objects/semantic-zoo.object.ts',
      'examples/app-showcase/src/ui/pages/task-triage.page.ts',
      'content/docs/deployment/cli.mdx',
      'content/docs/deployment/index.mdx',
      'content/docs/permissions/authentication.mdx',
      'scripts/check-nul-bytes.mjs',
    ],
  },
  '@objectstack/lint': {
    // authoring-rule-wiring / validate-rule-compilability /
    // lint-startup-registry-verdict.corpus read each authoring rule's source
    // by repo-relative path, plus the CLI commands dir and the runtime gate.
    //
    // The `examples/` globs are the showcase modules two validator tests import
    // LIVE across the workspace boundary. Both assert the SHIPPED app is clean
    // rather than pinning a fixed shape -- #8515 lifted the pinned-shape cases
    // onto the frozen `showcase-shape.fixtures.ts` snapshot, so what survives
    // live are the cases that must keep resolving against the real app:
    //   src/validate-translatable-sections.test.ts imports `Contact`,
    //     `ContactViews` and `ShowcaseTranslationBundle`; a section introduced
    //     WITHOUT a name moves it, a correctly named one does not.
    //   src/validate-translation-references.test.ts imports `Contact` and
    //     `ContactViews` and asserts every translation key still resolves, so
    //     renaming or removing a Contact field, view, section or action moves
    //     it while adding one generally does not.
    // Per-file for the same reason as `@objectstack/cli` above: these modules
    // have no relative imports of their own, and a live import added outside
    // them fails `check:examples-live-imports` by name.
    globs: [
      'packages/cli/src/commands/**',
      'packages/metadata-protocol/src/**',
      'packages/objectql/src/validation/**',
      'packages/services/service-automation/src/**',
      'examples/app-showcase/src/data/objects/contact.object.ts',
      'examples/app-showcase/src/system/translations/index.ts',
      'examples/app-showcase/src/ui/views/contact.view.ts',
    ],
  },
  '@objectstack/platform-objects': {
    // src/managed-api-method-affordance-sweep.test.ts (#7934) imports every
    // `*.object.ts` in the monorepo and runs `validateManagedApiMethods` over
    // it — the population `os lint` never walks, because these objects ship as
    // code rather than in an authored stack.
    globs: ['packages/**/*.object.ts'],
  },
  '@objectstack/plugin-auth': {
    // src/managed-extension-fields.test.ts walks every `*.object.ts`, and pins
    // core's api-key source alongside it.
    globs: [
      'packages/**/*.object.ts',
      'packages/core/src/security/**',
      // src/rate-limit-storage-isolation.test.ts (#6040) walks BOTH consumer
      // packages of the `./rate-limit-storage` subpath by directory, checking
      // that neither reaches the counter through the package ROOT — which would
      // silently reinstate the whole better-auth load for them. The diff that
      // breaks that invariant is a diff in one of these two directories, so
      // without them declared the affected-subset filter never adds plugin-auth
      // and turbo replays a cached green over the scan (#10029, the #7802
      // shape). Measured: before this entry, `@objectstack/plugin-auth#test`
      // hashed to `1bf3935543ab055b` both before and after a change under
      // `packages/runtime/src`, and the re-run was `>>> FULL TURBO` in 135ms
      // while the invariant was live-broken in the tree.
      'packages/runtime/src/**',
      'packages/services/service-sms/src/**',
      // The three below are NAMED in that test's prose rather than read by it —
      // the same shape as `serve.ts` on the @objectstack/spec entry above and
      // `realtime-protocol.mdx` on @objectstack/dogfood, and settled the same
      // way: the literal collector takes quoted paths without parsing, so a
      // mention forces a declaration, and declaring the file is cheaper than
      // rewording prose to dodge the scanner. All three are low-churn, so the
      // added cache invalidation is nominal next to the two directories above.
      'scripts/check-published-files.mjs',
      'scripts/check-cross-package-test-inputs.mjs',
      'packages/types/src/node-isolation.test.ts',
    ],
  },
  '@objectstack/plugin-security': {
    // src/audience-anchor-set-claims.pin.test.ts pins against spec's
    // high-privilege table, and cross-checks spec's own delegatable pin.
    globs: ['packages/spec/src/security/**', 'packages/spec/src/identity/**'],
  },
  '@objectstack/dogfood': {
    // test/*-conformance.test.ts read a fixed roster of probe files across
    // runtime, rest, plugins and services by repo-relative path. Narrow to the
    // roster rather than `packages/**/src/**`: the literal-coverage check below
    // fails the moment a probe is added outside these, so narrowing here cannot
    // quietly reopen the blind spot.
    globs: [
      'packages/client/src/**',
      'packages/mcp/src/**',
      'packages/plugins/plugin-hono-server/src/**',
      'packages/rest/src/**',
      'packages/runtime/src/**',
      'packages/services/service-realtime/src/**',
      // flow-trigger / validation conformance pin spec's zod schemas.
      'packages/spec/src/automation/**',
      'packages/spec/src/data/**',
      // showcase-declarative-*.dogfood.test.ts chdir into the showcase app and
      // compile it, so the app IS an input, and they assert on the artifact the
      // compile pipeline and the metadata plugin produce.
      'examples/app-showcase/**',
      'packages/cli/src/commands/**',
      'packages/metadata/src/**',
      // `realtime-protocol.mdx` is named in a comment rather than read, the
      // same shape as `check-nul-bytes.mjs` on the @objectstack/cli entry
      // above and settled the same way: a mention forces a declaration, and
      // declaring the file is cheaper than rewording prose to dodge the
      // scanner. Here the coupling is real on top of being cheap — that page
      // is what documents the PLANNED realtime transports (`/ws`, SSE
      // `/api/v1/stream`), and the #2992 transport tripwires in
      // authz-conformance.test.ts are only correct for as long as they cover
      // those spellings. A third transport added to the page is exactly the
      // change that reopens the #9084 blind spot, so it must re-run this test.
      'content/docs/protocol/kernel/realtime-protocol.mdx',
    ],
  },
  '@objectstack/formula': {
    // src/rls-predicate.test.ts pins spec's RLS zod source against the
    // predicate compiler; src/skill-catalog-sync.test.ts pins the published
    // formula skill's stdlib table against the implementation.
    globs: ['packages/spec/src/security/rls.zod.ts', 'skills/objectstack-formula/**'],
  },
  '@objectstack/metadata-protocol': {
    // src/sys-metadata-repository.draft-drain.test.ts reads the durability
    // log-level gate's own source to pin that the repository stays inside it.
    globs: ['scripts/check-durability-degradation-log-level.mjs'],
  },
  '@objectstack/downstream-contract': {
    // test/source-resolution.pin.test.ts resolves every spec specifier a
    // downstream consumer can import, against spec's real source tree and the
    // `exports` map in its package.json.
    globs: ['packages/spec/src/**', 'packages/spec/package.json'],
  },
  'create-objectstack': {
    // src/template-consistency.test.ts reads doc frontmatter by repo-relative
    // path to decide which templates are internal.
    //
    // `sync-template-versions.mjs` is a real cross-package READ. Since #9648,
    // src/template-version-stamps.test.ts loads the script by URL to assert its
    // declaration surface (`stampedPaths()`, `findTemplateDirs()`, the
    // `TEXT_STAMPS` table) and runs it with `execFileSync` over a two-template
    // fixture (#9554). It was a mention before that test existed, which is what
    // the rationale here used to say.
    //
    // The glob does not rest on that one test, so deleting it would not make
    // this declaration wrong — only smaller. The script STAMPS the three
    // per-template version surfaces (`package.json` @objectstack/* ranges,
    // `objectstack.config.ts` `engines.protocol`, `objectstack.manifest.json`
    // `specVersion`) that template-consistency.test.ts ratchets, so a change to
    // the stamper is exactly the change those ratchets exist to catch (#9264).
    //
    // What FORCES the glob is now the read itself. Both tests spell the path as
    // `join(repoRoot, 'scripts', 'sync-template-versions.mjs')`, which the flat
    // literal collector below cannot see — it only matches a whole repo-relative
    // path inside ONE quoted string — so until #9763 what actually held this
    // declaration was the quoted MENTION in each test's header comment, and
    // rewording either one into unquoted prose unforced a live radius.
    // Measured on 06f9848f9, before the fix: drop the glob and unquote both
    // mentions and the gate printed `OK ... exit 0`. Measured after: the same
    // ablation fails naming template-version-stamps.test.ts, the file that
    // really reads. The mentions are ordinary prose again — free to reword.
    //
    // `.github/workflows/scaffold-e2e.yml` is READ, not merely mentioned:
    // src/scaffold-e2e-boot-probe.test.ts extracts the three boot-and-probe
    // `run:` scripts out of that file and EXECUTES them, so the workflow is
    // literally the code under test. It is the workflow that gates this package
    // (its `paths:` filter is `packages/create-objectstack/**`), which is why
    // the test lives here rather than beside a shell script in spec (#9779).
    //
    // The last three are NAMED in that test's header rather than read, the same
    // shape as `check-nul-bytes.mjs` above and settled the same way: the literal
    // collector takes quoted paths without parsing, so a mention forces a
    // declaration, and declaring three rarely-touched files is cheaper than
    // rewording prose to dodge a scanner. `serve.ts` earns it on the merits too
    // — its `flags.dev || NODE_ENV === 'development'` port-shift gate is the
    // single fact that decides which fix those workflow blocks need, so a change
    // to that branch is exactly the change the test's premise would need
    // re-measuring against. The two sibling scripts are cited for the contrast
    // that keeps the fixes from being copied between them.
    globs: [
      'content/**',
      'scripts/sync-template-versions.mjs',
      // The stamper's own import closure, and a live input for the same reason
      // the stamper is: template-version-stamps.test.ts copies the script into
      // a fixture and both IMPORTS and SPAWNS it there, so the copy needs every
      // relative import the script makes. That fixture derives the closure
      // rather than naming files, so this path appears in NO quoted string the
      // flat literal collector can see — but a change to it really does break
      // that test (measured: drop the closure walk and the same 3 cases fail
      // with ERR_MODULE_NOT_FOUND), which is exactly the trigger radius this
      // declaration exists to keep honest.
      'scripts/invoked-as.mjs',
      '.github/workflows/scaffold-e2e.yml',
      'packages/cli/src/commands/serve.ts',
      'scripts/gen-sdui-manifest.sh',
      'scripts/publish-smoke.sh',
    ],
  },
};

// ── glob matching ────────────────────────────────────────────────────────────
// Deliberately dependency-free: this gate runs in CI before anything is built,
// and a `scripts/` gate that can fail on a resolution problem is a gate that
// gets muted. Supports the three constructs the declarations above use:
// `**` (any number of path segments), `*` (within one segment), and literals.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` consumes zero or more whole segments; a trailing `**` consumes the rest.
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}

/**
 * Whether the declared globs cover a DIRECTORY a test lists with `readdirSync`.
 *
 * Not the same question as `matchesAny`, and the difference is not a detail: a
 * subtree glob is written to match FILES, so `packages/lint/src/**` does not
 * match the bare string `packages/lint/src`, while turbo hashing that glob does
 * re-run the test when the listing changes. What a directory read needs is that
 * the glob covers what is INSIDE the directory.
 *
 * Answered against the real entries rather than inferred from the glob's shape,
 * because shape cannot tell the two apart: `packages/lint/src/**` and
 * `packages/lint/src/**\/*.object.ts` both look like subtree globs and only the
 * first re-runs when an ordinary `.ts` file appears. An empty directory is not
 * covered by anything — there is nothing to have matched.
 */
export function coversDirectory(dir, globs, root = REPO_ROOT) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return false;
  }
  const files = entries.filter((e) => e.isFile()).map((e) => `${dir}/${e.name}`);
  return files.length > 0 && files.every((f) => matchesAny(f, globs));
}

// ── the escape detector ──────────────────────────────────────────────────────
const FS_READ = /\b(readFileSync|readdirSync|statSync|existsSync|globSync|opendirSync|execFileSync)\b/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.next', '.git']);

/**
 * Reads whose FIRST argument is a path, for the argument-position scan below.
 * `execFileSync` is deliberately absent from this list though it is in FS_READ:
 * its first argument is a binary to run, not a file to read.
 */
const PATH_ARG_READS = ['readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'existsSync', 'globSync', 'opendirSync'];

/**
 * The path spellings this gate can SEE, in the words an author would write them.
 * Printed in the failure text and mirrored in AGENTS.md, because the detector is
 * a source scan: a spelling that is not on this list yields no flag, so a read
 * written that way goes undeclared silently. Anything added here needs a
 * `--self-test` case in the same edit, or the next refactor drops it unnoticed.
 */
export const RECOGNISED_PATH_SPELLINGS = [
  "const HERE = dirname(fileURLToPath(import.meta.url));   // seed (ESM)",
  'const HERE = __dirname;                                  // seed (CJS)',
  'const HERE = import.meta.dirname;       // and dirname(import.meta.filename)',
  "const HERE = resolve(fileURLToPath(import.meta.url), '..');  // seed, walked",
  '                                        // from the FILE instead of named;',
  '                                        // import.meta.filename works too',
  "const P = resolve(HERE, '<rel>');       // join() and the path.* forms too",
  "const P = fileURLToPath(new URL('<rel>', import.meta.url));",
  "const P = new URL('<rel>', import.meta.url);",
  "readFileSync(resolve(HERE, '<rel>'))    // the same expressions in argument",
  "readFileSync(new URL('<rel>', import.meta.url))              // position",
];

function walkTests(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTests(p, out);
    else if (/\.test\.[cm]?[jt]sx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function packageRootOf(file) {
  let d = dirname(file);
  while (d.startsWith(REPO_ROOT) && d !== REPO_ROOT) {
    if (existsSync(join(d, 'package.json'))) return d;
    d = dirname(d);
  }
  return null;
}

/**
 * Walk a relative path literal from `base` (a depth below the package root),
 * reporting where it ENDS, the SHALLOWEST point it passes through, and whether
 * it steps into an installed dependency.
 *
 * `min` is the load-bearing number, and `end` alone is a trap: a literal that
 * climbs past the package root and then descends into a SIBLING package ends at
 * a perfectly positive depth while addressing another package entirely.
 * `join(HERE, '..', '..', 'spec', 'src', 'rls.zod.ts')` from `<pkg>/src` ends at
 * +4 and reads `packages/spec` — the exact #7802 shape, invisible to a test on
 * the final depth. Final depth is only sound for a binding that STOPS at the top
 * of its ascent, which is what a `REPO_ROOT` const happens to be and what the
 * other spellings are not.
 *
 * `segs` is the SAME walk carried in repo-relative NAMES rather than in depths,
 * and it is what lets the roster below name a file the source never spells as
 * one whole string (#9763). It is `null` whenever the name stops being knowable
 * — an unresolved base, an argument this scan cannot read, or an ascent past the
 * repo root — because a path with a segment missing from its middle is a
 * fabricated roster entry, and a coverage check that fabricates entries is worse
 * than one that misses them. Depth decides the ESCAPE verdict either way; segs
 * only ever adds a name to the radius roster.
 */
function walkLiteral(base, literal, segs) {
  let end = base;
  let min = base;
  let vendored = false;
  let out = segs ? [...segs] : null;
  for (const seg of literal.split('/').filter(Boolean)) {
    if (seg === '..') {
      end -= 1;
      // Above the repo root there is no repo-relative name to report.
      if (out) out = out.length ? out.slice(0, -1) : null;
    } else if (seg !== '.') {
      end += 1;
      if (out) out = [...out, seg];
      // An installed dependency is not a repo source input: turbo cannot hash
      // `node_modules/**` as a source glob, and the walk above skips it anyway.
      // A read that lands there escapes the package but declares nothing.
      if (seg === 'node_modules') vendored = true;
    }
    if (end < min) min = end;
  }
  return { end, min, vendored, segs: out };
}

/** Split an argument list on its TOP-LEVEL commas — `new URL(x, import.meta.url)` has one of its own. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out;
}

const PATH_LITERAL = /^(['"`])([^'"`]*)\1$/;
const NEW_URL_LITERAL = /^new\s+URL\(\s*(['"`])([^'"`]*)\1\s*,\s*import\.meta\.url\s*\)$/;

/**
 * Resolve one path expression to `{ end, min, vendored, segs }`, or `undefined`
 * when the spelling is not one of RECOGNISED_PATH_SPELLINGS. Recursive so that
 * every recognised form composes with every other: a `new URL` seed may sit
 * under a `fileURLToPath`, inside a `resolve()`, in a read's argument — each
 * layer is peeled by the same function rather than by a separate special case.
 *
 * `fileSegs` is the repo-relative segments of the file being scanned, or `null`
 * when the caller has no repo context (the `--self-test` shapes, which assert on
 * depth alone). It is what turns the depth walk into a NAME: with it, the three
 * spellings of #9763 — a path split across `join`/`resolve` arguments, an
 * ascent-relative literal, and a descent into a top-level directory the flat
 * literal regex does not list — resolve to the same repo-relative string an
 * author would have written in one quoted piece.
 */
function pathExpression(expr, hereDepth, known, fileSegs = null) {
  expr = expr.trim();
  // The two seeds NAME the directory; `fileSegs` names the FILE inside it.
  const dirSegs = fileSegs ? fileSegs.slice(0, -1) : null;
  const at = (depth, segs) => ({ end: depth, min: depth, vendored: false, segs });

  // `fileURLToPath(x)` does not move the path, only its spelling.
  const unwrapped = expr.match(/^(?:url\.)?fileURLToPath\(([\s\S]*)\)$/);
  if (unwrapped) return pathExpression(unwrapped[1], hereDepth, known, fileSegs);

  if (/^(?:path\.)?dirname\(\s*(?:url\.)?fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)$/.test(expr)) {
    return at(hereDepth, dirSegs);
  }
  if (expr === '__dirname') return at(hereDepth, dirSegs);
  // `import.meta.dirname` / `.filename` (Node >= 20.11) are the modern spelling of
  // the two seeds above. No test uses them TODAY — which is the reason to accept
  // them now: the first author who reaches for them would otherwise get silence.
  if (expr === 'import.meta.dirname') return at(hereDepth, dirSegs);
  if (/^(?:path\.)?dirname\(\s*import\.meta\.filename\s*\)$/.test(expr)) {
    return at(hereDepth, dirSegs);
  }
  // The two seeds above NAME the directory. `import.meta.url` and
  // `import.meta.filename` name the FILE, which sits one level below it, and an
  // author reaches that same directory by WALKING instead — most often
  // `resolve(fileURLToPath(import.meta.url), '..')`. Modelling the file at
  // `hereDepth + 1` is what makes the walked form come out equal to the named one
  // through the ordinary literal walk below, rather than needing a case of its own,
  // and it is precisely Node's `resolve`/`join`, which treat a file argument as a
  // directory prefix like any other. Unrecognised until #8995: three packages/cli
  // e2e tests seed this way, so their reads of `content/docs/**` produced no flag
  // and went undeclared — the silence this list exists to prevent, and it cost a
  // merge-queue dequeue (PR #8983) before anyone saw it.
  if (expr === 'import.meta.url' || expr === 'import.meta.filename') {
    return at(hereDepth + 1, fileSegs);
  }

  // A `new URL(rel, import.meta.url)` resolves against the importing FILE, so
  // its base is the file's directory — the same base as the two seeds above.
  // This is the ASCENT-RELATIVE spelling of #9763: one string, but it starts at
  // `..`, so the flat literal regex below never saw it while the walk here has
  // always resolved it — the name was thrown away, not the path.
  const url = expr.match(NEW_URL_LITERAL);
  if (url) return walkLiteral(hereDepth, url[2], dirSegs);

  if (/^[A-Za-z_$][\w$]*$/.test(expr)) return known.get(expr);

  const call = expr.match(/^(?:path\.)?(?:resolve|join)\(([\s\S]*)\)$/);
  if (!call) return undefined;
  const args = splitTopLevel(call[1]);
  const base = pathExpression(args[0], hereDepth, known, fileSegs);
  if (!base) return undefined;
  let { end, min, vendored, segs } = base;
  for (const a of args.slice(1)) {
    const lit = a.match(PATH_LITERAL);
    if (!lit) {
      // An argument this scan cannot read leaves the DEPTH walk where it was —
      // deliberately, since the escape verdict is a lower bound and has always
      // been computed this way — but the NAME is gone: a reconstructed path
      // missing a segment out of its middle would be a roster entry pointing at
      // a file nobody reads. Losing the name is the safe half of that trade.
      segs = null;
      continue;
    }
    const step = walkLiteral(end, lit[2], segs);
    end = step.end;
    min = Math.min(min, step.min);
    vendored = vendored || step.vendored;
    segs = step.segs;
  }
  return { end, min, vendored, segs };
}

/**
 * The reads whose path argument is a DIRECTORY rather than a file. A directory
 * handed to one of these is a real input — `readdirSync(LINT_SRC)` re-reads
 * whatever `packages/lint/src` contains — so the roster must be allowed to name
 * it, which the file-only filter in `findEscapingPackages()` otherwise forbids.
 * Kept to the two calls whose argument can only be a directory: `statSync` and
 * `existsSync` take either, and admitting them would let any directory PREFIX
 * used to build a path force a declaration. `globSync` is out for the opposite
 * reason — its first argument is a pattern, not a directory.
 */
const DIR_ARG_READS = new Set(['readdirSync', 'opendirSync']);

/**
 * The name and argument list of every fs read whose first argument is a path,
 * paren-balanced.
 */
function* readArgumentLists(src) {
  const re = new RegExp(String.raw`\b(${PATH_ARG_READS.join('|')})\s*\(`, 'g');
  for (const m of src.matchAll(re)) {
    const from = m.index + m[0].length;
    let depth = 1;
    let quote = null;
    let i = from;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') i += 1;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth += 1;
      else if (c === ')' && --depth === 0) break;
    }
    if (depth === 0) yield { fn: m[1], args: src.slice(from, i) };
  }
}

/**
 * One pass over `src`, answering the gate's two separate questions at once:
 *
 *   `escapes` — every path that addresses something outside the package, which
 *               in a file that also reads the filesystem is the #7802 shape.
 *   `files` / `dirs` — the repo-relative paths those same expressions RESOLVE
 *               to, which is the radius roster `verify()` measures declarations
 *               against. Split by what the read wants, because the filter in
 *               `findEscapingPackages()` differs: a directory counts only when a
 *               directory-listing read is what consumed it.
 *
 * The two answers come from one walk because they come from one resolution: the
 * depth that decides `escapes` and the name that fills the roster are the same
 * traversal seen in two coordinates (see `walkLiteral`).
 *
 * Deliberately a source scan and not a real parse: a detector with no
 * dependencies cannot itself fail to resolve in CI, which is what keeps this
 * gate un-mutable. The price is that it only sees the spellings it knows, so the
 * list it knows is published (RECOGNISED_PATH_SPELLINGS, printed in the failure
 * text and mirrored in AGENTS.md) instead of being an implementation detail an
 * author has to reverse-engineer from a silent pass.
 *
 * Two positions are scanned, because a path is as often nested straight into the
 * read as it is bound to a name first:
 *   const SRC = readFileSync(resolve(HERE, '../../other/src/x.ts'), 'utf8');
 * binds `SRC` to file CONTENTS, never to a path, so a declaration-only scan sees
 * no path at all in the line that does the escaping.
 *
 * `--self-test` pins the shapes that must keep flagging AND the shapes that must
 * not; an added spelling without an added case is the next silent regression.
 */
function scanPathExpressions(src, hereDepth, fileSegs = null) {
  const known = new Map();
  const escapes = [];
  const files = new Set();
  const dirs = new Set();
  const report = (name, info) => {
    // `vendored`: the read escapes the package but lands in an installed
    // dependency, which no declaration can name. Not a cross-package input.
    if (!info || info.vendored || info.min >= 0) return;
    escapes.push({ name, depth: info.min });
  };
  // A resolved name goes on the roster regardless of depth: `findEscapingPackages`
  // drops the package's own paths itself, using the same own-prefix rule it
  // already applies to the flat literals, so this stays one rule rather than two.
  const collect = (into, info) => {
    if (info?.segs?.length && !info.vendored) into.add(info.segs.join('/'));
  };

  const DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+(?:\n\s*[^;\n]*)??)\s*;/g;
  for (const m of src.matchAll(DECL)) {
    const info = pathExpression(m[2].trim(), hereDepth, known, fileSegs);
    if (!info) continue;
    known.set(m[1], info);
    collect(files, info);
    report(m[1], info);
  }

  let n = 0;
  for (const { fn, args } of readArgumentLists(src)) {
    n += 1;
    const first = splitTopLevel(args)[0];
    const info = known.get(first) ?? pathExpression(first, hereDepth, known, fileSegs);
    collect(DIR_ARG_READS.has(fn) ? dirs : files, info);
    // A bare binding here was already judged at its declaration; reporting it a
    // second time would only duplicate the finding under a less useful name.
    if (known.has(first)) continue;
    report(`read #${n} argument`, info);
  }
  return { escapes, files, dirs };
}

/**
 * Every path in `src` that addresses something outside the package. Kept as the
 * exported name the `--self-test` shapes and any future reader reach for; the
 * roster half of the same walk is internal to `findEscapingPackages()`.
 */
export function escapingBindings(src, hereDepth, fileSegs = null) {
  return scanPathExpressions(src, hereDepth, fileSegs).escapes;
}

/**
 * Repo-relative path literals a test names in its own source — the roster a
 * probe-style scan reads. Extracting them is what lets a declaration be NARROW
 * safely: a glob is only allowed to be narrow while it still covers every path
 * the tests actually name, and the moment someone adds a probe outside the
 * declared radius the gate fails naming the file. Over-collection (a path in a
 * comment or an assertion message) is harmless — it can only force a WIDER
 * declaration, never a narrower one.
 *
 * This half sees a path only when the WHOLE repo-relative path sits inside ONE
 * quoted string and starts at a top-level directory. That is the third spelling
 * of #9763 and the only one that is a DATA defect rather than a collector one:
 * `skills/` was simply missing from the alternation, so `@objectstack/formula`'s
 * read of the published formula skill was invisible twice over — once here and
 * once in the reconstruction. The list below is every top-level directory a
 * declared glob can name; a new one added to the tree belongs here too.
 */
export function repoRelativeLiterals(src) {
  const out = new Set();
  for (const m of src.matchAll(/(['"`])((?:packages|apps|examples|content|scripts|skills)\/[A-Za-z0-9._/-]+)\1/g)) {
    out.add(m[2]);
  }
  return out;
}

function packageNameOf(pkgRoot) {
  try {
    return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).name ?? null;
  } catch {
    return null;
  }
}

/** Every package with at least one test that reads outside its own directory. */
export function findEscapingPackages() {
  const found = new Map();
  for (const top of ['packages', 'apps', 'examples']) {
    const dir = join(REPO_ROOT, top);
    if (!existsSync(dir)) continue;
    for (const file of walkTests(dir)) {
      const src = readFileSync(file, 'utf8');
      if (!FS_READ.test(src)) continue;
      const pkgRoot = packageRootOf(file);
      if (!pkgRoot) continue;
      const hereDepth = relative(pkgRoot, dirname(file)).split(sep).filter(Boolean).length;
      // The file's OWN repo-relative segments are the seed that turns the depth
      // walk into a name (#9763). Only this call site has them — `--self-test`
      // asserts on synthetic sources with no place in the tree, so it passes
      // none and gets depth-only answers, exactly as before.
      const fileSegs = relative(REPO_ROOT, file).split(sep).filter(Boolean);
      const scan = scanPathExpressions(src, hereDepth, fileSegs);
      if (!scan.escapes.length) continue;
      const name = packageNameOf(pkgRoot);
      if (!name) continue;
      if (!found.has(name))
        found.set(name, { dir: relative(REPO_ROOT, pkgRoot), tests: [], literals: new Map(), dirEntries: new Set() });
      const entry = found.get(name);
      const rel = relative(REPO_ROOT, file);
      entry.tests.push(rel);
      const own = relative(REPO_ROOT, pkgRoot);
      // Two rosters, one filter. The flat literals are what an author WROTE in
      // one quoted piece; the reconstructed ones are what the recognised path
      // expressions RESOLVE to — the reads that hold a radius without ever
      // spelling it (#9763). A reconstructed directory counts only when a
      // directory-listing read consumed it; everything else must name a file.
      const roster = [
        ...[...repoRelativeLiterals(src), ...scan.files].map((p) => [p, 'file']),
        ...[...scan.dirs].map((p) => [p, 'dir']),
      ];
      for (const [lit, kind] of roster) {
        // Paths inside the package's own directory are already covered by
        // `$TURBO_DEFAULT$` and by the package's own affected-set membership.
        if (lit === own || lit.startsWith(`${own}/`)) continue;
        // Only paths naming a real file — or a real directory a directory-read
        // consumed — count. Test sources are full of synthetic fixture paths
        // (`packages/a/src/x.ts`) and of directory prefixes used to build a path
        // or phrase a message; neither is an input, and requiring a glob to
        // cover them would force declarations wider than the truth.
        let real = false;
        try {
          const st = statSync(join(REPO_ROOT, lit));
          real = kind === 'dir' ? st.isDirectory() : st.isFile();
        } catch {
          real = false;
        }
        if (!real) continue;
        if (kind === 'dir') entry.dirEntries.add(lit);
        if (!entry.literals.has(lit)) entry.literals.set(lit, rel);
      }
    }
  }
  return found;
}

// ── modes ────────────────────────────────────────────────────────────────────

function verify() {
  const escaping = findEscapingPackages();
  const declared = new Set(Object.keys(CROSS_PACKAGE_TEST_INPUTS));
  const problems = [];

  for (const [name, info] of [...escaping].sort()) {
    if (declared.has(name)) continue;
    problems.push(
      `${name} has test(s) that read outside the package but declares no input radius.\n` +
        info.tests.map((t) => `      ${t}`).join('\n') +
        `\n    Add an entry to CROSS_PACKAGE_TEST_INPUTS in ${relative(REPO_ROOT, fileURLToPath(import.meta.url))}\n` +
        `    with the repo-relative globs those tests read, then run this gate again\n` +
        `    for the turbo.json inputs it requires.`,
    );
  }
  for (const name of [...declared].sort()) {
    if (escaping.has(name)) continue;
    problems.push(
      `${name} declares a cross-package input radius, but no test in it reads outside\n` +
        `    the package any more. Delete the entry (and its turbo.json inputs) — a stale\n` +
        `    declaration invalidates that package's test cache for nothing.`,
    );
  }

  // A declaration may be narrower than "the whole repo" only while it still
  // covers every repo-relative path its tests name. This is what keeps
  // narrowing honest: extending a probe roster past the declared radius fails
  // here, by file name, instead of silently going ungated again.
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    const info = escaping.get(name);
    if (!info) continue;
    const uncovered = [...info.literals].filter(([lit]) =>
      info.dirEntries.has(lit) ? !coversDirectory(lit, globs) : !matchesAny(lit, globs),
    );
    if (uncovered.length) {
      problems.push(
        `${name} names path(s) no declared glob covers, so a change to them would not\n` +
          `    re-run its tests:\n` +
          uncovered
            .map(([lit, test]) => `      ${lit}${info.dirEntries.has(lit) ? '/   (listed in ' : '   (named in '}${test})`)
            .join('\n') +
          `\n    Widen the package's globs to cover them.`,
      );
    }
  }

  // Layer B: turbo.json must hash the declared globs, or the merge queue
  // replays a cached green over a scan it never ran (the #7802 escape itself).
  let turbo;
  try {
    turbo = JSON.parse(readFileSync(join(REPO_ROOT, 'turbo.json'), 'utf8'));
  } catch (e) {
    console.error(`FAIL: cannot read turbo.json: ${e.message}`);
    process.exit(1);
  }
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    const task = turbo.tasks?.[`${name}#test`];
    if (!task) {
      problems.push(
        `turbo.json has no "${name}#test" task. Without it the package's test cache is\n` +
          `    keyed on package-local files only, so a change to its declared globs replays\n` +
          `    a stale green instead of re-running. Add it with inputs:\n` +
          `      ${JSON.stringify(expectedInputs(globs))}`,
      );
      continue;
    }
    const missing = globs.filter((g) => !(task.inputs ?? []).includes(`$TURBO_ROOT$/${g}`));
    if (missing.length) {
      problems.push(
        `turbo.json "${name}#test" inputs are missing the declared glob(s):\n` +
          missing.map((g) => `      $TURBO_ROOT$/${g}`).join('\n'),
      );
    }
  }

  if (problems.length) {
    console.error('FAIL: cross-package test inputs are not declared consistently.\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    console.error(
      'Why this gate exists: a test whose real inputs are wider than its package is\n' +
        'invisible to BOTH the affected-subset filter and the turbo cache, so it can go\n' +
        'red on `main` while every PR reports green (#7802).\n',
    );
    console.error(
      'How this gate SEES a read, and its limit: it is a source scan, so it recognises\n' +
        'these spellings and only these. A path written any other way yields no flag —\n' +
        'which means no declaration, silently. Write escaping reads as:\n' +
        RECOGNISED_PATH_SPELLINGS.map((s) => `      ${s}`).join('\n') +
        '\n    Reaching for a spelling that is not here? Add it to the detector (with a\n' +
        '    --self-test case) rather than working around it — an unseen read is the\n' +
        '    defect above, not a style question.',
    );
    process.exit(1);
  }
  console.log(
    `OK: ${escaping.size} package(s) read outside themselves, all declared, ` +
      `and turbo.json hashes every declared glob.`,
  );
}

function expectedInputs(globs) {
  return ['$TURBO_DEFAULT$', '!dist/**', '!coverage/**', '!.turbo/**', ...globs.map((g) => `$TURBO_ROOT$/${g}`)];
}

/**
 * `turbo ls --output=json` emits `packages.count` beside `packages.items`, and
 * keeps the two equal -- measured on turbo 2.10.10, all of the bare, `--filter`
 * and `--affected` forms agree. So `count` is TURBO's field, not this script's
 * invention, and a document we have appended to is a valid `turbo ls` payload
 * only while the count moves with the array.
 *
 * Nothing reads `count` today, which is exactly what makes it cheap to keep
 * true and expensive to leave stale: the consumer is partition-test-shards.mjs,
 * whose stated posture is to assert this payload's shape LOUDLY so an
 * experimental-command upgrade becomes a red step naming the cause rather than
 * a silently empty shard. A hand-mutated document that contradicts itself about
 * its own size is the input to that assertion. The reader now checks the
 * agreement (`readPackageItems()` there), so this is a checked invariant across
 * the two scripts rather than a convention someone has to remember.
 *
 * Reconciling inside the SERIALIZER rather than as a statement beside the write
 * is the point: `unionInto()` has exactly one `writeFileSync`, and it has no
 * other source of bytes, so "appended to `items` but forgot to move `count`" is
 * not a state this script can reach. A separate `reconcile(); write();` pair
 * would have re-created the original defect the first time someone added a
 * second write path.
 */
function serializePackageList(parsed) {
  parsed.packages.count = parsed.packages.items.length;
  return JSON.stringify(parsed);
}

/**
 * Layer A. Adds any declaring package whose globs the diff touches to the
 * package list ci.yml is about to shard, so the scan runs on the PR that
 * actually changed its inputs.
 */
function unionInto(listPath, changedPath) {
  const parsed = JSON.parse(readFileSync(listPath, 'utf8'));
  const items = parsed?.packages?.items;
  if (!Array.isArray(items)) {
    console.error(`FAIL: ${listPath} is not a \`turbo ls --output=json\` payload ({packages:{items:[...]}}).`);
    process.exit(1);
  }
  const changed = readFileSync(changedPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const present = new Set(items.map((i) => i.name));
  // findEscapingPackages() walks packages/, apps/ and examples/ in full and reads
  // every *.test.* file it finds; its answer does not vary between iterations of
  // the loop below, so it is indexed ONCE here rather than re-walked per matching
  // declaration. Nothing between here and the old per-iteration call site writes
  // to packages/apps/examples (the only write in this function is the final
  // `writeFileSync(listPath, ...)`, to the turbo-ls.json output, after this
  // point), so hoisting cannot change what the walk sees.
  const escapingDirs = new Map([...findEscapingPackages()].map(([n, info]) => [n, info.dir]));
  const added = [];
  for (const [name, { globs }] of Object.entries(CROSS_PACKAGE_TEST_INPUTS)) {
    if (present.has(name)) continue;
    const hit = changed.find((f) => matchesAny(f, globs));
    if (!hit) continue;
    const dir = escapingDirs.get(name);
    if (!dir) continue;
    // Repo-relative, because that is the convention `turbo ls` emits for every
    // entry it wrote (measured on turbo 2.10.10: 0 of 77 items absolute). An
    // absolute path here is not wrong for today's only consumer, but it makes a
    // single document carry two conventions, and the obvious way to read such a
    // document -- `join(REPO_ROOT, it.path)`, correct for every entry turbo
    // wrote -- produces a garbage path for exactly these appended entries, which
    // are the cross-package scans this function exists to keep running. One
    // document, one convention; the consumer resolves it explicitly
    // (partition-test-shards.mjs `packageDir()`).
    items.push({ name, path: dir });
    added.push(`${name}  (declared glob matched ${hit})`);
  }
  // The push above changed the list's size, so the size the document DECLARES
  // moves with it -- serializePackageList() is the only way this function turns
  // `parsed` into bytes, precisely so that cannot be skipped.
  writeFileSync(listPath, serializePackageList(parsed));
  if (added.length) {
    console.log('Cross-package scans pulled into this run because the diff touched their declared inputs:');
    for (const a of added) console.log(`  + ${a}`);
  } else {
    console.log('No cross-package scan declares inputs touched by this diff.');
  }
}

function selfTest() {
  const cases = [];
  const ok = (label, cond) => cases.push({ label, cond });

  // glob semantics
  ok('** spans segments', matchesAny('packages/platform-objects/src/identity/x.object.ts', ['packages/**/*.object.ts']));
  ok('** matches a direct child', matchesAny('packages/a.object.ts', ['packages/**/*.object.ts']));
  ok('* does not span segments', !matchesAny('packages/a/b.object.ts', ['packages/*.object.ts']));
  ok('non-matching extension rejected', !matchesAny('packages/x/src/a.ts', ['packages/**/*.object.ts']));
  ok('trailing ** matches subtree', matchesAny('packages/lint/src/rules/a.ts', ['packages/lint/src/**']));
  ok('literal file glob', matchesAny('content/docs/references/index.mdx', ['content/docs/references/index.mdx']));
  ok('dot is literal', !matchesAny('contentXdocs/references/index.mdx', ['content/docs/references/index.mdx']));

  // detector shapes -- one per spelling that appears in the repo today
  const at = (src, depth) => escapingBindings(src, depth).length > 0;
  ok(
    'flags resolve() off a fileURLToPath seed (api-methods-batch-conformance)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst REPO_ROOT = resolve(HERE, '../../../..');", 2),
  );
  ok(
    'flags join() with a multi-segment literal (dogfood)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst REPO_ROOT = join(HERE, '../../../..');", 2),
  );
  ok(
    'flags a two-step chain (create-objectstack)',
    at(
      "const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');\n" +
        "const repoRoot = path.resolve(pkgRoot, '..', '..');",
      1,
    ),
  );
  ok(
    'does NOT flag a within-package resolve',
    !at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst FIX = resolve(HERE, '../fixtures');", 2),
  );
  ok(
    'does NOT flag a descent back below the package root',
    !at(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const ROOT = resolve(HERE, '../..');\n" +
        "const SRC = join(ROOT, 'src', 'data');",
      2,
    ),
  );

  // The ascent-then-descent shape. Every case below ends at a NON-NEGATIVE
  // depth while addressing a sibling package, so each one passes a test on the
  // final depth and is caught only by the shallowest point reached.
  ok(
    'flags a one-literal climb into a sibling package (formula -> spec)',
    at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst Z = join(HERE, '..', '..', 'spec', 'src', 'rls.zod.ts');", 1),
  );
  ok(
    'flags a fileURLToPath(new URL()) seed naming a sibling package',
    at("const SRC = fileURLToPath(new URL('../../../other-pkg/src/x.ts', import.meta.url));", 2),
  );
  ok(
    'flags a new URL() seed with no fileURLToPath around it',
    at("const SRC = new URL('../../../other-pkg/src/x.ts', import.meta.url);", 2),
  );
  ok(
    'flags a new URL() nested straight into a read (no path binding exists)',
    at("const SRC = readFileSync(new URL('../../../scripts/gate.mjs', import.meta.url), 'utf8');", 1),
  );
  ok(
    'flags a read whose argument is a multi-line new URL()',
    at("const c = readFileSync(\n  new URL('../../../scripts/gate.mjs', import.meta.url),\n  'utf8',\n);", 1),
  );
  ok(
    'flags a resolve() nested straight into a read',
    at(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const SRC = readFileSync(resolve(HERE, '../../../other-pkg/src/x.ts'), 'utf8');",
      2,
    ),
  );
  ok(
    'flags a fileURLToPath(new URL()) chained through resolve()',
    at("const P = resolve(fileURLToPath(new URL('..', import.meta.url)), '../../other-pkg/src');", 2),
  );
  ok(
    'does NOT flag a new URL() that stays inside the package',
    !at("const SRC = readFileSync(new URL('../sibling-dir/x.ts', import.meta.url), 'utf8');", 2),
  );
  ok(
    'does NOT flag a new URL() naming the package root itself',
    !at("const PKG = fileURLToPath(new URL('../../package.json', import.meta.url));", 2),
  );
  ok(
    'does NOT flag a climb into node_modules (no glob can declare an installed dep)',
    !at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst L = resolve(HERE, '../../../node_modules/tsx/dist/loader.mjs');", 1),
  );
  ok(
    'does NOT flag a read argument that is an unrecognised expression',
    !at('const SRC = readFileSync(somewhereElse(x), \'utf8\');', 2),
  );
  ok(
    'flags an import.meta.dirname seed (no file uses it yet — that is the point)',
    at("const HERE = import.meta.dirname;\nconst SRC = resolve(HERE, '../../other-pkg/src/x.ts');", 1),
  );
  ok(
    'flags a dirname(import.meta.filename) seed',
    at("const HERE = dirname(import.meta.filename);\nconst SRC = resolve(HERE, '../../other-pkg/src/x.ts');", 1),
  );
  ok(
    'does NOT flag an import.meta.dirname seed that stays inside the package',
    !at("const HERE = import.meta.dirname;\nconst FIX = resolve(HERE, '../fixtures');", 2),
  );

  // The seed WALKED from the file rather than named off it (#8995). Three
  // packages/cli e2e tests spell it this way; before the file itself was a
  // recognised expression the whole chain below resolved to `undefined`, so the
  // reads produced no flag and no declaration -- silently, which is the one
  // failure mode this detector exists to not have.
  ok(
    'flags a resolve(fileURLToPath(import.meta.url), $DOTDOT) seed (packages/cli e2e)',
    at(
      "const HERE = resolve(fileURLToPath(import.meta.url), '..');\n" +
        "const REPO_ROOT = resolve(HERE, '../../..');\n" +
        "const D = resolve(REPO_ROOT, 'content/docs/deployment/cli.mdx');",
      1,
    ),
  );
  ok(
    'flags the same seed with the climb and the tail in ONE three-argument resolve',
    at(
      "const HERE = resolve(fileURLToPath(import.meta.url), '..');\n" +
        "const D = resolve(HERE, '../../..', 'content/docs/deployment/cli.mdx');",
      1,
    ),
  );
  ok(
    'flags the walked seed via join() and the path.* form',
    at(
      "const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.');\n" +
        "const S = path.resolve(HERE, '../../other-pkg/src/x.ts');",
      1,
    ),
  );
  ok(
    'flags a walked import.meta.filename seed',
    at("const HERE = resolve(import.meta.filename, '..');\nconst S = resolve(HERE, '../../other-pkg/src/x.ts');", 1),
  );
  // The walked seed and the named seed address the same directory, so every
  // verdict must agree between them. This is the case that fails if the file is
  // ever modelled at its directory's depth instead of one below it.
  ok(
    'walked seed agrees with the named seed on an in-package path',
    !at("const HERE = resolve(fileURLToPath(import.meta.url), '..');\nconst FIX = resolve(HERE, '../fixtures');", 2) &&
      !at("const HERE = dirname(fileURLToPath(import.meta.url));\nconst FIX = resolve(HERE, '../fixtures');", 2),
  );
  ok(
    'does NOT flag the walked seed climbing into node_modules (the tsx bin those tests resolve)',
    !at(
      "const HERE = resolve(fileURLToPath(import.meta.url), '..');\n" +
        "const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');",
      1,
    ),
  );
  ok(
    'does NOT flag the bare file expression itself (it names its own file)',
    !at("const SELF = fileURLToPath(import.meta.url);\nconst C = readFileSync(SELF, 'utf8');", 2),
  );

  // ── The radius roster, reconstructed rather than quoted (#9763) ────────────
  //
  // Everything above asks "does this escape?"; everything below asks "WHICH
  // FILE?" — the question the flat literal regex could only answer when an
  // author happened to write the whole repo-relative path inside one pair of
  // quotes. Where it could not, the roster fell back to whatever prose in the
  // same file HAPPENED to be quoted, so an innocent comment edit could unforce
  // a live declaration and a following narrowing would pass in silence.
  //
  // Each case below pins one spelling by the repo-relative name it must
  // produce, because a case asserting only "some path came out" would pass just
  // as happily on a wrong one, and a wrong name is a roster entry pointing at a
  // file nobody reads.
  const named = (src, depth, fileSegs) => [...scanPathExpressions(src, depth, fileSegs).files];
  const listed = (src, depth, fileSegs) => [...scanPathExpressions(src, depth, fileSegs).dirs];
  // `packages/create-objectstack/src/x.test.ts` — depth 1 below its package root.
  const CO = ['packages', 'create-objectstack', 'src', 'x.test.ts'];

  ok(
    'reconstructs a path split across join() arguments (create-objectstack -> the stamper)',
    named(
      "const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');\n" +
        "const repoRoot = path.resolve(pkgRoot, '..', '..');\n" +
        "const SYNC = path.join(repoRoot, 'scripts', 'sync-template-versions.mjs');",
      1,
      CO,
    ).includes('scripts/sync-template-versions.mjs'),
  );
  ok(
    'reconstructs an ascent-relative literal (metadata-protocol -> the durability gate)',
    named(
      "const S = readFileSync(new URL('../../../scripts/check-durability-degradation-log-level.mjs', import.meta.url), 'utf8');",
      1,
      ['packages', 'metadata-protocol', 'src', 'x.test.ts'],
    ).includes('scripts/check-durability-degradation-log-level.mjs'),
  );
  ok(
    'reconstructs an ascent-relative literal off an __dirname seed (spec -> the error catalog)',
    named("const P = resolve(__dirname, '../../../../content/docs/api/error-catalog.mdx');", 3, [
      'packages',
      'spec',
      'src',
      'api',
      'x.test.ts',
    ]).includes('content/docs/api/error-catalog.mdx'),
  );
  ok(
    'reconstructs a path under a top-level dir the flat regex does not list (formula -> skills/)',
    named(
      "const here = dirname(fileURLToPath(import.meta.url));\n" +
        "const SKILL = resolve(here, '../../../skills/objectstack-formula/SKILL.md');",
      1,
      ['packages', 'formula', 'src', 'x.test.ts'],
    ).includes('skills/objectstack-formula/SKILL.md'),
  );
  ok(
    'a directory handed to readdirSync is rostered as a DIRECTORY (spec -> packages/lint/src)',
    listed(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const REPO_ROOT = resolve(HERE, '../../../..');\n" +
        "const LINT_SRC = join(REPO_ROOT, 'packages', 'lint', 'src');\n" +
        'const names = readdirSync(LINT_SRC);',
      2,
      ['packages', 'spec', 'src', 'identity', 'x.test.ts'],
    ).includes('packages/lint/src'),
  );
  // The other half of the same rule, and the one that keeps the file-only
  // filter honest: a directory reached but never LISTED is a prefix used to
  // build a path, not an input. `@objectstack/downstream-contract` spells
  // exactly this — `resolve(PACKAGE_DIR, '..', '..', 'spec', 'src')` feeds a
  // `relative()` comparison and a `resolve(SPEC_SRC, '..', 'package.json')`, so
  // what the roster must take is the package.json, never the directory.
  ok(
    'a directory reached but never listed is NOT rostered as a directory',
    listed(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const PACKAGE_DIR = resolve(HERE, '..');\n" +
        "const SPEC_SRC = resolve(PACKAGE_DIR, '..', '..', 'spec', 'src');\n" +
        "const PKG = readFileSync(resolve(SPEC_SRC, '..', 'package.json'), 'utf8');",
      1,
      ['packages', 'qa', 'downstream-contract', 'test', 'x.test.ts'],
    ).length === 0,
  );
  ok(
    'and the file that prefix BUILDS is rostered',
    named(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const PACKAGE_DIR = resolve(HERE, '..');\n" +
        "const SPEC_SRC = resolve(PACKAGE_DIR, '..', '..', 'spec', 'src');\n" +
        "const PKG = readFileSync(resolve(SPEC_SRC, '..', 'package.json'), 'utf8');",
      1,
      ['packages', 'qa', 'downstream-contract', 'test', 'x.test.ts'],
    ).includes('packages/spec/package.json'),
  );
  // The trade in `walkLiteral`: an argument the scan cannot read must cost the
  // NAME, never invent one. Both directions pinned, because dropping either
  // half is a silent regression -- inventing a name puts a file nobody reads on
  // the roster, and keeping the depth is what preserves the escape verdict.
  // (Intermediate bindings that DO resolve still yield their own names; what
  // must not appear is a name for the expression the unreadable argument sits
  // in, which is the only one that would be a fabrication.)
  ok(
    'an unreadable join() argument yields no name for the path it builds',
    !named(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const ROOT = resolve(HERE, '../../..');\n" +
        "const P = join(ROOT, someVariable, 'x.ts');",
      1,
      CO,
    ).some((p) => p.endsWith('x.ts')),
  );
  ok(
    'but it still flags the escape (the depth walk is unchanged)',
    at(
      "const HERE = dirname(fileURLToPath(import.meta.url));\n" +
        "const ROOT = resolve(HERE, '../../..');\n" +
        "const P = join(ROOT, someVariable, 'x.ts');",
      1,
    ),
  );
  ok(
    'a climb ABOVE the repo root yields no name (there is no repo-relative one)',
    named("const OUT = resolve(__dirname, '../../../../../../elsewhere/x.ts');", 1, CO).length === 0,
  );
  ok(
    'a vendored path is never rostered (no glob can declare an installed dep)',
    !named(
      "const HERE = dirname(fileURLToPath(import.meta.url));\nconst L = resolve(HERE, '../../../node_modules/tsx/dist/loader.mjs');",
      1,
      CO,
    ).some((p) => p.includes('node_modules')),
  );
  ok(
    'without a file seed the walk still answers on depth alone (--self-test above)',
    named("const P = resolve(__dirname, '../../scripts/x.mjs');", 1, null).length === 0 &&
      at("const P = resolve(__dirname, '../../scripts/x.mjs');", 1),
  );

  // The `skills/` prefix -- the one spelling of #9763 that is a DATA fix in the
  // flat collector rather than a reconstruction, kept pinned on both sides so a
  // future trim of the alternation cannot pass.
  ok('the flat collector sees a quoted skills/ path', repoRelativeLiterals("const S = 'skills/objectstack-formula/SKILL.md';").has('skills/objectstack-formula/SKILL.md'));
  ok('and still sees the prefixes it always did', repoRelativeLiterals("const S = 'packages/lint/src/x.ts';").has('packages/lint/src/x.ts'));
  ok('a path under an undeclared top-level dir is still not collected flat', !repoRelativeLiterals("const S = 'node_modules/x/y.ts';").size);

  // Directory coverage. `**` globs are written to match FILES, so the bare
  // directory string does not match its own subtree glob -- which is why a
  // rostered directory needs `coversDirectory` and not `matchesAny`.
  ok('a subtree glob does NOT match the bare directory it covers', !matchesAny('packages/lint/src', ['packages/lint/src/**']));
  ok('but it DOES cover that directory as a listing', coversDirectory('packages/lint/src', ['packages/lint/src/**']));
  ok('a single-file glob does not cover the directory it sits in', !coversDirectory('scripts', ['scripts/check-nul-bytes.mjs']));
  ok('a directory that does not exist is covered by nothing', !coversDirectory('scripts/no-such-dir-9763', ['**']));

  // `--union-into`'s output document. `packages.count` is turbo's field and the
  // append changes the size it describes, so the two are one operation -- these
  // pin the half of the cross-script invariant this side owns (the reader's
  // half is partition-test-shards.mjs `--self-test`).
  // These run the real serializer -- the one and only source of the bytes
  // `unionInto()` writes -- and assert on the parsed-back document, so they pin
  // what lands on disk rather than an intermediate object.
  const written = (packages) => JSON.parse(serializePackageList({ packageManager: 'pnpm9', packages })).packages;
  ok('count follows an appended item', written({ count: 0, items: [{ name: 'a', path: 'p' }, { name: 'b', path: 'q' }] }).count === 2);
  ok('a correct count is left correct', written({ count: 1, items: [{ name: 'a', path: 'p' }] }).count === 1);
  ok('count follows an empty list down', written({ count: 7, items: [] }).count === 0);
  ok('the write never invents items', written({ count: 0, items: [] }).items.length === 0);
  ok('the write leaves turbo\'s other fields alone', JSON.parse(serializePackageList({ packageManager: 'pnpm9', packages: { count: 0, items: [] } })).packageManager === 'pnpm9');

  // The path convention this function appends in. `turbo ls` writes every entry
  // of this document repo-relative; an entry appended in the other convention
  // is not wrong for today's consumer but it makes one array carry two rules,
  // and the obvious way to read it -- `join(REPO_ROOT, it.path)` -- then breaks
  // on exactly the appended entries. End-to-end through the real `unionInto()`
  // and the real serializer, on the fixture that first measured the divergence:
  // a diff touching `scripts/**` pulls @objectstack/spec in by its declaration.
  const unionDir = mkdtempSync(join(tmpdir(), 'os-union-into-'));
  const unionList = join(unionDir, 'turbo-ls.json');
  const unionChanged = join(unionDir, 'changed-files.txt');
  writeFileSync(unionList, JSON.stringify({ packageManager: 'pnpm9', packages: { count: 0, items: [] } }));
  writeFileSync(unionChanged, 'scripts/sync-template-versions.mjs\n');
  unionInto(unionList, unionChanged);
  const unioned = JSON.parse(readFileSync(unionList, 'utf8')).packages.items;
  ok('the union appends the package its declaration matched', unioned.length > 0);
  ok(
    'every appended path is repo-relative, the convention `turbo ls` emits',
    unioned.length > 0 && unioned.every((i) => !isAbsolute(i.path)),
  );
  ok(
    'and each one still names a real directory once resolved against the repo root',
    unioned.length > 0 && unioned.every((i) => existsSync(resolve(REPO_ROOT, i.path))),
  );

  const failed = cases.filter((c) => !c.cond);
  for (const c of cases) console.log(`${c.cond ? 'ok  ' : 'FAIL'} ${c.label}`);
  if (failed.length) {
    console.error(`\n${failed.length}/${cases.length} self-test case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${cases.length} self-test cases passed.`);
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) selfTest();
else if (argv.includes('--list-escapes')) {
  for (const [name, info] of [...findEscapingPackages()].sort()) {
    console.log(`${name}  (${info.dir})`);
    for (const t of info.tests) console.log(`    ${t}`);
  }
} else if (argv.includes('--union-into')) {
  const listPath = argv[argv.indexOf('--union-into') + 1];
  const changedPath = argv[argv.indexOf('--changed') + 1];
  if (!listPath || !changedPath) {
    console.error('usage: check-cross-package-test-inputs.mjs --union-into <turbo-ls.json> --changed <file>');
    process.exit(2);
  }
  unionInto(listPath, changedPath);
} else verify();
