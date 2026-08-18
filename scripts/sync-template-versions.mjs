// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Re-sync every bundled create-objectstack template's declared version surfaces
// with the scaffolder's own package version. Runs as part of the root `version`
// script (changesets/action calls `pnpm run version` when preparing the release
// PR), so a version bump can never ship with a template pinning a stale range —
// the drift class behind #2907: the template froze at ^6.0.0 while the registry
// published 14.x, and every fresh `npm create objectstack` project landed eight
// majors behind the docs. The scaffold-time dep rewrite (pkg-utils.ts) and the
// ratchet tests (template-consistency.test.ts) both guard this too, but release
// PRs opened by changesets/action with the default GITHUB_TOKEN do not trigger
// CI, so fixing the files at version time is the only spot that cannot be
// skipped.
//
//   node scripts/sync-template-versions.mjs
//
// THREE SURFACES, NOT ONE, AND THE MISSING ONE IS WHY (#9264). This script used
// to stamp two keys in two hard-coded `blank/` paths and never opened
// `objectstack.manifest.json` at all. So `specVersion` — a REQUIRED field of
// TemplateManifestSchema, copied verbatim into every scaffolded project by
// `create-objectstack` — sat at `^6.0.0` while the config's `engines.protocol`
// tracked every major up to ^17. Eleven majors of drift, and a green
// `sync-template-versions` run was never evidence about it: the script's failure
// mode was loud for the keys it covered and MUTE for the key it did not.
//
// Two structural consequences, both deliberate:
//
//   * the file list is DISCOVERED, never hard-coded. Templates are found by
//     walking `src/templates/`, the same way `check-template-manifests.ts`
//     finds the manifests it parses, and for the same stated reason: a template
//     added tomorrow is covered on the day it lands, without anyone remembering
//     this script exists. One-key-one-file coverage is what let #9264 sit.
//   * every stamp is REQUIRED. A template whose file is missing, or whose file
//     carries no stamp to sync, is a hard failure naming the path — never a
//     skip. A silent skip is indistinguishable from a green run, which is
//     precisely the invisibility this card was filed about.
//
// TWO VALUES, TWO MEANINGS — do not collapse them. `engines.protocol` is the
// ADR-0087 D1 runtime handshake range and carries the PROTOCOL major (`^17`).
// `specVersion` is documented by TemplateManifestSchema as the "Compatible
// @objectstack/spec semver range" and carries the PACKAGE range (`^17.0.0`) —
// the same value this script writes into the template's own
// `@objectstack/spec` dependency, so the manifest and the package.json state
// one fact once. They agree on the major today only because the spec package's
// major and the protocol major are kept in lockstep; they are still two
// different declarations and are stamped from two different values.
//
// ## THE DECLARATIONS ARE EXPORTED, AND NOTHING RUNS ON IMPORT (#9554)
//
// Everything above says the target set is DECLARED rather than restated — and
// for one release it was declared in a place no one could read. `TEXT_STAMPS`,
// `TEMPLATE_ROOT` and `findTemplateDirs()` were all module-private, and the
// sync executed at module scope, so a consumer that imported this file to ask
// "which files does the version pass stamp?" would have rewritten the templates
// instead of getting an answer. The only available option was to restate the
// paths, and `cut-rc.yml`'s release-file allowlist did exactly that: two
// literals, both hard-coding the template name `blank`, in a workflow whose own
// comment recorded that it would rather read this list.
//
// That restatement is the #9264 failure one layer up. `findTemplateDirs()`
// exists BECAUSE the template set is not curated, so the day a second template
// ships the walk picks it up, this script stamps it, and a literal `blank` pair
// does not cover it — the allowlist assertion trips and the cut refuses to
// push, with nothing red until someone attempts a release.
//
// So the surface is import-safe, mirroring `check-docs-image-tag.mjs` (#9064)
// and read by `sync-docs-image-tags.mjs` the same way:
//
//   * `stampedPaths()` — the derived answer, repo-relative POSIX paths across
//     ALL template dirs. This is what a consumer wants; deriving it here is
//     what keeps consumers from re-implementing the walk and the join.
//   * `TEXT_STAMPS`, `TEMPLATE_DIR`, `TEMPLATE_ROOT`, `findTemplateDirs()`,
//     `VERSION_SOURCE`, `loadScaffolderVersion()` — the raw declarations, for
//     a consumer that needs the keys and patterns rather than the paths.
//   * nothing executes, reads a file, or exits the process at import. The
//     version read used to sit at module scope and `process.exit(1)` on an
//     unparseable version — an import that can kill its host process is a
//     worse import hazard than the sync, not a smaller one, so it moved into
//     `loadScaffolderVersion()`, which THROWS. Only `main()` exits.
//
// `stampedPaths()` reports all THREE per-template surfaces, not just the two
// text stamps. A consumer asking which files the version pass writes is asking
// about `package.json` too — it carries the `@objectstack/*` ranges this script
// rewrites — and an export that answered the narrower question while being
// named for the wider one would seed the next restatement.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** The repo this script lives in — resolved from the script, so cwd cannot lie. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where the scaffolder's own version is read from. Repo-relative. */
export const VERSION_SOURCE = 'packages/create-objectstack/package.json';

/**
 * Where the bundled templates live, repo-relative. A DIRECTORY, walked, never a
 * hand-kept list — see the header. Mirrors `check-template-manifests.ts`.
 */
export const TEMPLATE_DIR = 'packages/create-objectstack/src/templates';

/** Absolute counterpart of `TEMPLATE_DIR` for the checkout this script lives in. */
export const TEMPLATE_ROOT = join(root, TEMPLATE_DIR);

/** Repo-relative, always POSIX-separated: these paths are git pathspecs downstream. */
const rel = (p) => relative(root, p).split(sep).join('/');

/**
 * The text stamps, as a table over (file, key, pattern, value, replacement).
 *
 * Table-driven rather than one block per key so that adding a fourth declared
 * version surface is a row, and so that all of them share ONE failure contract
 * — the shape whose absence let `specVersion` drift unnoticed (#9264).
 *
 * `value` and `replacement` are FUNCTIONS of the version being stamped, not
 * strings baked in at module load. That is what lets this table be a static
 * declaration an importer can read without the module first going and reading
 * `create-objectstack/package.json` (#9554) — and it is the same split
 * `check-docs-image-tag.mjs` makes between its static `PATTERNS` and the
 * `expected` version threaded through as a parameter.
 *
 * Rewritten as TEXT, not parse/re-serialize, and that matters for the manifest:
 * `objectstack.manifest.json` keeps `scaffold.variables` compact on one line, so
 * `JSON.stringify(…, null, 2)` would reformat 42 bytes of unrelated structure
 * on every release. A targeted replace touches the value and nothing else.
 */
export const TEXT_STAMPS = [
  {
    file: 'objectstack.config.ts',
    key: 'engines.protocol',
    // ADR-0087 D1 — the runtime refuses an incompatible package at the boundary
    // with the exact migration command. Scaffolds populate it by default; this
    // is the ratchet that closes grandfathering. Carries the PROTOCOL major.
    pattern: /engines:\s*\{\s*protocol:\s*'[^']*'\s*\}/,
    value: ({ major }) => `^${major}`,
    replacement: ({ major }) => `engines: { protocol: '^${major}' }`,
  },
  {
    file: 'objectstack.manifest.json',
    key: 'specVersion',
    // Required by TemplateManifestSchema and read by the template registry;
    // `create-objectstack` copies it verbatim into every scaffolded project
    // (it rewrites name/displayName/namespace and drops description, and has
    // never touched this key), so a stale value ships to real users. Carries
    // the PACKAGE range.
    pattern: /("specVersion"\s*:\s*)"[^"]*"/,
    value: ({ range }) => range,
    replacement: ({ range }) => `$1"${range}"`,
  },
];

/**
 * The per-template file that is stamped by DEPENDENCY REWRITE rather than by a
 * text stamp: every `@objectstack/*` range in it moves to the package range.
 * Named here rather than inline so `stampedPaths()` and `main()` cannot drift.
 */
export const TEMPLATE_PKG_FILE = 'package.json';

/** Every bundled template directory, sorted. Deliberately not a curated list. */
export function findTemplateDirs(templateRoot = TEMPLATE_ROOT) {
  return readdirSync(templateRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist')
    .map((e) => e.name)
    .sort();
}

/**
 * Every repo-relative path this script may write, across ALL template dirs.
 *
 * This is the export `cut-rc.yml`'s release-file allowlist is for: the paths a
 * version pass may touch under `src/templates/`, derived from the same walk and
 * the same table the sync itself uses, so the workflow cannot describe a
 * different set than the one that gets written. `sync-docs-image-tags.mjs` and
 * that allowlist already read the doc half from `check-docs-image-tag.mjs`'s
 * `SURFACES`; this is the template half on the same terms.
 *
 * Zero templates THROWS rather than returning `[]`, for the same reason the run
 * itself refuses a vacuous green: an empty allowlist reads exactly like "no
 * template paths need staging" and means "the directory moved". A consumer
 * building a pathspec out of nothing would stage nothing and then blame the
 * unstaged files it caused.
 *
 * @param {{ root?: string }} [options] checkout to walk; defaults to this one
 * @returns {string[]} sorted, POSIX-separated, repo-relative paths
 */
export function stampedPaths({ root: base = root } = {}) {
  const templateRoot = join(base, TEMPLATE_DIR);
  const templates = findTemplateDirs(templateRoot);
  if (templates.length === 0) {
    throw new Error(
      `sync-template-versions: no template directories under ${TEMPLATE_DIR}. Every release ` +
        'stamps at least one bundled template, so this is almost certainly a moved directory ' +
        'rather than an empty one — refusing to report an empty stamped-path set.',
    );
  }
  const files = [TEMPLATE_PKG_FILE, ...TEXT_STAMPS.map((stamp) => stamp.file)];
  return templates
    .flatMap((template) => files.map((file) => `${TEMPLATE_DIR}/${template}/${file}`))
    .sort();
}

/**
 * The scaffolder's version, and the two values stamped from it.
 *
 * THROWS on an unparseable version rather than exiting: this module is
 * importable (#9554), and a library call that kills the host process is not a
 * usable declaration surface. `main()` turns the throw into the exit.
 *
 * @param {string} [file] absolute path to create-objectstack's package.json
 */
export function loadScaffolderVersion(file = join(root, VERSION_SOURCE)) {
  const version = JSON.parse(readFileSync(file, 'utf8')).version;
  if (!/^\d+\.\d+\.\d+/.test(String(version))) {
    throw new Error(`cannot parse create-objectstack version '${version}'`);
  }
  const major = String(version).split('.')[0];
  return {
    version: String(version),
    major,
    /** The `@objectstack/*` package range: dependencies AND the manifest's `specVersion`. */
    range: `^${major}.0.0`,
  };
}

// ---------------------------------------------------------------------------

function main() {
  let scaffolder;
  try {
    scaffolder = loadScaffolderVersion();
  } catch (err) {
    console.error(`✗ sync-template-versions: ${err.message}`);
    process.exit(1);
  }
  const { version, major, range } = scaffolder;

  const templates = findTemplateDirs();

  // Vacuous-green guard, same rationale as check-template-manifests.ts: zero
  // templates is far more likely to mean "the directory moved" than "we ship no
  // templates", and a run that stamped nothing must not report success.
  if (templates.length === 0) {
    console.error(
      `✗ sync-template-versions: no template directories under ${rel(TEMPLATE_ROOT)}.\n` +
        '  Every release stamps at least one bundled template, so this is almost certainly a\n' +
        '  moved directory rather than an empty one. A sync that rewrote nothing must not pass.',
    );
    process.exit(1);
  }

  /** Problems are collected so one run names every unstamped file, not just the first. */
  const problems = [];

  for (const template of templates) {
    // ── package.json: every @objectstack/* range → the package range ────────
    const templatePkgPath = join(TEMPLATE_ROOT, template, TEMPLATE_PKG_FILE);
    let templatePkg;
    try {
      templatePkg = JSON.parse(readFileSync(templatePkgPath, 'utf8'));
    } catch (err) {
      problems.push(
        `${rel(templatePkgPath)} could not be read as JSON (${err.message}). Every bundled ` +
          'template ships a package.json pinning the @objectstack/* ranges a scaffolded project installs.',
      );
      templatePkg = null;
    }

    if (templatePkg) {
      let stackDeps = 0;
      let changed = 0;
      for (const deps of [templatePkg.dependencies, templatePkg.devDependencies]) {
        if (!deps) continue;
        for (const dep of Object.keys(deps)) {
          if (!dep.startsWith('@objectstack/')) continue;
          stackDeps++;
          if (deps[dep] !== range) {
            console.log(`  ${template}/package.json ${dep}: ${deps[dep]} → ${range}`);
            deps[dep] = range;
            changed++;
          }
        }
      }

      if (stackDeps === 0) {
        // Zero matches is the silent-skip shape this script exists to refuse: it
        // reads exactly like "already in lockstep" and means the opposite.
        problems.push(
          `${rel(templatePkgPath)} declares no @objectstack/* dependency, so nothing was synced. ` +
            'A bundled template installs the platform it scaffolds against — add the deps, or drop ' +
            'the template directory.',
        );
      } else if (changed === 0) {
        console.log(
          `✓ ${template}/package.json already pins ${range} across ${stackDeps} @objectstack/* dep(s)` +
            ` — in lockstep with create-objectstack@${version}`,
        );
      } else {
        writeFileSync(templatePkgPath, JSON.stringify(templatePkg, null, 2) + '\n');
        console.log(
          `✓ ${template}/package.json: ${changed} of ${stackDeps} @objectstack/* range(s) → ${range}` +
            ` (lockstep with create-objectstack@${version})`,
        );
      }
    }

    // ── the text stamps ─────────────────────────────────────────────────────
    for (const stamp of TEXT_STAMPS) {
      const path = join(TEMPLATE_ROOT, template, stamp.file);
      const value = stamp.value({ version, major, range });
      let src;
      try {
        src = readFileSync(path, 'utf8');
      } catch (err) {
        problems.push(
          `${rel(path)} could not be read (${err.message}), so ${stamp.key} was not synced. ` +
            'Every bundled template declares it; a template that genuinely should not be stamped ' +
            'is a decision to record in TEXT_STAMPS, not a file to skip.',
        );
        continue;
      }

      // Absence is a hard failure, never a skip — the #9264 lesson. Tested before
      // the replace so "key missing" and "value already correct" stay distinct:
      // both produce an unchanged string, and only one of them is fine.
      if (!stamp.pattern.test(src)) {
        problems.push(
          `${rel(path)} has no ${stamp.key} stamp to sync (expected to match ${stamp.pattern}). ` +
            `It should declare ${stamp.key} = ${value}.`,
        );
        continue;
      }

      const stamped = src.replace(stamp.pattern, stamp.replacement({ version, major, range }));
      if (stamped === src) {
        console.log(`✓ ${template}/${stamp.file} already stamps ${stamp.key} '${value}'`);
      } else {
        writeFileSync(path, stamped);
        console.log(`✓ ${template}/${stamp.file}: ${stamp.key} → '${value}'`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`\n✗ sync-template-versions: ${problems.length} unstamped surface(s).\n`);
    for (const p of problems) console.error(`  • ${p}`);
    console.error(
      '\n  Each of these is a declared version surface that would have shipped stale. The script\n' +
        '  fails rather than skipping, because a skipped stamp is indistinguishable from a synced\n' +
        '  one in the log — which is how specVersion drifted eleven majors (#9264).\n',
    );
    process.exit(1);
  }

  console.log(
    `\n✓ sync-template-versions: ${templates.length} template(s) in lockstep with ` +
      `create-objectstack@${version} — deps and specVersion at ${range}, engines.protocol at '^${major}'.`,
  );
}

// ---------------------------------------------------------------------------

// Entry-point guard (#9554), the same one #9064 added to check-docs-image-tag.mjs
// and for the same reason: this file is importable, and an import that rewrote
// every bundled template as a side effect is strictly worse than the missing
// export it was working around.
if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  main();
}
