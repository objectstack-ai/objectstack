// `defineConfig` comes from `vitest/config`, not `vite` — this file carries a
// `test` block (consumed by `vitest.config.ts`, which merges this config), and
// `vite`'s own `UserConfigExport` has no `test` property. Importing it from
// `vite` left that whole block unchecked (objectui#3305).
import { defineConfig } from 'vitest/config';
import type { Plugin, Rollup } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
// Relative specifiers carry their real file extension, and `__dirname` is
// spelled `import.meta.dirname` throughout this file, so the config stays
// loadable by Vite's `configLoader: 'native'` — which imports this file with
// Node's own ESM loader. Node does no extension guessing and defines no
// `__dirname` in ESM, so the pre-Vite-8 spellings would fail outright the day
// `native` becomes the default loader (objectui#3384).
import { viteCryptoStub } from '../../scripts/vite-crypto-stub.ts';
import { viteMaplibreWorker } from '../../scripts/vite-maplibre-worker.ts';
import { resolveClientDistInjection, widenVendorChunkTestForClient } from '../../scripts/vite-objectstack-client-dist.ts';
import {
  assertSingleZodInstance,
  formatConditionReport,
  resolveSpecDistInjection,
} from '../../scripts/vite-objectstack-spec-dist.ts';
import { viteIneffectiveDynamicImports } from '../../scripts/vite-ineffective-dynamic-imports.ts';
import { frameworkPackagesDir, workspaceChunkTests } from '../../scripts/vite-objectstack-workspace.ts';
import { viteDeclaredLazyViews } from '../../scripts/vite-declared-lazy-views.ts';
import { viteTypesZodLazy } from '../../scripts/vite-types-zod-lazy.ts';
import { compression } from 'vite-plugin-compression2';
import { visualizer } from 'rollup-plugin-visualizer';

// Critical chunks that should be preloaded for faster initial page render.
// These are the chunks needed on every page load (framework + vendor-react).
const CRITICAL_CHUNK_PREFIXES = ['vendor-react', 'framework', 'ui-components', 'vendor-radix'];

/**
 * Vite plugin that injects <link rel="modulepreload"> hints for critical chunks
 * into the built HTML, enabling the browser to fetch them in parallel with the
 * main entry script.
 */
function preloadCriticalChunks(): Plugin {
  return {
    name: 'preload-critical-chunks',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;
      const preloadTags: string[] = [];
      for (const [fileName] of Object.entries(ctx.bundle)) {
        if (
          fileName.endsWith('.js') &&
          CRITICAL_CHUNK_PREFIXES.some((prefix) => fileName.includes(prefix))
        ) {
          preloadTags.push(`<link rel="modulepreload" href="${basePath}${fileName}" />`);
        }
      }
      if (preloadTags.length === 0) return html;
      return html.replace('</head>', `    ${preloadTags.join('\n    ')}\n  </head>`);
    },
  };
}

/**
 * Build-time guard: `@objectstack/lint` must stay OUT of the eager closure.
 *
 * `packages/app-shell/src/preview/capabilityLint.ts` reaches the linter through
 * a deliberate `await import('@objectstack/lint')` — it runs only when an
 * author publishes in the metadata designer. That laziness is worth ~89 KiB
 * gzipped on every console page load, and it is defeated silently: an
 * `advancedChunks` group whose `test` matches the linter overrides the
 * module's async-only reachability and folds it in beside the synchronously
 * reached `@objectstack/spec`, whose chunk the entry imports STATICALLY
 * (objectui#5266). Nothing about the source changes, no warning is emitted,
 * and the existing bundle budget cannot see it — that budget weighs the
 * `index-*.js` entry chunk alone, and these bytes land in a vendor chunk.
 *
 * So the invariant is asserted where it is decided, on the emitted graph, in
 * the spirit of `viteMaplibreWorker` above: a regression must fail the BUILD
 * rather than ship an extra half-megabyte only a profiler would find.
 *
 * The check is deliberately two-part. Asserting "no eager chunk holds the
 * linter" alone would also pass if the walk found nothing at all — a green
 * check with no subject. The counter-probe runs first and demands a KNOWN
 * eager `@objectstack/spec`, so the linter verdict is only ever read after the
 * closure walk has proven it can see the very chunk the linter used to hide in.
 *
 * That makes both module-id tests SUBJECTS of the check, not decoration, and
 * neither may be hardcoded here. `OBJECTSTACK_SPEC_DIST` rewrites all 18
 * `@objectstack/spec` specifiers to absolute paths in the overriding tree —
 * `/…/objectstack/packages/spec/dist/…/index.mjs`, ids with no
 * `@objectstack` segment at all — so a private `/@objectstack[\\/+]spec/`
 * matched zero modules, this counter-probe correctly refused a verdict, and it
 * took every injected build down with it (objectui#5388; measured from the
 * consumer side in objectstack#10136, where it blocked the framework's Console
 * Pin Gate). The spec test is therefore a PARAMETER, fed from the same
 * `resolveSpecDistInjection` output the `vendor-objectstack` group already
 * reads: one producer, both consumers, no second opinion about where the spec
 * lives.
 *
 * `LINT` stays literal — nothing injects `@objectstack/lint` today — but it gets
 * its own counter-probe for the same reason, because its failure mode is the
 * worse one. The spec test going blind fails LOUD (this build stops). The lint
 * test going blind fails SILENT: the assertion below is negative, so zero
 * matches reads exactly like a clean bundle and the guard is green forever.
 * objectstack#9659 proposes injecting four more `@objectstack/*` packages the
 * same way and lint is a plausible member; if it ever joins, this build says so
 * instead of quietly ceasing to guard anything.
 */
function assertLazyLinterStaysLazy(specTest: RegExp): Plugin {
  const LINT = WORKSPACE_CHUNK_TESTS.lint;

  return {
    name: 'assert-lazy-linter-stays-lazy',
    generateBundle(_options, bundle) {
      const chunks = new Map<string, Rollup.OutputChunk>();
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') chunks.set(fileName, output);
      }

      // The eager closure: every chunk reachable from an entry chunk through
      // STATIC imports only. `dynamicImports` is deliberately not followed —
      // that edge is precisely the boundary the linter is meant to sit behind.
      const eager = new Set<string>();
      const queue = [...chunks.values()].filter((c) => c.isEntry).map((c) => c.fileName);
      while (queue.length > 0) {
        const fileName = queue.pop() as string;
        if (eager.has(fileName)) continue;
        eager.add(fileName);
        for (const imported of chunks.get(fileName)?.imports ?? []) {
          if (!eager.has(imported)) queue.push(imported);
        }
      }

      const chunksHolding = (test: RegExp): string[] =>
        [...chunks.values()]
          .filter((chunk) => Object.keys(chunk.modules).some((id) => test.test(id)))
          .map((chunk) => chunk.fileName);

      const eagerSpec = chunksHolding(specTest).filter((fileName) => eager.has(fileName));
      if (eagerSpec.length === 0) {
        this.error(
          `[assert-lazy-linter-stays-lazy] counter-probe failed: no eagerly loaded chunk ` +
            `contains an \`@objectstack/spec\` module. The spec is reached synchronously ` +
            `from the app entry, so it must be in the eager closure — its absence means ` +
            `this walk is reading the graph wrongly, not that the bundle improved. ` +
            `Fix the walk before trusting the linter assertion below. ` +
            `If \`OBJECTSTACK_SPEC_DIST\` is set, check that this test carries the ` +
            `override's location: an injected spec resolves outside node_modules and the ` +
            `baseline test cannot see it (objectui#5388). ` +
            `(spec test: ${specTest}; ` +
            `entry chunks: ${[...chunks.values()].filter((c) => c.isEntry).map((c) => c.fileName).join(', ') || 'NONE'}; ` +
            `eager chunks: ${eager.size}/${chunks.size})`,
        );
      }

      // The same refusal-to-guess, for the linter half — and it is needed MORE
      // here, not less. The assertion below is a NEGATIVE one, so a `LINT` that
      // has stopped matching the emitted ids is indistinguishable from a bundle
      // that keeps the linter properly lazy: the guard just goes green and stays
      // green. The linter is always in this bundle somewhere (app-shell's
      // `capabilityLint.ts` `await import`s it), so zero matches ANYWHERE —
      // eager or lazy — is a statement about this regex, never about the graph.
      const lintChunks = chunksHolding(LINT);
      if (lintChunks.length === 0) {
        this.error(
          `[assert-lazy-linter-stays-lazy] counter-probe failed: no chunk at all — eager or ` +
            `lazy — contains an \`@objectstack/lint\` module, so \`${LINT}\` matches nothing in ` +
            `this bundle and the assertion below can no longer fail. Two ways to get here. ` +
            `Either the lazy import in app-shell's \`capabilityLint.ts\` is gone, in which case ` +
            `retire this plugin deliberately rather than leaving a guard with no subject; or ` +
            `the linter's module ids changed shape — e.g. \`@objectstack/lint\` joined the ` +
            `\`OBJECTSTACK_SPEC_DIST\`-style injection proposed in objectstack#9659, which ` +
            `rewrites specifiers to absolute paths with no \`@objectstack\` segment. In that ` +
            `case give this test the injection's location, exactly as the spec test above is ` +
            `already parameterised (objectui#5388). (chunks: ${chunks.size})`,
        );
      }

      const eagerLint = lintChunks.filter((fileName) => eager.has(fileName));
      if (eagerLint.length > 0) {
        this.error(
          `[assert-lazy-linter-stays-lazy] \`@objectstack/lint\` is in the EAGER closure ` +
            `(${eagerLint.join(', ')}), so every console page load pays for it — ~89 KiB ` +
            `gzipped, measured in objectui#5266.\n\n` +
            `The linter is imported lazily on purpose (app-shell's capabilityLint.ts). It ` +
            `becomes eager when an \`advancedChunks\` group claims it, which overrides that ` +
            `laziness. Check \`VENDOR_OBJECTSTACK_TEST\`: under pnpm the module id is\n` +
            `  .../node_modules/.pnpm/@objectstack+lint@<v>/node_modules/@objectstack/lint/dist/index.js\n` +
            `— it matches BOTH of that regex's alternatives, so BOTH need the negative ` +
            `lookahead. Guarding one alternative alone leaves the other matching and looks ` +
            `like a fix while changing nothing.\n\n` +
            `Do NOT "fix" this by switching the import to \`@objectstack/lint/runtime\` — that ` +
            `subpath reaches 70 of the 72 modules the main entry does, is 93.6% of its size, ` +
            `and does not export \`validateCapabilityReferences\` at all (objectstack#9772).`,
        );
      }
    },
  };
}

/**
 * Emits the eager-closure size report the console performance budget weighs.
 *
 * The budget in `.github/workflows/performance-budget.yml` used to gzip one
 * file — the `index-*.js` entry chunk — and call the result "the console
 * performance budget". Measured on `77f846a8b` that chunk is 25.3 KB gzipped
 * against a 350 KB line, while the closure the browser must fetch and parse
 * before the app renders is 3,791 KB across 58 chunks. The gate therefore
 * passed on 0.67% of the payload it claimed to govern, and the 89 KiB
 * regression of objectui#5266 landed in `vendor-objectstack-*.js` where it was
 * structurally invisible (objectui#5324).
 *
 * What the page pays for is the EAGER CLOSURE: every chunk reachable from an
 * entry chunk through STATIC imports only. `dynamicImports` is deliberately not
 * followed — that edge is the lazy boundary, and following it would turn this
 * number into "the whole bundle", which no page load pays.
 *
 * This plugin only MEASURES. The ceiling and the verdict live in
 * `scripts/check-eager-closure-budget.mjs`, which the workflow runs against the
 * report written here. The split is deliberate: a size ceiling that fails
 * `vite build` would also fail every Vercel preview deploy and every local
 * build, which is how a budget gets switched off. The graph knowledge stays
 * here, where rolldown's own `chunk.imports` is authoritative; the policy stays
 * in a file with unit tests.
 *
 * The report is written INTO `dist` on purpose. A report that outlives its
 * build is worse than no report — `rm -rf dist` followed by a stale read is a
 * verdict about a bundle that no longer exists. Living in the output directory
 * makes the report and the bundle the same artifact. It carries only chunk file
 * names and byte counts, all of which are already observable in the deployed
 * bundle itself.
 *
 * Both counter-probes below refuse a verdict rather than report a number that
 * happens to be small, in the spirit of `assertLazyLinterStaysLazy` above:
 * an under-counting walk is the dangerous direction, because the budget's
 * failure mode is silent — a closure walk that finds nothing reads exactly like
 * a bundle that got smaller.
 */
function emitEagerClosureReport(reportFileName = 'eager-closure.json'): Plugin {
  // React is reached synchronously from the entry — nothing in the console
  // renders without it — and `advancedChunks` routes it to its own
  // `vendor-react` chunk, so it is a KNOWN member of the eager closure that is
  // NOT the entry chunk. If the walk cannot see it, the walk is wrong.
  const EAGER_COUNTER_PROBE = /[\\/]node_modules[\\/]react-dom[\\/]/;

  return {
    name: 'emit-eager-closure-report',
    writeBundle(options, bundle) {
      const outDir = options.dir ?? path.resolve(import.meta.dirname, 'dist');

      const chunks = new Map<string, Rollup.OutputChunk>();
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') chunks.set(fileName, output);
      }

      const entries = [...chunks.values()].filter((c) => c.isEntry).map((c) => c.fileName);
      const eager = new Set<string>();
      const queue = [...entries];
      while (queue.length > 0) {
        const fileName = queue.pop() as string;
        if (eager.has(fileName)) continue;
        eager.add(fileName);
        for (const imported of chunks.get(fileName)?.imports ?? []) {
          if (!eager.has(imported)) queue.push(imported);
        }
      }

      // Counter-probe 1 — the walk must SEE something known to be eager.
      // Asserting only "the total is under the ceiling" would also pass on a
      // walk that returned the entry chunk alone, which is the very gauge this
      // report replaces.
      const probeChunks = [...chunks.values()]
        .filter((chunk) => Object.keys(chunk.modules).some((id) => EAGER_COUNTER_PROBE.test(id)))
        .map((chunk) => chunk.fileName);
      const eagerProbe = probeChunks.filter((fileName) => eager.has(fileName));
      if (eagerProbe.length === 0) {
        this.error(
          `[emit-eager-closure-report] counter-probe failed: no eagerly loaded chunk contains ` +
            `a \`react-dom\` module. React is reached synchronously from the app entry, so it ` +
            `must be in the eager closure — its absence means this walk is reading the graph ` +
            `wrongly, not that the bundle improved. Fix the walk before trusting the size ` +
            `below; a walk that finds too little produces a SMALL number, and a budget check ` +
            `reads a small number as good news. ` +
            `(probe: ${EAGER_COUNTER_PROBE}; chunks holding it: ${probeChunks.join(', ') || 'NONE'}; ` +
            `entry chunks: ${entries.join(', ') || 'NONE'}; eager: ${eager.size}/${chunks.size})`,
        );
      }

      // Counter-probe 2 — the other direction. If EVERY chunk is eager then
      // either this bundle has no lazy boundary at all or the walk is following
      // dynamic edges; in both cases the number is not "what a page load costs"
      // and must not be published under that name.
      if (eager.size === chunks.size) {
        this.error(
          `[emit-eager-closure-report] counter-probe failed: every one of the ${chunks.size} ` +
            `chunks is in the eager closure, so this walk is not distinguishing static from ` +
            `dynamic imports. Either \`imports\` has stopped excluding \`dynamicImports\`, or ` +
            `the console genuinely has no lazy boundary left — check which before reading the ` +
            `size as a page-load cost. (entry chunks: ${entries.join(', ') || 'NONE'})`,
        );
      }

      const files = [...eager].sort().map((fileName) => {
        const filePath = path.join(outDir, fileName);

        // A closure member with no file on disk is not a missing build output —
        // it is an UNRESOLVED BARE IMPORT that the walk above swept in. Rolldown
        // lists a chunk's EXTERNAL imports in `chunk.imports` beside the file
        // names of real chunks, and the walk follows that array without asking
        // whether the name is in `chunks`, so a specifier vite could not resolve
        // joins `eager` under its own name and is then read as a path. Left
        // unguarded that is a bare `ENOENT` from `node:fs`, several frames from
        // the cause and naming neither this plugin nor the import (objectui#5996).
        if (!fs.existsSync(filePath)) {
          const importers = [...chunks.values()]
            .filter((chunk) => (chunk.imports ?? []).includes(fileName))
            .map((chunk) => chunk.fileName);
          this.error(
            `[emit-eager-closure-report] eager-closure member \`${fileName}\` has no file in ` +
              `\`${outDir}\`, so its bytes cannot be weighed. It is almost certainly an ` +
              `UNRESOLVED BARE IMPORT, not a missing build output: rolldown lists a chunk's ` +
              `EXTERNAL imports in \`chunk.imports\` beside the file names of real chunks, and ` +
              `the walk above follows that array, so a specifier vite could not resolve enters ` +
              `the closure under its own name and is then read as a path. The name is the tell — ` +
              `a real chunk here is \`assets/<name>-<hash>.js\`, and this one is not a key of the ` +
              `output bundle map at all. (imported by: ${importers.join(', ') || 'NONE'}) ` +
              `Fix the import rather than skipping the member here: a bare specifier the browser ` +
              `cannot load is a broken bundle, not a measurement gap, and dropping it from the ` +
              `walk would make this report under-count — the one direction the counter-probes ` +
              `above exist to refuse. The known source is an out-of-tree override whose own ` +
              `dependencies do not resolve from where it lives: check \`OBJECTSTACK_CLIENT_DIST\` ` +
              `and \`OBJECTSTACK_SPEC_DIST\`, and vite's own "could not be resolved" warnings ` +
              `earlier in this build.`,
          );
        }

        // The chunk's OWN name, as rolldown recorded it — the `advancedChunks`
        // group name for a grouped chunk, the entry's name for an entry. The
        // per-chunk ceilings in `scripts/check-eager-closure-budget.mjs` key on
        // this field (objectui#5490) instead of stripping the hash out of
        // `fileName` themselves: the group names are decided by `advancedChunks`
        // a few hundred lines below, and a budget that re-derives them from a
        // file name is a second opinion about the same fact — one that goes on
        // reading plausibly while it matches nothing.
        const name = chunks.get(fileName)?.name;
        if (typeof name !== 'string' || name === '') {
          this.error(
            `[emit-eager-closure-report] eager-closure member \`${fileName}\` carries no chunk ` +
              `\`name\` (${JSON.stringify(name)}), so a per-chunk ceiling has no way to find ` +
              `its subject. Refused rather than published: a budgeted chunk MISSING from this ` +
              `report is a budget with nothing to weigh, and a budget that weighs nothing ` +
              `passes — the silent direction every counter-probe in this plugin exists to ` +
              `refuse (objectui#5490).`,
          );
        }

        const raw = fs.readFileSync(filePath);
        // Level 6 — zlib's default, and the level `gzip -c` uses in the
        // workflow's entry-chunk check, so the two numbers in one PR comment
        // are measured the same way.
        return { fileName, name, bytes: raw.length, gzipBytes: zlib.gzipSync(raw).length };
      });

      const report = {
        // Bumped when the shape below changes; the checker refuses a report it
        // does not understand rather than reading absent fields as zero. v2
        // added `files[].name` for the per-chunk ceilings (objectui#5490) — a
        // v1 report reaching the v2 checker is therefore a REFUSAL, not a run
        // in which every budgeted chunk happens to be missing.
        reportVersion: 2,
        entryChunks: entries.sort(),
        eagerChunkCount: files.length,
        totalChunkCount: chunks.size,
        eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
        eagerRawBytes: files.reduce((n, f) => n + f.bytes, 0),
        files,
      };

      fs.writeFileSync(path.join(outDir, reportFileName), `${JSON.stringify(report, null, 2)}\n`);
      const kb = (report.eagerGzipBytes / 1024).toFixed(1);
      this.info(
        `eager closure: ${report.eagerChunkCount}/${report.totalChunkCount} chunks, ` +
          `${report.eagerGzipBytes} bytes gzipped (${kb} KB) → ${reportFileName}`,
      );
    },
  };
}

/**
 * Emits `dist/chunk-membership.json` — which CHUNK each workspace package's
 * modules were written to, counted over EVERY chunk in the bundle.
 *
 * ## Why this exists (objectui#9345)
 *
 * `advancedChunks.groups` declares membership by regex, and a group can end up
 * holding modules no regex of its own matches: rolldown's
 * `includeDependenciesRecursively` lets a higher-priority group take a
 * lower-priority group's declared members along an import edge. When that
 * happened to `packages/core` the per-chunk ceilings above it went GREEN — the
 * bytes had moved to a chunk with no ceiling, while the browser went on
 * downloading every one of them. A budget that weighs named chunks is bypassed
 * by moving bytes between chunks, and nothing in this repository could see it.
 *
 * So the verdict this feeds (`evaluatePerChunkMembership` in
 * `scripts/check-eager-closure-budget.mjs`) asks a question no byte count can:
 * did each budgeted group's declared packages actually land where the config
 * says? ⛔ It is an EXACT claim, not a ratchet — a single stray module is a
 * finding, named.
 *
 * ## Why a separate file rather than a field of `eager-closure.json`
 *
 * That report's `reportVersion` is a contract with a SECOND reader —
 * `scripts/check-eager-locale-catalogues.mjs` pins the version it accepts, and
 * its own tests pin that a later version is REFUSED. Growing a new required
 * field there means bumping that version and revising a deliberate refusal in
 * a gate this card does not touch. A separate artifact with its own version
 * costs one file and bends no existing contract.
 *
 * ## What it counts, said in words
 *
 * The population is every module in every emitted chunk whose id contains a
 * `packages/<name>/` segment — workspace source, not `node_modules`, and not
 * limited to the eager closure: a budgeted package's module hiding in a LAZY
 * chunk is exactly as much a membership breach as one hiding in an eager
 * neighbour, and the eager-closure walk cannot see it.
 *
 * ## Why it counts DIRECTORIES as well as packages (objectui#10065)
 *
 * A package is not always one chunk's by design. `packages/types` is split on
 * purpose: its `src/zod/**` validators go to the lazy `types-zod` group and the
 * rest stays in `framework`. A per-package count can say "types landed in
 * `framework` and `types-zod`", and it cannot say WHICH modules — so the
 * failure that split was measured to produce (three shared `src/` neighbours
 * absorbed into `types-zod` along an import, every byte of it eager again)
 * reads exactly like the healthy split. `directories` keys the same counts by
 * each module's package-relative directory, which is the granularity a
 * declared carve-out is written at, so the checker can hold the split to the
 * module rather than to the package. ⛔ It records what landed, and nothing
 * about what was DECLARED — this plugin reads no declaration, so the artifact
 * cannot agree with a wrong one.
 *
 * ⚠️ This plugin only MEASURES — same split as `emitEagerClosureReport` above,
 * and for the same reason: a membership verdict that failed `vite build` would
 * fail every preview deploy too, which is how a gate gets switched off.
 */
function emitChunkMembershipReport(reportFileName = 'chunk-membership.json'): Plugin {
  // The module ids rolldown records are realpaths, so a workspace module reads
  // as `<repo>/packages/<name>/src/...` no matter which symlink resolved it —
  // the same assumption the `advancedChunks` group tests above are written on.
  // The second capture is the rest of the id — the package-relative path the
  // `directories` table is keyed by (its directory, `/`-separated, any query
  // suffix dropped: `?inline` and friends are the same file).
  const WORKSPACE_MODULE = /[\\/]packages[\\/]([^\\/]+)[\\/](.*)$/;
  const directoryOf = (rest: string) => {
    const file = rest.split('?')[0].replace(/\\/g, '/');
    const slash = file.lastIndexOf('/');
    return slash === -1 ? '.' : file.slice(0, slash);
  };

  return {
    name: 'emit-chunk-membership-report',
    writeBundle(options, bundle) {
      const outDir = options.dir ?? path.resolve(import.meta.dirname, 'dist');

      /** package name -> chunk name -> how many of its modules landed there. */
      const packages: Record<string, Record<string, number>> = {};
      /** package name -> package-relative directory -> chunk name -> count. */
      const directories: Record<string, Record<string, Record<string, number>>> = {};
      let totalChunkCount = 0;
      let unnamedChunks = 0;

      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        totalChunkCount += 1;
        const chunkName = output.name;
        if (typeof chunkName !== 'string' || chunkName === '') {
          unnamedChunks += 1;
          continue;
        }
        for (const id of Object.keys(output.modules)) {
          const match = WORKSPACE_MODULE.exec(id);
          if (!match) continue;
          const pkg = match[1];
          (packages[pkg] ??= {})[chunkName] = (packages[pkg][chunkName] ?? 0) + 1;
          const byChunk = ((directories[pkg] ??= {})[directoryOf(match[2])] ??= {});
          byChunk[chunkName] = (byChunk[chunkName] ?? 0) + 1;
        }
      }

      // Counter-probe 1 — an unnamed chunk is a HOLE in this report, not a
      // cosmetic gap: a budgeted package's module sitting in one would be
      // counted nowhere, and "nowhere" reads to the checker exactly like "not
      // in a chunk it should not be in". Refused rather than published, in the
      // same direction as every probe in `emitEagerClosureReport` above.
      if (unnamedChunks > 0) {
        this.error(
          `[emit-chunk-membership-report] ${unnamedChunks} emitted chunk(s) carry no \`name\`, so ` +
            `any workspace module inside them would be attributed to NOTHING. A membership check ` +
            `reads an absent attribution as "no stray module", which is the silent direction: it ` +
            `would pass by measuring less, not by finding less. Fix the chunk naming before ` +
            `publishing this report.`,
        );
      }

      // Counter-probe 2 — the other direction, and the one that matters most
      // for a check whose green state is "nothing was found somewhere it should
      // not be". A report naming no workspace package at all makes every
      // membership claim vacuously true.
      const packageCount = Object.keys(packages).length;
      if (packageCount === 0) {
        this.error(
          `[emit-chunk-membership-report] not one emitted module id matched ` +
            `\`${WORKSPACE_MODULE}\`, so this report attributes NOTHING and every membership ` +
            `assertion built on it would agree with everything. Either the bundle contains no ` +
            `workspace source — which the console cannot be built without — or module ids have ` +
            `stopped being realpaths under \`packages/\` and this matcher needs rewriting.`,
        );
      }

      const report = {
        // Independent of `eager-closure.json`'s version on purpose; see the
        // docblock above. Bump when the shape below changes, so a stale report
        // is REFUSED rather than read for fields it does not carry. v2 added
        // `directories` (objectui#10065's split, see the docblock).
        membershipReportVersion: 2,
        totalChunkCount,
        packages,
        directories,
      };

      fs.writeFileSync(path.join(outDir, reportFileName), `${JSON.stringify(report, null, 2)}\n`);
      this.info(
        `chunk membership: ${packageCount} workspace packages attributed across the bundle ` +
          `→ ${reportFileName}`,
      );
    },
  };
}

/**
 * Dev-only Vite plugin: serves runtime branding assets at /runtime/assets/*.
 *
 * When the console dev server runs standalone (port 5180), the backend does
 * not proxy /runtime requests.  This plugin looks for assets in the host
 * project's `runtime/assets/` directory (four levels up from apps/console)
 * so URLs like /runtime/assets/logo.png resolve.
 *
 * Non-blocking — silently skips when the directory doesn't exist.
 */
function serveRuntimeAssets(): Plugin {
  const ASSETS_DIR = path.resolve(import.meta.dirname, '../../../../runtime/assets');
  const MIME: Record<string, string> = {
    '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  };

  return {
    name: 'serve-runtime-assets',
    apply: 'serve', // dev-only — prod builds include assets in the bundle
    configureServer(server) {
      if (!fs.existsSync(ASSETS_DIR)) return;
      server.middlewares.use('/runtime/assets', (req, res, next) => {
        const filename = (req.url || '').replace(/^\/+/, '').replace(/[?#].*$/, '');
        if (!filename) { next(); return; }
        const filePath = path.join(ASSETS_DIR, filename);
        if (!filePath.startsWith(ASSETS_DIR)) { next(); return; } // path traversal guard
        try {
          const content = fs.readFileSync(filePath);
          res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
          res.statusCode = 200;
          res.end(content);
        } catch {
          next();
        }
      });
    },
  };
}

// Base path for SPA deployment.
//
// Default: './' (relative) — makes the build path-agnostic, so the same
// dist/ works under any mount point (/_console/, /console/, /foo/bar/).
// This is required for the package to be embeddable in arbitrary
// ObjectStack servers.
//
// Demo / standalone deployments can pin an absolute base via
// VITE_BASE_PATH (e.g. '/console/') so static asset caching keys are
// stable across HTML revisions.
const basePath = process.env.VITE_BASE_PATH || './';

// The console's build identity (objectui#12970): `VITE_APP_VERSION` from the
// build's environment when it is set (a CI or Docker build passes the objectui
// commit), else the short sha of `HEAD` read from git right here, so a local
// build names its commit too. Baked as `import.meta.env.VITE_APP_VERSION` — the
// one spelling `@object-ui/app-shell`'s `buildIdentity.ts` reads for both the
// help menu's About dialog and Sentry's release fallback. With neither (a build
// context without `.git`), nothing is baked and the dialog says the build is
// unknown. `rev-parse` answers in a shallow clone and on a detached HEAD alike.
function readGitShortSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
const consoleBuild = process.env.VITE_APP_VERSION?.trim() || readGitShortSha();

// On Vercel/CI we skip the compression and visualizer plugins because the
// Vercel CDN handles gzip/brotli automatically and bundle analysis is not
// needed during CI builds.  This reduces peak memory by ~1.5 GB.
//
// Workspace src/ aliases are kept in ALL environments (dev + CI) so that
// plugin side-effect imports (ComponentRegistry.register) resolve correctly.
// Without them, Vite would import pre-built dist/ bundles where the
// singleton ComponentRegistry can get duplicated across chunks, causing
// "Unknown component type" errors at runtime.
const isCI = !!(process.env.VERCEL || process.env.CI);

// Workspace src/ aliases — gives instant HMR in dev and ensures correct
// side-effect resolution (plugin registrations) in production builds.
const workspaceAliases: Record<string, string> = {
  '@object-ui/components': path.resolve(import.meta.dirname, '../../packages/components/src'),
  '@object-ui/core': path.resolve(import.meta.dirname, '../../packages/core/src'),
  '@object-ui/react-runtime': path.resolve(import.meta.dirname, '../../packages/react-runtime/src'),
  '@object-ui/sdui-parser': path.resolve(import.meta.dirname, '../../packages/sdui-parser/src'),
  '@object-ui/fields': path.resolve(import.meta.dirname, '../../packages/fields/src'),
  '@object-ui/layout': path.resolve(import.meta.dirname, '../../packages/layout/src'),
  '@object-ui/plugin-dashboard': path.resolve(import.meta.dirname, '../../packages/plugin-dashboard/src'),
  '@object-ui/plugin-report': path.resolve(import.meta.dirname, '../../packages/plugin-report/src'),
  '@object-ui/plugin-form': path.resolve(import.meta.dirname, '../../packages/plugin-form/src'),
  '@object-ui/plugin-grid': path.resolve(import.meta.dirname, '../../packages/plugin-grid/src'),
  '@object-ui/react': path.resolve(import.meta.dirname, '../../packages/react/src'),
  // The `/zod` subpath must be aliased BEFORE the bare package: a vite string
  // alias matches by PREFIX, so `@object-ui/types/zod` would otherwise resolve to
  // the `src/zod` DIRECTORY, which has no `index.ts` (the barrel is
  // `index.zod.ts`) — UNLOADABLE_DEPENDENCY at build time. Mirrors the pairing
  // in the root `vitest.config.mts`.
  '@object-ui/types/zod': path.resolve(import.meta.dirname, '../../packages/types/src/zod/index.zod.ts'),
  '@object-ui/types': path.resolve(import.meta.dirname, '../../packages/types/src'),
  '@object-ui/data-objectstack': path.resolve(import.meta.dirname, '../../packages/data-objectstack/src'),
  '@object-ui/auth': path.resolve(import.meta.dirname, '../../packages/auth/src'),
  '@object-ui/permissions': path.resolve(import.meta.dirname, '../../packages/permissions/src'),
  '@object-ui/providers': path.resolve(import.meta.dirname, '../../packages/providers/src'),
  '@object-ui/collaboration': path.resolve(import.meta.dirname, '../../packages/collaboration/src'),
  '@object-ui/i18n': path.resolve(import.meta.dirname, '../../packages/i18n/src'),
  '@object-ui/mobile': path.resolve(import.meta.dirname, '../../packages/mobile/src'),
  '@object-ui/app-shell': path.resolve(import.meta.dirname, '../../packages/app-shell/src'),

  // Plugin Aliases
  '@object-ui/plugin-calendar': path.resolve(import.meta.dirname, '../../packages/plugin-calendar/src'),
  '@object-ui/plugin-charts': path.resolve(import.meta.dirname, '../../packages/plugin-charts/src'),
  // `/core` before the bare package, for the prefix-match reason given on
  // `@object-ui/types/zod` above (objectui#13410).
  '@object-ui/plugin-chatbot/core': path.resolve(import.meta.dirname, '../../packages/plugin-chatbot/src/core.ts'),
  '@object-ui/plugin-chatbot': path.resolve(import.meta.dirname, '../../packages/plugin-chatbot/src'),
  '@object-ui/plugin-detail': path.resolve(import.meta.dirname, '../../packages/plugin-detail/src'),
  '@object-ui/plugin-editor': path.resolve(import.meta.dirname, '../../packages/plugin-editor/src'),
  '@object-ui/plugin-gantt': path.resolve(import.meta.dirname, '../../packages/plugin-gantt/src'),
  '@object-ui/plugin-kanban': path.resolve(import.meta.dirname, '../../packages/plugin-kanban/src'),
  '@object-ui/plugin-list': path.resolve(import.meta.dirname, '../../packages/plugin-list/src'),
  '@object-ui/plugin-map': path.resolve(import.meta.dirname, '../../packages/plugin-map/src'),
  '@object-ui/plugin-markdown': path.resolve(import.meta.dirname, '../../packages/plugin-markdown/src'),
  '@object-ui/plugin-timeline': path.resolve(import.meta.dirname, '../../packages/plugin-timeline/src'),
  '@object-ui/plugin-tree': path.resolve(import.meta.dirname, '../../packages/plugin-tree/src'),
  '@object-ui/plugin-view': path.resolve(import.meta.dirname, '../../packages/plugin-view/src'),
  '@object-ui/plugin-designer': path.resolve(import.meta.dirname, '../../packages/plugin-designer/src'),
};

// Opt-in override of the installed `@objectstack/client`. The published client
// (11.2.0) predates the async import-job API (`data.createImportJob` et al.),
// so to exercise the full background-import + undo flow through the real
// console before that client ships, point OBJECTSTACK_CLIENT_DIST at a locally
// built client (its dist entry or package dir). Inert when unset — production
// and CI builds use the installed client unchanged.
//
// No longer a bare string alias: the value is VALIDATED before it is aliased —
// the path must exist, it must sit inside a `@objectstack/client` package
// (directory, `dist/`, or an entry file all resolve to the same package), and
// that package's own declared `dependencies` must resolve from where it lives.
// Without that last check an out-of-tree override produced a fully written
// bundle whose bare specifiers no browser can load, and nothing in the build
// output named this variable — objectui#6094, the client twin of the spec
// hook's objectui#5391. See the module for the measurement and for why the
// check is re-stated there rather than shared with the spec hook.
const clientDistInjection = resolveClientDistInjection(process.env.OBJECTSTACK_CLIENT_DIST);
if (clientDistInjection) workspaceAliases['@objectstack/client'] = clientDistInjection.aliasTarget;

// Extra dirs the dev server may read the override from — it lives outside the
// workspace root, so Vite's default `server.fs.allow` would 403 it (blank page).
// Unchanged values: the containing package (…/dist/index.mjs → …/<pkg>) and its
// parent, now computed beside the validation that vouches for the path.
const clientFsAllow: string[] = clientDistInjection ? clientDistInjection.fsAllow : [];

// Deps pre-bundled for the dev server. Build-time pre-bundling was removed in
// Vite 5.1, so this list is read by `pnpm dev` only, never by `vite build` —
// which is why no build or E2E job can see a bad entry here.
//
// Vite resolves every entry from THIS directory (the dev root), under the dev
// conditions, before the server listens (objectui#10865). An entry naming a
// subpath the installed package does not export aborts the start: a bare
// `react-map-gl` did, since react-map-gl 8 exports no `.`. An entry naming a
// package this app does not depend on is skipped with a warning and pre-bundles
// nothing: `maplibre-gl` was one, and needs no entry of its own, because the
// `react-map-gl/maplibre` pre-bundle already carries it. The console-config
// cases in `scripts/__tests__/vite-objectstack-spec-dist.test.ts` resolve every
// entry the way the dev server does.
const OPTIMIZE_DEPS_INCLUDE = [
  '@objectstack/spec',
  '@objectstack/spec/data',
  '@objectstack/spec/system',
  '@objectstack/spec/ui',
  'react-map-gl/maplibre'
];

// Baseline `vendor-objectstack` grouping: the installed spec/client, reached
// either through `node_modules/@objectstack/` or through pnpm's flattened
// `@objectstack+<pkg>` store path.
//
// `@objectstack/lint` is excluded. It is reached from exactly one place —
// `packages/app-shell/src/preview/capabilityLint.ts`, through a deliberate
// `await import('@objectstack/lint')` that runs only when an author publishes
// in the metadata designer. Without the exclusion this group overrides that
// async-only reachability and folds the linter in beside `@objectstack/spec`
// and `@objectstack/client`, which the app entry reaches synchronously — so
// the group's chunk is a STATIC import of the entry and every console page
// load downloads and parses the whole linter (objectui#5266).
//
// BOTH alternatives need the guard, and that is not redundancy: under pnpm a
// dependency resolves through the store, so the module's id is
//   .../node_modules/.pnpm/@objectstack+lint@<v>/node_modules/@objectstack/lint/dist/index.js
// — one path containing BOTH `/@objectstack+` and `/node_modules/@objectstack/`.
// Guarding either alternative alone leaves the other one matching, and the
// linter stays in the eager chunk with no visible symptom.
//
// The lookaheads are deliberately tight: `lint[\\/]` and `lint@` match the
// `lint` package only, so a future `@objectstack/lint-*` sibling still groups
// here rather than silently scattering into its importers' chunks.
//
// objectstack ruling D1: inside the objectstack monorepo (objectui as `ui/`)
// the framework packages are workspace links, so Vite sees their REAL paths
// (`<monorepo root>/packages/<name>/dist/...`), never a node_modules spelling.
// The monorepo's own `packages/` directory therefore joins this test, the
// spec counter-probe and the lazy-linter guard below as one more alternative;
// standalone that directory does not exist and the alternative matches
// nothing. The three tests are built in `scripts/vite-objectstack-workspace.ts`
// so a unit test can read them -- its header carries the measurement.
const WORKSPACE_CHUNK_TESTS = workspaceChunkTests(frameworkPackagesDir(import.meta.dirname));
const VENDOR_OBJECTSTACK_TEST = WORKSPACE_CHUNK_TESTS.vendor;

// "This module id IS `@objectstack/spec`" — the subject of the counter-probe in
// `assertLazyLinterStaysLazy` above, kept separate from the group test on
// purpose. `VENDOR_OBJECTSTACK_TEST` is the whole vendor scope minus the linter,
// so an eager `@objectstack/client` would satisfy it without proving the walk
// can see the SPEC chunk the counter-probe exists to find — reusing it there
// would keep the build green by lowering the bar, which is the one outcome
// objectui#5388 must not produce. Both spellings are covered: a plain install
// (`/node_modules/@objectstack/spec/…`) and pnpm's store (`/@objectstack+spec@…`),
// plus the monorepo's workspace path (see `WORKSPACE_CHUNK_TESTS` above).
const SPEC_MODULE_TEST = WORKSPACE_CHUNK_TESTS.spec;

// Opt-in override of the installed `@objectstack/spec` — the spec twin of
// OBJECTSTACK_CLIENT_DIST above, so a framework build can bundle the console
// against its OWN spec instead of the last published one (objectui#4854, ruled
// on objectstack#8134). Point it at a built spec package (its directory, its
// `dist/`, or an entry file inside it).
//
// It is NOT a copy of the client line: `@objectstack/spec` publishes an 18-entry
// exports map that redirects every subpath into `dist/`, and a Vite string alias
// does not consult exports maps. So the injection is derived from the OVERRIDE's
// own exports map, one alias per entry — see the module for the derivation and
// for why every failure mode throws instead of falling back.
//
// Inert when unset: `null` here leaves the alias table, the pre-bundle list, the
// vendor chunk test and the dev server's fs allow-list at their baseline values.
//
// The injected spec also arrives with its OWN install tree, so left alone its
// bare `zod` import resolves to the framework's zod and the bundle carries two
// instances — at the console pin objectui#11327 was reported against, the
// Studio's spec-derived forms crashed in `z.toJSONSchema` over them. The
// injection therefore pins every `zod` import to ONE
// copy: the one `CONSOLE_ZOD_ANCHOR` resolves. That package is the anchor
// because it is where the console walks spec schemas with its own zod (the
// metadata-admin `*-schema.ts` modules) and it declares `zod` itself; the
// injection refuses the build when that copy is outside the range the
// injected spec declares.
const CONSOLE_ZOD_ANCHOR = path.resolve(import.meta.dirname, '../../packages/app-shell');
const specDistInjection = resolveSpecDistInjection(process.env.OBJECTSTACK_SPEC_DIST, {
  vendorChunkTest: VENDOR_OBJECTSTACK_TEST,
  specModuleTest: SPEC_MODULE_TEST,
  consoleZodFrom: CONSOLE_ZOD_ANCHOR,
});
if (specDistInjection) Object.assign(workspaceAliases, specDistInjection.aliases);

// objectui#9408 — say which condition arm every entry came from, out loud.
//
// The resolver used to walk its OWN preference array instead of the exports
// map's key order, so the five `browser`-first entries silently resolved to the
// Node arm and the arm added to keep a browser build off `require('fs')` was
// unreachable. Nothing in the build said so. The fix makes the pick correct; the
// table makes it CHECKABLE — a wrong arm is now one grep in the build log
// instead of an unattributable bundler error at some later pin bump.
//
// Printed only when the override is live, so a normal build stays quiet, and to
// stderr so it cannot land in anything that parses stdout.
if (specDistInjection) {
  for (const line of formatConditionReport(specDistInjection)) console.error(line);
}

const specFsAllow: string[] = specDistInjection ? specDistInjection.fsAllow : [];

// Pre-bundling an ALIASED, out-of-workspace dep is opt-in through this list and
// nothing else: Vite's pre-alias plugin only registers such a resolution as a
// dep when `optimizeDeps.include` names the specifier. Keeping the four spec
// entries while the override is live would therefore park the injected spec in
// `node_modules/.vite`, whose cache key does not move when the framework
// rebuilds its spec in place — a stale pre-bundle serving yesterday's schema is
// the same silent skew this hook exists to end. Dropping them costs a colder
// dev start and nothing else; `vite build` never reads this list.
const optimizeDepsInclude = specDistInjection
  ? OPTIMIZE_DEPS_INCLUDE.filter((specifier) => !Object.hasOwn(specDistInjection.aliases, specifier))
  : OPTIMIZE_DEPS_INCLUDE;

// An injected spec resolves OUTSIDE node_modules, so the baseline test above
// stops matching it and the biggest vendor surface in the bundle (spec is
// imported by 29 packages here) would scatter into its importers' chunks. The
// injected build should differ from a released one in spec CONTENT, not in
// chunk layout, so the override's location joins the group's test. The same
// holds for an injected CLIENT, and there the layout is not cosmetic: left out
// of this group it lands in `framework`, closing a framework ↔ data-adapter
// import cycle that kills the console at boot (see the helper's docblock).
const vendorObjectstackTest = widenVendorChunkTestForClient(
  specDistInjection ? specDistInjection.vendorChunkTest : VENDOR_OBJECTSTACK_TEST,
  clientDistInjection,
);

// A lucide icon module, captured by its file name (`circle-arrow-up`). Read by
// the `vendor-icons-shell` group below.
const LUCIDE_ICON_MODULE = /[\\/]node_modules[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]([a-z0-9-]+)\.mjs$/;

// Icons that rolldown tags `$initial` and the bundle still loads lazily, so
// `vendor-icons-shell` must not claim them. Why, and how the list was taken:
// the note on that group (objectui#12187).
const LAZY_ONLY_INITIAL_ICONS: ReadonlySet<string> = new Set([
  'circle-arrow-up',
  'folder-tree',
  'webhook',
]);

// The chunk grouping is not the only consumer of "where does the spec live".
// `assertLazyLinterStaysLazy`'s counter-probe asks the same question about the
// emitted module ids, and it used to answer it from a private regex that the
// injection made unmatchable — so every build with the override set died on a
// counter-probe that was right about what it saw (objectui#5388). It reads the
// override's location here, from the same producer, for the same reason.
const specModuleTest = specDistInjection
  ? specDistInjection.specModuleTest
  : SPEC_MODULE_TEST;

// https://vitejs.dev/config/
export default defineConfig({
  base: basePath,
  define: {
    'process.env': {},
    'process.platform': '"browser"',
    'process.version': '"0.0.0"',
    ...(consoleBuild ? { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(consoleBuild) } : {}),
  },

  plugins: [
    viteCryptoStub(),
    react(),
    // Inject <link rel="modulepreload"> for critical chunks
    preloadCriticalChunks(),
    // Fails the build if the lazily-imported linter is folded back into an
    // eagerly-loaded chunk. Runs on CI/Vercel too — it costs microseconds and
    // the regression it catches is invisible in every other signal.
    assertLazyLinterStaysLazy(specModuleTest),
    // Under OBJECTSTACK_SPEC_DIST: resolve every bare `zod` import — the injected
    // spec's included — to the console's one copy (objectui#11327). Registered
    // only while the override is live, like every other injection surface.
    ...(specDistInjection ? [specDistInjection.singleZodPlugin] : []),
    // …and in EVERY build, injected or not: fail when the emitted chunks carry
    // more than one zod instance, or none at all (the counter-probe). Measures
    // the outcome rather than trusting the redirect above, because the first
    // mechanism tried for this (`resolve.dedupe`, see below) was a silent no-op.
    assertSingleZodInstance(),
    // The same refusal one directory over: fails the build if the
    // `@object-ui/types/zod` validators rejoin the eager closure, AND if they
    // stop being reachable from `@object-ui/plugin-map` at all (objectui#10065).
    // The second half is the one no byte ceiling can supply — validators DELETED
    // from the graph and validators DEFERRED behind the map view's lazy boundary
    // produce the same smaller, greener number, and only one of them still
    // renders an object map.
    viteTypesZodLazy(),
    // Writes `dist/eager-closure.json` — the size of everything a page load
    // pays for before the app renders. `.github/workflows/performance-budget.yml`
    // weighs THAT against the budget; weighing the entry chunk alone measured
    // 0.67% of it (objectui#5324). Measurement only: the verdict is the
    // workflow's, so a size regression never blocks a preview deploy.
    emitEagerClosureReport(),
    // Writes `dist/chunk-membership.json` — which chunk each workspace
    // package's modules were written to. The per-chunk ceilings weigh BYTES,
    // and bytes can be moved off a budgeted line without shrinking by one
    // (objectui#9345); this is the artifact that lets the same gate assert
    // WHERE a budgeted group's declared packages landed. Measurement only,
    // same as above.
    emitChunkMembershipReport(),
    // Rolldown's `INEFFECTIVE_DYNAMIC_IMPORT` warnings, pinned to a ledger
    // instead of scrolling past 43 at a time (objectui#5325). The pinned ones
    // are replaced by one summary line; an UNPINNED one keeps rolldown's own
    // warning text AND fails the build, and so does a pinned one that stops
    // firing — the counter-probe, because a build that dies before chunk
    // assignment reports zero of these and that reads exactly like "fixed".
    viteIneffectiveDynamicImports(),
    // Keeps `AppContent`'s `lazy()` view declarations and the eager closure in
    // agreement (objectui#6535). Two halves, one parsed list: it declares the
    // pure route-view modules `moduleSideEffects: false` — without which the
    // `@object-ui/app-shell` barrel's named re-exports hold five of them in the
    // eager closure, since that package publishes no `sideEffects` field — and
    // it then FAILS the build if a declared-lazy view is eager anyway and not
    // pinned, or if a pinned one has quietly become lazy. Runs before
    // `emitEagerClosureReport` reads the same graph.
    viteDeclaredLazyViews(),
    // maplibre-gl loads its worker as a sibling of its own chunk URL — an
    // edge no bundler can see — so the worker (and the shared module it
    // imports) must be copied into assets/ or every map page 404s
    // (objectui#3297). Asserts on drift; never silently skips.
    viteMaplibreWorker(),
    // Dev-only plugin: serve runtime assets (product logo/favicon) from the
    // host project's runtime/assets directory so branding URLs configured
    // via OS_LOGO_URL / OS_FAVICON_URL resolve without a fragile symlink.
    serveRuntimeAssets(),
    // Gzip/Brotli compression & bundle visualizer are skipped on Vercel/CI to
    // reduce memory usage — Vercel's CDN compresses assets automatically.
    ...(!isCI ? [
      // `algorithms` (plural, an array) is the key vite-plugin-compression2
      // declares. The singular `algorithm` used here before was never read: it
      // fell through to the plugin's default, which is BOTH
      // `['gzip', 'brotliCompress']` — so each of these two instances was
      // compressing every asset twice, and the `.gz`/`.br` pair that made the
      // build look correct came from the default, not from these options
      // (objectui#3305).
      compression({
        algorithms: ['gzip'],
        exclude: [/\.(br)$/, /\.(gz)$/],
        threshold: 1024,
      }),
      compression({
        algorithms: ['brotliCompress'],
        exclude: [/\.(br)$/, /\.(gz)$/],
        threshold: 1024,
      }),
      visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
        open: false,
      }),
    ] : []),
  ],
  resolve: {
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: workspaceAliases,
    // Force a SINGLE copy of these libraries. The monorepo resolves slightly
    // different React patch versions (19.2.6 vs 19.2.7) across packages, which
    // duplicates `react`/`react-dom` and, downstream, `sonner` — so
    // plugin-form's `toast()` and the console's `<Toaster>` ended up bound to
    // different sonner instances and toasts never rendered (the "click does
    // nothing — no feedback" bug). Deduping keeps one instance so context,
    // hooks, and the sonner observer all line up.
    //
    // ⛔ `zod` is deliberately NOT listed. Dedupe resolves a listed package from
    // the Vite root, and this root (`apps/console`) declares no `zod`: the
    // lookup finds nothing and Vite falls back to each importer's own copy
    // without a warning. Measured on objectui#11327 with OBJECTSTACK_SPEC_DIST
    // set — adding `zod` here emitted the same two zod copies, byte-identical.
    // The one-zod rule is held by `specDistInjection.singleZodPlugin` and
    // checked by `assertSingleZodInstance` in the plugin list above.
    dedupe: ['react', 'react-dom', 'sonner'],
  },
  optimizeDeps: {
    include: optimizeDepsInclude
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    cssCodeSplit: true,
    // Don't pre-emit `<link rel="modulepreload">` for every chunk; it
    // negates lazy-loading by pulling all 1700+ icon chunks and heavy
    // plugin chunks during the initial HTML parse.
    modulePreload: false,
    commonjsOptions: {
      include: [/node_modules/, /packages/],
      transformMixedEsModules: true
    },
    rollupOptions: {
      output: {
        // Use rolldown's `advancedChunks.groups` instead of legacy
        // `manualChunks`. Rolldown's manualChunks function is unreliable for
        // shared modules — it often merges them into the first importer's
        // chunk regardless of the function's return value. The `groups` API
        // explicitly partitions modules with priority/test/name semantics.
        advancedChunks: {
          groups: [
            //
            // ## `use-sync-external-store` is React glue, so `vendor-react` names it (objectui#11798)
            //
            // Recharts reaches the page only through `import()` (the lazy
            // `chart` / `object-chart` registrations in `register-plugins.ts`,
            // and the lazy `ChartRenderer` in app-shell's dataset preview), so
            // `vendor-charts` is meant to load with the first chart. It loaded
            // with EVERY page instead. A group captures its `test` matches AND,
            // by rolldown's default `includeDependenciesRecursively: true`,
            // everything they import, and recharts imports
            // `use-sync-external-store/shim` through `react-redux`. Unnamed by
            // any group, that shim went to `vendor-charts`, which won the
            // priority-90 tie for it against `vendor-i18n` (listed below it).
            // `react-i18next`'s `useTranslation` imports the same shim
            // statically, so the eager `vendor-i18n` chunk imported
            // `vendor-charts`, and the whole chart engine (recharts and d3) rode
            // into the eager closure on a few hundred bytes of React glue. No
            // chart module was statically reachable from the entry: the chunk
            // rule alone made them eager, the objectui#5266 mechanism one group
            // over.
            //
            // The repair names the shim's owner. This group outranks every
            // other, so it claims `use-sync-external-store` first, and rolldown
            // removes a module a higher-priority group claimed from the groups
            // below it. `vendor-charts` keeps its default recursive capture and
            // its own members; it just no longer holds a module an eager chunk
            // needs. Whether a `vendor-charts` file is in the closure is what
            // `apps/console/dist/eager-closure.json` answers after a build, and
            // `pnpm check:eager-closure` weighs it.
            //
            // ⛔ Not `includeDependenciesRecursively: false` on `vendor-charts`,
            // the other way to stop that capture. Measured on the console build
            // of `8cc10b9` (a historical reading, ⛔ not re-derived by anything):
            // recharts' other dependencies then fell to the recursive
            // `plugin-charts` group, `plugin-charts` and `vendor-charts` imported
            // each other, and a `chart` node rendered "Failed to load plugin: A
            // is not a function" instead of a chart. That is the invalid-chunk
            // risk rolldown documents for the flag, which the `data-adapter`
            // note below says a new group taking it must re-check.
            {
              name: 'vendor-react',
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler|use-sync-external-store)[\\/]/,
              priority: 100,
            },
            { name: 'vendor-radix', test: /[\\/]node_modules[\\/]@radix-ui[\\/]/, priority: 95 },
            //
            // ## `tags: ['$initial']` — this group claims only what the first screen runs (objectui#11101)
            //
            // A group claims by module ID, not by reachability, and this group's
            // chunk is a static import of the entry. So every `@objectstack/*`
            // module it claims is downloaded and parsed on every page load —
            // including one the source reaches only through `import()`. That is
            // how `@objectstack/lint` went eager in objectui#5266, and the
            // lookaheads in `VENDOR_OBJECTSTACK_TEST` exclude that one package
            // and nothing else. The tag closes the class: rolldown's built-in
            // `$initial` tag marks a module statically reachable from an entry,
            // so a vendor module that sits only behind an `import()` is no
            // longer claimed here and follows its importer into a lazy chunk.
            //
            // What it moved, on objectui#11101's two builds of one tree that
            // differ only in this tag: `@objectstack/spec`'s `/ai` and
            // `/integration` entries, which the metadata designers' client
            // validation (`views/metadata-admin/clientValidation.ts`) reaches
            // only through `await import()`; `/contracts`, reached by lazy
            // console pages and the linter; and `@objectstack/sdui-parser`,
            // reached by the linter alone. The bytes are recorded once, on
            // `BASELINE` in `scripts/check-eager-closure-budget.mjs`, ⛔ not here.
            //
            // ⛔ It moves nothing the first paint needs: `$initial` IS the static
            // closure of the entry, so every module the first screen executes is
            // still claimed by this group, into the same chunk. The linter's
            // lookaheads stay — `assertLazyLinterStaysLazy` names them in its
            // diagnostic. Dropping the tag puts the four modules back on every
            // page load, and the lowered ceiling in
            // `scripts/check-eager-closure-budget.mjs` is what reds on it.
            { name: 'vendor-objectstack', test: vendorObjectstackTest, priority: 95, tags: ['$initial'] },
            { name: 'vendor-icons-core', test: /[\\/]node_modules[\\/]lucide-react[\\/]dist[\\/](lucide-react|esm[\\/](Icon|createLucideIcon|defaultAttributes|shared))/, priority: 90 },
            //
            // ## The icons the eager shell imports by name share ONE chunk (objectui#12187)
            //
            // The per-icon group below gives every icon a chunk of its own, so
            // each icon that eagerly loaded code imports by name cost every page
            // load one request before its content. On the console build of
            // `54159d3`, 223 of the 291 chunks in the eager closure were
            // single-icon `vendor-icon-*` chunks (a historical reading, ⛔ not
            // re-derived by anything).
            //
            // This group claims those icons first and writes them to one chunk.
            // ⛔ It is not the aggregate objectui#9251 refused: `$initial` admits
            // an icon only when a static import chain from the entry reaches
            // it, so every member is already eager, and a lazily-used icon still
            // gets its own chunk from the group below. No byte moves into the
            // eager closure. The closure gets SMALLER, because one gzip stream
            // over the set weighs less than one stream per icon; what
            // `pnpm check:eager-closure` prints is the figure.
            //
            // ⚠️ Rolldown decides `$initial` on the import graph BEFORE
            // tree-shaking. An icon that only a shaken-out module imports counts
            // as `$initial` and is not eager: the package barrel re-exports
            // `MarketplacePackagePage`, which `viteDeclaredLazyViews` declares
            // side-effect-free and the bundle drops from the eager path, and
            // that page and its `PluginDisclosure` import the three icons in
            // `LAZY_ONLY_INITIAL_ICONS`. They are kept out by name so they stay
            // lazy. ⛔ Nothing re-derives that list: an icon that joins that
            // class later lands in this chunk (its bytes eager), and one that
            // leaves it gets an eager chunk of its own (one request more). It was
            // measured by comparing this chunk's members with the eager
            // `vendor-icon-*` chunks of a build without this group.
            //
            // Listed after `vendor-icons-core` at the same priority, so that
            // group claims the lucide runtime first. On the same build that chunk
            // held the same 12 modules with and without this group (a historical
            // reading).
            {
              name: 'vendor-icons-shell',
              test: (id: string) => {
                const icon = LUCIDE_ICON_MODULE.exec(id);
                return icon !== null && !LAZY_ONLY_INITIAL_ICONS.has(icon[1]);
              },
              priority: 90,
              tags: ['$initial'],
            },
            //
            // ## ONE CHUNK PER ICON — and ⛔ why this is not the regroup objectui#9251 forbids
            //
            // ⚠️ Read this before reading the group below as the shape that
            // card refused. The refused shape is *an aggregate*: one
            // `vendor-icons-*` chunk holding lucide's ~1,781 per-icon modules,
            // which would move them off the `ui-components` line and change the
            // page load by nothing, because one eagerly-imported member makes
            // the whole chunk eager — the same mechanism spelled out for the
            // i18n catalogues below. In that shape the budget row goes green
            // and the browser downloads exactly what it downloaded before.
            //
            // This group cannot do that. Its `name` is a FUNCTION of the module
            // id, so it emits one single-module chunk per icon: an eager icon is
            // eager alone and a lazy one stays lazy. It aggregates nothing, and
            // it is the per-catalogue remedy of objectui#7479 applied to the
            // same defect one library over.
            //
            // ## What it is actually for, measured
            //
            // Once objectui#9251 took the `icons` record off the eager path,
            // the ~125 icons that first-party code still imports BY NAME became
            // shared modules — reachable statically from a workspace chunk and
            // dynamically from lucide's import map. With no group claiming them,
            // rolldown parked them inside whichever chunk it liked, and three of
            // those chunks were LAZY plugin chunks:
            //
            //   | plugin-dashboard | 21 icons parked, incl. `arrow-up-right` |
            //   | plugin-gantt     | 62 icons parked, incl. `file-down`      |
            //   | plugin-report    |  1 icon  parked, `table-2`              |
            //
            // The eager `index-*.js` chunk then held a STATIC
            // `import{i as ri}from"./plugin-dashboard-*.js"` for one of those
            // icons — and a static import of a chunk is the whole chunk. All
            // three plugins were dragged into the eager closure: 326,305 raw /
            // 96,133 gzipped bytes of lazily-loaded plugin code on every page
            // load, for three icons.
            //
            // ⛔ That is the opposite of a regroup that moves no bytes: those
            // bytes are REAL and they are removed by this line. The reading is
            // on objectui#9251's pull request, taken on two console builds in
            // one container.
            {
              name: (id: string) => {
                const icon = /[\\/]node_modules[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]([a-z0-9-]+)\.mjs$/.exec(id);
                return icon ? `vendor-icon-${icon[1]}` : null;
              },
              test: /[\\/]node_modules[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]/,
              priority: 90,
            },
            { name: 'vendor-ui-utils', test: /[\\/]node_modules[\\/](class-variance-authority|clsx|tailwind-merge|sonner)[\\/]/, priority: 90 },
            { name: 'vendor-zod', test: /[\\/]node_modules[\\/]zod[\\/]/, priority: 90 },
            // `vendor-charts` stays out of the eager closure because `vendor-react`
            // claims `use-sync-external-store`; see the note on that group
            // (objectui#11798).
            { name: 'vendor-charts', test: /[\\/]node_modules[\\/](recharts|d3-|victory-)/, priority: 90 },
            { name: 'vendor-dndkit', test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/, priority: 90 },
            { name: 'vendor-i18n', test: /[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/, priority: 90 },
            // Workspace packages — match by realpath, since pnpm may resolve
            // through node_modules/@object-ui/<pkg> symlinks to packages/<pkg>.
            //
            // ## Why two tiers and not one (objectui#7399)
            //
            // These five groups were ALL `priority: 80` with `framework` written
            // first, and that tie was NOT benign. Measured on `e307c9896`, the
            // emitted `framework` chunk held 166 modules and only 145 of them
            // came from `core|react|types` — its own test:
            //
            //   | packages/i18n             |  16 mod | 78.7% of the chunk's bytes |
            //   | packages/core             |  67 mod |  9.6% |
            //   | packages/react            |  63 mod |  4.7% |
            //   | packages/data-objectstack |   5 mod |  4.6% |
            //   | packages/types            |  15 mod |  2.3% |
            //
            // `framework`'s regex does not match EITHER of the two intruders, and
            // `data-adapter` — declared below since objectui#5490 — emitted no
            // chunk at all. On a tie the subgraph reached through
            // `@object-ui/react` was absorbed by the group listed first, so
            // `PER_CHUNK_GZIP_CEILINGS['framework']` was in operation a budget on
            // the TRANSLATION CATALOGUE: 523,959 gzipped bytes against a 524,000
            // ceiling, 41 bytes of headroom for the whole repository, and a gate
            // whose message ("don't grow core|react|types") pointed away from its
            // own cause. Five PRs adding ruled user-facing copy were parked on it.
            //
            // So the two groups the tie was swallowing are lifted one tier ABOVE
            // it, and `i18n` leaves `infrastructure`'s alternation because a
            // dedicated group now owns it (a dead alternative in a live regex is
            // the next silent drift). Tier 84 sits above the general workspace
            // groups and below the vendor tier at 85+; its two members' tests are
            // disjoint from each other and from every vendor test, so lifting
            // them introduces no new tie.
            //
            // ⛔ This moves NO MODULE BYTES. The eager closure holds the same
            // module set before and after; what changes is which file each
            // module is written to. Measured cost of the extra chunk
            // boundaries: eager closure 3,255,233 -> 3,256,012 gzipped, +779 B
            // (+0.024%), raw +837 B — all of it `import` bookkeeping in the
            // chunks that now name two files where they named one. Nothing here
            // may be read as headroom that was earned.
            //
            // ⚠️ This paragraph used to disclose that `data-adapter` ALSO held a
            // handful of `core`/`types` modules reached only through
            // `data-objectstack` — "rolldown's behaviour, not a choice available
            // here". ⛔ The second half of that was wrong, and objectui#9345 is
            // what it cost: the same pull-in grew from a handful to the whole of
            // `packages/core` on a tree-shaking change made in another package,
            // and the budgeted line stopped being able to see its own members.
            // There WAS a choice available — `includeDependenciesRecursively`,
            // read out in full at the `data-adapter` group below, which now
            // declares it `false`. The escape the paragraph correctly refused
            // (lifting `framework` above these two) is still refused, for the
            // reason it gave.
            //
            // ## Why there are ELEVEN i18n groups and not one (objectui#7479)
            //
            // objectui#7399 gave the catalogues one `i18n-locales` chunk so the
            // `framework` ceiling stopped budgeting them. That chunk held all
            // ten, and all ten were EAGER because `packages/i18n`'s entry
            // re-exported every pack statically. objectui#7479 made nine of
            // them `import()`ed on demand — and a single group would have
            // silently undone that: `advancedChunks` groups by MODULE, not by
            // reachability, so ten catalogues sharing one group are one chunk,
            // and one eager member makes that whole chunk eager. The laziness
            // would be real in the source and absent in the bundle, which is
            // the failure mode this whole card exists to avoid.
            //
            // So: one group per catalogue, ten single-module chunks, plus a
            // group for the i18n RUNTIME (provider, hooks, formatters) which
            // stays eager and is a hundredth of the size. The names are the
            // gate's handle — `scripts/check-eager-locale-catalogues.mjs` reads
            // `i18n-locale-<code>` out of the BUILT `eager-closure.json` and
            // fails if any code but the active one is eager.
            //
            // ⛔ Spelled out, one literal per line, for the same reason the
            // marketplace co-tenants below are: each entry is a measured fact,
            // and a computed table would also defeat the parse in
            // `scripts/__tests__/check-eager-closure-budget.test.ts` that pins
            // this attribution.
            { name: 'i18n-locale-en', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]en\.ts$/, priority: 84 },
            { name: 'i18n-locale-zh', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]zh\.ts$/, priority: 84 },
            { name: 'i18n-locale-ja', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]ja\.ts$/, priority: 84 },
            { name: 'i18n-locale-ko', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]ko\.ts$/, priority: 84 },
            { name: 'i18n-locale-de', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]de\.ts$/, priority: 84 },
            { name: 'i18n-locale-fr', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]fr\.ts$/, priority: 84 },
            { name: 'i18n-locale-es', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]es\.ts$/, priority: 84 },
            { name: 'i18n-locale-pt', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]pt\.ts$/, priority: 84 },
            { name: 'i18n-locale-ru', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]ru\.ts$/, priority: 84 },
            { name: 'i18n-locale-ar', test: /[\\/]packages[\\/]i18n[\\/]src[\\/]locales[\\/]ar\.ts$/, priority: 84 },
            //
            // ⛔ `i18n-runtime` takes `includeDependenciesRecursively: false`
            // for the reason `data-adapter` below does (objectui#9345, read out
            // there in full): it outranks `framework` (83 over 80), and since
            // objectui#10866 `packages/i18n` imports `@object-ui/core` at
            // runtime (its date helpers read a value through `toDisplayDate`).
            // With rolldown's default the group followed that import and took
            // `framework`'s declared members. Measured on the console build of
            // `8559187c4`, before the flag: 54 of `packages/core`'s 81 modules
            // and 2 of `packages/types/src` written into `i18n-runtime`, and the
            // membership half of `scripts/check-eager-closure-budget.mjs` red.
            // With the flag the group holds what its `test` matches, and that
            // half is green on the same tree.
            //
            // The circular-chunk caveat the `data-adapter` paragraph asks a new
            // taker to re-check, re-checked on those builds rather than
            // inherited (historical readings, ⛔ not re-derived by anything):
            //   - the flag adds no cycle. `framework` and `i18n-runtime` import
            //     each other with or without it; the cycle came with the new
            //     import (`@object-ui/react` imports the i18n runtime, which now
            //     imports `@object-ui/core`), and it is the shape `data-adapter`
            //     and `framework` already had on `9f0c84a44`, where
            //     `i18n-runtime` imported no `framework` chunk;
            //   - the build emits the same chunk population as `9f0c84a44`;
            //   - the `i18n-runtime` chunk reads its one `framework` binding
            //     inside a function body, never at module evaluation, and this
            //     build and the `9f0c84a44` one each loaded the console's sign-in
            //     page in Chromium with no page error.
            // ⚠️ That last property is what keeps the cycle harmless, and
            // nothing re-derives it: a `packages/i18n` module that reads a
            // `core` value at module scope would need the order re-checked.
            { name: 'i18n-runtime', test: /[\\/]packages[\\/]i18n[\\/]/, priority: 83, includeDependenciesRecursively: false },
            //
            // ## `includeDependenciesRecursively: false` — the rule that decides
            // ## membership here, named (objectui#9345)
            //
            // ⭐ This flag is rolldown's `CodeSplittingGroup.includeDependenciesRecursively`
            // and its DEFAULT IS `true`. With it on, a group captures the modules
            // its `test` matches AND, transitively, everything those modules
            // import — and the priority doc for the same option states the other
            // half: "when converting the group to a chunk, modules of that group
            // will be removed from other groups". So a group can take modules
            // that its own regex does not match, out of a lower-priority group
            // whose regex does.
            //
            // That is what happened here. `packages/data-objectstack` imports
            // `@object-ui/core`, this group outranks `framework` (84 over 80), and
            // so the recursive half of this rule handed `framework`'s declared
            // members to a group whose regex never mentioned them. The size of
            // the transfer tracks TREE-SHAKING, which is why it moved without any
            // edit here: while `@object-ui/core` was only ever imported by name,
            // the retained slice reachable through `data-objectstack` was 5
            // modules (the disclosure below, written when it was 5). objectui#9185
            // added an `import('@object-ui/core')` of the BARREL in
            // `packages/app-shell`, every export of core became live, and the same
            // recursive walk then reached all 92 of them. Measured on the console
            // build of `ff1d5ea8d1`: `packages/core` contributed 92 modules to
            // `data-adapter` and 0 to `framework`, and `packages/types` split 3/19
            // across the two.
            //
            // ⛔ The repair is NOT a priority change. Lifting `framework` above 84
            // would re-run objectui#7399 exactly: `@object-ui/react` depends on
            // both `@object-ui/i18n` and `@object-ui/data-objectstack`, so a
            // recursive `framework` sitting above them would swallow the locale
            // catalogues and this group in one move — the defect the two-tier
            // layout above exists to prevent. Turning the recursive half OFF for
            // this group leaves every priority untouched and makes this group's
            // membership exactly what its `test` declares.
            //
            // Measured across the repair on `ff1d5ea8d1` — a historical reading
            // anchored to that tree, ⛔ not re-derived by anything: `data-adapter`
            // 78,110 -> 18,537 gzipped and holding only `packages/data-objectstack`;
            // `framework` 45,278 -> 104,636 and holding core|react|types; the
            // whole eager closure moved by -461 bytes. ⚠️ Those bytes were ALWAYS
            // downloaded — `data-adapter` is in the eager closure — so this is a
            // re-attribution and ⛔ must not be read as a payload change in either
            // direction. `framework` sat over its ceiling at that reading: the
            // repair made a pre-existing overage VISIBLE rather than causing it,
            // and ⛔ no constant moved to absorb it. It was closed later by moving
            // bytes, not lines (objectui#10065 below takes the zod validators off
            // this chunk); the figure in force is the one
            // `scripts/check-eager-closure-budget.mjs` prints on every run.
            //
            // The membership half of that gate pins the result: `framework`'s
            // declared packages land in `framework`, with ONE declared carve-out
            // — `packages/types/src/zod/**` in `types-zod`, exactly — and nowhere
            // else (`PER_CHUNK_MEMBERSHIP` and `PER_CHUNK_MEMBERSHIP_CARVE_OUTS`
            // there, judged against this build's `chunk-membership.json`).
            //
            // ⚠️ Rolldown documents a cost for turning this off: recursive capture
            // "reduces the chance of generating circular chunks", and the same
            // paragraph recommends `preserveEntrySignatures: false` and
            // `strictExecutionOrder: true` alongside disabling it. Neither is set
            // here, and neither was needed: the build emits the same chunk
            // population as before, with the ONE group narrowed. A future group
            // taking this flag should re-check that rather than inherit the
            // reading.
            { name: 'data-adapter', test: /[\\/]packages[\\/]data-objectstack[\\/]/, priority: 84, includeDependenciesRecursively: false },
            //
            // ## The zod validators leave the eager line (objectui#10065)
            //
            // `framework`'s test claims every `packages/types/` module WHEREVER
            // IT IS REACHED FROM, and `framework` is eager because `core` and
            // `react` are reached from the entry. That is membership decided
            // without reference to reachability — the same defect the two tiers
            // above were lifted out of, one directory over.
            //
            // Measured on `0c2eb5eee` from the console build's own visualizer,
            // with `pnpm check:eager-closure` weighing the same build: the nine
            // `packages/types/src/zod/**` modules rolldown emits were 140,541
            // rendered bytes of a 372,430-byte `framework` chunk, led by
            // `objectql.zod.ts`, `data-display.zod.ts` and `complex.zod.ts`.
            // Their ONE live consumer in this bundle is
            // `packages/plugin-map/src/ObjectMap.tsx`, which imports
            // `ObjectMapConfigSchema` from `@object-ui/types/zod` — and the
            // `plugin-map` chunk is NOT in the eager closure. So every page load
            // fetched validators only the object-map view ever reads.
            //
            // ⭐ The bytes LEAVE the eager closure rather than moving to another
            // eager line, which is what separates this from the regroup
            // objectui#9251 forbids: the new chunk is reached ONLY through
            // `plugin-map`'s own dynamic boundary, so nothing statically imports
            // it and the closure walk never enters it. The object-map view pays
            // one extra fetch when it opens; every other page load stops paying.
            //
            // The `@object-ui/types` main barrel deliberately does not re-export
            // the validators (its own comment on the main entry says so), and
            // the only two modules outside this directory that name them —
            // `objectql.ts`'s `import type` / `export type` pair — are erased,
            // so no eager module reaches in. ⚠️ That is the property the whole
            // saving rests on, and nothing about a regex re-derives it: the
            // guard `scripts/vite-types-zod-lazy.ts` weighs the emitted chunks
            // and fails this build in BOTH directions — if the chunk rejoins the
            // eager closure, and if it stops being reachable from `plugin-map`
            // at all (bytes dropped rather than deferred, which reads as an even
            // better saving and breaks the map view).
            //
            // ⛔ `src` only, with no `dist` alternative beside it. The console
            // aliases `@object-ui/types` to `packages/types/src`, so `src` is
            // what rolldown matches here; a `dist` arm would be a dead
            // alternative in a live regex, which is the drift the `i18n` note
            // above was written about.
            // ⛔ `includeDependenciesRecursively: false`, and the default is `true`.
            // Measured on `0c2eb5eee` with the default left in place: the group
            // captured the nine zod modules AND recursively absorbed
            // `packages/types/src/data-display.ts`, `complex.ts` and
            // `designer.ts` — three shared modules whose runtime values the
            // EAGER `plugin-grid` chunk reads (`ObjectGrid.tsx` imports
            // `normalizeTableColumnType` and `isSystemManagedField` from
            // `@object-ui/types`). Rolldown's own rule is that a higher-priority
            // group's modules are removed from the lower-priority ones, so
            // `framework` never got them back, `plugin-grid` had to import the
            // new chunk statically, and the whole 140,541 bytes stayed eager —
            // a saving of exactly nothing, dressed as a new chunk name. The
            // guard below refused that build; this option is the repair.
            //
            // Scoping the capture to the directory is also what the group MEANS:
            // the validators are what has no eager reader, not everything they
            // happen to import. Their non-zod dependencies fall back to
            // `framework`, which is where they were and where they belong.
            {
              name: 'types-zod',
              test: /[\\/]packages[\\/]types[\\/]src[\\/]zod[\\/]/,
              priority: 82,
              includeDependenciesRecursively: false,
            },
            { name: 'framework', test: /[\\/]packages[\\/](core|react|types)[\\/]/, priority: 80 },
            //
            // ## The record-form date picker leaves the eager line (objectui#12622)
            //
            // `ui-components` claims every `packages/fields/` module wherever it
            // is reached from, so the picker's `import()` in `FORM_FACE_LOADERS`
            // had no effect on chunking: the picker would have been fetched on
            // every page load, including pages with no record form. This group
            // takes the `widgets/date-picker/` directory only. The picker's
            // imports from the rest of `packages/fields` (`DateField`,
            // `nativeDateValue`, `useFieldTranslation`, ...) stay in
            // `ui-components`. The new chunk is reached only through that
            // `import()`, so the closure walk never enters it.
            // `PER_CHUNK_MEMBERSHIP_CARVE_OUTS` in
            // `scripts/check-eager-closure-budget.mjs` declares this split and
            // checks it module by module. That check errors if this chunk ever
            // joins the eager closure.
            //
            // `includeDependenciesRecursively: false` for the reason `types-zod`
            // below gives: with the default left on, the group would pull the
            // shared `widgets/` neighbours along an import, and `ui-components`
            // would then import this chunk statically.
            {
              name: 'fields-date-picker',
              test: /[\\/]packages[\\/]fields[\\/]src[\\/]widgets[\\/]date-picker[\\/]/,
              priority: 82,
              includeDependenciesRecursively: false,
            },
            { name: 'ui-components', test: /[\\/]packages[\\/](components|fields)[\\/]/, priority: 80 },
            { name: 'ui-layout', test: /[\\/]packages[\\/]layout[\\/]/, priority: 80 },
            { name: 'infrastructure', test: /[\\/]packages[\\/](auth|permissions|tenant)[\\/]/, priority: 80 },
            // Plugins — one chunk per plugin so dynamic imports cleave cleanly.
            { name: 'plugin-grid', test: /[\\/]packages[\\/]plugin-grid[\\/]/, priority: 70 },
            { name: 'plugin-form', test: /[\\/]packages[\\/]plugin-form[\\/]/, priority: 70 },
            { name: 'plugin-view', test: /[\\/]packages[\\/]plugin-view[\\/]/, priority: 70 },
            { name: 'plugins-views', test: /[\\/]packages[\\/]plugin-(detail|list)[\\/]/, priority: 70 },
            { name: 'plugin-dashboard', test: /[\\/]packages[\\/]plugin-dashboard[\\/]/, priority: 70 },
            { name: 'plugin-report', test: /[\\/]packages[\\/]plugin-report[\\/]/, priority: 70 },
            { name: 'plugin-map', test: /[\\/]packages[\\/]plugin-map[\\/]/, priority: 70 },
            { name: 'plugin-charts', test: /[\\/]packages[\\/]plugin-charts[\\/]/, priority: 70 },
            { name: 'plugin-gantt', test: /[\\/]packages[\\/]plugin-gantt[\\/]/, priority: 70 },
            { name: 'plugin-markdown', test: /[\\/]packages[\\/]plugin-markdown[\\/]/, priority: 70 },
            { name: 'plugin-timeline', test: /[\\/]packages[\\/]plugin-timeline[\\/]/, priority: 70 },
            { name: 'plugin-tree', test: /[\\/]packages[\\/]plugin-tree[\\/]/, priority: 70 },
            { name: 'plugin-calendar', test: /[\\/]packages[\\/]plugin-calendar[\\/]/, priority: 70 },
            { name: 'plugin-kanban', test: /[\\/]packages[\\/]plugin-kanban[\\/]/, priority: 70 },
            //
            // ## The chatbot's side-effect-free half stays out of its chunk (objectui#13410)
            //
            // The console shell is eager and imports the agent catalog hook and a
            // few pure parsers through `@object-ui/plugin-chatbot/core`. Left to
            // the `plugin-chatbot` group below, those modules would be co-tenants
            // of the chat UI and pull the whole chunk back into every first load,
            // the co-tenancy mechanism objectui#6680 records further down. This
            // group takes exactly the modules `src/core.ts` re-exports from, so
            // `plugin-chatbot` is reached only through the lazy chat surfaces.
            // `includeDependenciesRecursively: false` for the reason `types-zod`
            // above gives. ⛔ A module added to `core.ts` belongs in this list.
            {
              name: 'plugin-chatbot-core',
              test: /[\\/]packages[\\/]plugin-chatbot[\\/]src[\\/](core|useAgents|agentAliases|aiUsageEvents|publishHealth|mapMessages)\.tsx?$/,
              priority: 71,
              includeDependenciesRecursively: false,
            },
            { name: 'plugin-chatbot', test: /[\\/]packages[\\/]plugin-chatbot[\\/]/, priority: 70 },
            //
            // ## `vendor-markdown` claims only what the first load reaches (objectui#11854)
            //
            // The remark / rehype / micromark family. The chatbot's message
            // renderer (`streamdown`, imported statically by `plugin-chatbot`)
            // reaches most of it on every page, so this chunk is eager. Without
            // the tag the group also claimed the family members that only
            // `plugin-markdown` reaches — `rehype-highlight` with `lowlight` and
            // `highlight.js`, `rehype-slug`, `rehype-autolink-headings`,
            // `remark-github-blockquote-alert` and their helpers — and one eager
            // member made all of them eager: the objectui#11798 capture
            // mechanism, one group over. `tags: ['$initial']` is the same option,
            // for the same reason, as on `vendor-objectstack` above
            // (objectui#11101): the group claims a family member only when a
            // static import from the entry reaches it, and the rest follows its
            // importer, `plugin-markdown`'s own group, behind that plugin's lazy
            // registration and the docs reader's lazy route. The bytes are
            // recorded once, on `BASELINE` in
            // `scripts/check-eager-closure-budget.mjs`, ⛔ not here.
            //
            // ⛔ Not `includeDependenciesRecursively: false`, the flag
            // objectui#11798 measured into a chunk cycle on `vendor-charts`; the
            // tag narrows what the group claims and leaves its capture alone.
            //
            // `react-markdown` is the one member with no static path from the
            // entry that the first load still needs. `MarkdownContent` in
            // `packages/fields` imports it statically, and that widget sits in
            // the EAGER `ui-components` chunk although it is only reached through
            // `React.lazy` — the co-tenancy recorded in
            // `scripts/vite-ineffective-dynamic-imports.ts` (objectui#5325). Left
            // unclaimed, `ui-components` (priority 80) would take it by its own
            // capture, onto a budgeted line; claimed by the tagged group it
            // cannot be. So it gets a group of its own here, and its chunk loads
            // with whichever importer loads first.
            { name: 'vendor-markdown', test: /[\\/]node_modules[\\/](remark-|rehype-|micromark|mdast-|hast-|unified|unist-|vfile|bail|trough|character-entities|decode-named-character-reference|devlop|estree-|comma-separated-tokens|space-separated-tokens|property-information|html-url-attributes|zwitch)/, priority: 85, tags: ['$initial'] },
            { name: 'vendor-react-markdown', test: /[\\/]node_modules[\\/]react-markdown[\\/]/, priority: 84 },
            // Sentry — only fetched when the RUNTIME serves a DSN on
            // /api/v1/runtime/config (objectstack#12681); a deployment that
            // configured none never requests this chunk at all.
            { name: 'vendor-sentry', test: /[\\/]node_modules[\\/]@sentry[\\/]/, priority: 85 },
            // The eagerly-reached app-shell leaves that were holding declared-lazy
            // route chunks in the eager closure by CHUNK CO-TENANCY (objectui#6680).
            //
            // Measured on `b98352a15` from the emitted chunks' own module lists —
            // never from a source-level search, which cannot see this at all
            // (objectui#6681):
            //
            //   assets/MarketplacePackagePage-*.js   7,647 B gz, EAGER
            //     holds `components/SuggestedBindingsPanel.tsx` (+ its
            //     `services/suggestedBindingsApi.ts`), which
            //     `views/studio-design/StudioDesignSurface.tsx` — a barrel export the
            //     console reaches eagerly — imports STATICALLY.
            //   the Installed Apps page's chunk      1,836 B gz, EAGER
            //     held the SDUI widget module `packages/app-shell/src/index.ts`
            //     BARE-imported for its registration, which the package's
            //     `sideEffects` array named. objectui#12733 retired that page and
            //     that widget together, so the widget left this group with them.
            //
            // In both, the page itself had NO static importer: only the co-tenant
            // did, and the page's bytes rode along on every console page load while
            // `AppContent` declared it `lazy()`. `MarketplacePage.tsx` had no eager
            // co-tenant and was already lazy — the control that makes the mechanism
            // legible rather than a story about these two files.
            //
            // Isolating the co-tenants lets all three pages chunk by their own
            // (dynamic-only) reachability: eager closure 3180.2 KB -> 3171.5 KB
            // gzipped, -8,888 bytes, 48 -> 45 eager chunks, with the three per-chunk
            // ceilings unmoved.
            //
            // ⚠️ Group the CO-TENANTS, not the pages. The opposite grouping was
            // measured first: a `marketplace-routes` group over the three
            // declared-lazy pages swept the bare-imported widget module in with
            // them, so the barrel's bare import made the GROUP eager and it became an
            // attractor for 47 modules — `runtime-config.ts`,
            // `providers/MetadataProvider.tsx` and `@object-ui/plugin-form` among
            // them — emitting a 44 KB eager chunk for a net of -1,697 bytes and
            // three destroyed lazy boundaries. A group decides co-tenancy; it is
            // not a laziness declaration, and `assertLazyLinterStaysLazy` above is
            // the other half of that same lesson.
            //
            // The membership is EXPLICIT rather than a directory glob because each
            // entry is a measured fact about one module's importers, and a glob
            // would quietly enrol modules nobody weighed.
            // `scripts/vite-declared-lazy-views.ts` fails this build in BOTH
            // directions if the result drifts.
            {
              name: 'app-shell-eager-leaves',
              test: /[\\/]packages[\\/]app-shell[\\/]src[\\/](?:components[\\/]SuggestedBindingsPanel\.tsx|services[\\/]suggestedBindingsApi\.ts)$/,
              priority: 75,
            },
          ],
        },
      }
    }
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['../../vitest.setup.tsx'],
    server: {
      deps: {
        inline: [/@objectstack/],
      },
    },
  },
  server: {
    port: 5180,
    // Widen the fs allow-list only when an out-of-tree override is set (see
    // OBJECTSTACK_CLIENT_DIST / OBJECTSTACK_SPEC_DIST above); otherwise keep
    // Vite's defaults. Both overrides live outside the workspace root, which
    // Vite's default `fs.allow` serves as a 403 (blank page, no build error).
    ...(clientFsAllow.length || specFsAllow.length
      ? { fs: { allow: [path.resolve(import.meta.dirname, '../..'), ...clientFsAllow, ...specFsAllow] } }
      : {}),
    proxy: {
      '/api': { target: process.env.DEV_PROXY_TARGET || 'http://localhost:3000', changeOrigin: true },
    },
  },
});
