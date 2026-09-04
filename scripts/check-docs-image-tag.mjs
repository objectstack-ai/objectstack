#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-docs-image-tag (#9018) -- every CONCRETE version a doc surface pins for
// the runtime image or the CLI must equal `packages/cli/package.json`'s version.
//
//   node scripts/check-docs-image-tag.mjs
//   node scripts/check-docs-image-tag.mjs --self-test   # verify the checker itself
//
// ## Why a gate rather than a third hand-fix
//
// The same defect -- an example image tag several majors behind the shipped CLI
// -- was found and repaired TWICE, independently, by two authors who did not
// know about each other's occurrence:
//
//   - `content/docs/deployment/self-hosting.mdx`  (#8911, repaired by PR #8960)
//   - `docker/README.md`                          (#8961, repaired by PR #9016)
//
// Both cards named the same conclusion in their own words: two occurrences of an
// identical drift is where a mechanical guard beats fixing the third one by hand.
// The drift is silent by construction -- a stale tag is valid Markdown, valid
// Docker syntax, and pulls a real (old) image, so nothing downstream complains.
// A reader following the docs deploys the wrong major and finds out at boot.
//
// ## What is asserted
//
// Three ANCHORED patterns (see PATTERNS), scanned over an EXPLICIT list of doc
// surfaces (see SURFACES). Every occurrence whose tag is a CONCRETE version must
// equal `packages/cli`'s version; mismatches are reported as `file:line` with
// found vs. expected.
//
// ## Why the surfaces are enumerated and not globbed
//
// #9018 asks for this directly, and it is the difference between a gate and a
// nuisance: `content/docs/**` is full of version-shaped strings that MUST NOT
// track the CLI version. The reference pages alone carry 92 sentences of the
// form "removed in @objectstack/spec 17.0.0" -- re-measured at #10229, where the
// "~30" this paragraph used to say was found to be well out of date, and the
// direction of that error is the reassuring one: the hazard grew, the argument
// for enumerating did not weaken. (95 across all of `content/docs/**`, in 22
// files.) They are historical facts about the
// release something was retired in, which stay true forever and would go red on
// the next bump under any glob-plus-version-shape rule. `packages/cli/CHANGELOG.md`
// is the same hazard at scale. An explicit list is re-readable, and its cost --
// a new surface is unguarded until someone adds it -- is bounded by the
// NO-OCCURRENCES rule below, which keeps the list from rotting into a no-op.
//
// ## Why the patterns are ANCHORED and not version-shaped
//
// The false positive #9018 names is real and lives in the corpus today:
// `docker/README.md`'s own tag table documents the tag SCHEME in prose --
//
//     | `X.Y.Z` | Exact release — **pin this in production** |
//     | `X.Y`, `X` | Rolling minor / major |
//     | `latest` | Latest release — quick starts only |
//
// -- so `X.Y.Z` there is a metavariable, not a version. Two independent layers
// keep it out, and the self-test asserts BOTH rather than reasoning about them:
//
//   1. ANCHORING. A match must be preceded by the literal `ghcr.io/objectstack-ai/
//      objectstack:`, `OS_CLI_VERSION=` or `@objectstack/cli@`. The tag-table rows
//      carry none of these, so the scanner never even sees them.
//   2. CONCRETENESS. Of the tags the anchors DO capture, only those opening with
//      three dot-separated INTEGER groups are compared. `X.Y.Z` fails on the very
//      first character; so do `latest`, the rolling `17.0` / `17`, and the
//      `<version>` metavariable used in `docker/Dockerfile`'s header comments.
//
// Concreteness is deliberately a PREFIX test (`^\d+\.\d+\.\d+`) and not a strict
// semver match, because the two ways a pin goes subtly wrong both have to be
// caught, and a stricter pattern would classify them as "not a version" and skip
// them in silence -- a hole in the shape of the bug:
//
//   - `17.0.0-beta.1` when the CLI is at `17.0.0`. A checker matching only the
//     three-integer prefix and comparing THAT would read `17.0.0`, find it equal,
//     and pass a docs page pinning a prerelease image. The whole tag token is
//     captured and compared, so this is red.
//   - `17.0.0.0`, a typo. Strict semver says "not a version" -> skipped; the
//     prefix test says concrete -> compared -> red.
//
// ## Why a surface with NO occurrences is a FAILURE, not a pass
//
// The enumeration is the gate's entire scope, so an entry that stops matching is
// the gate quietly getting smaller -- the vacuous-green failure mode (#4690). If
// a doc is rewritten and its pinned example disappears or is re-spelled, this
// gate would keep reporting OK over a surface it no longer checks, and the next
// drift lands unseen exactly where the last two did. So each enumerated surface
// must yield at least one concrete occurrence. The remedy when a doc legitimately
// stops pinning a version is to delete its SURFACES entry in the same change,
// which is a one-line edit that leaves the shrinkage in the diff where a reviewer
// sees it.
//
// ## Why PROSE claims get their own limb (#10229)
//
// The pin limb above asserts one thing precisely: the ANCHORED pins agree with
// `packages/cli`. The 17.1.0 publish -- the first minor bump since this gate
// landed -- proved that is NOT the same statement as "the docs agree with
// `packages/cli`", and the gap is not small. `sync-docs-image-tags.mjs` moved all
// eight anchored pins to 17.1.0 and this gate reported OK, while FIVE prose claims
// in three files still said 17.0.0:
//
//   content/docs/deployment/self-hosting.mdx  the tag-scheme sentence
//   content/docs/deployment/index.mdx         the tag-scheme sentence + the "Versioned by" cell
//   content/docs/upgrading.mdx                the tag-scheme sentence + the "Versioned by" cell
//
// One of them was not merely stale but FALSE: it said the rolling `17.0` / `17` /
// `latest` tags "move with every stable publish", which stopped being true the
// moment 17.1.0 shipped and froze `17.0`. A reader pinning `17.0` on the strength
// of that sentence gets 17.0.0 forever, silently -- the exact failure #9018 filed
// this gate to prevent, arriving through the door the gate does not cover.
//
// ## Why the fix is METAVARIABLES, not a second thing to keep current
//
// #10229 suggests a rule keyed on "a version literal in the same file as an
// anchored pin, disagreeing with it". That is not what landed, for two measured
// reasons and one structural one.
//
// The two false positives it has in the corpus TODAY -- both in files that DO
// carry anchored pins, which is precisely the case the card assumed was safe:
//
//   - `content/docs/upgrading.mdx`'s upgrade-checklist table, seven rows of
//     `v17.0.0` ... `v9.0.0`. Historical facts, in the same file as line 41's pin.
//   - `content/docs/deployment/self-hosting.mdx`'s `hotcrm-2.2.2.json` artifact
//     URL, and `content/docs/deployment/index.mdx`'s `com.acme.crm@1.2.0`. Those
//     are the READER's app version, which by construction never tracks ours.
//
// The structural reason is worse than the false positives: a rule demanding prose
// literals TRACK the CLI version makes every publish turn this gate red on prose,
// and `sync-docs-image-tags.mjs` cannot fix prose -- its rewrite is safe only
// because a PATTERN match ends with its tag (see that file's header), which a
// sentence does not. That is a standing hand-fix obligation at every release, i.e.
// the drift this card is about, rescheduled rather than removed.
//
// So the prose is spelled with METAVARIABLES instead -- `X.Y.Z`, `X.Y`, `X`,
// `latest` -- which is the spelling `docker/README.md`'s tag table has used all
// along, and which is the one tag-scheme surface in this corpus that has never
// drifted. This limb then asserts the ABSENCE of a concrete version in the
// enumerated claims, so it creates NO release-time obligation: a publish cannot
// redden it, only an author reintroducing a literal can.
//
// ## What this limb does NOT catch, stated so the green can be read
//
// It catches the STALENESS class (a concrete version in a claim that should be
// generic). It cannot catch the FALSEHOOD class: `17.0` and `17` are not concrete
// versions, and "move with every stable publish" is wrong for reasons no version
// comparison reaches. Making the sentence generic removes the temptation to write
// that sentence -- it is not a proof that nobody will.
//
// Enumeration and anchoring are preserved exactly as above: PROSE_CLAIMS names
// (file, anchor) pairs one at a time, and a claim whose anchor stops matching is a
// FAILURE (PROSE-ANCHOR-LOST), for the same anti-vacuity reason NO-OCCURRENCES is.
// The 92 "removed in @objectstack/spec 17.0.0" sentences are untouched: they are
// in neither an enumerated file nor an anchored claim. Nor are the two shapes that
// DO live inside enumerated files -- the upgrade-checklist rows and the reader's
// own app version -- both of which have controls in --self-test.
//
// ## The release-time obligation this gate creates
//
// Pinning docs to `packages/cli`'s version means THE NEXT VERSION BUMP TURNS THIS
// GATE RED until the doc surfaces move in the same change. That is the intended
// behaviour -- it is the mechanism, not a side effect, and #9018 forbids softening
// it -- but it is a standing obligation on the release process, not a free check.
// `pnpm check:docs-image-tag` names every `file:line` and the expected value, so
// the remedy is mechanical.
//
// ## Why this file is dependency-free
//
// Same reason `check-adr-links.mjs` and `check-docs-redirects.mjs` are: an author
// must be able to run it in any container with `node scripts/check-docs-image-tag.mjs`,
// with no workspace install and no network. Reading three text files and one
// `package.json` is the whole check.
//
// ## Why a --self-test carries the weight here (#9018 dispatch)
//
// BOTH surfaces the card names were repaired within the last day, so the live
// corpus is guaranteed green -- and a green run cannot distinguish a working gate
// from one that matches nothing. Every limb therefore has a positive control in
// `--self-test` over a temp fixture that runs the REAL `checkSurfaces()` the way
// `main()` does, paired with a clean fixture asserting ZERO findings so an
// over-eager gate fails just as loudly as a blind one. The `X.Y.Z` false positive
// gets a control on both sides: in the hermetic fixture, and against the real
// `docker/README.md` (LIVE_CONTROL below), because the assertion worth having is
// that the metavariable is excluded from the corpus it actually lives in.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * The package whose `version` every concrete pin below must equal.
 *
 * Exported for the same reason SURFACES and PATTERNS are (#9064): the version-time
 * rewriter `sync-docs-image-tags.mjs` must resolve the SAME source of truth this gate
 * compares against. A second literal in the rewriter would be a second contract, and
 * the two drifting apart reproduces one layer up the very defect this gate exists for.
 */
export const VERSION_SOURCE = 'packages/cli/package.json';

/**
 * The doc surfaces scanned, enumerated explicitly (#9018).
 *
 * Adding one is the whole onboarding step. Removing one is a deliberate act that
 * shrinks this gate -- say why in the PR, because the NO-OCCURRENCES rule means
 * the only honest reason is that the surface genuinely stopped pinning a version.
 */
export const SURFACES = [
  {
    file: 'docker/README.md',
    why: "the runtime image's own README -- the `FROM` example, the `docker run` example, and the local-build `--build-arg`. Drifted in #8961, repaired by PR #9016.",
  },
  {
    file: 'content/docs/deployment/self-hosting.mdx',
    why: 'the self-hosting walkthrough -- two `docker run` examples, the extend-the-image Dockerfile, and the self-built-runtime `npm install -g` pin. Drifted in #8911, repaired by PR #8960.',
  },
  {
    file: 'content/docs/upgrading.mdx',
    why: 'the upgrade guide\'s "Moving the tag" example. NOT named by #9018 -- found by re-measuring the corpus while implementing it, and the same class exactly: a literal pinned image tag a reader copies into an orchestrator manifest.',
  },
];

/**
 * The anchored patterns. Each capture group is a TAG TOKEN, classified afterwards.
 *
 * The character class is the Docker tag / npm version charset, and it is what
 * stops a capture from swallowing trailing prose. It deliberately excludes `$`
 * and `{`, so a shell or Actions interpolation (`@objectstack/cli@${OS_CLI_VERSION}`,
 * `OS_CLI_VERSION=${{ steps.version.outputs.version }}`) produces no match at all
 * rather than a nonsense tag -- those are the correct way to spell a pin that
 * tracks something, and nothing here should nag about them.
 */
export const PATTERNS = [
  {
    name: 'image-tag',
    regex: /ghcr\.io\/objectstack-ai\/objectstack:([A-Za-z0-9_][A-Za-z0-9_.+-]*)/g,
    describe: 'the official runtime image tag',
  },
  {
    name: 'build-arg',
    regex: /OS_CLI_VERSION=([A-Za-z0-9_][A-Za-z0-9_.+-]*)/g,
    describe: "the docker/ build arg pinning the CLI installed into the image",
  },
  {
    name: 'npm-pin',
    regex: /@objectstack\/cli@([A-Za-z0-9_][A-Za-z0-9_.+-]*)/g,
    describe: 'an `npm install` pin of the CLI itself',
  },
];

/**
 * The prose anchors (#10229). Each spans a CLAIM: the anchor phrase, the rest of
 * its line, and the line after it.
 *
 * Two lines because MDX prose is hard-wrapped at ~78 columns and every drifted
 * spelling in the corpus put its tag enumeration within one wrap of the anchor --
 * `versions (`17.0.0`, `17.0`, `17`,\n`latest`)` was the shape that got past the
 * pin patterns. A whole-paragraph span would reach into neighbouring sentences and
 * start colliding with the legitimate literals listed in the header; a single line
 * would miss the wrap. Table-row claims are bounded by their parentheses instead,
 * which is tighter than a line.
 */
export const PROSE_ANCHORS = {
  'tag-scheme': {
    // The near-miss #10229 measured: `@objectstack/cli` followed by a backtick and
    // the word "versions" is one character away from the `npm-pin` anchor, so the
    // pin limb never saw it. That near-miss is exactly what makes it a good anchor.
    regex: /`@objectstack\/cli` versions[^\n]*\n?[^\n]*/g,
    describe: 'the sentence stating what the runtime image tags mirror',
  },
  'release-train': {
    regex: /release train \([^)]*\)/g,
    describe: 'the "Versioned by" table cell naming what the platform is versioned by',
  },
};

/**
 * The enumerated prose claims -- (file, anchor) pairs, one per claim site.
 *
 * This is the census as of #10229, and it is deliberately a list of CLAIMS rather
 * than of files: `self-hosting.mdx` carries a tag-scheme sentence and no
 * "Versioned by" cell, while the other two carry both. Enumerating pairs means a
 * claim that is deleted or reworded past its anchor is PROSE-ANCHOR-LOST rather
 * than a silent shrink -- the same bargain SURFACES makes with NO-OCCURRENCES.
 *
 * Adding a doc that describes the tag scheme? Add its claim here. The cost of
 * forgetting is bounded the same way: an unenumerated claim is unguarded, which is
 * how all five of these got past 17.1.0 in the first place.
 */
export const PROSE_CLAIMS = [
  {
    file: 'content/docs/deployment/self-hosting.mdx',
    anchor: 'tag-scheme',
    why: 'the self-hosting walkthrough\'s image-tag paragraph. Carried BOTH 17.1.0 defects: the stale exemplar and the false "move with every stable publish" claim.',
  },
  {
    file: 'content/docs/deployment/index.mdx',
    anchor: 'tag-scheme',
    why: 'the deployment overview\'s runtime section. NOT in SURFACES -- it pins nothing, so the pin limb cannot reach it at all, and this is the only guard it has.',
  },
  {
    file: 'content/docs/deployment/index.mdx',
    anchor: 'release-train',
    why: 'the "Versioned by" cell of the two-clocks table -- a live claim about the current train version.',
  },
  {
    file: 'content/docs/upgrading.mdx',
    anchor: 'tag-scheme',
    why: 'the upgrade guide\'s "Moving the tag" section. Not named by #10229 -- found by re-measuring the corpus while implementing it, and the same class exactly.',
  },
  {
    file: 'content/docs/upgrading.mdx',
    anchor: 'release-train',
    why: 'the "Versioned by" cell of the upgrade guide\'s two-clocks table. Same find as the row above.',
  },
];

/**
 * A concrete version literal ANYWHERE inside a span of prose.
 *
 * Deliberately looser than `isConcreteVersion`, which classifies a whole captured
 * tag token: here there is no token, just a sentence, and the question is whether
 * it contains a version at all. `v17.0.0`, `17.0.0` and `2.2.2` all match -- the
 * limb's precision comes from WHERE it looks, not from this pattern.
 */
const PROSE_VERSION_LITERAL = /\d+\.\d+\.\d+/;

/**
 * The live false-positive control (#9018's named risk).
 *
 * `docker/README.md` documents the tag scheme with `X.Y.Z` as a METAVARIABLE. The
 * self-test asserts that this string is (a) still present in that file, so the
 * control is live rather than historical, and (b) produces no occurrence.
 */
const LIVE_CONTROL = { file: 'docker/README.md', metavariable: 'X.Y.Z' };


// ---------------------------------------------------------------------------
// The driver-promise limb (#14510).
// ---------------------------------------------------------------------------

/**
 * The image's SQL-driver list, read from BOTH files that state it.
 *
 * `docker/Dockerfile` installs the drivers; `docker/README.md` publishes which
 * ones it installs. The maintainer ruling on #14510 made that README list "a
 * public promise ... maintained from now on", and a promise with nothing holding
 * it to the artifact is the same silent-drift shape the two limbs above exist
 * for: an author who adds `tedious` to the install line, or drops `mysql2` from
 * it, leaves valid Docker syntax and valid Markdown behind, and the README goes
 * on advertising a dialect the image can no longer reach. The reader finds out
 * at boot, with `Cannot find module`, which is exactly how #14510 was found.
 *
 * So the two are compared to each other rather than to a third list kept here:
 * this gate owns no opinion about WHICH drivers belong in the image (that is the
 * ruling's), only that the file which installs them and the file which promises
 * them cannot disagree.
 *
 * Both sides are ANCHORED for the same reason the pin patterns are. The
 * Dockerfile anchor is the global-install command itself; the README anchor is
 * the section heading, and only the FIRST table under it is read -- the prose
 * below that table deliberately names drivers the image does NOT carry
 * (`tedious`, `@objectstack/driver-turso`), and a looser reader would parse those
 * as promises and redden the gate for saying something true.
 */
export const DRIVER_PROMISE = {
  dockerfile: 'docker/Dockerfile',
  readme: 'docker/README.md',
  /** The README section whose first table lists what the image installs. */
  heading: '## Database drivers in the image',
  /** The Dockerfile command that installs them. Matched on a trimmed line. */
  installPrefix: 'RUN npm install -g',
  /**
   * Installed packages that are NOT drivers.
   *
   * `@objectstack/cli` is the runtime itself and is pinned by the build arg, not
   * by a driver range; the pin limb above already owns it. Listing it here rather
   * than filtering on "has an interpolation in its range" keeps the exclusion
   * about WHAT the package is, so a future `@objectstack/cli@17.2.0` spelled
   * concretely stays excluded for the same reason it is today.
   */
  ignoreInstalled: ['@objectstack/cli'],
};

/** The repo this script lives in -- resolved from the script, so cwd cannot lie. */
function scriptRepoRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

// ---------------------------------------------------------------------------
// Classification and extraction.
// ---------------------------------------------------------------------------

/**
 * Is this tag token a CONCRETE version -- one that names a single release?
 *
 * A prefix test on purpose: three dot-separated integer groups at the START,
 * with whatever follows kept in the token and compared as part of it. See the
 * header for the two mis-pins a stricter semver match would skip in silence.
 *
 * @param {string} tag
 */
export function isConcreteVersion(tag) {
  return /^\d+\.\d+\.\d+/.test(tag);
}

/**
 * @typedef {{ pattern: string, tag: string, raw: string, line: number, column: number, concrete: boolean }} Occurrence
 */

/**
 * Every anchored occurrence in `text`, with 1-based line and column.
 *
 * Scanned line by line rather than over the whole buffer: all three patterns are
 * within-line by construction, and the line number is the half of the report an
 * author actually navigates by.
 *
 * @param {string} text
 * @returns {Occurrence[]}
 */
export function extractOccurrences(text) {
  /** @type {Occurrence[]} */
  const occurrences = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    for (const pattern of PATTERNS) {
      // A fresh regex per line: `lastIndex` on a shared /g literal is state, and
      // sharing it across lines silently skips matches.
      const regex = new RegExp(pattern.regex.source, 'g');
      let match;
      while ((match = regex.exec(lines[index])) !== null) {
        occurrences.push({
          pattern: pattern.name,
          tag: match[1],
          raw: match[0],
          line: index + 1,
          column: match.index + 1,
          concrete: isConcreteVersion(match[1]),
        });
      }
    }
  }
  return occurrences.sort((a, b) => a.line - b.line || a.column - b.column);
}

// ---------------------------------------------------------------------------
// The check itself. `main()` and `--self-test` both go through here, so the
// self-test exercises the real code path rather than a parallel imitation.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ kind: string, file: string, line: number, detail: string }} Finding
 */

/**
 * Compare every concrete pin on every enumerated surface against `expected`.
 *
 * @param {{ surfaces: { file: string, why: string }[], expected: string, root: string }} options
 * @returns {{ findings: Finding[], stats: Record<string, number> }}
 */
export function checkSurfaces({ surfaces, expected, root }) {
  /** @type {Finding[]} */
  const findings = [];
  const stats = { surfaces: surfaces.length, read: 0, compared: 0, skipped: 0 };

  for (const surface of surfaces) {
    const full = join(root, surface.file);
    if (!existsSync(full)) {
      // Not skipped: an enumerated surface that is gone is this gate silently
      // shrinking, which is the failure mode it exists to prevent.
      findings.push({
        kind: 'MISSING-SURFACE',
        file: surface.file,
        line: 0,
        detail:
          'enumerated in SURFACES but not present in the tree. If the page moved, re-point the entry; '
          + 'if it is gone, delete the entry in the same change so the shrinkage is visible in the diff.',
      });
      continue;
    }
    stats.read++;

    const occurrences = extractOccurrences(readFileSync(full, 'utf8'));
    const concrete = occurrences.filter((occurrence) => occurrence.concrete);
    stats.compared += concrete.length;
    stats.skipped += occurrences.length - concrete.length;

    if (concrete.length === 0) {
      findings.push({
        kind: 'NO-OCCURRENCES',
        file: surface.file,
        line: 0,
        detail:
          `yields no concrete pinned version, so this gate asserts NOTHING about it while still counting `
          + `it as covered. Scanned for: ${PATTERNS.map((pattern) => pattern.name).join(', ')}. `
          + (occurrences.length > 0
            ? `(${occurrences.length} anchored occurrence(s) were found, all with non-concrete tags: `
              + `${[...new Set(occurrences.map((occurrence) => occurrence.tag))].join(', ')}.) `
            : '(No anchored occurrence at all.) ')
          + 'Either the pin was re-spelled -- extend PATTERNS -- or the page genuinely stopped pinning a '
          + 'version, in which case delete its SURFACES entry in the same change.',
      });
      continue;
    }

    for (const occurrence of concrete) {
      if (occurrence.tag === expected) continue;
      findings.push({
        kind: 'STALE',
        file: surface.file,
        line: occurrence.line,
        detail:
          `found '${occurrence.raw}' (${occurrence.pattern}) -- expected version '${expected}', got '${occurrence.tag}'. `
          + `Every concrete version pinned in the docs must equal ${VERSION_SOURCE}'s version: a reader copies `
          + 'this line verbatim into a Dockerfile or an orchestrator manifest, and a stale pin is valid syntax '
          + 'that quietly deploys the wrong major.',
      });
    }
  }

  return { findings, stats };
}

/**
 * Every span an anchor claims in `text`, with its 1-based starting line.
 *
 * @param {string} text
 * @param {{ regex: RegExp }} anchor
 * @returns {{ text: string, line: number }[]}
 */
export function extractProseClaims(text, anchor) {
  /** @type {{ text: string, line: number }[]} */
  const spans = [];
  // A fresh regex per call: `lastIndex` on a shared /g literal is state, and the
  // same anchor is used against several files.
  const regex = new RegExp(anchor.regex.source, 'g');
  let match;
  while ((match = regex.exec(text)) !== null) {
    spans.push({
      text: match[0],
      line: text.slice(0, match.index).split('\n').length,
    });
    // A zero-length match would spin forever; anchors are all non-empty, but the
    // loop should not depend on that staying true.
    if (match[0].length === 0) regex.lastIndex++;
  }
  return spans;
}

/**
 * Assert that every enumerated prose claim is anchored, present, and version-free.
 *
 * @param {{ claims: { file: string, anchor: string, why: string }[], root: string }} options
 * @returns {{ findings: Finding[], stats: Record<string, number> }}
 */
export function checkProseClaims({ claims, root }) {
  /** @type {Finding[]} */
  const findings = [];
  const stats = { claims: claims.length, matched: 0 };

  for (const claim of claims) {
    const anchor = PROSE_ANCHORS[claim.anchor];
    if (!anchor) {
      // A claim naming an anchor that does not exist would otherwise scan nothing
      // and pass -- the vacuous green, one level up from NO-OCCURRENCES.
      findings.push({
        kind: 'UNKNOWN-ANCHOR',
        file: claim.file,
        line: 0,
        detail:
          `names anchor '${claim.anchor}', which is not in PROSE_ANCHORS `
          + `(have: ${Object.keys(PROSE_ANCHORS).join(', ')}). This claim asserts NOTHING as written.`,
      });
      continue;
    }

    const full = join(root, claim.file);
    if (!existsSync(full)) {
      findings.push({
        kind: 'MISSING-SURFACE',
        file: claim.file,
        line: 0,
        detail:
          `enumerated in PROSE_CLAIMS (anchor '${claim.anchor}') but not present in the tree. `
          + 'If the page moved, re-point the entry; if it is gone, delete the entry in the same change.',
      });
      continue;
    }

    const spans = extractProseClaims(readFileSync(full, 'utf8'), anchor);
    if (spans.length === 0) {
      findings.push({
        kind: 'PROSE-ANCHOR-LOST',
        file: claim.file,
        line: 0,
        detail:
          `the '${claim.anchor}' anchor (${anchor.describe}) matches nothing, so this gate asserts NOTHING `
          + 'about a claim it still counts as covered. Either the sentence was reworded past its anchor -- '
          + 're-anchor it -- or the page genuinely stopped making the claim, in which case delete this '
          + 'PROSE_CLAIMS entry in the same change so the shrinkage is visible in the diff.',
      });
      continue;
    }
    stats.matched += spans.length;

    for (const span of spans) {
      const literal = span.text.match(PROSE_VERSION_LITERAL);
      if (!literal) continue;
      findings.push({
        kind: 'PROSE-VERSION',
        file: claim.file,
        line: span.line,
        detail:
          `${anchor.describe} carries the concrete version '${literal[0]}'. Prose describing the tag SCHEME `
          + 'must use the metavariables `X.Y.Z` / `X.Y` / `X` / `latest`, the way docker/README.md\'s tag '
          + 'table does: nothing rewrites a sentence at release time, so a literal here goes stale at the '
          + 'next publish and no gate downstream can see it. Found in: '
          + JSON.stringify(span.text.replace(/\s+/g, ' ').trim()),
      });
    }
  }

  return { findings, stats };
}


/**
 * Split a package spec into its name and its version range.
 *
 * Scope-aware: the `@` that opens `@objectstack/cli` is not a separator, so the
 * split is on the LAST `@` at a non-zero index. A spec with no such `@` has no
 * range at all, which is a finding rather than a default -- see DRIVER-UNRANGED.
 *
 * @param {string} spec
 * @returns {{ name: string, range: string }}
 */
export function splitPackageSpec(spec) {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { name: spec, range: '' };
  return { name: spec.slice(0, at), range: spec.slice(at + 1) };
}

/**
 * The drivers `docker/Dockerfile`'s global install puts into the image.
 *
 * Line continuations are joined before tokenising, because the install list is
 * one package per line -- reading only the anchor line would see the CLI and
 * none of the drivers, i.e. report an empty list over a populated one.
 *
 * The command is cut at the first `&&`: `npm cache clean --force` follows on the
 * same logical line and its tokens are not packages.
 *
 * @param {string} text
 * @returns {{ found: boolean, line: number, drivers: { name: string, range: string, raw: string }[] }}
 */
export function extractInstalledDrivers(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim().startsWith(DRIVER_PROMISE.installPrefix));
  if (start === -1) return { found: false, line: 0, drivers: [] };

  let joined = '';
  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    const continues = /\\\s*$/.test(line);
    joined += `${continues ? line.replace(/\\\s*$/, '') : line} `;
    if (!continues) break;
  }

  const command = joined.split('&&')[0];
  const drivers = [];
  for (const token of command.trim().split(/\s+/)) {
    // Quotes are how a `^` range survives some shells; they are not part of the
    // spec. `RUN`, `npm`, `install` and the global flag are the command itself.
    const spec = token.replace(/^["']|["']$/g, '');
    if (spec === '' || spec.startsWith('-')) continue;
    if (['RUN', 'npm', 'install'].includes(spec)) continue;
    const { name, range } = splitPackageSpec(spec);
    if (DRIVER_PROMISE.ignoreInstalled.includes(name)) continue;
    drivers.push({ name, range, raw: spec });
  }
  return { found: true, line: start + 1, drivers };
}

/**
 * The drivers `docker/README.md` promises, read from the first table under the
 * driver heading.
 *
 * Only the LAST cell of each data row is read, and only its first backticked
 * token: the other cells carry `OS_DATABASE_URL` schemes, which are backticked
 * too and are not package specs.
 *
 * @param {string} text
 * @returns {{ found: boolean, line: number, drivers: { name: string, range: string, raw: string, line: number }[] }}
 */
export function extractPromisedDrivers(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === DRIVER_PROMISE.heading);
  if (start === -1) return { found: false, line: 0, drivers: [] };

  const drivers = [];
  let seenTable = false;
  let rowIndex = 0;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) {
      if (seenTable) break; // the table ended; the prose after it is not a promise
      continue;
    }
    seenTable = true;
    rowIndex++;
    // Row 1 is the header, row 2 the `|:---|` separator.
    if (rowIndex <= 2) continue;
    const cells = line.replace(/^\||\|$/g, '').split('|');
    const backticked = cells[cells.length - 1].match(/`([^`]+)`/);
    if (!backticked) continue;
    const { name, range } = splitPackageSpec(backticked[1]);
    drivers.push({ name, range, raw: backticked[1], line: index + 1 });
  }
  return { found: true, line: start + 1, drivers };
}

/**
 * Assert that the image's install line and the README's published list name the
 * same drivers at the same ranges.
 *
 * @param {{ root: string }} options
 * @returns {{ findings: Finding[], stats: Record<string, number> }}
 */
export function checkDriverPromise({ root }) {
  /** @type {Finding[]} */
  const findings = [];
  const stats = { installed: 0, promised: 0, matched: 0 };

  /** @type {Record<string, string | null>} */
  const texts = {};
  for (const key of ['dockerfile', 'readme']) {
    const file = DRIVER_PROMISE[key];
    const full = join(root, file);
    if (!existsSync(full)) {
      findings.push({
        kind: 'MISSING-SURFACE',
        file,
        line: 0,
        detail:
          'named by DRIVER_PROMISE but not present in the tree, so the image driver list has only one '
          + 'side left and nothing to compare it against. Re-point the entry, or delete this limb in the '
          + 'same change so the shrinkage is visible in the diff.',
      });
      texts[key] = null;
      continue;
    }
    texts[key] = readFileSync(full, 'utf8');
  }
  if (texts.dockerfile === null || texts.readme === null) return { findings, stats };

  const installed = extractInstalledDrivers(texts.dockerfile);
  const promised = extractPromisedDrivers(texts.readme);

  if (!installed.found) {
    findings.push({
      kind: 'DRIVER-ANCHOR-LOST',
      file: DRIVER_PROMISE.dockerfile,
      line: 0,
      detail:
        `no line starts with '${DRIVER_PROMISE.installPrefix}', so this gate cannot see what the image `
        + 'installs and would report OK over a comparison it never made. Either the install was re-spelled '
        + '-- re-anchor DRIVER_PROMISE.installPrefix -- or the image stopped installing drivers, in which '
        + `case delete the '${DRIVER_PROMISE.heading}' section of ${DRIVER_PROMISE.readme} and this limb in `
        + 'the same change.',
    });
  }
  if (!promised.found) {
    findings.push({
      kind: 'DRIVER-ANCHOR-LOST',
      file: DRIVER_PROMISE.readme,
      line: 0,
      detail:
        `carries no '${DRIVER_PROMISE.heading}' heading, so the drivers ${DRIVER_PROMISE.dockerfile} installs `
        + 'are not published anywhere a deployer reads. The #14510 ruling made that list a PUBLIC PROMISE: '
        + 'the image advertises a `postgres://` invocation in this very file, and a reader has no other way '
        + 'to know whether the driver behind it is in the image or something they must install.',
    });
  }
  if (!installed.found || !promised.found) return { findings, stats };

  stats.installed = installed.drivers.length;
  stats.promised = promised.drivers.length;

  if (installed.drivers.length === 0) {
    findings.push({
      kind: 'DRIVER-LIST-EMPTY',
      file: DRIVER_PROMISE.dockerfile,
      line: installed.line,
      detail:
        'installs no driver alongside the CLI. `@objectstack/driver-sql` declares `pg`, `mysql2` and '
        + '`tedious` as OPTIONAL peer dependencies and npm skips optional peers, so an install line carrying '
        + 'only the CLI produces an image that fails fast on every `postgres://` and `mysql://` URL -- the '
        + 'defect #14510 filed. An empty list is not a passing comparison; it is this gate asserting nothing.',
    });
  }
  if (promised.drivers.length === 0) {
    findings.push({
      kind: 'DRIVER-LIST-EMPTY',
      file: DRIVER_PROMISE.readme,
      line: promised.line,
      detail:
        `the '${DRIVER_PROMISE.heading}' section has no table row naming a driver package in backticks, so `
        + 'the promise is a heading with nothing under it and the comparison below has one empty side. Each '
        + "row's LAST cell must carry the package spec, e.g. `pg@^8.0.0`.",
    });
  }
  if (installed.drivers.length === 0 || promised.drivers.length === 0) return { findings, stats };

  const promisedByName = new Map(promised.drivers.map((driver) => [driver.name, driver]));
  const installedByName = new Map(installed.drivers.map((driver) => [driver.name, driver]));

  for (const driver of installed.drivers) {
    if (driver.range === '') {
      findings.push({
        kind: 'DRIVER-UNRANGED',
        file: DRIVER_PROMISE.dockerfile,
        line: installed.line,
        detail:
          `installs '${driver.raw}' with no version range, so every rebuild of this image -- including a `
          + 'CVE backfill of an OLD release -- picks up whatever major is newest that day. The ranges belong '
          + "in the install line and must be `@objectstack/driver-sql`'s own optional-peer ranges, so the "
          + 'image satisfies the driver contract rather than a second one invented here.',
      });
    }
    const match = promisedByName.get(driver.name);
    if (!match) {
      findings.push({
        kind: 'DRIVER-UNDOCUMENTED',
        file: DRIVER_PROMISE.readme,
        line: promised.line,
        detail:
          `${DRIVER_PROMISE.dockerfile}:${installed.line} installs '${driver.raw}', which the promise table `
          + 'does not list. Every driver in the image is part of what the image IS -- it changes which '
          + 'databases a deployment can reach, and it is carried by every user of the image including the '
          + 'ones who will never use it. Add the row, or take the package back out of the install line.',
      });
      continue;
    }
    stats.matched++;
    if (match.range !== driver.range) {
      findings.push({
        kind: 'DRIVER-RANGE-MISMATCH',
        file: DRIVER_PROMISE.readme,
        line: match.line,
        detail:
          `promises '${match.raw}' but ${DRIVER_PROMISE.dockerfile}:${installed.line} installs `
          + `'${driver.raw}'. The published range is the half a reader plans an upgrade against, so the two `
          + 'must move together -- a README a major behind the image is worse than no README, because it '
          + 'reads as checked.',
      });
    }
  }

  for (const driver of promised.drivers) {
    if (installedByName.has(driver.name)) continue;
    findings.push({
      kind: 'DRIVER-OVERPROMISED',
      file: DRIVER_PROMISE.readme,
      line: driver.line,
      detail:
        `promises '${driver.raw}', which ${DRIVER_PROMISE.dockerfile}:${installed.line} does not install. `
        + 'A reader who believes this row hands the image a URL it cannot serve and gets '
        + "`Cannot find module '" + driver.name + "'` at boot. Either install it, or delete the row.",
    });
  }

  return { findings, stats };
}

// ---------------------------------------------------------------------------
// Loading the expected version.
// ---------------------------------------------------------------------------

/**
 * Read and validate `packages/cli`'s version.
 *
 * Every failure throws rather than degrading to a skip: a gate that compared
 * everything against `undefined`, or against nothing at all, would be green over
 * a corpus it never judged.
 *
 * @param {string} file absolute path to a package.json
 * @returns {string}
 */
export function loadExpectedVersion(file) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${file} as JSON: ${error.message}`);
  }
  const version = manifest.version;
  if (typeof version !== 'string' || version === '') {
    throw new Error(`${file} declares no \`version\` string (got ${JSON.stringify(version)})`);
  }
  if (!isConcreteVersion(version)) {
    throw new Error(
      `${file}'s version ${JSON.stringify(version)} is not a concrete X.Y.Z version, so there is nothing `
      + 'for the docs to be compared against -- refusing to report OK over an unusable expectation.',
    );
  }
  return version;
}

// ---------------------------------------------------------------------------
// Reporting.
// ---------------------------------------------------------------------------

/**
 * What the run actually asserted, stated so a GREEN can be read for its scope.
 *
 * Named unconditionally, zeroes included: the live corpus is green, so the only
 * thing distinguishing "8 pins were compared" from "the loop never ran" is this.
 */
export function summarise(stats, expected, proseStats, driverStats) {
  const pins = (
    `${stats.read}/${stats.surfaces} enumerated surface(s) read, `
    + `${stats.compared} concrete pin(s) compared against ${VERSION_SOURCE} ${expected}, `
    + `${stats.skipped} rolling/floating tag(s) skipped as non-concrete`
  );
  if (!proseStats) return pins;
  // Named separately and unconditionally, for the same reason the pin counts are:
  // "5 prose claim(s) were scanned" and "the loop never ran" are the two readings
  // of a green, and only this line tells them apart. Worded as SCANNED rather than
  // as a verdict, because this same line is printed under a FAILING run -- saying
  // "read as version-free" there would have the scope line contradict the findings
  // directly above it.
  const withProse = (
    `${pins}; ${proseStats.matched} anchored prose claim(s) from `
    + `${proseStats.claims} enumerated claim site(s) scanned for concrete versions`
  );
  if (!driverStats) return withProse;
  // Same bargain a third time: "2 drivers were compared" and "the anchors matched
  // nothing" are the two readings of this limb's green, and only the counts tell
  // them apart. Worded as COMPARED, not as agreed, because this line also prints
  // above a list of DRIVER-* findings.
  return (
    `${withProse}; ${driverStats.installed} driver(s) installed by ${DRIVER_PROMISE.dockerfile} `
    + `compared against ${driverStats.promised} promised in ${DRIVER_PROMISE.readme} `
    + `(${driverStats.matched} matched by name)`
  );
}

function report(findings, stats, expected, proseStats, driverStats) {
  if (findings.length === 0) {
    console.log(`check-docs-image-tag: OK (${summarise(stats, expected, proseStats, driverStats)}).`);
    return 0;
  }
  const byKind = findings.reduce((acc, finding) => {
    acc[finding.kind] = (acc[finding.kind] ?? 0) + 1;
    return acc;
  }, {});
  const kinds = Object.entries(byKind).map(([kind, count]) => `${count} ${kind}`).join(', ');
  console.error(`check-docs-image-tag: ${findings.length} problem(s) -- ${kinds}\n`);
  for (const finding of findings) {
    const at = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
    console.error(`  • [${finding.kind}] ${at}`);
    console.error(`      ${finding.detail}\n`);
  }
  console.error(
    `Expected version: ${expected} (from ${VERSION_SOURCE}). `
    + 'A version bump turns the PIN half of this gate red until the doc surfaces move in the same change -- '
    + 'that is the mechanism, not a bug. Update the lines named above.\n',
  );
  if (findings.some((finding) => finding.kind === 'PROSE-VERSION')) {
    console.error(
      'A PROSE-VERSION finding is NOT fixed by bumping the number: prose describing the tag scheme must not '
      + 'name a concrete version at all, or it goes stale again at the next publish with nothing to rewrite '
      + 'it. Use `X.Y.Z` / `X.Y` / `X` / `latest`.\n',
    );
  }
  if (findings.some((finding) => finding.kind.startsWith('DRIVER-'))) {
    console.error(
      "A DRIVER-* finding is about the image's PUBLISHED driver list (#14510). docker/Dockerfile's "
      + `\`${DRIVER_PROMISE.installPrefix}\` line and docker/README.md's "${DRIVER_PROMISE.heading.replace(/^#+\s*/, '')}" `
      + 'table state the same fact to two audiences and must move in the same commit. Fixing it by '
      + 'deleting the table is not a fix: the ruling on #14510 made that list a maintained public promise, '
      + 'because the image advertises a `postgres://` invocation that only works if the driver is inside '
      + 'it.\n',
    );
  }
  console.error(`Scope of this run: ${summarise(stats, expected, proseStats, driverStats)}.`);
  return 1;
}

// ---------------------------------------------------------------------------
// Self-test -- every limb has a positive control, each paired with its green.
// ---------------------------------------------------------------------------

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'check-docs-image-tag self-test reached its verdict';

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// `failures.length === 0` used to be this self-test's ONLY success condition, so
// "every case held" and "the cases never ran" printed the same line. Closed the
// way PR #13487 validated on check-doc-authoring: what is pinned is the
// registered NAMES, not a number. Every section opens with `battery('<name>')`,
// every assertion is attributed to the battery most recently opened, and the
// floor requires the OPENED set to equal the DECLARED set with each battery at
// or above its own count.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The counts are a FLOOR, not an equality — adding cases is ordinary work and
// must not red. A battery BELOW its floor means cases stopped running; the
// remedy is to find what stopped registering.
const SELF_TEST_BATTERIES = Object.freeze({
  'Clean fixture: every shape that MUST stay silent': 9,
  'Dirty fixture: one control per limb, each a distinct failure': 12,
  'The classifier, asserted directly': 9,
  'The extractor\'s anchoring and position reporting': 6,
  'The expectation refuses to be unusable': 4,
  'The LIVE false-positive control (#9018\'s named risk, in situ)': 3,
  'The PROSE limb (#10229)': 22,
  'The LIVE prose control (#10229, in situ)': 2,
  'The driver-promise limb (#14510)': 20,
  'The LIVE driver control (#14510, in situ)': 2,
  'The green states its own scope': 5,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 11;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

async function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const seen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    seen.set(b, (seen.get(b) ?? 0) + 1);
  };
  const failures = [];
  let checked = 0;
  const assert = (condition, message) => {
    registerCase();
    checked++;
    if (!condition) failures.push(message);
  };

  const dir = mkdtempSync(join(tmpdir(), 'check-docs-image-tag-selftest-'));
  const write = (relative, contents) => {
    const full = join(dir, relative);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  };

  try {
    const expected = '17.0.0';

    // ── Clean fixture: every shape that MUST stay silent ────────────────────
    //
    // The tag-table rows are copied VERBATIM from docker/README.md, because the
    // point of this control is the exact text living in the corpus today, not a
    // paraphrase of it that might differ in the one character that matters.
    battery('Clean fixture: every shape that MUST stay silent');
    write(
      'clean/docs.md',
      [
        '# Tags',
        '',
        '| Tag | Meaning |',
        '|:---|:---|',
        '| `X.Y.Z` | Exact release — **pin this in production** |',
        '| `X.Y`, `X` | Rolling minor / major |',
        '| `latest` | Latest release — quick starts only |',
        '',
        '```dockerfile',
        'FROM ghcr.io/objectstack-ai/objectstack:17.0.0',
        '```',
        '',
        '```bash',
        'docker build --build-arg OS_CLI_VERSION=17.0.0 docker/',
        'npm install -g @objectstack/cli@17.0.0',
        '```',
        '',
        'Rolling tags are documented on purpose and must not be nagged about:',
        '',
        '```dockerfile',
        'FROM ghcr.io/objectstack-ai/objectstack:latest',
        'FROM ghcr.io/objectstack-ai/objectstack:17.0',
        'FROM ghcr.io/objectstack-ai/objectstack:17',
        '```',
        '',
        'Nor may an interpolation or a metavariable be read as a version:',
        '',
        '```dockerfile',
        '#   FROM ghcr.io/objectstack-ai/objectstack:<version>',
        'ARG OS_CLI_VERSION=latest',
        'RUN npm install -g @objectstack/cli@${OS_CLI_VERSION}',
        '```',
        '',
        'Historical prose keeps its own version and must never track the CLI:',
        '',
        'The key was removed in @objectstack/spec 17.0.0, and 16.4.2 before that.',
        '',
      ].join('\n'),
    );

    const cleanSurfaces = [{ file: 'clean/docs.md', why: 'fixture' }];
    const clean = checkSurfaces({ surfaces: cleanSurfaces, expected, root: dir });

    // Anti-vacuity and anti-over-eagerness in one: a fixture where every limb has
    // something real to look at reports NOTHING.
    assert(
      clean.findings.length === 0,
      `a clean surface reports zero findings -- got ${JSON.stringify(clean.findings.map((f) => `${f.kind}@${f.file}:${f.line}`))}`,
    );
    // ...and it really did look. A scanner that matched nothing would satisfy the
    // assertion above just as happily, which is the exact failure #9018 names.
    assert(
      clean.stats.compared === 3,
      `the clean run compared all 3 concrete pins (image tag, build arg, npm pin) -- got ${clean.stats.compared}`,
    );
    assert(
      clean.stats.skipped === 4,
      `the clean run saw and SKIPPED the 4 anchored non-concrete tags (latest, 17.0, 17, latest again) -- got ${clean.stats.skipped}`,
    );
    assert(clean.stats.read === 1, `the clean run read its 1 surface -- got ${clean.stats.read}`);

    // The false positive #9018 names, asserted rather than reasoned about --
    // in the hermetic fixture first, against the real file further down.
    const cleanOccurrences = extractOccurrences(readFileSync(join(dir, 'clean/docs.md'), 'utf8'));
    assert(
      cleanOccurrences.every((occurrence) => occurrence.tag !== 'X.Y.Z'),
      `the 'X.Y.Z' tag-table metavariable produces NO occurrence -- got ${JSON.stringify(cleanOccurrences.filter((o) => o.tag === 'X.Y.Z'))}`,
    );
    assert(
      cleanOccurrences.some((occurrence) => occurrence.tag === 'latest')
        && cleanOccurrences.some((occurrence) => occurrence.tag === '17.0')
        && cleanOccurrences.some((occurrence) => occurrence.tag === '17'),
      'the rolling tags ARE captured by the anchors and then classified non-concrete -- '
        + 'skipping them must be a decision the classifier makes, not an anchor that missed them, '
        + `otherwise a typo'd rolling tag would vanish too. Got ${JSON.stringify(cleanOccurrences.map((o) => o.tag))}`,
    );
    assert(
      !cleanOccurrences.some((occurrence) => occurrence.tag.startsWith('<')),
      'the `<version>` metavariable is not captured at all (the charset excludes it)',
    );
    assert(
      !cleanOccurrences.some((occurrence) => occurrence.raw.includes('${')),
      'a shell/Actions interpolation is not captured at all -- it is the CORRECT way to spell a tracking pin',
    );
    assert(
      cleanOccurrences.filter((occurrence) => occurrence.pattern === 'npm-pin').length === 1,
      'the historical prose "removed in @objectstack/spec 17.0.0" is NOT an @objectstack/cli@ pin -- '
        + `only the real npm pin matches. Got ${JSON.stringify(cleanOccurrences.filter((o) => o.pattern === 'npm-pin'))}`,
    );

    // ── Dirty fixture: one control per limb, each a distinct failure ────────
    battery('Dirty fixture: one control per limb, each a distinct failure');
    write(
      'dirty/stale.md',
      [
        'FROM ghcr.io/objectstack-ai/objectstack:16.0.0', // 1: STALE, whole majors behind
        'docker build --build-arg OS_CLI_VERSION=16.4.2 docker/', // 2: STALE build arg
        'npm install -g @objectstack/cli@15.0.0', // 3: STALE npm pin
        'FROM ghcr.io/objectstack-ai/objectstack:17.0.0-beta.1', // 4: STALE prerelease
        'FROM ghcr.io/objectstack-ai/objectstack:17.0.0.0', // 5: STALE typo
        'FROM ghcr.io/objectstack-ai/objectstack:17.0.0', // 6: correct -- must stay silent
        '',
      ].join('\n'),
    );
    // A surface that still exists but no longer pins anything concrete.
    write('dirty/rotted.md', 'FROM ghcr.io/objectstack-ai/objectstack:latest\n');
    // A surface with no anchored occurrence whatsoever.
    write('dirty/empty.md', 'This page no longer shows a deployment example.\n');

    const dirtySurfaces = [
      { file: 'dirty/stale.md', why: 'fixture' },
      { file: 'dirty/rotted.md', why: 'fixture' },
      { file: 'dirty/empty.md', why: 'fixture' },
      { file: 'dirty/renamed-away.md', why: 'fixture' }, // never written
    ];
    const dirty = checkSurfaces({ surfaces: dirtySurfaces, expected, root: dir });
    const at = (line) => dirty.findings.filter((f) => f.file === 'dirty/stale.md' && f.line === line).map((f) => f.kind);

    // Limb 1 -- a concrete pin that disagrees, in each of its patterns.
    assert(at(1).includes('STALE'), `line 1 (image tag 16.0.0) is STALE -- got ${JSON.stringify(at(1))}`);
    assert(at(2).includes('STALE'), `line 2 (OS_CLI_VERSION=16.4.2) is STALE -- got ${JSON.stringify(at(2))}`);
    assert(at(3).includes('STALE'), `line 3 (@objectstack/cli@15.0.0) is STALE -- got ${JSON.stringify(at(3))}`);
    assert(
      at(4).includes('STALE'),
      'line 4 (17.0.0-beta.1 against 17.0.0) is STALE -- a checker comparing only the three-integer PREFIX '
        + `would read '17.0.0', find it equal, and pass a docs page pinning a prerelease image. `
        + `Got ${JSON.stringify(at(4))}`,
    );
    assert(
      at(5).includes('STALE'),
      'line 5 (17.0.0.0, a typo) is STALE -- a STRICT semver classifier would call this "not a version" and '
        + `skip it in silence, which is a hole in the shape of the bug. Got ${JSON.stringify(at(5))}`,
    );

    // Limb 2 -- the enumeration itself rotting into a no-op.
    const kindsFor = (file) => dirty.findings.filter((f) => f.file === file).map((f) => f.kind);
    assert(
      kindsFor('dirty/rotted.md').includes('NO-OCCURRENCES'),
      'a surface whose only tag went rolling is NO-OCCURRENCES, not a silent pass -- otherwise the gate '
        + `keeps counting it as covered while asserting nothing. Got ${JSON.stringify(kindsFor('dirty/rotted.md'))}`,
    );
    assert(
      kindsFor('dirty/empty.md').includes('NO-OCCURRENCES'),
      `a surface with no anchored occurrence at all is NO-OCCURRENCES -- got ${JSON.stringify(kindsFor('dirty/empty.md'))}`,
    );
    // The two NO-OCCURRENCES details differ: one names the tags it did find, so
    // an author can see the pin was re-spelled rather than removed.
    const rotted = dirty.findings.find((f) => f.file === 'dirty/rotted.md');
    assert(
      rotted?.detail.includes('latest') === true,
      `the NO-OCCURRENCES detail names the non-concrete tags it DID find -- got ${rotted?.detail}`,
    );

    // Limb 3 -- an enumerated surface that is gone.
    assert(
      kindsFor('dirty/renamed-away.md').includes('MISSING-SURFACE'),
      `an enumerated file that does not exist is MISSING-SURFACE -- got ${JSON.stringify(kindsFor('dirty/renamed-away.md'))}`,
    );

    // Discrimination: the correct pin in the dirty file stays silent. Without
    // this, every assertion above would also pass for a checker that flagged
    // everything -- a no-op with the opposite exit code.
    assert(at(6).length === 0, `line 6 (a CORRECT pin) must produce no finding -- got ${JSON.stringify(at(6))}`);

    const exact = dirty.findings.map((f) => `${f.kind}@${f.file}:${f.line}`).sort();
    assert(
      exact.join() === [
        'MISSING-SURFACE@dirty/renamed-away.md:0',
        'NO-OCCURRENCES@dirty/empty.md:0',
        'NO-OCCURRENCES@dirty/rotted.md:0',
        'STALE@dirty/stale.md:1',
        'STALE@dirty/stale.md:2',
        'STALE@dirty/stale.md:3',
        'STALE@dirty/stale.md:4',
        'STALE@dirty/stale.md:5',
      ].join(),
      `the dirty fixture produces EXACTLY the 8 expected findings -- got ${JSON.stringify(exact)}`,
    );
    // The report carries found-vs-expected, which is what #9018 asks for.
    const stale1 = dirty.findings.find((f) => f.file === 'dirty/stale.md' && f.line === 1);
    assert(
      stale1?.detail.includes("got '16.0.0'") === true && stale1?.detail.includes("expected version '17.0.0'") === true,
      `a STALE finding states found vs expected -- got ${stale1?.detail}`,
    );

    // ── The classifier, asserted directly ───────────────────────────────────
    battery('The classifier, asserted directly');
    assert(isConcreteVersion('17.0.0'), 'a plain X.Y.Z is concrete');
    assert(isConcreteVersion('17.0.0-beta.1'), 'a prerelease is concrete (and compared as the WHOLE token)');
    assert(isConcreteVersion('17.0.0.0'), 'a four-group typo is concrete, so it is compared rather than skipped');
    assert(!isConcreteVersion('X.Y.Z'), "the tag table's 'X.Y.Z' metavariable is NOT concrete -- #9018's named false positive");
    assert(!isConcreteVersion('X.Y'), "'X.Y' is not concrete");
    assert(!isConcreteVersion('latest'), "'latest' is not concrete");
    assert(!isConcreteVersion('17.0'), 'a rolling minor tag is not concrete');
    assert(!isConcreteVersion('17'), 'a rolling major tag is not concrete');
    assert(!isConcreteVersion('17.0.x'), "'17.0.x' is not concrete");

    // ── The extractor's anchoring and position reporting ────────────────────
    battery('The extractor\'s anchoring and position reporting');
    const positions = extractOccurrences('a\nb ghcr.io/objectstack-ai/objectstack:1.2.3 c\n');
    assert(positions.length === 1, `an anchored tag mid-line is found once -- got ${positions.length}`);
    assert(positions[0].line === 2 && positions[0].column === 3, `line/column are 1-based -- got ${positions[0].line}:${positions[0].column}`);
    assert(positions[0].raw === 'ghcr.io/objectstack-ai/objectstack:1.2.3', `the raw match is the whole anchored token -- got ${positions[0].raw}`);
    assert(
      extractOccurrences('17.0.0 and 1.2.3 are versions').length === 0,
      'a bare version-shaped string with NO anchor is not an occurrence -- this is what keeps the gate off '
        + 'the 92 "removed in @objectstack/spec 17.0.0" sentences in content/docs/references/**',
    );
    assert(
      extractOccurrences('ghcr.io/other/image:1.2.3').length === 0,
      'a different image is not an occurrence',
    );
    assert(
      extractOccurrences('ghcr.io/objectstack-ai/objectstack:1.2.3 ghcr.io/objectstack-ai/objectstack:4.5.6').length === 2,
      'two occurrences on ONE line are both found -- a shared /g regex would carry lastIndex across lines and drop matches',
    );

    // ── The expectation refuses to be unusable ──────────────────────────────
    battery('The expectation refuses to be unusable');
    const rejects = (relative, contents, why) => {
      write(relative, contents);
      let threw = false;
      try {
        loadExpectedVersion(join(dir, relative));
      } catch {
        threw = true;
      }
      assert(threw, why);
    };
    rejects('no-version.json', '{"name":"x"}', 'a package.json with no version is rejected, never reported OK');
    rejects('bad-version.json', '{"version":"workspace:*"}', 'a non-concrete version is rejected -- there would be nothing to compare against');
    rejects('not-json.json', 'not json at all', 'an unparseable package.json is rejected');
    write('good.json', '{"version":"17.1.2"}');
    assert(loadExpectedVersion(join(dir, 'good.json')) === '17.1.2', 'a well-formed version loads');

    // ── The LIVE false-positive control (#9018's named risk, in situ) ───────
    //
    // The hermetic fixture above proves the classifier excludes 'X.Y.Z'. This
    // proves the metavariable is still IN the corpus and still excluded there --
    // the assertion that would actually catch the gate going wrong on real data.
    battery('The LIVE false-positive control (#9018\'s named risk, in situ)');
    const root = scriptRepoRoot();
    const controlPath = join(root, LIVE_CONTROL.file);
    if (existsSync(controlPath)) {
      const controlText = readFileSync(controlPath, 'utf8');
      assert(
        controlText.includes(LIVE_CONTROL.metavariable),
        `${LIVE_CONTROL.file} still contains the '${LIVE_CONTROL.metavariable}' tag-table metavariable, so this `
          + 'control is LIVE rather than historical. If the tag table was rewritten, re-point LIVE_CONTROL at '
          + 'whatever now plays that role -- or drop it, saying so, if the corpus no longer carries the hazard.',
      );
      const controlOccurrences = extractOccurrences(controlText);
      assert(
        controlOccurrences.every((occurrence) => occurrence.tag !== LIVE_CONTROL.metavariable),
        `no occurrence extracted from the real ${LIVE_CONTROL.file} carries the '${LIVE_CONTROL.metavariable}' `
          + `metavariable -- got ${JSON.stringify(controlOccurrences.map((o) => o.tag))}`,
      );
      assert(
        controlOccurrences.some((occurrence) => occurrence.concrete),
        `the real ${LIVE_CONTROL.file} still yields at least one CONCRETE pin, so the control above is a `
          + 'discrimination (some captured, some rejected) rather than a scanner that matched nothing',
      );
    } else {
      assert(false, `${LIVE_CONTROL.file} is missing -- the live false-positive control cannot run`);
    }

    // ── The PROSE limb (#10229) ─────────────────────────────────────────────
    //
    // The live corpus is version-free after this change, so -- exactly as with the
    // pin limb -- a green run cannot tell a working limb from one that matches
    // nothing. Every assertion below is a positive control over a fixture.

    // The DIRTY fixture: the corpus as `origin/main` actually stood at 17.1.0,
    // copied from the real files rather than paraphrased. This is the state #10229
    // measured, so the control is a reproduction, not a hypothetical.
    battery('The PROSE limb (#10229)');
    write(
      'prose/stale.mdx',
      [
        '| Versioned by | our release train (`17.0.0`) | your own catalog |',
        '',
        'health check and `OS_ARTIFACT_PATH` / `OS_PORT=8080` preset. Image tags mirror',
        '`@objectstack/cli` versions (`17.0.0`, `17.0`, `17`, `latest`) and the image is',
        'published multi-arch (amd64/arm64); the rolling `17.0` / `17` / `latest` tags',
        'move with every stable publish, while a prerelease gets only its exact tag.',
        '',
      ].join('\n'),
    );
    // The wrapped spelling: the enumeration continues onto the NEXT line, which is
    // how `content/docs/deployment/index.mdx` carried it. A one-line span misses it.
    write(
      'prose/wrapped.mdx',
      [
        'whose tags mirror `@objectstack/cli` versions (`17.0`, `17`,',
        '`17.0.0`, `latest`). Pin the exact version in production.',
        '',
      ].join('\n'),
    );

    const proseDirty = checkProseClaims({
      claims: [
        { file: 'prose/stale.mdx', anchor: 'tag-scheme', why: 'fixture' },
        { file: 'prose/stale.mdx', anchor: 'release-train', why: 'fixture' },
        { file: 'prose/wrapped.mdx', anchor: 'tag-scheme', why: 'fixture' },
        { file: 'prose/gone.mdx', anchor: 'tag-scheme', why: 'fixture' }, // never written
        { file: 'prose/stale.mdx', anchor: 'no-such-anchor', why: 'fixture' },
      ],
      root: dir,
    });
    const proseKinds = (file, anchorKind) =>
      proseDirty.findings.filter((f) => f.file === file && f.kind === anchorKind);

    assert(
      proseKinds('prose/stale.mdx', 'PROSE-VERSION').some((f) => f.line === 4),
      'the tag-scheme sentence carrying `17.0.0` is PROSE-VERSION -- this is the exact line the pin limb '
        + `misses by one character (backtick-space-"versions" instead of "@"). Got ${JSON.stringify(proseDirty.findings.map((f) => `${f.kind}:${f.line}`))}`,
    );
    assert(
      proseKinds('prose/stale.mdx', 'PROSE-VERSION').some((f) => f.line === 1),
      'the "Versioned by" table cell carrying `17.0.0` is PROSE-VERSION',
    );
    assert(
      proseKinds('prose/wrapped.mdx', 'PROSE-VERSION').length === 1,
      'a version on the WRAPPED continuation line is still inside the claim -- a single-line span would '
        + `read this sentence as clean. Got ${JSON.stringify(proseKinds('prose/wrapped.mdx', 'PROSE-VERSION'))}`,
    );
    assert(
      proseKinds('prose/gone.mdx', 'MISSING-SURFACE').length === 1,
      'an enumerated prose claim whose file is gone is MISSING-SURFACE, not a silent pass',
    );
    assert(
      proseDirty.findings.some((f) => f.kind === 'UNKNOWN-ANCHOR'),
      'a claim naming an anchor that does not exist is UNKNOWN-ANCHOR -- it would otherwise scan nothing '
        + 'and report clean, which is the vacuous green one level up',
    );
    // The report has to say what it found, or the remedy is a hunt.
    assert(
      proseKinds('prose/stale.mdx', 'PROSE-VERSION')[0]?.detail.includes('17.0.0') === true,
      'a PROSE-VERSION finding quotes the literal and the sentence it sits in',
    );

    // The CLEAN fixture: the same three claims as repaired, spelled with
    // metavariables. Pairs with the dirty run so an over-eager limb fails as
    // loudly as a blind one.
    write(
      'prose/clean.mdx',
      [
        '| Versioned by | our release train (`X.Y.Z`) | your own catalog |',
        '',
        '`@objectstack/cli` versions: a stable publish pushes that exact version as',
        '`X.Y.Z` and moves `latest` and the matching `X.Y` / `X` tags onto it, while a',
        'prerelease gets only its exact tag.',
        '',
        'Historical facts and the reader\'s OWN app version are NOT claims about our',
        'tag scheme, and must stay silent even in an enumerated file:',
        '',
        '| v17.0.0 | [Upgrade checklist](/docs/releases/v17#upgrade-checklist) |',
        '| v9.0.0 | [Upgrade checklist](/docs/releases/v9#upgrade-checklist) |',
        'OS_ARTIFACT_URL="https://releases.example.com/hotcrm-2.2.2.json"',
        'package id + version (`com.acme.crm@1.2.0`)',
        'The key was removed in @objectstack/spec 17.0.0, and 16.4.2 before that.',
        '',
      ].join('\n'),
    );
    const proseClean = checkProseClaims({
      claims: [
        { file: 'prose/clean.mdx', anchor: 'tag-scheme', why: 'fixture' },
        { file: 'prose/clean.mdx', anchor: 'release-train', why: 'fixture' },
      ],
      root: dir,
    });
    assert(
      proseClean.findings.length === 0,
      'the repaired spelling reports zero findings, AND the four legitimate literal shapes in the same file '
        + '(the historical upgrade-checklist rows, the reader\'s artifact version, a package id + version, and '
        + `a "removed in @objectstack/spec 17.0.0" sentence) stay silent. Got ${JSON.stringify(proseClean.findings.map((f) => `${f.kind}:${f.line}`))}`,
    );
    assert(
      proseClean.stats.matched === 2,
      `...and it really did look: both anchors matched. Got ${proseClean.stats.matched}`,
    );

    // Anti-vacuity for the anchors themselves: a claim reworded past its anchor.
    write('prose/reworded.mdx', 'Image tags follow the CLI release, see the table above.\n');
    const proseLost = checkProseClaims({
      claims: [{ file: 'prose/reworded.mdx', anchor: 'tag-scheme', why: 'fixture' }],
      root: dir,
    });
    assert(
      proseLost.findings.length === 1 && proseLost.findings[0].kind === 'PROSE-ANCHOR-LOST',
      'a claim whose anchor no longer matches is PROSE-ANCHOR-LOST -- otherwise this limb shrinks silently '
        + `while still counting the claim as covered. Got ${JSON.stringify(proseLost.findings)}`,
    );
    assert(
      proseLost.stats.matched === 0,
      'a lost anchor contributes nothing to the matched count, so the summary cannot overstate the scope',
    );

    // The anchor spans, asserted directly.
    assert(
      extractProseClaims('a\n`@objectstack/cli` versions: the exact `X.Y.Z`\nnext line\nfar line', PROSE_ANCHORS['tag-scheme'])[0].line === 2,
      'a prose claim reports the 1-based line its anchor starts on',
    );
    assert(
      !extractProseClaims('a\nb\n`@objectstack/cli` versions: clean\nalso clean\n17.0.0 is two lines below', PROSE_ANCHORS['tag-scheme'])[0].text.includes('17.0.0'),
      'the span stops after ONE continuation line -- it must not reach across a whole page and start '
        + 'colliding with the legitimate literals the header lists',
    );
    assert(
      extractProseClaims('npm install -g @objectstack/cli@17.0.0\n', PROSE_ANCHORS['tag-scheme']).length === 0,
      'a real npm PIN is not a prose claim -- the pin limb owns it, and double-reporting it would push '
        + 'authors to delete the pin instead of updating it',
    );
    assert(
      extractProseClaims('| Versioned by | our release train (`X.Y.Z`) | x |', PROSE_ANCHORS['release-train'])[0].text === 'release train (`X.Y.Z`)',
      'the release-train anchor is bounded by its parentheses, not by the line -- the rest of the table row '
        + 'is somebody else\'s claim',
    );
    assert(
      extractProseClaims('versions independently of this release train and deploys\n', PROSE_ANCHORS['release-train']).length === 0,
      '"release train" without a parenthetical is prose, not a version claim -- content/docs/releases/v9.mdx '
        + 'says exactly this and must not be dragged in',
    );

    // Every anchor in PROSE_ANCHORS is exercised above; a new one needs its own
    // control rather than inheriting this green.
    for (const name of Object.keys(PROSE_ANCHORS)) {
      assert(
        PROSE_CLAIMS.some((claim) => claim.anchor === name),
        `PROSE_ANCHORS carries '${name}', which no PROSE_CLAIMS entry uses -- an anchor nothing is scanned `
          + 'with is dead weight that reads like coverage',
      );
    }
    // ...and every claim names a real anchor, checked here rather than only at runtime.
    for (const claim of PROSE_CLAIMS) {
      assert(
        Object.hasOwn(PROSE_ANCHORS, claim.anchor),
        `PROSE_CLAIMS entry ${claim.file} names anchor '${claim.anchor}', which is not in PROSE_ANCHORS`,
      );
    }

    // ── The LIVE prose control (#10229, in situ) ────────────────────────────
    //
    // The fixtures prove the limb can go red. This proves it is pointed at real
    // claims that still exist -- the assertion that catches the enumeration
    // rotting after a docs rewrite, which is how all five claims got past 17.1.0.
    battery('The LIVE prose control (#10229, in situ)');
    const liveProse = checkProseClaims({ claims: PROSE_CLAIMS, root: scriptRepoRoot() });
    assert(
      liveProse.findings.length === 0,
      `the live corpus carries no concrete version in an enumerated prose claim -- got ${JSON.stringify(liveProse.findings.map((f) => `${f.kind}@${f.file}:${f.line}`))}`,
    );
    assert(
      liveProse.stats.matched >= PROSE_CLAIMS.length,
      `every enumerated prose claim still matches its anchor in the real corpus (>= ${PROSE_CLAIMS.length} spans) -- `
        + `got ${liveProse.stats.matched}. A shortfall means a page was reworded past its anchor.`,
    );


    // ── The driver-promise limb (#14510) ────────────────────────────────────
    //
    // Same bargain as the two limbs above: a clean pair that must stay SILENT
    // while demonstrably having looked, then one deliberate defect per finding
    // kind, then a live control so the enumeration cannot rot into a no-op.
    //
    // The clean fixture reproduces every shape the real files carry -- the CLI
    // pinned by an interpolated build arg, the `&&` tail, quoted ranges, the
    // scheme cells (backticked, and NOT package specs), and the prose below the
    // table naming drivers the image does NOT carry. Each of those has been a
    // plausible way to mis-parse this pair, so each is asserted rather than
    // reasoned about.
    battery('The driver-promise limb (#14510)');
    const driverDockerfile = (installLines) => [
      '# comment mentioning pg and mysql2, which must not be parsed',
      'FROM node:22-slim',
      'ARG OS_CLI_VERSION=latest',
      ...installLines,
      'USER node',
      '',
    ].join('\n');

    const CLEAN_INSTALL = [
      'RUN npm install -g \\',
      '      @objectstack/cli@${OS_CLI_VERSION} \\',
      '      "pg@^8.0.0" \\',
      '      "mysql2@^3.0.0" \\',
      ' && npm cache clean --force',
    ];

    const driverReadme = (rows, { heading = DRIVER_PROMISE.heading, trailer = true } = {}) => [
      '# Image',
      '',
      '## Tags',
      '',
      '| Tag | Meaning |',
      '|:---|:---|',
      '| `X.Y.Z` | Exact release |',
      '',
      heading,
      '',
      '**This list is a public promise.**',
      '',
      '| `OS_DATABASE_URL` scheme | Driver package installed in the image |',
      '|:---|:---|',
      ...rows,
      '',
      ...(trailer
        ? ['**Not in the image:** `tedious` and `@objectstack/driver-turso`.', '']
        : []),
      '## Something else',
      '',
    ].join('\n');

    const CLEAN_ROWS = [
      '| `postgres://`, `postgresql://` | `pg@^8.0.0` |',
      '| `mysql://`, `mysql2://` | `mysql2@^3.0.0` |',
    ];

    const driverFixture = (name, installLines, rows, readmeOptions) => {
      write(`${name}/${DRIVER_PROMISE.dockerfile}`, driverDockerfile(installLines));
      write(`${name}/${DRIVER_PROMISE.readme}`, driverReadme(rows, readmeOptions));
      return checkDriverPromise({ root: join(dir, name) });
    };

    const driverClean = driverFixture('drv-clean', CLEAN_INSTALL, CLEAN_ROWS);
    assert(
      driverClean.findings.length === 0,
      `an agreeing Dockerfile/README pair reports zero findings -- got ${JSON.stringify(driverClean.findings.map((f) => `${f.kind}@${f.file}:${f.line}`))}`,
    );
    // ...and it really did look. Both sides non-zero and MATCHED is the assertion
    // that separates "the lists agree" from "neither list was found".
    assert(
      driverClean.stats.installed === 2 && driverClean.stats.promised === 2 && driverClean.stats.matched === 2,
      'the clean run compared 2 installed against 2 promised and matched both -- '
        + `got ${JSON.stringify(driverClean.stats)}`,
    );

    // The exclusions, asserted directly rather than inferred from the green above.
    const cleanInstalled = extractInstalledDrivers(driverDockerfile(CLEAN_INSTALL));
    assert(
      cleanInstalled.drivers.map((d) => d.raw).join(',') === 'pg@^8.0.0,mysql2@^3.0.0',
      `the install line yields exactly the two driver specs, quotes stripped -- got ${JSON.stringify(cleanInstalled.drivers.map((d) => d.raw))}`,
    );
    assert(
      !cleanInstalled.drivers.some((d) => d.name === '@objectstack/cli'),
      'the CLI is not a driver: an interpolated `@objectstack/cli@${OS_CLI_VERSION}` must be excluded by NAME, '
        + 'or this limb would demand a README row for the runtime itself',
    );
    assert(
      !cleanInstalled.drivers.some((d) => ['cache', 'clean', 'force', 'npm'].includes(d.name)),
      `the \`&& npm cache clean --force\` tail contributes no packages -- got ${JSON.stringify(cleanInstalled.drivers.map((d) => d.name))}`,
    );
    const cleanPromised = extractPromisedDrivers(driverReadme(CLEAN_ROWS));
    assert(
      cleanPromised.drivers.map((d) => d.raw).join(',') === 'pg@^8.0.0,mysql2@^3.0.0',
      `the promise table yields exactly the two specs from its LAST cells -- got ${JSON.stringify(cleanPromised.drivers.map((d) => d.raw))}`,
    );
    assert(
      !cleanPromised.drivers.some((d) => d.name.includes('://')),
      'the backticked `OS_DATABASE_URL` schemes in the first cell are not package specs -- reading them as '
        + `promises would redden every honest table. Got ${JSON.stringify(cleanPromised.drivers.map((d) => d.name))}`,
    );
    assert(
      !cleanPromised.drivers.some((d) => d.name === 'tedious' || d.name === '@objectstack/driver-turso'),
      'the "Not in the image" prose BELOW the table is not a promise -- only the first table under the '
        + `heading is read. Got ${JSON.stringify(cleanPromised.drivers.map((d) => d.name))}`,
    );
    assert(
      extractPromisedDrivers(driverReadme(CLEAN_ROWS)).drivers[0].line
        === driverReadme(CLEAN_ROWS).split('\n').findIndex((l) => l.includes('`pg@^8.0.0`')) + 1,
      'a promised driver reports the 1-based line of its own table row, so DRIVER-RANGE-MISMATCH points at '
        + 'the row an author must edit',
    );
    assert(
      splitPackageSpec('@objectstack/driver-turso@^17.2.0').name === '@objectstack/driver-turso'
        && splitPackageSpec('pg@^8.0.0').range === '^8.0.0'
        && splitPackageSpec('tedious').range === '',
      'a spec splits on the LAST `@` at a non-zero index, so a scoped name survives and a bare name has no '
        + 'range',
    );

    // One deliberate defect per finding kind.
    const driverUndocumented = driverFixture('drv-undoc', CLEAN_INSTALL, [CLEAN_ROWS[0]]);
    assert(
      driverUndocumented.findings.length === 1
        && driverUndocumented.findings[0].kind === 'DRIVER-UNDOCUMENTED',
      'a driver installed but absent from the table is DRIVER-UNDOCUMENTED -- otherwise the image grows a '
        + `dependency every user carries, unpublished. Got ${JSON.stringify(driverUndocumented.findings)}`,
    );

    const driverOverpromised = driverFixture('drv-over', CLEAN_INSTALL, [
      ...CLEAN_ROWS,
      '| `mssql://` | `tedious@^18.0.0` |',
    ]);
    assert(
      driverOverpromised.findings.length === 1
        && driverOverpromised.findings[0].kind === 'DRIVER-OVERPROMISED',
      'a row promising a driver the image does not install is DRIVER-OVERPROMISED -- this is the finding '
        + `that stands between a reader and a boot-time \`Cannot find module\`. Got ${JSON.stringify(driverOverpromised.findings)}`,
    );

    const driverRange = driverFixture('drv-range', CLEAN_INSTALL, [
      '| `postgres://` | `pg@^7.0.0` |',
      CLEAN_ROWS[1],
    ]);
    assert(
      driverRange.findings.length === 1 && driverRange.findings[0].kind === 'DRIVER-RANGE-MISMATCH',
      'the same package at a different range is DRIVER-RANGE-MISMATCH -- a set comparison alone would call '
        + `this pair agreed. Got ${JSON.stringify(driverRange.findings)}`,
    );

    const driverUnranged = driverFixture('drv-unranged', [
      'RUN npm install -g \\',
      '      @objectstack/cli@${OS_CLI_VERSION} \\',
      '      pg \\',
      '      "mysql2@^3.0.0" \\',
      ' && npm cache clean --force',
    ], CLEAN_ROWS);
    assert(
      driverUnranged.findings.some((finding) => finding.kind === 'DRIVER-UNRANGED'),
      'an install with no version range is DRIVER-UNRANGED -- a CVE backfill of an OLD release would '
        + `otherwise pick up whatever major is newest that day. Got ${JSON.stringify(driverUnranged.findings.map((f) => f.kind))}`,
    );

    const driverNoHeading = driverFixture('drv-noheading', CLEAN_INSTALL, CLEAN_ROWS, {
      heading: '## Some other section',
    });
    assert(
      driverNoHeading.findings.length === 1
        && driverNoHeading.findings[0].kind === 'DRIVER-ANCHOR-LOST'
        && driverNoHeading.findings[0].file === DRIVER_PROMISE.readme,
      'a README that lost the promise heading is DRIVER-ANCHOR-LOST, not a pass -- this is the exact state '
        + `the tree was in before #14510. Got ${JSON.stringify(driverNoHeading.findings)}`,
    );
    assert(
      driverNoHeading.stats.installed === 0 && driverNoHeading.stats.promised === 0,
      'a lost anchor contributes nothing to the counts, so the scope line cannot overstate what was compared',
    );

    const driverNoInstall = driverFixture('drv-noinstall', ['RUN echo hello'], CLEAN_ROWS);
    assert(
      driverNoInstall.findings.some(
        (finding) => finding.kind === 'DRIVER-ANCHOR-LOST' && finding.file === DRIVER_PROMISE.dockerfile,
      ),
      'a Dockerfile whose install line was re-spelled past the anchor is DRIVER-ANCHOR-LOST -- otherwise '
        + `this limb reports OK over a comparison it never made. Got ${JSON.stringify(driverNoInstall.findings.map((f) => f.kind))}`,
    );

    const driverEmptyInstall = driverFixture('drv-emptyinstall', [
      'RUN npm install -g @objectstack/cli@${OS_CLI_VERSION} \\',
      ' && npm cache clean --force',
    ], CLEAN_ROWS);
    assert(
      driverEmptyInstall.findings.some((finding) => finding.kind === 'DRIVER-LIST-EMPTY'),
      'an install line carrying only the CLI is DRIVER-LIST-EMPTY -- two empty-ish sides must not compare '
        + `equal, which is the vacuous green this limb would otherwise have. Got ${JSON.stringify(driverEmptyInstall.findings.map((f) => f.kind))}`,
    );

    const driverEmptyTable = driverFixture('drv-emptytable', CLEAN_INSTALL, []);
    assert(
      driverEmptyTable.findings.some(
        (finding) => finding.kind === 'DRIVER-LIST-EMPTY' && finding.file === DRIVER_PROMISE.readme,
      ),
      'a promise heading with no driver rows under it is DRIVER-LIST-EMPTY -- a heading is not a promise. '
        + `Got ${JSON.stringify(driverEmptyTable.findings.map((f) => f.kind))}`,
    );

    write('drv-missing/docker/README.md', driverReadme(CLEAN_ROWS));
    const driverMissing = checkDriverPromise({ root: join(dir, 'drv-missing') });
    assert(
      driverMissing.findings.length === 1
        && driverMissing.findings[0].kind === 'MISSING-SURFACE'
        && driverMissing.findings[0].file === DRIVER_PROMISE.dockerfile,
      `a vanished side of the pair is MISSING-SURFACE, not a skip. Got ${JSON.stringify(driverMissing.findings)}`,
    );

    // ── The LIVE driver control (#14510, in situ) ───────────────────────────
    //
    // The fixtures prove the limb can go red. This proves it is pointed at the
    // real pair, which still carries a real list -- the assertion that catches
    // both files being rewritten past their anchors at once, which no hermetic
    // fixture can see.
    battery('The LIVE driver control (#14510, in situ)');
    const liveDrivers = checkDriverPromise({ root: scriptRepoRoot() });
    assert(
      liveDrivers.findings.length === 0,
      `the live docker/ pair agrees -- got ${JSON.stringify(liveDrivers.findings.map((f) => `${f.kind}@${f.file}:${f.line}`))}`,
    );
    assert(
      liveDrivers.stats.installed >= 2 && liveDrivers.stats.matched === liveDrivers.stats.installed,
      'the real image installs at least the two ruled drivers and every one of them is published -- '
        + `got ${JSON.stringify(liveDrivers.stats)}`,
    );

    // ── The green states its own scope ──────────────────────────────────────
    battery('The green states its own scope');
    const line = summarise(clean.stats, expected, proseClean.stats, driverClean.stats);
    assert(
      line.includes('3 concrete pin(s) compared') && line.includes('4 rolling/floating tag(s) skipped'),
      `the summary names every count, so a green can be read for its scope -- got "${line}"`,
    );
    assert(
      line.includes('2 anchored prose claim(s)') && line.includes('2 enumerated claim site(s)'),
      `the summary names the prose counts too -- got "${line}"`,
    );
    assert(
      line.includes('2 driver(s) installed') && line.includes('2 promised') && line.includes('(2 matched by name)'),
      `the summary names the driver counts too, so this limb's green can be read for its scope -- got "${line}"`,
    );
    // A 3-argument call is still legal (the pin+prose scope line), and must not
    // invent driver counts it was not given.
    assert(
      !summarise(clean.stats, expected, proseClean.stats).includes('driver(s) installed'),
      'summarise() omits the driver clause when it is given no driver stats, rather than printing zeroes '
        + 'that read as a comparison that happened',
    );
    // The scope line is printed under a FAILING run as well, so it must not word
    // itself as a verdict -- observed contradicting its own findings before this.
    assert(
      !summarise(clean.stats, expected, proseDirty.stats).includes('version-free'),
      'the scope line states what was SCANNED, not what was concluded -- the same line prints above a list '
        + `of PROSE-VERSION findings. Got "${summarise(clean.stats, expected, proseDirty.stats)}"`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ───
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  const floorFailure = (message) => {
    failures.push(message);
  };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned ` +
        `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of seen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in ` +
        'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = seen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. ` +
          'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of ` +
          `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the ' +
        'number. Find what stopped registering (an early return, a deleted block, a guard that now ' +
        'skips) and restore it.',
    );
  }
  if (failures.length) {
    console.error(`✗ check-docs-image-tag --self-test -- ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-docs-image-tag --self-test: ${checked} assertions over a temp fixture (real checkSurfaces and `
    + "checkProseClaims paths) plus live controls on docker/README.md's tag table and on PROSE_CLAIMS; every "
    + 'limb -- stale pin, rotted enumeration, missing surface, stale PROSE claim, lost prose anchor, unknown '
    + 'anchor, undocumented driver, overpromised driver, driver range mismatch, unranged driver install, '
    + 'lost driver anchor on either side, empty driver list on either side -- observed FAILING, and the '
    + 'X.Y.Z metavariable, the historical "removed in 17.0.0" sentences, the upgrade-checklist rows, the '
    + "reader's own app version, the interpolated CLI pin, the `npm cache clean` tail, the backticked "
    + 'URL schemes and the "not in the image" prose observed EXCLUDED.',
  );

  return SELF_TEST_VERDICT;
}

// ---------------------------------------------------------------------------

function main() {
  const root = scriptRepoRoot();
  const expected = loadExpectedVersion(join(root, VERSION_SOURCE));
  const { findings, stats } = checkSurfaces({ surfaces: SURFACES, expected, root });
  const prose = checkProseClaims({ claims: PROSE_CLAIMS, root });
  const drivers = checkDriverPromise({ root });
  process.exit(
    report([...findings, ...prose.findings, ...drivers.findings], stats, expected, prose.stats, drivers.stats),
  );
}

// Entry-point guard (#9064). Without it, importing this module RUNS the check and
// calls `process.exit()` as an import side effect -- measured: a probe importing
// SURFACES never reached its own next line, because `main()` had already exited the
// process for it. That makes the exports unusable by the one consumer they were added
// for, and the failure is silent in the worst way: the exit code is the CORPUS's
// verdict, so an importer looks fine while the corpus is green and dies with an
// unrelated exit 1 the day a pin goes stale. The idiom is the repo's own, and the
// sibling gates state the same rationale (check-adr-links, check-doc-anchors,
// check-kernel-hook-pairs). Nothing about what this gate ASSERTS changes: both
// `check:docs-image-tag` invocations run this file directly, where argv[1] is this
// file and the branch is taken exactly as before.
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if ((await selfTest()) !== SELF_TEST_VERDICT) {
        console.error(
            '\n✗ check-docs-image-tag self-test: selfTest() returned without reaching its verdict,\n'
                + 'so no success line was printed. Exiting 0 here would report a self-test\n'
                + 'that never finished as a self-test that passed.\n',
        );
        process.exit(1);
    }
  } else {
    main();
  }
}
