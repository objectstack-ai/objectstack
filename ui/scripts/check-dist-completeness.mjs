#!/usr/bin/env node
/**
 * A `tsc` package's `dist/` must hold every file `tsc` says it emits.
 *
 *   node scripts/check-dist-completeness.mjs            # the package in cwd
 *   node scripts/check-dist-completeness.mjs --all      # every tsc-built package
 *   node scripts/check-dist-completeness.mjs --list     # what is expected, and what is there
 *
 * Exit: 0 = every expected output is present (or the package was never built),
 *       1 = a package reports a built `dist/` that is missing files it must have.
 *
 * ## The failure this closes (objectui#6703)
 *
 * `packages/types/dist` was observed holding 4 of its 40 top-level `.d.ts`
 * files while the build that produced it **exited 0**. Downstream,
 * `packages/permissions` and `packages/mobile` then reported TypeScript errors
 * that read exactly like ordinary type errors in those packages — so the
 * developer's next move is to "fix" a type error that does not exist, in a
 * package nobody touched.
 *
 * The producer reporting success on a partial write is the whole defect. This
 * gate is the missing half: after `tsc` runs, something has to count.
 *
 * ## The mechanism, measured rather than assumed
 *
 * All twelve `"build": "tsc"` packages here set `composite: true`, and
 * `composite` implies `incremental`. So each writes a `tsconfig.tsbuildinfo`
 * recording what it has already emitted — and TypeScript resolves that file
 * NEXT TO `tsconfig.json`, **outside the `outDir` it describes**:
 *
 *     packages/types/tsconfig.tsbuildinfo     <- the record
 *     packages/types/dist/                    <- what it is a record OF
 *
 * Those two can therefore disagree, and when they do `tsc` believes the record.
 * It does not stat its own outputs. Measured on this tree at 4357ec7 — a
 * complete build, then `rm -rf dist` alone, then `tsc` again:
 *
 *     $ rm -rf packages/types/dist && ls packages/types/tsconfig.tsbuildinfo
 *     packages/types/tsconfig.tsbuildinfo
 *     $ cd packages/types && ../../node_modules/.bin/tsc ; echo $?
 *     0
 *     $ ls dist
 *     ls: cannot access 'dist': No such file or directory
 *
 * Zero of 40, exit 0, three seconds instead of seven. The same run truncated to
 * 4 of 40 instead of 0 reproduces the reported shape exactly: `tsc` exits 0 and
 * repairs nothing.
 *
 * `rm -rf dist` is not a hypothetical way into that state. It is what six of
 * these packages have literally spelled as their `clean` script, so
 * `pnpm clean && pnpm build` **was** a two-command recipe for an empty `dist/`
 * and a green exit code. That is fixed alongside this gate — `clean` now takes
 * the buildinfo with it — but the desync has other doors (an interrupted emit,
 * a concurrent tree operation, a restored cache), which is why the fix to
 * `clean` is not a substitute for counting.
 *
 * ## Why this reaches further than one developer's afternoon
 *
 * `turbo.json` gives the `build` task an `outputs` list covering `dist` and every
 * `.tsbuildinfo` (spelled there as globs, which cannot be quoted inside a block
 * comment without ending it — the trap `check-package-self-import.mjs` records), and
 * caches it. A `tsc` that short-circuits still exits 0, so turbo records that
 * run as a **successful build** and stores whatever `dist/` happened to be
 * there. Measured here, the resulting cache entry for `@object-ui/types:build`
 * held exactly two paths:
 *
 *     packages/types/tsconfig.tsbuildinfo
 *     packages/types/.turbo/turbo-build.log
 *
 * No `dist/` at all — and it replays as `cache hit … >>> FULL TURBO`, exit 0.
 * Worse, the entry is a fixed point: restoring it puts the buildinfo back
 * WITHOUT a `dist/`, which is precisely the desync that makes the next `tsc`
 * short-circuit again. `.github/workflows/lint.yml` already carries an
 * independent sighting of the replay half ("an entry recorded with an empty
 * output set replays as … FULL TURBO while writing no `dist/` at all"); this
 * gate names where such an entry comes from.
 *
 * Turbo also announces `using shared worktree cache` — that store is keyed off
 * the common `.git` directory, so one poisoned entry is visible to every
 * worktree of the repository at once. This is the concurrency dependence the
 * report describes: not two writers racing inside one `dist/`, but one
 * short-circuited build recording a green, empty artifact that every other
 * checkout then replays.
 *
 * Because turbo only caches a task that exited 0, running this check INSIDE the
 * build script is what matters: it stops the poisoned entry from ever being
 * recorded, rather than detecting it afterwards.
 *
 * ## Why the expectation is derived and never written down
 *
 * The report asks whether "40" is stable enough to assert against. It is not,
 * and it is also not the real number: 40 is the count of `packages/types/src/*.ts`
 * at depth one, while a complete build is 118 files (59 inputs x `.js` + `.d.ts`).
 * Any literal here would be wrong the first time a file is added.
 *
 * So nothing is hardcoded. The expected set comes from TypeScript's own API —
 * `parseJsonConfigFileContent` for the input set the package's own tsconfig
 * selects, then `getOutputFileNames` for what each input emits. That is the
 * same computation `tsc --build` uses to decide whether a project is up to
 * date, so the gate cannot disagree with the compiler about what "complete"
 * means, and it follows `declaration`, `declarationMap`, `sourceMap`, `jsx` and
 * `outDir` per package without being told about any of them.
 *
 * Verified against a full build of all twelve packages at 4357ec7:
 * 1,586 expected outputs derived, 0 missing. The derivation has no false
 * positives on a tree that is actually built.
 *
 * ## What "never built" means here, and why it is not a pass in disguise
 *
 * A package with neither a `dist/` nor a buildinfo has not been built, which is
 * an ordinary state (a fresh clone) and not this defect — those are skipped and
 * counted in the summary. A buildinfo with no `dist/` is NOT skipped: that is
 * the desync itself, and it is the state the empty cache entry restores.
 *
 * In the placement that matters — appended to each package's own `build` —
 * neither branch is reachable as an excuse, because `tsc` has just run.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where a workspace package can live. */
export const PACKAGE_ROOTS = ['packages', 'apps'];

/**
 * Does this manifest build by running `tsc` directly?
 *
 * Keyed on the build command rather than on "has a tsconfig with an outDir",
 * because a vite-built package has one of those too and emits a bundle whose
 * shape has nothing to do with `getOutputFileNames`. The `&&` split is what
 * keeps the answer `true` after this very gate is appended to the script.
 *
 * @param {any} manifest a parsed package.json
 * @returns {boolean}
 */
export function buildsWithTsc(manifest) {
  const build = manifest?.scripts?.build;
  if (typeof build !== 'string') return false;
  return build.split('&&')[0].trim() === 'tsc';
}

/**
 * Every workspace package whose `build` is `tsc`.
 *
 * Throws on an empty result rather than returning one: a walk that finds no
 * packages would pass every assertion below while looking at nothing, which is
 * the one thing a gate must never do.
 *
 * @param {string} [root]
 * @returns {{ name: string, dir: string, manifest: any }[]}
 */
export function discoverTscPackages(root = ROOT) {
  const found = [];
  for (const scanRoot of PACKAGE_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(root, scanRoot), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, scanRoot, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        throw new Error(`cannot read ${relative(root, manifestPath)}: ${error.message}`);
      }
      if (!manifest.name || !buildsWithTsc(manifest)) continue;
      found.push({ name: manifest.name, dir, manifest });
    }
  }
  if (found.length === 0) {
    throw new Error(
      `no workspace package with a "build": "tsc" script was found under ${PACKAGE_ROOTS.join(', ')} in ${root} — ` +
        'the walk is broken, and an empty scan would pass while checking nothing',
    );
  }
  return found;
}

/**
 * What `tsc` will emit for the project at `dir`, asked of TypeScript itself.
 *
 * @param {string} dir a package directory holding a tsconfig.json
 * @returns {{ inputs: string[], outputs: string[], buildInfoPath: string | undefined, outDir: string | undefined }}
 */
export function expectedEmit(dir) {
  const configPath = join(dir, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(
      `cannot read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir, undefined, configPath);
  const blocking = parsed.errors.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (blocking.length > 0) {
    throw new Error(
      `${configPath} does not parse: ${blocking
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
        .join('; ')}`,
    );
  }

  const outputs = [];
  if (!parsed.options.noEmit) {
    for (const input of parsed.fileNames) {
      outputs.push(...ts.getOutputFileNames(parsed, input, false));
    }
  }
  return {
    inputs: parsed.fileNames,
    outputs,
    buildInfoPath: ts.getTsBuildInfoEmitOutputFilePath?.(parsed.options),
    outDir: parsed.options.outDir,
  };
}

/**
 * @typedef {object} PackageAudit
 * @property {string} name
 * @property {string} dir
 * @property {'complete' | 'incomplete' | 'never-built' | 'no-emit'} state
 * @property {string[]} missing paths, relative to the repository root
 * @property {number} expected how many outputs `tsc` says it emits
 * @property {string | undefined} buildInfoPath
 * @property {boolean} buildInfoPresent
 */

/**
 * Judge one package.
 *
 * @param {{ name: string, dir: string }} pkg
 * @param {{ root?: string }} [options]
 * @returns {PackageAudit}
 */
export function auditPackage(pkg, { root = ROOT } = {}) {
  const { outputs, buildInfoPath, outDir } = expectedEmit(pkg.dir);
  const rel = (p) => relative(root, p);
  const buildInfoPresent = Boolean(buildInfoPath && existsSync(buildInfoPath));

  if (outputs.length === 0) {
    return { ...pkg, state: 'no-emit', missing: [], expected: 0, buildInfoPath, buildInfoPresent };
  }

  const distPresent = Boolean(outDir && existsSync(outDir));
  if (!distPresent && !buildInfoPresent) {
    return {
      ...pkg,
      state: 'never-built',
      missing: [],
      expected: outputs.length,
      buildInfoPath,
      buildInfoPresent,
    };
  }

  const missing = outputs.filter((o) => !existsSync(o)).map(rel);
  return {
    ...pkg,
    state: missing.length === 0 ? 'complete' : 'incomplete',
    missing,
    expected: outputs.length,
    buildInfoPath,
    buildInfoPresent,
  };
}

/**
 * Render the audits and decide the exit code.
 *
 * Split from the walk and from `process.exit` so the tests can assert on the
 * judgement and on the words a developer actually reads.
 *
 * @param {PackageAudit[]} audits
 * @param {{ root?: string, list?: boolean }} [options]
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function report(audits, { root = ROOT, list = false } = {}) {
  const lines = [];
  const broken = audits.filter((a) => a.state === 'incomplete');

  if (list) {
    for (const a of audits) {
      lines.push(`${a.name}: ${a.state} — ${a.expected} expected, ${a.missing.length} missing`);
    }
  }

  for (const a of broken) {
    const shown = a.missing.slice(0, 10);
    lines.push('');
    lines.push(`✗ ${a.name} reports a built dist/ that is missing ${a.missing.length} of ${a.expected} files tsc emits:`);
    for (const m of shown) lines.push(`    ${m}`);
    if (a.missing.length > shown.length) lines.push(`    … and ${a.missing.length - shown.length} more`);
    if (a.buildInfoPresent && a.buildInfoPath) {
      lines.push('');
      lines.push(
        `  ${relative(root, a.buildInfoPath)} still records those files as emitted, so tsc will NOT`,
      );
      lines.push('  re-emit them and will keep exiting 0. Repair:');
      lines.push('');
      lines.push(`      rm -f ${relative(root, a.buildInfoPath)}`);
      lines.push(`      pnpm --filter ${a.name} build`);
    }
  }

  if (broken.length > 0) {
    lines.push('');
    lines.push(
      'A dist/ that is incomplete does not fail where it is broken. It fails in the packages that',
    );
    lines.push(
      'IMPORT it, as ordinary-looking type errors in files nobody touched — see the header of',
    );
    lines.push('scripts/check-dist-completeness.mjs (objectui#6703).');
    return { exitCode: 1, lines };
  }

  const complete = audits.filter((a) => a.state === 'complete');
  const unbuilt = audits.filter((a) => a.state === 'never-built');
  const noEmit = audits.filter((a) => a.state === 'no-emit');
  const files = complete.reduce((n, a) => n + a.expected, 0);
  // The two skip reasons are reported apart on purpose. "never built" is a
  // tree state and says nothing about the package; "no emit" is a permanent
  // property of its tsconfig (it type-checks with `tsc` and emits with vite).
  // Collapsing them would let a package that stopped emitting read as one that
  // merely had not been built yet.
  const notes = [];
  if (unbuilt.length > 0) notes.push(`${unbuilt.length} not built yet`);
  if (noEmit.length > 0) notes.push(`${noEmit.length} type-check-only (tsc --noEmit)`);
  lines.push(
    `✓ dist completeness: ${complete.length} package(s) complete (${files} emitted files verified)` +
      (notes.length > 0 ? `; ${notes.join(', ')}` : ''),
  );
  return { exitCode: 0, lines };
}

/**
 * The whole check.
 *
 * @param {{ root?: string, all?: boolean, cwd?: string, list?: boolean }} [options]
 * @returns {{ exitCode: number, lines: string[], audits: PackageAudit[] }}
 */
export function analyze({ root = ROOT, all = false, cwd = process.cwd(), list = false } = {}) {
  let packages;
  if (all) {
    packages = discoverTscPackages(root);
  } else {
    const dir = resolve(cwd);
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`no package.json in ${dir} — run this from a package directory, or pass --all`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!buildsWithTsc(manifest)) {
      return {
        exitCode: 0,
        lines: [`· ${manifest.name ?? dir} does not build with tsc — nothing to verify`],
        audits: [],
      };
    }
    packages = [{ name: manifest.name, dir, manifest }];
  }

  const audits = packages.map((p) => auditPackage(p, { root }));
  const { exitCode, lines } = report(audits, { root, list });
  return { exitCode, lines, audits };
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const { exitCode, lines } = analyze({
    all: argv.includes('--all'),
    list: argv.includes('--list'),
  });
  for (const line of lines) (exitCode === 0 ? console.log : console.error)(line);
  process.exit(exitCode);
}
