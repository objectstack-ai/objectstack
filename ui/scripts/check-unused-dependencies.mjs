#!/usr/bin/env node

/**
 * Every runtime dependency a released package DECLARES must have a consumer in
 * that package — the direction `check:phantom-deps` deliberately does not judge.
 *
 * Run:  node scripts/check-unused-dependencies.mjs   (also `pnpm check:unused-deps`)
 * Exit: 0 = every gated declaration has a consumer, 1 = at least one does not
 *
 * ## The gap this closes (objectui#8198, split out of objectui#7625)
 *
 * `scripts/check-phantom-dependencies.mjs` asks "is what you IMPORT declared?".
 * Its own scope note names the direction it leaves open:
 *
 *     The REVERSE direction — a declared dependency nothing imports — is not
 *     checked. It is a real question (dead weight in every consumer's install)
 *     and a different one; a package may legitimately declare something it uses
 *     from a non-`src` path.
 *
 * Nothing in CI asked the reverse question, so a declaration could outlive its
 * last consumer indefinitely. objectui#7397 deleted
 * `packages/components/src/ui/chart.tsx`, the only file in `@object-ui/components`
 * that imported `recharts`; the `recharts` declaration stayed. It was removed by
 * hand on objectui#7625 after a human noticed. Measured there on `0c8dbc492`,
 * with the positive control a zero needs:
 *
 *     recharts under packages/components/src     0 files
 *     lucide-react, same command shape          70 files   (control fires)
 *
 * The cost is install-graph weight for every consumer, not shipped bytes: these
 * packages' Vite `external` predicates are path-based and never read
 * `dependencies`, so no bundle budget moves and no test fails. That is precisely
 * what makes it invisible without a gate.
 *
 * ## Why this is a separate script, not a second direction inside phantom-deps
 *
 * The two gates disagree about the POPULATION OF FILES, and that is the whole
 * reason phantom-deps gave for leaving this direction alone. phantom-deps reads
 * `src/**` only, and must: a `vite.config.ts` import is not a shipped import, so
 * grading it against the runtime fields would be wrong. This gate must read the
 * OPPOSITE way round — a dependency consumed only by `vite.config.ts`, only by a
 * `.css` file, or only by a `scripts/` helper is still consumed, and a gate that
 * could not see those files would report it as dead. One scanner cannot serve
 * both scopes without a per-question switch, which is two gates wearing one
 * exit code.
 *
 * The exit code matters on its own. phantom-deps is green with zero findings;
 * this direction found 41 unused runtime declarations on `fc32921aa`. Fusing
 * them would have meant either holding phantom-deps' verdict hostage to this
 * cleanup or landing this one non-enforcing. Separate scripts, separate
 * verdicts, one shared parser: every helper below is IMPORTED from phantom-deps
 * (`discoverPackages`, `readReleaseGroup`, `moduleSpecifiers`, `packageNameOf`,
 * `isBuiltin`, `SKIP_DIRS`, `SOURCE_FILE`), so the two directions cannot come to
 * disagree about what an import is.
 *
 * ## What is gated, and what is only MEASURED
 *
 * Gated: `dependencies` and `optionalDependencies`. These are the fields whose
 * entries a consumer's install FETCHES on this package's say-so, so "nothing
 * here consumes it" makes the declaration false and the download unearned.
 *
 * NOT gated, and each for a stated reason rather than by omission — both counts
 * are printed on every run so the size of the concession stays visible:
 *
 *   - **`peerDependencies`.** A peer is a constraint on the HOST's graph, not a
 *     claim that this package imports the name. Measured on `fc32921aa`: 22 peer
 *     declarations have no consumer in their own package, and 21 of them are
 *     `react-dom` — the DOM renderer these component libraries require of
 *     whatever application mounts them, declared by 21 packages including the
 *     three (`plugin-charts`, `plugin-form`, `plugin-list`) that declare it
 *     NOWHERE else. The 22nd is `@object-ui/app-shell`'s peer on
 *     `@object-ui/plugin-kanban`, the optional-plugin shape. Gating this field
 *     would red 21 packages on day one over a convention, which is a decision
 *     for the maintainer and not a rider on a tooling card (objectui#8280).
 *   - **`devDependencies`.** They cost a consumer nothing — they are the field
 *     an install does not fetch, which is the premise phantom-deps' runtime tier
 *     rests on. Measured: 122 have no import in their own package, and the class
 *     is dominated by toolchain named BY STRING in a config rather than
 *     imported (eslint plugins, `@types/*`, tsconfig bases). A gate here would
 *     be a large false-positive surface protecting nobody.
 *
 * ## What counts as a consumer
 *
 * Three rules, each mechanical. A rule is preferred to an allowance every time,
 * because a rule keeps working for the NEXT package.
 *
 *   1. **A module specifier anywhere in the package directory** — every file the
 *      parser can read, not just `src/`: `vite.config.ts`, `tsup.config.ts`,
 *      `scripts/`, `bin/`, `postcss.config.*`. All five specifier forms, via
 *      phantom-deps' parser.
 *   2. **A CSS at-rule target.** `@plugin 'tailwindcss-animate'` in
 *      `packages/components/src/index.css` is a real consumer that no import
 *      scanner sees; `@import`, `@plugin`, `@config`, `@source` and `@use` are
 *      all read. This rule alone resolves four otherwise-false hits
 *      (`tailwindcss-animate` in `components` and `runner`, `tailwindcss` in
 *      `components`' peers, and the `@import 'tailwindcss'` in `runner`).
 *   3. **`@types/X` follows X.** A types package is consumed by `tsc`, never by
 *      an import, so it is consumed exactly when the package it types is.
 *      `@types/foo__bar` is read as `@scope`-style `@foo/bar`, npm's own
 *      mangling. `@types/node` is the ONE exception and is named in
 *      `GLOBAL_TYPES_PACKAGES`: what it supplies is a global scope (`process`,
 *      `Buffer`, `NodeJS.*`), not a module edge, so no import scan can falsify
 *      it and one that tried would red a package for reading `process.env`.
 *      Counted separately on every run so the carve-out is not silent.
 *
 * One class is deliberately NOT given a rule, and is written down so the next
 * reader knows it was considered rather than missed: a package named by STRING
 * KEY in a `postcss.config.*` / `tailwind.config.*` plugin map. It is a real
 * class in the wild; this repository has zero instances of it (every such config
 * here either `require()`s the plugin, which rule 1 reads, or lives in CSS,
 * which rule 2 reads). Adding an unexercised rule would be a detection surface
 * with nothing behind it — file it when an instance appears.
 *
 * ## Allowances carry evidence, and delete themselves
 *
 * `DECLARED_WITHOUT_IMPORT` is the escape hatch, and it is shaped after
 * phantom-deps' `BUNDLED_APPLICATIONS`: every row states a reason AND a `verify`
 * that re-derives the reason from the repository on each run. A row is reported
 * as stale — and fails the build exactly like an unused dependency would — when
 * any of four things is true:
 *
 *   1. the package is no longer in the released population;
 *   2. the key is no longer declared in a gated field (the row outlived the
 *      declaration it excused);
 *   3. the key now HAS a consumer (the row is no longer doing anything, and a
 *      row nobody needs is a row nobody re-reads);
 *   4. `verify` finds the evidence gone.
 *
 * Rule 3 is the one that makes this self-deleting rather than merely
 * self-checking: an allowance that has quietly stopped applying is how a
 * baseline turns into a permanent allowlist.
 *
 * ## What the first enforcing run required
 *
 * 41 unused runtime declarations on `fc32921aa`, across 20 of the 40 released
 * packages. 37 were REMOVED in the pull request that landed this gate — every
 * one verified by a whole-package grep first, so that the name appeared nowhere
 * in the package but its own manifest and CHANGELOG. Four are allowed below,
 * because each has a consumer this gate structurally cannot see: a specifier
 * emitted into GENERATED source (`@object-ui/cli`) and a specifier a bundler
 * inlines by name from its config (`object-ui`). Both are verified on every run.
 *
 * The removals are not cosmetic. `@object-ui/plugin-designer` declared all three
 * `@dnd-kit` packages and imports none of them; `@object-ui/plugin-chatbot`
 * declared `react-markdown`, `react-syntax-highlighter` and `remark-gfm`, which
 * together dominate its install; `@object-ui/layout` and
 * `@object-ui/plugin-dashboard` each pinned `react-dom` at an exact version in
 * `dependencies` while also declaring it as a peer range — a library hard-
 * depending on the renderer it asks its host to supply, which is the defect
 * their siblings `plugin-charts` / `plugin-form` / `plugin-list` do not have.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import {
  SKIP_DIRS,
  SOURCE_FILE,
  discoverPackages,
  isBuiltin,
  moduleSpecifiers,
  packageNameOf,
} from './check-phantom-dependencies.mjs';


const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * The fields a consumer's install FETCHES on this package's say-so.
 *
 * `peerDependencies` is deliberately absent — see the header. It is a constraint
 * on the host's graph, not a claim to import the name.
 */
export const GATED_FIELDS = ['dependencies', 'optionalDependencies'];

/** Fields measured and reported but not gated, so the concession stays visible. */
export const MEASURED_FIELDS = ['peerDependencies', 'devDependencies'];

/** Stylesheet extensions whose at-rules name packages. */
export const STYLESHEET_FILE = /\.(css|scss|sass|less)$/;

/**
 * A stylesheet at-rule that names a package.
 *
 * Tailwind 4 is CSS-first: `@plugin 'tailwindcss-animate'` and
 * `@import 'tailwindcss'` are the ONLY consumers those two packages have in this
 * repository, and no import scanner can see either.
 */
export const CSS_AT_RULE = /@(?:import|plugin|config|source|use)\s+(?:url\(\s*)?['"]([^'"]+)['"]/g;

/**
 * The one types package whose consumer is a GLOBAL scope, not a module edge.
 *
 * `@types/node` declares "this package targets Node". What it supplies is
 * `process`, `Buffer` and the `NodeJS.*` namespace — none of which is reachable
 * through any module specifier, so no import scan can falsify the declaration
 * and a scan that tried would red a package for using `process.env`. This is the
 * mirror image of phantom-deps' own grading, which accepts `@types/node` in ANY
 * dependency field as the evidence that a package may import a builtin.
 *
 * Stated as a named carve-out and COUNTED on every run rather than folded into
 * the general rule below: it is the one name this gate cannot judge, and a
 * silent version of that is indistinguishable from a bug.
 */
export const GLOBAL_TYPES_PACKAGES = new Set(['@types/node']);

/**
 * The package a `@types/…` name provides types for.
 *
 * npm mangles a scoped name into `@types/scope__name`, so the inverse is applied
 * here rather than left as a hole: `@types/babel__core` types `@babel/core`.
 */
export function typedPackageOf(name) {
  if (!name.startsWith('@types/')) return null;
  const tail = name.slice('@types/'.length);
  const scoped = /^(.+?)__(.+)$/.exec(tail);
  return scoped ? `@${scoped[1]}/${scoped[2]}` : tail;
}

/**
 * Every file under `dir`, as absolute paths — the WHOLE package, not only `src/`.
 *
 * This is the deliberate difference from phantom-deps' `listSourceFiles`, and it
 * is the reason the two gates are two files: a dependency consumed only by a
 * build config or only by a stylesheet is consumed, and a scan that stopped at
 * `src/` would report it as dead.
 */
export function listPackageFiles(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listPackageFiles(full, found);
    else found.push(full);
  }
  return found;
}

/**
 * Every package name this package consumes, and the first place each was seen.
 *
 * @param {string} root repository root
 * @param {string} pkgDir repo-relative package directory
 * @returns {{ consumed: Map<string, { file: string, how: string }>, files: number, stylesheets: number }}
 */
export function consumedNames(root, pkgDir) {
  const consumed = new Map();
  let files = 0;
  let stylesheets = 0;
  const note = (name, file, how) => {
    if (!name || consumed.has(name)) return;
    consumed.set(name, { file: relative(root, file).split('\\').join('/'), how });
  };

  for (const file of listPackageFiles(join(root, pkgDir))) {
    if (SOURCE_FILE.test(file) && !file.endsWith('.d.ts')) {
      files += 1;
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (!/\b(?:import|export|require)\b/.test(text)) continue;
      for (const use of moduleSpecifiers(text, file)) {
        if (isBuiltin(use.specifier)) continue;
        note(packageNameOf(use.specifier), file, use.kind);
      }
    } else if (STYLESHEET_FILE.test(file)) {
      stylesheets += 1;
      let text;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const match of text.matchAll(CSS_AT_RULE)) {
        note(packageNameOf(match[1]), file, 'css at-rule');
      }
    }
  }

  return { consumed, files, stylesheets };
}

/**
 * @typedef {object} Allowance
 * @property {string} reason why this declaration has a consumer the scan cannot see
 * @property {(root: string, pkg: any) => string[]} verify problems re-deriving the reason; empty means it holds
 */

/**
 * Declarations with a consumer this gate structurally cannot see.
 *
 * Every row states its evidence and RE-DERIVES it on each run, and a row that
 * has stopped applying fails the build — see the header. Four rows, two shapes.
 *
 * @type {Record<string, Record<string, Allowance>>}
 */
export const DECLARED_WITHOUT_IMPORT = {
  '@object-ui/cli': {
    '@object-ui/components': generatedSourceAllowance('@object-ui/components'),
    '@object-ui/react': generatedSourceAllowance('@object-ui/react'),
  },
  'object-ui': {
    '@object-ui/core': bundlerInlinedAllowance('@object-ui/core'),
    '@object-ui/types': bundlerInlinedAllowance('@object-ui/types'),
  },
};

/**
 * The CLI shape: the specifier is emitted INTO GENERATED SOURCE, as a string.
 *
 * `objectui init` and `objectui dev` write a project whose files carry
 * `import '@object-ui/components'`, and `objectui dev` runs that generated app
 * out of the CLI's own install when there is no workspace to alias it from. The
 * specifier therefore never appears as an import IN this package — only inside
 * the template strings that produce one — while the CLI's install is what has to
 * satisfy it.
 */
function generatedSourceAllowance(name) {
  const templates = ['src/utils/app-generator.ts', 'src/utils/scaffold-dependencies.ts', 'src/commands/init.ts'];
  return {
    reason:
      `emitted into GENERATED app sources as a string literal (\`${name}\`), never imported by this ` +
      'package; `objectui dev` runs that generated app against the CLI\'s own install when there is no ' +
      'workspace to alias it from',
    verify(root, pkg) {
      const hits = templates.filter((file) => {
        try {
          return readFileSync(join(root, pkg.dir, file), 'utf8').includes(`'${name}'`);
        } catch {
          return false;
        }
      });
      return hits.length > 0
        ? []
        : [
            `no generator under ${pkg.dir} still names '${name}' as a string literal ` +
              `(looked in ${templates.join(', ')}), so the allowance has no evidence left`,
          ];
    },
  };
}

/**
 * The extension shape: the bundler INLINES the package by name from its config.
 *
 * `packages/vscode-extension/tsup.config.ts` lists both names in `noExternal`,
 * so their code is compiled into the extension's `dist` even though no file in
 * the extension imports the bare specifier.
 */
function bundlerInlinedAllowance(name) {
  const config = 'tsup.config.ts';
  return {
    reason:
      `bundled into this package's \`dist\` by \`noExternal\` in ${config}, which names it as a string ` +
      'rather than importing it',
    verify(root, pkg) {
      const path = join(root, pkg.dir, config);
      let text;
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        return [`${pkg.dir}/${config} cannot be read, so the allowance cannot be verified`];
      }
      const noExternal = /noExternal\s*:\s*\[([^\]]*)\]/s.exec(text);
      if (!noExternal) return [`${pkg.dir}/${config} no longer declares \`noExternal\``];
      if (!noExternal[1].includes(`'${name}'`) && !noExternal[1].includes(`"${name}"`)) {
        return [`${pkg.dir}/${config}'s \`noExternal\` no longer names '${name}'`];
      }
      return [];
    },
  };
}

/**
 * One package's findings.
 *
 * @param {{ name: string, dir: string, manifest: any }} pkg
 * @param {{ root: string, allowances?: Record<string, Record<string, Allowance>> }} options
 */
export function auditPackage(pkg, { root, allowances = DECLARED_WITHOUT_IMPORT } = {}) {
  const findings = [];
  const counters = { files: 0, stylesheets: 0, gatedDeclared: 0, allowed: 0, viaCss: 0, viaTypes: 0, viaGlobalTypes: 0 };
  const allowed = allowances[pkg.name] ?? {};

  const { consumed, files, stylesheets } = consumedNames(root, pkg.dir);
  counters.files = files;
  counters.stylesheets = stylesheets;

  const measured = {};
  for (const field of MEASURED_FIELDS) {
    measured[field] = Object.keys(pkg.manifest[field] ?? {}).filter((key) => !isConsumed(key, consumed)).length;
  }

  for (const field of GATED_FIELDS) {
    for (const key of Object.keys(pkg.manifest[field] ?? {})) {
      counters.gatedDeclared += 1;
      const hit = consumed.get(key);
      if (hit) {
        if (hit.how === 'css at-rule') counters.viaCss += 1;
        continue;
      }
      if (GLOBAL_TYPES_PACKAGES.has(key)) {
        counters.viaGlobalTypes += 1;
        continue;
      }
      const typed = typedPackageOf(key);
      if (typed !== null && consumed.has(typed)) {
        counters.viaTypes += 1;
        continue;
      }
      if (Object.hasOwn(allowed, key)) {
        counters.allowed += 1;
        continue;
      }
      findings.push({ reason: 'declared-without-consumer', pkg: pkg.name, dir: pkg.dir, field, key });
    }
  }

  return { findings, counters, measured, consumed };
}

/** Whether a name has any consumer, applying the `@types/X` follows X rule. */
function isConsumed(key, consumed) {
  if (consumed.has(key)) return true;
  if (GLOBAL_TYPES_PACKAGES.has(key)) return true;
  const typed = typedPackageOf(key);
  return typed !== null && consumed.has(typed);
}

/**
 * Every allowance row re-derived against the repository.
 *
 * A row that no longer applies is a finding: see rule 3 in the header — an
 * allowance that has quietly stopped applying is how a baseline becomes a
 * permanent allowlist.
 */
export function auditAllowances(root, packages, consumedByPackage, allowances = DECLARED_WITHOUT_IMPORT) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const findings = [];
  for (const [name, rows] of Object.entries(allowances)) {
    const pkg = byName.get(name);
    if (!pkg) {
      for (const key of Object.keys(rows)) {
        findings.push({
          reason: 'stale-allowance',
          pkg: name,
          key,
          detail: 'is allowed here but is not a released workspace package with a src/ directory any more',
        });
      }
      continue;
    }
    const declared = new Set(GATED_FIELDS.flatMap((field) => Object.keys(pkg.manifest[field] ?? {})));
    const consumed = consumedByPackage.get(name) ?? new Map();
    for (const [key, allowance] of Object.entries(rows)) {
      if (!declared.has(key)) {
        findings.push({
          reason: 'stale-allowance',
          pkg: name,
          key,
          detail: `is no longer declared in ${GATED_FIELDS.join(' or ')}, so the allowance outlived the declaration it excused`,
        });
        continue;
      }
      if (isConsumed(key, consumed)) {
        const hit = consumed.get(key);
        findings.push({
          reason: 'stale-allowance',
          pkg: name,
          key,
          detail:
            'now HAS a consumer the scan can see' +
            (hit ? ` (${hit.file}, ${hit.how})` : '') +
            ', so the allowance is doing nothing and should be deleted',
        });
        continue;
      }
      for (const problem of allowance.verify(root, pkg)) {
        findings.push({ reason: 'stale-allowance', pkg: name, key, detail: problem });
      }
    }
  }
  return findings;
}

/**
 * The whole judgement for one repository root.
 *
 * `allowances` is injectable for the same reason phantom-deps makes its
 * exemption table injectable: the default table describes THIS repository, and
 * against a throwaway tree every row would report itself stale — correct there,
 * noise everywhere else. A test that is not about the allowances passes `{}`.
 */
export function analyze(root, { allowances = DECLARED_WITHOUT_IMPORT } = {}) {
  const packages = discoverPackages(root);
  const findings = [];
  const counters = {
    packages: packages.length,
    files: 0,
    stylesheets: 0,
    gatedDeclared: 0,
    allowed: 0,
    viaCss: 0,
    viaTypes: 0,
    viaGlobalTypes: 0,
  };
  const measured = Object.fromEntries(MEASURED_FIELDS.map((field) => [field, 0]));
  const consumedByPackage = new Map();

  for (const pkg of packages) {
    const result = auditPackage(pkg, { root, allowances });
    consumedByPackage.set(pkg.name, result.consumed);
    findings.push(...result.findings);
    for (const key of Object.keys(result.counters)) counters[key] += result.counters[key];
    for (const field of MEASURED_FIELDS) measured[field] += result.measured[field];
  }

  findings.push(...auditAllowances(root, packages, consumedByPackage, allowances));
  return { findings, counters, measured, packages };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HINTS = {
  'declared-without-consumer':
    'A dependency this package DECLARES and nothing in it consumes — not by an import anywhere in the ' +
    'package directory (not just `src/`), not by a stylesheet at-rule, and not as the `@types/…` of ' +
    'something it does consume. Every consumer of this package downloads it on this declaration alone. ' +
    'Delete the entry; if it really does have a consumer this scan cannot see, add a row to ' +
    'DECLARED_WITHOUT_IMPORT in scripts/check-unused-dependencies.mjs with the evidence and a `verify` ' +
    'that re-derives it.',
  'stale-allowance':
    'A row in DECLARED_WITHOUT_IMPORT no longer matches the repository — the package is gone, the ' +
    'declaration is gone, the dependency now has a visible consumer, or the evidence has moved. Delete ' +
    'the row (or update it): an allowance nobody needs is how a baseline becomes a permanent allowlist.',
};

if (isEntrypoint(import.meta.url)) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));

  let result;
  try {
    result = analyze(root);
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: this gate decides whether a declaration has a ' +
        'consumer,\n    so losing an input means it cannot decide, and a green verdict would have ' +
        'looked at nothing.',
    );
    process.exit(1);
  }

  const { findings, counters, measured } = result;

  // A refactor that quietly empties the scan would satisfy every assertion in
  // the pin test while checking nothing — the same reason phantom-deps opens
  // with a size assertion.
  if (counters.packages < 30 || counters.gatedDeclared < 200 || counters.files < 1000) {
    console.error(
      `The scan collapsed: ${counters.packages} released package(s), ${counters.gatedDeclared} gated ` +
        `declaration(s) over ${counters.files} source file(s). Expected dozens of packages, hundreds of ` +
        'declarations and thousands of files — the release group, the package walk or the parser is ' +
        'broken, and an empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  console.log(
    `Scanned ${counters.packages} released package(s): ${counters.gatedDeclared} declaration(s) in ` +
      `${GATED_FIELDS.join(' / ')} judged against ${counters.files} source file(s) and ` +
      `${counters.stylesheets} stylesheet(s). ${counters.viaCss} consumed only by a stylesheet at-rule, ` +
      `${counters.viaTypes} are the \`@types/…\` of something consumed, ${counters.viaGlobalTypes} are a ` +
      `global-scope types package this gate cannot judge (GLOBAL_TYPES_PACKAGES), ${counters.allowed} allowed ` +
      'by DECLARED_WITHOUT_IMPORT. ' +
      `Measured but NOT gated (see the header): ${measured.peerDependencies} peer and ` +
      `${measured.devDependencies} dev declaration(s) have no consumer in their own package.`,
  );

  if (findings.length === 0) {
    console.log('✅  Every gated declaration has a consumer in the package that declares it.');
    process.exit(0);
  }

  console.error(`\n❌  ${findings.length} declaration(s) have no consumer where this gate can see one:\n`);
  for (const finding of findings) {
    if (finding.reason === 'stale-allowance') {
      console.error(`      ${finding.pkg}  ${finding.key}  [stale-allowance]  ${finding.detail}`);
      continue;
    }
    console.error(
      `      ${finding.dir}/package.json  [${finding.reason}]  ` +
        `${finding.pkg} declares '${finding.key}' in \`${finding.field}\`, and no import anywhere under ` +
        `${finding.dir}/, no stylesheet at-rule and no \`@types/…\` pairing consumes it`,
    );
  }
  for (const reason of Object.keys(HINTS)) {
    if (findings.some((finding) => finding.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }
  console.error(
    '\nThe opposite direction — an import nothing declares — is scripts/check-phantom-dependencies.mjs ' +
      '(objectui#4394).\nThis gate is objectui#8198; see its header for what is gated, what is only ' +
      'measured, and why.',
  );
  process.exit(1);
}
