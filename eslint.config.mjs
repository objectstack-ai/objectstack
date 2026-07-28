// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

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
];
