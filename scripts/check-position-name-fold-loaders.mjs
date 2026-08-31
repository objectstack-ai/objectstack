#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The vendored HotCRM permissions artifact has NO non-test loader (#13419).
 *
 *   node scripts/check-position-name-fold-loaders.mjs
 *   node scripts/check-position-name-fold-loaders.mjs --self-test
 *
 * ## The determination this pins, and why a zero had to become a gate
 *
 * `scripts/measure-position-name-fold-census.mjs` (slice 1) reports exactly two
 * position-name folds in this repository, both `cross_scope`:
 *
 *   sales_rep       position <- examples/app-crm/src/security/sales-positions.ts
 *                   set      <- packages/metadata/src/__fixtures__/
 *                               hotcrm-17.1-built-permissions.artifact.json
 *   sales_manager   the same two halves
 *
 * The maintainer ruling (2026-08-31, verbatim 「同意」) orders those folds
 * MATERIALISED as `sys_position_permission_set` rows before the fold is
 * deleted. Slice 2 measured the load paths first, and they invert the order:
 * the artifact is read by ONE test file and by nothing else, so no deployment
 * composes it alongside `examples/app-crm`. The two "dependencies" are a
 * collision between an example app's POSITION names and a vendored test
 * fixture's PERMISSION-SET names — not grants anything holds. Materialising
 * them would MINT two authorizations nothing intends, which is the opposite of
 * what the ruling protects.
 *
 * ⚠️ That determination rests on a LOAD PATH, never on the file's location.
 * "It lives under `__fixtures__/`" is a hint; a directory is not an access
 * control, and a fixture wired into a real composition tomorrow is a real
 * grant tomorrow. So the in-repo materialisation worklist is empty, and this
 * gate is what keeps it empty ON PURPOSE rather than by luck: wire the artifact
 * into anything that is not a test and this goes RED, instead of two live
 * grants quietly appearing on the next boot.
 *
 * ## What counts as a loader
 *
 * Anything that names the artifact — an `import`, a `readFileSync`, a glob
 * whose pattern names the file or its directory. All of them must SPELL the
 * file or the fixtures directory somewhere in source, so a text scan over the
 * tracked tree is a sound instrument for the question. Two dispositions are
 * allowed and every other reference fails:
 *
 *   TEST       a `*.test.ts` / `*.spec.ts` file, or a file under a `test/`,
 *              `tests/` or `__tests__/` directory. A test composes nothing.
 *   INSTRUMENT one of {@link DECLARED_INSTRUMENTS} — a measuring script that
 *              READS the artifact to count it. Declared by exact path, so a new
 *              reader has to be added here deliberately and can be argued about
 *              at that moment rather than being credited silently.
 *
 * ## Why it cannot pass for the wrong reason
 *
 * A scan that finds nothing and a scan that is broken produce the same zero, so
 * the green here is conditioned on three positive facts as well as the absence:
 *
 *   1. the walker REACHED the known test loader — a green from a walk that
 *      visited nothing is refused (#4690's shape);
 *   2. the artifact still declares permission sets named `sales_rep` and
 *      `sales_manager` — if it stops, the fold this gate guards is gone and the
 *      ledger the next slice reads is stale;
 *   3. `examples/app-crm` still declares positions of those two names — the
 *      other half of the same collision.
 *
 * Facts 2 and 3 are not this gate's subject; they are what make its subject
 * meaningful. Either one moving is a real event the next slice's PM must see,
 * and the honest way to surface it is a red gate naming the change, not a
 * silent green over a premise that has dissolved.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** The artifact whose load paths decide the determination. */
const ARTIFACT = 'packages/metadata/src/__fixtures__/hotcrm-17.1-built-permissions.artifact.json';
const ARTIFACT_BASENAME = 'hotcrm-17.1-built-permissions.artifact.json';

/** The directory the artifact lives in: a reference to it is a reference to the artifact. */
const FIXTURES_DIR = 'packages/metadata/src/__fixtures__';

/** The two permission-set names that make this artifact load-bearing for #13419. */
const FOLDED_NAMES = ['sales_rep', 'sales_manager'];

/** Where the positions of those names are declared — the collision's other half. */
const POSITION_SOURCE = 'examples/app-crm/src/security/sales-positions.ts';

/**
 * Non-test readers that are allowed, by exact repo-relative path. A measuring
 * instrument reads the artifact to COUNT it; it composes nothing into a
 * deployment. Listed rather than pattern-matched so that adding a reader is a
 * decision someone makes on this line.
 */
const DECLARED_INSTRUMENTS = [
  'scripts/measure-position-name-fold-census.mjs',
  'scripts/check-position-name-fold-loaders.mjs',
];

const SCAN_ROOTS = ['packages', 'examples', 'apps', 'scripts', 'tools', '.github'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage', '.git']);

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc', '.yml', '.yaml', '.md', '.mdx', '.sh', '.bash',
]);

/** A test file composes nothing — the one shape allowed to name the artifact. */
export function isTestFile(relPath) {
  const parts = relPath.split('/');
  if (parts.some((p) => p === 'test' || p === 'tests' || p === '__tests__')) return true;
  const base = parts[parts.length - 1];
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || /\.tripwire\.test\./.test(base);
}

/**
 * Classify one reference. Split out from the walk so `--self-test` can drive it
 * with the adversarial inputs a clean tree by construction does not contain.
 */
export function classifyReference(relPath) {
  if (relPath === ARTIFACT || relPath.startsWith(`${FIXTURES_DIR}/`)) return 'self';
  if (DECLARED_INSTRUMENTS.includes(relPath)) return 'instrument';
  if (isTestFile(relPath)) return 'test';
  return 'loader';
}

/**
 * Does this file's text name the artifact, its fixtures directory, or a glob
 * that would sweep it up?
 *
 * Three spellings, because a loader has three ways to say the same thing and
 * only one of them is a literal path:
 *
 *   1. the basename — an `import`, a `readFileSync`, a `join(HERE, '…')`;
 *   2. the repo-relative fixtures directory — a config or workflow path;
 *   3. `__fixtures__` on the SAME LINE as `hotcrm` or `.artifact` — the glob
 *      shape (`__fixtures__/*.artifact.json`), which names neither the file nor
 *      the full directory and is invisible to 1 and 2.
 *
 * Rule 3 is line-scoped deliberately. Asked of a whole file it would credit any
 * long file that happens to mention `__fixtures__` in one place and `hotcrm` in
 * another, and a gate whose red is a coincidence gets weakened rather than
 * obeyed.
 */
export function referencesArtifact(text) {
  if (text.includes(ARTIFACT_BASENAME) || text.includes(FIXTURES_DIR)) return true;
  for (const line of text.split('\n')) {
    if (!line.includes('__fixtures__')) continue;
    if (line.includes('hotcrm') || line.includes('.artifact')) return true;
  }
  return false;
}

function walk(root, out) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = join(root, e.name);
    if (e.isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!e.isFile()) continue;
    const dot = e.name.lastIndexOf('.');
    if (dot === -1 || !TEXT_EXT.has(e.name.slice(dot))) continue;
    out.push(abs);
  }
  return out;
}

export function scanTree(root = REPO_ROOT) {
  const files = [];
  for (const dir of SCAN_ROOTS) walk(join(root, dir), files);

  const references = [];
  for (const abs of files) {
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!referencesArtifact(text)) continue;
    const rel = relative(root, abs).split(sep).join('/');
    references.push({ file: rel, disposition: classifyReference(rel) });
  }
  references.sort((a, b) => a.file.localeCompare(b.file));
  return { scanned: files.length, references };
}

/** Premise facts 2 and 3 — see the header. Returned, never thrown, so the
 *  report can print every problem at once. */
export function premiseFindings(root = REPO_ROOT) {
  const findings = [];

  let artifactText = null;
  try {
    artifactText = readFileSync(join(root, ARTIFACT), 'utf8');
  } catch {
    findings.push(
      `the artifact ${ARTIFACT} is gone. This gate, and the #13419 census reading it pins, `
      + 'both describe a fold that no longer has a permission-set half. Re-run '
      + '`node scripts/measure-position-name-fold-census.mjs` and retire or re-aim this gate.',
    );
    artifactText = null;
  }
  if (artifactText !== null) {
    let names = [];
    try {
      const parsed = JSON.parse(artifactText);
      names = collectPermissionSetNames(parsed);
    } catch (e) {
      findings.push(`the artifact ${ARTIFACT} did not parse as JSON: ${e.message}`);
    }
    for (const n of FOLDED_NAMES) {
      if (!names.includes(n)) {
        findings.push(
          `the artifact no longer declares a permission set named '${n}'. The #13419 fold on that `
          + 'name is gone with it, so the census reading this gate guards is stale — re-run the '
          + 'census before trusting any worklist derived from it.',
        );
      }
    }
  }

  let positionText = null;
  try {
    positionText = readFileSync(join(root, POSITION_SOURCE), 'utf8');
  } catch {
    findings.push(`${POSITION_SOURCE} is gone — the position half of both #13419 folds. Re-run the census.`);
  }
  if (positionText !== null) {
    for (const n of FOLDED_NAMES) {
      if (!positionText.includes(`'${n}'`)) {
        findings.push(
          `${POSITION_SOURCE} no longer declares a position named '${n}'. The collision that made `
          + 'the artifact interesting is gone; re-run the census and re-aim this gate.',
        );
      }
    }
  }

  return findings;
}

/** Every `name` under a `permissions` collection, at any depth. */
export function collectPermissionSetNames(node, inPermissions = false, out = []) {
  if (Array.isArray(node)) {
    for (const v of node) collectPermissionSetNames(v, inPermissions, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (inPermissions && typeof node.name === 'string') out.push(node.name);
  for (const [k, v] of Object.entries(node)) {
    collectPermissionSetNames(v, inPermissions || k === 'permissions', out);
  }
  return out;
}

// ---------------------------------------------------------------------------

function report(loaders) {
  console.error(
    `✗ check-position-name-fold-loaders: ${loaders.length} non-test loader(s) of ${ARTIFACT}.\n`,
  );
  for (const l of loaders) console.error(`  ${l.file}`);
  console.error(
    '\n  This artifact supplies the permission sets `sales_rep` and `sales_manager`. The positions\n'
    + `  of those names are declared by ${POSITION_SOURCE}, and\n`
    + '  `security-plugin.ts` still folds a POSITION name into the permission-set request\n'
    + '  (`const requested = [...positions, ...explicitPermissionSets];`). Composing this artifact\n'
    + '  into a deployment that also loads examples/app-crm therefore GRANTS both sets by name,\n'
    + '  with no sys_position_permission_set row and no audit line — the ungoverned channel the\n'
    + '  2026-08-31 ruling on #13419 retires.\n\n'
    + '  If the load is deliberate, it is an authorization-data change and needs the ruling\n'
    + '  applied (执行要点 2: materialise the (position N, set N) junction rows), not a new entry\n'
    + '  in DECLARED_INSTRUMENTS. That list is for readers that MEASURE the artifact, never for\n'
    + '  code that composes it.',
  );
}

function selfTest() {
  let failed = 0;
  let cases = 0;
  const check = (label, actual, expected) => {
    cases++;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
      failed++;
      console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    } else {
      console.log(`  ✓ ${label}`);
    }
  };

  console.log('check-position-name-fold-loaders --self-test\n');

  // ── REVERSE CONTROL. A zero from a scan that cannot report anything is not a
  //    reading. These are the adversarial inputs a clean tree does not contain.
  check(
    'REVERSE: a non-test loader is a finding',
    classifyReference('packages/runtime/src/seed-marketplace-apps.ts'),
    'loader',
  );
  check(
    'REVERSE: an app composition entry is a finding',
    classifyReference('examples/app-crm/objectstack.config.ts'),
    'loader',
  );
  check(
    'REVERSE: a build script that vendors the artifact is a finding',
    classifyReference('scripts/build-marketplace-bundle.mjs'),
    'loader',
  );

  // ── The allowed dispositions, each for its own stated reason.
  check('test file is allowed', classifyReference('packages/metadata/src/plugin-artifact-forward-conversion.test.ts'), 'test');
  check('file under test/ is allowed', classifyReference('packages/qa/dogfood/test/shared-showcase.ts'), 'test');
  check('declared instrument is allowed', classifyReference('scripts/measure-position-name-fold-census.mjs'), 'instrument');
  check('the artifact itself is self', classifyReference(ARTIFACT), 'self');
  check('a sibling fixture is self', classifyReference(`${FIXTURES_DIR}/hotcrm-17.1-built-bare-root-predicates.artifact.json`), 'self');

  // ── The text matcher, both directions. A matcher that never matches turns
  //    every loader into a silent pass, and it is the half a clean tree cannot
  //    exercise from the negative side alone.
  check('matcher sees the basename', referencesArtifact(`join(HERE, '__fixtures__/${ARTIFACT_BASENAME}')`), true);
  check('matcher sees a fixtures-directory glob', referencesArtifact(`glob('${FIXTURES_DIR}/*.artifact.json')`), true);
  check('matcher ignores an unrelated hotcrm mention', referencesArtifact("// the HotCRM shape from hotcrm#788"), false);
  check('matcher sees a bare glob sweep of the fixtures dir', referencesArtifact("await glob('**/__fixtures__/*.artifact.json')"), true);
  check(
    'matcher does NOT credit __fixtures__ and hotcrm on separate lines',
    referencesArtifact("import x from './__fixtures__/widget.json';\n// unrelated: hotcrm#788\n"),
    false,
  );

  // ── The permission-set extractor, on the real artifact shape.
  check(
    'extractor finds both folded names in the shipped artifact',
    FOLDED_NAMES.every((n) => collectPermissionSetNames(JSON.parse(readFileSync(join(REPO_ROOT, ARTIFACT), 'utf8'))).includes(n)),
    true,
  );
  check(
    'extractor does not credit a name outside a permissions collection',
    collectPermissionSetNames({ objects: [{ name: 'crm_lead' }] }),
    [],
  );

  if (failed > 0) {
    console.error(`\n✗ check-position-name-fold-loaders self-test failed (${failed} of ${cases} case(s)).`);
    process.exit(1);
  }
  console.log(`\n✓ check-position-name-fold-loaders self-test: ${cases} cases pass.`);
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const { scanned, references } = scanTree();

  if (scanned === 0) {
    console.error(
      `✗ check-position-name-fold-loaders: the walk visited 0 files under ${SCAN_ROOTS.join(', ')}.\n`
      + '  "nothing references the artifact" and "the walk found nothing" are different answers,\n'
      + '  and this gate refuses to report the second as the first.',
    );
    process.exit(1);
  }

  // POSITIVE CONTROL. The known test loader must be seen. Without it a scanner
  // that silently stopped matching would report the same clean zero as a tree
  // that genuinely has no loader — the exact way this gate would rot.
  const sawKnownTestLoader = references.some(
    (r) => r.file === 'packages/metadata/src/plugin-artifact-forward-conversion.test.ts' && r.disposition === 'test',
  );
  if (!sawKnownTestLoader) {
    console.error(
      '✗ check-position-name-fold-loaders: the scan did not see the KNOWN reader\n'
      + '  packages/metadata/src/plugin-artifact-forward-conversion.test.ts.\n'
      + '  Either that test stopped reading the artifact — in which case the artifact may now be\n'
      + '  vendored for nothing — or this scan stopped matching, in which case its zero is not a\n'
      + '  reading. Both need a human; neither is a pass.',
    );
    process.exit(1);
  }

  const premise = premiseFindings();
  if (premise.length > 0) {
    console.error('✗ check-position-name-fold-loaders: the #13419 premise this gate guards has moved.\n');
    for (const f of premise) console.error(`  - ${f}`);
    process.exit(1);
  }

  const loaders = references.filter((r) => r.disposition === 'loader');
  if (loaders.length > 0) {
    report(loaders);
    process.exit(1);
  }

  const tests = references.filter((r) => r.disposition === 'test');
  const instruments = references.filter((r) => r.disposition === 'instrument');
  console.log(
    `✓ check-position-name-fold-loaders: ${ARTIFACT}\n`
    + `  has no non-test loader. ${scanned} file(s) scanned under ${SCAN_ROOTS.join(', ')}; `
    + `${references.length} reference(s): ${tests.length} test, ${instruments.length} declared instrument, 0 loader.\n`
    + `  ⇒ #13419 执行要点 2's in-repo materialisation worklist is EMPTY, and stays empty by measurement:\n`
    + '    the two name-folds the census reports are a collision between an example app\'s position\n'
    + '    names and a test fixture\'s permission-set names, not grants any deployment holds.',
  );
}

if (isEntrypoint(import.meta.url)) {
  main();
}
