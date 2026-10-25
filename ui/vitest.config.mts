import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';
// @ts-expect-error — plain-JS CI helper, intentionally untyped (`allowJs: false`)
import { assertCanonicalVitestInvocation, cliHasTestFilters } from './scripts/vitest-invocation-guard.mjs';
// @ts-expect-error — plain-JS CI helper, intentionally untyped (`allowJs: false`)
import TestShardSequencer from './scripts/test-shard-sequencer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── The suite runs in UTC, always (objectui#8366) ───────────────────────────
//
// A family of pins asserts LITERAL local-date faces — `Jul 4, 2024`,
// `Jul 4, '24`, `7/4/2024 7:00 am` — built from fixed UTC instants
// (`2024-07-04T07:00:00.000Z` and friends) through LOCAL date parts. Nothing
// pinned the runner's zone, so the face those pins render was a property of
// the contributor's laptop. Measured on `76573a184` over the six files that
// carry the family:
//
//   TZ=UTC              6 files passed              (184 tests, 0 failed)
//   TZ=Europe/Paris     3 failed | 3 passed         (7 failed)
//   TZ=Asia/Shanghai    3 failed | 3 passed         (7 failed)
//   TZ=America/New_York 4 failed | 2 passed        (31 failed)
//   TZ=Etc/GMT+8        4 failed | 2 passed        (33 failed)
//
// So the suite was green at EXACTLY ONE offset, not merely west of some
// boundary: a `07:00 AM` face pinned off an `07:00Z` instant is true at
// UTC+00:00 and nowhere else. CI is UTC, so the class was invisible there and
// only ever cost a contributor — a wall of red that is not about the code.
//
// Why the zone and not the assertions: those literals are load-bearing ON
// PURPOSE. `date-display.optionsStyle-7745.test.ts` says so in its own words —
// its faces are "anchored by the two literals the card measured, so a redesign
// that moved both sides together could not pass silently." Deriving the
// expected face from the same formatter under test is what the two files that
// ALREADY pass do (`dataset-format.date.test.ts`,
// `DatasetWidget.dateMeasure.test.tsx`), and it is the right assertion where
// the claim is "this surface shows what a list cell shows" — but on an anchor
// it degrades to `formatDate(v) === formatDate(v)` and asserts nothing. Pinning
// the offset the anchors were written against keeps them.
//
// This deletes no coverage: no test in this repo reads the ambient zone
// (`process.env.TZ`, `getTimezoneOffset`, `resolvedOptions().timeZone` — zero
// hits across every `*.test.ts`/`*.test.tsx`), and the one zone-aware surface
// that exists takes its zone from METADATA, explicitly
// (`tzShift.ts`'s `tzOffsetMs(schema.timeZone, …)`, behind `GanttView.tsx`). Non-UTC coverage, if
// it is ever wanted, wants an explicit per-case zone — never the runner's
// ambient one, which is the thing that made this silent.
//
// Unconditional on purpose: a contributor's zone usually comes from
// `/etc/localtime` and not from `TZ`, so an `??=` would leave exactly the
// reported population unfixed while pretending to fix it.
//
// Pinned by `scripts/__tests__/vitest-timezone-pin-8366.test.ts`, which spawns
// a real vitest under a non-UTC `TZ` and asserts the run still sees UTC — so
// deleting this line reds CI, where the ambient zone would otherwise hide it.
process.env.TZ = 'UTC';

// Refuse the two invocations that pass while running none of the tests the
// caller asked for — a package-cwd run (objectui#3378) and a path filter that
// never reaches Vitest (objectui#3288).
//
// This call covers every run whose config resolution ends up here: `pnpm test`,
// and any package-cwd run in a package that either has no `vitest.config.*` of
// its own (the lookup walks up to this file) or has one that imports this file.
// It is NOT the single choke point — that claim used to be written both here
// and in the guard's docstring, and was wrong for the 11 packages carrying a
// STANDALONE `vitest.config.ts` (objectui#5406): nothing imported this module
// from there, so the guard never ran. Those 11 now call the guard themselves,
// and `scripts/__tests__/vitest-invocation-guard.test.ts` fails if any
// `vitest.config.*` in the repo takes neither route.
//
// Mechanism, message and the one canonical invocation:
// scripts/vitest-invocation-guard.mjs (and AGENTS.md §测试纪律, which spells the
// same three commands out).
assertCanonicalVitestInvocation({ repoRoot: __dirname });

// Shared exclude list for the root-level projects below. (Project-level
// `exclude` replaces — does not merge with — the inherited one, so each
// project spells out the full list.)
const sharedExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/cypress/**',
  '**/e2e/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/.claude/**',
  // In-repo git worktrees (`.wt-*`, per AGENTS.md / the worktree workflow)
  // are full checkouts of other branches. Without this their *.test.tsx
  // copies get globbed in and run against this tree's source — producing
  // phantom failures from another branch's code.
  '**/.wt-*/**',
  // Apps have their own '@/' alias pointing at their own src/, so they
  // can't share the root '@' alias (→ packages/components). They are
  // brought back in via the `projects` array below with their own
  // vitest.config.ts.
  'apps/**',
];

// `.test.ts` files that need a DOM environment despite the .ts suffix —
// they render hooks via @testing-library or touch window/document directly.
// Everything else in *.test.ts is pure logic and runs in the cheap `unit`
// project. If you add a test that uses renderHook/render/window, either name
// it *.test.tsx or add it here.
const domTsTests = [
  'packages/app-shell/src/hooks/__tests__/useAiSurface.test.ts',
  'packages/app-shell/src/hooks/__tests__/useAiUsage.test.ts',
  'packages/app-shell/src/hooks/__tests__/useReconcileOnError.test.ts',
  'packages/app-shell/src/observability/settleSignal.test.ts',
  'packages/core/src/actions/__tests__/ActionRunner.resultDialog.test.ts',
  'packages/core/src/theme/__tests__/ThemeEngine.test.ts',
  'packages/plugin-grid/src/importParsers.test.ts',
  'packages/fields/src/widgets/useRecordQuery.test.ts',
  'packages/mobile/src/__tests__/useBreakpoint.test.ts',
  'packages/plugin-designer/src/__tests__/useDesignerHistory.test.ts',
  'packages/plugin-grid/src/__tests__/useBulkExecutor.test.ts',
  'packages/react/src/data-invalidation.test.ts',
  'packages/react/src/hooks/__tests__/useActionEngine.test.ts',
  'packages/react/src/hooks/__tests__/useActionRunner.test.ts',
  'packages/react/src/hooks/__tests__/useDataRefresh.test.ts',
  'packages/react/src/hooks/__tests__/useExpression.test.ts',
  'packages/react/src/hooks/__tests__/useRecordSearch.test.ts',
  'packages/react/src/hooks/__tests__/useSettledSchema.test.ts',
];

// Test files that render through the ComponentRegistry and therefore need the
// heavy `vitest.setup.dom.tsx` (the four side-effect package imports + widget
// re-registrations). They run in the `dom-heavy` project; every other DOM test
// gets the trimmed `vitest.setup.dom-light.tsx` default.
//
// This list was derived empirically: run the whole `dom` project under the
// light setup and every file here is one that failed (e.g. "page:card not
// registered", or an element that never rendered). It is a small minority
// (~20 of ~310 DOM files) — the other ~290 never touch the registry and used
// to pay ~3.3s/file of setup for nothing.
//
// If a NEW test renders a schema / page:* / dashboard / grid widget and fails
// with "<type> not registered", add it here. Misfiling is self-correcting, not
// silent: a heavy test left out of this list lands in the light `dom` project
// and fails loudly in CI (it can never be skipped), so coverage cannot be lost
// — only a red build that points at the fix.
const heavyDomTests = [
  'packages/app-shell/src/console/ai/LiveCanvas.test.tsx',
  'packages/app-shell/src/console/ai/__tests__/ConversationsSidebar.test.tsx',
  'packages/app-shell/src/console/organizations/__tests__/CreateWorkspaceDialog.test.tsx',
  'packages/app-shell/src/hooks/__tests__/useConsoleActionRuntime.test.tsx',
  'packages/app-shell/src/layout/__tests__/AiUsageIndicator.test.tsx',
  'packages/app-shell/src/layout/__tests__/ChatDock.test.tsx',
  'packages/app-shell/src/preview/__tests__/DraftChangesPanel.test.tsx',
  'packages/app-shell/src/preview/__tests__/DraftPreviewBar.test.tsx',
  'packages/app-shell/src/views/metadata-admin/AccessExplainPanel.test.tsx',
  'packages/app-shell/src/views/metadata-admin/AssignedUsersSection.test.tsx',
  'packages/app-shell/src/views/metadata-admin/previews/DatasetPreview.test.tsx',
  'packages/app-shell/src/views/metadata-admin/previews/PagePreview.test.tsx',
  'packages/app-shell/src/views/metadata-admin/previews/ReportPreview.dataset.test.tsx',
  'packages/components/src/__tests__/action-bar.test.tsx',
  'packages/components/src/__tests__/action-group.test.tsx',
  'packages/components/src/__tests__/page-card-i18n-title.test.tsx',
  'packages/components/src/__tests__/page-header-action-i18n.test.tsx',
  'packages/components/src/__tests__/page-header-action-ids.test.tsx',
  'packages/components/src/__tests__/page-header-actions.test.tsx',
  'packages/components/src/__tests__/page-header-capability-gate.test.tsx',
  'packages/components/src/__tests__/page-header-lookup-predicate.test.tsx',
  'packages/components/src/__tests__/page-header-predicate-dialect.test.tsx',
  // objectui#10117 — the record-chrome H1 resolved through the REAL
  // `page:header` registration. The defect is what that renderer's own title
  // chain hands to JSX, so it has to be the registered component and not a
  // stand-in; same reason and same route as the sibling entry below.
  'packages/components/src/__tests__/page-header-title.emptyNameLookupFallback-10117.test.tsx',
  'packages/components/src/__tests__/page-header-title.test.tsx',
  'packages/plugin-calendar/src/registration.test.tsx',
  'packages/plugin-dashboard/src/__tests__/DashboardRenderer.designMode.test.tsx',
  'packages/plugin-dashboard/src/__tests__/DashboardRenderer.filters.test.tsx',
  'packages/plugin-dashboard/src/__tests__/DashboardRenderer.legacyRetired.test.tsx',
  'packages/plugin-grid/src/__tests__/predicate-surface-parity.test.tsx',
  'packages/plugin-kanban/src/registration.test.tsx',
  'packages/plugin-kanban/src/KanbanRenderer.uncolumned.test.tsx',
  // objectui#4464 — a ListView-hosted composition over the REAL object-grid.
  // The defect only exists where ListView owns the fetch and the grid takes the
  // inline-data path, so a stub grid (what every other plugin-list test
  // registers) cannot see it; this file needs the setup's plugin-grid
  // side-effect registration, and taking a plugin-list -> plugin-grid
  // dependency to import it directly would be the heavier change.
  'packages/plugin-list/src/__tests__/ListView.crossPageSelectAll.test.tsx',
  // objectui#6598 — the reported html-kind page, end to end over the REAL
  // object-grid. The defect is ListView and ObjectGrid disagreeing about how
  // "the author declared no columns" is spelled, so a stub grid (what the
  // sibling handoff pin registers) is standing in for one side of the
  // disagreement and cannot see it. Same reason, same route as the entry above.
  'packages/plugin-list/src/__tests__/htmlTierListViewDefaultColumns-6598.test.tsx',
  // objectui#6598 — the reporter's eight `columns` spellings as a matrix,
  // each through the real live registration and the REAL object-grid. Same
  // reason and same route as the entry above: the card's own claim is about
  // all eight at once, and a stub grid stands in for one side of the
  // ListView/ObjectGrid disagreement it has to observe.
  'packages/plugin-list/src/__tests__/htmlTierColumnSpellings-6598.test.tsx',
  // objectui#6723 — PIN 4: the grid's new inline-data FLS gate must be a
  // no-op through this host, which pre-filters its own fields. "No-op"
  // is a claim about the REAL grid's rendered headers, so a stub grid
  // (what the sibling handoff pins register) cannot observe it. Same
  // reason and same route as the three entries above.
  'packages/plugin-list/src/__tests__/ListView.inlineFlsNoop-6723.test.tsx',
];

/**
 * The `dist` project's population (objectui#7183): built-artifact pins, and
 * nothing else. A pin here imports its package's BUILT bundle by an explicit
 * relative path, bypassing the `resolve.alias` map below — which is what makes
 * "does the shipped bundle still do X" answerable at all, since every alias
 * entry redirects a package specifier to its `src`.
 *
 * The `.dist.spec.tsx` suffix keeps these files out of `unit` (`*.test.ts`),
 * `dom` (`*.test.tsx`) and `dom-heavy` (an explicit file list) BY
 * CONSTRUCTION, so none of those three projects needed a single character
 * changed. It also keeps them out of each package's `tsconfig.test.json`,
 * whose include names `*.test.ts` / `*.test.tsx` — deliberately, because
 * turbo's `type-check` waits on `^build` (the DEPENDENCIES' builds) and must
 * never be handed a program that reads the package's own `dist`
 * (objectui#4801 removed a self-referencing `paths` entry for that reason).
 */
const DIST_PIN_GLOB = 'packages/*/src/**/*.dist.spec.tsx';

/**
 * The `dist` project is OPT-IN, and that is a load-bearing half of
 * objectui#7183 rather than a convenience.
 *
 * CI's test job runs `pnpm test` — `vitest run`, with no build step anywhere in
 * it (by design: building every package for every test run is the cost the
 * ruling on #7183 explicitly refused). An unconditional fourth project would
 * therefore be collected by that run with no `dist` on disk, and its
 * precondition would fail the whole suite on every PR. Declaring it only when
 * asked for keeps `pnpm test` the run it is today, and confines the build cost
 * to the one lane that needs it.
 *
 * The opt-in is an ENV VAR rather than the `--project dist` flag because the
 * flag lives in `process.argv`, which is meaningful only in the process that
 * parsed the CLI, while the env var is inherited by everything Vitest spawns.
 * `pnpm test:dist` sets it; see `packages/components/package.json`.
 */
const DIST_PINS_ENABLED = process.env.OBJECTUI_DIST_PINS === '1';

/**
 * ...which leaves one rough edge on the opt-in, and it is closed here rather
 * than documented. `vitest run --project dist` without the env var names a
 * project that is not declared, and vitest is LOUD about that: its project
 * resolution throws `No projects matched the filter "dist"` and the run exits
 * 1. There is no silent green here to prevent.
 *
 * What that refusal does NOT do is tell the reader how to proceed. It reports
 * only that the filter matched nothing — never that the project is env-gated,
 * never the name OBJECTUI_DIST_PINS, never the task that sets it. So the reader
 * is stopped with no remedy, and has to come read this file to learn there is
 * one. Refuse the run earlier, and say how.
 *
 * This guard used to justify itself by asserting the un-opted run would
 * "collect ZERO files and exit GREEN". It does not, and never did on vitest 4;
 * that sentence sent a reader off to measure vitest before they could trust it
 * (objectui#8274). The claim is now pinned by an actual vitest spawn in
 * `scripts/__tests__/dist-pins-guard-message-8274.test.ts`, so a change in
 * vitest reds a test rather than rotting a comment.
 */
const DIST_PROJECT_NAMED = process.argv.some(
  (arg, i) => arg === '--project=dist' || (arg === '--project' && process.argv[i + 1] === 'dist'),
);
if (DIST_PROJECT_NAMED && !DIST_PINS_ENABLED) {
  throw new Error(
    [
      'vitest --project dist was requested, but OBJECTUI_DIST_PINS is not "1", so the',
      '`dist` project is NOT declared. Left to vitest, this run ends in its generic',
      'refusal - `No projects matched the filter "dist"`, exit 1 - which tells you the',
      'filter matched nothing but not that the project is env-gated, and names neither',
      'OBJECTUI_DIST_PINS nor the task that sets it. Hence this message.',
      '',
      'The `dist` project holds built-artifact pins, which need their package BUILT first.',
      'Reach it through the task that guarantees that:',
      '',
      '  pnpm test:dist    # turbo builds the package under test, then runs this project',
      '',
      'See vitest.config.mts (DIST_PINS_ENABLED) and turbo.json (the `test:dist` task).',
    ].join('\n'),
  );
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    testTimeout: 15000, // Increase default timeout for integration tests with MSW
    exclude: sharedExclude,
    // Three root-level projects split by environment cost.
    //
    // - `unit`: pure-logic *.test.ts in node env + vitest.setup.base.ts only.
    // - `dom`: React tests in happy-dom with the LIGHT setup — jsdom polyfills,
    //   jest-dom and RTL cleanup, but none of the @object-ui/components / fields
    //   / plugin-dashboard / plugin-grid graphs.
    // - `dom-heavy`: the ~20 `heavyDomTests` that render through the
    //   ComponentRegistry, with the full `vitest.setup.dom.tsx`.
    //
    // Why the split: with `isolate: true` every setup import re-executes per
    // file. The old single DOM setup pulled the four heavy package graphs into
    // every one of ~300 DOM files (~3.3s/file of setup) even though ~290 never
    // touch the registry — a CI run spent ~20 min cumulative in setup for ~3
    // min of actual tests. Restricting that graph to the files that need it
    // leaves the common case paying only the light setup.
    //
    // (The former `environmentMatchGlobs` split silently stopped working on
    // Vitest 4 — the option was removed — so every file was paying happy-dom
    // + full DOM setup regardless of suffix.)
    //
    // Absolute paths for file entries so the project list resolves the same
    // regardless of the cwd vitest is launched from (`turbo run test` runs
    // each package's `vitest run` from that package's directory).
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          // Share a module graph per worker instead of re-executing it per
          // file. Measured 3.2x faster (38s -> 12s for the project) with zero
          // failures, holding green across repeated and shuffled runs.
          //
          // What that buys is paid for by an INVARIANT, not by a property of
          // the files (objectui#7134). The premise written here used to be
          // "node-env pure logic with no ComponentRegistry or DOM state to leak
          // across files". It was false in both directions and had been for
          // some time: this project holds files whose import closure REGISTERS
          // into the `ComponentRegistry` singleton — measured over `ec0a7b846`,
          // its 811 files import 551 distinct modules whose closures register
          // 505 keys into it —
          // and files that assert a key is ABSENT from it. A shared graph makes
          // each visible to the other, so the constraint that actually has to
          // hold is:
          //
          //     a key one file asserts ABSENT from the ComponentRegistry must
          //     be registered by no other file in this project.
          //
          // Nothing about a breach of it fails safe. The outcome is ORDER
          // dependent — whether the absence assertion runs before or after the
          // writer in its worker decides it — so a collision surfaces as a
          // failure in a file that did nothing wrong, in some shards and not
          // others, and says nothing about the code under test.
          //
          // So it is ENFORCED rather than left written down here, because this
          // comment is the only thing a future author consults before adding a
          // registering import to this project, and it had already gone false
          // without anyone noticing:
          //
          //     scripts/__tests__/unit-registry-absence-collision.test.ts
          //
          // That gate derives both populations from this file's own `include`
          // and `domTsTests` on every run and fails naming both files and the
          // key. It EXECUTES the closures in a fresh module graph to learn what
          // they register, because the writers' keys cannot be read off the
          // source: the live field path registers from data (`registerAllFields()`
          // walks a map), so `field:multiselect` exists at runtime and appears
          // in no `register('field:multiselect')` call site anywhere.
          //
          // The `ComponentRegistry` is not the only shared state a single global
          // object exposes. `globalThis` is the second, in the same class and
          // with the same order-dependent failure shape, and it went unchecked
          // until objectui#8500: four files replaced `globalThis.fetch` with a
          // bare `vi.fn()` by assignment and never handed it back, so the
          // network-escape guard's wrapper was gone for every later file in the
          // worker and `scripts/__tests__/network-escape-ledger.test.ts` read
          // `Mock` where `guardedFetch` belonged. So the same treatment: the
          // invariant
          //
          //     a global the setup files install must be the same value at the
          //     END of a file as it was at the START of it
          //
          // is ENFORCED, by `vitest.setup.shared-global-leak-guard.ts` below,
          // which reds the file that leaked and puts the global back so no
          // innocent file inherits it.
          //
          // The `dom`/`dom-heavy` projects keep `isolate: true` — they DO leak
          // in ways nothing checks (registry overrides, happy-dom nodes);
          // relaxing them needs the hermeticity fixes tracked separately. That
          // is also why the leak guard is wired HERE and not into
          // `vitest.setup.base.ts`: under `isolate: true` a double left up for a
          // whole file crosses nothing, and the network-escape guard's own
          // `Fix:` text prescribes exactly that shape.
          isolate: false,
          setupFiles: [
            path.resolve(__dirname, 'vitest.setup.base.ts'),
            // LAST, and that is load-bearing: it snapshots what the setup files
            // before it installed. Pinned by
            // `scripts/__tests__/shared-global-leak-guard.test.ts`.
            path.resolve(__dirname, 'vitest.setup.shared-global-leak-guard.ts'),
          ],
          // `eslint-rules/**` holds the local ESLint plugin's RuleTester specs.
          // They were previously matched by no project glob, so the ratchet
          // rules shipped with tests that never ran (objectui#2879).
          // `scripts/**` covers the repo-level CI helpers with no package of
          // their own (e.g. the PR-comment renderer behind
          // `.github/workflows/performance-budget.yml`).
          include: [
            'packages/**/*.test.ts',
            'examples/**/*.test.ts',
            'eslint-rules/**/*.test.js',
            'scripts/**/*.test.ts',
          ],
          exclude: [...sharedExclude, ...domTsTests],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          setupFiles: [path.resolve(__dirname, 'vitest.setup.dom-light.tsx')],
          include: [
            'packages/**/*.test.tsx',
            'examples/**/*.test.tsx',
            ...domTsTests,
          ],
          // heavyDomTests render through the registry — they run in `dom-heavy`
          // with the full setup, so keep them out of the light project.
          exclude: [...sharedExclude, ...heavyDomTests],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom-heavy',
          environment: 'happy-dom',
          setupFiles: [path.resolve(__dirname, 'vitest.setup.dom.tsx')],
          include: [...heavyDomTests],
        },
      },
      // The built-artifact lane (objectui#7183). Deliberately scarce: a project
      // that is awkward to reach for stays reserved for genuine published-
      // artifact claims instead of drifting into a second default test surface.
      //
      // The LIGHT dom setup is not a cost optimisation here, it is what makes
      // the lane's live control possible. `vitest.setup.dom.tsx` registers
      // `page:header` and friends from SOURCE; under it a pin would stay green
      // with the built bundle removed entirely, measuring the aliased `src` it
      // was written to avoid. Under the light setup nothing registers those
      // types, so a pin's own `dist` import is the only thing that can make it
      // pass — which is what its live control asserts.
      ...(DIST_PINS_ENABLED
        ? [
            {
              // `as const` is load-bearing, not style. Inside this conditional
              // array the literal `true` widens to `boolean`, while
              // TestProjectConfiguration.extends is `string | true | undefined`;
              // the element then matches no overload of defineConfig and the
              // whole `projects` array degrades to `never[]`, which also takes
              // down apps/console/vitest.config.ts (it merges THIS config, so
              // its own type-check is where CI reported it).
              extends: true as const,
              test: {
                name: 'dist',
                environment: 'happy-dom',
                setupFiles: [path.resolve(__dirname, 'vitest.setup.dom-light.tsx')],
                include: [DIST_PIN_GLOB],
                exclude: sharedExclude,
              },
            },
          ]
        : []),
      path.resolve(__dirname, './apps/console/vitest.config.ts'),
    ],
    // Tolerate an empty collection ONLY for unfiltered runs (a `--project`
    // slice, or a shard whose projects hold no files, is legitimately empty).
    // The moment the CLI names files, "zero matched" is the defect being
    // reported: a mis-spelled path, or one spelled relative to the wrong
    // directory, used to exit 0 here and read as a green run over coverage that
    // never executed (objectui#3288).
    passWithNoTests: !cliHasTestFilters(process.argv),
    // Performance: use threads (lighter than forks). Isolation is enabled to
    // prevent module-graph and DOM state leakage across files (which previously
    // caused thousands of order-dependent failures).
    pool: 'threads',
    isolate: true,
    // `--shard=N/M` splits by measured per-file duration, not by path hash
    // (objectui#12208, ruling 6121816480, letter B). Both `ci.yml` matrices
    // shard through this; `scripts/test-shard-partition.mjs` says why and how,
    // and `scripts/test-shard-timings.json` is the measured input it reads.
    // Only `shard()` is replaced: the order inside a leg is vitest's own.
    sequence: { sequencer: TestShardSequencer },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/index.ts',
        'examples/',
      ],
      // Section 3.6: Testing coverage thresholds
      // Target: 80%+ lines and functions
      // Last adjusted: 2026-05-08 - Lowered after pruning test suite from
      // 394 -> 101 essential files (core protocol/engine + one canonical test
      // per plugin). Integration coverage is now provided by Playwright e2e.
      thresholds: {
        lines: 40,
        functions: 33,
        branches: 30,
        statements: 40,
      },
    },
  },
  resolve: {
    alias: {
      '@object-ui/i18n': path.resolve(__dirname, './packages/i18n/src'),
      '@object-ui/core': path.resolve(__dirname, './packages/core/src'),
      '@object-ui/react-runtime': path.resolve(__dirname, './packages/react-runtime/src'),
      '@object-ui/sdui-parser': path.resolve(__dirname, './packages/sdui-parser/src'),
      '@object-ui/types/zod': path.resolve(__dirname, './packages/types/src/zod/index.zod.ts'),
      '@object-ui/types': path.resolve(__dirname, './packages/types/src'),
      '@object-ui/react': path.resolve(__dirname, './packages/react/src'),
      '@object-ui/protocol': path.resolve(__dirname, './packages/core/src'),
      '@object-ui/components': path.resolve(__dirname, './packages/components/src'),
      '@object-ui/providers': path.resolve(__dirname, './packages/providers/src'),
      '@object-ui/fields': path.resolve(__dirname, './packages/fields/src'),
      '@object-ui/plugin-dashboard': path.resolve(__dirname, './packages/plugin-dashboard/src'),
      '@object-ui/plugin-grid': path.resolve(__dirname, './packages/plugin-grid/src'),
      '@object-ui/plugin-kanban': path.resolve(__dirname, './packages/plugin-kanban/src'),
      '@object-ui/plugin-charts': path.resolve(__dirname, './packages/plugin-charts/src'),
      '@object-ui/plugin-list': path.resolve(__dirname, './packages/plugin-list/src'),
      '@object-ui/data-objectstack': path.resolve(__dirname, './packages/data-objectstack/src'),
      '@object-ui/layout': path.resolve(__dirname, './packages/layout/src'),
      '@object-ui/plugin-calendar': path.resolve(__dirname, './packages/plugin-calendar/src'),
      '@object-ui/plugin-chatbot/core': path.resolve(__dirname, './packages/plugin-chatbot/src/core.ts'),
      '@object-ui/plugin-chatbot': path.resolve(__dirname, './packages/plugin-chatbot/src'),
      '@object-ui/plugin-detail': path.resolve(__dirname, './packages/plugin-detail/src'),
      '@object-ui/plugin-editor': path.resolve(__dirname, './packages/plugin-editor/src'),
      '@object-ui/plugin-form': path.resolve(__dirname, './packages/plugin-form/src'),
      '@object-ui/plugin-gantt': path.resolve(__dirname, './packages/plugin-gantt/src'),
      '@object-ui/plugin-map': path.resolve(__dirname, './packages/plugin-map/src'),
      '@object-ui/plugin-markdown': path.resolve(__dirname, './packages/plugin-markdown/src'),
      '@object-ui/plugin-timeline': path.resolve(__dirname, './packages/plugin-timeline/src'),
      '@object-ui/plugin-view': path.resolve(__dirname, './packages/plugin-view/src'),
      '@object-ui/plugin-report': path.resolve(__dirname, './packages/plugin-report/src'),
      '@object-ui/plugin-ai': path.resolve(__dirname, './packages/plugin-ai/src'),
      '@object-ui/plugin-designer': path.resolve(__dirname, './packages/plugin-designer/src'),
      '@object-ui/runner': path.resolve(__dirname, './packages/runner/src'),
      '@object-ui/auth': path.resolve(__dirname, './packages/auth/src'),
      '@object-ui/mobile': path.resolve(__dirname, './packages/mobile/src'),
      '@object-ui/permissions': path.resolve(__dirname, './packages/permissions/src'),
      '@object-ui/collaboration': path.resolve(__dirname, './packages/collaboration/src'),
      '@object-ui/app-shell': path.resolve(__dirname, './packages/app-shell/src'),
      // Private, never-published test-support package (objectui#4434). Aliased
      // like every other workspace package so a test's import resolves to the
      // same source file `tsc` reads through the package's `exports` map,
      // rather than depending on how Vite treats a symlinked dependency.
      '@object-ui/test-support': path.resolve(__dirname, './packages/test-support/src'),
      '@': path.resolve(__dirname, './packages/components/src'),
    },
  },
});
