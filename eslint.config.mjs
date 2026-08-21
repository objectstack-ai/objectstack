// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import tsParser from '@typescript-eslint/parser';

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

// Exported so `scripts/check-slot-lookup-ratchet.mjs` can identify THIS rule's
// reports among the other `no-restricted-syntax` rules, by exact message —
// the counter and the rule must never be able to disagree about what counts.
export const SLOT_LOOKUP_ANY_MESSAGE =
  'Do not erase a service-lookup result to `any` (`: any`, `as any`, or a ' +
  '`getService<any>(…)` type argument) — the lookup already returns the slot\'s ' +
  'contract (#4168/#4176/#4202), and this switches that checking off ' +
  'for the call site while looking identical to code that has it. Every such ' +
  'annotation found so far was hiding a real gap, including a project-membership ' +
  'gate that silently stopped gating and two datasource-registration branches ' +
  'probing a method no metadata service has (#4251). Pass the slot\'s contract ' +
  'type instead (`getService<IDataEngine>(\'data\')`). If the slot genuinely has ' +
  'no contract, add its name to UNCONTRACTED_SLOTS in eslint.config.mjs with a ' +
  'note, so the exemption is reviewed once and visible in one place — see ' +
  'issues #4127 and #4251.';

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

// [#4251] The FOURTH erasure shape: the declaration and the lookup split apart.
//
//   let ql: any;
//   try { ql = ctx.getService('objectql'); } catch { /* optional */ }
//
// The contract is erased exactly as in `const ql: any = ctx.getService(…)`, and
// all three selectors below miss it: selector 1 needs the call inside the
// declarator (here the declarator has no init), selector 2 needs `as`, selector
// 3 needs a type argument. 23 sites repo-wide used it, 12 of them in files no
// longer grandfathered — i.e. lint covered them and said nothing. Worse, that
// number GREW with every batch: sweeping a file removes it from the baseline,
// and the baseline's monotonicity check means it can never be re-added, so each
// batch converted more of this shape from "grandfathered" into "silently clean".
// A ratchet that looks cleaner the more you use it is the #4342 failure again.
//
// This is a RULE and not a fourth selector because esquery cannot do it. A
// selector can match `AssignmentExpression:has(CallExpression[…])`, but it
// cannot tell which declaration the assigned identifier resolves to — so it
// would equally flag the correctly-typed form this whole work line is trying to
// produce (`let i18nService: II18nService | undefined; i18nService = …`, 8 such
// sites today, in runtime/app-plugin.ts and service-automation among others).
// Resolving the identifier to its declaration needs SCOPE analysis, which is
// cheap and needs no type information — so this stays out of the typed-lint
// pass that the KNOWN RESIDUAL below still waits on.
const slotLookupPlugin = {
  rules: {
    'no-any-assignment': {
      meta: {
        type: 'problem',
        docs: { description: 'Ban assigning a service-lookup result to an `any`-declared variable.' },
        schema: [],
        messages: { erased: SLOT_LOOKUP_ANY_MESSAGE },
      },
      create(context) {
        const lookupNames = new Set(SLOT_LOOKUPS.split('|'));
        const uncontracted = new RegExp(`^(${UNCONTRACTED_SLOTS})$`);

        /** The slot-lookup call inside `node`, or null. Mirrors the selectors' `:has`. */
        const findLookupCall = (node) => {
          let found = null;
          const walk = (n) => {
            if (found || !n || typeof n.type !== 'string') return;
            if (
              n.type === 'CallExpression' &&
              n.callee?.type === 'MemberExpression' &&
              lookupNames.has(n.callee.property?.name)
            ) {
              // Same exemption channel as the selectors: the slot name is read
              // off a literal argument, so an UNCONTRACTED_SLOTS lookup is
              // legitimately `any` and must not be reported.
              const exempt = n.arguments.some(
                (a) => a?.type === 'Literal' && uncontracted.test(String(a.value)),
              );
              if (!exempt) { found = n; return; }
            }
            for (const key of Object.keys(n)) {
              if (key === 'parent') continue;
              const child = n[key];
              if (Array.isArray(child)) child.forEach(walk);
              else if (child && typeof child.type === 'string') walk(child);
            }
          };
          walk(node);
          return found;
        };

        /** True when `name` resolves, in scope, to a variable declared `: any`. */
        const declaredAny = (name, node) => {
          let scope = context.sourceCode.getScope(node);
          for (; scope; scope = scope.upper) {
            const variable = scope.variables.find((v) => v.name === name);
            if (!variable) continue;
            return variable.defs.some(
              (d) => d.node?.id?.typeAnnotation?.typeAnnotation?.type === 'TSAnyKeyword',
            );
          }
          return false;
        };

        return {
          AssignmentExpression(node) {
            if (node.left.type !== 'Identifier') return;
            if (!findLookupCall(node.right)) return;
            if (!declaredAny(node.left.name, node)) return;
            context.report({ node, messageId: 'erased' });
          },
        };
      },
    },
  },
};

// ---------------------------------------------------------------------------
// [#4918] Engine query-options `any`-erasure guard.
//
// The same failure as the slot-lookup rule above, one layer further in: the
// contract exists, `tsc` is willing to enforce it, and one annotation switches
// that off for the call site while looking identical to code that has it.
//
// `IDataEngine.find/findOne/count/aggregate` declare their options as
// `EngineQueryOptions` / `EngineCountOptions` / `EngineAggregateOptions`
// (`packages/spec/src/contracts/data-engine.ts`), and `IDataDriver` declares the
// same slots as `QueryAST` + `DriverOptions`. For an INTERNAL caller `tsc` is
// the ONLY enforced channel on that path: the protocol's ingress normalizer does
// not run on calls the protocol itself makes to `this.engine.find`, and the
// options schemas are not `.strict()`, so an unknown key is silently DROPPED
// rather than rejected. Erase the type and a wrong key becomes a no-op that
// nothing anywhere reports.
//
// #4674 is the bill: two internal queries spelled their sort
// `{ field, direction: 'desc' }` — `IReportService`'s vocabulary — where the
// QueryAST shape is `SortNodeSchema` = `{ field, order }`. Both drivers
// normalize off `.order` with no fallback, so both queries ran ASCENDING, and
// because both carried a `limit` the wrong direction changed WHICH ROWS came
// back: metadata audit history returned the oldest events (never an object's
// recent changes) and global search returned the stalest matches. `#4720`
// restored those two sites, `#4721` closed the external (REST/RPC) callers with
// a strict schema plus an ingress normalizer, and this rule is the third leg —
// it stops the erasure regrowing on the internal side.
const ENGINE_QUERY_READ_METHODS = ['find', 'findOne', 'count', 'aggregate'];

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

export const QUERY_OPTIONS_ANY_MESSAGE =
  'Do not erase an engine query-options value to `any` — not as `find(obj, { … } ' +
  'as any)`, not as an `orderBy: … as any`, and not as a `const opts: any` that is ' +
  'then passed as the options argument. `EngineQueryOptions` (and `QueryAST` on the ' +
  'driver side) already declare every key these methods read, and for an internal ' +
  'caller `tsc` is the ONLY channel that enforces them: the protocol\'s ingress ' +
  'normalizer does not run on a direct engine call, and the options schemas are not ' +
  '`.strict()`, so an unknown key is silently DROPPED, never rejected. That is #4674 ' +
  '— two queries sorted by `direction` (IReportService\'s vocabulary) instead of ' +
  '`order` (SortNodeSchema\'s), both with a `limit`, so both quietly returned the ' +
  'OLDEST rows: audit history that never showed an object\'s recent changes, and a ' +
  'global search that truncated away the freshly-edited records. The declared type ' +
  'would have rejected `direction` at the call site; the erasure is the only reason ' +
  'it compiled. Type the value instead (`const opts: EngineQueryOptions = { … }`, or ' +
  'just drop the assertion — these signatures already infer). If the value is ' +
  'DELIBERATELY off-contract — a test asserting the engine REJECTS an unknown option ' +
  '— write `as unknown as EngineQueryOptions`: that names the contract being ' +
  'bypassed, keeps the rest of the call type-checked, and greps as an intentional ' +
  'act, none of which a bare `as any` does. See issues #4674, #4720, #4721, #4918.';

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

const queryOptionsPlugin = {
  rules: {
    'no-any-erasure': {
      meta: {
        type: 'problem',
        docs: { description: 'Ban erasing an engine query-options value to `any`.' },
        schema: [],
        messages: { erased: QUERY_OPTIONS_ANY_MESSAGE },
      },
      create(context) {
        const methods = new Set(ENGINE_QUERY_READ_METHODS);

        /**
         * True when `node` is, or wraps, an `any` assertion.
         *
         * Walks the whole assertion chain rather than testing the outermost
         * node, so `{ … } as any as EngineQueryOptions` is caught too: that
         * spelling checks the literal against nothing and then re-labels the
         * result with the contract, which erases the keys exactly as `as any`
         * does while reading as if it were typed. `as unknown as X` is NOT
         * matched, on purpose — see the message.
         */
        const erasesToAny = (node) => {
          for (let cur = node; cur; cur = cur.expression) {
            if (cur.type === 'TSAsExpression' || cur.type === 'TSTypeAssertion') {
              if (cur.typeAnnotation?.type === 'TSAnyKeyword') return true;
              continue;
            }
            if (cur.type === 'TSNonNullExpression') continue;
            return false;
          }
          return false;
        };

        /**
         * True when `name` resolves, in scope, to a local VARIABLE declared
         * `: any` — the split form (`const opts: any = { … }` … `find(o, opts)`)
         * that #4674's global-search site actually used.
         *
         * Scope analysis, not a name heuristic: a rule keyed on the identifier's
         * spelling would flag every `const options: any` in the repo whether or
         * not it ever reaches a query, and miss the ones spelled anything else.
         * Deliberately restricted to variable declarations — an `: any`
         * PARAMETER forwarded into a query is a different (and much larger,
         * mostly test-double) population, out of this cut's scope.
         */
        const declaredAnyVariable = (name, node) => {
          for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
            const variable = scope.variables.find((v) => v.name === name);
            if (!variable) continue;
            return variable.defs.some(
              (d) =>
                d.node?.type === 'VariableDeclarator' &&
                d.node.id?.typeAnnotation?.typeAnnotation?.type === 'TSAnyKeyword',
            );
          }
          return false;
        };

        return {
          CallExpression(node) {
            if (node.callee?.type !== 'MemberExpression') return;
            const property = node.callee.property;
            if (property?.type !== 'Identifier' || !methods.has(property.name)) return;

            node.arguments.forEach((argument, index) => {
              // Argument 0 is the object/table NAME on every one of these
              // signatures; the options bags are 1 (the query) and 2
              // (`BaseEngineOptions` / `DriverOptions`). Starting at 1 is also
              // what keeps `Array.prototype.find(cb)` — same method name,
              // callback at index 0 — out of the rule entirely.
              if (index < 1 || !argument) return;
              if (erasesToAny(argument)) {
                context.report({ node: argument, messageId: 'erased' });
                return;
              }
              if (argument.type === 'Identifier' && declaredAnyVariable(argument.name, node)) {
                context.report({ node: argument, messageId: 'erased' });
              }
            });
          },

          // `orderBy` is scoped in by name because it is the key #4674 was
          // actually wrong about, and it is erased one level below the argument
          // — `...(ast.orderBy ? { orderBy: ast.orderBy as any } : {})` sits
          // inside an otherwise-typed options literal, so the argument-position
          // check above cannot see it. `SortNodeSchema` is the shape everywhere
          // this key appears.
          Property(node) {
            if (node.computed) return;
            const key = node.key;
            const isOrderBy =
              (key?.type === 'Identifier' && key.name === 'orderBy') ||
              (key?.type === 'Literal' && key.value === 'orderBy');
            if (!isOrderBy) return;
            if (erasesToAny(node.value)) {
              context.report({ node: node.value, messageId: 'erased' });
            }
          },
        };
      },
    },
  },
};

// ---------------------------------------------------------------------------
// [#6399] `@objectstack/verify` structural stand-in erasure guard.
//
// The third member of the family above, and the narrowest. `checkReadCoercion`
// and `checkDateBucketParity` take their driver STRUCTURALLY — `CoercibleDriver`
// / `BucketableDriver` — so an out-of-tree driver (cloud's `driver-turso` in
// remote mode) can run the identical contract without importing a concrete
// driver type. That parameter type is not decoration around the check: for the
// compile-time half of the conformance it IS the check. Assert the argument and
// the stand-in stops standing for anything, at that call site, while the code
// reads exactly like the checked kind.
//
// #6354/PR #6396 is the bill: TEN `as never` casts — every call site of both
// helpers — had switched that half off, long enough that nobody remembered
// writing them. They were provably dead (removing all ten left three packages'
// typecheck at exit=0) and the compile-time check they had been hiding is
// provably live (adding a member no real driver can have turned all ten sites
// red, 8+2 matching the cast count exactly). Nothing rang for either fact.
//
// ⚠️ The cost is highest on the FAKE-driver side. Six of the ten sites pass a
// hand-written literal; four pass a real driver. A real driver comes from
// production code and mostly satisfies the stand-in whether or not anyone
// checks — a hand-written fake is precisely the thing that drifts, and it is
// the arm an assertion silences most cheaply.
//
// Scope is argument 0 — the driver — and nothing else. The options bag is a
// different type with its own `unknown` slots, and an assertion there is
// #6394's subject, not this rule's.
//
// WHY A DEDICATED RULE, not a widened `check:query-options-erasure`: measured,
// that ratchet cannot reach these sites at all. `query-options/no-any-erasure`
// keys on a MEMBER-expression callee named `find|findOne|count|aggregate` and
// only inspects arguments at index >= 1; every site here is a bare-identifier
// callee with the driver at index 0. Teaching it the word `never` would have
// matched zero of the ten while pulling several hundred unrelated `as never`
// sites into its baseline and blurring what "query/options type erasure" means.
//
// WHY NOT a blanket ban on `as never` at call arguments in tests: 550 of the
// repo's 703 `as never` assertions sit at a call-argument position, 536 of them
// in test files across 33 packages, and the large majority are legitimate —
// a negative test constructing input `tsc` is supposed to refuse. That is the
// same trade-off QUERY_OPTIONS_TEST_GLOBS already resolved the same way: a
// blocking rule there fights the tests that prove the contract is enforced.
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

export const VERIFY_STAND_IN_MESSAGE =
  'Do not type-assert the driver argument of a @objectstack/verify conformance check. ' +
  '`checkReadCoercion(driver)` / `checkDateBucketParity(driver)` declare that parameter as a ' +
  'structural stand-in (`CoercibleDriver` / `BucketableDriver`) so any driver — including an ' +
  'out-of-tree one — can run the identical contract; that declaration is the compile-time half ' +
  'of the conformance, and an assertion on the argument deletes it for this call site while ' +
  'looking identical to a call that has it. Ten such casts (`as never`, every call site of both ' +
  'helpers) lived in this repo long enough that nobody remembered writing them — all ten dead, ' +
  'and the check underneath them alive (#6354 / PR #6396). Six of the ten passed a HAND-WRITTEN ' +
  'fake driver, which is the arm that actually drifts. Pass the driver unasserted. If it does ' +
  'not satisfy the stand-in, that is the finding — fix the driver or widen the stand-in ' +
  'deliberately, in `packages/verify/src`, where the change is reviewed once instead of ' +
  'silenced per call site. See issues #6354, #6394 and #6399.';

const verifyStandInPlugin = {
  rules: {
    'no-asserted-driver-argument': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Ban type-asserting the driver argument of a @objectstack/verify structural conformance check.',
        },
        schema: [],
        messages: { erased: VERIFY_STAND_IN_MESSAGE },
      },
      create(context) {
        const guarded = new Set(Object.keys(VERIFY_STAND_IN_CHECKS));

        /**
         * True when `node` is, or wraps, ANY type assertion.
         *
         * Deliberately wider than `erasesToAny` above: on this argument there is
         * no assertion worth allowing. `as unknown as BucketableDriver` is the
         * sanctioned escape for engine query OPTIONS because a test may need
         * off-contract input on purpose; here the parameter type is the contract
         * UNDER TEST, so re-labelling the argument with it asserts exactly the
         * thing the call was supposed to prove. Every one of the ten historical
         * casts would be re-admitted by an `any`-only test.
         */
        const isAsserted = (node) => {
          for (let cur = node; cur; cur = cur.expression) {
            if (cur.type === 'TSAsExpression' || cur.type === 'TSTypeAssertion') return true;
            if (cur.type === 'TSNonNullExpression') continue;
            return false;
          }
          return false;
        };

        /**
         * True when `name` resolves, in scope, to a variable declared `: any` or
         * `: never` — the split form (`const d: any = brokenDriver(); check(d)`),
         * which erases the stand-in exactly as the inline assertion does and is
         * the first shape someone reaches for once the inline one is blocked.
         * Scope analysis, not a name heuristic — same mechanism, and the same
         * reason, as `slot-lookup/no-any-assignment`.
         */
        const declaredErasedVariable = (name, node) => {
          for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
            const variable = scope.variables.find((v) => v.name === name);
            if (!variable) continue;
            return variable.defs.some((d) => {
              const kind = d.node?.id?.typeAnnotation?.typeAnnotation?.type;
              return (
                d.node?.type === 'VariableDeclarator' &&
                (kind === 'TSAnyKeyword' || kind === 'TSNeverKeyword')
              );
            });
          }
          return false;
        };

        return {
          CallExpression(node) {
            // Bare-identifier callee only. These names are distinctive enough to
            // treat as reserved, and matching the name rather than the resolved
            // import is what keeps a re-export or a test-local alias from
            // quietly leaving the rule behind.
            if (node.callee?.type !== 'Identifier' || !guarded.has(node.callee.name)) return;
            const driver = node.arguments?.[0];
            if (!driver) return;
            if (isAsserted(driver)) {
              context.report({ node: driver, messageId: 'erased' });
              return;
            }
            if (driver.type === 'Identifier' && declaredErasedVariable(driver.name, node)) {
              context.report({ node: driver, messageId: 'erased' });
            }
          },
        };
      },
    },
  },
};

// ---------------------------------------------------------------------------
// issue #9758 — a statement swallowed by an unterminated block comment.
// ---------------------------------------------------------------------------
//
// A block comment that is never closed is NOT a syntax error. The next comment
// terminator in the file closes it — normally the docblock of the following
// declaration — so the file parses, every gate stays green, and the only
// symptom is a statement that quietly stopped existing. #9640 is one instance:
// `export { maskComments };` in `scripts/pm/dispatch-gates.mjs` had been comment
// TEXT, while that module's own header went on claiming the re-export.
//
// The class is invisible to review and trivial to parse: the swallowed line
// looks like code (textually it IS code) and the terminator looks like it
// belongs to the docblock below. ESLint already visits every file with a real
// parser and hands a rule the comment nodes for free, so the checker is the
// predicate below and nothing else.
//
// ## Why a rule here and not a `check:*` family — #9758's question, measured
//
// #9758 recorded the class at 1 instance in 4,595 files and asked whether that
// base rate earns a checker at all. Re-derived on this tree — 4,679 files, a
// real parser rather than the repo masker — the count is 0: #9640 was the
// singleton and its PR repaired it.
//
// A zero base rate is a real argument against a new gate FAMILY: a script, a
// workflow step, a required context, its own self-test and watch hints, and one
// more line of reader attention in every dispatch derivation, all to hold a
// class nobody trips. It is not an argument against THIS, which is one rule in
// the file that already carries three inline plugins, under a `pnpm lint` that
// already parses all 4,679 files. Zero new CI steps, zero new required
// contexts, zero new check families, zero new dispatch leads.
// `verify-stand-in/no-asserted-driver-argument` below is the precedent for a
// guard that starts at a zero baseline: the state worth having is that the
// count stays 0, and holding a 0 is what a rule is for.
//
// ## The false-positive surface, which is the whole risk — measured
//
// Commented-out code is legitimate and common, so a predicate that flags every
// code-shaped line inside a block comment is unshippable. Two facts bound it,
// both measured over this tree's 21,007 multi-line block comments:
//
//   • all 240,529 of their interior source lines carry the `*` prose marker —
//     not most, all. So exempting marker lines costs no recall on real prose,
//     and it is what makes the predicate quiet: 540 interior lines ARE
//     code-shaped (`@example` blocks — `* import { createHonoApp } from …`,
//     `* export default app;`) and every one of them is a marker line. Without
//     the exemption those 540 are false positives; with it they are invisible.
//   • the predicate matches statement SHAPES, not statement keywords. `let`,
//     `class`, `type`, `import` and `export` are ordinary English words, and a
//     keyword test flags prose that opens with one. `let us assume…` does not
//     match `let <ident> [:=]`; `class hierarchies are…` does not match
//     `class <ident> (extends|implements|{|<)`; `import lists are…` does not
//     match an import form. Those three are in the pinned cases below.
//
// Against those two, plus the block-comment OPENER signature (comments do not
// nest, so a `/*` at the head of a line inside a comment span is the structural
// signature of "never closed"), a sweep over 261,536 candidate lines in 4,679
// files reports 0. So the rule ships with no baseline and no ignores beyond the
// build directories — there is nothing to grandfather.
//
// ## What it cannot see, stated rather than implied
//
// ESLint never sees a file that does not parse, so this rule's domain is
// exactly the SILENT half of the class. When the swallowed span happens to
// leave behind text that is not valid JavaScript — a glob literal such as
// `packages/` + `**` + `/*.ts` carries a comment terminator and closes a
// phantom span mid-token — the parser rejects the file loudly and no checker is
// needed. That split is also why the predicate is allowed to be narrow: the
// loud half is already covered, by the compiler.
//
// The other half it cannot see is a swallowed line that is neither
// statement-shaped nor a comment opener — a bare call, a JSX fragment, an
// object continuation. Widening to "any line inside a block comment without a
// `*` marker" would catch those and measures 0 on this tree too, but it is a
// STYLE claim wearing a defect's clothes: it would reject a perfectly ordinary
// marker-less `/*  TODO: …  */` block, and this repo lints with
// `--no-inline-config`, so there would be no per-site escape from it. The
// escape that does exist is the house style itself — prefix the line with `*`.

/** The rule's own id, exported for the same reason as the two ids above. */
export const COMMENT_SWALLOW_RULE_ID = 'comment-swallow/no-code-inside-block-comment';

export const COMMENT_SWALLOW_MESSAGE =
  'This line is inside a block comment, and it is shaped like code. That is the signature of a ' +
  'block comment that was never closed: an unterminated opener is not a syntax error — the next ' +
  'comment terminator in the file closes it, usually the docblock of the following declaration — ' +
  'so the file parses, every gate stays green, and a statement quietly stops existing while the ' +
  'header above it goes on describing it (#9640: `export { maskComments };` was comment text for ' +
  'as long as nobody looked). Add the missing terminator to the comment above. If the line really ' +
  'is prose or a deliberately commented-out example, prefix it with the `*` marker every one of ' +
  "this tree's 240,529 block-comment lines already carries — that is the exemption, and it is the " +
  'house style rather than an opt-out. See issues #9640 and #9758.';

/**
 * Statement SHAPES, not statement keywords — see the false-positive section
 * above. Each pattern is anchored on the punctuation that makes the line code
 * rather than a sentence that happens to open with a reserved word.
 */
export const COMMENT_SWALLOW_PATTERNS = [
  // `export { a };` / `export * from './x';` / `export default f;`
  /^export\s*(?:\{|\*|default\b)/,
  // the four import forms, and none of `import lists are checked elsewhere,`
  /^import\s*(?:\{|\*|type\s|['"]|[A-Za-z_$][\w$]*\s*(?:,|from\b))/,
  // a binding: `const x =`, `let { a } =`, `export var n:` — never `let us …`
  /^(?:export\s+)?(?:const|let|var)\s+(?:[{[]|[A-Za-z_$][\w$]*\s*[:=])/,
  // `function f(`, `async function* g<`, `export default function h(`
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*[(<]/,
  // `class C {` / `export abstract class C extends D` — never `class hierarchies …`
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[A-Za-z_$][\w$]*\s*(?:extends\b|implements\b|\{|<)/,
  // the TypeScript declaration shapes
  /^(?:export\s+)?(?:declare\s+)?interface\s+[A-Za-z_$][\w$]*\s*(?:extends\b|\{|<)/,
  /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+[A-Za-z_$][\w$]*\s*\{/,
  /^(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*[=<]/,
  // CommonJS, which `scripts/` still writes
  /^(?:module\.exports|exports\.[A-Za-z_$][\w$]*)\s*=/,
  // a block-comment OPENER. Comments do not nest, so one that begins a line
  // inside a comment span is the structural signature of "never closed" — and
  // in the #9640 shape it is the docblock of the declaration below, which is
  // exactly the thing that made the defect unreadable.
  /^\/\*/,
];

/**
 * True when this source line, taken on its own, reads as code rather than
 * prose. The caller supplies the fact that the line lies inside a block-comment
 * span; this half decides nothing about spans and everything about shape.
 */
export function looksLikeSwallowedCode(sourceLine) {
  const text = sourceLine.trim();
  if (!text || text.startsWith('*')) return false;
  return COMMENT_SWALLOW_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The extension list is load-bearing and DELIBERATELY wider than the
 * `verify-stand-in` block's: it carries `js`/`jsx`/`mjs`/`cjs`. The only
 * instance this class has ever had on this tree was `scripts/pm/
 * dispatch-gates.mjs`, a `.mjs` file, and a block copied from the
 * `{ts,tsx,mts,cts}` sibling below would have covered every file except the
 * one kind that has actually carried the defect. `assertCommentSwallow` pins
 * it, so the narrowing cannot happen quietly.
 */
export const COMMENT_SWALLOW_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/**
 * The predicate's contract, pinned as cases rather than trusted.
 *
 * A rule with a ZERO baseline is green three ways — the tree is clean, the
 * predicate was edited into matching nothing, or the config block stopped
 * matching files — and `pnpm lint` reports the same nothing in all three. That
 * is the dead-pin shape the three sibling guards in this file each pay a gate
 * script to avoid. This one does not need a gate script: the predicate is a
 * pure function of one line, so its cases can run where the config loads, on
 * every `pnpm lint` in CI and locally, at a cost of ~20 regex tests. The span
 * half needs no pinning — that is the parser's answer, not ours.
 */
export const COMMENT_SWALLOW_CASES = [
  // FIRES — the class.
  ['export { maskComments };', true],              // the #9640 statement itself
  ['const RE = /a*' + '/;', true],
  ['  const limit = 10;', true],                   // indented, inside a function body
  ['module.exports = { a: 1 };', true],
  ['export type Id = string;', true],
  ['export function selfTest() {', true],
  ['import { readFileSync } from "node:fs";', true],
  ['/** the docblock whose terminator closed the phantom span */', true],
  // SILENT — prose, and marked-up example code.
  [' * import { createHonoApp } from "@objectstack/hono";', false],
  [' * export default app;', false],
  ['let us assume the value is null, and', false],
  ['class hierarchies are not the point here;', false],
  ['import lists are checked elsewhere,', false],
  ['export the module however you like;', false],
  ['type checking happens later', false],
  [' */', false],
  ['', false],
];

function assertCommentSwallow() {
  const wrong = COMMENT_SWALLOW_CASES.filter(([line, expected]) => looksLikeSwallowedCode(line) !== expected);
  if (wrong.length > 0) {
    throw new Error(
      `${COMMENT_SWALLOW_RULE_ID}: the detector no longer matches its pinned cases — ` +
      `${wrong.length} of ${COMMENT_SWALLOW_CASES.length} disagree, starting with ` +
      `${JSON.stringify(wrong[0][0])} (expected ${wrong[0][1] ? 'a report' : 'silence'}). ` +
      'A rule with a zero baseline cannot be trusted to be quiet for the right reason, so this ' +
      'runs where the config loads. Fix COMMENT_SWALLOW_PATTERNS, or amend the case if the ' +
      'contract really changed — never delete it to get lint green. See issue #9758.'
    );
  }
  if (!COMMENT_SWALLOW_FILES.some((glob) => /\bmjs\b/.test(glob) && /\bjs\b/.test(glob))) {
    throw new Error(
      `${COMMENT_SWALLOW_RULE_ID}: COMMENT_SWALLOW_FILES stopped covering plain JavaScript. The ` +
      'one instance this class has ever had on this tree was a `.mjs` file under `scripts/`, so a ' +
      'TypeScript-only scope is a guard that cannot see the only place the defect has occurred. ' +
      'See issue #9758.'
    );
  }
}

assertCommentSwallow();

const commentSwallowPlugin = {
  rules: {
    'no-code-inside-block-comment': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Ban a code-shaped line inside a block-comment span — the signature of a block ' +
            'comment that was never closed.',
        },
        schema: [],
        messages: { swallowed: COMMENT_SWALLOW_MESSAGE },
      },
      create(context) {
        return {
          Program() {
            const { sourceCode } = context;
            const lines = sourceCode.lines;
            for (const comment of sourceCode.getAllComments()) {
              if (comment.type !== 'Block') continue;
              const { start, end } = comment.loc;
              if (end.line === start.line) continue;
              // From the line AFTER the opener through the terminator's own
              // line. The opener's line is excluded because whatever precedes a
              // `/*` on it is live code; the terminator's line is INCLUDED
              // because a span can close mid-line, on a line that is otherwise
              // a statement — a regex or a glob literal a few lines down
              // carries a terminator and ends the phantom span right there.
              for (let line = start.line + 1; line <= end.line; line++) {
                const text = lines[line - 1];
                if (text === undefined || !looksLikeSwallowedCode(text)) continue;
                context.report({
                  loc: { start: { line, column: 0 }, end: { line, column: text.length } },
                  messageId: 'swallowed',
                });
              }
            }
          },
        };
      },
    },
  },
};

export default [
  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
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
    ignores: ['**/node_modules/**', '**/dist/**', '**/*.test.ts'],
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
    ignores: ['**/node_modules/**', '**/dist/**', 'packages/qa/downstream-contract/**'],
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
    ignores: ['**/node_modules/**', '**/dist/**', ...SLOT_LOOKUP_UNSWEPT],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { 'slot-lookup': slotLookupPlugin },
    rules: {
      // The split-declaration form (#4251) — see `slotLookupPlugin`. Reports the
      // SAME message as the three selectors below, so `check:slot-lookup` counts
      // all four shapes without knowing there are four.
      'slot-lookup/no-any-assignment': 'error',
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
  //
  // This is a dedicated PLUGIN rule and not three more `no-restricted-syntax`
  // selectors, for two reasons that both matter:
  //
  //   1. Flat config does not MERGE rule options. A second block setting
  //      `no-restricted-syntax` over `packages/**` would REPLACE the
  //      slot-lookup block's selector list for every file both blocks match —
  //      silently deleting that rule. The two guards also need independent
  //      `ignores` (their unswept sets are different files), which one shared
  //      block cannot give them.
  //   2. The split form needs SCOPE analysis to resolve an identifier to its
  //      declaration, which esquery cannot express — the same reason
  //      `slot-lookup/no-any-assignment` exists. Scope analysis needs no type
  //      information, so this still runs in the plain (untyped) lint pass.
  //
  // KNOWN RESIDUAL, stated rather than implied: an erasure that happens through
  // a typed indirection — a helper declared `(o, q?: any) => engine.find(o, q)`,
  // or a wrapper whose own return type is `Promise<any>` — erases the contract
  // just as effectively and this rule cannot see it (an `: any` PARAMETER
  // forwarded into a query is a real shape, ~50 sites, almost all of them test
  // doubles; judging it needs the call graph, not one file's scopes). Same
  // boundary as the slot-lookup rule's own KNOWN RESIDUAL, and the same answer:
  // it belongs to a typed-lint pass, not here.
  {
    files: ['packages/**/*.{ts,tsx,mts,cts}'],
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
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
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/.turbo/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { 'verify-stand-in': verifyStandInPlugin },
    rules: { 'verify-stand-in/no-asserted-driver-argument': 'error' },
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
  // actually occurred in. `assertCommentSwallow` refuses that narrowing.
  //
  // No baseline and no `ignores` beyond the build directories, for the same
  // reason `verify-stand-in` has none: the tree measures 0 today (261,536
  // candidate lines, 4,679 files), so there is nothing to grandfather and every
  // future report is a new defect. Adding an entry later would mean the state
  // stopped being locked.
  {
    files: COMMENT_SWALLOW_FILES,
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/.turbo/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { 'comment-swallow': commentSwallowPlugin },
    rules: { 'comment-swallow/no-code-inside-block-comment': 'error' },
  },
];
