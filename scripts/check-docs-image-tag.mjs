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
// track the CLI version. The reference pages alone carry ~30 sentences of the
// form "removed in @objectstack/spec 17.0.0" -- historical facts about the
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
// The ~30 "removed in @objectstack/spec 17.0.0" sentences are untouched: they are
// in neither an enumerated file nor an anchored claim.
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
export function summarise(stats, expected, proseStats) {
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
  return (
    `${pins}; ${proseStats.matched} anchored prose claim(s) from `
    + `${proseStats.claims} enumerated claim site(s) scanned for concrete versions`
  );
}

function report(findings, stats, expected, proseStats) {
  if (findings.length === 0) {
    console.log(`check-docs-image-tag: OK (${summarise(stats, expected, proseStats)}).`);
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
  console.error(`Scope of this run: ${summarise(stats, expected, proseStats)}.`);
  return 1;
}

// ---------------------------------------------------------------------------
// Self-test -- every limb has a positive control, each paired with its green.
// ---------------------------------------------------------------------------

async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (condition, message) => {
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
    const positions = extractOccurrences('a\nb ghcr.io/objectstack-ai/objectstack:1.2.3 c\n');
    assert(positions.length === 1, `an anchored tag mid-line is found once -- got ${positions.length}`);
    assert(positions[0].line === 2 && positions[0].column === 3, `line/column are 1-based -- got ${positions[0].line}:${positions[0].column}`);
    assert(positions[0].raw === 'ghcr.io/objectstack-ai/objectstack:1.2.3', `the raw match is the whole anchored token -- got ${positions[0].raw}`);
    assert(
      extractOccurrences('17.0.0 and 1.2.3 are versions').length === 0,
      'a bare version-shaped string with NO anchor is not an occurrence -- this is what keeps the gate off '
        + 'the ~30 "removed in @objectstack/spec 17.0.0" sentences in content/docs/references/**',
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

    // ── The green states its own scope ──────────────────────────────────────
    const line = summarise(clean.stats, expected, proseClean.stats);
    assert(
      line.includes('3 concrete pin(s) compared') && line.includes('4 rolling/floating tag(s) skipped'),
      `the summary names every count, so a green can be read for its scope -- got "${line}"`,
    );
    assert(
      line.includes('2 anchored prose claim(s)') && line.includes('2 enumerated claim site(s)'),
      `the summary names the prose counts too -- got "${line}"`,
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

  if (failures.length) {
    console.error(`✗ check-docs-image-tag --self-test -- ${failures.length} failure(s)\n`);
    for (const failure of failures) console.error(`  • ${failure}`);
    process.exit(1);
  }
  console.log(
    `✓ check-docs-image-tag --self-test: ${checked} assertions over a temp fixture (real checkSurfaces and `
    + "checkProseClaims paths) plus live controls on docker/README.md's tag table and on PROSE_CLAIMS; every "
    + 'limb -- stale pin, rotted enumeration, missing surface, stale PROSE claim, lost prose anchor, unknown '
    + 'anchor -- observed FAILING, and the X.Y.Z metavariable, the historical "removed in 17.0.0" sentences, '
    + "the upgrade-checklist rows and the reader's own app version observed EXCLUDED.",
  );
}

// ---------------------------------------------------------------------------

function main() {
  const root = scriptRepoRoot();
  const expected = loadExpectedVersion(join(root, VERSION_SOURCE));
  const { findings, stats } = checkSurfaces({ surfaces: SURFACES, expected, root });
  const prose = checkProseClaims({ claims: PROSE_CLAIMS, root });
  process.exit(report([...findings, ...prose.findings], stats, expected, prose.stats));
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
if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    main();
  }
}
