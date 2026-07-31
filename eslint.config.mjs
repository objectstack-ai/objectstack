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
// Entries are spliced into a regex, so escape metacharacters (`http\\.server`).
// `http.server` is served by three providers (plugin-hono-server, runtime's
// config.server path, qa's node-plugin) and no IHttpServer contract exists;
// callers read only `getPort()`.
const UNCONTRACTED_SLOTS = ['protocol', 'mcp', 'kernel-resolver', 'scope-manager', 'http\\.server'].join('|');

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
    rules: {
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
];
