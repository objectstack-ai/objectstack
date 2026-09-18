#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-release-spec-changes — the ADR-0087 D4 per-release correctness gate.
 *
 *   node scripts/check-release-spec-changes.mjs --previous <dir> --published <dir>
 *   node scripts/check-release-spec-changes.mjs --self-test
 *
 * Both arguments are the UNPACKED `package/` root of a tarball: `--previous`
 * the last published `@objectstack/spec`, `--published` the artifact this
 * release is about to publish. The gate recomputes the export-surface delta
 * from those two artifacts and refuses the release when the `release` section
 * inside the published one disagrees.
 *
 * ## Why a gate at all
 *
 * `spec-changes.json` gained a per-release section so a consumer crossing one
 * MINOR can read what moved. That makes the file a published contract a
 * downstream CI can gate on — and a WRONG change file is worse than none,
 * because the consumer stops looking. So the section is not trusted because the
 * generator produced it; it is trusted because this gate reproduced it from the
 * two artifacts that actually ship.
 *
 * ## Why this is not a tautology
 *
 * The generator (`packages/spec/scripts/build-spec-changes.ts`) reads the
 * WORKING TREE's `api-surface/` and writes the manifest. This gate reads
 * neither: it reads the two TARBALLS, including the manifest as packed. The two
 * therefore disagree whenever anything between them is wrong — a stale
 * `api-surface/` snapshot in the tree, a `files[]` entry that drops a shard
 * from the artifact, a manifest regenerated against the wrong previous version,
 * a hand edit, a generator bug. It carries its own flattening rather than
 * importing the generator's, on purpose: an instrument that shares the code it
 * audits reports agreement with itself.
 *
 * ## Why it names exports instead of exiting 1
 *
 * A gate that can wedge a release without saying why is worse than the defect
 * it guards. Every failure prints the disagreeing exports and the DIRECTION of
 * each disagreement — claimed-but-not-real, real-but-unclaimed, per array —
 * plus the one command that regenerates the section. A release is held only by
 * a failure whose remedy is printed with it.
 *
 * ## The one thing it deliberately does NOT require
 *
 * A previous tarball that ships no `api-surface` snapshot (before protocol 15)
 * or no `spec-changes.json` cannot produce a delta at all. The generator omits
 * the section loudly in that case rather than emitting an empty one, and this
 * gate derives the same condition from the same artifacts and accepts the
 * absence — but it REFUSES a section that is present when it could not have
 * been computed, which is the shape that would lie.
 */

import fs from 'node:fs';
import path from 'node:path';

const API_SURFACE_DIR = 'api-surface';
const API_SURFACE_MONOLITH = 'api-surface.json';
const MANIFEST = 'spec-changes.json';
const REGENERATE_HINT =
  'Regenerate with: pnpm --filter @objectstack/spec exec tsx scripts/build-spec-changes.ts ' +
  '--previous-package <unpacked previous package/>';
/** How many disagreeing names are listed before the rest are counted. */
const NAME_CAP = 25;

// Set by `selfTest()` only after its verdict prints, and read at the dispatch:
// a `return` above that line prints nothing and still exits 0 — a self-test
// that never finished, reported as one that passed.
let selfTestReachedVerdict = false;

// ─── Reading an artifact ──────────────────────────────────────────────────

/**
 * Every `entry: name (kind)` row of an unpacked tarball's export snapshot, or
 * `null` when it ships none.
 *
 * The row spelling is the contract between this gate and the generator, and it
 * is the only thing the two share. Both tarball layouts are read because a
 * published tarball is immutable: the sharded directory (#5837 on) and the
 * single file before it.
 */
function readSurface(pkgDir) {
  const dir = path.join(pkgDir, API_SURFACE_DIR);
  const rows = new Set();
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    const shards = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    if (shards.length === 0) return null;
    for (const shard of shards) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, shard), 'utf8'));
      const entry = doc.entry;
      if (typeof entry !== 'string' || !Array.isArray(doc.exports)) {
        throw new Error(`${path.join(dir, shard)} is not an api-surface shard (no "entry"/"exports")`);
      }
      for (const name of doc.exports) rows.add(`${entry}: ${name}`);
    }
    return rows;
  }
  const monolith = path.join(pkgDir, API_SURFACE_MONOLITH);
  if (fs.existsSync(monolith)) {
    const doc = JSON.parse(fs.readFileSync(monolith, 'utf8'));
    for (const [entry, names] of Object.entries(doc)) {
      for (const name of names) rows.add(`${entry}: ${name}`);
    }
    return rows;
  }
  return null;
}

/** The parsed `spec-changes.json` of an unpacked tarball, or `null` when absent. */
function readManifest(pkgDir) {
  const file = path.join(pkgDir, MANIFEST);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The `version` of an unpacked tarball's own manifest, or `null`. */
function readVersion(pkgDir) {
  const file = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(file)) return null;
  const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
  return typeof version === 'string' ? version : null;
}

/** Registry ids an artifact's aggregate projection carries. */
function aggregateIds(manifest) {
  const aggregate = manifest?.aggregate;
  if (!aggregate) return null;
  return {
    conversionIds: (aggregate.converted ?? []).map((c) => c.conversionId),
    migrationIds: (aggregate.migrated ?? []).map((m) => m.migrationId),
  };
}

// ─── The comparison ───────────────────────────────────────────────────────

function listNames(names) {
  const shown = names.slice(0, NAME_CAP).map((n) => `      ${n}`);
  if (names.length > NAME_CAP) shown.push(`      … and ${names.length - NAME_CAP} more`);
  return shown;
}

/**
 * Compare one array of the section against the truth recomputed from the two
 * tarballs, in BOTH directions — a section that omits a real removal and one
 * that invents a removal are different defects and read differently.
 */
function compareArray(label, claimed, actual, problems) {
  const claimedSet = new Set(claimed);
  const actualSet = new Set(actual);
  const invented = [...claimedSet].filter((n) => !actualSet.has(n)).sort();
  const missed = [...actualSet].filter((n) => !claimedSet.has(n)).sort();
  if (invented.length > 0) {
    problems.push(
      `release.${label}: ${invented.length} export(s) the section CLAIMS but the two tarballs do not show as ${label}:`,
      ...listNames(invented),
    );
  }
  if (missed.length > 0) {
    problems.push(
      `release.${label}: ${missed.length} export(s) the two tarballs show as ${label} and the section OMITS:`,
      ...listNames(missed),
    );
  }
  return invented.length === 0 && missed.length === 0;
}

/**
 * The whole verdict for one release pair.
 *
 * Returns `{ ok, problems, summary }` rather than exiting, so the self-test
 * drives the same code path the release lane runs.
 */
export function verifyRelease(previousDir, publishedDir) {
  const problems = [];

  const previousVersion = readVersion(previousDir);
  const publishedVersion = readVersion(publishedDir);
  if (!publishedVersion) {
    return {
      ok: false,
      problems: [`${publishedDir} carries no readable package.json — this is not an unpacked tarball.`],
      summary: null,
    };
  }

  const publishedManifest = readManifest(publishedDir);
  if (!publishedManifest) {
    return {
      ok: false,
      problems: [
        `the artifact about to publish ships no ${MANIFEST}. ADR-0087 D4 requires it inside the tarball; ` +
          `check that "${MANIFEST}" is still listed in packages/spec/package.json "files".`,
      ],
      summary: null,
    };
  }

  const previousSurface = readSurface(previousDir);
  const previousIds = aggregateIds(readManifest(previousDir));
  const computable = Boolean(previousSurface && previousIds && previousVersion);
  const section = publishedManifest.release;

  if (!computable) {
    // The one legitimate absence. Naming which input is missing keeps "we could
    // not compute it" distinguishable from "nothing changed".
    const missing = [
      previousSurface ? null : 'an api-surface snapshot',
      previousIds ? null : `a readable ${MANIFEST}`,
      previousVersion ? null : 'a readable package.json',
    ].filter(Boolean);
    if (section) {
      return {
        ok: false,
        problems: [
          `the artifact carries a release section, but the previous tarball ships ${missing.join(' and ')} — ` +
            'so no delta could have been computed from it. A section that could not be derived is exactly the ' +
            'wrong-data case this gate exists to refuse.',
        ],
        summary: null,
      };
    }
    return {
      ok: true,
      problems: [],
      summary:
        `no release section, and none is owed: the previous tarball ships ${missing.join(' and ')}. ` +
        'This is the pre-protocol-15 shape; nothing is claimed about the delta.',
    };
  }

  if (!section) {
    return {
      ok: false,
      problems: [
        `the artifact about to publish ships no release section, but one is owed: the previous release ` +
          `(${previousVersion}) carries both an export snapshot and a ${MANIFEST}, so the ` +
          `${previousVersion} → ${publishedVersion} delta is computable. ${REGENERATE_HINT}`,
      ],
      summary: null,
    };
  }

  // Versions first: a section computed against the wrong previous release is
  // wrong in a way the array comparison below would report as hundreds of
  // export disagreements, which buries the one fact that explains them.
  let ok = true;
  if (section.fromVersion !== previousVersion) {
    ok = false;
    problems.push(
      `release.fromVersion is ${JSON.stringify(section.fromVersion)} but the previous tarball is ` +
        `${JSON.stringify(previousVersion)} — the section was generated against a different release.`,
    );
  }
  if (section.toVersion !== publishedVersion) {
    ok = false;
    problems.push(
      `release.toVersion is ${JSON.stringify(section.toVersion)} but this artifact is ` +
        `${JSON.stringify(publishedVersion)} — the section describes a release this tarball is not.`,
    );
  }

  const publishedSurface = readSurface(publishedDir);
  if (!publishedSurface) {
    return {
      ok: false,
      problems: [
        ...problems,
        `the artifact about to publish ships no ${API_SURFACE_DIR}/ snapshot, so its own claim cannot be ` +
          'checked. ADR-0059 §3 ships it in the tarball; check packages/spec/package.json "files".',
      ],
      summary: null,
    };
  }

  const actualAdded = [...publishedSurface].filter((n) => !previousSurface.has(n));
  const actualRemoved = [...previousSurface].filter((n) => !publishedSurface.has(n));
  const claimedAdded = (section.added ?? []).map((e) => e.surface);
  const claimedRemoved = (section.removed ?? []).map((e) => e.surface);
  ok = compareArray('added', claimedAdded, actualAdded, problems) && ok;
  ok = compareArray('removed', claimedRemoved, actualRemoved, problems) && ok;

  // The registry half: entries NEW in this release are the ids the published
  // projection carries and the previous one did not.
  const publishedIds = aggregateIds(publishedManifest);
  if (!publishedIds) {
    ok = false;
    problems.push(`the artifact's ${MANIFEST} has no aggregate record — its release section cannot be checked.`);
  } else {
    const priorConversions = new Set(previousIds.conversionIds);
    const priorMigrations = new Set(previousIds.migrationIds);
    ok =
      compareArray(
        'converted',
        (section.converted ?? []).map((c) => c.conversionId),
        publishedIds.conversionIds.filter((id) => !priorConversions.has(id)),
        problems,
      ) && ok;
    ok =
      compareArray(
        'migrated',
        (section.migrated ?? []).map((m) => m.migrationId),
        publishedIds.migrationIds.filter((id) => !priorMigrations.has(id)),
        problems,
      ) && ok;
  }

  if (!ok) problems.push(REGENERATE_HINT);

  return {
    ok,
    problems,
    summary: ok
      ? `release ${section.fromVersion} → ${section.toVersion} verified against both tarballs: ` +
        `${claimedAdded.length} added, ${claimedRemoved.length} removed, ` +
        `${(section.converted ?? []).length} converted, ${(section.migrated ?? []).length} migrated.`
      : null,
  };
}

// ─── Self-test ────────────────────────────────────────────────────────────

const SELF_TEST_BATTERIES = Object.freeze({
  'a section matching both tarballs → GREEN': 1,
  'the legacy single-file api-surface layout is read → GREEN': 1,
  'a previous tarball with no api-surface → GREEN, no section owed': 1,
  'a section present when the previous tarball could not produce one → RED': 1,
  'R1 — a computable delta with NO release section → RED': 1,
  'R2 — an export that really arrived is missing from added → RED, naming it': 1,
  'R3 — an export the section invents in added → RED, naming it': 1,
  'R4 — a real removal omitted from removed → RED, naming it': 1,
  'R5 — fromVersion pointing at another release → RED': 1,
  'R6 — toVersion disagreeing with the artifact → RED': 1,
  'R7 — a new conversion id omitted from converted → RED': 1,
  'R8 — a conversion id invented in converted → RED': 1,
  'R9 — the published artifact ships no spec-changes.json → RED': 1,
  'R10 — the published artifact ships no api-surface → RED': 1,
  'R11 — an empty export snapshot is not a silent pass → RED': 1,
});
const SELF_TEST_BATTERY_FLOOR = 15;

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'release-spec-changes-selftest-'));
  let failed = 0;
  const batterySeen = new Map();
  const registerCase = (label) => batterySeen.set(label, (batterySeen.get(label) ?? 0) + 1);

  let seq = 0;
  const pair = ({ prev = {}, next = {} } = {}) => {
    const base = path.join(tmp, `case-${(seq += 1)}`);
    return {
      previous: writeTree(path.join(base, 'prev'), prev),
      published: writeTree(path.join(base, 'next'), next),
    };
  };

  const shard = (entry, exports) => ({ description: 'test shard', entry, exports });
  const manifest = (extra = {}) => ({
    protocolVersion: '17.0.0',
    supportFloor: 10,
    aggregate: {
      from: 10,
      to: 17,
      added: [],
      converted: [{ surface: 's', to: 't', conversionId: 'conv-old', toMajor: 17 }],
      migrated: [{ surface: 's', replacement: 'r', migrationId: 'mig-old', toMajor: 17, rationale: 'why' }],
      removed: [],
    },
    perMajor: [],
    ...extra,
  });
  const release = (extra = {}) => ({
    fromVersion: '17.3.0',
    toVersion: '17.4.0',
    added: [{ surface: './ai: NewThing (const)' }],
    converted: [],
    migrated: [],
    removed: [{ surface: './ai: OldThing (const)' }],
    ...extra,
  });
  /** prev: exports OldThing+Kept; next: exports Kept+NewThing. */
  const PREV = {
    'package.json': { name: '@objectstack/spec', version: '17.3.0' },
    'api-surface/ai.json': shard('./ai', ['Kept (const)', 'OldThing (const)']),
    'spec-changes.json': manifest(),
  };
  const NEXT = (releaseSection = release(), extra = {}) => ({
    'package.json': { name: '@objectstack/spec', version: '17.4.0' },
    'api-surface/ai.json': shard('./ai', ['Kept (const)', 'NewThing (const)']),
    'spec-changes.json': manifest(releaseSection === null ? {} : { release: releaseSection }),
    ...extra,
  });

  const check = (label, { prev, next }, expectOk, expectText) => {
    registerCase(label);
    const dirs = pair({ prev, next });
    let verdict;
    try {
      verdict = verifyRelease(dirs.previous, dirs.published);
    } catch (error) {
      console.error(`✗ ${label}: threw ${error.message}`);
      failed += 1;
      return;
    }
    if (verdict.ok !== expectOk) {
      console.error(
        `✗ ${label}: expected ${expectOk ? 'GREEN' : 'RED'}, got ${verdict.ok ? 'GREEN' : 'RED'}` +
          `${verdict.problems.length > 0 ? `\n    ${verdict.problems.join('\n    ')}` : ''}`,
      );
      failed += 1;
      return;
    }
    if (expectText) {
      const haystack = [...verdict.problems, verdict.summary ?? ''].join('\n');
      if (!haystack.includes(expectText)) {
        console.error(`✗ ${label}: output never names ${JSON.stringify(expectText)}\n    ${haystack}`);
        failed += 1;
        return;
      }
    }
    console.log(`✓ ${label}`);
  };

  check('a section matching both tarballs → GREEN', { prev: PREV, next: NEXT() }, true, '1 added, 1 removed');

  check(
    'the legacy single-file api-surface layout is read → GREEN',
    {
      prev: {
        'package.json': { name: '@objectstack/spec', version: '17.3.0' },
        'api-surface.json': { './ai': ['Kept (const)', 'OldThing (const)'] },
        'spec-changes.json': manifest(),
      },
      next: NEXT(),
    },
    true,
  );

  check(
    'a previous tarball with no api-surface → GREEN, no section owed',
    {
      prev: { 'package.json': { name: '@objectstack/spec', version: '17.3.0' }, 'spec-changes.json': manifest() },
      next: NEXT(null),
    },
    true,
    'none is owed',
  );

  check(
    'a section present when the previous tarball could not produce one → RED',
    {
      prev: { 'package.json': { name: '@objectstack/spec', version: '17.3.0' }, 'spec-changes.json': manifest() },
      next: NEXT(),
    },
    false,
    'could have been computed',
  );

  check('R1 — a computable delta with NO release section → RED', { prev: PREV, next: NEXT(null) }, false, 'is owed');

  check(
    'R2 — an export that really arrived is missing from added → RED, naming it',
    { prev: PREV, next: NEXT(release({ added: [] })) },
    false,
    './ai: NewThing (const)',
  );

  check(
    'R3 — an export the section invents in added → RED, naming it',
    { prev: PREV, next: NEXT(release({ added: [{ surface: './ai: Ghost (const)' }] })) },
    false,
    './ai: Ghost (const)',
  );

  check(
    'R4 — a real removal omitted from removed → RED, naming it',
    { prev: PREV, next: NEXT(release({ removed: [] })) },
    false,
    './ai: OldThing (const)',
  );

  check(
    'R5 — fromVersion pointing at another release → RED',
    { prev: PREV, next: NEXT(release({ fromVersion: '17.2.0' })) },
    false,
    'generated against a different release',
  );

  check(
    'R6 — toVersion disagreeing with the artifact → RED',
    { prev: PREV, next: NEXT(release({ toVersion: '17.5.0' })) },
    false,
    'describes a release this tarball is not',
  );

  {
    const withNewConversion = manifest({
      release: release({ converted: [] }),
    });
    withNewConversion.aggregate.converted.push({
      surface: 's2',
      to: 't2',
      conversionId: 'conv-new',
      toMajor: 17,
    });
    check(
      'R7 — a new conversion id omitted from converted → RED',
      {
        prev: PREV,
        next: {
          'package.json': { name: '@objectstack/spec', version: '17.4.0' },
          'api-surface/ai.json': shard('./ai', ['Kept (const)', 'NewThing (const)']),
          'spec-changes.json': withNewConversion,
        },
      },
      false,
      'conv-new',
    );
  }

  check(
    'R8 — a conversion id invented in converted → RED',
    {
      prev: PREV,
      next: NEXT(release({ converted: [{ surface: 's', to: 't', conversionId: 'conv-ghost', toMajor: 17 }] })),
    },
    false,
    'conv-ghost',
  );

  check(
    'R9 — the published artifact ships no spec-changes.json → RED',
    {
      prev: PREV,
      next: {
        'package.json': { name: '@objectstack/spec', version: '17.4.0' },
        'api-surface/ai.json': shard('./ai', ['Kept (const)']),
      },
    },
    false,
    'ships no spec-changes.json',
  );

  check(
    'R10 — the published artifact ships no api-surface → RED',
    {
      prev: PREV,
      next: { 'package.json': { name: '@objectstack/spec', version: '17.4.0' }, 'spec-changes.json': manifest({ release: release() }) },
    },
    false,
    'ships no api-surface/ snapshot',
  );

  check(
    'R11 — an empty export snapshot is not a silent pass → RED',
    {
      prev: PREV,
      next: {
        'package.json': { name: '@objectstack/spec', version: '17.4.0' },
        'api-surface/ai.json': shard('./ai', []),
        'spec-changes.json': manifest({ release: release() }),
      },
    },
    false,
    './ai: Kept (const)',
  );

  // ── Floor: what ran must be what is declared ──────────────────────────
  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR} — ` +
        'a battery deleted from the roster takes its own floor with it.',
    );
  }
  for (const [name, count] of batterySeen) {
    if (declared.includes(name)) continue;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES — ` +
        'a case attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed that case holds.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]}.`,
    );
  }

  fs.rmSync(tmp, { recursive: true, force: true });

  if (failed > 0) {
    console.error(`\n✗ check-release-spec-changes self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ check-release-spec-changes self-test: ${declared.length} batteries pass.`);
  selfTestReachedVerdict = true;
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error(
        '\n✗ check-release-spec-changes self-test: selfTest() returned without reaching its verdict,\n' +
          'so no success line was printed. Exiting 0 here would report a self-test that never\n' +
          'finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
    return;
  }

  const previous = argValue('--previous');
  const published = argValue('--published');
  if (!previous || !published) {
    console.error(
      'usage: node scripts/check-release-spec-changes.mjs --previous <unpacked previous package/> ' +
        '--published <unpacked package/ about to publish>\n' +
        '       node scripts/check-release-spec-changes.mjs --self-test',
    );
    process.exit(2);
  }
  for (const [flag, dir] of [['--previous', previous], ['--published', published]]) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      // "Could not run" is a failure, never a skip: a release must not pass this
      // gate because its inputs were misspelled.
      console.error(`✗ ${flag} ${dir} is not a directory — nothing was checked.`);
      process.exit(2);
    }
  }

  const verdict = verifyRelease(previous, published);
  if (!verdict.ok) {
    console.error('✗ the per-release section of spec-changes.json disagrees with the two tarballs (ADR-0087 D4).');
    console.error('  A wrong change file is worse than none — a consumer gates its upgrade on this data.\n');
    for (const line of verdict.problems) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`✓ ${verdict.summary}`);
}

main();
