#!/usr/bin/env node
/**
 * objectui#8924: prose in this tree states which `@objectstack/*` version is
 * INSTALLED, and nothing reads those sentences.
 *
 * ## Why a gate and not a sweep of corrected sentences
 *
 * objectui#8897 corrected SIX statements that said the pin **is 17.3.0**. It
 * found them with a probe that was version-literal on `17.3.0`, so it was blind
 * BY CONSTRUCTION to the identical sentence written about an earlier pin: the
 * `17.2.0` cohort was never in its field of view. Re-running by PREDICATE
 * rather than by version string, on `16fc4cf20`, finds 68 present-tense claim
 * sites in 55 files — 9 of them naming the pin correctly and 59 off it, spread
 * over 16 workspace packages and `scripts/`. The LEDGER below is that
 * population, entry by entry.
 *
 * That is the whole lesson, and it is a lesson about instruments, not about
 * sentences: a probe shaped like the example you already have cannot measure
 * the class it belongs to. A corrected version number with nothing checking it
 * regenerates the same card at the next bump — objectui#8606, #8629 and #8752
 * reached that conclusion from three other directions before this one did.
 *
 * So this file is the reader those sentences never had. It resolves the pin
 * from the ARTIFACT, recognises claims about the pin in prose, and fails when
 * the two disagree.
 *
 * ## The distinction this gate exists to preserve
 *
 * Two classes of sentence name a version, and only one of them can rot:
 *
 *   - **"when it changed"** — "17.3.0 made `reference` a hard requirement",
 *     "43 keys at 17.3.0", "New in `@objectstack/spec` 17.3.0". These are
 *     permanently true. A gate that "fixes" them rewrites history into a
 *     falsehood, and that is strictly worse than the stale claim it replaces.
 *   - **"what is installed"** — "Measured against the installed
 *     `@objectstack/spec` 17.2.0", "the pin is still 17.2.0". These are the
 *     subject, and they are false the moment the lockfile moves — or, since
 *     objectui#12957, the moment the pinned build's version string does.
 *
 * A bare version literal cannot tell them apart, which is why the predicate
 * below requires an installed-ness MARKER as well as a version, and why
 * `HISTORICAL_CUES` refuses lines that carry the marker inside a sentence about
 * the past. `scripts/__tests__/check-installed-spec-pin-claims.test.ts` pins
 * both directions on REAL lines of this tree, each with a firing control — a
 * refusal demonstrated only on lines where nothing could have fired is not a
 * demonstration of the distinction.
 *
 * ## What it promises, and what it does not
 *
 * PROMISED. Every recognised, present-tense claim about an installed
 * `@objectstack/*` version either names the version the artifact resolves to,
 * or carries a `LEDGER` entry with a class and a reason. The ledger ratchets in
 * BOTH directions: an entry naming a claim that is no longer in the tree fails
 * too, so cleaning a docblock forces the list to shrink and the list can never
 * rot into a permanent hole. (Same stance as `KNOWN_CLAIMS` in
 * `scripts/__tests__/doc-version-claims.test.ts` and `DOCUMENTATION_EXEMPT` in
 * `ci-cd-pipeline-doc.test.ts`.)
 *
 * NOT PROMISED, stated so it is not mistaken for covered:
 *
 *   - **The measured FACT beside the version.** "installed 17.2.0:
 *     `SelectOptionSchema` is `.strict()`" carries two claims; this gate judges
 *     the version and says nothing about the schema. That is why a ledger entry
 *     is not a licence to find-and-replace the number — each site has to be
 *     re-parsed against the resolved artifact before its stamp moves, or the
 *     repair plants a FRESH false premise. objectui#8897 did that re-parse for
 *     each of its six sites; it is the expensive half and it is deliberately
 *     not in this gate's remit.
 *   - **Claims split across lines.** Recognition is per line, because the
 *     marker and the version have to be read together and a docblock paragraph
 *     has no machine-visible boundary. A claim whose marker sits one line above
 *     its version is invisible here, and this tree has one:
 *     `packages/i18n/src/utils/spec-formatters.ts` ends a line with "The pinned"
 *     and opens the next with "17.0.0-rc.6 removed all four". That claim is as
 *     stale as any in the LEDGER and this gate cannot see it — recorded here
 *     rather than left for the next reader to discover as a silent hole.
 *   - **CHANGELOG and `.changeset/*.md`.** A pending changeset becomes a
 *     CHANGELOG entry verbatim, so both are DATED RECORDS of a change, not
 *     claims about today. Excluded by path, never by classification.
 *
 * ## Where it runs
 *
 * `scripts/__tests__/check-installed-spec-pin-claims.test.ts` runs it over the
 * real tree, so the ordinary vitest suite is the blocking copy — the same
 * placement `doc-version-claims.test.ts` has, and for the same reason: this
 * reads TEXT and a lockfile, needs no build and no network, so a dedicated
 * workflow would buy a second thing to keep wired and nothing else.
 * `pnpm check:installed-pin-claims` is the human entry point.
 *
 * Run:     node scripts/check-installed-spec-pin-claims.mjs
 *          node scripts/check-installed-spec-pin-claims.mjs --explain
 *          node scripts/check-installed-spec-pin-claims.mjs --json
 * Exit:    0 = OK, 1 = a claim drifted, or the ledger is stale
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The ONE entry-guard predicate; a hand-typed `process.argv[1]` comparison
// answers false through a symlink and the gate then does nothing, with exit 0
// and no output. `scripts/check-entry-guard.mjs` fails on the hand-typed form.
import { isEntrypoint } from './invoked-as.mjs';
import { lockfilePath } from './workspace-root.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// ── The anchor packages ──────────────────────────────────────────────────────
// The `@objectstack/*` line publishes in lockstep, and prose in this repo names
// two of them by version. `DEFAULT_ANCHOR` is what a claim that names no
// package at all ("the pin is still 17.2.0", "measured on the installed
// 17.2.0") is about: every such line in this tree, checked one by one when this
// gate was written, is about the spec.
export const ANCHOR_PACKAGES = [
  '@objectstack/spec',
  '@objectstack/client',
  '@objectstack/core',
  '@objectstack/formula',
];
export const DEFAULT_ANCHOR = '@objectstack/spec';

// ── The predicate ────────────────────────────────────────────────────────────

/**
 * A three-part version, optionally with a prerelease tail. The tail is part of
 * the token ON PURPOSE: `17.0.0-rc.6` is not `17.0.0`, and a regex that stops
 * at the patch digit turns eleven distinct rc claims in this tree into one.
 */
export const VERSION_TOKEN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/g;

/**
 * A version preceded by any of these is a RANGE, not a claim about what is
 * installed — `^17.2.0` is a declared floor and stays put across bumps. The
 * card's predicate excluded ranges for the same reason.
 */
const RANGE_PREFIX = /[~^=]$|[<>]=?$/;

/**
 * The installed-ness markers, verbatim from objectui#8924's predicate, each
 * word-bounded.
 *
 * ⭐ The boundaries are load-bearing, not tidiness. `/installed/` without them
 * matches inside `MarketplaceRowActions.installedAppsPins.test.tsx`, and the
 * line that identifier sits on is
 * `'EMPTY SPEC SHAPE. New in @objectstack/spec 17.3.0 …'` — a textbook
 * "when it changed" sentence naming an in-range version. An unbounded marker
 * puts it in the population, and "fixing" it would delete a true fact about
 * 17.3.0. That line is the refusal control in the test file.
 */
export const CLAIM_MARKERS = [
  { id: 'installed', re: /\binstalled\b/i },
  { id: 'repo-pin', re: /\bthis repo'?s pin\b/i },
  { id: 'pin-is', re: /\bthe pin (?:is|remains|resolves)\b/i },
  { id: 'pinned', re: /\bpinned\b/i },
  { id: 'at-that-pin', re: /\bat that pin\b/i },
];

/**
 * Lines carrying a marker INSIDE a sentence about the past. Each cue was read
 * off a real line of this tree; the citation is the line it was taken from, so
 * a future reader can check the cue still earns its place.
 *
 * A cue that fires wrongly costs a HOLE (a stale claim goes unreported), never
 * a false repair — this gate reports, it never rewrites. The ledger's
 * `historical` class is the other half: it catches the sentences whose pastness
 * no cue can see.
 */
export const HISTORICAL_CUES = [
  {
    id: 'then-pinned',
    re: /\bthen[-\s]pinned\b/i,
    cited: 'apps/console/src/__tests__/registry-inputs-spec-parity.test.ts — "the then-pinned 17.0.0-rc.6 declared none"',
  },
  {
    id: 'installed-then',
    re: /\binstalled then\b/i,
    cited: 'packages/app-shell/src/views/metadata-admin/inspectors/flow-node-config.inactiveRetained.test.ts — "Measured on the spec installed then: 17.2.0"',
  },
  {
    id: 'was-the-installed',
    re: /\bwas the installed\b/i,
    cited: 'apps/console/src/__tests__/registry-inputs-spec-parity.test.ts — "What held them was the installed contract"',
  },
  {
    id: 'marker-past-copula',
    re: /\b(?:pin|installed(?:\s+\w+){0,2}|version)\s+(?:was|were)\b/i,
    cited: 'packages/types/src/__tests__/validation-rule-spec-parity.test.ts — "installed spec was 17.0.0-rc.0"',
  },
  {
    id: 'used-to',
    re: /\bused to\b/i,
    cited: 'packages/plugin-designer/src/MetadataFieldsPage.specKeyReference.test.tsx — "The sentence that used to sit here said the installed pin WAS 17.3.0"',
  },
  {
    id: 'still-said',
    re: /\bstill said\b/i,
    cited: 'packages/app-shell/src/services/MetadataService.specKeyReference.test.ts — "docblock still said \\"this repo\'s pin is 17.3.0\\""',
  },
  {
    id: 'pinned-recording-sense',
    re: /\bpinned (?:in|by|below|above)\b/i,
    cited: 'packages/core/src/utils/__tests__/filter-date-comparand-8555.test.ts — "pinned in section 3" means RECORDED there, not dependency-pinned',
  },
  {
    id: 'until-version',
    re: /\bUntil\b/,
    cited: 'packages/types/src/__tests__/page-nav-misc-spec-parity.test.ts — "Until `@objectstack/spec` 17.2.0 this block pinned mutual assignability"',
  },
];

// ── Recognition ──────────────────────────────────────────────────────────────

/**
 * Which majors a version naming NO package may still be attributed to the
 * anchor on. See `attributePackage` case 3 for why this exists and what it is
 * protecting against; `run()` widens it with every major the LEDGER names, so a
 * major bump does not make the previous line's bare claims invisible on the day
 * it stops being able to see them.
 */
export const DEFAULT_BARE_MAJORS = ['17'];

/**
 * Words that may stand immediately before a version WITHOUT naming what the
 * version belongs to. Anything else in that position is read as a package name
 * — "React 19.2.8", "recharts 3.10.1", "lucide-react 1.31.0" — and the version
 * is not the anchor's.
 */
const CONNECTIVES = new Set([
  'a', 'against', 'an', 'and', 'artifact', 'as', 'at', 'both', 'by', 'carries', 'from', 'in', 'including',
  'installed', 'is', 'its', 'measured', 'now', 'of', 'on', 'only', 'or', 'pin', 'pinned', 'plus', 'reaches',
  'remains', 'repo', 'resolves', 'spec', 'still', 'that', 'the', 'this', 'through', 'to', 'today', 'tree',
  'until', 'version', 'was', 'with',
]);

/**
 * Which package a version token on this line is about.
 *
 * 1. ATTACHED (`@objectstack/client@17.2.0`) wins outright — including when it
 *    attaches to a package that is NOT an anchor (`zod@3.25.76`), which is how
 *    the gate declines to judge a claim about somebody else's pin.
 * 2. Otherwise, if the line names exactly one anchor package, it is that one.
 * 3. Otherwise the line names NO package — "Measured on the installed 17.2.0",
 *    "installed 17.2.0, `x_plugin_thing` is `unrecognized_keys`" — and those
 *    are real claim sites this gate must see. They are attributed to
 *    `DEFAULT_ANCHOR` only when BOTH guards hold:
 *      - the major is one the anchor line uses, and
 *      - the word immediately before it is not a package name.
 *    ⚠️ Both are needed and neither is redundant. This tree carries
 *    `Installed v1.0.0` (a marketplace UI string), `resolving to 1.7.3` (a
 *    better-auth pin) and `version: '1.4.2'` (an i18n fixture) — the first two
 *    are preceded by connectives and only the major guard declines them; and
 *    `pinned React 19.2.8` shares no major but is declined by the name guard
 *    the day React and the anchor line do share one.
 */
export function attributePackage(line, index, bareMajors = DEFAULT_BARE_MAJORS) {
  const before = line.slice(0, index);
  const attached = before.match(/(@?[a-z0-9][a-z0-9._/-]*)@$/i);
  if (attached) return ANCHOR_PACKAGES.includes(attached[1]) ? attached[1] : null;

  const named = [...new Set(ANCHOR_PACKAGES.filter((p) => line.includes(p)))];
  if (named.length === 1) return named[0];
  if (named.length > 1) return null;

  const major = line.slice(index).match(/^(\d+)\./)[1];
  if (!bareMajors.includes(major)) return null;
  const preceding = before.match(/([A-Za-z][A-Za-z0-9_.@/-]{0,40})\s+v?$/);
  if (preceding && !CONNECTIVES.has(preceding[1].toLowerCase())) return null;
  return DEFAULT_ANCHOR;
}

/**
 * Recognise the installed-pin claims on ONE line.
 *
 * @returns {{ verdict: 'none' | 'refused' | 'claim', refusedBy?: string,
 *             marker?: string, claims: Array<{ package: string, version: string }> }}
 */
export function recogniseLine(line, bareMajors = DEFAULT_BARE_MAJORS) {
  const marker = CLAIM_MARKERS.find((m) => m.re.test(line));
  if (!marker) return { verdict: 'none', claims: [] };

  const claims = [];
  const seen = new Set();
  VERSION_TOKEN.lastIndex = 0;
  let hit;
  while ((hit = VERSION_TOKEN.exec(line)) !== null) {
    if (RANGE_PREFIX.test(line.slice(0, hit.index))) continue;
    const pkg = attributePackage(line, hit.index, bareMajors);
    if (pkg === null) continue;
    const key = `${pkg}@${hit[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ package: pkg, version: hit[0] });
  }
  if (claims.length === 0) return { verdict: 'none', claims: [] };

  const cue = HISTORICAL_CUES.find((c) => c.re.test(line));
  if (cue) return { verdict: 'refused', refusedBy: cue.id, marker: marker.id, claims };

  return { verdict: 'claim', marker: marker.id, claims };
}

// ── The artifact: the pin read from two independent faces ────────────────────

/**
 * Face A — `pnpm-lock.yaml`. Every snapshot key for an anchor package.
 *
 * Read as TEXT, not parsed as YAML, because the shape being read is the KEY
 * spelling (`'@objectstack/spec@17.4.0(ai@7.0.65(zod@4.4.3))'`), and a YAML
 * load would hand back a peer-suffixed key that still has to be split the same
 * way. Two keys resolving one package at two versions is itself a finding.
 *
 * ⭐ Since objectui#12957 the lockfile names no `@objectstack/*` VERSION: every
 * one resolves to a directory of the build `.objectstack-sha` pins
 * (`'@objectstack/spec@file:.objectstack-pin/spec(ai@…)'`), and the
 * lockfile records that directory with no version. So this face FOLLOWS the
 * resolution: the version is the one the directory's manifest declares — the
 * packed `package.json` of the pinned commit. A directory that is not there (the
 * build was never made) answers `(pinned build absent: <dir>)`, which equals no
 * version and so turns into a CONFLICT naming it, never a silent empty face.
 *
 * ⚠️ What the version means changed with it: it is the version string the pinned
 * COMMIT carries, and objectstack moves that string only when it releases — so a
 * pin between two releases reads as the earlier release's number while carrying
 * later commits. A claim judged "at the pin" here is right about the number and
 * says nothing about which commit; the commit is `.objectstack-sha`.
 *
 * @param {string} lockText
 * @param {string} [root] what the lockfile's `file:` paths are relative to
 */
export function pinsFromLockfile(lockText, root = ROOT) {
  const found = new Map();
  const add = (pkg, version) => {
    if (!ANCHOR_PACKAGES.includes(pkg)) return;
    if (!found.has(pkg)) found.set(pkg, new Set());
    found.get(pkg).add(version);
  };
  for (const line of lockText.split('\n')) {
    const m = line.match(/^\s*'?(@objectstack\/[a-z-]+)@(\d[^'():\s]*)/);
    if (m) {
      add(m[1], m[2]);
      continue;
    }
    const dir = line.match(/^\s*'?(@objectstack\/[a-z-]+)@file:([^'():\s]+)/);
    if (dir) add(dir[1], versionOfDirectory(root, dir[2]));
  }
  return found;
}

/**
 * @param {string} root
 * @param {string} dir a lockfile `file:` path, relative to `root`
 * @returns {string}
 */
function versionOfDirectory(root, dir) {
  try {
    return JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).version;
  } catch {
    return `(pinned build absent: ${dir} — run \`pnpm objectstack:build\`)`;
  }
}

/**
 * Face B — the RESOLVED TREE. pnpm links a copy of each dependency into every
 * workspace package that declares it, so this reads what `import` would
 * actually load — the face a docblock saying "measured against the installed
 * artifact" is talking about.
 *
 * ⛔ Read only. Nothing under `node_modules` is written or moved here; those
 * entries are hardlinks into the pnpm store and mutating one corrupts every
 * other project sharing it.
 */
export function pinsFromResolvedTree(root, dirs) {
  const found = new Map();
  for (const dir of ['.', ...dirs]) {
    for (const pkg of ANCHOR_PACKAGES) {
      const manifest = join(root, dir, 'node_modules', pkg, 'package.json');
      if (!existsSync(manifest)) continue;
      const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
      if (!found.has(pkg)) found.set(pkg, new Set());
      found.get(pkg).add(version);
    }
  }
  return found;
}

/**
 * The two faces, reconciled. A package the faces disagree about has NO pin as
 * far as this gate is concerned — every claim about it becomes a finding,
 * rather than being judged against a number the gate had to pick a side on.
 */
export function reconcilePins(lockPins, treePins) {
  const pins = new Map();
  const conflicts = [];
  const unlinked = [];
  for (const pkg of ANCHOR_PACKAGES) {
    const lock = [...(lockPins.get(pkg) ?? [])].sort();
    const tree = [...(treePins.get(pkg) ?? [])].sort();
    if (lock.length === 0 && tree.length === 0) continue;
    // Present in the lockfile, linked into no workspace package: a TRANSITIVE
    // dependency. There is no installed artifact for prose to have been
    // measured against, so it gets no pin and no conflict — a claim naming it
    // becomes a finding in `judge`, which is the honest answer rather than
    // judging it against a number only one face can see.
    if (tree.length === 0) {
      unlinked.push({ package: pkg, lock });
      continue;
    }
    if (lock.length !== 1 || tree.length !== 1 || lock[0] !== tree[0]) {
      conflicts.push({ package: pkg, lock, tree });
      continue;
    }
    pins.set(pkg, lock[0]);
  }
  return { pins, conflicts, unlinked };
}

// ── The scan surface ─────────────────────────────────────────────────────────

/**
 * Paths this gate does not read, and why each is excluded BY PATH rather than
 * by classification — a path exclusion cannot be argued with later.
 */
export const SCAN_EXCLUSIONS = [
  { id: 'lockfile', test: (f) => f === 'pnpm-lock.yaml', why: 'the artifact itself, not a claim about it' },
  {
    id: 'changelog',
    test: (f) => /(^|\/)CHANGELOG[^/]*$/i.test(f),
    why: 'a dated record of a change, never a statement about today (objectui#8924)',
  },
  {
    id: 'changeset',
    test: (f) => f.startsWith('.changeset/'),
    why: 'a pending changeset becomes a CHANGELOG entry verbatim, so it is dated the same way',
  },
  {
    id: 'this-gate',
    test: (f) =>
      f === 'scripts/check-installed-spec-pin-claims.mjs' ||
      f === 'scripts/__tests__/check-installed-spec-pin-claims.test.ts',
    why: 'this gate quotes real claim sentences as examples and its test builds synthetic ones; a scanner reading its own fixtures reports itself',
  },
];

export function isScanned(file) {
  return !SCAN_EXCLUSIONS.some((x) => x.test(file));
}

// ── The ledger ───────────────────────────────────────────────────────────────

/**
 * Every recognised, present-tense claim in this tree naming a version the
 * artifact does NOT resolve to. One entry per (file, package, version), with
 * the number of sites in that file so a partial repair cannot hide.
 *
 * Classes:
 *
 *   - `stale` — a real installed-pin claim, false today. The backlog. ⚠️ An
 *     entry here is NOT a licence to restamp the number: the sentence carries a
 *     measured FACT as well as a version, and the fact has to be re-parsed
 *     against the resolved artifact first (see NOT PROMISED in the header).
 *   - `historical` — the predicate matched, but the version is not a statement
 *     about today: the sentence says WHEN something changed, records a
 *     measurement anchored to a named commit, names a release's record SET, or
 *     quotes a refusal message verbatim. ⛔ Permanently true; never restamp.
 *     These are exactly the sentences a version-literal sweep would rewrite
 *     into a falsehood, which is why the class exists at all rather than
 *     everything off the pin being called drift.
 *
 * Two classes and no more, deliberately. Every entry answers ONE question —
 * may the number be moved? — and a third class would be a place to put
 * sentences nobody decided about.
 *
 * The ledger ratchets both ways. Repair a site and the count falls, so the
 * entry must be edited or deleted in the same change; an entry naming a claim
 * no longer in the tree fails exactly as loudly as an unledgered claim.
 */
export const LEDGER_CLASSES = ['stale', 'historical'];

export const LEDGER = [
  {
    file: "apps/console/src/__tests__/registry-inputs-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "historical",
    why: "Past narrative of the objectui#5328 bump: \"while the installed 17.0.0 still carried both as live\". The version dates the state that ENDED, not today.",
  },
  {
    file: "apps/console/src/__tests__/registry-inputs-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0-rc.6",
    sites: 1,
    class: "stale",
    why: "\"the pinned 17.0.0-rc.6 does not carry at all\" \u2014 present tense about the pin, false today. Re-measure whether GA-added `object-*` blocks are in `ComponentPropsMap` at the resolved pin before restamping.",
  },
  {
    file: "apps/console/src/__tests__/registry-inputs-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.1.0",
    sites: 2,
    class: "historical",
    why: "Two lines, both about the release rather than the install: \":507\" asks whether the installed spec carries \"the 17.1.0 record set\" (the version names a record SET), and \":841\" names \"the 17.1.0 pin\" as the bump that DELIVERED the retirements. Neither restamps.",
  },
  {
    file: "apps/console/src/__tests__/registry-inputs-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.3.0",
    sites: 1,
    class: "stale",
    why: "\"MEASURED on the installed @objectstack/spec 17.3.0 artifact\" \u2014 re-parse `record:activity.types` against the resolved artifact before moving the stamp.",
  },
  {
    file: "apps/console/src/__tests__/registry-inputs-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.5.0",
    sites: 4,
    class: "historical",
    why: "Four lines about the release, not the install. Two ask whether the installed spec carries \"the 17.5.0 set\" / \"the loaded 17.5.0 blocks\" (the version names a record SET, as the 17.1.0 entry above does). Two are `pins` prose whose `pinned` is an unrelated verb (\"pinned narrowly\", \"pinned as THE RESIDUAL LEG\") beside a WHEN sentence (`allDayField` \"since `@objectstack/spec` 17.5.0\"; `redactFields` \"until `@objectstack/spec` 17.5.0 declared it\"). None restamps (objectui#11438).",
  },
  {
    file: "apps/console/src/__tests__/registry-inputs-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.6.0",
    sites: 1,
    class: "historical",
    why: "The `object-master-detail-form.details` pins prose: \"Since `@objectstack/spec` 17.6.0 (objectstack-ai/objectstack#21215) the spec row is an array of CLOSED entries\", the release the closed entry landed in, and \"a fork through 17.6.0, closed by `@objectstack/spec` 17.7.0\", the release that still declared `sortField`. `pinned` on that line is the verb in \"the pinned file\". Neither restamps (objectui#11717).",
  },
  {
    file: "apps/console/src/__tests__/registry-inputs-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.7.0",
    sites: 1,
    class: "historical",
    why: "The `object-master-detail-form.details` pins prose: \"a fork through 17.6.0, closed by `@objectstack/spec` 17.7.0, whose entry refuses an authored `sortField`\" names the release that CLOSED the fork (objectui#11717), not the install. The two `conditionalFormatting` lines that named 17.7.0 as the installed row were re-measured and restamped by objectui#12030.",
  },
  {
    file: "apps/console/src/components/FormPage.tsx",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "stale",
    why: "\"measured against the installed 17.0.0\" backs an `unrecognized_keys` claim about a form config; re-parse at the resolved pin first.",
  },
  {
    file: "packages/app-shell/src/services/MetadataService.objectPayloadFieldsMap.test.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"Measured on the installed 17.2.0\" stamps the fields-map shape the instrument below asserts.",
  },
  {
    file: "packages/app-shell/src/services/MetadataService.retiredFieldSortOrder.test.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "Stamps what the installed schema does with the retired `sortOrder` key.",
  },
  {
    file: "packages/app-shell/src/services/MetadataService.retiredObjectEnabled.test.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "Stamps the installed ESM build's handling of the retired `enabled` key.",
  },
  {
    file: "packages/app-shell/src/services/MetadataService.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 2,
    class: "stale",
    why: "Two sites in one docblock family, both stamping `unrecognized_keys` behaviour \"measured against the installed @objectstack/spec 17.2.0 (ESM build)\". Was three until objectui#8676: the third sat on the relationship-type list's docblock, which moved to `@object-ui/data-objectstack`'s `object-metadata-write-guard.ts` \u2014 and did NOT take the version stamp with it. The claim it stamped is now re-measured on every run by that module's derivation pin instead of recalled at a version, which is what this ledger wants of a citation rather than one more row.",
  },
  {
    file: "packages/app-shell/src/views/RecordDetailView.relatedListFilter-4664.test.tsx",
    package: "@objectstack/spec",
    version: "17.1.0",
    sites: 1,
    class: "historical",
    why: "\"ships from @objectstack/spec 17.1.0\" \u2014 the release the key landed in. Permanently true.",
  },
  {
    file: "packages/app-shell/src/views/RecordDetailView.relatedListFilter-4664.test.tsx",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"(this repo's pin resolves 17.2.0)\" on the same line as the historical 17.1.0 \u2014 the parenthesis is the stale half, the sentence around it is not.",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/PermissionMatrixEditor.retiredLifecycleKeys.test.tsx",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"installed @objectstack/spec (17.2.0, measured 2026-08-27) still ACCEPTS\" \u2014 the date does not anchor it; the subject is still the install.",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/SchemaForm.unresolvedPredicate.test.tsx",
    package: "@objectstack/spec",
    version: "17.0.0-rc.5",
    sites: 1,
    class: "stale",
    why: "Stamps the bare-spelling objectForm fields against \"installed spec 17.0.0-rc.5\".",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/anchors.validation-retired.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0-rc.6",
    sites: 1,
    class: "stale",
    why: "\"Re-measured here against the INSTALLED @objectstack/spec (17.0.0-rc.6)\" \u2014 the re-measurement has to happen again, not just its number.",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/form-spec.ts",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "stale",
    why: "Stamps an `unrecognized_keys` reading \"measured against the installed @objectstack/spec 17.0.0\".",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/inspectors/DashboardWidgetInspector.tsx",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "stale",
    why: "\"@objectstack/spec is pinned at 17.0.0, so a stored map is reachable\" \u2014 the reachability argument rests on the pin, so it is the pin that has to be re-read.",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/inspectors/DashboardWidgetInspector.tsx",
    package: "@objectstack/spec",
    version: "17.0.0-rc.5",
    sites: 1,
    class: "historical",
    why: "Same line, the other version: a verbatim quotation of the justification this code REPLACED \u2014 \"`I18nLabel` was plain `string` through 17.0.0-rc.5\". Quoting a retired justification is history.",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/inspectors/FlowNodeInspector.declaredDefault.test.tsx",
    package: "@objectstack/spec",
    version: "17.5.0",
    sites: 1,
    class: "historical",
    why: "\"the nine the installed spec applied; `@objectstack/spec` 17.5.0 began applying `screen.mode`'s\" says WHEN the tenth declaration returned (objectui#11073). The installed-spec reading on the same line has no version. Never restamp (objectui#11438).",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/inspectors/PageBlockInspector.sectionName.test.tsx",
    package: "@objectstack/spec",
    version: "17.0.0-rc.5",
    sites: 1,
    class: "stale",
    why: "\"the pinned @objectstack/spec@17.0.0-rc.5: `PageSchema.parse` does not ...\" \u2014 re-parse before restamping.",
  },
  {
    file: "packages/app-shell/src/views/metadata-admin/previews/ValidationPreview.tsx",
    package: "@objectstack/spec",
    version: "17.0.0-rc.6",
    sites: 1,
    class: "stale",
    why: "\"Measured against the installed @objectstack/spec 17.0.0-rc.6\" stamps a NAME-level reading.",
  },
  {
    file: "packages/app-shell/src/views/studio-design/navSurface.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "stale",
    why: "\"Measured against the installed @objectstack/spec 17.0.0\".",
  },
  {
    file: "packages/components/src/__tests__/record-picker-empty-text-i18n.test.tsx",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "stale",
    why: "\"the installed 17.0.0 GA still carries it \u2014 measured, not assumed\" \u2014 the carrying has to be re-measured at the resolved pin.",
  },
  {
    file: "packages/components/src/__tests__/text-input-inputs-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.1.0",
    sites: 1,
    class: "stale",
    why: "\"Measured on the installed 17.1.0 pin.\"",
  },
  {
    file: "packages/components/src/renderers/basic/__tests__/record-picker-label-placeholder-i18n.test.tsx",
    package: "@objectstack/spec",
    version: "17.1.0",
    sites: 1,
    class: "stale",
    why: "\"Measured on the installed pin (@objectstack/spec 17.1.0), all three members ...\"",
  },
  {
    file: "packages/core/src/utils/filter-tokens.ts",
    package: "@objectstack/spec",
    version: "17.0.0-rc.0",
    sites: 1,
    class: "stale",
    why: "\"the installed spec (17.0.0-rc.0) has exported it for some time\".",
  },
  {
    file: "packages/data-objectstack/src/metadata-client.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"installed spec (17.2.0) rather than assumed\" \u2014 stamps a `GetMetaItemLayeredResponseSchema` reading.",
  },
  {
    file: "packages/i18n/src/utils/spec-formatters.ts",
    package: "@objectstack/spec",
    version: "17.0.0-rc.5",
    sites: 1,
    class: "historical",
    why: "\"exported ... `LocaleConfigSchema` up to and including 17.0.0-rc.5\" \u2014 the release the four shapes survived to, permanently true. \u26a0\ufe0f The STALE claim in the same docblock is the next line down (\"The pinned\" / \"17.0.0-rc.6 removed all four\"), split across two lines and therefore outside this gate's reach; see the header's NOT PROMISED section.",
  },
  {
    file: "packages/layout/src/NavigationRenderer.tsx",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "stale",
    why: "\"The installed @objectstack/spec@17.0.0\" backs a claim about a surface that never had the action.",
  },
  {
    file: "packages/layout/src/ResponsiveGrid.tsx",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "A note that declares itself SELF-EXPIRING \u2014 \"Interim, and it self-expires: the pin is still @objectstack/spec 17.2.0\" \u2014 and the pin has since moved twice. Its substance (the symbol collision, and the ALLOW entry in check-spec-symbol-derivation.mjs that ratchet 3 will fail once it excuses nothing) is what decides whether the note goes or is restamped.",
  },
  {
    file: "packages/layout/src/__tests__/resolveHref.runAction.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "stale",
    why: "\"in the installed @objectstack/spec@17.0.0\".",
  },
  {
    file: "packages/plugin-calendar/src/ObjectCalendar.tsx",
    package: "@objectstack/spec",
    version: "17.3.0",
    sites: 1,
    class: "stale",
    why: "\"refuses `allDayField` BY NAME ... on the pinned 17.3.0 and on objectstack main\" \u2014 re-probe `CalendarConfigSchema` at the resolved pin.",
  },
  {
    file: "packages/plugin-designer/src/DashboardEditor.tsx",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "stale",
    why: "\"is pinned at 17.0.0, whose `I18nLabelSchema` is ...\" \u2014 the schema shape has to be re-read at the resolved pin.",
  },
  {
    file: "packages/plugin-designer/src/MetadataFieldsPage.fieldsMapKeying.test.tsx",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"Measured against the installed @objectstack/spec 17.2.0 and asserted in ...\"",
  },
  {
    file: "packages/plugin-designer/src/MetadataFieldsPage.specKeySystem.test.tsx",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "Stamps the installed schema's system-key reading.",
  },
  {
    file: "packages/plugin-designer/src/MetadataObjectsPage.lookupKeying.test.tsx",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "Stamps the installed schema's lookup keying.",
  },
  {
    file: "packages/plugin-designer/src/MetadataObjectsPage.specKeyGroup.test.tsx",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "Stamps the installed schema's key grouping.",
  },
  {
    file: "packages/plugin-detail/src/__tests__/recordDetailsInputs.spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0-rc.6",
    sites: 1,
    class: "stale",
    why: "\"the pinned 17.0.0-rc.6 strips\" \u2014 the verdict holds either way per the docblock, but the EVIDENCE named is the pin's, and it is the evidence that moved.",
  },
  {
    file: "packages/plugin-detail/src/__tests__/recordHighlightsInputs.spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0-rc.6",
    sites: 1,
    class: "stale",
    why: "\"the pinned 17.0.0-rc.6 still strips it silently\" \u2014 same shape as the sibling above.",
  },
  {
    file: "packages/plugin-detail/src/index.tsx",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "One site, \"measured on the installed pin, 17.2.0\" with a named control, on the `record:highlights` `readonly` refusal. It was TWO until objectui#8603: the `record:details` never-teach paragraph carried the same stamp for `hideEmpty`, and the restoration of that key rewrote the paragraph, which now points at the instrument that re-derives the set (`packages/plugin-detail/src/__tests__/recordDetailsInputs.spec-parity.test.ts`) instead of stamping a measurement. The count moving DOWN is this ledger ratcheting, not a hole.",
  },
  {
    file: "packages/plugin-form/src/sectionFields.spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 1,
    class: "historical",
    why: "\"`publicPicker` arrives in @objectstack/spec 17.0.0 GA\" \u2014 the arrival release. \u26a0\ufe0f The stale claim in the SAME docblock (\"this repo is pinned to `^17.0.0-rc.6`\") is a RANGE and therefore outside this gate's predicate by construction; it is recorded in objectui#8924 rather than silently covered here.",
  },
  {
    file: "packages/plugin-grid/src/__tests__/gridNavigationMembers-8071.test.tsx",
    package: "@objectstack/spec",
    version: "17.5.0",
    sites: 1,
    class: "historical",
    why: "\"the row that pinned this**: `@objectstack/spec` 17.5.0 retired `view.list.navigation.view`\" names the release that DID the retirement (objectui#9874); `pinned` is the row's verb, not a claim about the install. Never restamp (objectui#11438).",
  },
  {
    file: "packages/plugin-tree/src/ObjectTree.schemaTyped-8655.test.ts",
    package: "@objectstack/spec",
    version: "17.5.0",
    sites: 1,
    class: "historical",
    why: "\"Re-measured on the installed 17.5.0:\" sits under the dated heading \"UPDATE at `@objectstack/spec` 17.5.0 (objectui#11073)\" and records that bump's re-measurement; the rows below it re-derive the readings from the installed spec at run time. Never restamp (objectui#11438).",
  },
  {
    file: "packages/react/src/hooks/__tests__/offline-nav-performance-spec-parity.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0-rc.1",
    sites: 2,
    class: "historical",
    why: "Two lines narrating objectui#3159: what the old comments claimed \"against an installed spec of 17.0.0-rc.1\", and that the spec \"retired that name in 17.0.0-rc.1\". Both date the past.",
  },
  {
    file: "packages/test-support/src/spec-array-element.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"installed pin (@objectstack/spec@17.2.0), the element at all four converted ...\" \u2014 a published test-support helper whose docblock teaches the reading.",
  },
  {
    file: "packages/test-support/src/spec-enum-options.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"installed pin (@objectstack/spec@17.2.0, zod@4.4.3) it returns ...\" \u2014 two pins on one line; both are re-measurable.",
  },
  {
    file: "packages/test-support/src/spec-zod-wrappers.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"Measured against the installed pin (zod@4.4.3, @objectstack/spec@17.2.0)\" \u2014 the wrapper's whole contract is this measurement.",
  },
  {
    file: "packages/types/src/__tests__/chart-series-chart-type-alias-refusal-7694.test.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"Measured on the installed 17.2.0 that cut is 91 bytes\" \u2014 a byte count measured at a pin that moved twice.",
  },
  {
    file: "packages/types/src/__tests__/spec-derived-unions.test.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"the pin is still 17.2.0, which PRE-dates the ...\" \u2014 the whole sentence is an argument from the pin's age.",
  },
  {
    file: "packages/types/src/mobile.ts",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "The sibling of the `ResponsiveGrid.tsx` note above, same self-expiring wording, same expired-twice state.",
  },
  {
    file: "scripts/__tests__/doc-version-claims.test.ts",
    package: "@objectstack/spec",
    version: "17.0.0",
    sites: 2,
    class: "historical",
    why: "Two lines inside another gate's header, neither a claim about today: \":222\" narrates the objectui#5081 measurement that falsified a rule, and \":1046\" is a verbatim quotation of a tombstone's own refusal message (\"removed in @objectstack/spec 17.0.0\") kept verbatim on purpose.",
  },
  {
    file: "scripts/check-spec-range-floors.mjs",
    package: "@objectstack/spec",
    version: "17.2.0",
    sites: 1,
    class: "stale",
    why: "\"both of those answer from the INSTALLED tree, which is 17.2.0 here\" \u2014 the only claim in this population with NO schema fact attached, so re-measuring it is the two-face read this gate already performs.",
  },
  {
    file: "scripts/vite-objectstack-client-dist.ts",
    package: "@objectstack/client",
    version: "17.2.0",
    sites: 1,
    class: "historical",
    why: "Anchored to a named commit: \"Measured on `a100f77d3` (vite 8.2.1 + rolldown 1.2.3) with the override pointed at a copy of the installed @objectstack/client@17.2.0\". A measurement that names the tree it ran on is a record, not a claim about today.",
  },
  {
    file: "scripts/vite-objectstack-spec-dist.ts",
    package: "@objectstack/spec",
    version: "17.0.0-rc.6",
    sites: 1,
    class: "stale",
    why: "\"measured on the installed 17.0.0-rc.6: 18 exports entries, 17 of them reached by this repository's own imports, across 29 packages\" \u2014 three counts, all re-measurable against the resolved artifact.",
  },
  {
    file: "packages/plugin-grid/src/index.tsx",
    package: "@objectstack/spec",
    version: "17.6.0",
    sites: 1,
    class: "historical",
    why: "\"the row declares it since 17.6.0\" on the `keyboardNavigation` input's comment \u2014 the release `object-grid` gained the member; the line's `pinned` is the verb in \"is pinned there\". Permanently true (objectui#11717).",
  },
  {
    file: "scripts/check-eager-closure-budget.mjs",
    package: "@objectstack/spec",
    version: "18.0.0-next.0",
    sites: 1,
    class: "historical",
    why: "Anchored to a named commit: \"`5488ae7` is objectui#12030's branch commit: `main` at `cea429b` with `@objectstack/*` 18.0.0-next.0 resolved\" describes the tree the eager-closure baseline was measured on. A measurement that names its tree is a record, not a claim about today (objectui#12370).",
  },
  {
    file: "scripts/check-lockfile-integrity.mjs",
    package: "@objectstack/spec",
    version: "18.0.0-next.3",
    sites: 2,
    class: "historical",
    why: "Two lines of the gate's own `--self-test`, neither a claim about today: `@objectstack/spec@18.0.0-next.3` is a synthetic REGISTRY lockfile key the fixture sets beside the pinned build (`file:` directory) to show a registry copy is a duplication and a move onto the build is clean. The line's `pinned` is the build's name, and the fixture means a registry version that is NOT the pin, so it never restamps (objectui#12971).",
  },
];

// ── The run ──────────────────────────────────────────────────────────────────

/**
 * A NUL byte means the blob is binary, and `git grep -I` skips the same files.
 * Built from a char code rather than written as a literal: `check-control-bytes.mjs`
 * fails on a raw control byte in a source file, and a raw NUL would make this
 * file unsearchable to every tool that reads it afterwards.
 */
const NUL = String.fromCharCode(0);

export function workspaceDirs(root) {
  const out = [];
  for (const group of ['packages', 'apps', 'examples']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (existsSync(join(dir, entry, 'package.json'))) out.push(`${group}/${entry}`);
    }
  }
  return out;
}

export function collectClaims(root, files, bareMajors = DEFAULT_BARE_MAJORS) {
  const claims = [];
  for (const file of files) {
    if (!isScanned(file)) continue;
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (text.includes(NUL)) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const verdict = recogniseLine(lines[i], bareMajors);
      if (verdict.verdict !== 'claim') continue;
      for (const claim of verdict.claims) {
        claims.push({
          file,
          line: i + 1,
          package: claim.package,
          version: claim.version,
          marker: verdict.marker,
          text: lines[i].trim(),
        });
      }
    }
  }
  return claims;
}

const keyOf = (file, pkg, version) => [file, pkg, version].join('::');

/**
 * The verdict. `unledgered` is what fails; `atPin` is the LIVE half — the
 * claims that are true today and that go red the day the pin moves. That half
 * is the reason this exists instead of a corrected sentence.
 */
export function judge({ pins, conflicts, claims, ledger }) {
  const findings = [];
  const groups = new Map();
  for (const claim of claims) {
    const key = keyOf(claim.file, claim.package, claim.version);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(claim);
  }

  const atPin = [];
  const drift = new Map();
  for (const [key, members] of groups) {
    const { file, package: pkg, version } = members[0];
    if (conflicts.some((c) => c.package === pkg)) {
      findings.push(`${file}: claims ${pkg} ${version}, but the two faces of the pin disagree — nothing is judgeable until they do not`);
      continue;
    }
    const pin = pins.get(pkg);
    if (pin === undefined) {
      findings.push(`${file}: claims ${pkg} ${version}, but no pin for ${pkg} was resolvable from either face`);
      continue;
    }
    if (pin === version) atPin.push({ key, members });
    else drift.set(key, members);
  }

  const seen = new Set();
  for (const entry of ledger) {
    const key = keyOf(entry.file, entry.package, entry.version);
    if (seen.has(key)) findings.push(`LEDGER: duplicate entry for ${entry.file} ${entry.package} ${entry.version}`);
    seen.add(key);
    if (!LEDGER_CLASSES.includes(entry.class)) {
      findings.push(`LEDGER: ${entry.file} ${entry.version} has class ${JSON.stringify(entry.class)}; one of ${LEDGER_CLASSES.join(', ')} is required`);
    }
    if (typeof entry.why !== 'string' || entry.why.trim().length < 20) {
      findings.push(`LEDGER: ${entry.file} ${entry.version} has no usable reason. An entry without one is an unexplained hole.`);
    }
    const members = drift.get(key);
    if (!members) {
      // Two different situations wear the same shape, so name which one it is:
      // the site was repaired (delete the entry), or the RECOGNISER stopped
      // seeing it — which is what a major bump does to a bare claim that names
      // no package, and is the one case where deleting the entry would be
      // exactly wrong.
      const stillNamed = claims.some((c) => c.file === entry.file && c.version === entry.version);
      findings.push(
        `LEDGER is stale: ${entry.file} no longer carries a drifting ${entry.package} ${entry.version} claim` +
          (stillNamed
            ? ' under this package attribution, though the version literal is still recognised there. Re-check the attribution before deleting.'
            : '. Delete the entry in the same change that repaired the site.'),
      );
      continue;
    }
    if (members.length !== entry.sites) {
      findings.push(
        `LEDGER count is wrong: ${entry.file} ${entry.package} ${entry.version} — entry says ${entry.sites} site(s), ` +
          `the tree has ${members.length} (line${members.length === 1 ? '' : 's'} ${members.map((m) => m.line).join(', ')}).`,
      );
    }
    drift.delete(key);
  }

  for (const members of drift.values()) {
    const m = members[0];
    findings.push(
      `${m.file}:${members.map((x) => x.line).join(',')} claims ${m.package} ${m.version}, the artifact resolves ` +
        `${pins.get(m.package)}. Re-measure the fact this sentence states against the resolved artifact and restamp it, ` +
        'or add a LEDGER entry naming its class and why.',
    );
  }

  const byClass = {};
  for (const e of ledger) byClass[e.class] = (byClass[e.class] ?? 0) + (e.sites ?? 0);
  return { findings, atPin, ledgered: ledger.length, byClass, unledgered: [...drift.values()] };
}

/**
 * The majors a bare version may be attributed to the anchor on: the ones the
 * pin itself uses, plus every major the ledger already names. The second half
 * is what keeps a MAJOR bump from silently emptying this gate — the day the
 * line goes to 18, the 17.x claims the ledger is tracking stay visible instead
 * of falling out of the predicate, which is the exact failure objectui#8897's
 * version-literal probe had one minor at a time.
 */
export function bareMajorsFor(pins, ledger) {
  const majors = new Set();
  for (const v of pins.values()) majors.add(v.split('.')[0]);
  for (const e of ledger) majors.add(String(e.version).split('.')[0]);
  if (majors.size === 0) for (const m of DEFAULT_BARE_MAJORS) majors.add(m);
  return [...majors];
}

export function run(root = ROOT, ledger = LEDGER) {
  const files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
  const lockPins = pinsFromLockfile(readFileSync(lockfilePath(root), 'utf8'), root);
  const treePins = pinsFromResolvedTree(root, workspaceDirs(root));
  const { pins, conflicts, unlinked } = reconcilePins(lockPins, treePins);
  const bareMajors = bareMajorsFor(pins, ledger);
  const claims = collectClaims(root, files, bareMajors);
  return { pins, conflicts, unlinked, bareMajors, claims, ...judge({ pins, conflicts, claims, ledger }) };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (isEntrypoint(import.meta.url)) {
  const explain = process.argv.includes('--explain');
  const asJson = process.argv.includes('--json');
  const result = run();
  const failed = result.findings.length > 0 || result.conflicts.length > 0;

  if (asJson) {
    console.log(JSON.stringify(result, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v), 2));
    process.exit(failed ? 1 : 0);
  }

  console.log('Installed `@objectstack/*` pin claims (objectui#8924)');
  console.log('');
  for (const [pkg, version] of result.pins) {
    console.log(`  pin   ${pkg} = ${version}   (pnpm-lock.yaml AND the resolved tree agree)`);
  }
  for (const u of result.unlinked ?? []) {
    console.log(`  (transitive) ${u.package} = ${u.lock.join(', ')} in the lockfile, linked into no workspace package — no installed face, so no claim about it is judged`);
  }
  for (const c of result.conflicts) {
    console.log(`  CONFLICT ${c.package}: lockfile says [${c.lock.join(', ') || 'nothing'}], resolved tree says [${c.tree.join(', ') || 'nothing'}]`);
  }
  console.log('');
  const atPinCount = result.atPin.reduce((n, g) => n + g.members.length, 0);
  console.log(`  ${result.claims.length} recognised claim site(s) — ${atPinCount} at the pin, ${result.ledgered} ledger entr(ies)`);
  console.log(
    `  ledgered sites by class: ` +
      Object.entries(result.byClass)
        .sort()
        .map(([k, v]) => `${k} ${v}`)
        .join(', '),
  );

  if (explain) {
    console.log('');
    console.log('  AT THE PIN — true today, red the day it moves:');
    for (const g of result.atPin) {
      for (const m of g.members) console.log(`    ${m.file}:${m.line}  ${m.package} ${m.version}  [${m.marker}]`);
    }
    console.log('');
    console.log('  OFF THE PIN — ledgered or not:');
    for (const c of result.claims) {
      if (result.pins.get(c.package) === c.version) continue;
      console.log(`    ${c.file}:${c.line}  ${c.package} ${c.version}  [${c.marker}]  ${c.text.slice(0, 110)}`);
    }
  }

  if (result.findings.length > 0) {
    console.log('');
    for (const f of result.findings) console.log(`  FAIL ${f}`);
    console.log('');
    console.log(`FAIL: ${result.findings.length} finding(s). Run with --explain for the whole population.`);
    process.exit(1);
  }
  if (failed) process.exit(1);
  console.log('');
  console.log('OK');
}
