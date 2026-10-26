// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import tsParser from '@typescript-eslint/parser';

import {
  COMMENT_SWALLOW_FILES,
  COMMENT_SWALLOW_MESSAGE,
  COMMENT_SWALLOW_PATTERNS,
  QUERY_OPTIONS_ANY_MESSAGE,
  SLOT_LOOKUP_ANY_MESSAGE,
  VERIFY_STAND_IN_MESSAGE,
  commentSwallowPlugin,
  looksLikeSwallowedCode,
  queryOptionsPlugin,
  slotLookupPlugin,
  verifyStandInPlugin,
} from './packages/eslint-plugin/src/index.mjs';

// The rules live in packages/eslint-plugin; these names stay exported here for
// the ratchet scripts that import this config.
export {
  COMMENT_SWALLOW_FILES,
  COMMENT_SWALLOW_MESSAGE,
  COMMENT_SWALLOW_PATTERNS,
  QUERY_OPTIONS_ANY_MESSAGE,
  SLOT_LOOKUP_ANY_MESSAGE,
  VERIFY_STAND_IN_MESSAGE,
  looksLikeSwallowedCode,
};

// Flat ESLint config — guards against memory-bloating import patterns.
//
// Background: `export * as Namespace from './sub'` is NOT tree-shakeable in
// Node ESM. The 16 namespace re-exports previously in
// `packages/spec/src/index.ts` force-evaluated ~400 Zod schema closures on the
// first `import { Data } from '@objectstack/spec'`, ballooning RSS by ~1.2GB
// in `@objectstack/objectos`. Those root barrels are gone — this rule prevents
// them coming back via consumer imports.
//
// Wired into CI via the root `lint` script (.github/workflows/lint.yml).
// Run locally with `pnpm lint`. The script passes `--no-inline-config`:
// source files carry orphaned `eslint-disable` directives for a richer rule
// set this config does not register (a fuller setup was stripped to this
// import guard), and the flag ignores them so the guard runs clean. The only
// active rule (no-restricted-imports) should never need a local opt-out — it
// prevents a ~1.2GB RSS regression.
//
// Lint ONLY from the root. Per-package `lint` scripts (`eslint src`) were
// removed in #4276: a standalone run resolves this same config but honors the
// inline directives `--no-inline-config` exists to ignore, so it fails on
// rules this config never registers ("Definition for rule … was not found").
// Don't add such a script back — scope a local run from the root instead:
// `pnpm exec eslint --no-inline-config packages/verify/src`.
//
// ## Why the root `lint` script runs eslint through `node --stack-size=4000`
//
// `@typescript-eslint/parser` builds the ESTree AST by recursion, so the stack
// it needs is proportional to the AST's DEPTH — not to file size. One file in
// this repo sits past V8's default ceiling: `packages/spec/src/migrations/
// registry.ts`, whose `step17.rationale` is a single `+` concatenation of 970
// string fragments, giving an AST depth of 976. Measured on Node 22.22.2:
//
//   • that file needs a minimum `--stack-size` of 1085 KB to parse;
//   • V8's default main-thread stack is 984 KB.
//
// So it is already ~10% OVER budget: parsed on its own it fails every time.
//
// What makes it look "flaky" (#10030: success → failure → success on identical
// bytes) is that the verdict depends on the OTHER files in the same eslint
// invocation, not on this file. Measured here at the default stack, same bytes,
// same command: linting `packages/spec/src/migrations` (205 files) REDS with
// the parse error, while `packages/spec/src` (965 files) and `packages/spec`
// (1063 files) both go green with registry.ts reporting zero messages — it is
// linted in all three, and only the narrow scope crashes. So the trigger is a
// property of the run, not of the content, which is why a re-run re-rolls it
// and can lose twice. (Not JIT tiering, which was the obvious guess and is
// falsified: the minimum stack is 1085 KB warm and 1084 KB under `--no-opt`,
// so optimized and interpreted frames cost the same here.) The failure is
// `registry.ts  0:0  error  Parsing error: Maximum call stack size exceeded`,
// on PRs that never touched `packages/spec`, and `Lint & Repo Gates` is a
// REQUIRED context — so each strike is an unbounded hold on an innocent PR.
//
// Raising the parser's headroom changes NO rule and NO accept/reject semantics:
// it lets the parser finish where it currently crashes. It is the opposite of
// an `ignores` entry — the file is now actually linted for the first time.
//
// Why 4000 KB specifically, both bounds measured rather than guessed:
//   • need is 1085 KB, and each further `+ '…'` fragment appended to that
//     rationale costs ~1.10 KB, so 4000 KB absorbs ~2650 more fragments —
//     roughly 3.7x the current chain;
//   • the hard ceiling is the OS thread stack (`ulimit -s`, 8192 KB on
//     ubuntu-latest and locally). `--stack-size` at or above it makes V8 run
//     off the real stack and SIGSEGV instead of throwing: measured clean
//     `RangeError` up to 8000, `rc=139` at 8192 and above. 4000 keeps a 2x
//     margin under that.
//   • nothing else in the repo is close: across all 4659 linted files the
//     runner-up AST depth is 71 (`entries/semantic/18.driver-sql-unresolvable-
//     where-column-refused.ts`). Depth does not track size — the two largest
//     linted files, 236 KB and 183 KB, sit at depth 44 and 40.
//
// ⚠️ The flag CANNOT be moved to `NODE_OPTIONS`: Node rejects it outright
// (`--stack-size= is not allowed in NODE_OPTIONS`). It has to be an argv flag
// on the `node` process that runs eslint, which is why this script spells out
// `node_modules/eslint/bin/eslint.js` instead of the `eslint` bin shim — the
// shim is a shell script, so `node` cannot execute it. Keeping the flag in the
// root `lint` script (rather than in `.github/workflows/lint.yml`) is what
// keeps local and CI identical: the workflow step is `pnpm lint`.
//
// ⚠️ A local run scoped past this file — `pnpm exec eslint …` on a path that
// includes `packages/spec/src/migrations/` — bypasses this script and will
// still hit the ceiling. Prefix it with `node --stack-size=4000` the same way.
//
// The permanent fix is to stop building that string with a 970-deep `+` chain
// (a template literal or `.join('')` is depth ~4); it is a `packages/spec`
// content change and is tracked separately.

const SUBPATH_NAMES = [
  'Data', 'UI', 'System', 'AI', 'API', 'Automation',
  'Security', 'Kernel', 'Cloud', 'QA', 'Identity',
  'Integration', 'Contracts', 'Studio', 'Shared',
];

const SUBPATH_RULE_MESSAGE =
  'Use subpath imports: `import * as Data from "@objectstack/spec/data"` ' +
  'or `import { Field } from "@objectstack/spec/data"`. Root namespace ' +
  're-exports were removed because Node ESM cannot tree-shake them — see ' +
  'packages/spec/src/index.ts.';

// issue #2035 — the 16 writable domains that now have a `defineX` factory. In
// example/app metadata files these must be authored through the factory, never a
// bare `: DomainType` / `: DomainTypeInput` literal: the factory validates at
// `.parse()` time and is a *value* import that fails loudly on a broken import
// instead of silently degrading to `any` (the #2023 failure mode).
const DOMAIN_TYPES = [
  'Datasource', 'Connector', 'Policy', 'SharingRule', 'Position', 'PermissionSet',
  'EmailTemplateDefinition', 'Report', 'Webhook', 'ObjectExtension', 'Cube',
  'Mapping', 'Theme', 'TranslationBundle', 'Page', 'Action',
].flatMap((t) => [t, t + 'Input']).join('|');

const DOMAIN_RULE_MESSAGE =
  'Author this metadata through its defineX factory (e.g. `definePage({ ... })`) ' +
  'instead of a bare `: Type` literal. The factory validates at parse time and a ' +
  'broken value import fails loudly instead of degrading to `any` — see issue #2035.';

// The dispatcher's service-lookup methods whose result carries the slot's
// contract (#4127). `getObjectQL` is NOT here: it reaches ObjectQL's surface
// beyond IDataEngine (`registry`, `executeAction`), which has no contract, so
// its `any` is correct and permanent until someone writes one.
const SLOT_LOOKUPS = ['resolveService', 'getService', 'getRequestKernelService'].join('|');

// Slots with no written contract. A lookup naming one of these legitimately
// yields `any`, so the rule exempts it BY NAME rather than by an inline
// disable — this repo lints with `--no-inline-config`, which ignores
// eslint-disable comments on purpose: exceptions belong in one reviewable
// place, not sprinkled through the code. Deleting a name from this list is how
// the exemption ends once that contract gets written.
//
// Entries are spliced into a regex, so escape metacharacters if one returns.
//
// [#4251] `http.server` was here, on the stated ground that "no IHttpServer
// contract exists". That was FALSE when it was written: the contract is
// `packages/spec/src/contracts/http-server.ts`, and eight call sites were
// already resolving the slot as `getService<IHttpServer>(…)`. An exemption is a
// claim like any other, and this one rested on a premise nobody checked — the
// same shape as the gaps this rule exists to find. Revoked; the slot is
// accounted for like every other contracted slot.
const UNCONTRACTED_SLOTS = ['protocol', 'mcp', 'kernel-resolver', 'scope-manager'].join('|');

// [#4251] The sweep ratchet, read from `scripts/slot-lookup-baseline.json`.
//
// Those files hold pre-existing lookup-erasure sites — `getService<any>(…)`,
// `: any`, or `as any` — that predate the rule reaching them: the rule's scope
// was packages/runtime only until #4251 widened it, and the type-argument
// selector did not exist. 171 sites in 40 files at the widening; they are
// grandfathered BY FILE for the same reason UNCONTRACTED_SLOTS is central —
// `--no-inline-config` means the escape must live in config, and one shrinking
// list is the ratchet made visible. Batches remove entries as they sweep (see
// #4214 for the batch pattern and its yield — these sites are where the erased
// contracts live).
//
// The baseline is the SINGLE SOURCE: its keys are these ignores and its values
// are the per-file counts `pnpm check:slot-lookup` enforces. That coupling is
// the point (#4320 was found the same way — a promise nothing checked). A bare
// file list made three moves invisible: adding a file to silence lint, adding
// NEW violations to an already-listed file (they rode the entry silently), and
// clearing a file without dropping its entry (the list stops meaning anything).
// The counted baseline fails all three, and `--update` is the only way to move
// it — downward.
const SLOT_LOOKUP_UNSWEPT = Object.keys(JSON.parse(
  readFileSync(new URL('./scripts/slot-lookup-baseline.json', import.meta.url), 'utf8'),
));

// ---------------------------------------------------------------------------
// [#4918] Engine query-options `any`-erasure guard.
// The rule and its history: packages/eslint-plugin/src/query-options.mjs.

// Exported so `scripts/check-query-options-erasure-ratchet.mjs` measures the
// SAME surface this rule blocks. The ratchet lifts these to count the test-side
// residual; the rule itself never runs on them.
//
// The first cut is deliberately non-test only (the 08-03 triage on #4918). Test
// code holds the large majority of the erasures, and an unknown share of those
// are legitimate: a test whose SUBJECT is off-contract engine input (see
// `engine-unknown-option.test.ts`, `engine-wire-alias-reject.test.ts`) has to
// erase the type to construct input `tsc` would otherwise refuse. A blocking
// rule there would fight the tests that prove the contract is enforced, so the
// test surface is held by a COUNT instead — see the ratchet.
//
// ⚠️ #8210, stated honestly because it was previously assumed rather than
// measured: shrinking that count does not put every counted site behind a
// working guard. `QUERY_OPTIONS_ANY_MESSAGE` below is accurate for the sites
// this rule actually BLOCKS (non-test code, where `tsc` is the real, live
// channel), but roughly 60% of today's test-surface sites live in packages
// whose OWN `tsconfig.json` excludes `**/*.test.ts` — for those, typing the
// options removes an `any` that would blind an editor's language service (and
// is a precondition for the day the exclusion lifts), but neither `tsc` nor
// this repo's ESLint config catches a wrong key there today: this repo runs
// one `eslint.config.mjs`, which never enables type-aware linting
// (no `parserOptions.project`, no typed `@typescript-eslint` rules) for ANY
// file, test or not. Measured with a positive control (a typed, wrong-keyed
// `EngineAggregateOptions` planted in an excluded `objectql` test file: both
// `pnpm --filter @objectstack/objectql typecheck` and `pnpm exec eslint
// --no-inline-config` on that file stayed silent) and cross-checked against
// PR #8406, where the identical shape independently surfaced in
// `packages/lint` on the same day. See the measurement and the file/package
// split in `scripts/check-query-options-erasure-ratchet.mjs`'s header.
export const QUERY_OPTIONS_TEST_GLOBS = [
  '**/*.test.{ts,tsx,mts,cts}',
  '**/*.spec.{ts,tsx,mts,cts}',
];

// The rule's own id, exported so the ratchet identifies this rule's reports
// exactly rather than by message text. (The slot-lookup ratchet matches on
// message because that rule shares `no-restricted-syntax` with three others;
// this one is a dedicated rule, so the id is available and is stricter.)
export const QUERY_OPTIONS_RULE_ID = 'query-options/no-any-erasure';

// [#4918] The unswept residual, grandfathered BY FILE from
// `scripts/query-options-erasure-baseline.json` — same mechanism, and same
// reasoning, as SLOT_LOOKUP_UNSWEPT above: `pnpm lint` runs with
// `--no-inline-config`, so the escape has to live in config, and one shrinking
// counted list is the ratchet made visible. An `ignores` entry silences the
// WHOLE file, which is exactly why the baseline carries per-file COUNTS and
// `pnpm check:query-options-erasure` enforces them.
//
// ⛔ Do NOT sweep these sites in the same PR that touches this rule. Part of the
// residual is a real type boundary (`hookContext.input.options`, the metadata
// loader's `Record<string, unknown>` query bag) and needs the boundary type
// written, not the assertion deleted — a separate batch.
const QUERY_OPTIONS_UNSWEPT = Object.keys(JSON.parse(
  readFileSync(new URL('./scripts/query-options-erasure-baseline.json', import.meta.url), 'utf8'),
).nonTest);

// ---------------------------------------------------------------------------
// [#6399] `@objectstack/verify` structural stand-in erasure guard.
// The rule and its history: packages/eslint-plugin/src/verify-stand-in.mjs.
//
// The guarded set is reconciled against `packages/verify/src` in BOTH
// directions by `pnpm check:verify-stand-in`, so a third stand-in check cannot
// arrive unguarded and a renamed helper cannot leave this rule silently
// matching nothing. A guard whose covered set is a hand-list nobody re-checks
// is the dead-pin shape (#4984 / #5018), and this one is not allowed to become
// it.
export const VERIFY_STAND_IN_CHECKS = {
  checkReadCoercion: 'CoercibleDriver',
  checkDateBucketParity: 'BucketableDriver',
};

// The rule's own id, exported so `check:verify-stand-in` identifies this rule's
// reports exactly rather than by message text — same reasoning as
// QUERY_OPTIONS_RULE_ID.
export const VERIFY_STAND_IN_RULE_ID = 'verify-stand-in/no-asserted-driver-argument';

// ---------------------------------------------------------------------------
// issue #9758 — a statement swallowed by an unterminated block comment.
// ---------------------------------------------------------------------------
// The rule and its history: packages/eslint-plugin/src/comment-swallow.mjs.
/** The rule's own id, exported for the same reason as the two ids above. */
export const COMMENT_SWALLOW_RULE_ID = 'comment-swallow/no-code-inside-block-comment';

// ───────────────────────────────────────────────────────────────────────────
// The trees nothing in this repo ever lints: installed dependencies and build
// output. Named ONCE and spread into the global ignore below AND into every
// per-object `ignores` beside it, so "no config object can match build output"
// is a property of this one array instead of seven lists that happen to agree.
//
// They did not agree. Four of the seven `files` objects below omitted
// `**/build/**`, `**/.next/**` and `**/.turbo/**`, so TypeScript under those
// directories resolved to three ENABLED rules while the same generated file
// under `dist/` resolved to none — the incidental-neutrality the levelling in
// #12334 replaced.
//
// ⚠️ The global object alone already keeps these paths out of the linted
// population, so the per-object copies change no behaviour today. They are not
// redundancy: they are what makes the invariant survive a future edit to the
// global object by someone who has never read this history — which is exactly
// how a rule came to be enabled on generated code in the first place.
// ───────────────────────────────────────────────────────────────────────────
const NEVER_LINTED = Object.freeze([
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.turbo/**',
]);

// ───────────────────────────────────────────────────────────────────────────
// Source trees linted by THEIR OWN flat config, not by this one. Global-only:
// unlike NEVER_LINTED this is authored source, so it is not spread into the
// per-object `ignores` below — the one global object removes it from this
// config's population, and nothing here may ever start matching it by accident
// of a `files` glob.
//
// `ui/**` is the objectui tree imported at the cutover (decision G1 on #25752,
// verbatim 「17e · 17f · 17g · 同意」): `ui/eslint.config.js` lints it, the
// `Lint UI` CI job runs that config, and the two configs converge in the
// aftercare card #25753. Census of what this one line stops, measured over the
// merged tree on the verify branch (9e37acd126, `pnpm lint` exactly as
// package.json spells it): 121 errors and 16,511 warnings, every one of them
// under `ui/**` (dominant rule `react-hooks/static-components`, then
// `react-hooks/purity`, `no-restricted-imports`,
// `@typescript-eslint/no-empty-object-type`, `no-console`). Outside `ui/` the
// population this config lints is byte-for-byte the pre-import one, so its
// verdict there does not move. Delete the entry in the PR that adopts this
// config across `ui/` — never by widening a per-object `ignores` instead.
// ───────────────────────────────────────────────────────────────────────────
const LINTED_BY_OWN_CONFIG = Object.freeze([
  'ui/**',
]);

export default [
  // ───────────────────────────────────────────────────────────────────────────
  // GLOBAL ignore. This is the ONLY object in this array with no `files` key,
  // and that absence is the whole point: a flat-config `ignores` that sits
  // BESIDE a `files` key is object-scoped — it stops that one object from
  // applying and does NOT remove the path from the linted population. All
  // seven objects below carry `files`, so before this object existed the build
  // output they each list was still enumerated and parsed. ESLint lints
  // `.js`/`.mjs`/`.cjs` under its built-in defaults even when no object here
  // matches, so every emitted bundle was parsed to produce a guaranteed-empty
  // result.
  //
  // Measured on this tree (ESLint v10.8.1, Node 22.22.2), 50 files per
  // extension dropped under `packages/core/dist/`:
  //
  //   before   dist/*.js + dist/*.mjs  → LINTED, 0 rules enabled, parser espree
  //            dist/*.ts + dist/*.d.ts → not linted at all (`--print-config`
  //                                      returns `undefined`: no object matches,
  //                                      and ESLint does not lint `.ts` by default)
  //   after    none of the four present in the population
  //
  // So the accept/reject semantics of `**/dist/**` do not move: nothing there
  // had a rule enabled to lose. The saving is pure enumeration + parse.
  //
  // ⚠️ THE OTHER THREE PATTERNS ARE A NAMED CORRECTION, NOT A NEUTRAL ONE.
  // `**/build/**`, `**/.next/**` and `**/.turbo/**` join this object under a
  // maintainer ruling (2026-08-26, option C on #12334, verbatim 「同意」).
  // Three rules are enabled on TypeScript under those directories today, and
  // promoting the patterns DELIBERATELY TURNS THEM OFF on build output:
  //
  //   packages/core/build/x.ts   before → LINTED, 3 rules ENABLED
  //     (slot-lookup/no-any-assignment, no-restricted-syntax,
  //      query-options/no-any-erasure), parser @typescript-eslint/parser
  //                              after  → no config object matches: not linted
  //
  // Recorded in those words rather than under a "changes nothing" banner,
  // because switching a rule off on generated code and switching it off on
  // source are the same line in a diff. It repairs this config's own stated
  // intent — never lint build output: nobody authors the code under those
  // directories, and linting generated code is the defect being removed, not
  // coverage being cut.
  //
  // `**/.next/**` is LIVE, not latent (measured 2026-08-25 on #12334):
  // `apps/docs/.next` is 3.9 GB after `pnpm --filter @objectstack/docs build`,
  // and linting it is a hard OOM — `exit 134`, "Ineffective mark-compacts near
  // heap limit", 66 s, no eslint output — which reads as a crashed gate rather
  // than as 3.9 GB of chunks being parsed. A tracked-file census cannot see it:
  // `.next` is untracked output, and `git ls-files` matches 0 files under any
  // of the five patterns (control: 4,776 under `/src/`). `build/` and
  // `.turbo/` stay latent on that census; the levelling below is what stops
  // either of them becoming the next `.next`. See #12334 / #12304.
  // ───────────────────────────────────────────────────────────────────────────
  {
    ignores: [...NEVER_LINTED, ...LINTED_BY_OWN_CONFIG],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    ignores: [
      ...NEVER_LINTED,
      'packages/spec/**',
      // CLI/scaffold templates contain `@objectstack/spec` strings that are
      // emitted to user projects, not actual imports in this repo.
      'packages/cli/src/commands/init.ts',
      'packages/cli/src/commands/generate.ts',
      'packages/cli/src/commands/create.ts',
      'packages/create-objectstack/src/index.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@objectstack/spec',
          importNames: SUBPATH_NAMES,
          message: SUBPATH_RULE_MESSAGE,
        }],
      }],
    },
  },
  // Machine output must not be written with `console.log`.
  //
  // `console.log(big)` followed by an exit hands a PIPE reader a payload cut
  // off at one 64 KiB buffer: Node writes stdout asynchronously to a pipe and
  // the exit tears the process down mid-drain. `os lint … --json` shipped that
  // for months at exactly 65536 bytes, and it is invisible to whoever writes
  // it — stdout to a TTY is synchronous, so every interactive run looks right
  // while every scripted consumer, the only audience `--json` has, gets
  // invalid JSON. The exit need not be explicit: oclif ends failing commands
  // with `handle()` → `Exit.exit()` → `process.exit()` and flushes nothing on
  // that path, so a plain `this.exit(1)` truncates the same way.
  //
  // `emitJson` / `emitText` (packages/cli/src/utils/format.ts) await the write
  // callback first. The whole CLI was swept onto them; this keeps the pattern
  // from growing back one command at a time. Note the root lint script runs
  // with `--no-inline-config`, so there is no per-site opt-out — which is the
  // point: every past instance of this was written by someone who had no
  // reason to suspect it.
  {
    files: ['packages/cli/src/**/*.{ts,tsx,mts,cts}'],
    ignores: [...NEVER_LINTED, '**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name='log']" +
            " > CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
          message:
            'Write machine output with `await emitJson(payload)` from utils/format.js, not ' +
            'console.log(JSON.stringify(…)). On a pipe, console.log followed by an exit ' +
            '(including oclif\'s this.exit / any thrown error) truncates the payload at 64 KiB. ' +
            'Pass `{ compact: true }` as the third argument to keep single-line output.',
        },
        {
          // `formatOutput` became async for the same reason — its json and yaml
          // branches go through emitText. An un-awaited call at statement
          // position silently reopens the hole. (An awaited one nests under an
          // AwaitExpression and does not match.)
          selector: "ExpressionStatement > CallExpression[callee.name='formatOutput']",
          message:
            '`formatOutput` is async — await it. Its json/yaml branches drain stdout before ' +
            'the command can exit; dropping the await reintroduces the 64 KiB pipe truncation.',
        },
      ],
    },
  },
  // issue #2035 — authoring-entry guard. Flags exported consts in metadata
  // files that are annotated with a spec domain type (simple `Page` or qualified
  // `UI.Page`) instead of being wrapped in the `defineX` factory. AST-only (no
  // type info): matches the declaration shape, not local vars or function params.
  // Scoped to the authoring surfaces — the example corpus AI learns from and the
  // platform's own apps. NOT downstream-contract: its bare literals are a frozen
  // backward-compat fixture (#2089) and are intentional.
  {
    files: ['examples/**/*.{ts,tsx,mts,cts}', 'packages/apps/**/*.{ts,tsx,mts,cts}'],
    ignores: [...NEVER_LINTED, 'packages/qa/downstream-contract/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: `ExportNamedDeclaration VariableDeclarator[id.typeAnnotation.typeAnnotation.typeName.name=/^(${DOMAIN_TYPES})$/]`,
          message: DOMAIN_RULE_MESSAGE,
        },
        {
          selector: `ExportNamedDeclaration VariableDeclarator[id.typeAnnotation.typeAnnotation.typeName.right.name=/^(${DOMAIN_TYPES})$/]`,
          message: DOMAIN_RULE_MESSAGE,
        },
      ],
    },
  },
  // issue #4127 — service-lookup `any` guard. #4168/#4176/#4202 made a slot
  // lookup return the slot's contract, so a domain calling a method nobody
  // declares is a compile error. An `any` annotation on the RESULT silently
  // switches that back off for that call site: nothing fails, no test breaks,
  // and the code looks exactly like the checked kind. Three such sites already
  // existed and were found by grep, which is the sweep this work replaced —
  // #4087 shipped for months because a sweep is not repeatable.
  //
  // The `any` is not always wrong, so the exemptions are declared above —
  // by SLOT NAME, and centrally. That is deliberate: `pnpm lint` runs with
  // `--no-inline-config`, so an `eslint-disable` comment would be ignored and
  // the escape has to live in config anyway. The effect is the one worth
  // having — a deliberate gap is a reviewed line in this file, a careless one
  // is a build failure, and the two stop looking identical in the code.
  //
  // [#4251] Scope is all of packages/ — the rule shipped scoped to
  // packages/runtime while the composition roots (rest, plugins/*, services/*)
  // held 77 of the 80 known sites, an unlinted majority that looked covered.
  // Per-package curation would recreate that gap one package at a time, so the
  // scope is total and the not-yet-swept files are grandfathered individually
  // in the counted baseline above — a shrinking list under `check:slot-lookup`,
  // not a silent boundary.
  //
  // KNOWN RESIDUAL: a wrapper whose own return type is annotated
  // (`const getEngine = async (): Promise<any> => …resolveService(…)`) erases
  // the slot type just as effectively, and this selector cannot see it — the
  // annotation is on the enclosing function, not on the call. One such site
  // existed (share-links `getEngine`, fixed in batch 4). Catching that shape
  // needs type information, so it belongs to a typed-lint pass, not here.
  {
    files: ['packages/**/*.{ts,tsx,mts,cts}'],
    ignores: [...NEVER_LINTED, ...SLOT_LOOKUP_UNSWEPT],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { 'slot-lookup': slotLookupPlugin },
    rules: {
      // The split-declaration form (#4251) — see `slotLookupPlugin`. Reports the
      // SAME message as the three selectors below, so `check:slot-lookup` counts
      // all four shapes without knowing there are four.
      'slot-lookup/no-any-assignment': ['error', {
        lookups: SLOT_LOOKUPS.split('|'),
        uncontracted: UNCONTRACTED_SLOTS.split('|'),
      }],
      'no-restricted-syntax': ['error',
        {
          // `const svc: any = await deps.resolveService('auth', env)`
          selector:
            'VariableDeclarator[id.typeAnnotation.typeAnnotation.type="TSAnyKeyword"]' +
            `:has(CallExpression[callee.property.name=/^(${SLOT_LOOKUPS})$/]` +
            `:not(:has(Literal[value=/^(${UNCONTRACTED_SLOTS})$/])))`,
          message: SLOT_LOOKUP_ANY_MESSAGE,
        },
        {
          // `await deps.resolveService('security', env) as any`
          selector:
            'TSAsExpression[typeAnnotation.type="TSAnyKeyword"]' +
            `:has(CallExpression[callee.property.name=/^(${SLOT_LOOKUPS})$/]` +
            `:not(:has(Literal[value=/^(${UNCONTRACTED_SLOTS})$/])))`,
          message: SLOT_LOOKUP_ANY_MESSAGE,
        },
        {
          // `ctx.getService<any>('data')` — the type-argument form (#4251).
          // No annotation, no `as`, and the contract is erased all the same;
          // this is the shape 80 sites actually used while the two selectors
          // above matched zero of them.
          selector:
            `CallExpression[callee.property.name=/^(${SLOT_LOOKUPS})$/]` +
            '[typeArguments.params.0.type="TSAnyKeyword"]' +
            `:not(:has(Literal[value=/^(${UNCONTRACTED_SLOTS})$/]))`,
          message: SLOT_LOOKUP_ANY_MESSAGE,
        },
      ],
    },
  },
  // issue #4918 — engine query-options `any`-erasure guard. Rationale and the
  // #4674 cost are on `QUERY_OPTIONS_ANY_MESSAGE` above.
  {
    files: ['packages/**/*.{ts,tsx,mts,cts}'],
    ignores: [
      ...NEVER_LINTED,
      // First cut is non-test code (08-03 triage). The ratchet lifts this and
      // holds the test residual to a count instead.
      ...QUERY_OPTIONS_TEST_GLOBS,
      // Pre-existing sites, grandfathered by file and counted — see
      // QUERY_OPTIONS_UNSWEPT and `pnpm check:query-options-erasure`.
      ...QUERY_OPTIONS_UNSWEPT,
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { 'query-options': queryOptionsPlugin },
    rules: { 'query-options/no-any-erasure': 'error' },
  },
  // issue #6399 — @objectstack/verify stand-in erasure guard. Rationale and the
  // #6354 / PR #6396 measurement are on `VERIFY_STAND_IN_MESSAGE` above.
  //
  // No `ignores` beyond the build dirs and NO baseline, which is the whole
  // reason this is its own rule rather than a widening of one of the two above:
  // the tree is clean TODAY (all ten casts removed by PR #6396), so the guard
  // starts at zero and every future violation is a new one. Both siblings had
  // to grandfather hundreds of pre-existing sites; there is nothing here to
  // grandfather, and adding one later would mean the state stopped being locked.
  //
  // Scope is unrestricted on purpose. The four files holding call sites today
  // are `packages/qa/dogfood/test/` and `packages/drivers/driver-turso/src/`,
  // but `@objectstack/verify` is a PUBLISHED helper whose whole point is being
  // callable from anywhere — a package-scoped rule would go quiet exactly when
  // the eleventh call site lands somewhere new, which is the case this issue
  // exists to cover.
  //
  // ⚠️ Test files are IN scope here, unlike the query-options rule. That rule
  // lifts them because a test may legitimately need off-contract engine input;
  // this argument has no legitimate off-contract form (see the message), and
  // six of the ten historical casts were in test files passing hand-written
  // fakes — the arm the guard is worth the most on.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    ignores: [...NEVER_LINTED],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { 'verify-stand-in': verifyStandInPlugin },
    rules: {
      'verify-stand-in/no-asserted-driver-argument': ['error', {
        checks: Object.keys(VERIFY_STAND_IN_CHECKS),
      }],
    },
  },
  // issue #9758 — a statement swallowed by an unterminated block comment. The
  // rationale, the re-derived base rate and the false-positive bound are all on
  // `COMMENT_SWALLOW_MESSAGE` above.
  //
  // ⚠️ `COMMENT_SWALLOW_FILES` is wider than the `verify-stand-in` block's
  // pattern directly above: it carries `js`/`jsx`/`mjs`/`cjs`, because the one
  // instance this class has ever had was a `.mjs` file under `scripts/`.
  // Copying the sibling's `{ts,tsx,mts,cts}` scope here would produce a guard
  // that covers 4,326 package files and not the one kind of file the defect has
  // actually occurred in. The plugin's tests refuse that narrowing.
  //
  // No baseline and no `ignores` beyond the build directories, for the same
  // reason `verify-stand-in` has none: the tree measures 0 today (261,536
  // candidate lines, 4,679 files), so there is nothing to grandfather and every
  // future report is a new defect. Adding an entry later would mean the state
  // stopped being locked.
  {
    files: COMMENT_SWALLOW_FILES,
    ignores: [...NEVER_LINTED],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { 'comment-swallow': commentSwallowPlugin },
    rules: { 'comment-swallow/no-code-inside-block-comment': 'error' },
  },
];
