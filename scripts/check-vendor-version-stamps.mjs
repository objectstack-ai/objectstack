#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-vendor-version-stamps — hold every version stamp about a PINNED VENDOR
// to a shape that does not rot when the pin moves (#13940).
//
//   node scripts/check-vendor-version-stamps.mjs                # the gate
//   node scripts/check-vendor-version-stamps.mjs --list         # every stamp it can see
//   node scripts/check-vendor-version-stamps.mjs --census       # the drift census
//   node scripts/check-vendor-version-stamps.mjs --window-sweep # window sensitivity
//   node scripts/check-vendor-version-stamps.mjs --json
//   node scripts/check-vendor-version-stamps.mjs --self-test    # verify the checker
//
// ## The class, measured four times
//
// #10073 (29 stamps naming `1.7.0-rc.2` / `1.6.20` after the `^1.7.1` bump),
// #10188 (three more, outside that card's two-string scope), #11362 (two more,
// in platform-objects rather than plugin-auth) and #13940 (95, after the 1.7.2
// move) are one defect recurring. Each was closed by a hand sweep; each time the
// next card found more. The population went 29 -> 95, so the sweep is not
// converging on a remainder — it is trailing a PRODUCER.
//
// ## What the producer actually is
//
// Not "stamps name an old version". A stamp naming an old version can be
// perfectly true:
//
//     // [#11374] Bound from better-auth 1.7.1's own MySQL schema: ...
//
// That sentence is a fact about the release 1.7.1. It was true when written, it
// is true now, and it will still be true after 1.9.0 ships. Nothing rots.
//
// The producer is the OTHER shape — a sentence that fuses a permanent fact with
// a LIVE READING of a value that moves:
//
//     // still true of the installed stable `@better-auth/scim@1.7.1`
//
// "the installed" is a present-tense claim about this tree. The moment the pin
// moves it is not stale, it is FALSE: 1.7.1 is not installed. That is the class,
// and it is why a hand sweep keeps being the remedy — every bump falsifies every
// live-reading stamp at once, and nothing but a person reading them can tell.
//
// This is the same defect PR #13962 repaired one level up, in a docblock that
// froze a reading of `cases.length`: the fix there was to stop freezing a live
// value, not to write today's value in. Same remedy here.
//
// ## ⛔ Why this gate does NOT hold stamps equal to the pin
//
// The obvious mechanism — "every stamp must name the resolved pin" — was
// designed, measured against this repo's real corpus, and REJECTED. It
// manufactures false attestations, which are strictly worse than stale ones:
//
//   - A stamp is an ATTESTATION: it claims a behaviour was MEASURED against a
//     named version. Editing the version without redoing the measurement
//     produces a claim nobody ever made. A stale stamp tells the truth about
//     when it was checked; a restamped-but-unmeasured one lies about it.
//   - Measured on the #13940 corpus: 20 of the 95 stamps are anchored historical
//     facts of the `[#11374] Bound from better-auth 1.7.1's own MySQL schema`
//     shape. Forcing those to the pin would fabricate 20 measurements.
//   - One of the 95 is not an attestation at all. It is SELF-TEST FIXTURE DATA
//     inside `check-prerelease-pin-watch.mjs` — a synthetic npm registry payload
//     whose `1.7.1` is an arbitrary input proving the watcher notices a stable
//     release. A pin-equality sweep would corrupt a gate's own test input.
//
// So the rule is about PHRASING, not about version equality:
//
//   RED    a LIVE-READING stamp (it says "installed", "resolves to", "still
//          true", "today") that names a version which is not the resolved one,
//          and carries no date anchor scoping that present tense.
//   GREEN  an ANCHORED stamp — one carrying a measurement date or an issue
//          reference — naming ANY version. Permanently true, never swept again.
//
// The consequence is the point: once a stamp is anchored it is green at every
// future bump. The population that must be touched per bump falls from "every
// stamp naming the old version" (unbounded, growing 29 -> 95) to "stamps written
// as live readings" — which this gate holds at zero from the day it lands.
//
// The version-vs-pin comparison is still MEASURED and still REPORTED (`--census`,
// and a summary line on every run), because a bump author should be able to see
// the surface they are bumping under. It is deliberately ADVISORY: a failing
// drift check has exactly one remedy an author can apply in a hurry, and that
// remedy is the false attestation above.
//
// ## Why co-occurrence in a WINDOW, and not an adjacency regex
//
// #10188 recorded the shape that is not enough, verbatim: "a `better-auth@`-only
// comment-vs-pin gate would still miss stamps written as prose". Measured on
// this corpus, the specifier spelling is the MINORITY. Real stamps include
// `better-auth 1.7.1`, `` `better-auth@1.7.1` ``, `@better-auth/sso 1.7.1`,
// `better-auth (1.7.1)`, and — the ones no adjacency regex reaches at all —
// `stable 1.7.1 still peers @better-auth/utils 0.4.2` and `installed 1.7.1
// (measured 2026-08-19, #8224)`, where the version and the package name are
// separated by a clause or a line break.
//
// So a site is a version token with a watched family name WITHIN A WINDOW, the
// design `check-corpus-claim-drift.mjs` proved on the teaching corpus. The width
// is swept rather than guessed — `--window-sweep` prints the population at each
// width, and the header block below records today's reading.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// ── Configuration ───────────────────────────────────────────────────────────

/**
 * The vendor families whose version stamps this gate holds.
 *
 * A family is listed here when the repo makes MEASURED claims about it in prose
 * — that is what makes a stamp an attestation rather than a dependency range.
 * `packages` is every member the repo actually stamps; better-auth moves as ONE
 * line by `pnpm-workspace.yaml`'s standing rule, so a member missing from this
 * list is a member whose stamps go unread.
 */
export const WATCHED_FAMILIES = [
  {
    id: 'better-auth',
    packages: [
      'better-auth',
      '@better-auth/core',
      '@better-auth/sso',
      '@better-auth/scim',
      '@better-auth/oauth-provider',
      '@better-auth/drizzle-adapter',
      '@better-auth/kysely-adapter',
      '@better-auth/memory-adapter',
      '@better-auth/mongo-adapter',
      '@better-auth/prisma-adapter',
      '@better-auth/telemetry',
    ],
    // The member whose resolved version the family's stamps are read against.
    pinnedBy: 'better-auth',
  },
];

export const ROOTS = ['packages', 'scripts', 'apps', 'examples'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', '.objectstack']);
const EXTENSIONS = new Set(['.ts', '.mts', '.mjs', '.js', '.tsx']);

/**
 * Window, in lines, within which a family name and a version token count as one
 * stamp site. 4 matches `check-corpus-claim-drift.mjs`, and `--window-sweep`
 * reports today's sensitivity: widths 1..4 are stable on this corpus and the
 * count only creeps once the window starts reaching unrelated sentences.
 */
export const WINDOW = 4;

/**
 * Present-tense claims about THIS TREE. These are the half that rots: each
 * asserts something about the version installed right now, so it is false — not
 * merely stale — the moment the pin moves past the version it names.
 */
export const LIVE_READING_MARKERS = [
  'installed',
  'resolves to',
  'resolves today',
  'still true',
  'still peers',
  'is on',
  'currently',
  'today',
  'as it stands',
];

/**
 * Phrasings that SCOPE a present-tense word to the past, so the sentence carries
 * no claim about this tree any more.
 *
 * Having a vocabulary is the point. The cheapest honest repair for a rotting
 * stamp is almost never re-running the measurement — it is saying WHEN the
 * reading was taken. "the installed better-auth 1.7.1" rots at the next bump;
 * "the then-installed better-auth 1.7.1" is true for good, and neither sentence
 * claims anything the other does not about the behaviour itself.
 */
export const HISTORICAL_SCOPE_MARKERS = [
  'then-installed',
  'then installed',
  'at the time',
  'was installed',
  'was the installed',
  'not re-measured',
  'no longer the installed',
  'as of',
  'historical',
];

/**
 * What makes a stamp historical, and therefore permanent. A measurement date or
 * an issue reference says WHEN the reading was taken, which is exactly the
 * coordinate a frozen version number is missing.
 */
export const ANCHOR_PATTERN = /\b20\d\d-\d\d-\d\d\b|#\d{3,6}\b/;

/**
 * The declaration that a version here is SYNTHETIC INPUT, not an attestation.
 *
 * Gate self-tests build fake registry payloads and fake prose to drive their own
 * assertions; those numbers are arbitrary test data, and holding them to the
 * resolved pin would corrupt another gate's fixture. #13940 measured one such
 * site inside `check-prerelease-pin-watch.mjs` — its `1.7.1` proves the watcher
 * notices a stable release and means nothing about this tree.
 *
 * It is an INLINE declaration rather than a central exemption list on purpose: a
 * central list rots away from the thing it describes, while this sits on the
 * line it excuses and says why in the same breath.
 */
export const FIXTURE_MARKER = 'vendor-stamp:fixture';

const SEMVER = /(?<prefix>[\^~>=<]\s*)?\b(?<ver>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g;

/**
 * How far, in characters of flattened text, a package name may reach forward to
 * claim a version token. A name claims the FIRST unclaimed version after it and
 * then stops claiming — which is what keeps
 * `better-auth 1.7.1 behaves identically on 13.0.3 and on 12.11.1` from reading
 * 13.0.3 as a better-auth stamp. 60 spans a wrapped prose line; beyond that the
 * two tokens are no longer one sentence.
 */
export const CLAIM_GAP = 60;

// ── Pure analysis ───────────────────────────────────────────────────────────

/**
 * Read the resolved version of each watched family from `pnpm-lock.yaml`.
 *
 * Deliberately STATIC. Reading `node_modules` would make the gate depend on an
 * install, and a gate that cannot run without one is a gate that gets skipped;
 * the lockfile carries the same resolution and is checked in.
 *
 * @param {string} lockText contents of pnpm-lock.yaml
 * @param {string[]} packages package names to resolve
 * @returns {Map<string, string>} package name -> resolved version
 */
export function resolveInstalledVersions(lockText, packages) {
  const found = new Map();
  for (const pkg of packages) {
    // Snapshot keys look like `  better-auth@1.7.2:` / `  '@better-auth/core@1.7.2':`
    const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s+'?${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)'?:`, 'gm');
    const versions = new Set();
    for (const m of lockText.matchAll(re)) versions.add(m[1]);
    // EXACTLY ONE resolution, or none. A package present at two versions has no
    // single "installed version" for a stamp to be held against, and picking the
    // highest would invent one — `@better-auth/utils` really is in this tree at
    // both 0.4.2 and 0.5.0, so a stamp saying 0.4.2 is correct about one copy.
    // Ambiguity makes the stamp unjudgeable, which is a true answer; guessing
    // makes it a false red.
    if (versions.size === 1) found.set(pkg, [...versions][0]);
  }
  return found;
}

/**
 * Find every version-stamp site in one file.
 *
 * A site is a SEMVER token that has a watched family name within `window` lines.
 * Anchoring on the version rather than the package name is deliberate: the
 * version is the token that rots, and the stamps this class is about routinely
 * put the two on different lines.
 *
 * @param {string} text file contents
 * @param {{id: string, packages: string[]}} family
 * @param {{window?: number}} [opts]
 * @returns {Array<{line: number, version: string, text: string, window: string}>}
 */
export function findStampSites(text, family, opts = {}) {
  const window = opts.window ?? WINDOW;
  const lines = text.split('\n');

  // Offsets so a token's flat position maps back to a line number.
  const lineStart = [];
  let acc = 0;
  for (const l of lines) { lineStart.push(acc); acc += l.length + 1; }
  const lineOf = (pos) => {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };

  const flat = text;
  const low = flat.toLowerCase();

  // Package-name occurrences. Longest names first so `@better-auth/core` is not
  // shadowed by the `better-auth` substring inside it.
  const names = [...family.packages].sort((a, b) => b.length - a.length);
  const pkgTokens = [];
  const taken = new Array(flat.length).fill(false);
  for (const name of names) {
    const needle = name.toLowerCase();
    let from = 0;
    for (;;) {
      const at = low.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      if (taken[at]) continue;
      // The name must stand alone. Without this, the `better-auth` substring
      // inside `@better-auth/utils` claims that OTHER package's version — which
      // read `@better-auth/utils@0.4.2` as a better-auth stamp and reported it
      // drifted from 1.7.2. A stamp about a package the gate does not resolve
      // must stay unattributed, never get re-pointed at a sibling.
      const before = at > 0 ? flat[at - 1] : '';
      const after = flat[at + needle.length] ?? '';
      if (/[A-Za-z0-9@/-]/.test(before)) continue;
      if (/[A-Za-z0-9/-]/.test(after)) continue;
      for (let k = at; k < at + needle.length; k++) taken[k] = true;
      pkgTokens.push({ kind: 'pkg', pos: at, value: name });
    }
  }

  const verTokens = [];
  for (const m of flat.matchAll(SEMVER)) {
    // A RANGE (`^1.7.2`, `>=12.0.0`) is a dependency bound, not an attestation
    // that something was measured. Judging one against a resolved version is a
    // category error — `better-auth 1.7.1 peers ^12.0.0` stamps 1.7.1 only.
    if (m.groups.prefix) continue;
    verTokens.push({ kind: 'ver', pos: m.index + (m[0].length - m.groups.ver.length), value: m.groups.ver });
  }

  const stream = [...pkgTokens, ...verTokens].sort((a, b) => a.pos - b.pos);

  const mentionsFamily = lines.map((l) => {
    const ll = l.toLowerCase();
    return names.some((n) => ll.includes(n.toLowerCase()));
  });

  const sites = [];
  let armed = null; // the most recent package name that has not yet claimed a version
  for (const tok of stream) {
    if (tok.kind === 'pkg') { armed = tok; continue; }
    let pkg = null;
    if (armed && tok.pos - (armed.pos + armed.value.length) <= CLAIM_GAP) {
      pkg = armed.value;
      armed = null; // a name claims ONE version, then stops claiming
    }
    const i = lineOf(tok.pos);
    const lo = Math.max(0, i - window);
    const hi = Math.min(lines.length - 1, i + window);
    let near = false;
    for (let j = lo; j <= hi; j++) if (mentionsFamily[j]) { near = true; break; }
    if (!near) continue;
    sites.push({
      line: i + 1,
      version: tok.value,
      pkg,
      text: lines[i].trim(),
    });
  }
  return sites;
}

/**
 * Classify one site.
 *
 * `sentence` is the site's own line plus one on either side — tight on purpose.
 * A date three lines away does not scope a present-tense clause; a date in the
 * same wrapped sentence does, which is why `Measured 2026-08-20 against the
 * installed better-auth 1.7.1` is honest and permanent while `still true of the
 * installed stable @better-auth/scim@1.7.1` is not.
 *
 * @param {{line: number, version: string, window: string}} site
 * @param {string} text the whole file
 * @param {string|undefined} resolved the version installed today
 * @returns {{verdict: 'current'|'anchored'|'live-stale', live: boolean, anchored: boolean, drifted: boolean}}
 */
export function classifySite(site, text, resolvedFor) {
  const lines = text.split('\n');
  const i = site.line - 1;
  const sentence = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join(' ');
  const low = sentence.toLowerCase();
  // Scoping beats liveness: "the then-installed 1.7.1" contains the word
  // "installed" and yet claims nothing about this tree, so the scope check runs
  // first and disarms the live marker rather than fighting it.
  const scoped = HISTORICAL_SCOPE_MARKERS.some((m) => low.includes(m));
  const live = !scoped && LIVE_READING_MARKERS.some((m) => low.includes(m));
  const anchored = ANCHOR_PATTERN.test(sentence);

  // Synthetic test input, declared as such on the line it sits on.
  if (sentence.includes(FIXTURE_MARKER)) {
    return { verdict: 'fixture', live, anchored, drifted: false, resolved: undefined };
  }

  // No attributable package, or a package this gate does not resolve, means the
  // gate cannot say whether the number drifted. It is counted as a site and
  // reported, never judged — a gate that guessed here would red on
  // `better-auth 1.7.1 behaves identically on 13.0.3 and on 12.11.1`.
  const resolved = site.pkg ? resolvedFor(site.pkg) : undefined;
  if (!resolved) return { verdict: 'unattributed', live, anchored, drifted: false, resolved: undefined };

  const drifted = site.version !== resolved;
  if (!drifted) return { verdict: 'current', live, anchored, drifted, resolved };
  if (live && !anchored) return { verdict: 'live-stale', live, anchored, drifted, resolved };
  return { verdict: 'historical', live, anchored, drifted, resolved };
}

/** The author-facing remedy. Three honest options; restamping is never alone. */
export function liveStaleMessage(file, site, resolved) {
  return (
    `${file}:${site.line}: LIVE-READING stamp names ${site.version}, but the resolved version is ${resolved}.\n` +
    `    ${site.text}\n` +
    `    This sentence claims something about the version installed RIGHT NOW, so it is\n` +
    `    false — not merely stale — now that the pin has moved past ${site.version}.\n` +
    `    ⛔ Do NOT just rewrite ${site.version} to ${resolved}. A stamp attests that a behaviour was\n` +
    `    MEASURED against the version it names; changing the number without redoing the\n` +
    `    measurement manufactures a claim nobody made, which is worse than a stale one.\n` +
    `    Three honest fixes:\n` +
    `      (a) re-verify the behaviour against ${resolved}, then restamp AND date it;\n` +
    `      (b) keep ${site.version} and SCOPE the sentence to when it was true — the\n` +
    `          cheapest honest repair, and it re-measures nothing. Add the measurement\n` +
    `          date or the issue reference, or write "the then-installed ${site.version}"\n` +
    `          where it now says "the installed ${site.version}" (the shape PR #13962 landed\n` +
    `          for a frozen reading of a live value). Recognised scoping words:\n` +
    `          ${HISTORICAL_SCOPE_MARKERS.slice(0, 5).join(", ")};\n` +
    `      (c) drop the version from the live clause and point at the resolved pin instead.`
  );
}

export function censusLine(total, drifted, resolved, familyId) {
  return (
    `  ${familyId}: ${total} version stamp(s); resolved ${resolved}; ` +
    `${drifted} name(s) a different version (anchored, so reported not enforced).`
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────

function selfTest() {
  const failures = [];
  let ran = 0;
  const check = (name, ok, detail = '') => {
    ran++;
    if (!ok) failures.push(`${name}${detail ? `\n    ${detail}` : ''}`);
  };

  const family = { id: 'better-auth', packages: ['better-auth', '@better-auth/sso'] };

  // resolveInstalledVersions
  const lock = [
    'snapshots:',
    "  '@better-auth/core@1.7.2':",
    '  better-auth@1.7.2:',

    '  unrelated@3.0.0:',
  ].join('\n');
  const resolved = resolveInstalledVersions(lock, ['better-auth', '@better-auth/core', 'nope']);
  check('resolves a bare package name', resolved.get('better-auth') === '1.7.2', String(resolved.get('better-auth')));
  check('resolves a quoted scoped name', resolved.get('@better-auth/core') === '1.7.2', String(resolved.get('@better-auth/core')));
  check('an absent package resolves to nothing', !resolved.has('nope'));
  const ambiguous = resolveInstalledVersions(
    ["  '@better-auth/utils@0.4.2':", "  '@better-auth/utils@0.5.0':"].join('\n'),
    ['@better-auth/utils'],
  );
  check('a package present at TWO versions resolves to nothing, not to a guess',
    !ambiguous.has('@better-auth/utils'), JSON.stringify([...ambiguous]));

  // findStampSites — the prose spellings an adjacency regex loses
  const prose = '// better-auth 1.7.1 reads TEST directly\n';
  check('prose spelling is a site', findStampSites(prose, family).length === 1);

  const specifier = '// `@better-auth/sso@1.7.1` accepts a schema option\n';
  check('specifier spelling is a site', findStampSites(specifier, family).length === 1);

  const split = ['// stable 1.7.1 still peers', '// @better-auth/sso at 0.4.2'].join('\n');
  const splitSites = findStampSites(split, family);
  check('a version on a DIFFERENT line from the package name is a site', splitSites.length === 2, JSON.stringify(splitSites.map((s) => s.version)));

  const paren = '// vendor: better-auth (1.7.1) — byte-identical\n';
  check('parenthesised spelling is a site', findStampSites(paren, family).length === 1);

  const unrelated = '// lodash 4.17.21 is unrelated\n';
  check('a version with no family name nearby is NOT a site', findStampSites(unrelated, family).length === 0);

  const farAway = ['// better-auth notes', '', '', '', '', '// bumped semver 9.9.9'].join('\n');
  check('a version beyond the window is NOT a site', findStampSites(farAway, family, { window: 2 }).length === 0);
  check('...and IS one when the window reaches it', findStampSites(farAway, family, { window: 5 }).length === 1);

  // classifySite — the three verdicts
  const liveStale = '// still true of the installed stable `@better-auth/scim@1.7.1`';
  const R = (v) => () => v;
  let verdict = classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, liveStale, R('1.7.2'));
  check('an unanchored live reading naming a stale version is live-stale', verdict.verdict === 'live-stale', JSON.stringify(verdict));

  const datedLive = '// Measured 2026-08-20 against the installed better-auth 1.7.1, whose handler';
  verdict = classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, datedLive, R('1.7.2'));
  check('a DATE scopes the present tense — dated live reading is anchored', verdict.verdict === 'historical', JSON.stringify(verdict));

  const issueAnchored = "// [#11374] Bound from better-auth 1.7.1's own MySQL schema";
  verdict = classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, issueAnchored, R('1.7.2'));
  check('an issue reference anchors a stamp', verdict.verdict === 'historical', JSON.stringify(verdict));

  const historicalFact = "// better-auth 1.7.1's handler skips the delete";
  verdict = classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, historicalFact, R('1.7.2'));
  check('a bare fact about a named release is NOT live-stale', verdict.verdict === 'historical', JSON.stringify(verdict));

  const current = '// the installed better-auth 1.7.2 reads TEST directly';
  verdict = classifySite({ line: 1, version: '1.7.2', pkg: 'better-auth' }, current, R('1.7.2'));
  check('a stamp naming the resolved version is current', verdict.verdict === 'current', JSON.stringify(verdict));

  // The anchor must be in the SENTENCE, not merely in the file.
  const distantAnchor = ['// #11374 something else entirely', '//', '//', '//', '// the installed better-auth 1.7.1 does X'].join('\n');
  verdict = classifySite({ line: 5, version: '1.7.1', pkg: 'better-auth' }, distantAnchor, R('1.7.2'));
  check('an anchor four lines away does NOT scope a present-tense clause', verdict.verdict === 'live-stale', JSON.stringify(verdict));

  // ── Attribution: the half a naive gate gets wrong ────────────────────────
  const multi = '// better-auth 1.7.1 behaves identically on 13.0.3 and on 12.11.1.';
  const multiSites = findStampSites(multi, family);
  check('the package name claims the FIRST version only',
    multiSites.filter((x) => x.pkg === 'better-auth').map((x) => x.version).join(',') === '1.7.1',
    JSON.stringify(multiSites));
  check('later versions on the line are unattributed, not family stamps',
    multiSites.filter((x) => x.pkg === null).map((x) => x.version).join(',') === '13.0.3,12.11.1',
    JSON.stringify(multiSites));
  check('an unattributed version is never judged',
    classifySite({ line: 1, version: '13.0.3', pkg: null }, multi, R('1.7.2')).verdict === 'unattributed');

  const ranged = '// better-auth 1.7.1 peers `^12.0.0` while the tree resolves 13.x';
  check('a caret RANGE is not a stamp',
    findStampSites(ranged, family).every((x) => x.version !== '12.0.0'),
    JSON.stringify(findStampSites(ranged, family)));

  const scoped = '// `@better-auth/sso@1.7.1` and better-auth 1.7.2 differ';
  const scopedSites = findStampSites(scoped, family);
  check('the longest package name wins over its own substring',
    scopedSites.find((x) => x.version === '1.7.1')?.pkg === '@better-auth/sso',
    JSON.stringify(scopedSites));
  check('a second name claims its own version',
    scopedSites.find((x) => x.version === '1.7.2')?.pkg === 'better-auth',
    JSON.stringify(scopedSites));

  const sibling = '// `@better-auth/utils@0.4.2`, so this skew outlives that pin';
  check('a sibling package name is NOT claimed by the `better-auth` substring in it',
    findStampSites(sibling, family).every((x) => x.pkg === null),
    JSON.stringify(findStampSites(sibling, family)));

  const scopedLive = '// Measured on the then-installed better-auth 1.7.1, whose handler';
  check('"then-installed" scopes the present tense without needing a date',
    classifySite({ line: 1, version: '1.7.1', pkg: 'better-auth' }, scopedLive, R('1.7.2')).verdict === 'historical');
  check('...and the remedy teaches that vocabulary',
    liveStaleMessage('a.ts', { line: 1, version: '1.7.1', text: 'x' }, '1.7.2').includes('then-installed'));

  const fixture = `// ${FIXTURE_MARKER} — synthetic registry payload\n// the installed better-auth 1.7.1 does X`;
  check('a declared fixture is not judged',
    classifySite({ line: 2, version: '1.7.1', pkg: 'better-auth' }, fixture, R('1.7.2')).verdict === 'fixture');

  // The remedy must never present restamping as the lone fix.
  const msg = liveStaleMessage('a.ts', { line: 3, version: '1.7.1', text: 'x' }, '1.7.2');
  check('remedy refuses a blind restamp', msg.includes('⛔ Do NOT just rewrite'), msg);
  check('remedy offers re-verification', /re-verify the behaviour/.test(msg));
  check('remedy offers the historical shape', /SCOPE the sentence to when it was true/.test(msg));
  check('remedy offers the live-pointer shape', /point at the resolved pin/.test(msg));
  check('remedy names why restamping is worse', /manufactures a claim nobody made/.test(msg));

  // The gate offers no ratchet, ledger or baseline — nothing to weaken.
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  check(
    'this gate offers no baseline/ledger expansion remedy',
    !/add (?:it|the file|this) to\s+\S*(?:baseline|ledger)/i.test(src),
  );

  if (failures.length > 0) {
    console.error(`\ncheck-vendor-version-stamps --self-test: ${failures.length} failure(s).\n`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  // A COUNT, read from the run — never a literal. Freezing a reading of a live
  // value is the exact defect this gate exists to stop, and a self-test summary
  // that carries one would be the gate committing it in its own voice.
  console.log(`check-vendor-version-stamps --self-test: ${ran} checks pass.`);
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

// ── Main ────────────────────────────────────────────────────────────────────

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, out);
    } else if (EXTENSIONS.has(p.slice(p.lastIndexOf('.')))) {
      out.push(p);
    }
  }
  return out;
}

const listMode = process.argv.includes('--list');
const censusMode = process.argv.includes('--census');
const jsonMode = process.argv.includes('--json');
const sweepMode = process.argv.includes('--window-sweep');

const lockPath = join(REPO_ROOT, 'pnpm-lock.yaml');
if (!existsSync(lockPath)) {
  console.error('check:vendor-version-stamps: pnpm-lock.yaml not found — cannot resolve any pin.');
  process.exit(1);
}
const lockText = readFileSync(lockPath, 'utf8');

const files = [];
for (const root of ROOTS) {
  const abs = join(REPO_ROOT, root);
  if (existsSync(abs) && statSync(abs).isDirectory()) walk(abs, files);
}
files.sort();

const SELF = join(REPO_ROOT, 'scripts', 'check-vendor-version-stamps.mjs');

const errors = [];
const report = [];
let scanned = 0;

for (const family of WATCHED_FAMILIES) {
  const resolvedMap = resolveInstalledVersions(lockText, family.packages);
  const resolved = resolvedMap.get(family.pinnedBy);
  if (!resolved) {
    console.error(
      `check:vendor-version-stamps: family "${family.id}" resolves to nothing in pnpm-lock.yaml.\n` +
      `    Its pinnedBy member is "${family.pinnedBy}". Either the family left the tree — in which\n` +
      `    case remove it from WATCHED_FAMILIES — or the member was renamed.`,
    );
    process.exit(1);
  }

  const sites = [];
  for (const file of files) {
    if (file === SELF) continue;
    const text = readFileSync(file, 'utf8');
    scanned++;
    for (const site of findStampSites(text, family, { window: WINDOW })) {
      const verdict = classifySite(site, text, (pkg) => resolvedMap.get(pkg));
      const rel = relative(REPO_ROOT, file).split(sep).join('/');
      sites.push({ file: rel, ...site, ...verdict, window: undefined });
    }
  }

  if (sweepMode) {
    console.log(`\nwindow sweep — ${family.id}`);
    for (const w of [1, 2, 3, 4, 6, 8, 12, 20]) {
      let n = 0;
      for (const file of files) {
        if (file === SELF) continue;
        n += findStampSites(readFileSync(file, 'utf8'), family, { window: w }).length;
      }
      console.log(`  window ${String(w).padStart(2)}: ${n} site(s)`);
    }
    continue;
  }

  const drifted = sites.filter((s) => s.drifted);
  const liveStale = sites.filter((s) => s.verdict === 'live-stale');
  report.push({ family: family.id, resolved, total: sites.length, drifted: drifted.length, liveStale: liveStale.length, sites });

  for (const s of liveStale) errors.push(liveStaleMessage(s.file, s, s.resolved));

  if (listMode || censusMode) {
    console.log(`\n${family.id} — resolved ${resolved}`);
    const shown = censusMode ? drifted : sites;
    for (const s of shown) {
      console.log(`  [${s.verdict.padEnd(12)}] ${s.file}:${s.line}  ${s.pkg ?? '(unattributed)'}@${s.version}  ${s.text.slice(0, 88)}`);
    }
  }
}

if (sweepMode) process.exit(0);

if (jsonMode) {
  // `process.exitCode`, never `process.exit()`. stdout to a PIPE is async, so
  // exiting immediately after a large write truncates it — measured here: the
  // JSON came back cut mid-string at ~65KB through a pipe while the identical
  // run redirected to a file was complete. A gate whose machine-readable output
  // is silently short under exactly the usage that consumes it is worse than one
  // with no JSON mode at all.
  console.log(JSON.stringify({ scanned, report }, null, 2));
  process.exitCode = errors.length > 0 ? 1 : 0;
}

if (jsonMode) {
  // nothing further to print; the JSON above is the whole report
} else if (errors.length > 0) {
  console.error(`\ncheck:vendor-version-stamps: ${errors.length} live-reading stamp(s) name a version that is not installed.\n`);
  for (const e of errors) console.error(`  ✗ ${e}\n`);
  process.exitCode = 1;
} else {
  console.log(`check:vendor-version-stamps: OK — ${scanned} file(s) scanned.`);
  for (const r of report) console.log(censusLine(r.total, r.drifted, r.resolved, r.family));
  console.log(
  '  Drifted stamps are ANCHORED (they carry a measurement date or an issue reference), so they\n' +
  '  are reported and not enforced: restamping them without re-measuring would manufacture\n' +
    '  attestations. Re-verify one and you may restamp it; otherwise it stays a historical fact.',
  );
}
