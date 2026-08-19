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

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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

// ---------------------------------------------------------------------------
// ## `--self-test` (#9348) — THE RED PATHS, WHICH NOTHING ELSE EXECUTES
//
// The card behind this flag argued that the rewriter's LOGIC is executed by no
// gate, ever: the ratchets in `template-consistency.test.ts` judge the committed
// OUTPUT, and on a green corpus a working rewriter and a broken one produce
// identical (empty) results. #9648 answered half of that by adding
// `packages/create-objectstack/src/template-version-stamps.test.ts`, which runs
// this CLI over a STALE two-template fixture and asserts the rewrites. Two
// measured gaps survive it, and this flag is scoped to exactly those two —
// re-asserting what that vitest file already owns would be worse than one
// harness, not better.
//
// GAP 1 — SCHEDULING. `create-objectstack#test` is reached only from ci.yml's
// `test` job, and that job is `if: ... needs.filter.outputs.core != 'false'`.
// The `core` paths-filter is `packages/**`, `examples/**`, `apps/!(docs)/**`,
// `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `.github/workflows/ci.yml`
// — `scripts/**` matches NONE of them. Measured on this tree (picomatch 4.0.5,
// the matcher dorny/paths-filter uses): a diff confined to this file yields
// `core=false`, so Test Core is skipped in full and the vitest never runs, on
// precisely the PR that changes the rewriter. Two further layers were measured
// and neither rescues it: `turbo ls --affected` returns ZERO packages for that
// diff (a package-local edit returns 1, so the probe is live) — the
// `$TURBO_ROOT$` entry in `turbo.json` moves the task HASH, which is a
// different thing — and the `--union-into` step that does pull
// `create-objectstack` back in lives INSIDE the skipped job. lint.yml carries
// no paths filter and no filter job, so a step there runs on every pull
// request, push and merge-queue build. That is the whole of this flag's job.
//
// GAP 2 — THE RED PATHS. Every failure contract this script's header argues for
// is unexecuted. The vitest fixture is deliberately STALE and asserts the
// rewrite; nothing anywhere observes a CLEAN corpus left byte-identical and
// UNWRITTEN (#9064's lint.yml comment calls that "the control that matters just
// as much", because an over-eager rewriter corrupts silently), and nothing
// reaches the `problems` collection at all — the missing stamp, the missing
// file, the unparseable package.json, the zero-@objectstack/* template, or
// `main()`'s own vacuous-green guard. `stampedPaths()`'s empty-set THROW is
// covered by #9648; `main()`'s guard is a separate code path and was not.
//
// ⛔ Deliberately NOT re-asserted here, because #9648 owns them: the STALE ->
// rewritten direction, the two-template discovery walk, `stampedPaths()` being
// derived rather than restated, the entry-point guard, and
// `loadScaffolderVersion()` throwing instead of exiting.
//
// The cases run the REAL CLI in a child process, because every one of them is
// an EXIT-CODE case and `main()` exits. The fixture is a copy of this file two
// levels above a template tree: `root` is resolved from the script's own
// location, deliberately, so cwd cannot redirect it and a copy is the only way
// to point it at a fixture.

/** The scaffolder version every fixture declares — never a live one, so a stamp that ran is unmistakable. */
const SELF_TEST_VERSION = '42.0.0';

/**
 * Fixture file bodies, keyed by `TEXT_STAMPS[].key` rather than by file name.
 *
 * Keyed that way so the coverage assertion below can be exhaustive: a fourth
 * stamp row added to `TEXT_STAMPS` with no body here fails the self-test
 * loudly, instead of silently sitting outside every fixture — which is the
 * one-key-one-file blind spot (#9264) reappearing in the test harness.
 */
const SELF_TEST_BODIES = {
  'engines.protocol': (major) =>
    `export default defineStack({ manifest: { engines: { protocol: '^${major}' } } });\n`,
  specVersion: (major) => `{\n  "specVersion": "^${major}.0.0",\n  "scaffold": { "variables": [] }\n}\n`,
};

function writeFixtureFile(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

/**
 * A throwaway checkout shaped like this repo, IN LOCKSTEP unless `major` says
 * otherwise. Returns the path of the copied script to run.
 */
function buildFixture(dir, { templates = ['blank', 'second'], major = '42' } = {}) {
  const script = join(dir, 'scripts', 'sync-template-versions.mjs');
  writeFixtureFile(script, readFileSync(fileURLToPath(import.meta.url), 'utf8'));
  writeFixtureFile(
    join(dir, VERSION_SOURCE),
    JSON.stringify({ name: 'create-objectstack', version: SELF_TEST_VERSION }, null, 2) + '\n',
  );
  // Created even when `templates` is empty: the vacuous-green guard is about an
  // EMPTY templates directory, not a missing one.
  mkdirSync(join(dir, TEMPLATE_DIR), { recursive: true });
  for (const template of templates) {
    const templateDir = join(dir, TEMPLATE_DIR, template);
    writeFixtureFile(
      join(templateDir, TEMPLATE_PKG_FILE),
      JSON.stringify(
        {
          name: `template-${template}`,
          dependencies: { '@objectstack/spec': `^${major}.0.0`, chalk: '^6.0.0' },
          devDependencies: { '@objectstack/cli': `^${major}.0.0` },
        },
        null,
        2,
      ) + '\n',
    );
    for (const stamp of TEXT_STAMPS) {
      writeFixtureFile(join(templateDir, stamp.file), SELF_TEST_BODIES[stamp.key](major));
    }
  }
  return script;
}

/** Every surface of a fixture, absolute. */
function fixtureSurfaces(dir, templates = ['blank', 'second']) {
  return templates.flatMap((template) =>
    [TEMPLATE_PKG_FILE, ...TEXT_STAMPS.map((s) => s.file)].map((file) =>
      join(dir, TEMPLATE_DIR, template, file),
    ),
  );
}

function runFixture(script) {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (condition, message) => {
    checked++;
    if (!condition) failures.push(message);
  };
  const reportFailures = () => {
    if (failures.length === 0) return;
    console.error(`\n✗ sync-template-versions --self-test — ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  };

  // ── Control G: the fixture table covers every declared stamp ──────────────
  //
  // Checked before any fixture exists, and FATAL on its own, because
  // `buildFixture` indexes `SELF_TEST_BODIES` by key: an uncovered row makes it
  // throw a bare `TypeError: SELF_TEST_BODIES[stamp.key] is not a function`
  // out of Control A, which kills the process before the failure list is ever
  // printed. Measured by adding a fourth TEXT_STAMPS row with no body: the run
  // still exits 1, so the gate itself holds — but the one message written for
  // this exact case was dead output in the exact case it was written for, and
  // the next author reads a harness crash instead of "you declared a stamp and
  // owe it a fixture body". Ordering is the whole fix; the case is unchanged.
  assert(
    TEXT_STAMPS.length > 0 && TEXT_STAMPS.every((stamp) => typeof SELF_TEST_BODIES[stamp.key] === 'function'),
    'every TEXT_STAMPS row has a fixture body, so a newly declared stamp cannot sit outside every case here — ' +
      `missing: ${JSON.stringify(TEXT_STAMPS.filter((s) => !SELF_TEST_BODIES[s.key]).map((s) => s.key))}`,
  );
  reportFailures();

  const scratch = mkdtempSync(join(tmpdir(), 'sync-template-versions-selftest-'));
  const fixtureDir = (name) => {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  try {
    // ── Control A: a CLEAN corpus is REACHED, and left byte-identical and UNWRITTEN ──
    //
    // The over-eagerness control, and the one direction a live run can never
    // demonstrate. Byte-identity alone would be satisfied by a script that
    // never opened the files, so the log is asserted too: an in-lockstep run
    // must REPORT every surface it judged. mtimes are backdated first, because
    // rewriting a file with identical bytes is still a write — and a version
    // pass that rewrites clean files churns the release diff.
    {
      const dir = fixtureDir('clean');
      const script = buildFixture(dir);

      assert(
        readFileSync(script, 'utf8') === readFileSync(fileURLToPath(import.meta.url), 'utf8'),
        'the fixture runs a byte-identical copy of THIS file, not a truncated one',
      );

      const surfaces = fixtureSurfaces(dir);
      const backdated = new Date(Date.now() - 60_000);
      for (const file of surfaces) utimesSync(file, backdated, backdated);
      const before = surfaces.map((file) => ({
        file,
        text: readFileSync(file, 'utf8'),
        mtimeMs: statSync(file).mtimeMs,
      }));

      const { status, output } = runFixture(script);
      assert(status === 0, `an in-lockstep corpus exits 0 — got ${status}\n${output}`);

      for (const template of ['blank', 'second']) {
        assert(
          output.includes(`${template}/${TEMPLATE_PKG_FILE} already pins`),
          `the run REACHED ${template}/${TEMPLATE_PKG_FILE} and judged it already in lockstep`,
        );
        for (const stamp of TEXT_STAMPS) {
          assert(
            output.includes(`${template}/${stamp.file} already stamps ${stamp.key}`),
            `the run REACHED ${template}/${stamp.file} and judged ${stamp.key} already correct`,
          );
        }
      }

      for (const snapshot of before) {
        const rel = relative(dir, snapshot.file);
        assert(
          readFileSync(snapshot.file, 'utf8') === snapshot.text,
          `${rel} is byte-identical after a clean run`,
        );
        assert(
          statSync(snapshot.file).mtimeMs === snapshot.mtimeMs,
          `${rel} was not WRITTEN at all on a clean run (an over-eager rewriter churns every release diff)`,
        );
      }
    }

    // ── Control B: a MISSING stamp is a hard failure naming the path ────────
    //
    // The #9264 contract, executed. `pattern.test()` runs BEFORE the replace so
    // that "key absent" and "value already correct" stay distinct — both leave
    // the string unchanged and only one of them is fine. This is the assertion
    // that tells a rewriter which has STOPPED REWRITING from one with nothing
    // to do, which is the observation the card was filed about.
    {
      const dir = fixtureDir('missing-stamp');
      const script = buildFixture(dir);
      const stamp = TEXT_STAMPS.find((s) => s.key === 'specVersion');
      writeFixtureFile(
        join(dir, TEMPLATE_DIR, 'second', stamp.file),
        '{\n  "scaffold": { "variables": [] }\n}\n',
      );

      const { status, output } = runFixture(script);
      assert(status === 1, `a template with no ${stamp.key} stamp exits 1 — got ${status}\n${output}`);
      assert(
        output.includes(`${TEMPLATE_DIR}/second/${stamp.file}`),
        `the failure names the offending path\n${output}`,
      );
      assert(output.includes(stamp.key), `the failure names the missing key\n${output}`);
      assert(
        output.includes(`blank/${stamp.file} already stamps`),
        `one bad template does not abort the walk — blank is still judged\n${output}`,
      );
    }

    // ── Control C: ONE run names EVERY unstamped surface ────────────────────
    //
    // Problems are COLLECTED, not thrown at the first hit. A run that named
    // only the first would send a release engineer round the loop once per
    // broken surface, and this is the only place that contract is observed.
    {
      const dir = fixtureDir('all-problems');
      const script = buildFixture(dir);
      const broken = [];
      for (const template of ['blank', 'second']) {
        for (const stamp of TEXT_STAMPS) {
          writeFixtureFile(join(dir, TEMPLATE_DIR, template, stamp.file), 'nothing to stamp here\n');
          broken.push(`${TEMPLATE_DIR}/${template}/${stamp.file}`);
        }
      }

      const { status, output } = runFixture(script);
      assert(status === 1, `four unstamped surfaces exit 1 — got ${status}\n${output}`);
      assert(
        output.includes(`${broken.length} unstamped surface(s)`),
        `the run counts all ${broken.length} problems in one pass\n${output}`,
      );
      for (const path of broken) {
        assert(output.includes(path), `the failure names ${path}\n${output}`);
      }
    }

    // ── Control D: a template with no @objectstack/* dependency exits 1 ─────
    //
    // Zero matches is the silent-skip shape: it reads exactly like "already in
    // lockstep" and means the opposite.
    {
      const dir = fixtureDir('no-stack-deps');
      const script = buildFixture(dir);
      writeFixtureFile(
        join(dir, TEMPLATE_DIR, 'blank', TEMPLATE_PKG_FILE),
        JSON.stringify({ name: 'template-blank', dependencies: { chalk: '^6.0.0' } }, null, 2) + '\n',
      );

      const { status, output } = runFixture(script);
      assert(status === 1, `a template declaring no @objectstack/* dependency exits 1 — got ${status}\n${output}`);
      assert(
        output.includes(`${TEMPLATE_DIR}/blank/${TEMPLATE_PKG_FILE}`) &&
          output.includes('declares no @objectstack/* dependency'),
        `the failure names the path and the reason\n${output}`,
      );
    }

    // ── Control E: a stamp FILE that does not exist exits 1 naming it ───────
    {
      const dir = fixtureDir('missing-file');
      const script = buildFixture(dir);
      const stamp = TEXT_STAMPS.find((s) => s.key === 'engines.protocol');
      rmSync(join(dir, TEMPLATE_DIR, 'second', stamp.file));

      const { status, output } = runFixture(script);
      assert(status === 1, `a missing ${stamp.file} exits 1 — got ${status}\n${output}`);
      assert(
        output.includes(`${TEMPLATE_DIR}/second/${stamp.file}`) && output.includes(stamp.key),
        `the failure names the unreadable file and the key it carries\n${output}`,
      );
    }

    // ── Control F: an unparseable template package.json exits 1 naming it ───
    {
      const dir = fixtureDir('bad-json');
      const script = buildFixture(dir);
      writeFixtureFile(join(dir, TEMPLATE_DIR, 'blank', TEMPLATE_PKG_FILE), '{ not json\n');

      const { status, output } = runFixture(script);
      assert(status === 1, `an unparseable template package.json exits 1 — got ${status}\n${output}`);
      assert(
        output.includes(`${TEMPLATE_DIR}/blank/${TEMPLATE_PKG_FILE}`) && output.includes('could not be read as JSON'),
        `the failure names the unreadable package.json\n${output}`,
      );
    }

    // ── Control H: zero templates refuses a vacuous green ───────────────────
    //
    // `main()`'s own guard, which is a DIFFERENT code path from the throw in
    // `stampedPaths()` that #9648 covers: this one is the run refusing to
    // report success after rewriting nothing.
    {
      const dir = fixtureDir('no-templates');
      const script = buildFixture(dir, { templates: [] });

      const { status, output } = runFixture(script);
      assert(status === 1, `an empty templates directory exits 1 — got ${status}\n${output}`);
      assert(
        output.includes('no template directories'),
        `the failure says the directory is empty rather than reporting a sync\n${output}`,
      );
      assert(
        !output.includes('in lockstep with create-objectstack@'),
        `a run that stamped nothing must not print the success line\n${output}`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  reportFailures();
  console.log(
    `✓ sync-template-versions --self-test: ${checked} assertions over temp fixtures, running the real CLI. ` +
      'A CLEAN corpus is observed REACHED, byte-identical and UNWRITTEN; a missing stamp, a missing file, an ' +
      'unparseable package.json, a template with no @objectstack/* dependency and an empty templates directory ' +
      'are each observed exiting 1 and naming the path; and one run is observed naming EVERY unstamped surface. ' +
      'The STALE -> rewritten direction and the discovery walk belong to ' +
      'packages/create-objectstack/src/template-version-stamps.test.ts and are deliberately not restated here.',
  );
}

// Entry-point guard (#9554), the same one #9064 added to check-docs-image-tag.mjs
// and for the same reason: this file is importable, and an import that rewrote
// every bundled template as a side effect is strictly worse than the missing
// export it was working around.
if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    main();
  }
}
