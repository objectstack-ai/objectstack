/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectui doctor` — project health diagnosis.
 *
 * ## Tailwind: v4-only, because this repo is v4-only (objectui#3891)
 *
 * The Tailwind section used to be written against Tailwind 3 and got every
 * question backwards on a v4 project:
 *
 *  - It counted a **missing `tailwind.config.js` as an issue**. In v4 that file
 *    is not part of the setup at all — the engine reads CSS-first configuration
 *    (`@import 'tailwindcss'`, `@theme`, `@source`) and only looks at a JS
 *    config when a stylesheet explicitly opts in with `@config`. So the advice
 *    pushed readers toward creating a file Tailwind would never read. Running
 *    `objectui doctor` at this repo's own root reproduced it: there is no root
 *    `tailwind.config.*`, and doctor reported a problem that did not exist.
 *  - It then graded that file on its **`content` array**, the v3 key that
 *    `@source` replaced. The two `tailwind.config.*` files still tracked in this
 *    repo (`apps/console`, `examples/byo-backend-console`) are exactly this
 *    trap: both declare `content: ['./src/**\/*.{ts,tsx}', …]`, no stylesheet
 *    anywhere in the repo contains `@config`, so both files are inert — and the
 *    old check answered "✓ Tailwind content paths configured" for them. A false
 *    green on a dead file is worse than silence.
 *  - It **never checked `@tailwindcss/postcss`**, which is the one dependency a
 *    v4 project genuinely cannot build without. v4 moved the PostCSS plugin out
 *    of `tailwindcss` into that separate package; naming the old `tailwindcss`
 *    key in a PostCSS config resolves to a shim whose only job is to throw. That
 *    is the failure form objectui#3852 measured on the generated app, and doctor
 *    happily printed "✓ Tailwind CSS installed" through it.
 *
 * So the checks below are the v4 contract, matching what `objectui init`
 * scaffolds (see `utils/app-generator.ts`): `@tailwindcss/postcss` available, a
 * PostCSS config that names it rather than the v3 `tailwindcss` key, and a CSS
 * entry that runs `@import 'tailwindcss'`. A missing `tailwind.config.*` is
 * **not** reported; a *present* one is reported only when nothing opts into it
 * via `@config`, which is the case where it silently does nothing.
 *
 * A v3-tolerant dual path (branching on the declared `tailwindcss` major and
 * running two sets of checks) was considered and deliberately not built — it
 * widens the product surface past this repo's v4-only posture. v3 spellings are
 * therefore diagnosed as *migration debt*, not supported as a second mode.
 *
 * ## Structure
 *
 * `runDiagnostics(cwd)` is the whole diagnosis and returns structured results;
 * `doctor()` only renders them and counts. Splitting the two is what makes the
 * matrix above testable against real fixture directories instead of scraped
 * console output.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';

/** `ok` never counts toward the issue total; `warn` and `error` both do. */
export type DoctorDiagnosticLevel = 'ok' | 'warn' | 'error';

/**
 * One `objectui doctor` check result.
 *
 * `Doctor`-prefixed, like its level: `@object-ui/sdui-parser` publishes
 * `Diagnostic` for a parser finding, and the flow designer's `DiagnosticLevel`
 * is `'error' | 'warning'` with no `ok` verdict — different things, and one
 * exported name has one authority (objectui#6349, batch 6).
 */
export interface DoctorDiagnostic {
  level: DoctorDiagnosticLevel;
  /** The single line rendered for this finding. */
  message: string;
  /**
   * Stable identifier for the finding, so tests (and any future machine
   * readable output) pin the *verdict* rather than prose wording.
   */
  id: string;
}

/**
 * CSS entrypoint candidates, in the order doctor prefers them. `src/index.css`
 * is first because that is what `objectui init` generates; the rest cover the
 * common Vite / Next.js / plain layouts. Every candidate that exists is read —
 * the Tailwind verdicts below ask "does *any* entry do this", so a project with
 * several stylesheets is not judged on whichever one happens to sort first.
 */
const CSS_ENTRY_CANDIDATES = [
  'src/index.css',
  'src/main.css',
  'src/styles.css',
  'src/style.css',
  'src/app.css',
  'src/global.css',
  'src/globals.css',
  'app/globals.css',
  'app/global.css',
  'styles/globals.css',
  'index.css',
  'styles.css',
];

const TAILWIND_CONFIG_CANDIDATES = [
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'tailwind.config.ts',
];

const POSTCSS_CONFIG_CANDIDATES = [
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
  'postcss.config.ts',
];

/** `@import 'tailwindcss'` — the v4 entrypoint, with or without a `layer()`. */
const V4_CSS_IMPORT = /@import\s+["']tailwindcss["']/;
/** `@tailwind base;` / `components` / `utilities` — the v3 directives. */
const V3_CSS_DIRECTIVE = /@tailwind\s+(?:base|components|utilities|screens|variants)\b/;
const CSS_SOURCE_DIRECTIVE = /@source\s+["']/;
const CSS_CONFIG_DIRECTIVE = /@config\s+["']/;

/**
 * The v4 PostCSS plugin, in either object (`'@tailwindcss/postcss': {}`) or
 * array (`require('@tailwindcss/postcss')`) form.
 */
const V4_POSTCSS_PLUGIN = /@tailwindcss\/postcss/;
/**
 * The v3 spelling: `tailwindcss` named as a plugin itself, in either the
 * quoted (`'tailwindcss': {}`, `require('tailwindcss')`) or the bare-key
 * (`tailwindcss: {}`) form.
 *
 * Neither alternative can match inside `'@tailwindcss/postcss'`: the quoted one
 * needs a quote immediately before `tailwindcss` and finds `@`, and the bare
 * one needs a key boundary before it and a `:` after it, where the scoped name
 * has `@` and `/`. That non-match is pinned by a test — it is the difference
 * between diagnosing a v3 config and having every healthy v4 project
 * self-report.
 */
const V3_POSTCSS_PLUGIN = /["']tailwindcss["']|(?:^|[{,\s])tailwindcss\s*:/m;

function readIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  } catch {
    return null;
  }
}

/** First existing path from `candidates`, relative to `cwd`. */
function findFile(cwd: string, candidates: readonly string[]): string | null {
  for (const rel of candidates) {
    const abs = join(cwd, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

/**
 * Leading major of a dependency range. Returns `null` for anything without a
 * usable number — `workspace:*`, `catalog:`, a git URL, `latest` — because
 * "cannot tell" must not be reported as "wrong version".
 */
function majorOf(range: string): number | null {
  const match = /(\d+)/.exec(range);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isNaN(major) ? null : major;
}

/**
 * Is `specifier` installed for this project — i.e. present in a `node_modules`
 * at `cwd` or any ancestor?
 *
 * Declaration in `package.json` is the primary signal, but it is not the only
 * valid setup: inside a workspace the plugin is frequently installed by a
 * parent while the leaf `package.json` stays silent. Checking the tree is what
 * keeps this from replacing objectui#3891's false positive with a new one on
 * every workspace package.
 *
 * Deliberately a manual walk rather than `createRequire(…).resolve()`, even
 * though the latter looks more authoritative. Node's resolver also consults
 * `NODE_PATH` and the global folders, and `NODE_PATH` is not hypothetical
 * here: vitest sets it to pnpm's virtual store (`node_modules/.pnpm/…`), so
 * under test *every* package in the monorepo resolves from *any* directory —
 * including a fresh `os.tmpdir()` fixture with an empty `package.json`. That
 * made the "plugin is missing" branch unreachable in tests and would have
 * shipped it unverified. The walk below answers the question a bundler
 * actually asks and depends on nothing but the filesystem.
 */
function isInstalledFrom(cwd: string, specifier: string): boolean {
  let dir = resolvePath(cwd);
  for (;;) {
    if (existsSync(join(dir, 'node_modules', ...specifier.split('/')))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Run every diagnostic against `cwd` and return the findings in render order.
 * Pure with respect to stdout — see the module docblock.
 */
export function runDiagnostics(cwd: string): DoctorDiagnostic[] {
  const results: DoctorDiagnostic[] = [];
  const ok = (id: string, message: string): void => {
    results.push({ id, level: 'ok', message });
  };
  const warn = (id: string, message: string): void => {
    results.push({ id, level: 'warn', message });
  };
  const error = (id: string, message: string): void => {
    results.push({ id, level: 'error', message });
  };

  // ---------------------------------------------------------------- package.json
  const pkgPath = join(cwd, 'package.json');
  const pkgRaw = readIfExists(pkgPath);
  let pkg: Record<string, Record<string, string> | undefined> | null = null;

  if (pkgRaw === null) {
    error('package-json-missing', 'package.json not found');
  } else {
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      error('package-json-unreadable', 'Failed to parse package.json');
    }
  }

  const deps: Record<string, string> = pkg
    ? { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    : {};

  if (pkg) {
    if (deps.react) {
      ok('react-installed', 'React installed');
    } else {
      warn('react-missing', 'React not found in dependencies');
    }
  }

  // -------------------------------------------------------------------- Tailwind
  //
  // Everything below is gated on the project declaring `tailwindcss` at all. A
  // directory that does not use Tailwind must not collect Tailwind findings —
  // the "not found" line above already says the one thing worth saying.
  const tailwindRange = pkg ? deps.tailwindcss : undefined;

  if (pkg && !tailwindRange) {
    warn('tailwind-missing', 'Tailwind CSS not found in dependencies');
  }

  if (tailwindRange) {
    const major = majorOf(tailwindRange);
    if (major !== null && major < 4) {
      warn(
        'tailwind-major-legacy',
        `Tailwind CSS ${tailwindRange} detected — ObjectUI targets Tailwind 4. ` +
          'Upgrade with `npx @tailwindcss/upgrade`, then move configuration into ' +
          "your CSS entry (`@import 'tailwindcss'`, `@theme`, `@source`).",
      );
    } else {
      ok('tailwind-installed', `Tailwind CSS ${tailwindRange} installed`);
    }

    // 1. The v4 PostCSS plugin — the dependency a v4 build actually fails without.
    if (deps['@tailwindcss/postcss']) {
      ok('tailwind-postcss-declared', '@tailwindcss/postcss declared');
    } else if (isInstalledFrom(cwd, '@tailwindcss/postcss')) {
      ok(
        'tailwind-postcss-installed',
        '@tailwindcss/postcss installed (provided by the workspace)',
      );
    } else {
      error(
        'tailwind-postcss-missing',
        'Tailwind CSS 4 needs @tailwindcss/postcss, which is neither declared ' +
          'nor installed here. v4 moved the PostCSS plugin out of `tailwindcss` ' +
          'into its own package; without it PostCSS fails to load and no ' +
          'styles are emitted. Install it: `npm i -D @tailwindcss/postcss`.',
      );
    }

    // 2. The PostCSS config, when there is one, must name the v4 plugin.
    const postcssConfigPath = findFile(cwd, POSTCSS_CONFIG_CANDIDATES);
    if (postcssConfigPath) {
      const postcssConfig = readIfExists(postcssConfigPath) ?? '';
      const hasV4Plugin = V4_POSTCSS_PLUGIN.test(postcssConfig);
      // Evaluated independently of `hasV4Plugin`, not as its `else` branch: a
      // half-finished migration that lists both entries still throws on the
      // v3 one, and that is the state worth naming.
      const hasV3Plugin = V3_POSTCSS_PLUGIN.test(postcssConfig);

      if (hasV3Plugin) {
        error(
          'postcss-plugin-v3',
          'PostCSS config names `tailwindcss` as a plugin — the Tailwind 3 ' +
            'spelling. In v4 that entry resolves to a shim whose only job is ' +
            "to throw. Replace it with `'@tailwindcss/postcss': {}`.",
        );
      } else if (hasV4Plugin) {
        ok('postcss-plugin-v4', 'PostCSS config uses @tailwindcss/postcss');
      } else {
        warn(
          'postcss-plugin-absent',
          'PostCSS config does not register a Tailwind plugin. Add ' +
            "`'@tailwindcss/postcss': {}` so Tailwind runs during the build.",
        );
      }
    }

    // 3. The CSS entry must start the v4 engine. Read every candidate that
    //    exists and ask whether *any* of them does — see CSS_ENTRY_CANDIDATES.
    const cssEntries = CSS_ENTRY_CANDIDATES.map((rel) => ({
      rel,
      content: readIfExists(join(cwd, rel)),
    })).filter((entry): entry is { rel: string; content: string } => entry.content !== null);

    const importsTailwind = cssEntries.some((entry) => V4_CSS_IMPORT.test(entry.content));
    const usesV3Directives = cssEntries.some((entry) => V3_CSS_DIRECTIVE.test(entry.content));
    const declaresSource = cssEntries.some((entry) => CSS_SOURCE_DIRECTIVE.test(entry.content));
    const optsIntoJsConfig = cssEntries.some((entry) => CSS_CONFIG_DIRECTIVE.test(entry.content));

    if (cssEntries.length === 0) {
      // No recognised entrypoint — say nothing. A monorepo root or an app with
      // a bespoke CSS layout is not evidence of a misconfiguration, and
      // objectui#3891 is precisely about doctor asserting things it cannot see.
    } else if (importsTailwind) {
      ok('css-entry-v4-import', "CSS entry runs `@import 'tailwindcss'`");
      if (declaresSource) {
        ok('css-entry-source', 'CSS entry declares `@source` scanning paths');
      }
    } else if (usesV3Directives) {
      error(
        'css-entry-v3-directives',
        'CSS entry still uses the Tailwind 3 `@tailwind base/components/' +
          "utilities` directives. Tailwind 4 replaces all three with a single " +
          "`@import 'tailwindcss';`.",
      );
    } else {
      warn(
        'css-entry-no-tailwind',
        "No CSS entry runs `@import 'tailwindcss'`, so Tailwind never starts. " +
          `Checked: ${cssEntries.map((entry) => entry.rel).join(', ')}.`,
      );
    }

    // 4. `tailwind.config.*` — absence is correct in v4 and reported as nothing
    //    at all. Presence is reported only when it is inert.
    const tailwindConfigPath = findFile(cwd, TAILWIND_CONFIG_CANDIDATES);
    if (tailwindConfigPath && !optsIntoJsConfig) {
      const rel = tailwindConfigPath.slice(cwd.length + 1);
      warn(
        'tailwind-config-inert',
        `${rel} exists but nothing opts into it — Tailwind 4 ignores a JS ` +
          'config unless a stylesheet declares `@config`. Anything it sets ' +
          '(theme, content/@source paths, plugins) has no effect today. ' +
          'Either delete it and move the settings into your CSS entry, or add ' +
          `\`@config '${rel}';\` there.`,
      );
    } else if (tailwindConfigPath) {
      ok('tailwind-config-active', 'JS Tailwind config is loaded via `@config`');
    }
  }

  // ------------------------------------------------------------------ TypeScript
  if (existsSync(join(cwd, 'tsconfig.json'))) {
    ok('tsconfig-found', 'tsconfig.json found');
    const tsRange = deps.typescript;
    if (tsRange) {
      const major = majorOf(tsRange);
      if (major !== null && major < 5) {
        warn('typescript-legacy', `TypeScript ${tsRange} detected — version 5.0+ recommended`);
      } else {
        ok('typescript-version', `TypeScript ${tsRange} (5.0+ required)`);
      }
    }
  } else {
    warn('tsconfig-missing', 'tsconfig.json not found');
  }

  // -------------------------------------------------------------- Peer contracts
  if (pkg) {
    if (deps['@object-ui/react'] && !deps.react) {
      warn('peer-react', '@object-ui/react requires react as a peer dependency');
    }
    if (deps['@object-ui/components'] && !deps.tailwindcss) {
      warn('peer-tailwind', '@object-ui/components requires tailwindcss as a peer dependency');
    }
  }

  return results;
}

/** Number of findings that count as problems. `ok` findings never do. */
export function countIssues(results: readonly DoctorDiagnostic[]): number {
  return results.filter((result) => result.level !== 'ok').length;
}

export async function doctor() {
  console.log(chalk.bold('Object UI Doctor'));
  console.log('Diagnosis in progress...\n');

  const results = runDiagnostics(process.cwd());

  for (const result of results) {
    if (result.level === 'ok') {
      console.log(chalk.green(`✓ ${result.message}`));
    } else if (result.level === 'warn') {
      console.log(chalk.yellow(`⚠️ ${result.message}`));
    } else {
      console.log(chalk.red(`x ${result.message}`));
    }
  }

  const issues = countIssues(results);
  console.log('\nResult:');
  if (issues === 0) {
    console.log(chalk.green('Everything looks good! ✨'));
  } else {
    console.log(chalk.yellow(`Found ${issues} issue(s).`));
  }
}
