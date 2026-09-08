#!/usr/bin/env tsx
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui pin CITATION gate — spec prose that claims to name the pin this repo
 * builds against must actually name it (#10274).
 *
 *   pnpm --filter @objectstack/spec check:objectui-pin-citations
 *   pnpm --filter @objectstack/spec check:objectui-pin-citations --self-test
 *   pnpm --filter @objectstack/spec check:objectui-pin-citations --list
 *   pnpm --filter @objectstack/spec exec tsx \
 *     scripts/check-objectui-pin-citations.ts --verify-anchors   # needs ../objectui
 *
 * ## WHY THIS EXISTS
 *
 * `packages/spec/src` carries READ-POINT RECORDS: docblocks and test-block
 * headers that say "this key is LIVE, and here is the objectui file:line that
 * reads it". They exist for exactly one reason — so a liveness sweep does not
 * have to re-derive a cross-repo read point before it can rule on a key. The
 * measured cost of the absence was a full dispatch cycle (#9397), which is what
 * bought #9881 and #9972.
 *
 * A read point is only re-checkable if the reader knows WHICH objectui tree the
 * line numbers were counted in, so each record anchors itself to the pin:
 * "the objectui pin this repo builds against (`.objectui-sha` = `<sha>`)".
 *
 * Nothing linked that sentence to the pin file. #10137 moved `.objectui-sha`
 * and four records went on asserting a pin the repo no longer builds against.
 * The records did not become WRONG — the anchors still held — they became
 * UNVERIFIABLE, which is the precise state they were written to end: an auditor
 * who checks the anchor finds a sha that is not the pin and is back to not
 * knowing whether the line numbers hold. And the class recurs on EVERY pin bump,
 * silently, because prose has no dependency edge.
 *
 * This gate is that edge. A citation in the asserting spelling must equal the
 * pin file, so the next bump fails loudly on the records it invalidates.
 *
 * ## THE TWO SPELLINGS, AND WHY THE DISTINCTION IS THE WHOLE DESIGN
 *
 * Two different things get said about a sha in this tree, and only one of them
 * can rot:
 *
 *   ASSERTING   `.objectui-sha` = `<sha>`        "this IS the pin we build against"
 *   HISTORICAL  `.objectui-sha` pin `<sha>`      "this is where the measurement was taken"
 *
 * The asserting form makes a claim about TODAY and is checked against the pin
 * file. The historical form is a dated record of a past measurement — #5010's
 * ruling being absorbed at pin `09987b68`, a renderer's branch semantics
 * measured at `665661ab0932` — and a later pin bump does not falsify it. Forcing
 * those to the current pin would demand re-measuring settled history on every
 * bump, and rewriting the sha without re-measuring would be a lie the gate had
 * manufactured.
 *
 * So the SPELLING is load-bearing: it is how an author declares which claim they
 * are making, and the gate enforces the one they chose.
 *
 * ## WHY AN UNRECOGNISED SPELLING IS A FAILURE, NOT A SKIP
 *
 * A source scan sees only the spellings it knows, and an unrecognised one
 * produces no flag — no declaration, SILENTLY (AGENTS.md states this for
 * `check:cross-package-test-inputs`, which learned it the hard way). So a
 * `.objectui-sha` mention that names a sha-shaped token in NEITHER form is a
 * hard failure asking the author to pick one. That is what keeps the population
 * honest: you cannot leave the gate's field of view by phrasing around it.
 *
 * Three of these existed when the gate landed and were normalised with it — two
 * citations that WRAPPED across comment lines, and one parenthetical that omitted
 * the keyword. (Wrapping is handled generally now, see below; the keyword is not.)
 *
 * ## WHAT IS DELIBERATELY OUT OF POPULATION
 *
 *   - **`.objectui-sha` mentions that name no sha** ("measured at the
 *     `.objectui-sha` pin", pointing at a FILE rather than a line). Nothing in
 *     them can rot: they make no falsifiable claim about a particular tree.
 *     They are skipped, not excused.
 *   - **Everything outside `packages/spec/src`.** CHANGELOGs, `.changeset/*.md`
 *     and `content/docs/releases/**` are HISTORICAL RECORDS by construction —
 *     a released note describing the pin at release time must never be rewritten
 *     to today's pin. `examples/**` dogfood records ("verified in a browser at
 *     pinned objectui `82a94170c405`") are dated observations, the historical
 *     form in different words. `scripts/objectui-changeset-digest.mjs` names
 *     `.changeset/console-82a94170c405.md` — a FILENAME in a worked example, not
 *     a citation at all. None of these is a claim about the current pin, so none
 *     joins the population. Widening to another package's sources is a later
 *     decision, and would want that package's records read first.
 *
 * ## WHY IT SCANS RAW TEXT AND NOT `scripts/js-comment-mask.mjs`
 *
 * That helper is the one answer to "is this span comment or code?", and every
 * gate that must DECIDE that question owes it the call. This gate does not have
 * the question: a pin citation is a pin citation wherever it is written, and a
 * `.objectui-sha` sha in a string literal would be just as much a claim as one
 * in a docblock. Nothing is stripped here, so there is no private
 * `stripComments` to drift.
 *
 * Wrapped prose IS handled, because a record that spans two comment lines is
 * ordinary and must not have to be reflowed for a matcher's convenience: each
 * line's comment decoration is peeled and the lines are joined before matching,
 * with a per-character map back to the original line so a failure reports the
 * line a reader can open.
 *
 * ## THE SECOND CRITERION: WHAT THE CITED LINE SAYS
 *
 * Everything above is a check on the sha LABEL. A read-point record is not a
 * claim about a sha, though — it is a claim about a LINE'S CONTENT, and the
 * label is only how a reader knows which tree to count that line in. That gap
 * has now been measured twice. #10274 re-read four records at a new pin and
 * found two anchors that had been WRONG SINCE THEY WERE WRITTEN; the rework of
 * the next bump re-read eight and found three more:
 *
 *   recorded `plugin-grid/src/ObjectGrid.tsx:3790-3805`, which is
 *     `runBulkActionAggregate` — the selection gating is at `:3544-3559`
 *   recorded `plugin-dashboard/src/index.tsx:161`, which is a docblock
 *     sentence — the object-metric `icon` input is at `:204`
 *   recorded `button.tsx:70-87` / `:88-92`, which are JSX — the registration's
 *     inputs and `defaultProps` are at `:85-102` / `:103-107`
 *
 * Every one of those files is byte-identical across the pin hop. So no sha
 * refresh could surface them, no line-number refresh could surface them, and
 * the label check above ran green over all three. Only a RE-READ finds this
 * class, and nothing in the record made a re-read cheaper than a re-derivation.
 *
 * ## PUTTING THE CONTENT INTO THE LABEL
 *
 * Beside an anchor an author may quote the first non-blank line of the cited
 * range, and this gate checks the quote against objectui at the pin:
 *
 *     `plugin-dashboard/src/index.tsx:204` first line
 *     `{ name: 'icon', type: 'string', label: 'Icon (Lucide name)' },`
 *
 * A range hash would also be machine-checkable and was the other candidate.
 * It is rejected: a hash is opaque, so a reader cannot see what it asserts, and
 * a hash that is stable but WRONG teaches nothing — it would re-create this
 * exact defect one level up. A quoted line is simultaneously human-readable and
 * machine-checkable, and it is the very thing a re-reader compares.
 *
 * Note what the quoted line does to the three rows above. `:161` quoted reads
 * "* binding onto the props {@link ObjectMetricWidget} reads" — prose, visibly
 * not an input declaration, in a record whose sentence claims it is one. The
 * error stops being invisible and becomes something a reviewer sees in the diff.
 *
 * ## WHAT THIS CAN AND CANNOT DO — the honest boundary
 *
 * ⛔ No mechanical check can tell a genuine re-read from a careful rewrite, and
 * this one does not claim to: a script that copied whatever sits at the cited
 * line would produce an assertion that verifies. What the design does is remove
 * the ROUTINE reason to touch a quote and make the remaining ones loud.
 *
 *   - On a pin bump that shifts line numbers, the gate does not merely fail: it
 *     SEARCHES the file for the quoted line and names where it now is. So the
 *     ordinary bump is a line-number edit and the quote never moves.
 *   - Which makes a diff that REWRITES a quote a claim that the read point's
 *     content changed — rare, and reviewable as prose. Before this, a bump
 *     rewrote numbers everywhere and nothing stood out.
 *   - And the quote is checked at the moment it is WRITTEN, against the real
 *     tree, so an author who mis-copies is told immediately.
 *
 * ⚠️ Coverage is a ratchet, not a migration. Requiring an assertion on every
 * anchor at once would force a bulk fill of ~100 quotes, and a quote copied
 * without a re-read reproduces this defect at scale — strictly worse than the
 * gap. So `ASSERTED_ANCHOR_FLOOR` holds coverage at an equality that may only
 * be raised, `--verify-anchors` prints the remaining worklist at the one moment
 * someone is already re-reading anchors, and no `gen:` fills any of it.
 *
 * ## CROSS-REPO AVAILABILITY IS A VERDICT, NOT A DETAIL
 *
 * Verification needs objectui at the pin, and `../objectui` is absent in CI
 * (`lint.yml` runs this gate on a checkout of this repo alone) and in every
 * sibling worktree. Requiring it would make the gate unrunnable, which is a
 * worse failure than the one being closed. So:
 *
 *   - the ORDINARY run does not require the pin — and ⛔ never skips silently:
 *     it prints how many assertions it could NOT verify, so a green run always
 *     states how much it actually measured;
 *   - `--verify-anchors`, the pin-bump mode, goes RED when it cannot read the
 *     pin, because there unavailability defeats the entire purpose.
 *
 * ## WHY THERE IS NO `gen:` THAT FIXES THIS
 *
 * The obvious automation — rewrite every cited sha to the pin — is the one thing
 * this gate must never do, and the reason is the failure it exists to catch. The
 * sha is not the record; the FILE:LINE ANCHORS are, and they are only true of the
 * tree they were counted in. A find-and-replace would make every record CLAIM the
 * current pin while its anchors still described the old one — converting a loud,
 * accurate "unverifiable" into a silent, confident lie, which is strictly worse
 * than the rot. Re-measuring is a human/agent act, and #10274 is why that is not
 * theoretical: re-measuring at the new pin found that two of the four anchors had
 * been WRONG SINCE THEY WERE WRITTEN (`662-665` and `851-853` truncated JSX
 * expressions that really span `662-668` and `851-857` — identical at both pins,
 * so a sha-only rewrite would have preserved both errors and hidden them behind a
 * fresh-looking sha).
 *
 * Hence NO_GENERATOR in the `check:generated` ledger, for
 * `check:browser-reachable-entries`' reason exactly: a `gen:` here would grant by
 * running a command the one thing that has to be earned by measurement.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '..');
const REPO = path.resolve(SPEC, '../..');
const SRC = path.join(SPEC, 'src');
const PIN_FILE = path.join(REPO, '.objectui-sha');

/**
 * ## The dispatch-gates declaration — the root-FILE idiom
 *
 * `scripts/pm/dispatch-gates.mjs` derives the gate families a card must run
 * from the paths it touches, and it learns a gate's population by scanning the
 * gate's own SOURCE TEXT for path-shaped literals (`extractWatchHints`). Every
 * path this gate reads is COMPUTED — `PIN_FILE` from `REPO`, `SRC` from
 * `SPEC` — so the extractor found nothing here and this gate had no population
 * at all. Measured on `7bf96cfd0`, before this declaration existed:
 *
 *     node scripts/pm/dispatch-gates.mjs --commands .objectui-sha --repo objectstack-ai/objectstack
 *     -> 12 commands (5 matched by path), 0 of them naming check:objectui-pin-citations
 *
 * and on the same specimen with it, 13 commands (6 matched by path), the new
 * one being `pnpm --filter @objectstack/spec run check:objectui-pin-citations`.
 *
 * A change set consisting only of the pin file is EXACTLY the class this gate
 * exists for — a pin bump is the one event that invalidates an asserting
 * citation — and it was the class that never derived it. The measured cost was
 * a full CI cycle: a pin bump ran 47 derived commands green and then redded
 * here on 8 stale citations, discovered a cycle late.
 *
 * ⛔ The declaration is the POPULATION, never a hand list of the citing files.
 * They are discovered by regex on purpose (`sourceFiles(SRC)` + `scanFile`), so
 * a list of today's citers is stale the moment a record is written or moved —
 * the same reason `check:merge-driver` refuses a hand list of generator names.
 *
 * A bare `.objectui-sha` carries no path separator and reaches the extractor as
 * a bare word; the trailing `/` + `**` suffix is the sanctioned escape for a
 * repo-ROOT file — `collapseHint` reduces it back to the literal filename, so
 * it claims the root file and no same-named file inside a directory. Nothing in
 * this tree lives under `.objectui-sha/`, so it claims no directory either.
 * Measured through `hintCovers`, the sole predicate:
 *
 *     hintCovers('.objectui-sha/**', '.objectui-sha')  -> true
 *     collapseHint('.objectui-sha/**')                 -> '.objectui-sha'
 *
 * `check-doc-anchors.mjs` declares `README.md`/`ARCHITECTURE.md` this way and
 * `git-merge-regen.mjs` declares `package.json` this way; the sibling package-
 * scoped gate `check-llms-txt.ts` proves the idiom reaches a gate invoked
 * through a pnpm filter — dispatch-gates resolves the `--filter` script back to
 * this file and reads it as `gate source`, exactly as it does for that one.
 *
 * ⚠️ Provenance, NOT a lookup key. Nothing here is joined with `REPO` and
 * stat'd: `PIN_FILE` and `SRC` remain the paths this gate opens. The glob form
 * used as a path would resolve to nothing and `existsSync` would drop it
 * SILENTLY — the "checked nothing, reported green" disease this gate's own
 * vacuous-green guard exists to refuse. `selfTest` pins both halves.
 */
const ROOT_FILE_WATCH_HINTS = ['.objectui-sha/**'];

/**
 * The other half of the population: the SUBTREE this gate walks for citations.
 *
 * A pin bump is not the only way a citation goes stale — writing a new record,
 * or moving one, changes what this gate has to say about the SAME pin. The
 * glob sits in the FINAL segment, so `hintCovers` reaches every source beneath
 * `packages/spec/src` and nothing outside it, which is precisely the scope
 * `sourceFiles(SRC)` walks (the header's "everything outside `packages/spec/src`"
 * exclusion is the same boundary, stated from the other side).
 */
const ROOT_DIR_WATCH_HINTS = ['packages/spec/src/**'];

const LIST = process.argv.includes('--list');
/** The pin-bump mode: verifies anchors against objectui, and REDS if it cannot read it. */
const VERIFY_ANCHORS = process.argv.includes('--verify-anchors');

/** How far past a `.objectui-sha` mention a citation may reach. */
const WINDOW = 160;

/**
 * A sha-shaped token: hex, at least git's 7-char abbreviation floor, and
 * carrying at least one DIGIT.
 *
 * The digit is what keeps the "unrecognised spelling" arm from firing on prose:
 * `[0-9a-f]{7,}` alone matches ordinary English words (`defaced`, `effaced`), and
 * this gate's unclassified arm is a hard failure, so a false positive there costs
 * a reader real time. Every abbreviated git sha in this tree carries a digit.
 */
const SHA_TOKEN = String.raw`(?=[0-9a-f]*[0-9])[0-9a-f]{7,40}`;

const MENTION = /`?\.objectui-sha`?/g;
const ASSERTING = new RegExp(String.raw`^\`?\.objectui-sha\`?\s*=\s*\`(${SHA_TOKEN})\``, 'i');
const HISTORICAL = new RegExp(String.raw`^\`?\.objectui-sha\`?\s+pin\s*\(?\s*\`(${SHA_TOKEN})\``, 'i');
/** Same two, with the backticks around the sha missing — a near-miss, not a new form. */
const ASSERTING_BARE = new RegExp(String.raw`^\`?\.objectui-sha\`?\s*=\s*(${SHA_TOKEN})\b`, 'i');
const HISTORICAL_BARE = new RegExp(String.raw`^\`?\.objectui-sha\`?\s+pin\s*\(?\s*(${SHA_TOKEN})\b`, 'i');
const ANY_SHA = new RegExp(String.raw`\b${SHA_TOKEN}\b`, 'i');

type Citation = {
  file: string;
  line: number;
  kind: 'asserting' | 'historical';
  sha: string;
};

type Problem = { file: string; line: number; message: string[] };

// ---------------------------------------------------------------------------
// Flattening — a citation that wraps across comment lines is still one citation
// ---------------------------------------------------------------------------

type Flat = { text: string; lineOf: number[] };

/**
 * Peel each line's comment decoration and join, keeping a per-character map back
 * to the original 1-based line number.
 *
 * Blank-and-keep-offsets (the `js-comment-mask` discipline) is not available
 * here: the whole point is to CLOSE the gap a wrap opens, which necessarily
 * moves offsets. The line map is what preserves the property that matters — a
 * failure names a line a reader can open.
 */
export function flatten(source: string): Flat {
  const lines = source.split('\n');
  let text = '';
  const lineOf: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const content = raw.replace(/^\s*(?:\/\/+|\/\*+|\*+\/?)\s?/, '');
    for (let k = 0; k < content.length; k++) {
      text += content[k];
      lineOf.push(i + 1);
    }
    text += ' ';
    lineOf.push(i + 1);
  }
  return { text, lineOf };
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

export function scanFile(rel: string, source: string): { citations: Citation[]; problems: Problem[] } {
  const citations: Citation[] = [];
  const problems: Problem[] = [];
  const { text, lineOf } = flatten(source);

  MENTION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION.exec(text)) !== null) {
    const at = m.index;
    const line = lineOf[at] ?? 0;
    const window = text.slice(at, at + WINDOW);

    const asserting = ASSERTING.exec(window);
    if (asserting) {
      citations.push({ file: rel, line, kind: 'asserting', sha: asserting[1]!.toLowerCase() });
      continue;
    }
    const historical = HISTORICAL.exec(window);
    if (historical) {
      citations.push({ file: rel, line, kind: 'historical', sha: historical[1]!.toLowerCase() });
      continue;
    }

    const bare = ASSERTING_BARE.exec(window) ?? HISTORICAL_BARE.exec(window);
    if (bare) {
      problems.push({
        file: rel,
        line,
        message: [
          `the cited sha \`${bare[1]}\` is not written in backticks.`,
          `Spell it \`` + '`' + `${bare[1]}` + '`' + `\` — the backticks are what make the citation`,
          `mechanically findable, and a citation this gate cannot find is a citation`,
          `nothing re-checks when the pin moves.`,
        ],
      });
      continue;
    }

    // Neither form. Only a failure if a sha is actually being named — a mention
    // that points at a FILE names nothing that can rot.
    if (ANY_SHA.test(window)) {
      problems.push({
        file: rel,
        line,
        message: [
          `names a sha in neither recognised citation spelling.`,
          `Pick the one that says what you mean:`,
          '',
          '  `.objectui-sha` = `<sha>`     this IS the pin we build against (checked here)',
          '  `.objectui-sha` pin `<sha>`   measured AT that pin (a dated record, not checked)',
          '',
          `An unrecognised spelling is not a pass: it leaves the citation outside every`,
          `check, which is the silent state this gate exists to remove.`,
        ],
      });
    }
  }
  return { citations, problems };
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|mts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc.sort();
}

export function readPin(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`pin file not found: ${file}`);
  }
  const raw = readFileSync(file, 'utf8').trim();
  if (!/^[0-9a-f]{40}$/i.test(raw)) {
    throw new Error(`pin file ${file} does not hold a 40-char sha: ${JSON.stringify(raw)}`);
  }
  return raw.toLowerCase();
}

// ---------------------------------------------------------------------------
// Anchor CONTENT assertions — the half a sha label cannot carry
// ---------------------------------------------------------------------------

/**
 * Where objectui is expected on disk, and the override every sibling
 * cross-repo gate already reads (`check-sdui-lockstep.mjs`'s `resolveObjectui`,
 * `objectui-changeset-digest.mjs`'s `--objectui-root`). One spelling for one
 * concept: a second env var for "where is objectui" would be a second thing to
 * get wrong.
 */
const OBJECTUI_SIBLING = '../objectui';

const ANCHOR_PATH = String.raw`[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*\.(?:tsx|ts|jsx|js|mjs|cjs|mts|json|css)`;
const ANCHOR_RANGE = String.raw`\d+(?:-\d+)?`;

/**
 * A full anchor — `` `<path>:<line>` `` or `` `<path>:<start>-<end>` `` — the
 * shape the records already write. Collected so `--verify-anchors` can say how
 * many anchors carry no content assertion yet WITHOUT a hand list of them.
 */
const ANCHOR_FULL = new RegExp(String.raw`\`(${ANCHOR_PATH}):(${ANCHOR_RANGE})\``, 'g');

/**
 * The content assertion:
 *
 *     `plugin-dashboard/src/index.tsx:204` first line
 *     `        { name: 'icon', type: 'string', label: 'Icon (Lucide name)' },`
 *
 * The path may be omitted to CONTINUE the nearest preceding anchor, because
 * that is how the records already write a second range in the same file
 * (`` `button.tsx:85-102` … `:103-107` ``).
 *
 * The quote is delimited by a run of one to three backticks, Markdown's own
 * rule, so a cited line that itself contains a backtick (a template literal, and
 * these are TSX files) is still spellable — with two.
 */
const ASSERTION = new RegExp(
  String.raw`\`(${ANCHOR_PATH})?:(${ANCHOR_RANGE})\`\s+first\s+line:?\s+(\`{1,3})(.{0,400}?)\3`,
  'g',
);

/** The same, with the quote's backticks missing — a near-miss, not a new form. */
const ASSERTION_BARE = new RegExp(
  String.raw`\`(?:${ANCHOR_PATH})?:${ANCHOR_RANGE}\`\s+first\s+line:?\s+([^\`\s][^\`]{0,60})`,
  'g',
);

export type Assertion = {
  file: string;
  line: number;
  /** The objectui path, spelled here or inherited from the nearest preceding anchor. */
  target: string;
  start: number;
  end: number;
  quote: string;
  inherited: boolean;
};

export type Anchor = { file: string; line: number; target: string; start: number; end: number };

/**
 * Compare on CONTENT, not on layout: runs of whitespace collapse and the ends
 * are trimmed.
 *
 * Indentation is not evidence of anything, and an assertion that wraps across
 * two comment lines necessarily gains a space at the join (`flatten` above) —
 * pinning exact whitespace would make the wrap unspellable, which is the same
 * mistake as making a matcher that a wrapped citation escapes.
 */
export function normaliseLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function parseRange(range: string): { start: number; end: number } {
  const [a, b] = range.split('-');
  const start = Number(a);
  return { start, end: b === undefined ? start : Number(b) };
}

/**
 * Find the content assertions and the bare anchors in one flattened source.
 *
 * ⛔ Discovered, never registered. There is no list of asserting files anywhere
 * in this gate, for `sourceFiles(SRC)`'s reason exactly: a roster of today's
 * records is stale the moment one is written or moved, and a gate whose
 * population is hand-kept is the thing this one exists to prevent.
 */
export function scanAnchors(
  rel: string,
  source: string,
): { assertions: Assertion[]; anchors: Anchor[]; problems: Problem[] } {
  const { text, lineOf } = flatten(source);
  const assertions: Assertion[] = [];
  const anchors: Anchor[] = [];
  const problems: Problem[] = [];

  // Every full anchor, in offset order — the inheritance table for continuations.
  const full: Array<{ at: number; path: string; start: number; end: number; line: number }> = [];
  ANCHOR_FULL.lastIndex = 0;
  let a: RegExpExecArray | null;
  while ((a = ANCHOR_FULL.exec(text)) !== null) {
    const { start, end } = parseRange(a[2]!);
    const line = lineOf[a.index] ?? 0;
    full.push({ at: a.index, path: a[1]!, start, end, line });
    anchors.push({ file: rel, line, target: a[1]!, start, end });
  }
  const inheritedAt = (at: number): string | null => {
    let best: string | null = null;
    for (const f of full) {
      if (f.at > at) break;
      best = f.path;
    }
    return best;
  };

  const claimed = new Set<number>();

  ASSERTION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASSERTION.exec(text)) !== null) {
    claimed.add(m.index);
    const line = lineOf[m.index] ?? 0;
    const { start, end } = parseRange(m[2]!);
    const spelled = m[1];
    const target = spelled ?? inheritedAt(m.index);
    if (target === null) {
      problems.push({
        file: rel,
        line,
        message: [
          `a content assertion on \`:${m[2]}\` names no file, and no anchor before it does either.`,
          `A continuation inherits the nearest preceding \`<path>:<line>\` anchor; with none,`,
          `there is nothing to read the line out of. Spell the path here.`,
        ],
      });
      continue;
    }
    if (end < start) {
      problems.push({
        file: rel,
        line,
        message: [`the cited range \`:${m[2]}\` ends before it starts.`],
      });
      continue;
    }
    assertions.push({
      file: rel,
      line,
      target,
      start,
      end,
      quote: normaliseLine(m[4] ?? ''),
      inherited: spelled === undefined,
    });
  }

  // Near-miss: the keyword is there, the quote is not in backticks. Same arm as
  // the bare-sha one above, and for the same reason — a spelling this gate
  // cannot find is a claim nothing re-checks.
  ASSERTION_BARE.lastIndex = 0;
  let b: RegExpExecArray | null;
  while ((b = ASSERTION_BARE.exec(text)) !== null) {
    if (claimed.has(b.index)) continue;
    problems.push({
      file: rel,
      line: lineOf[b.index] ?? 0,
      message: [
        `the asserted first line is not written in backticks.`,
        `Spell it \`` + '`' + `<the line>` + '`' + `\` (or with two backticks if the line itself`,
        `contains one) — the backticks are what make the assertion mechanically`,
        `checkable, and an unquoted one is prose nothing verifies.`,
      ],
    });
  }

  return { assertions, anchors, problems };
}

// ---------------------------------------------------------------------------
// Reading objectui at the pin — available or NAMED, never silently skipped
// ---------------------------------------------------------------------------

export type PinTree =
  | { ok: true; root: string; files: string[]; read: (p: string) => string | null }
  | { ok: false; why: string };

/**
 * Open the objectui tree at `pin`, or say why there is none.
 *
 * ⚠️ The ordinary run must survive `{ ok: false }` — `../objectui` is absent in
 * CI (`lint.yml` runs this gate on a checkout of THIS repo alone) and in every
 * sibling worktree — but it must never survive it QUIETLY. A gate that skipped
 * verification in half its environments and printed the same green as a gate
 * that verified would be exactly the "green carrying no information" this file
 * exists to remove. So the caller prints the count it could not verify, always.
 */
export function openPinTree(pin: string, env: NodeJS.ProcessEnv = process.env): PinTree {
  const root = env.OBJECTUI_ROOT ? env.OBJECTUI_ROOT : path.resolve(REPO, OBJECTUI_SIBLING);
  if (!existsSync(path.join(root, '.git'))) return { ok: false, why: `no git checkout at ${root}` };
  const git = (args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  try {
    git(['cat-file', '-e', `${pin}^{commit}`]);
  } catch {
    return { ok: false, why: `${root} has no commit ${pin.slice(0, 9)} (fetch it)` };
  }
  let files: string[];
  try {
    files = git(['ls-tree', '-r', '--name-only', pin]).split('\n').filter(Boolean);
  } catch (e) {
    return { ok: false, why: `git ls-tree failed in ${root}: ${(e as Error).message}` };
  }
  const cache = new Map<string, string | null>();
  return {
    ok: true,
    root,
    files,
    read: (p: string): string | null => {
      if (!cache.has(p)) {
        try {
          cache.set(p, git(['show', `${pin}:${p}`]));
        } catch {
          cache.set(p, null);
        }
      }
      return cache.get(p) ?? null;
    },
  };
}

/**
 * Resolve a record's path against the tree.
 *
 * Records spell anchors the way a reader says them out loud — `button.tsx`,
 * `plugin-kanban/src/index.tsx` — so a suffix match is what the population
 * needs. ⛔ An ambiguous suffix is REFUSED rather than resolved to the first
 * hit: picking one would verify a line in a file the record may not mean, which
 * is a confident wrong answer where "spell more of the path" is a cheap right
 * one.
 */
export function resolveTarget(files: string[], target: string): string[] {
  const exact = files.filter((f) => f === target);
  if (exact.length > 0) return exact;
  return files.filter((f) => f.endsWith('/' + target));
}

export type AnchorVerdict =
  | { ok: true; path: string; at: number }
  | { ok: false; kind: 'no-file'; message: string[] }
  | { ok: false; kind: 'ambiguous-file'; message: string[] }
  | { ok: false; kind: 'blank-range'; message: string[] }
  | { ok: false; kind: 'past-eof'; message: string[] }
  | { ok: false; kind: 'mismatch'; message: string[] };

/**
 * Check one assertion against the tree — and, on a mismatch, say WHERE the
 * quoted line really is.
 *
 * That relocation report is the whole ratchet. A pin bump that shifts a file's
 * line numbers used to demand a hand re-count of every anchor in it; here the
 * gate names the new number itself, so the routine motion of a bump is a
 * line-number edit and the QUOTE never moves. Which makes the converse loud: a
 * diff that rewrites a quote is claiming the read point's content changed, and
 * that is a claim a reviewer can see and weigh. Before this, a bump rewrote
 * line numbers everywhere and nothing stood out.
 *
 * And it is the same report that surfaces the class this gate was extended for:
 * an anchor that was WRONG WHEN WRITTEN, in a file byte-identical across the
 * hop, points at a line whose content is not what the record claims — no sha
 * refresh and no line-number refresh can ever move it, but a quote beside it
 * either fails to match or is visibly not the thing the record's own prose
 * describes.
 */
export function verifyAssertion(
  as: Assertion,
  files: string[],
  read: (p: string) => string | null,
): AnchorVerdict {
  const hits = resolveTarget(files, as.target);
  if (hits.length === 0) {
    return {
      ok: false,
      kind: 'no-file',
      message: [
        `no file matching \`${as.target}\` exists in objectui at this pin.`,
        `The read point moved to another file or died. ⛔ Do not re-point the anchor by`,
        `search-and-replace: RE-READ what the record claims and rewrite the claim, or say`,
        `the read point is gone.`,
      ],
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      kind: 'ambiguous-file',
      message: [
        `\`${as.target}\` matches ${hits.length} files in objectui at this pin:`,
        ...hits.slice(0, 5).map((h) => `  ${h}`),
        `Spell enough of the path to name one — a guess here would verify a line in a file`,
        `the record may not mean.`,
      ],
    };
  }
  const src = read(hits[0]!);
  if (src === null) {
    return { ok: false, kind: 'no-file', message: [`could not read \`${hits[0]}\` at this pin.`] };
  }
  const lines = src.split('\n');
  if (as.start > lines.length) {
    return {
      ok: false,
      kind: 'past-eof',
      message: [`\`${hits[0]}\` has ${lines.length} lines at this pin; the anchor cites :${as.start}.`],
    };
  }
  let at = -1;
  for (let i = as.start; i <= Math.min(as.end, lines.length); i++) {
    if (normaliseLine(lines[i - 1] ?? '') !== '') { at = i; break; }
  }
  if (at === -1) {
    return {
      ok: false,
      kind: 'blank-range',
      message: [`every line of \`${hits[0]}:${as.start}-${as.end}\` is blank at this pin.`],
    };
  }
  const actual = normaliseLine(lines[at - 1] ?? '');
  if (actual === as.quote) return { ok: true, path: hits[0]!, at };

  const found: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (normaliseLine(lines[i] ?? '') === as.quote) found.push(i + 1);
  }
  const where =
    found.length === 1
      ? [
          `That line IS in the file — at :${found[0]}, not :${at}.`,
          found[0]! === as.start
            ? `(The range's first NON-BLANK line is :${at}; :${as.start} is blank.)`
            : `Either the anchor drifted by ${found[0]! - at} lines, or it was wrong when written.`,
          `⛔ Re-READ before you re-point it: a number that lands on the quoted line is not`,
          `evidence that the record's claim about that line still holds.`,
        ]
      : found.length > 1
        ? [
            `That line appears ${found.length} times in the file (:${found.slice(0, 5).join(', :')}` +
              `${found.length > 5 ? ', …' : ''}), so it cannot locate the read point on its own.`,
            `Quote a line that is unique in the file, or narrow the range.`,
          ]
        : [
            `That line is NOWHERE in \`${hits[0]}\` at this pin — the read point moved or died.`,
            `⛔ This is not a line-number refresh. Re-READ the file and rewrite the record, or`,
            `report that the read point is gone.`,
          ];
  return {
    ok: false,
    kind: 'mismatch',
    message: [
      `the asserted first line does not match \`${hits[0]}:${at}\` at this pin.`,
      `  asserted: ${as.quote}`,
      `  actually: ${actual}`,
      ...where,
    ],
  };
}

/**
 * ## The coverage ratchet — a NUMBER, never a roster
 *
 * How many anchor content assertions `packages/spec/src` carries. Counted from
 * source text on every ordinary run, so it needs no objectui checkout and holds
 * in CI, where the pin is unreadable and nothing can be verified.
 *
 * Enforced as an EQUALITY in both directions, the `check:type-check-debt`
 * discipline: below it, coverage was deleted; above it, coverage was added and
 * the floor must be raised in the same PR so a later deletion cannot hide under
 * slack. ⛔ There is deliberately no `gen:` that rewrites this number — see the
 * header: a command that grants coverage is the one thing this gate must not
 * offer.
 *
 * It stands at 0 because the mechanism lands before the migration does: adding
 * an assertion to an existing record means RE-READING that record's cited line
 * against objectui, which is measurement, not a rewrite, and this PR does not
 * touch `packages/spec/src` at all. `--verify-anchors` prints the worklist.
 */
const ASSERTED_ANCHOR_FLOOR = 0;

// ---------------------------------------------------------------------------
// self-test — the shapes, not the corpus
// ---------------------------------------------------------------------------

function selfTest(): never {
  const failures: string[] = [];
  const PIN = '9a3daf8d37ad973a621e5edd276fe32467f90684';
  const check = (ok: boolean, what: string): void => { if (!ok) failures.push(what); };

  const scan = (src: string) => scanFile('fixture.ts', src);

  // ── the asserting form, both verdicts ───────────────────────────────────
  {
    const { citations, problems } = scan('// builds against — `.objectui-sha` = `9a3daf8d3`.\n');
    check(problems.length === 0, 'asserting/current: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'asserting', 'asserting/current: classified asserting');
    check(citations[0] !== undefined && PIN.startsWith(citations[0].sha), 'asserting/current: sha is a pin prefix');
  }
  {
    const { citations } = scan('// builds against — `.objectui-sha` = `82a94170c`.\n');
    check(citations.length === 1, 'asserting/stale: found');
    check(citations[0] !== undefined && !PIN.startsWith(citations[0].sha), 'asserting/stale: NOT a pin prefix — this is the founding failure');
  }

  // ── the historical form is NOT checked against the pin ──────────────────
  {
    const { citations, problems } = scan('// measured at the `.objectui-sha` pin `665661ab0932`: the renderer\n');
    check(problems.length === 0, 'historical: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'historical', 'historical: classified historical');
    check(citations[0] !== undefined && !PIN.startsWith(citations[0].sha), 'historical: an old sha here is legitimate, not rot');
  }
  {
    // The parenthesised variant this tree actually writes.
    const { citations, problems } = scan('// measured against objectui at the `.objectui-sha` pin (`09987b68`) rather\n');
    check(problems.length === 0, 'historical/parens: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'historical', 'historical/parens: classified historical');
  }

  // ── a citation that WRAPS is still one citation ─────────────────────────
  {
    const { citations, problems } = scan(
      '// Both re-measured at the pin this repo builds against —\n' +
      '// `.objectui-sha` = `9a3daf8d3`. These two were the first records\n',
    );
    check(problems.length === 0, 'wrapped: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'asserting', 'wrapped: found across the line break');
  }
  {
    // Wrapped BETWEEN the token and the sha — the shape that was unfindable
    // before this gate and is the reason flattening exists.
    const { citations, problems } = scan(
      ' * measured at the `.objectui-sha` pin\n' +
      ' * `82a9417` (re-verified identical at objectui `origin/main` `6c68b13`)\n',
    );
    check(problems.length === 0, 'wrapped-mid: must not be a problem');
    check(citations.length === 1 && citations[0]!.kind === 'historical', 'wrapped-mid: found across the line break');
    check(citations[0]?.line === 1, 'wrapped-mid: reports the line the mention opens on');
  }

  // ── unrecognised spellings FAIL rather than slipping through ────────────
  {
    const { citations, problems } = scan('// both read off the console build (`.objectui-sha` 6314e87f2, `plugin-grid`):\n');
    check(citations.length === 0, 'unclassified: not counted as a citation');
    check(problems.length === 1, 'unclassified: a sha in neither form must FAIL');
  }
  {
    const { problems } = scan('// builds against — `.objectui-sha` = 82a94170c.\n');
    check(problems.length === 1, 'bare sha after `=`: near-miss must FAIL');
    check(problems[0]?.message.join(' ').includes('backticks') === true, 'bare sha after `=`: message names the fix');
  }

  // ── a mention naming NO sha is skipped, and prose does not false-flag ───
  {
    const { citations, problems } = scan('// from the renderers\' read points at the `.objectui-sha` pin; see the\n');
    check(citations.length === 0 && problems.length === 0, 'sha-free mention: skipped, not excused');
  }
  {
    // The all-hex-letters English words the digit requirement exists to exclude.
    const { problems } = scan('// the `.objectui-sha` pin, whose earlier claim was defaced and effaced\n');
    check(problems.length === 0, 'hex-looking prose without a digit must not be read as a sha');
  }
  {
    // A mention inside a PATH, which is how the CLI writes it.
    const { citations, problems } = scan("const stamp = path.join(dir, 'dist', '.objectui-sha');\n");
    check(citations.length === 0 && problems.length === 0, 'a path mention names no sha and is skipped');
  }

  // ── pin-file validation ─────────────────────────────────────────────────
  {
    let threw = false;
    try { readPin(path.join(REPO, 'does-not-exist-.objectui-sha')); } catch { threw = true; }
    check(threw, 'readPin: a missing pin file must throw, never default');
  }

  // ── vacuous-green guard: the real tree must contain citations ───────────
  {
    const files = sourceFiles(SRC);
    check(files.length > 0, 'discovery: found no spec sources at all');
    let found = 0;
    for (const f of files) found += scanFile(f, readFileSync(f, 'utf8')).citations.length;
    check(found > 0, 'discovery: found zero citations in the real tree — the matcher or the scope has moved');
  }

  // ── the dispatch-gates declaration ──────────────────────────────────────
  // Enforcement cannot hold any of this: the declaration is read by ANOTHER
  // tool entirely (`extractWatchHints` in scripts/pm/dispatch-gates.mjs, off
  // source text), so a wrong, reworded or deleted entry runs perfectly green
  // here and shows up only as a dev dispatched on a `.objectui-sha` pin bump
  // who is never told this gate reads it — which is the failure that bought
  // this declaration, measured as a full CI cycle after 47 green commands.
  {
    const declared = [...ROOT_FILE_WATCH_HINTS, ...ROOT_DIR_WATCH_HINTS];
    const collapse = (h: string): string => h.replace(/\/\*+$/, '');

    // The population the declaration CLAIMS is the population this gate READS.
    check(
      ROOT_FILE_WATCH_HINTS.length === 1 && collapse(ROOT_FILE_WATCH_HINTS[0]!) === path.relative(REPO, PIN_FILE),
      `the declared root file is the pin file this gate opens: ${ROOT_FILE_WATCH_HINTS.join(', ')} vs ${path.relative(REPO, PIN_FILE)}`,
    );
    check(
      ROOT_DIR_WATCH_HINTS.length === 1 && collapse(ROOT_DIR_WATCH_HINTS[0]!) === path.relative(REPO, SRC),
      `the declared subtree is the tree this gate walks: ${ROOT_DIR_WATCH_HINTS.join(', ')} vs ${path.relative(REPO, SRC)}`,
    );

    // The separator is what makes `hintCovers` admit the entry at all — a bare
    // filename reaches it as a bare word. A reword back to `.objectui-sha`
    // leaves every other signal this gate emits green.
    check(
      declared.every((h) => h.includes('/')),
      `every declared entry carries a path separator: ${declared.join(', ')}`,
    );

    // Provenance, never a lookup key: joined with REPO these resolve to
    // nothing, and `existsSync` would drop them SILENTLY.
    check(
      declared.every((h) => !existsSync(path.join(REPO, h))),
      `the declared spellings are provenance, not paths: ${declared.join(', ')}`,
    );

    // …and the declared subtree really covers the live population, so a
    // narrowing of either side cannot pass unnoticed.
    const declaredSrc = path.join(REPO, collapse(ROOT_DIR_WATCH_HINTS[0] ?? ''));
    check(
      sourceFiles(SRC).every((f) => f.startsWith(declaredSrc + path.sep)),
      'every source this gate scans lies under the declared subtree',
    );
  }

  // ── anchor CONTENT assertions: the spelling ─────────────────────────────
  const scanA = (src: string) => scanAnchors('fixture.ts', src);
  {
    const { assertions, problems } = scanA(
      '// (`plugin-dashboard/src/index.tsx:204` first line `  { name: \'icon\' },`) so the\n',
    );
    check(problems.length === 0, 'assertion: must not be a problem');
    check(assertions.length === 1, 'assertion: found');
    check(assertions[0]?.target === 'plugin-dashboard/src/index.tsx', 'assertion: names the path');
    check(assertions[0]?.start === 204 && assertions[0]?.end === 204, 'assertion: single-line range');
    check(assertions[0]?.quote === "{ name: 'icon' },", 'assertion: quote is normalised, not raw');
  }
  {
    const { assertions } = scanA('// `components/src/renderers/form/button.tsx:85-102` first line `inputs: [`\n');
    check(assertions[0]?.start === 85 && assertions[0]?.end === 102, 'assertion/range: both ends parsed');
  }
  {
    // The continuation the records already write: a bare `:N` after a full anchor.
    const { assertions, problems } = scanA(
      '// `button.tsx:85-102` first line `inputs: [`; `:103-107` first line `defaultProps: {`\n',
    );
    check(problems.length === 0, 'assertion/continuation: must not be a problem');
    check(assertions.length === 2, 'assertion/continuation: both found');
    check(assertions[1]?.target === 'button.tsx', 'assertion/continuation: inherits the preceding path');
    check(assertions[1]?.inherited === true, 'assertion/continuation: records that it inherited');
  }
  {
    // …and a continuation with nothing to inherit FROM is a failure, not a skip.
    const { assertions, problems } = scanA('// `:103-107` first line `defaultProps: {`\n');
    check(assertions.length === 0, 'assertion/orphan: not counted');
    check(problems.length === 1, 'assertion/orphan: a continuation naming no file must FAIL');
    check(problems[0]?.message.join(' ').includes('names no file') === true, 'assertion/orphan: message says why');
  }
  {
    // A wrapped assertion is still one assertion — `flatten`, same as citations.
    const { assertions, problems } = scanA(
      ' * `plugin-grid/src/ObjectGrid.tsx:3544-3559` first line\n' +
      ' * `const effectiveBulkActions: string[] =` gates the selection\n',
    );
    check(problems.length === 0, 'assertion/wrapped: must not be a problem');
    check(assertions.length === 1, 'assertion/wrapped: found across the line break');
    check(assertions[0]?.quote === 'const effectiveBulkActions: string[] =', 'assertion/wrapped: quote survives the join');
  }
  {
    // A cited line containing a backtick — a template literal, and these are TSX
    // files — is spellable with a two-backtick fence.
    const { assertions, problems } = scanA('// `x/y.tsx:12` first line ``const k = `${a}-${b}`;`` and\n');
    check(problems.length === 0, 'assertion/backtick: must not be a problem');
    check(assertions[0]?.quote === 'const k = `${a}-${b}`;', 'assertion/backtick: the whole line is captured');
  }
  {
    const { assertions, problems } = scanA('// `x/y.tsx:12` first line inputs: [\n');
    check(assertions.length === 0, 'assertion/bare: not counted as an assertion');
    check(problems.length === 1, 'assertion/bare: an unquoted line must FAIL');
    check(problems[0]?.message.join(' ').includes('backticks') === true, 'assertion/bare: message names the fix');
  }
  {
    // A record with anchors and NO assertion is legal — the ratchet is a floor,
    // not a migration. It must still be COUNTED, which is what feeds the worklist.
    const { assertions, anchors, problems } = scanA('// (`plugin-kanban/src/index.tsx:395-398` registers the board)\n');
    check(assertions.length === 0 && problems.length === 0, 'anchor without assertion: legal and quiet');
    check(anchors.length === 1 && anchors[0]?.target === 'plugin-kanban/src/index.tsx', 'anchor without assertion: still counted');
  }

  // ── anchor CONTENT assertions: the verdicts ─────────────────────────────
  {
    const FILE = 'packages/components/src/renderers/form/button.tsx';
    const SRC_LINES = [
      'import { Button } from "../../ui/button";',   // 1
      '',                                            // 2
      '    inputs: [',                               // 3
      "      { name: 'label', type: 'string' },",    // 4
      '    ],',                                      // 5
      '    defaultProps: {',                         // 6
    ].join('\n');
    const files = [FILE, 'packages/plugin-grid/src/button.tsx'];
    const read = (p: string): string | null => (p === FILE ? SRC_LINES : 'nothing here\n');
    const mk = (o: Partial<Assertion>): Assertion => ({
      file: 'fixture.ts', line: 1, target: FILE, start: 3, end: 5, quote: 'inputs: [', inherited: false, ...o,
    });

    check(verifyAssertion(mk({}), files, read).ok, 'verify: a true assertion passes');
    check(
      verifyAssertion(mk({ target: 'components/src/renderers/form/button.tsx' }), files, read).ok,
      'verify: a path suffix resolves — records spell anchors the way a reader says them',
    );
    {
      // The card's class: an anchor that was WRONG WHEN WRITTEN. The quote is
      // right, the number is not, and the file is byte-identical across the hop —
      // so no sha refresh and no line-number refresh could ever surface it.
      const v = verifyAssertion(mk({ start: 6, end: 6 }), files, read);
      check(!v.ok && v.kind === 'mismatch', 'verify: a wrong anchor with a right quote FAILS');
      const msg = !v.ok ? v.message.join(' ') : '';
      check(msg.includes('at :3, not :6'), 'verify: the mismatch NAMES where the quoted line really is');
      check(msg.includes('wrong when written'), 'verify: and says a re-read is what settles it');
    }
    {
      const v = verifyAssertion(mk({ quote: 'runBulkActionAggregate(' }), files, read);
      check(!v.ok && v.kind === 'mismatch', 'verify: a quote nowhere in the file FAILS');
      check(!v.ok && v.message.join(' ').includes('NOWHERE'), 'verify: and says the read point moved or died');
    }
    {
      const v = verifyAssertion(mk({ target: 'button.tsx' }), files, read);
      check(!v.ok && v.kind === 'ambiguous-file', 'verify: an ambiguous suffix is REFUSED, not guessed');
    }
    {
      const v = verifyAssertion(mk({ target: 'gone/away.tsx' }), files, read);
      check(!v.ok && v.kind === 'no-file', 'verify: a path absent at this pin FAILS');
    }
    {
      const v = verifyAssertion(mk({ start: 900, end: 900 }), files, read);
      check(!v.ok && v.kind === 'past-eof', 'verify: an anchor past EOF FAILS');
    }
    {
      // The blank-first-line rule: `containers.tsx:450-457` really does open on a
      // blank line in objectui, so the range's first NON-BLANK line is the claim.
      const v = verifyAssertion(mk({ start: 2, end: 3 }), files, read);
      check(v.ok && v.at === 3, 'verify: a blank opening line is skipped, and the read line is reported');
    }
    {
      const v = verifyAssertion(mk({ start: 2, end: 2, quote: 'x' }), files, read);
      check(!v.ok && v.kind === 'blank-range', 'verify: an all-blank range FAILS rather than passing vacuously');
    }
  }

  // ── the pin is NOT required, and never silently absent ──────────────────
  {
    const t = openPinTree(PIN, { OBJECTUI_ROOT: path.join(REPO, 'does-not-exist-objectui') });
    check(!t.ok, 'openPinTree: an absent checkout is not readable');
    check(!t.ok && t.why.includes('no git checkout'), 'openPinTree: it SAYS why, so a caller can print it');
  }

  // ── the coverage ratchet tracks the live tree, in both directions ───────
  {
    let live = 0;
    for (const f of sourceFiles(SRC)) live += scanAnchors(f, readFileSync(f, 'utf8')).assertions.length;
    check(
      live === ASSERTED_ANCHOR_FLOOR,
      `ASSERTED_ANCHOR_FLOOR is ${ASSERTED_ANCHOR_FLOOR} but ${live} assertion(s) are in the tree — ` +
        'raise it in the PR that adds coverage so a later deletion cannot hide under slack',
    );
  }

  // ── LIVE round-trip against the real objectui tree, when it is there ────
  // Built from whatever the pin holds, so it pins no line of another repo and
  // cannot rot; skipped LOUDLY when the checkout is absent, never silently.
  {
    const tree = openPinTree(readPin(PIN_FILE));
    if (!tree.ok) {
      console.error(`⚠️  self-test: live objectui round-trip SKIPPED — ${tree.why}`);
    } else {
      const target = tree.files.find((f) => f.endsWith('.tsx') && f.startsWith('packages/'));
      const src = target === undefined ? null : tree.read(target);
      const lines = (src ?? '').split('\n');
      let idx = -1;
      for (let i = 0; i < lines.length; i++) {
        const n = normaliseLine(lines[i] ?? '');
        if (n !== '' && lines.filter((l) => normaliseLine(l) === n).length === 1) { idx = i; break; }
      }
      check(target !== undefined && idx >= 0, 'live: found a uniquely-quotable line in the pinned tree');
      if (target !== undefined && idx >= 0) {
        const as: Assertion = {
          file: 'live', line: 1, target, start: idx + 1, end: idx + 1,
          quote: normaliseLine(lines[idx] ?? ''), inherited: false,
        };
        check(verifyAssertion(as, tree.files, tree.read).ok, 'live: a truthful assertion verifies against the real pin');
        const off = verifyAssertion({ ...as, start: idx + 2, end: idx + 2 }, tree.files, tree.read);
        check(!off.ok && off.kind === 'mismatch', 'live: an off-by-one anchor FAILS against the real pin');
        check(
          !off.ok && off.message.join(' ').includes(`at :${idx + 1},`),
          'live: and the relocation report names the true line in the real tree',
        );
      }
    }
  }

  if (failures.length) {
    for (const f of failures) console.error(`✗ self-test: ${f}`);
    console.error(`\ncheck-objectui-pin-citations --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    '✅  self-test: asserting citations are checked against the pin and historical ones are not;\n' +
      '    a citation wrapped across comment lines is still found (both wrap positions); a sha in\n' +
      '    neither spelling and a sha missing its backticks both FAIL; a mention naming no sha is\n' +
      '    skipped; hex-looking prose without a digit is not a sha; a missing pin file throws; and\n' +
      '    the dispatch-gates watch-hint declaration names the pin file and the subtree this gate\n' +
      '    really reads, in the separator-carrying spelling `hintCovers` admits. And: an anchor\n' +
      '    content assertion is found in the full, continuation, wrapped and backticked-line\n' +
      '    spellings; an unquoted one and an orphan continuation FAIL; a wrong anchor beside a\n' +
      '    right quote fails with the line the quote really sits on; an ambiguous path is\n' +
      '    refused; a blank opening line is skipped and an all-blank range fails; and the\n' +
      '    coverage floor equals the live count.',
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------

function main(): void {
  if (process.argv.includes('--self-test')) selfTest();

  const pin = readPin(PIN_FILE);
  const files = sourceFiles(SRC);

  const citations: Citation[] = [];
  const problems: Problem[] = [];
  const assertions: Assertion[] = [];
  const anchors: Anchor[] = [];
  for (const f of files) {
    const rel = path.relative(REPO, f);
    const source = readFileSync(f, 'utf8');
    const r = scanFile(rel, source);
    citations.push(...r.citations);
    problems.push(...r.problems);
    const t = scanAnchors(rel, source);
    assertions.push(...t.assertions);
    anchors.push(...t.anchors);
    problems.push(...t.problems);
  }

  if (LIST) {
    for (const c of citations) {
      const verdict = c.kind === 'historical' ? 'historical' : pin.startsWith(c.sha) ? 'current' : 'STALE';
      console.log(`${c.kind.padEnd(10)} ${c.sha.padEnd(14)} ${verdict.padEnd(10)} ${c.file}:${c.line}`);
    }
    for (const a of assertions) {
      console.log(`assertion  ${`${a.target}:${a.start}`.padEnd(25)} ${a.file}:${a.line}  ${a.quote}`);
    }
    return;
  }

  // Vacuous-green guard. Zero citations is far likelier to mean the records
  // moved (or the matcher stopped seeing them) than that this tree stopped
  // citing the pin — and a gate that checked nothing must not report success.
  if (citations.length === 0) {
    console.error(
      `✗ No objectui pin citations found under ${path.relative(REPO, SRC)}.\n\n` +
        `  The read-point records that cite \`.objectui-sha\` are the population this gate\n` +
        `  exists for, so finding none means they moved or the spelling changed — not that\n` +
        `  there is nothing to check. Re-derive the scope; a gate that reads nothing must\n` +
        `  not report success.\n`,
    );
    process.exit(1);
  }

  // ── the anchor CONTENT half ────────────────────────────────────────────
  const tree = openPinTree(pin);
  let verified = 0;
  if (tree.ok) {
    for (const a of assertions) {
      const v = verifyAssertion(a, tree.files, tree.read);
      if (v.ok) verified++;
      else problems.push({ file: a.file, line: a.line, message: v.message });
    }
  }
  const unverified = tree.ok ? 0 : assertions.length;

  // ⚠️ The pin-bump mode. There, an unreadable pin defeats the entire purpose:
  // the run exists to re-check anchors against the tree the numbers were counted
  // in, and "could not read it" is not a weaker pass, it is no run at all.
  if (VERIFY_ANCHORS && !tree.ok) {
    console.error(
      `✗ --verify-anchors cannot read objectui at the pin: ${tree.why}.\n\n` +
        `  This mode exists to re-check every anchor against the tree its line numbers were\n` +
        `  counted in, so an unreadable pin is not a weaker pass — it is no run. (The ORDINARY\n` +
        `  run does not require it, and prints what it could not verify.)\n\n` +
        `    git clone https://github.com/objectstack-ai/objectui ../objectui\n` +
        `    git -C ../objectui fetch origin ${pin.slice(0, 9)}\n` +
        `    OBJECTUI_ROOT=/path/to/objectui pnpm --filter @objectstack/spec exec \\\n` +
        `      tsx scripts/check-objectui-pin-citations.ts --verify-anchors\n`,
    );
    process.exit(1);
  }

  // The migration worklist — GENERATED, never a hand roster, and deliberately
  // not an error. Requiring a content assertion on every anchor at once would
  // force a bulk fill, and a quoted line copied without a re-read reproduces at
  // scale exactly the defect this gate was extended to catch. So the worklist is
  // printed where someone is already re-reading anchors: at the pin bump.
  if (VERIFY_ANCHORS && tree.ok) {
    const asserted = new Set(assertions.map((a) => `${a.file}|${a.target}|${a.start}|${a.end}`));
    const todo = anchors.filter(
      (a) => resolveTarget(tree.files, a.target).length === 1 && !asserted.has(`${a.file}|${a.target}|${a.start}|${a.end}`),
    );
    const byFile = new Map<string, number>();
    for (const t of todo) byFile.set(t.file, (byFile.get(t.file) ?? 0) + 1);
    console.log(
      `\nAnchor content coverage at ${pin.slice(0, 9)}: ${assertions.length} asserted, ` +
        `${todo.length} objectui anchor(s) still carry no content assertion.\n`,
    );
    for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${f}`);
    }
    if (todo.length > 0) {
      console.log(
        `\n  Adding one is a RE-READ, never a fill: open the cited range in objectui at this\n` +
          `  pin, check the record's claim against what is actually there, and quote the\n` +
          `  range's first non-blank line beside the anchor:\n\n` +
          `      \`<path>:<start>-<end>\` first line \`<the line>\`\n\n` +
          `  Then raise ASSERTED_ANCHOR_FLOOR in this script by the number you added.\n`,
      );
    }
  }

  // ── the coverage ratchet ───────────────────────────────────────────────
  const floorBroken = assertions.length !== ASSERTED_ANCHOR_FLOOR;

  for (const p of problems) {
    console.error(`✗ ${p.file}:${p.line} — ${p.message[0]}`);
    for (const l of p.message.slice(1)) console.error(l ? `    ${l}` : '');
    console.error('');
  }

  const stale = citations.filter((c) => c.kind === 'asserting' && !pin.startsWith(c.sha));
  const asserting = citations.filter((c) => c.kind === 'asserting');

  if (stale.length) {
    console.error(
      `✗ ${stale.length} spec source(s) assert an objectui pin this repo does NOT build against.\n\n` +
        `  .objectui-sha = ${pin}\n`,
    );
    for (const c of stale) console.error(`    ${c.file}:${c.line} cites \`${c.sha}\``);
    console.error(
      `\n  ⛔ Do NOT fix this by replacing the sha.\n\n` +
        `  The sha is not the record — the objectui file:line ANCHORS beside it are, and they\n` +
        `  are only true of the tree they were counted in. Rewriting the sha alone makes the\n` +
        `  record CLAIM the current pin while its anchors still describe the old one: a silent,\n` +
        `  confident lie in place of a loud, accurate "unverifiable". #10274 measured that risk\n` +
        `  as real — re-measuring found two anchors that had been wrong since they were written.\n\n` +
        `  RE-MEASURE each record at the current pin instead:\n\n` +
        `    git -C ../objectui show ${pin.slice(0, 9)}:<path> > /tmp/at-pin.tsx\n\n` +
        `  then re-derive every cited line number from THAT file, update the anchors and the\n` +
        `  sha together, and say in the PR body what you measured. If a read point has moved\n` +
        `  or died, the record needs more than a citation refresh — report it rather than\n` +
        `  re-pointing it.\n\n` +
        `  While you are in there, this run re-checks any anchor that carries a quoted first\n` +
        `  line and can NAME the line a quote really sits on, which a number alone cannot:\n\n` +
        `    pnpm --filter @objectstack/spec exec \\\n` +
        `      tsx scripts/check-objectui-pin-citations.ts --verify-anchors\n\n` +
        `  A citation that is a DATED RECORD of a past measurement rather than a claim about\n` +
        `  today belongs in the other spelling, which this gate does not check:\n\n` +
        `    \`.objectui-sha\` pin \`${stale[0]!.sha}\`\n`,
    );
    process.exit(1);
  }

  if (floorBroken) {
    console.error(
      `✗ anchor content coverage moved: ${assertions.length} assertion(s) in ` +
        `${path.relative(REPO, SRC)}, ASSERTED_ANCHOR_FLOOR says ${ASSERTED_ANCHOR_FLOOR}.\n\n` +
        (assertions.length > ASSERTED_ANCHOR_FLOOR
          ? `  You ADDED coverage — set ASSERTED_ANCHOR_FLOOR to ${assertions.length} in\n` +
            `  ${path.relative(REPO, path.join(SPEC, 'scripts/check-objectui-pin-citations.ts'))} in this same PR.\n` +
            `  The floor is an equality on purpose: slack above it is room for a later deletion\n` +
            `  to hide in.\n`
          : `  Coverage was REMOVED. An anchor that had a quoted first line no longer does, so a\n` +
            `  claim about that line's CONTENT is back to being a claim about its NUMBER — the\n` +
            `  exact state this ratchet exists to end. Restore it, or say in the PR body why the\n` +
            `  read point is gone and lower the floor deliberately.\n`),
    );
    process.exit(1);
  }

  if (problems.length) {
    console.error(`✗ ${problems.length} pin-citation / anchor problem(s) in ${path.relative(REPO, SRC)}.\n`);
    process.exit(1);
  }

  const anchorLine = tree.ok
    ? `${verified} anchor content assertion(s) verified against objectui at ${pin.slice(0, 9)}`
    : `⚠️ ${unverified} anchor content assertion(s) NOT VERIFIED — ${tree.why}`;
  console.log(
    `✅ ${asserting.length} asserting objectui pin citation(s) match .objectui-sha (${pin.slice(0, 9)}), ` +
      `${citations.length - asserting.length} historical citation(s) recorded and not checked, ` +
      `across ${files.length} spec source(s).\n` +
      `   ${anchorLine}; ${anchors.length} file:line anchor(s) seen.`,
  );
  if (!tree.ok && assertions.length === 0) {
    console.log(
      `   No anchor carries a quoted first line yet, so nothing here checks an anchor's CONTENT.\n` +
        `   Run \`--verify-anchors\` beside an objectui checkout for the worklist.`,
    );
  }
}

main();
