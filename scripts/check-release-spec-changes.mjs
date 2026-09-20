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
 * ## Both export claims in the artifact, not just the section's
 *
 * `aggregate.added`/`removed` are filled by the same one-release api-surface
 * diff, under a record keyed by protocol MAJOR — and until #18978 this gate did
 * not look at them at all. Published unlabelled, one minor's slice reads as the
 * whole major-boundary delta: the `@objectstack/spec@17.4.0` Release asset
 * carried 225 added / 51 removed, every entry `since: 17`, beside
 * `perMajor[16 → 17].added: 0`. So the aggregate's claim is recomputed from the
 * same two tarballs and must carry a `surfaceScope` naming the version pair it
 * really spans. An aggregate that claims NOTHING (empty arrays, no scope — the
 * committed registry-only projection) is left alone: this gate refuses wrong
 * claims, and turning "must not lie" into "must speak" is a publish requirement
 * rather than a refusal.
 *
 * ## The one thing it deliberately does NOT require
 *
 * A previous tarball that ships no `api-surface` snapshot (before protocol 15)
 * or no `spec-changes.json` cannot produce a delta at all. The generator omits
 * the section loudly in that case rather than emitting an empty one, and this
 * gate derives the same condition from the same artifacts and accepts the
 * absence — but it REFUSES a section that is present when it could not have
 * been computed, which is the shape that would lie. The aggregate half needs
 * strictly less (a snapshot and a version, never the previous manifest), so it
 * is still checked on the shape where no section is owed.
 */

import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';

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
function compareArray(path, claimed, actual, problems) {
  const kind = path.slice(path.indexOf('.') + 1);
  const claimedSet = new Set(claimed);
  const actualSet = new Set(actual);
  const invented = [...claimedSet].filter((n) => !actualSet.has(n)).sort();
  const missed = [...actualSet].filter((n) => !claimedSet.has(n)).sort();
  if (invented.length > 0) {
    problems.push(
      `${path}: ${invented.length} export(s) the artifact CLAIMS but the two tarballs do not show as ${kind}:`,
      ...listNames(invented),
    );
  }
  if (missed.length > 0) {
    problems.push(
      `${path}: ${missed.length} export(s) the two tarballs show as ${kind} and the artifact OMITS:`,
      ...listNames(missed),
    );
  }
  return invented.length === 0 && missed.length === 0;
}

/**
 * The aggregate record's own export-surface claim, checked against the same two
 * tarballs — the half `release.*` was gated for and this one was not (#18978).
 *
 * `aggregate.added`/`removed` are filled by a ONE-RELEASE api-surface diff while
 * the record is keyed by protocol MAJOR (`from: 10, to: 17`). Published
 * unlabelled, one minor's slice reads as the whole major-boundary delta — and it
 * did: the `@objectstack/spec@17.4.0` Release asset carried 225 added / 51
 * removed, every entry `since: 17`, beside `perMajor[16 → 17].added: 0`. So two
 * things are refused here, in both directions: arrays that disagree with the two
 * tarballs, and arrays that carry no `surfaceScope` naming the version pair they
 * really span.
 *
 * ⚠️ An aggregate diff is computable from strictly less than a release section:
 * it needs the previous tarball's export snapshot and version, and NOT its
 * `spec-changes.json`. So this runs on the pre-#2897 shape too, where the
 * release section is legitimately absent.
 */
/** One line naming what the aggregate record claims about the export surface. */
function aggregateSummary(aggregate) {
  const added = (aggregate?.added ?? []).length;
  const removed = (aggregate?.removed ?? []).length;
  const scope = aggregate?.surfaceScope;
  if (added + removed === 0 && !scope) {
    return 'aggregate claims no export diff (registry-only projection).';
  }
  return (
    `aggregate export diff ${scope ? `${scope.fromVersion} → ${scope.toVersion}` : '(UNSCOPED)'} ` +
    `verified: ${added} added, ${removed} removed.`
  );
}

function verifyAggregateSurface(ctx, problems) {
  const { aggregate, previousSurface, previousVersion, publishedSurface, publishedVersion } = ctx;
  if (!aggregate) {
    problems.push(
      `the artifact's ${MANIFEST} has no aggregate record — ADR-0087 D4 requires it, and its export ` +
        'claim cannot be checked.',
    );
    return false;
  }
  const claimedAdded = (aggregate.added ?? []).map((e) => e.surface);
  const claimedRemoved = (aggregate.removed ?? []).map((e) => e.surface);
  const scope = aggregate.surfaceScope;
  const claims = claimedAdded.length + claimedRemoved.length;

  // ⛔ Deliberately NOT checked: an aggregate that makes no export claim at all.
  // Empty arrays with no `surfaceScope` is the committed registry-only
  // projection — honest, because it claims nothing — so requiring the published
  // artifact to FILL them would be a new publish requirement rather than a
  // refusal of a wrong claim, and that call is not this gate's to make. What is
  // refused below is a claim that is unlabelled, mislabelled or untrue.
  if (claims === 0 && !scope) return true;

  // Nothing to diff against ⇒ nothing may be claimed. Same call as the release
  // section's: a claim that could not have been derived is the shape that lies.
  if (!previousSurface || !previousVersion || !publishedSurface) {
    const missing = [
      previousSurface ? null : 'the previous tarball ships no api-surface snapshot',
      previousVersion ? null : 'the previous tarball ships no readable package.json',
      publishedSurface ? null : 'the artifact about to publish ships no api-surface snapshot',
    ].filter(Boolean);
    if (claims > 0 || scope) {
      problems.push(
        `aggregate: the record claims ${claimedAdded.length} added / ${claimedRemoved.length} removed ` +
          `export(s)${scope ? ' and a surfaceScope' : ''}, but ${missing.join(' and ')} — so no export ` +
          'diff could have been computed. A claim that could not be derived is exactly what this gate refuses.',
      );
      return false;
    }
    return true;
  }

  let ok = true;
  if (claims > 0 && !scope) {
    ok = false;
    problems.push(
      `aggregate.surfaceScope is absent while aggregate.added/removed carry ${claims} export(s). Those ` +
        `arrays are a ONE-RELEASE diff, so under the ${aggregate.from} → ${aggregate.to} record they read ` +
        `as the whole major-boundary delta. Expected { fromVersion: ${JSON.stringify(previousVersion)}, ` +
        `toVersion: ${JSON.stringify(publishedVersion)} }.`,
    );
  }
  if (scope) {
    if (scope.fromVersion !== previousVersion) {
      ok = false;
      problems.push(
        `aggregate.surfaceScope.fromVersion is ${JSON.stringify(scope.fromVersion)} but the previous tarball ` +
          `is ${JSON.stringify(previousVersion)} — the export diff was taken against a different release.`,
      );
    }
    if (scope.toVersion !== publishedVersion) {
      ok = false;
      problems.push(
        `aggregate.surfaceScope.toVersion is ${JSON.stringify(scope.toVersion)} but this artifact is ` +
          `${JSON.stringify(publishedVersion)} — the scope describes a release this tarball is not.`,
      );
    }
  }
  const actualAdded = [...publishedSurface].filter((n) => !previousSurface.has(n));
  const actualRemoved = [...previousSurface].filter((n) => !publishedSurface.has(n));
  ok = compareArray('aggregate.added', claimedAdded, actualAdded, problems) && ok;
  ok = compareArray('aggregate.removed', claimedRemoved, actualRemoved, problems) && ok;
  return ok;
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

  // Read once, used by both halves: the release section needs a previous
  // `spec-changes.json` and the aggregate's export claim does not, so the two
  // are checked against the same snapshots but gated on different inputs.
  const publishedSurface = readSurface(publishedDir);
  const aggregateCtx = {
    aggregate: publishedManifest.aggregate,
    previousSurface,
    previousVersion,
    publishedSurface,
    publishedVersion,
  };

  if (!computable) {
    // The one legitimate absence. Naming which input is missing keeps "we could
    // not compute it" distinguishable from "nothing changed".
    const missing = [
      previousSurface ? null : 'an api-surface snapshot',
      previousIds ? null : `a readable ${MANIFEST}`,
      previousVersion ? null : 'a readable package.json',
    ].filter(Boolean);
    if (section) {
      problems.push(
        `the artifact carries a release section, but the previous tarball ships ${missing.join(' and ')} — ` +
          'so no delta could have been computed from it. A section that could not be derived is exactly the ' +
          'wrong-data case this gate exists to refuse.',
      );
    }
    // The aggregate's export claim survives an absent previous `spec-changes.json`,
    // so it is still checked on the shape where no release section is owed.
    const aggregateOk = verifyAggregateSurface(aggregateCtx, problems);
    if (section || !aggregateOk) {
      problems.push(REGENERATE_HINT);
      return { ok: false, problems, summary: null };
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
  ok = compareArray('release.added', claimedAdded, actualAdded, problems) && ok;
  ok = compareArray('release.removed', claimedRemoved, actualRemoved, problems) && ok;

  // The aggregate record's own export claim, against the same two snapshots.
  ok = verifyAggregateSurface(aggregateCtx, problems) && ok;

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
        'release.converted',
        (section.converted ?? []).map((c) => c.conversionId),
        publishedIds.conversionIds.filter((id) => !priorConversions.has(id)),
        problems,
      ) && ok;
    ok =
      compareArray(
        'release.migrated',
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
        `${(section.converted ?? []).length} converted, ${(section.migrated ?? []).length} migrated. ` +
        aggregateSummary(publishedManifest.aggregate)
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
  'an unscoped EMPTY aggregate is the registry-only projection → GREEN': 1,
  'a scoped aggregate matching both tarballs → GREEN': 1,
  'R12 — a filled aggregate export diff with NO surfaceScope → RED': 1,
  'R13 — aggregate.surfaceScope.fromVersion naming another release → RED': 1,
  'R14 — aggregate.surfaceScope.toVersion disagreeing with the artifact → RED': 1,
  'R15 — an export the aggregate invents in added → RED, naming it': 1,
  'R16 — a real removal the scoped aggregate omits → RED, naming it': 1,
  'R17 — an aggregate export claim the previous tarball could not produce → RED': 1,
});
const SELF_TEST_BATTERY_FLOOR = 23;

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

function selfTest() {
  // `tmpdir()`, never a `/tmp` literal and never a `realpathSync` around one:
  // the scratch-dir sweep in `scripts/pm/dispatch-gates.mjs` resolves this base
  // statically to prove no gate writes its scratch tree INTO the repo, and a
  // base it cannot read is reported UNRESOLVED rather than assumed fine. A call
  // it does not model hides an in-tree scratch dir just as effectively as one
  // that really is in-tree. `tmpdir()` also honours TMPDIR/RUNNER_TEMP, which a
  // hardcoded `/tmp` does not.
  const tmp = fs.mkdtempSync(path.join(tmpdir(), 'release-spec-changes-selftest-'));
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
  const manifest = (extra = {}, aggregateExtra = {}) => ({
    protocolVersion: '17.0.0',
    supportFloor: 10,
    aggregate: {
      from: 10,
      to: 17,
      added: [],
      converted: [{ surface: 's', to: 't', conversionId: 'conv-old', toMajor: 17 }],
      migrated: [{ surface: 's', replacement: 'r', migrationId: 'mig-old', toMajor: 17, rationale: 'why' }],
      removed: [],
      ...aggregateExtra,
    },
    perMajor: [],
    ...extra,
  });
  /** The aggregate export claim that IS true of PREV → NEXT below. */
  const aggregateSurface = (extra = {}) => ({
    added: [{ surface: './ai: NewThing (const)', since: 17 }],
    removed: [{ surface: './ai: OldThing (const)', removedIn: 17 }],
    surfaceScope: { fromVersion: '17.3.0', toVersion: '17.4.0' },
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
  const NEXT = (releaseSection = release(), extra = {}, aggregateExtra = {}) => ({
    'package.json': { name: '@objectstack/spec', version: '17.4.0' },
    'api-surface/ai.json': shard('./ai', ['Kept (const)', 'NewThing (const)']),
    'spec-changes.json': manifest(releaseSection === null ? {} : { release: releaseSection }, aggregateExtra),
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

  // ── The aggregate record's own export claim (#18978) ──────────────────
  // The preserved-truth control comes FIRST: every battery above runs against
  // an aggregate with empty, unscoped arrays, so if this half refused that
  // shape they would all have gone red and the roster would read as a rewrite
  // of the gate rather than an addition to it.
  check(
    'an unscoped EMPTY aggregate is the registry-only projection → GREEN',
    { prev: PREV, next: NEXT() },
    true,
    'aggregate claims no export diff',
  );

  check(
    'a scoped aggregate matching both tarballs → GREEN',
    { prev: PREV, next: NEXT(release(), {}, aggregateSurface()) },
    true,
    'aggregate export diff 17.3.0 → 17.4.0 verified: 1 added, 1 removed',
  );

  check(
    'R12 — a filled aggregate export diff with NO surfaceScope → RED',
    { prev: PREV, next: NEXT(release(), {}, aggregateSurface({ surfaceScope: undefined })) },
    false,
    'aggregate.surfaceScope is absent',
  );

  check(
    'R13 — aggregate.surfaceScope.fromVersion naming another release → RED',
    {
      prev: PREV,
      next: NEXT(release(), {}, aggregateSurface({ surfaceScope: { fromVersion: '17.2.0', toVersion: '17.4.0' } })),
    },
    false,
    'taken against a different release',
  );

  check(
    'R14 — aggregate.surfaceScope.toVersion disagreeing with the artifact → RED',
    {
      prev: PREV,
      next: NEXT(release(), {}, aggregateSurface({ surfaceScope: { fromVersion: '17.3.0', toVersion: '17.9.0' } })),
    },
    false,
    'describes a release this tarball is not',
  );

  check(
    'R15 — an export the aggregate invents in added → RED, naming it',
    {
      prev: PREV,
      next: NEXT(
        release(),
        {},
        aggregateSurface({ added: [{ surface: './ai: Phantom (const)', since: 17 }] }),
      ),
    },
    false,
    './ai: Phantom (const)',
  );

  check(
    'R16 — a real removal the scoped aggregate omits → RED, naming it',
    { prev: PREV, next: NEXT(release(), {}, aggregateSurface({ removed: [] })) },
    false,
    './ai: OldThing (const)',
  );

  check(
    'R17 — an aggregate export claim the previous tarball could not produce → RED',
    {
      prev: { 'package.json': { name: '@objectstack/spec', version: '17.3.0' }, 'spec-changes.json': manifest() },
      next: NEXT(null, {}, aggregateSurface()),
    },
    false,
    'no export diff could have been computed',
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
    console.error(
      "✗ spec-changes.json's export claims disagree with the two tarballs (ADR-0087 D4) — the per-release " +
        'section, the aggregate record, or both. Each line below names which.',
    );
    console.error('  A wrong change file is worse than none — a consumer gates its upgrade on this data.\n');
    for (const line of verdict.problems) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`✓ ${verdict.summary}`);
}

// `verifyRelease` is exported so the self-test drives the same function the
// release lane calls. An exported module whose top level also DISPATCHES ends
// its importer's import instead — so the dispatch is behind the guard
// (`pnpm check:entry-guard`).
if (isEntrypoint(import.meta.url)) {
  main();
}
