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

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scaffolderPkgPath = join(root, 'packages/create-objectstack/package.json');

/**
 * Where the bundled templates live. A DIRECTORY, walked, never a hand-kept
 * list — see the header. Mirrors `check-template-manifests.ts`'s TEMPLATE_ROOT.
 */
const TEMPLATE_ROOT = join(root, 'packages/create-objectstack/src/templates');

const rel = (p) => relative(root, p);

const version = JSON.parse(readFileSync(scaffolderPkgPath, 'utf8')).version;
if (!/^\d+\.\d+\.\d+/.test(String(version))) {
  console.error(`✗ sync-template-versions: cannot parse create-objectstack version '${version}'`);
  process.exit(1);
}
const major = String(version).split('.')[0];
/** The `@objectstack/*` package range: dependencies AND the manifest's `specVersion`. */
const range = `^${major}.0.0`;

/**
 * The text stamps, as a table over (file, key, pattern, replacement).
 *
 * Table-driven rather than one block per key so that adding a fourth declared
 * version surface is a row, and so that all of them share ONE failure contract
 * — the shape whose absence let `specVersion` drift unnoticed (#9264).
 *
 * Rewritten as TEXT, not parse/re-serialize, and that matters for the manifest:
 * `objectstack.manifest.json` keeps `scaffold.variables` compact on one line, so
 * `JSON.stringify(…, null, 2)` would reformat 42 bytes of unrelated structure
 * on every release. A targeted replace touches the value and nothing else.
 */
const TEXT_STAMPS = [
  {
    file: 'objectstack.config.ts',
    key: 'engines.protocol',
    value: `^${major}`,
    // ADR-0087 D1 — the runtime refuses an incompatible package at the boundary
    // with the exact migration command. Scaffolds populate it by default; this
    // is the ratchet that closes grandfathering.
    pattern: /engines:\s*\{\s*protocol:\s*'[^']*'\s*\}/,
    replacement: `engines: { protocol: '^${major}' }`,
  },
  {
    file: 'objectstack.manifest.json',
    key: 'specVersion',
    value: range,
    // Required by TemplateManifestSchema and read by the template registry;
    // `create-objectstack` copies it verbatim into every scaffolded project
    // (it rewrites name/displayName/namespace and drops description, and has
    // never touched this key), so a stale value ships to real users.
    pattern: /("specVersion"\s*:\s*)"[^"]*"/,
    replacement: `$1"${range}"`,
  },
];

/** Every bundled template directory, sorted. Deliberately not a curated list. */
function findTemplateDirs() {
  return readdirSync(TEMPLATE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist')
    .map((e) => e.name)
    .sort();
}

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
  // ── package.json: every @objectstack/* range → the package range ──────────
  const templatePkgPath = join(TEMPLATE_ROOT, template, 'package.json');
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

  // ── the text stamps ───────────────────────────────────────────────────────
  for (const stamp of TEXT_STAMPS) {
    const path = join(TEMPLATE_ROOT, template, stamp.file);
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
          `It should declare ${stamp.key} = ${stamp.value}.`,
      );
      continue;
    }

    const stamped = src.replace(stamp.pattern, stamp.replacement);
    if (stamped === src) {
      console.log(`✓ ${template}/${stamp.file} already stamps ${stamp.key} '${stamp.value}'`);
    } else {
      writeFileSync(path, stamped);
      console.log(`✓ ${template}/${stamp.file}: ${stamp.key} → '${stamp.value}'`);
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
