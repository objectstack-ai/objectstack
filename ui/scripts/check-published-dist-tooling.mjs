#!/usr/bin/env node
/**
 * No published package's build output may carry TOOLING material.
 *
 * Run:  node scripts/check-published-dist-tooling.mjs   (also `pnpm check:published-dist`)
 * Exit: 0 = every published tarball's `dist/` is free of tooling artifacts,
 *       1 = at least one ships tooling material, OR the gate could not build,
 *           OR a package produced nothing to inspect
 *
 * ## Why this gate exists, and why it costs a build (objectui#4846)
 *
 * The same defect has now been found by hand three times, never by a gate:
 * objectui#4006 measured 73 `*.test.d.ts` files inside the published `dist/` of
 * `@object-ui/fields` and `@object-ui/plugin-editor`; objectui#4836 measured 9
 * more across `@object-ui/core`, `@object-ui/plugin-designer`,
 * `@object-ui/plugin-grid` and `@object-ui/plugin-view` — one of them
 * (`dist/__benchmarks__/core.bench.js`) a real emitted module whose first
 * statement imports `vitest`, a package no consumer installs. In that defective
 * state EVERY gate in this repository exited 0:
 *
 *     node scripts/check-type-check-coverage.mjs    rc=0
 *     node scripts/check-phantom-dependencies.mjs   rc=0
 *     node scripts/check-control-bytes.mjs          rc=0
 *     node scripts/check-package-self-import.mjs    rc=0
 *
 * ## The criterion is ARTIFACT-level, and the cheap static one was measured and rejected
 *
 * The obvious cheap gate is "no build tsconfig program may contain a
 * TOOLING_FILE". objectui#4846 measured it and it REDS FIVE ZERO-DEFECT
 * PACKAGES: `@object-ui/plugin-charts` (31 tooling files in the program, none
 * emitted — `vite-plugin-dts`'s own exclude stops them), `@object-ui/cli` and
 * `@object-ui/data-objectstack` (`tsup` emits from its entry graph only, and
 * having the tests in the program is exactly HOW they get their `tsc --noEmit`
 * coverage), `@object-ui/console` (`noEmit: true`, nothing is written), and
 * `@object-ui/test-support` (`private: true`, never published).
 *
 * Acting on that gate would mean moving 73 test files out of type programs to
 * silence it — the precise MIRROR of objectui#4006's lesson, which was that the
 * coverage was right only as a side effect of the emit. A tooling file in a
 * CHECKING program is a good thing; in an EMITTING program it is a defect, and
 * which program emits differs per package (bare `tsc` / `tsup` entry graph
 * rolling its own dts / `vite-plugin-dts` merging its include+exclude with the
 * tsconfig's). Modelling that statically means reimplementing three third-party
 * emit semantics. So the criterion is the one thing that cannot be wrong about
 * what ships: the FILE LIST OF THE TARBALL, after a real build.
 *
 * ## Why it is a RELEASE-time gate and not a per-PR one
 *
 * Ruled on 2026-08-16 (objectui#4846 comment 5307574139). The criterion needs a
 * full-repo build, and this repository deliberately has no per-PR full-repo
 * build: `Build & E2E` builds only `@object-ui/console`, and `Type Check`'s
 * turbo `dependsOn: ["^build"]` builds only the DEPENDENCY CLOSURE, so leaf
 * packages (`plugin-designer` is one, and it was one of the four defective
 * packages) are never built there. Paying a full build on every pull request to
 * catch a defect that can only reach a user at publish time is the wrong trade;
 * this gate therefore runs where the harm materialises — the publish path
 * (`pnpm changeset:publish`) — plus nightly, at zero per-PR cost.
 *
 * ## The vacuous form this gate must never take
 *
 * "Check `dist/` if it exists" is the shape to avoid at all costs: with no
 * per-PR build, `dist/` is usually absent, so such a gate passes because it
 * looked at NOTHING — worse than no gate, because the next occurrence looks
 * guarded. Three separate rules make that impossible here:
 *
 *   1. The gate BUILDS. It runs the repository's own build itself and fails
 *      loudly if the build fails. `--no-build` exists for callers that just
 *      built (and for the tests), and it is wired into nothing.
 *   2. A published package that contributes NO file under a build output
 *      directory is a FINDING (`no-build-output`), not a skip. That is what
 *      keeps `--no-build` safe: a missing `dist/` is red, never green.
 *   3. The scan asserts its own size. Fewer than `MIN_PACKAGES` published
 *      packages means the release group, the manifest walk or `npm pack` broke,
 *      and an empty comparison would pass while asserting nothing.
 *
 * ## What "published" and "the file list" mean here
 *
 *   - PUBLISHED = in the `fixed` group of `.changeset/config.json` (this
 *     repository's own definition of a released family, read from the file for
 *     the reason `check-changeset-presence.mjs` gives — a hand-written list
 *     misses `@object-ui/console` under `apps/`) MINUS `private: true`. The
 *     subtraction is load-bearing and not cosmetic: `packages/vscode-extension`
 *     is named `object-ui`, IS in the fixed group (changesets versions it) and
 *     is `private`, so npm never receives it.
 *   - THE FILE LIST comes from `npm pack --dry-run --json`, not from a walk of
 *     `dist/` on disk. Those differ, and the tarball is the thing a consumer
 *     installs: a package's `files` field, its `.npmignore` and npm's own always
 *     /never rules decide what actually ships. Asking npm removes a whole class
 *     of false reds (a `dist/` file that `files` does not publish) without any
 *     reimplementation of npm's packing rules.
 *
 * ## Scope, stated so it is not mistaken for more
 *
 *   - Only entries under a BUILD OUTPUT directory (`BUILD_OUTPUT_DIRS`) are
 *     judged, and the reason is that `dist/` and "the tarball" are not the same
 *     set for every package here. Some released packages also list `src` in
 *     `files`, so their tarballs carry test SOURCES as well — 133 such files
 *     measured across two packages when this gate landed. That is objectui#4851
 *     (objectui#4847 already removed the entry from `@object-ui/data-objectstack`
 *     and objectui#4856 is the `@object-ui/fields` half; for `@object-ui/types`
 *     the entry is load-bearing rather than leftover, because its shipped
 *     `.d.ts.map` name `../src/*.ts` with no embedded sources, so removing it
 *     would leave published maps pointing at files the tarball no longer has).
 *     Enforcing over the WHOLE pack list would therefore land this gate red on
 *     day one for somebody else's card, and the fix for that card is not
 *     uniform. So the count is PRINTED on every run under `src-tier`, with the
 *     packages named, and the concession stays visible instead of being
 *     absorbed — reported here, enforced there.
 *   - The gate does not ask WHY a tooling file was emitted. The cause is
 *     per-package (a tsconfig `exclude` that names `*.test.ts` but not
 *     `__tests__/`, a bundler entry that reaches a mock) and the fix belongs in
 *     that package's build config, as PR #4845 did for four of them.
 *
 * ## Build RECORDS are refused too, and they have no tooling source (objectui#7003)
 *
 * Everything above traces an ARTIFACT back to a tooling SOURCE: `dist/a.test.d.ts`
 * is refused because `src/a.test.ts` exists and the convention names that stem.
 * An incremental build record (`*.tsbuildinfo`) has no such source — it is a
 * by-product of the compiler, not the emit of a file anyone wrote — so it
 * matches nothing `PUBLISHED_TOOLING_FILE` describes, and objectui#7003 measured
 * that blind spot on this gate before anything had shipped through it. It is
 * material a consumer must not receive for the same reason the rest of this
 * gate exists, and a sharper one: the record NAMES EVERY INPUT PATH on the
 * machine that produced it. Every affected package publishes by directory
 * (`files: ["dist", …]`), so a record written inside the build output ships
 * whole. `BUILD_RECORD` below is therefore a SECOND, artifact-only term rather
 * than an addition to `TOOLING_FILE`: see its own docblock for why the shared
 * convention is the wrong home for it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PACKAGE_ROOTS, TOOLING_FILE, readReleaseGroup } from './check-phantom-dependencies.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * Directories a build writes into, judged as published build output.
 *
 * These are turbo.json's `build.outputs` minus the non-directory entries. A
 * package that started emitting somewhere else does not slip through by being
 * unlisted: it would contribute no file under any of these and be reported as
 * `no-build-output`.
 */
export const BUILD_OUTPUT_DIRS = ['dist', 'build', '.next'];

/**
 * Below this many published packages the scan is broken, not empty.
 *
 * The `fixed` group holds 40 entries today, one of them private. A collapse to
 * a handful means the release config, the manifest walk or `npm pack` stopped
 * answering, and every assertion below would pass while reading nothing.
 */
export const MIN_PACKAGES = 30;

// ── the tooling convention, derived rather than re-spelled ───────────────────

/**
 * The two halves of `TOOLING_FILE`, pulled out of the sibling gate's own regex.
 *
 * Reading them from `TOOLING_FILE.source` instead of retyping them is what stops
 * the two gates from drifting apart: the day someone adds a fourth tooling
 * directory to `check-phantom-dependencies.mjs`, this gate covers it in the same
 * commit, and the day the regex is restructured beyond recognition this throws
 * by name instead of silently matching less.
 *
 * @returns {{ directories: string, stems: string }} raw alternation bodies
 */
export function toolingConventionFrom(source) {
  const directories = /\(\^\|\\\/\)\(([^)]+)\)\\\//.exec(source);
  const stems = /\\\.\(([^)]+)\)\\\./.exec(source);
  if (!directories || !stems) {
    throw new Error(
      'cannot read the tooling convention out of TOOLING_FILE in scripts/check-phantom-dependencies.mjs. ' +
        `Its source is now \`${source}\`, which no longer has the shape ` +
        '`(^|\\/)(<dirs>)\\/|\\.(<stems>)\\.<ext>$` this gate derives from. Re-derive the two ' +
        'alternations here rather than hand-copying them, so the two gates cannot disagree about ' +
        'what tooling material IS.',
    );
  }
  return { directories: directories[1], stems: stems[1] };
}

const CONVENTION = toolingConventionFrom(TOOLING_FILE.source);

/**
 * The same convention, read against an EMITTED path instead of a source path.
 *
 * One deliberate difference, and it is the whole reason this is a separate
 * regex: the extension is unconstrained. `TOOLING_FILE` ends `\.[cm]?[jt]sx?$`
 * because it grades SOURCES, and that tail does not match `foo.test.d.ts` —
 * which is precisely the 73 files objectui#4006 found in two published
 * `dist/` directories. An emit multiplies the extension (`.d.ts`, `.d.ts.map`,
 * `.js`, `.js.map`, `.mjs`, `.cjs`), so the artifact side matches the tooling
 * MARKER and lets the extension chain be anything.
 */
export const PUBLISHED_TOOLING_FILE = new RegExp(
  `(^|/)(${CONVENTION.directories})/|\\.(${CONVENTION.stems})\\.[^/]*$`,
);

/**
 * An incremental build RECORD, wherever a build wrote one.
 *
 * ## Why this is a separate term and not a third alternation in `TOOLING_FILE`
 *
 * Three reasons, and the first is mechanical (objectui#7003):
 *
 *  1. It would not arrive. `toolingConventionFrom` extracts exactly TWO halves
 *     out of `TOOLING_FILE.source` — the directory alternation and the stem
 *     alternation — and `PUBLISHED_TOOLING_FILE` is rebuilt from those two. A
 *     third alternation added over there is dropped here silently: the sibling
 *     gate would change behaviour and this one would not, which is the exact
 *     drift the derivation exists to prevent.
 *  2. `TOOLING_FILE` grades SOURCE files, and a build record is not one. Its
 *     five other readers walk source trees filtered by `SOURCE_FILE`
 *     (`\.[cm]?[jt]sx?$`), so the term would be inert in all of them — a rule
 *     declared in a place that never honours it.
 *  3. `check-published-tsconfig-tooling-exclude.mjs` turns that convention into
 *     tsconfig `exclude` patterns. Excluding a `.tsbuildinfo` from a program is
 *     meaningless: `tsc` writes the record, it never reads one as an input.
 *
 * ## What it recognises, and what it cannot
 *
 * Any basename, at any depth, ending `.tsbuildinfo` — `tsconfig.tsbuildinfo`,
 * `tsconfig.build.tsbuildinfo`, a bare `.tsbuildinfo`, and the same names in a
 * nested directory. That suffix IS this repository's spelling for the artifact:
 * `turbo.json`'s build `outputs` name a recursive glob over `*.tsbuildinfo` and
 * `.gitignore` ignores the same one, so a record renamed away from that suffix
 * would already be uncached and untracked.
 *
 * It cannot recognise a record whose `tsBuildInfoFile` points at an arbitrary
 * name with another extension; nothing readable from the tarball distinguishes
 * that file from an emitted one. Stated rather than papered over with a list of
 * guessed artifact names — a wrong guess would red a clean package, and the
 * repository-wide convention above is the thing actually worth enforcing.
 */
export const BUILD_RECORD = /(^|\/)[^/]*\.tsbuildinfo$/;

/**
 * Whether a tarball entry is tooling material by this repository's convention.
 *
 * The union of the two terms: material traced back to a tooling SOURCE, and
 * build records, which have none (objectui#7003).
 */
export const isToolingArtifact = (path) => PUBLISHED_TOOLING_FILE.test(path) || BUILD_RECORD.test(path);

/** The build output directory an entry belongs to, or `null`. */
export function outputDirOf(path) {
  const first = path.split('/')[0];
  return BUILD_OUTPUT_DIRS.includes(first) ? first : null;
}

// ── the workspace ────────────────────────────────────────────────────────────

/**
 * Every workspace package npm actually receives.
 *
 * @returns {{ name: string, dir: string, manifest: object }[]}
 */
export function discoverPublishedPackages(root, released = readReleaseGroup(root)) {
  const packages = [];
  for (const parent of PACKAGE_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(root, parent));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const dir = `${parent}/${entry}`;
      const manifestPath = join(root, dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      // `private` is checked BEFORE release-group membership is trusted:
      // `object-ui` (packages/vscode-extension) is in the fixed group and is
      // private, so changesets versions it and npm never sees it.
      if (!manifest.name || !released.has(manifest.name) || manifest.private === true) continue;
      packages.push({ name: manifest.name, dir, manifest });
    }
  }
  return packages;
}

// ── the build ────────────────────────────────────────────────────────────────

/**
 * The repository's own build, run by the gate.
 *
 * Deliberately the same command the release workflow runs (`pnpm build`,
 * i.e. turbo's `build` task minus the docs site), so the artifacts inspected
 * below are the artifacts a release produces, rather than a second build shape
 * invented here that could differ from it.
 *
 * @param {string} root
 * @param {{ concurrency?: number|null, force?: boolean, log?: (line: string) => void, exec?: Function }} options
 */
export function buildWorkspace(
  root,
  { concurrency = null, force = false, log = () => {}, exec = execFileSync } = {},
) {
  const args = ['exec', 'turbo', 'run', 'build', '--filter=!@object-ui/site'];
  if (concurrency !== null) args.push(`--concurrency=${concurrency}`);
  if (force) args.push('--force');
  log(`Building: pnpm ${args.join(' ')}`);
  const started = Date.now();
  try {
    exec('pnpm', args, { cwd: root, stdio: 'inherit' });
  } catch (error) {
    throw new Error(
      `the workspace build failed (${error.message}), so there is nothing trustworthy to inspect. ` +
        'Reported as a FAILURE rather than a skip: this gate exists because "no artifacts, therefore ' +
        'green" is the one verdict it must never return (objectui#4846).',
    );
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  log(`Build finished in ${seconds}s.`);
  return seconds;
}

/** Remove each package's build output, so a stale artifact cannot be read as a fresh one. */
export function cleanOutputs(root, packages, log = () => {}) {
  let removed = 0;
  for (const pkg of packages) {
    for (const outputDir of BUILD_OUTPUT_DIRS) {
      const target = join(root, pkg.dir, outputDir);
      if (!existsSync(target)) continue;
      rmSync(target, { recursive: true, force: true });
      removed += 1;
    }
  }
  log(`Removed ${removed} build output director(y|ies) before building.`);
  return removed;
}

// ── the file list ────────────────────────────────────────────────────────────

const defaultNpmPack = (cwd) =>
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/**
 * The paths `npm publish` would put in this package's tarball.
 *
 * `npm pack --dry-run --json` is asked instead of walking `dist/` because the
 * tarball is what a consumer installs, and the mapping from disk to tarball is
 * npm's (the `files` field, `.npmignore`, and npm's own always/never lists).
 * `--ignore-scripts` keeps the query side-effect free: `npm pack` otherwise runs
 * `prepack`/`prepare`, which would rebuild inside a read-only measurement.
 *
 * @returns {string[]} tarball-relative paths, `/`-separated
 */
export function packedFiles(root, pkg, run = defaultNpmPack) {
  const raw = run(join(root, pkg.dir));
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`\`npm pack --dry-run --json\` in ${pkg.dir} returned unparseable output: ${error.message}`);
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry || !Array.isArray(entry.files)) {
    throw new Error(
      `\`npm pack --dry-run --json\` in ${pkg.dir} reported no file list, so what this package ` +
        'publishes is unknown. A gate that cannot see the tarball cannot approve it.',
    );
  }
  return entry.files.map((file) => String(file.path).split('\\').join('/'));
}

// ── the judgement ────────────────────────────────────────────────────────────

/**
 * One package's verdict over its own tarball file list.
 *
 * @param {{ name: string, dir: string, manifest: object }} pkg
 * @param {string[]} files tarball-relative paths
 * @returns {{ findings: any[], counters: Record<string, number> }}
 */
export function auditPackedFiles(pkg, files) {
  const findings = [];
  const counters = { files: files.length, output: 0, tooling: 0, srcTierTooling: 0 };

  for (const file of files) {
    const outputDir = outputDirOf(file);
    if (outputDir === null) {
      // Outside the build output: the `files: ["src"]` tier, reported below the
      // verdict rather than enforced here — see the scope note in the header.
      if (isToolingArtifact(file)) counters.srcTierTooling += 1;
      continue;
    }
    counters.output += 1;
    if (!isToolingArtifact(file)) continue;
    counters.tooling += 1;
    findings.push({ reason: 'tooling-in-published-output', pkg: pkg.name, dir: pkg.dir, file });
  }

  // The anti-vacuous rule. A published package with nothing under a build
  // output directory is not "clean" — it is unexaminable, and the whole point
  // of objectui#4846 is that "nothing to look at" must never read as green.
  if (counters.output === 0) {
    findings.push({
      reason: 'no-build-output',
      pkg: pkg.name,
      dir: pkg.dir,
      detail:
        `its tarball has ${files.length} file(s) and not one under ` +
        `${BUILD_OUTPUT_DIRS.map((d) => `\`${d}/\``).join(' / ')}, so this gate inspected nothing for it`,
    });
  }

  return { findings, counters };
}

/**
 * The whole judgement for one repository root, over already-built artifacts.
 *
 * @param {string} root
 * @param {{ packages?: any[], pack?: (root: string, pkg: any) => string[] }} [options]
 */
export function analyze(root, { packages = discoverPublishedPackages(root), pack = packedFiles } = {}) {
  const findings = [];
  const counters = { packages: packages.length, files: 0, output: 0, tooling: 0, srcTierTooling: 0 };
  const srcTierPackages = new Set();

  for (const pkg of packages) {
    const result = auditPackedFiles(pkg, pack(root, pkg));
    findings.push(...result.findings);
    for (const key of Object.keys(result.counters)) counters[key] += result.counters[key];
    if (result.counters.srcTierTooling > 0) srcTierPackages.add(pkg.name);
  }

  return { findings, counters, packages, srcTierPackages: [...srcTierPackages].sort() };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HINTS = {
  'tooling-in-published-output':
    'A test/mock/benchmark artifact is inside the tarball a consumer installs. Fix it in the ' +
    "package's own build config, not here: exclude the tooling DIRECTORIES " +
    `(${CONVENTION.directories.split('|').join(', ')}) from the EMITTING program, not just the ` +
    '`*.test.*` name — that name-vs-directory mismatch is what shipped in objectui#4006 and again ' +
    'in objectui#4836. If the file loses its type coverage with the emit, name it in the package\'s ' +
    '`tsconfig.test.json` (PR #4845 did exactly this for `core.bench.ts`). If the file is a ' +
    '`*.tsbuildinfo` BUILD RECORD the remedy is a different one, because it has no tooling source ' +
    'and no `exclude` can stop it: set that package\'s `tsBuildInfoFile` EXPLICITLY, to a path ' +
    'outside the published build output. Do not leave it unset: the default is DERIVED, and it is ' +
    'not the package root. TypeScript takes the tsconfig\'s own path, swaps in the `.tsbuildinfo` ' +
    'extension, and remaps it from `rootDir` into `outDir` — so a package that sets an `outDir` and ' +
    'no `rootDir` derives its record to `outDir/` plus the config\'s own basename, i.e. INSIDE the ' +
    'directory this finding is about. The default lands at the package root only when the package ' +
    'sets no `outDir` at all, or when its `rootDir` happens to rebase the path back out of `outDir` ' +
    '— neither of which is a property a build record\'s location should depend on ' +
    '(objectui#9189, objectui#9329). `files: ["dist", …]` publishes that directory whole and the ' +
    'record names every input path on the machine that produced it (objectui#7003).',
  'no-build-output':
    'A published package produced nothing this gate could inspect. Either its build did not run ' +
    '(re-run without `--no-build`), or it now emits outside BUILD_OUTPUT_DIRS, or its `files` field ' +
    'no longer publishes its build output. All three are reported rather than skipped: an ' +
    'unexaminable package must not read as a clean one (objectui#4846).',
};

const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));
  const noBuild = process.argv.includes('--no-build');
  const force = process.argv.includes('--force');
  const clean = process.argv.includes('--clean');
  const concurrencyArg = argOf('--concurrency');
  const concurrency = concurrencyArg === null ? null : Number.parseInt(concurrencyArg, 10);
  if (concurrencyArg !== null && !Number.isInteger(concurrency)) {
    console.error(`❌  --concurrency expects an integer, got \`${concurrencyArg}\`.`);
    process.exit(1);
  }

  let result;
  let buildSeconds = null;
  try {
    const packages = discoverPublishedPackages(root);
    if (clean) cleanOutputs(root, packages, (line) => console.log(line));
    if (noBuild) {
      console.log(
        '`--no-build` given: inspecting the artifacts already on disk. This cannot pass vacuously — a ' +
          'published package with no build output is reported as `no-build-output`.',
      );
    } else {
      buildSeconds = buildWorkspace(root, { concurrency, force, log: (line) => console.log(line) });
    }
    result = analyze(root, { packages });
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: this gate decides what a published tarball ' +
        'contains,\n    so losing an input means it cannot decide, and a green verdict would have ' +
        'looked at nothing.',
    );
    process.exit(1);
  }

  const { findings, counters, srcTierPackages } = result;

  if (counters.packages < MIN_PACKAGES) {
    console.error(
      `The scan collapsed: ${counters.packages} published package(s), fewer than the ${MIN_PACKAGES} ` +
        'this repository has. The `fixed` group in .changeset/config.json, the manifest walk or the ' +
        '`private` filter is broken, and an empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  console.log(
    `Inspected ${counters.packages} published package(s)` +
      `${buildSeconds === null ? '' : ` after a ${buildSeconds}s build`}: ` +
      `${counters.files} tarball file(s), ${counters.output} of them build output, ` +
      `${counters.tooling} tooling artifact(s) in build output.`,
  );
  if (counters.srcTierTooling > 0) {
    console.log(
      `src-tier (reported, not enforced — see the scope note in this gate): ${counters.srcTierTooling} ` +
        `tooling file(s) ship OUTSIDE the build output of ${srcTierPackages.join(', ')}, because those ` +
        'packages list `src` in `files` (objectui#4851) or publish a build record from outside a ' +
        'build output directory (objectui#7003). Both are reported rather than enforced — see the ' +
        'scope note in scripts/check-published-dist-tooling.mjs.',
    );
  }

  if (findings.length === 0) {
    console.log("✅  No published package's build output carries tooling material.");
    process.exit(0);
  }

  const affected = new Set(findings.map((finding) => finding.pkg));
  console.error(`\n❌  ${findings.length} finding(s) across ${affected.size} published package(s):\n`);
  for (const finding of findings) {
    if (finding.reason === 'no-build-output') {
      console.error(`      ${finding.pkg}  [no-build-output]  ${finding.detail}`);
      continue;
    }
    console.error(`      ${finding.pkg}  [${finding.reason}]  ${finding.dir}/${finding.file}`);
  }
  for (const reason of Object.keys(HINTS)) {
    if (findings.some((finding) => finding.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }
  console.error(
    '\nThe file lists come from `npm pack --dry-run`, i.e. from what npm would actually publish — not ' +
      'from a\nwalk of `dist/`. See the header of scripts/check-published-dist-tooling.mjs ' +
      '(objectui#4846).',
  );
  process.exit(1);
}
