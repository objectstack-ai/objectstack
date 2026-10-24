#!/usr/bin/env node
/**
 * Every published package's build tsconfig must exclude tooling DIRECTORIES,
 * not just tooling FILE NAMES.
 *
 * Run:  node scripts/check-published-tsconfig-tooling-exclude.mjs
 *       (also `pnpm check:published-tsconfig-exclude`)
 * Exit: 0 = every published package either carries the directory form or is a
 *           named, still-valid carve-out,
 *       1 = at least one names tooling by file name only, OR a carve-out's
 *           stated reason no longer holds, OR the scan collapsed.
 *
 * ## The defect this closes, and why it needed a gate rather than a fourth fix
 *
 * Three times a published package shipped tooling material because its build
 * tsconfig excluded `*.test.ts` by NAME and nothing under `__tests__/`:
 * objectui#4006 (`fields`, `plugin-editor` -- 73 `*.test.d.ts` in two published
 * `dist/`), objectui#4836 (`core`, `plugin-designer`, `plugin-grid`,
 * `plugin-view` -- 9 more, one of them `dist/__benchmarks__/core.bench.js`, a
 * real emitted module whose first statement imports `vitest`), and
 * objectui#6943 (`fields` AGAIN, `dist/__tests__/numberInputBrowserReadings.d.ts`
 * -- the same package as the first instance, because the first fix wrote the
 * name form and the directory form was never generalised).
 *
 * Each repair was correct and local, and each left the trap armed everywhere
 * else. objectui#7212 measured the standing exposure rather than an instance of
 * it: 29 published packages excluded tooling by name only, ALL of them with
 * ZERO offending files -- green because nobody had yet added a shared helper to
 * a `__tests__/` directory, not because the config would stop one. The
 * recurrence interval is what argued the altitude was wrong, and the maintainer
 * ruled for this gate on 2026-09-02 (objectui#7212 comment 5508046691).
 *
 * ## CONFIG SHAPE ONLY -- the line that keeps this clear of objectui#4846
 *
 * This gate reads `exclude` arrays. It never asks what an emitter would
 * produce, never builds, and never looks at an artifact. That narrowness is
 * load-bearing: objectui#4846 measured the cheap static gate "no build tsconfig
 * program may contain a TOOLING_FILE" and REJECTED it, because deciding whether
 * a tooling file in a program is a defect means reimplementing three
 * third-party emit semantics (bare `tsc` / `tsup`'s entry graph / unplugin-dts
 * merging its own globs with the tsconfig's). So the artifact-level
 * `check-published-dist-tooling.mjs` stays exactly as it is -- it is the second
 * line of defence and the only criterion that cannot be wrong about what ships.
 * This gate asks a strictly smaller question that needs no emit model at all:
 * DOES THE CONFIG NAME THE DIRECTORY. A package can satisfy it and still ship
 * tooling material for some other reason; that is the sibling gate's job.
 *
 * ## The convention is DERIVED, never retyped
 *
 * The tooling directories come out of `TOOLING_FILE` in
 * `check-phantom-dependencies.mjs` through the sibling gate's own
 * `toolingConventionFrom`, so all three gates cannot disagree about what
 * tooling material IS. Add a fourth tooling directory there and this gate
 * starts requiring it in the same commit.
 *
 * ## Why the bare-directory spelling is REJECTED although `tsc` honours it
 *
 * TypeScript treats an `exclude` entry naming a directory (`"src/__tests__"`)
 * as excluding it recursively, so that spelling is not wrong -- it is
 * POSITION-ANCHORED, which is a different property from the one this gate is
 * about. `"src/__tests__"` does not cover `src/renderers/__tests__/`, so a
 * package carrying it is protected only for as long as every tooling directory
 * stays at the top of `src/`. That is the same "green until someone adds a
 * file" shape the gate exists to end, one level over. `@object-ui/components`
 * carried exactly that spelling when this landed (and covered only ONE of the
 * three directories with it). The accepted forms are the anchored globs listed
 * in `ACCEPTED_FORMS`, and the failure message prints them.
 *
 * ## Carve-outs are NAMED, and they re-prove themselves on every run
 *
 * The maintainer's ruling requires the emitter carve-outs to be named rather
 * than inferred, and carried a confidence gap into implementation: whether the
 * four it listed were exhaustive was to be verified at authoring time. It was,
 * mechanically, against each package's actual build script and vite config --
 * and they were not. Two more published packages have an emitter that never
 * reads this file list, and both were inside the ruling's "29 name-only" red
 * set:
 *
 *   - `@object-ui/create-plugin` is a THIRD `tsup` package, alongside the `cli`
 *     and `data-objectstack` the ruling names. Same `tsup.config.ts` shape,
 *     same `dts: true`, same entry-graph emit.
 *   - `@object-ui/runner` is a SECOND Vite APPLICATION, alongside
 *     `@object-ui/console`. Its `vite.config.ts` loads no `dts()` plugin at all
 *     and its tsconfig sets `noEmit: true`, so it writes no declarations; its
 *     published `dist` is a bundle built from the Rollup entry graph.
 *
 * Requiring the directory form in either would be asserting something about a
 * config the emitter does not consult -- a phantom check, green about nothing,
 * which is the failure this repository treats as worse than no check.
 *
 * So every entry below states the FACTS that make it a carve-out, and `requires`
 * re-checks them on every run (the technique `HOST_PROVIDED` in
 * `check-phantom-dependencies.mjs` uses). The day `create-plugin` stops using
 * `tsup`, or `runner` gains a `dts()` plugin, the carve-out stops holding and
 * this gate goes red -- rather than silently exempting a package that now emits
 * declarations from a config nobody is checking.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLING_FILE } from './check-phantom-dependencies.mjs';
import {
  MIN_PACKAGES,
  discoverPublishedPackages,
  toolingConventionFrom,
} from './check-published-dist-tooling.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** The tooling directories, read out of the sibling gate's regex. */
export const TOOLING_DIRECTORIES = toolingConventionFrom(TOOLING_FILE.source).directories.split('|');

/**
 * The `exclude` spellings that cover a tooling directory wherever it sits.
 *
 * All four are anchored globs ending `<dir>/**`, which is what makes them
 * position-independent; see the header for why the bare-directory spelling is
 * not among them.
 */
export const ACCEPTED_FORMS = ['**/DIR/**', 'src/**/DIR/**', 'src/DIR/**', 'DIR/**'];

/** The spelling this gate tells an author to write. */
export const CANONICAL_FORM = '**/DIR/**';

/** The accepted `exclude` entries for one tooling directory. */
export const acceptedFormsFor = (dir) => ACCEPTED_FORMS.map((f) => f.replace('DIR', dir));

/** Does this `exclude` entry cover `dir` wherever it sits in the package? */
export const isDirectoryForm = (glob, dir) =>
  acceptedFormsFor(dir).includes(String(glob).split('\\').join('/'));

/** The tooling directories an `exclude` array does NOT cover. */
export function missingDirectories(exclude, directories = TOOLING_DIRECTORIES) {
  const entries = Array.isArray(exclude) ? exclude : [];
  return directories.filter((dir) => !entries.some((glob) => isDirectoryForm(glob, dir)));
}

// -- the workspace facts a carve-out is allowed to rest on ---------------------

/** JSONC -> JSON: strip `//` and block comments that are not inside a string. */
export function stripJsonComments(text) {
  let out = '';
  let i = 0;
  let inString = false;
  let escaped = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The `dts()` plugin options object in a vite config, brace-balanced. */
export function dtsOptionsBody(source) {
  const clean = stripJsonComments(source);
  const call = clean.indexOf('dts(');
  if (call < 0) return null;
  const open = clean.indexOf('{', call);
  const close = clean.indexOf(')', call);
  if (open < 0 || (close >= 0 && open > close)) return '';
  let depth = 0;
  let i = open;
  for (; i < clean.length; i += 1) {
    if (clean[i] === '{') depth += 1;
    else if (clean[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  return clean.slice(open, i);
}

/**
 * What a package's build actually is, read off disk rather than assumed.
 *
 * @returns {{ build: string, usesTsup: boolean, usesViteBuild: boolean,
 *             hasDtsPlugin: boolean, dtsHasOwnExclude: boolean,
 *             tsconfigNoEmit: unknown, exclude: unknown, hasTsconfig: boolean }}
 */
export function emitterFactsFor(root, pkg) {
  const dir = join(root, pkg.dir);
  const build = String(pkg.manifest?.scripts?.build ?? '');
  const viteConfig = ['vite.config.ts', 'vite.config.mts', 'vite.config.js']
    .map((f) => join(dir, f))
    .find((f) => existsSync(f));
  const dtsBody = viteConfig ? dtsOptionsBody(readFileSync(viteConfig, 'utf8')) : null;
  const tsconfigPath = join(dir, 'tsconfig.json');
  const hasTsconfig = existsSync(tsconfigPath);
  let tsconfig = null;
  if (hasTsconfig) {
    try {
      tsconfig = JSON.parse(stripJsonComments(readFileSync(tsconfigPath, 'utf8')));
    } catch (error) {
      throw new Error(`${pkg.dir}/tsconfig.json is not parseable as JSONC: ${error.message}`);
    }
  }
  return {
    build,
    usesTsup: /(^|[\s&|;])tsup([\s&|;]|$)/.test(build),
    usesViteBuild: /vite\s+build/.test(build),
    hasDtsPlugin: dtsBody !== null,
    dtsHasOwnExclude: typeof dtsBody === 'string' && /(^|[\s{,])exclude\s*:/.test(dtsBody),
    tsconfigNoEmit: tsconfig?.compilerOptions?.noEmit,
    exclude: tsconfig ? (tsconfig.exclude ?? null) : null,
    hasExcludeKey: Boolean(tsconfig) && Object.hasOwn(tsconfig, 'exclude'),
    hasTsconfig,
  };
}

/**
 * The packages whose emitter does not build its program from this tsconfig, so
 * requiring a shape in it would assert nothing.
 *
 * Each entry states the facts it rests on, and `requires` re-checks them every
 * run so an entry cannot outlive the package's claim to it. SHRINK-ONLY: a
 * carve-out naming a package that is no longer published is a failure, not a
 * no-op.
 */
export const EMITTER_CARVE_OUTS = {
  '@object-ui/cli': {
    reason:
      '`tsup` emits from its entry graph only, so the tsconfig file list does not decide what is ' +
      'written; having the tests in the program is exactly HOW they get their `tsc --noEmit` ' +
      'coverage (objectui#4846)',
    requires: (facts) => (facts.usesTsup ? null : `its build script is now \`${facts.build}\`, not tsup`),
  },
  '@object-ui/create-plugin': {
    reason:
      'the THIRD `tsup` package, found at authoring time rather than named in the ruling ' +
      '(objectui#7212): same `tsup.config.ts` shape and same `dts: true` entry-graph emit as ' +
      '`cli` and `data-objectstack`',
    requires: (facts) => (facts.usesTsup ? null : `its build script is now \`${facts.build}\`, not tsup`),
  },
  '@object-ui/data-objectstack': {
    reason: '`tsup` emits from its entry graph only (objectui#4846)',
    requires: (facts) => (facts.usesTsup ? null : `its build script is now \`${facts.build}\`, not tsup`),
  },
  // `@object-ui/plugin-charts` was here until objectui#7113, exempt precisely
  // BECAUSE its build tsconfig carried no `exclude` key — its tooling protection
  // lived only in the `exclude` passed to `dts()` in `vite.config.ts`. That
  // carve-out's own `requires` predicate is what retired it: the package now
  // carries the directory form in its build tsconfig, so `hasExcludeKey` fired
  // and the entry named its own remedy ("delete the entry and give the package
  // the directory form"). It has the directory form; the entry is deleted. The
  // `dts()` exclude is untouched, so the protection is now doubled, not moved.
  //
  // Why it grew an `exclude` at all: the package had NO test exclusion, so its
  // 45 test files were inputs to its emitting build program, and a pin that
  // needed `node:fs` could not be given `node` types without putting them in the
  // published program. It now excludes tests by directory and type-checks them
  // through `tsconfig.test.json`, the arrangement 34 of 38 test-bearing packages
  // already use.
  '@object-ui/console': {
    reason:
      'a Vite APPLICATION: `noEmit: true` and no `dts()` plugin, so it writes no declarations and ' +
      'its published bundle comes from the Rollup entry graph. Worth recording rather than just ' +
      'exempting -- it is the one package that DOES carry a non-test helper under a tooling ' +
      'directory (`src/__tests__/helpers/preview-page-sources.ts`), live behind this single guard',
    requires: (facts) => {
      if (facts.hasDtsPlugin) return 'its vite config now loads a `dts()` plugin, so it emits declarations';
      if (facts.tsconfigNoEmit !== true) return 'its tsconfig no longer sets `noEmit: true`';
      return null;
    },
  },
  '@object-ui/runner': {
    reason:
      'the SECOND Vite application, found at authoring time rather than named in the ruling ' +
      '(objectui#7212): same shape as `console` -- `noEmit: true`, no `dts()` plugin, published ' +
      '`dist` is a bundle from the Rollup entry graph',
    requires: (facts) => {
      if (facts.hasDtsPlugin) return 'its vite config now loads a `dts()` plugin, so it emits declarations';
      if (facts.tsconfigNoEmit !== true) return 'its tsconfig no longer sets `noEmit: true`';
      return null;
    },
  },
};

// -- the scan -----------------------------------------------------------------

/**
 * @returns {{ findings: object[], counters: object, packages: object[] }}
 */
export function analyze(root, { carveOuts = EMITTER_CARVE_OUTS, minPackages = MIN_PACKAGES } = {}) {
  const packages = discoverPublishedPackages(root);
  const findings = [];
  const counters = { published: packages.length, enforced: 0, exempt: 0, compliant: 0 };

  // A collapsed scan asserts nothing while exiting 0 -- the one verdict this
  // family of gates must never return (objectui#4846).
  if (packages.length < minPackages) {
    findings.push({
      reason: 'scan-collapsed',
      detail:
        `found ${packages.length} published packages, below the floor of ${minPackages}. The ` +
        'release group, the manifest walk or the workspace layout broke; an empty comparison ' +
        'would pass while reading nothing.',
    });
    return { findings, counters, packages };
  }

  const byName = new Map(packages.map((p) => [p.name, p]));

  // SHRINK-ONLY: a carve-out for a package npm no longer receives is stale.
  for (const name of Object.keys(carveOuts)) {
    if (!byName.has(name)) {
      findings.push({
        reason: 'stale-carve-out',
        pkg: name,
        detail:
          'is named as an emitter carve-out but is not a published package any more. Delete the ' +
          'entry -- a carve-out list that outlives its packages is how the next one gets added ' +
          'without anyone re-reading why.',
      });
    }
  }

  for (const pkg of packages) {
    let facts;
    try {
      facts = emitterFactsFor(root, pkg);
    } catch (error) {
      findings.push({ reason: 'unreadable-tsconfig', pkg: pkg.name, detail: error.message });
      continue;
    }

    const carveOut = carveOuts[pkg.name];
    if (carveOut) {
      const broken = carveOut.requires(facts);
      if (broken) {
        findings.push({
          reason: 'carve-out-no-longer-holds',
          pkg: pkg.name,
          detail:
            `is exempt because ${carveOut.reason} -- but ${broken}. Re-derive the exemption ` +
            'against the build it has NOW, or delete the entry and give the package the ' +
            'directory form.',
        });
      }
      counters.exempt += 1;
      continue;
    }

    counters.enforced += 1;

    if (!facts.hasTsconfig) {
      findings.push({
        reason: 'no-build-tsconfig',
        pkg: pkg.name,
        detail:
          `has no ${pkg.dir}/tsconfig.json, so there is no build config to check. Reported as a ` +
          'finding rather than a skip: "nothing to look at, therefore clean" is the verdict this ' +
          'gate must never return.',
      });
      continue;
    }

    const missing = missingDirectories(facts.exclude, TOOLING_DIRECTORIES);
    if (missing.length) {
      findings.push({
        reason: 'name-only-tooling-exclude',
        pkg: pkg.name,
        dir: pkg.dir,
        missing,
        detail:
          `its build tsconfig does not exclude ${missing.map((d) => `\`${d}/\``).join(', ')} as a ` +
          `DIRECTORY. Current \`exclude\`: ${JSON.stringify(facts.exclude)}. Add ` +
          `${missing.map((d) => `"${CANONICAL_FORM.replace('DIR', d)}"`).join(', ')}.`,
      });
      continue;
    }

    counters.compliant += 1;
  }

  return { findings, counters, packages };
}

// -- reporting ----------------------------------------------------------------

export function report({ findings, counters }, log = console.log, logError = console.error) {
  log('Published build tsconfigs -- tooling directories must be excluded by DIRECTORY, not by name');
  log(
    `  scanned ${counters.published} published package(s): ` +
      `${counters.enforced} enforced, ${counters.exempt} named emitter carve-out(s)`,
  );
  log(`  tooling directories (derived from TOOLING_FILE): ${TOOLING_DIRECTORIES.join(', ')}`);

  if (!findings.length) {
    log(`OK -- all ${counters.compliant} enforced package(s) carry the directory form.`);
    return 0;
  }

  logError('');
  for (const finding of findings) {
    logError(`FAIL [${finding.reason}] ${finding.pkg ?? ''}`.trimEnd());
    logError(`  ${finding.detail}`);
  }
  logError('');
  logError(
    `${findings.length} finding(s). A tooling exclude written as a FILE NAME (\`*.test.ts\`) stops ` +
      'the files that happen to be named that way and nothing else; the first shared helper added ' +
      "to a `__tests__/` directory is emitted into the package's published `dist` " +
      '(objectui#4006 / #4836 / #6943 -- three times, each caught by a human).',
  );
  logError(
    'Accepted spellings for a tooling directory DIR (substitute the directory name for DIR): ' +
      `${ACCEPTED_FORMS.join(', ')} -- anchored globs, so they cover the directory wherever it sits.`,
  );
  return 1;
}

export function main(root = join(scriptDir, '..'), log = console.log, logError = console.error) {
  return report(analyze(root), log, logError);
}

if (isEntrypoint(import.meta.url)) {
  process.exit(main());
}
