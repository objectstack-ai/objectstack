#!/usr/bin/env node
/**
 * Reports pending changeset bodies that NAME a file this change touches, so the
 * seat doing the touching re-reads the paragraph before it publishes.
 *
 * Run:  node scripts/check-changeset-claims.mjs   (also `pnpm check:changeset-claims`)
 *       node scripts/check-changeset-claims.mjs --base <ref> --head <ref>
 *       node scripts/check-changeset-claims.mjs --json <file>
 *       node scripts/check-changeset-claims.mjs --audit
 *       node scripts/check-changeset-claims.mjs --census
 * Exit: 0 = nothing to re-read, or findings (this gate is REPORT-ONLY and has
 *           no enforcing mode — see "Why it can never block" below)
 *       1 = the inputs could not be read, so this run measured nothing
 *
 * ## The defect (objectui#9003, and objectui#7721 / objectui#8617 / objectui#8759 before it)
 *
 * A `.changeset/*.md` body publishes VERBATIM into the CHANGELOG at the next
 * release. Between authoring and release it sits in the tree as ordinary prose
 * that no gate evaluates and nothing re-reads. Four gates read `.changeset/`
 * — presence, no-major, fixed, overwrite — and all four judge STRUCTURE: that a
 * declaration exists, what level it declares, how the workspace classifies it,
 * whether a change touched one it does not own. None of them reads a claim in a
 * body.
 *
 * ⚠️ That paragraph is quoted on objectui#9841 and stays true of those four gates.
 * What it does NOT say, and what objectui#9841 carded, is that nobody read one
 * changeset against ITSELF — its front matter against its own body. The
 * self-contradiction reading below is that third coordinate.
 *
 * Three instances were filed and worked one at a time before the mechanism was
 * carded. They split into two sub-shapes that end the same way:
 *
 *   BORN FALSE  - authored against the merge base while describing the head
 *                 (objectui#8759: a sentence counted two occurrences of a thing
 *                 its own diff made three).
 *   WENT FALSE  - true when written, falsified by a LATER merge
 *                 (objectui#7721, objectui#8617).
 *
 * This gate opened covering WENT FALSE ONLY, and said so in its own output. It
 * now carries a SECOND reading for BORN FALSE (objectui#9509), over a different
 * corpus and on a different coordinate — see "The born-false reading" below.
 * ⛔ The two readings are never merged: the went-false reading still excludes a
 * changeset this change adds, because a body naming its own pull request's files
 * is the normal case and reporting it would fire on nearly every change here.
 *
 * A THIRD reading (objectui#9841) reads one changeset against itself, and splits
 * BORN FALSE from WENT FALSE on its own axis — see "The self-contradiction
 * reading" below. Three readings, three corpora, three coordinates; ⛔ none of
 * them is merged into another, and each one's floors are its own.
 *
 * ## The self-contradiction reading (objectui#9841) — corpus, coordinate, split
 *
 * CORPUS: the `.changeset/*.md` files THIS CHANGE adds or modifies, read out of
 * this tree. ⛔ No ambient input at all — no `GITHUB_EVENT_PATH`, no pull
 * request body, no environment. The hermeticity is structural rather than
 * conventional, for the reason objectui#9744 measured on the reading above it.
 *
 * COORDINATE: a package the file's OWN front matter declares, negated in the
 * file's own body with nothing between the package spelling and the negation but
 * a copula — «`packages/types` is untouched». Either spelling counts, the npm
 * name or the workspace directory; the carded instance used the directory.
 *
 * ⛔ The card's own proposed coordinate — "a sentence that names a declared
 * package adjacent to a negation of change" — was MEASURED and rejected, which
 * is the falsification pass that card asked for before anything was built. Over
 * every pending changeset in this tree plus every released CHANGELOG entry, that
 * wider coordinate pairs repeatedly and every single pairing is legitimate: it
 * negates an ASPECT of the package (a face, a surface, an export, one symbol,
 * one file), never the package. `--census` re-derives both numbers; ⛔ they are
 * not copied here (AGENTS.md #9).
 *
 * THE SPLIT, and ⛔ it cannot be read off the head. At `2bc8fd12e2` — the commit
 * that ADDED the carded changeset — the body already said «`packages/types` is
 * untouched» and the front matter declared `@object-ui/components` and nothing
 * else: the sentence was TRUE. At `21896172a9` the same commit that moved 62
 * lines in `packages/types/src/overlay.ts` added `'@object-ui/types': patch`
 * to that front matter. Against the merge base the net diff shows the file
 * simply ADDED with both halves present, which reads as born false. It was not.
 * So the verdict is dated from the BRANCH'S OWN revisions of that file, and a
 * range that carries none of them is reported UNDATED rather than guessed at.
 *
 * ## The born-false reading (objectui#9509) — corpus, coordinate, carve-out
 *
 * objectui#9509 measured three instances in one day across two pull requests.
 * ⛔ None of them was in a pending changeset, and that is the whole reason this
 * reading needed a corpus of its own:
 *
 *   1. objectui#9496, in its PULL REQUEST BODY: a test frame cited as `:281:75`
 *      that the same branch's later edit moved to `:283:75` — and then to
 *      `:299:75`.
 *   2. objectui#9496, in its PULL REQUEST BODY: "recurs exactly twice: `:223`
 *      ... and `:246`", falsified by the 28-line comment block THE SAME DIFF
 *      inserts at `imported-defaults.ts:221`. At the head `:223` is rewritten and
 *      `:246` is at `:274` — and both numbers then land inside the block that
 *      displaced them, so a reader following the citation reaches prose ABOUT
 *      the claim instead of the code it is about.
 *   3. objectui#9495, in a SOURCE DOCBLOCK: "a grep for `shortcut` finds that
 *      member first", falsified by the same diff's own 28-line insertion above
 *      it. ⛔ Out of reach here and deliberately — see the limits below.
 *
 * CORPUS: the prose this change PUBLISHES ABOUT ITSELF. That is the pull request
 * body (read from `GITHUB_EVENT_PATH`, or `--pr-body <file>` locally) plus the
 * `.changeset/*.md` bodies this change adds or modifies. ⛔ Not the tree at
 * large: a citation written into an ordinary source file is the differential
 * citation gate's population (`check-new-cross-file-line-citations.mjs`), and
 * this repository treats a second reader over one population as a defect.
 *
 * COORDINATE: a backticked LINE ADDRESS — `some-file.ts:246`, or a bare `:246`
 * continuing a file named earlier in the same paragraph — resolving to exactly
 * one tracked file THIS CHANGE TOUCHES. Same resolution rule as the went-false
 * reading, and for the same reason: an ambiguous spelling names nothing.
 *
 * The question asked of it is arithmetic, and is still not "is this sentence
 * true?":
 *
 *   MOVED    the file is MODIFIED here, and this change's own hunks map the
 *            cited base line to a different head line, or delete it outright.
 *            The number was read from a tree this diff replaced.
 *   UNANCHORED  the file is ADDED here, so the address can only ever have been
 *            read from a tree that exists nowhere but inside this pull request,
 *            and moves again on the next push. Instance 1 is this shape: the
 *            frame moved twice, between revisions of one branch.
 *
 * CARVE-OUT: an address whose own SENTENCE names the tree it was read from is
 * ⛔ never reported. Both pull requests converged on that form independently and
 * objectui#9509 carded it as the durable one: `` `:246` at `b8a006883d`, `:274`
 * at this head ``. A number bound to a sha cannot re-stale, so a gate that
 * reported it would be teaching authors to unbind. ⚠️ The binding is read per
 * SENTENCE, not per paragraph: a sha floating three sentences away binds
 * nothing, and a paragraph-wide window would have exempted instance 2.
 *
 * ⛔ What the born-false reading does NOT cover, so nobody reads it as more:
 *   - A claim with no line address at all. Instance 3 coordinates itself by
 *     ORDINAL ("finds that member first"), and deciding that requires reading
 *     what the sentence means — the one question triage fenced off, below.
 *   - An address into a file this change does not touch. That address may be
 *     false, but nothing about THIS diff made it so; it is the citation census's
 *     population and not this one's.
 *   - A pull request body EDITED without a push. `pull_request` fires on
 *     `opened`/`synchronize`/`reopened`, so a body rewritten on its own is read
 *     at the next push and not before.
 *
 * ## What it judges, and the one thing it refuses to judge
 *
 * Triage fenced this card: "Do not attempt to judge prose truth automatically.
 * The four gates the card enumerates judge presence, bump level and
 * classification - mechanical properties. 'Is this sentence true?' is not one,
 * and a gate that pretends otherwise will be turned off within a month."
 *
 * So the question asked here is mechanical and has nothing to do with truth:
 *
 *   Does this changeset body NAME, in backticks, a file this change touches?
 *
 * Name resolution, not meaning. A backticked span that looks like a path is
 * resolved against the tree at the base commit, and only an UNAMBIGUOUS
 * resolution counts - exactly one tracked file. `package.json` resolves to 47
 * files in this workspace and therefore names nothing definite; a spelling like
 * `flow-node-config.spec-reconciliation.test.ts` resolves to one. That is the
 * whole filter, and it needs no hand-maintained denylist of common names.
 *
 * The output QUOTES the paragraph, never the line. From objectui#8617's landing:
 * the unit that rots is the paragraph, not the sentence - both false halves of
 * that card sat in one Migration paragraph, and correcting either alone would
 * have left the paragraph asserting the same wrong thing.
 *
 * ## Why the coordinate is a FILE NAME and not a symbol or a package
 *
 * Measured over the 25 most recent first-parent commits on `main`, against the
 * 1,384 changesets pending in the tree, counting how many pre-existing changesets
 * each commit would have been asked to re-read:
 *
 *   coordinate                                            median   mean   max
 *   symbol mentioned anywhere in the diff                    191    ---    309
 *   workspace package the diff changes a file in              25    ---    200
 *   identifier declared in exactly one file the diff edits      8   12.6    56
 *   FILE the diff edits, named unambiguously                    1    4.2    23
 *
 * Only the last one is readable. A report of 191 paragraphs is the release-time
 * wall in a different costume, and gets skimmed the same way. Symbols were
 * dropped on that number, not on taste; the runner-up (identifier declared in
 * exactly one edited file) would have caught one more of the historical
 * instances and is named in the "does not cover" list below so the trade is on
 * the record rather than lost.
 *
 * ## Why it can never block
 *
 * There is no `ENFORCE` switch and deliberately so. "A pending changeset names a
 * file you edited" is not a defect - most of the time the sentence is still
 * true. The finding is a REQUEST TO READ, addressed to the one seat that can
 * answer it without re-deriving anything: the one whose own diff is the thing
 * that might have falsified it. A gate that failed a build on this would be
 * failing it for the prose being adjacent, which is exactly the "turned off
 * within a month" shape triage named.
 *
 * An unreadable input is still exit 1, never a pass. Report-only means this gate
 * declines to fail on its FINDINGS, never that it passes without looking
 * (objectstack#4928, objectui#4690).
 *
 * ## The correction path, and the gate that reports it
 *
 * When a re-read does find a falsified claim, correcting the body is the answer,
 * and it is precedented rather than forbidden. Two commits on `main` did it: the
 * `docs(changeset)` commit that corrected two present-tense claims a later pull
 * request falsified, and the one that dropped the stale cardinal from the
 * objectui#8315 changeset. Both are prose-only, both left frontmatter untouched.
 *
 * `check-changeset-overwrite.mjs` WILL report that correction, because it reports
 * every modification of a changeset the change did not add. That report is its
 * case 2 - "You are CORRECTING a declaration on purpose ... Legitimate, and the
 * reason this gate reports instead of failing" - and that gate is report-only, so
 * the correction is not mechanically barred. ⛔ Nothing here weakens it, narrows
 * it, or carves an exemption into it: the two gates are meant to fire together on
 * a correction, one asking for the read and the other recording the write.
 *
 * ## What objectui#9140 measured about this gate, after five live instances
 *
 * objectui#9065 was five WENT-FALSE claims at once. The gate was re-run on each
 * falsifying merge's own range, and the answer split two ways. Both halves are
 * recorded here because each one contradicts something this header assumes.
 *
 * HALF ONE - it named four of the five, and nobody acted on any of them. All
 * four false paragraphs then sat on `main` as pending release-note input until
 * objectui#9065 was filed BY HAND, and three had already been folded into the
 * standing Changesets release PR's staged CHANGELOGs. ⇒ the "REQUEST TO READ"
 * theory of change stated above has a measured delivery record, and on the one
 * shape this gate exists for that record is zero for four. ⛔ That is NOT an
 * argument for making it block - the measurement against blocking is unchallenged
 * and "Why it can never block" still rules. It is the datum whoever revisits that
 * trade needs, recorded rather than lost.
 *
 * HALF TWO - the fifth was invisible, and that is a SECOND historical instance on
 * the runner-up's side of the coordinate trade measured above. The one this gate
 * could not see is exactly the one whose body names no file at all: it coordinates
 * itself by symbol. `--audit` now counts that population - bodies that publish but
 * spell no name this gate can resolve - so the blind spot is re-derived on every
 * run instead of hand-counted per incident (rule #9 in AGENTS.md).
 *
 * ⛔ The coordinate was NOT widened, and the reason is a measurement, not taste.
 * objectui#9140 asked what it would take to bring that fifth instance into the
 * census. Its body reaches a file this gate could resolve through exactly ONE
 * spelling - the stem of a file name - and that one spelling is backticked by a
 * large fraction of the whole pending queue, because it is the name of one of this
 * repo's principal components. Admitting it admits every changeset that mentions
 * that component. Re-measured over the same 25-first-parent-commit population the
 * table above uses, that widening lands in the same band the runner-up was REJECTED
 * in, and it lands there on a channel half one just measured at zero for four. ⇒
 * widening the coordinate is a readability-budget decision, it is open, and it is
 * deliberately not taken here. The numbers are on objectui#9140; ⛔ they are not
 * copied into this header, which is rule #9 applied to this paragraph.
 *
 * ## Where it runs, and where the finding is DELIVERED
 *
 * `changeset-presence.yml`, as a second job. That workflow carries NO path
 * filter, which is what this gate needs and what `changeset-guard.yml` cannot
 * give it: the change that falsifies a pending claim is an ordinary source
 * change, and nothing guarantees it touches `.changeset/**` at all. It needs no
 * install and no build - a checkout, a tree listing and one batched blob read.
 *
 * On a pull request the finding is POSTED TO THAT PULL REQUEST, not left in a
 * job log (objectui#9140, director ruling, maintainer approved). HALF ONE above
 * measured the "REQUEST TO READ" theory of change at zero answers out of four,
 * and the seat that could answer cheaply is the one reading the pull request —
 * so the request is carried to where that seat already is. The channel is the
 * one the Console Performance Budget report uses: `actions/github-script`
 * calling the issue-comments API with the repository's existing
 * `pull-requests: write` grant on `GITHUB_TOKEN`.
 *
 * ⛔ Delivery changes NOTHING about enforcement. Exit is still 0 on findings,
 * the job is still not a required context, and the comment says so in its own
 * first sentences. "Why it can never block" above still rules, and the
 * measurement it rests on is untouched.
 *
 * `--json <file>` is the hand-off: this run's finding set, written once and
 * rendered by `scripts/render-changeset-claims-comment.mjs`. One comment per
 * pull request, updated in place on every re-run rather than stacked — the
 * renderer's own header carries the marker convention and why the marker is
 * plain text rather than an HTML comment.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { NOT_A_CHANGESET, changedFiles, describeDeclaration, resolveBaseRef } from './check-changeset-presence.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** `.changeset/` with the trailing separator, so a slice needs no arithmetic. */
const CHANGESET_DIR = '.changeset/';

/**
 * Extensions a backticked span must end in to be READ as a file name.
 *
 * Deliberately generous: precision comes from unambiguous resolution against the
 * tree, not from this list. A span ending `.json` that resolves to 47 files
 * names nothing and is dropped a step later.
 */
const NAMED_FILE = /\.(?:tsx?|mts|cts|mjs|cjs|jsx?|json|ya?ml|mdx?|css|sh)$/;

/** A span that could be a repo-relative path: no spaces, no glob, no wildcards. */
const PATH_SHAPED = /^[A-Za-z0-9_.@/-]+$/;

/**
 * Every backticked span in a changeset body that is shaped like a file name.
 *
 * Backticks only. Prose names files in running text too ("the flow node
 * inspector"), but an unbackticked phrase has no boundary a parser can trust,
 * and widening to bare words is how this becomes a symbol matcher again - the
 * shape the measurement in the header rejected at 191 paragraphs per commit.
 *
 * @returns {string[]} unique spans, in first-appearance order
 */
export function namedFiles(source) {
  const seen = new Set();
  for (const match of source.matchAll(/`([^`\n]{3,200})`/g)) {
    const span = match[1].trim();
    if (NAMED_FILE.test(span) && PATH_SHAPED.test(span)) seen.add(span);
  }
  return [...seen];
}

/**
 * The paragraph of `source` that contains `span`, collapsed to single spaces.
 *
 * The paragraph is the unit deliberately (objectui#8617): a reader handed one
 * sentence corrects one sentence, and the surrounding claim keeps asserting the
 * same wrong thing. Blank-line separated, which is how a changeset body reads.
 */
export function paragraphNaming(source, span) {
  const needle = '`' + span + '`';
  for (const paragraph of source.split(/\r?\n\s*\r?\n/)) {
    if (paragraph.includes(needle)) return paragraph.replace(/\s+/g, ' ').trim();
  }
  return null;
}

// -- the tree -----------------------------------------------------------------

function git(root, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) return null;
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`\`git ${args.join(' ')}\` failed${stderr ? `:\n    ${stderr}` : ''}`);
  }
}

/**
 * Every tracked path at `ref`, indexed by basename.
 *
 * `ref === null` means the working tree, so an author running this locally is
 * answered about the checkout in front of them. UNTRACKED files join the
 * listing for the same reason `check-changeset-presence` counts untracked
 * changesets: a file written a minute ago is not in the index yet, and without
 * it a body naming that file would resolve to nothing locally and to something
 * in CI — the gate disagreeing with itself depending on who ran it. Empty in
 * CI, where the checkout has no untracked files.
 *
 * @returns {{ paths: Set<string>, byBasename: Map<string, string[]> }}
 */
export function treeIndex(root, ref) {
  const listing =
    ref === null
      ? git(root, ['ls-files']) + git(root, ['ls-files', '--others', '--exclude-standard'])
      : git(root, ['ls-tree', '-r', '--name-only', '--full-tree', ref]);
  const paths = new Set();
  const byBasename = new Map();
  for (const path of listing.split('\n')) {
    if (path === '' || paths.has(path)) continue;
    paths.add(path);
    const base = path.slice(path.lastIndexOf('/') + 1);
    const bucket = byBasename.get(base);
    if (bucket) bucket.push(path);
    else byBasename.set(base, [path]);
  }
  return { paths, byBasename };
}

/**
 * The ONE tracked file a span names, or `null` when it names none or many.
 *
 * Ambiguity is not a near miss to be broken by a heuristic - a body that writes
 * `index.ts` has named no particular file, and picking one for it would invent a
 * claim the author did not make. Dropping it is the filter that makes this gate
 * readable (see the measurement in the header).
 */
export function resolveNamed(index, span) {
  if (span.includes('/')) {
    const hits = [...index.paths].filter((path) => path === span || path.endsWith('/' + span));
    return hits.length === 1 ? hits[0] : null;
  }
  const hits = index.byBasename.get(span);
  return hits && hits.length === 1 ? hits[0] : null;
}

/**
 * `paths` at `ref`, as UTF-8 strings, in ONE `git cat-file --batch` call.
 *
 * One subprocess rather than one per file, because the population is the whole
 * pending queue - 1,384 files in this tree at the time of writing, and it only
 * grows between releases. Byte lengths are honoured by slicing a Buffer: `git`
 * reports a blob's size in BYTES, and a body with a multi-byte character in it
 * would be cut in the wrong place by character arithmetic.
 *
 * @returns {Map<string, string>} present paths only; a missing one is absent
 */
export function readBlobs(root, ref, paths) {
  const out = new Map();
  if (paths.length === 0) return out;
  if (ref === null) {
    for (const path of paths) {
      try {
        out.set(path, readFileSync(join(root, path), 'utf8'));
      } catch {
        /* deleted in the working tree; absent is the answer */
      }
    }
    return out;
  }

  const batch = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root,
    input: paths.map((path) => `${ref}:${path}`).join('\n') + '\n',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let cursor = 0;
  for (const path of paths) {
    const newline = batch.indexOf(10, cursor);
    if (newline === -1) break;
    const header = batch.toString('utf8', cursor, newline);
    const size = Number(header.split(' ')[2]);
    if (!Number.isFinite(size)) {
      // "<object> missing" - the path is not at this ref. Absent, not an error.
      cursor = newline + 1;
      continue;
    }
    out.set(path, batch.toString('utf8', newline + 1, newline + 1 + size));
    cursor = newline + 1 + size + 1;
  }
  return out;
}

// -- the finding --------------------------------------------------------------

/**
 * @typedef {object} Finding
 * @property {string} changeset  the pending declaration, repo-relative
 * @property {string} span       the backticked spelling in its body
 * @property {string} file       the one tracked file that spelling resolves to
 * @property {'gone' | 'edited'} severity whether the change leaves that file behind
 * @property {string | null} paragraph the paragraph naming it, whitespace collapsed
 */

/**
 * Pending changesets this change did not write, whose prose names a file it
 * touches.
 *
 * Three exclusions, each one load-bearing:
 *
 *  1. Changesets this change ADDS OR MODIFIES. A changeset naming files from its
 *     own pull request is the normal case, not a finding - it would fire on
 *     every change that carries one, which is nearly all of them here. ⛔ This
 *     exclusion is NOT relaxed by objectui#9509: the born-false reading takes
 *     those same bodies on a different coordinate (an unbound LINE ADDRESS into
 *     a file this change moves), which is rare where "names a file from its own
 *     pull request" is near-universal.
 *  2. Changesets that declare NO bump (empty frontmatter). Their body never
 *     reaches a CHANGELOG, so there is no verbatim publication to protect. 427
 *     of the 1,384 pending here are these.
 *  3. `.changeset/README.md`, which is documentation.
 *
 * Throws on any unreadable input; the CLI turns that into exit 1.
 *
 * @returns {{ findings: Finding[], pending: number, considered: number, subject: string[] }}
 */
export function claims(root, { base, head = null }) {
  const changed = changedFiles(root, { base, head });
  const ownChangesets = new Set(changed.filter((file) => file.startsWith(CHANGESET_DIR)));
  const subject = changed.filter((file) => !file.startsWith(CHANGESET_DIR));

  const baseIndex = treeIndex(root, base);
  const headIndex = treeIndex(root, head);
  const touched = new Set(subject);

  const pendingPaths = [...baseIndex.paths].filter(
    (path) =>
      path.startsWith(CHANGESET_DIR) &&
      path.endsWith('.md') &&
      !NOT_A_CHANGESET.has(path.slice(path.lastIndexOf('/') + 1)) &&
      !ownChangesets.has(path),
  );

  const findings = [];
  let considered = 0;
  if (subject.length > 0) {
    for (const [path, source] of readBlobs(root, base, pendingPaths)) {
      const declaration = describeDeclaration(source);
      if (declaration.kind !== 'frontmatter' || declaration.entries === 0) continue;
      considered += 1;
      for (const span of namedFiles(source)) {
        const file = resolveNamed(baseIndex, span);
        if (file === null || !touched.has(file)) continue;
        findings.push({
          changeset: path,
          span,
          file,
          severity: headIndex.paths.has(file) ? 'edited' : 'gone',
          paragraph: paragraphNaming(source, span),
        });
      }
    }
  }

  findings.sort((a, b) => (a.severity === b.severity ? a.changeset.localeCompare(b.changeset) : a.severity === 'gone' ? -1 : 1));
  return { findings, pending: pendingPaths.length, considered, subject };
}

/**
 * The population reading, over one tree rather than a diff.
 *
 * This is the non-vacuity control: a mechanism that reports nothing on a tree of
 * 1,384 changesets has to be able to show it would speak if it had something to
 * say. `--audit` says how many bodies name a file at all, how many of those
 * names resolve to exactly one tracked file, and how many resolve nowhere.
 *
 * ⛔ It reports; it fixes nothing and judges nothing. A name that resolves
 * nowhere is not by itself a false claim - a changeset that RETIRED a file names
 * it correctly and the file is correctly gone.
 */
export function audit(root, ref = null) {
  const index = treeIndex(root, ref);
  const pendingPaths = [...index.paths].filter(
    (path) =>
      path.startsWith(CHANGESET_DIR) &&
      path.endsWith('.md') &&
      !NOT_A_CHANGESET.has(path.slice(path.lastIndexOf('/') + 1)),
  );
  const totals = {
    pending: pendingPaths.length,
    publishing: 0,
    naming: 0,
    resolved: 0,
    unresolved: 0,
    dangling: [],
    silent: 0,
    unreachable: 0,
    blind: [],
  };
  for (const [path, source] of readBlobs(root, ref, pendingPaths)) {
    const declaration = describeDeclaration(source);
    if (declaration.kind !== 'frontmatter' || declaration.entries === 0) continue;
    totals.publishing += 1;
    const spans = namedFiles(source);
    if (spans.length === 0) {
      // Coordinates itself by SYMBOL, or by nothing. No diff can ever make the
      // diff-mode check speak about this body (objectui#9140).
      totals.silent += 1;
      totals.blind.push(`${path}  ~  names no file at all`);
      continue;
    }
    totals.naming += 1;
    let resolvedHere = 0;
    for (const span of spans) {
      if (resolveNamed(index, span) === null) {
        totals.unresolved += 1;
        totals.dangling.push(`${path}  ~  ${span}`);
      } else {
        totals.resolved += 1;
        resolvedHere += 1;
      }
    }
    if (resolvedHere === 0) {
      totals.unreachable += 1;
      totals.blind.push(`${path}  ~  every name it spells resolves to none or to many`);
    }
  }
  return totals;
}

// -- the BORN-FALSE reading (objectui#9509) -----------------------------------

/**
 * A backticked span that carries a LINE ADDRESS.
 *
 * Two spellings, and the second is why this is not a one-line regex over the
 * whole body. `imported-defaults.ts:246` names its own file. `:246` does not —
 * it CONTINUES a file named earlier in the same paragraph, which is how both
 * measured instances were actually written, and reading it without that binding
 * would turn every port number and every `key: 246` into a citation.
 *
 * A trailing column (`:281:75`) and a range (`:221-:248`, `ts:221-228`) are both
 * kept: the first number is the one that moves, and the one a reader follows.
 */
const LINE_ADDRESS = /^(?<written>[^\s`]*?):(?<line>\d+)(?::\d+)?(?:-:?\d+)?$/;

/**
 * The sha a sentence binds its numbers to, if any.
 *
 * Hex, 7 to 40, with at least one of `a-f` in it — a bare `12345678` is a
 * number, not a tree. `at this head` / `@head` counts too: it names the tree as
 * definitely as a sha does, and it is the spelling the landed repairs used for
 * the half of a pair that was read at the head.
 */
const SHA_BINDING = /\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[a-f][0-9a-f]*\b|@\s*head\b|\bat\s+(?:this\s+)?head\b/i;

/**
 * The sentence of `paragraph` containing the character at `index`.
 *
 * ⚠️ Deliberately NOT the paragraph. The went-false reading quotes a paragraph
 * because a paragraph is the unit that ROTS (objectui#8617); a BINDING is the
 * opposite kind of thing — it is an author saying which tree THIS number came
 * from — and a sha three sentences away binds nothing. Measured against the
 * carded instance: objectui#9496's §2 paragraph names a sha, and a
 * paragraph-wide window would have exempted the very claim the card is about.
 */
export function sentenceAround(paragraph, index) {
  const before = paragraph.slice(0, index);
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('。'), before.lastIndexOf('\n'));
  const rest = paragraph.slice(index);
  const endOffset = rest.search(/\.\s|。|\n/);
  const end = endOffset === -1 ? paragraph.length : index + endOffset + 1;
  return paragraph.slice(start + 1, end);
}

/**
 * Every line address in one body, each already bound to the file it continues.
 *
 * Paragraph by paragraph, because the continuation binding is paragraph-scoped:
 * a bare `:246` reaches back to the last span in ITS paragraph that named a file,
 * and ⛔ never across a blank line into somebody else's subject.
 *
 * @param {string} source
 * @param {(span: string) => string | null} resolve  a spelling to one tracked file
 * @returns {{ span: string, written: string, line: number, file: string, bound: boolean,
 *             paragraph: string, sentence: string }[]}
 */
export function lineAddresses(source, resolve) {
  const out = [];
  for (const paragraph of source.split(/\r?\n\s*\r?\n/)) {
    let carried = null;
    for (const match of paragraph.matchAll(/`([^`\n]{2,200})`/g)) {
      const span = match[1].trim();
      // A plain file name with no number still sets the subject for the bare
      // addresses after it: "`imported-defaults.ts` ... at `:223`".
      if (NAMED_FILE.test(span) && PATH_SHAPED.test(span) && !span.includes(':')) {
        const resolved = resolve(span);
        if (resolved) carried = resolved;
        continue;
      }
      const parsed = LINE_ADDRESS.exec(span);
      if (!parsed) continue;
      const written = parsed.groups.written;
      let file = null;
      if (written === '') {
        file = carried;
      } else if (PATH_SHAPED.test(written) && NAMED_FILE.test(written)) {
        file = resolve(written);
        if (file) carried = file;
      }
      if (!file) continue;
      const sentence = sentenceAround(paragraph, match.index);
      out.push({
        span,
        written,
        line: Number(parsed.groups.line),
        file,
        bound: SHA_BINDING.test(sentence),
        paragraph: paragraph.replace(/\s+/g, ' ').trim(),
        sentence: sentence.replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return out;
}

/**
 * `@@ -a,b +c,d @@` hunk headers for one file, base to head.
 *
 * `-U0` deliberately: context lines would merge neighbouring hunks and make the
 * arithmetic below approximate, and this reading exists precisely to be exact
 * about which line a number lands on.
 */
export function hunksFor(root, { base, head = null }, file) {
  const args = ['diff', '-U0', '--no-color', base];
  if (head) args.push(head);
  args.push('--', file);
  const out = git(root, args, { allowFailure: true }) ?? '';
  const hunks = [];
  for (const match of out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks.push({
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
    });
  }
  return hunks;
}

/**
 * Where a BASE line ends up at the head, given this change's own hunks.
 *
 * `null` means the change rewrote or deleted that line outright — the sharpest
 * shape of the defect, because the number now points at whatever the diff put
 * there instead.
 *
 * A pure insertion (`oldCount === 0`) is spelled by git as "after old line
 * `oldStart`", so it moves lines STRICTLY BELOW it and leaves `oldStart` itself
 * alone. Getting that boundary wrong is an off-by-one that would report a
 * stable citation as moved, which is the false positive this reading can least
 * afford on a report-only channel.
 */
export function mapLine(hunks, line) {
  let delta = 0;
  for (const hunk of hunks) {
    if (hunk.oldCount === 0) {
      if (line <= hunk.oldStart) break;
      delta += hunk.newCount;
      continue;
    }
    if (line < hunk.oldStart) break;
    if (line < hunk.oldStart + hunk.oldCount) return null;
    delta += hunk.newCount - hunk.oldCount;
  }
  return line + delta;
}

/**
 * The born-false verdict for one address, given what this change did to its file.
 *
 * Pure, and injectable, so the controls below and the real run are judged by one
 * function rather than by two that can disagree.
 *
 * @param {{ file: string, line: number, bound: boolean }} address
 * @param {(file: string) => 'added' | 'modified' | null} statusOf
 * @param {(file: string) => {oldStart: number, oldCount: number, newCount: number}[]} hunksOf
 */
export function judgeAddress(address, statusOf, hunksOf) {
  if (address.bound) return { verdict: 'anchored', movedTo: null };
  const status = statusOf(address.file);
  if (status === null) return { verdict: 'untouched', movedTo: null };
  if (status === 'added') return { verdict: 'unanchored', movedTo: null };
  const movedTo = mapLine(hunksOf(address.file), address.line);
  if (movedTo === address.line) return { verdict: 'stable', movedTo };
  return { verdict: 'moved', movedTo };
}

/** Verdicts that are findings. The other two are the discrimination, not noise. */
export const BORN_FALSE_VERDICTS = new Set(['moved', 'unanchored']);

/**
 * The firing controls, taken from the artefact this card was measured on.
 *
 * ⚠️ NOT a round number invented here. objectui#9496 inserts 28 lines at
 * `imported-defaults.ts:221` and rewrites base `:223`; the landed pull request
 * body and the landed docblock BOTH publish the arithmetic independently —
 * `:246`@`b8a006883d` = `:274`@head. So 274 is attested outside this file and
 * ⛔ cannot be moved by an implementation that is wrong: a mapper that drifts by
 * one fails here rather than reporting a clean branch.
 *
 * The first two cases are the PAIR, one step apart: the same sentence, the same
 * geometry, differing only in whether the number names the tree it was read
 * from. The bound one must stay silent and the unbound one must fire — a
 * control that only ever fires proves nothing about discrimination.
 */
export const BORN_FALSE_CONTROLS = [
  {
    id: 'unbound-address-into-a-line-this-diff-moves',
    why: "objectui#9496 §2: `:246` at the base is `:274` at the head, moved by the diff's own 28-line insertion",
    // fixture-address: control input, the differ under test is what reads this address
    body: 'The shape recurs exactly twice in `imported-defaults.ts`: `:223` and `:246`.',
    want: (rows) => rows.length === 2 && rows.every((r) => BORN_FALSE_VERDICTS.has(r.verdict))
      && rows[0].movedTo === null && rows[1].movedTo === 274,
  },
  {
    id: 'the-same-address-bound-to-a-sha-is-silent',
    why: 'the durable form both pull requests converged on is ⛔ never reported, or the gate teaches authors to unbind',
    // fixture-address: control input, the differ under test is what reads this address
    body: 'At `b8a006883d` the shape recurs twice in `imported-defaults.ts`: `:223` and `:246`.',
    want: (rows) => rows.length === 0,
  },
  {
    id: 'an-address-this-diff-does-not-move-is-silent',
    why: 'a line above every hunk is untouched — without this the reading is an absolute count of citations, not a differential',
    // fixture-address: control input, the differ under test is what reads this address
    body: 'See `imported-defaults.ts:100` for the walker entry point.',
    want: (rows) => rows.length === 0,
  },
  {
    // ⭐ THE BOUNDARY. git spells a pure insertion as "after old line 220", so
    // 220 is the last line the insertion does not move and 221 is the first it
    // does. Measured: mutating `line <= hunk.oldStart` to `line <` leaves the
    // three controls above it all PASSING while every stable citation at an
    // insertion point is silently reported as moved — a gate that manufactures
    // findings, which on a report-only channel is how a channel gets muted.
    id: 'the-insertion-point-itself-does-not-move',
    why: 'a pure insertion moves the lines BELOW it; reporting its own anchor line would fake a finding on every stable citation',
    // fixture-address: control input, the differ under test is what reads this address
    body: 'The walker entry is at `imported-defaults.ts:220`, just above the block.',
    want: (rows) => rows.length === 0,
  },
  {
    id: 'an-address-into-a-file-this-change-adds-is-unanchored',
    why: 'instance 1: a frame in a file the branch itself creates was read from a tree that exists nowhere else, and moved twice',
    body: 'The deep-clean control is at `imported-defaults-rest-less-tuple-9088.test.ts:281`.',
    want: (rows) => rows.length === 1 && rows[0].verdict === 'unanchored',
  },
];

/**
 * Runs every control through the real reader, against objectui#9496's geometry.
 *
 * HERMETIC — the hunks are the ones that pull request actually produced, written
 * out here rather than read from the tree. A control that resolved against the
 * live history would answer a different question after the next squash, and a
 * gate whose controls rot reports "instrument broken" wherever it is not run
 * from this checkout.
 *
 * `judgeFor` is injectable for one reason: a test has to be able to show that a
 * judge which LIES fails these controls rather than passing them. A control
 * suite that cannot be made to fail is decoration.
 */
export function evaluateBornFalseControls(judgeFor = judgeAddress) {
  const MODIFIED = 'packages/types/src/zod/imported-defaults.ts';
  const ADDED = 'packages/types/src/__tests__/imported-defaults-rest-less-tuple-9088.test.ts';
  // `@@ -220,0 +221,28 @@` and `@@ -223 +251 @@`, as measured on 8700d6d93.
  const hunks = [
    { oldStart: 220, oldCount: 0, newCount: 28 },
    { oldStart: 223, oldCount: 1, newCount: 1 },
  ];
  const resolve = (span) =>
    MODIFIED.endsWith('/' + span) ? MODIFIED : ADDED.endsWith('/' + span) ? ADDED : null;
  const statusOf = (file) => (file === MODIFIED ? 'modified' : file === ADDED ? 'added' : null);

  return BORN_FALSE_CONTROLS.map((control) => {
    let rows = [];
    let ok = false;
    let detail = '';
    try {
      rows = lineAddresses(control.body, resolve)
        .map((address) => ({ ...address, ...judgeFor(address, statusOf, () => hunks) }))
        .filter((row) => BORN_FALSE_VERDICTS.has(row.verdict));
      ok = control.want(rows) === true;
      detail = rows.map((r) => `${r.span} -> ${r.verdict}${r.movedTo ? ` (:${r.movedTo})` : ''}`).join(', ') || '(silent)';
    } catch (error) {
      detail = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    return { id: control.id, why: control.why, ok, detail };
  });
}

/**
 * The born-false findings for this change, over the prose it publishes about
 * itself.
 *
 * @param {string} root
 * @param {{ base: string, head?: string | null, prBody?: string | null }} options
 * @returns {{ findings: object[], corpus: {origin: string, addresses: number}[], read: number }}
 */
export function bornFalse(root, { base, head = null, prBody = null }) {
  const changed = changedFiles(root, { base, head });
  const added = new Set(changedFiles(root, { base, head, filter: 'A' }));
  const subject = changed.filter((file) => !file.startsWith(CHANGESET_DIR));
  const ownChangesets = changed.filter((file) => file.startsWith(CHANGESET_DIR));

  const baseIndex = treeIndex(root, base);
  const headIndex = treeIndex(root, head);
  // Resolved against the HEAD tree as well as the base: a file this change ADDS
  // is not in the base listing at all, and the unanchored half of this reading
  // is exactly about those.
  const resolve = (span) => resolveNamed(headIndex, span) ?? resolveNamed(baseIndex, span);
  const touched = new Set(subject);
  const statusOf = (file) => (touched.has(file) ? (added.has(file) ? 'added' : 'modified') : null);

  const hunkCache = new Map();
  const hunksOf = (file) => {
    if (!hunkCache.has(file)) hunkCache.set(file, hunksFor(root, { base, head }, file));
    return hunkCache.get(file);
  };

  const corpus = [];
  if (typeof prBody === 'string' && prBody.trim() !== '') {
    corpus.push({ origin: 'the pull request body', source: prBody });
  }
  for (const [path, source] of readBlobs(root, head, ownChangesets)) {
    corpus.push({ origin: path, source });
  }

  const findings = [];
  const read = [];
  for (const entry of corpus) {
    const addresses = lineAddresses(entry.source, resolve);
    read.push({ origin: entry.origin, addresses: addresses.length });
    for (const address of addresses) {
      const judged = judgeAddress(address, statusOf, hunksOf);
      if (!BORN_FALSE_VERDICTS.has(judged.verdict)) continue;
      findings.push({
        origin: entry.origin,
        span: address.span,
        file: address.file,
        line: address.line,
        verdict: judged.verdict,
        movedTo: judged.movedTo,
        sentence: address.sentence,
      });
    }
  }
  findings.sort((a, b) => a.origin.localeCompare(b.origin) || a.line - b.line);
  return { findings, corpus: read, subject: subject.length };
}

// -- the SELF-CONTRADICTION reading (objectui#9841) ---------------------------

/**
 * The package names one changeset's own front matter declares.
 *
 * The three structural gates already parse this block; none of them keeps the
 * NAMES, because none of them has a second half to read them against. This one
 * does: the body of the same file.
 *
 * Same line grammar as `describeDeclaration`, which counts these entries — kept
 * next to it rather than exported from it so that gate's return shape, which
 * four call sites read, does not move for this one.
 *
 * @returns {string[]} declared package names, in file order
 */
export function declaredPackages(source) {
  const lines = source.split(/\r?\n/);
  const open = lines.findIndex((line) => line.trim() === '---');
  if (open === -1) return [];
  const names = [];
  for (let i = open + 1; i < lines.length; i++) {
    const text = lines[i].trim();
    if (text === '---') return names;
    if (text === '' || text.startsWith('#')) continue;
    const entry = /^(?:"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(?:major|minor|patch)\s*$/.exec(text);
    if (entry) names.push((entry[1] ?? entry[2] ?? entry[3]).trim());
  }
  return [];
}

/**
 * Every workspace package's name, mapped to the directory that carries it.
 *
 * Read from the tree, never from a hard-coded `@object-ui/*` list: the DIRECTORY
 * is the second spelling a body uses for a package, and the carded instance used
 * exactly that one — it wrote `packages/types`, not `@object-ui/types`. A gate
 * that only knew npm names would have been silent on the one artefact it exists
 * for.
 *
 * Depth-1 `package.json` (the workspace root) is excluded: its directory is the
 * whole repository, and every path in every body is inside it.
 *
 * @returns {Map<string, string>} package name -> repo-relative directory
 */
export function packageDirectories(root, ref = null) {
  const index = treeIndex(root, ref);
  const manifests = [...index.paths].filter(
    (path) => path.endsWith('/package.json') && !path.includes('node_modules/') && path.split('/').length > 2,
  );
  const map = new Map();
  for (const [path, source] of readBlobs(root, ref, manifests)) {
    try {
      const name = JSON.parse(source)?.name;
      if (typeof name === 'string' && name !== '') map.set(name, path.slice(0, path.lastIndexOf('/')));
    } catch {
      /* an unparseable manifest names no package; absent is the answer */
    }
  }
  return map;
}

/** A negation of change, as an adjective. The spellings a body actually uses. */
const NO_CHANGE_ADJECTIVE = String.raw`(?:untouched|unchanged|unmodified|not\s+touched|not\s+modified|not\s+changed)`;

/** A verb of change, for the "does not move" and "nothing in X moves" shapes. */
const CHANGE_VERB = String.raw`(?:moves?|moved|changes?|changed|shifts?|shifted)`;

/**
 * Subject and negation with NOTHING BETWEEN THEM but a copula.
 *
 * ⭐ This is the whole discrimination, and it is a measurement rather than a
 * taste call. Over the corpus objectui#9841's falsification pass read — every
 * pending `.changeset/*.md` in this tree, plus every released CHANGELOG entry
 * beside a `package.json` — the card's own proposed coordinate ("a sentence that
 * names a declared package adjacent to a negation of change") pairs many times,
 * and every one of those pairings is LEGITIMATE: they negate an ASPECT of the
 * package, never the package. «`@object-ui/fields` re-exports all four names
 * unchanged», «Both are internal to `@object-ui/app-shell`; no package export
 * moves», «`packages/app-shell` type-checks unchanged». Requiring the negation to
 * attach DIRECTLY to a bare package spelling drops every one of them and keeps
 * the attested instance. The numbers are not copied here (AGENTS.md #9) —
 * `--census` re-derives both coordinates over whatever corpus the tree carries.
 *
 * ⚠️ The known false positive this shape can still produce, named rather than
 * hidden: a body that declares a package to carry a DEPENDENT bump and says so —
 * «`@object-ui/react` is unchanged; it bumps because core's types moved». That
 * sentence pairs, and it is honest. It occurs zero times in the corpus `--census`
 * reads, which is why it is documented instead of carved out: a carve-out for a
 * shape nobody writes is a hole nobody is watching.
 */
const COPULA = String.raw`(?:\s*\*{0,2}\s*(?:itself\s+)?(?:is|are|was|were|remains?|stays?)\s+(?:\w+ly\s+)?\*{0,2}\s*)`;

/**
 * Where a package spelling may end: never mid-path and never mid-word.
 *
 * `packages/types` must not match inside
 * `packages/types/examples/data-display-examples.json`, which a pending body says
 * is untouched and legitimately so — the subject there is one example file, not
 * the package.
 */
const SPELLING_END = String.raw`(?![\w/@.-])`;

/**
 * The self-contradictions in ONE changeset: a package its own front matter
 * declares, negated in its own body.
 *
 * ⛔ Not prose understanding, and ⛔ not a diff: name resolution between two parts
 * of the same file. A declaration says this package is being released; a sentence
 * attached to that package's own name says it did not change. The two halves
 * publish together, verbatim, into that package's CHANGELOG.
 *
 * @param {string} source  the whole `.changeset/*.md`, front matter included
 * @param {(name: string) => string | null} dirOf  package name -> its directory
 * @returns {{ package: string, spelling: string, claim: string, sentence: string }[]}
 */
export function selfContradictions(source, dirOf) {
  const declared = declaredPackages(source);
  if (declared.length === 0) return [];
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const flat = body.replace(/\s+/g, ' ');
  const found = [];
  for (const name of declared) {
    const spellings = [name];
    const dir = dirOf(name);
    if (dir) spellings.push(dir);
    for (const spelling of spellings) {
      const quoted = spelling.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const subject = '`?\\*{0,2}' + quoted + '\\*{0,2}`?' + SPELLING_END;
      const shapes = [
        new RegExp(subject + COPULA + String.raw`\*{0,2}` + NO_CHANGE_ADJECTIVE, 'gi'),
        new RegExp(subject + String.raw`\s*(?:does\s+not|is\s+not|are\s+not)\s+\*{0,2}` + CHANGE_VERB, 'gi'),
        new RegExp(String.raw`nothing\s+(?:at\s+all\s+)?in\s+` + subject + String.raw`\s+\*{0,2}` + CHANGE_VERB, 'gi'),
      ];
      for (const shape of shapes) {
        for (const hit of body.matchAll(shape)) {
          const at = body.slice(0, hit.index).replace(/\s+/g, ' ').length;
          found.push({
            package: name,
            spelling,
            claim: hit[0].replace(/\s+/g, ' ').trim(),
            sentence: sentenceAround(flat, at).replace(/\s+/g, ' ').trim(),
          });
        }
      }
    }
  }
  // One row per (package, claim): the same sentence reached through both
  // spellings is one contradiction, not two.
  const seen = new Set();
  return found.filter((row) => {
    const key = `${row.package}|${row.claim.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * BORN FALSE or WENT FALSE, decided from this change's OWN commit history.
 *
 * ⭐ The split objectui#9841 required, and the reason it cannot be read off the
 * head alone. The carded instance is measured: at `2bc8fd12e2`, the commit that
 * ADDED that changeset, the body already said «`packages/types` is untouched» and
 * the front matter declared `@object-ui/components` and nothing else — the
 * sentence was TRUE. At `21896172a9` the same commit that moved 62 lines in
 * `packages/types/src/overlay.ts` added `'@object-ui/types': patch` to that same
 * front matter. Against the merge base the net diff shows the file simply ADDED,
 * with both halves present, and reads as born false. It was not. Only the
 * branch's own revisions of the file separate the two.
 *
 *   BORN FALSE  the earliest revision that carries the claim ALREADY declared
 *               the package. False the moment it was written.
 *   WENT FALSE  that revision did not declare it. The claim stood, and a later
 *               commit — usually the one that did the work — falsified it by
 *               declaring the package.
 *   UNDATED     no revision in reach carries the claim (a shallow clone, or a
 *               working-tree run whose text is in no commit). Reported as
 *               undated, never defaulted to either verdict: "was false when
 *               written" is an accusation this reading declines to guess at.
 *
 * ⚠️ THE BASE IS READ FIRST, and ⛔ the branch walk alone is not enough. A
 * changeset can be PENDING for weeks carrying a true sentence, and this change
 * can falsify it by adding one line to its front matter — the shape
 * `check-changeset-overwrite.mjs` calls its case 2. Walking only `base..head`
 * finds that one commit, sees the declaration it just added, and reports BORN
 * FALSE: the exact misreading objectui#9841 forbids, on the case where the
 * sentence is oldest and most obviously stood on its own. So if the claim is
 * already at the base, the base's own front matter decides, and the branch walk
 * is only reached for a claim this change itself brought.
 *
 * @returns {'born' | 'went' | 'undated'}
 */
export function dateClaim(root, { base, head = null }, file, claim, pkg) {
  const needle0 = claim.replace(/\s+/g, ' ').toLowerCase();
  const carries = (source) =>
    source !== null &&
    source
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .includes(needle0);

  // The base first — see the note above. A claim that was already standing when
  // this change started is dated by the front matter it was standing against,
  // never by the commit that just moved it.
  const atBase = git(root, ['show', `${base}:${file}`], { allowFailure: true });
  if (carries(atBase)) return declaredPackages(atBase).includes(pkg) ? 'born' : 'went';

  const range = head ? `${base}..${head}` : base;
  const log = git(root, ['log', '--reverse', '--format=%H', range, '--', file], { allowFailure: true });
  const commits = (log ?? '').split('\n').filter((line) => line !== '');
  const needle = claim.replace(/\s+/g, ' ').toLowerCase();
  for (const commit of commits) {
    const source = git(root, ['show', `${commit}:${file}`], { allowFailure: true });
    if (source === null) continue;
    const body = source
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    if (!body.includes(needle)) continue;
    return declaredPackages(source).includes(pkg) ? 'born' : 'went';
  }
  return 'undated';
}

/**
 * Every changeset THIS change adds or modifies, read against its own front
 * matter.
 *
 * ⛔ HERMETIC BY CONSTRUCTION, and that is a structural property rather than a
 * convention (objectui#9744). This reading takes NO ambient input at all: no
 * `GITHUB_EVENT_PATH`, no pull request body, no environment variable, no network.
 * Its corpus is `git diff --name-only` under `root`, restricted to
 * `.changeset/*.md`, read out of that same tree. On PR objectui#9744 the
 * born-false reading's corpus went AMBIENT — `GITHUB_EVENT_PATH` is exported to
 * every process on a runner, so a run against a throwaway fixture picked up the
 * real pull request body of whatever build happened to be running, and the
 * empty-corpus floor slid a level in CI while passing locally. A reading with no
 * env-shaped input cannot fail that way, and the pin for it asserts the output is
 * identical with the variable poisoned.
 *
 * @returns {{ findings: object[], corpus: string[], declaring: number }}
 */
export function selfContradiction(root, { base, head = null }) {
  const own = changedFiles(root, { base, head, pathspecs: [':(glob).changeset/*.md'] }).filter(
    (path) => !NOT_A_CHANGESET.has(path.slice(path.lastIndexOf('/') + 1)),
  );
  const directories = packageDirectories(root, head);
  const dirOf = (name) => directories.get(name) ?? null;

  const findings = [];
  const corpus = [];
  let declaring = 0;
  for (const [path, source] of readBlobs(root, head, own)) {
    corpus.push(path);
    if (declaredPackages(source).length === 0) continue;
    declaring += 1;
    for (const row of selfContradictions(source, dirOf)) {
      findings.push({
        changeset: path,
        ...row,
        when: dateClaim(root, { base, head }, path, row.claim, row.package),
      });
    }
  }
  findings.sort((a, b) => a.changeset.localeCompare(b.changeset) || a.claim.localeCompare(b.claim));
  return { findings, corpus, declaring };
}

/**
 * The firing controls for this reading, taken from the attested artefact.
 *
 * HERMETIC — the bodies are the ones PR objectui#9796 actually carried, written
 * out here rather than read from the live history, for the reason
 * `evaluateBornFalseControls` states: a control that resolves against the tree
 * answers a different question after the next squash.
 *
 * ⭐ Cases 1 and 2 are the PAIR, and they are the discrimination this whole
 * reading rests on: the SAME package, the SAME file, one clause apart. The
 * contradiction fires; the REPAIR that landed on that pull request — which names
 * the aspect that does not move and the file that does — must stay silent, or
 * this reading is teaching authors to delete a correct sentence.
 */
export const SELF_CONTRADICTION_CONTROLS = [
  {
    id: 'a-bare-package-spelling-negated-in-its-own-declaring-body',
    why: 'objectui#9796 at 21896172a9: the front matter declared `@object-ui/types` while the body said `packages/types` is untouched',
    declared: ['@object-ui/types'],
    body: '⛔ **No published face moves.** `packages/types` is untouched: the accept set is the one both faces already shipped.',
    want: (rows) => rows.length === 1 && rows[0].package === '@object-ui/types' && rows[0].spelling === 'packages/types',
  },
  {
    id: 'the-repair-that-landed-on-that-pull-request-is-silent',
    why: 'the legitimate form names the ASPECT that does not move and the FILE that does — reporting it would teach authors to delete a correct sentence',
    declared: ['@object-ui/types'],
    body:
      '⛔ No type, no accept set, no export and no runtime behaviour moves in `@object-ui/types`: ' +
      'every changed line in `packages/types/src/overlay.ts` is a docblock line.',
    want: (rows) => rows.length === 0,
  },
  {
    id: 'an-aspect-scoped-negation-is-silent',
    why: 'the whole measured corpus is this shape — a face, a surface, an export, a symbol, a behaviour — and every instance of it is legitimate',
    declared: ['@object-ui/fields'],
    body: '`@object-ui/fields` re-exports all four names unchanged, so no import path or behaviour changes.',
    want: (rows) => rows.length === 0,
  },
  {
    // ⭐ THE OTHER HALF. Without a declaration there is no contradiction: a body
    // may say any number of packages are untouched, and saying so is how a
    // changeset explains its blast radius. Mutating this reading to report every
    // negated package leaves the three controls above it all PASSING.
    id: 'a-package-the-front-matter-does-not-declare-is-silent',
    why: 'the finding is a contradiction WITH A DECLARATION, never a negation on its own — a body naming what it did not touch is normal and useful',
    declared: ['@object-ui/types'],
    body: '`packages/core` is untouched, and `@object-ui/react` does not move either.',
    want: (rows) => rows.length === 0,
  },
  {
    id: 'a-longer-path-inside-the-package-is-silent',
    why: 'a pending body says `packages/types/examples/data-display-examples.json` is untouched — the subject there is one example file, not the package',
    declared: ['@object-ui/types'],
    body: 'The example corpus — `packages/types/examples/data-display-examples.json` — is untouched, and both mirrors still parse.',
    want: (rows) => rows.length === 0,
  },
  {
    id: 'the-npm-name-spelling-fires-as-well-as-the-directory',
    why: 'a body may negate either spelling; the carded instance used the directory, so the name half would otherwise never be exercised',
    declared: ['@object-ui/types'],
    body: '`@object-ui/types` is unchanged in this release.',
    want: (rows) => rows.length === 1 && rows[0].spelling === '@object-ui/types',
  },
];

/**
 * Runs every control through the real reader.
 *
 * `read` is injectable for the reason `evaluateBornFalseControls`'s judge is: a
 * test has to be able to show that a reader which LIES fails these controls
 * rather than passing them. A control suite that cannot be made to fail is
 * decoration.
 */
export function evaluateSelfContradictionControls(read = selfContradictions) {
  const DIRECTORIES = new Map([
    ['@object-ui/types', 'packages/types'],
    ['@object-ui/fields', 'packages/fields'],
    ['@object-ui/core', 'packages/core'],
    ['@object-ui/react', 'packages/react'],
  ]);
  return SELF_CONTRADICTION_CONTROLS.map((control) => {
    const source = `---\n${control.declared.map((name) => `'${name}': patch`).join('\n')}\n---\n\n${control.body}\n`;
    let ok = false;
    let detail = '';
    try {
      const rows = read(source, (name) => DIRECTORIES.get(name) ?? null);
      ok = control.want(rows) === true;
      detail = rows.map((row) => `${row.spelling} -> ${JSON.stringify(row.claim)}`).join(', ') || '(silent)';
    } catch (error) {
      detail = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    return { id: control.id, why: control.why, ok, detail };
  });
}

/**
 * The population reading for this coordinate, over one tree rather than a diff.
 *
 * Answers the question objectui#9841 was filed to have answered before anything
 * was built: is «front matter declares P, body negates P» ever a live
 * contradiction, or is it always legitimate phrasing? It prints BOTH coordinates
 * — the card's proposed one (the package named anywhere in a sentence carrying a
 * negation) and the one this reading uses (the negation attached to the package)
 * — so the gap between them is re-derived rather than remembered.
 *
 * ⛔ Report-only, and never a verdict on anybody's prose: an aspect-scoped
 * negation is correct English and correct practice.
 */
export function census(root, ref = null) {
  const index = treeIndex(root, ref);
  const directories = packageDirectories(root, ref);
  const dirOf = (name) => directories.get(name) ?? null;
  const pending = [...index.paths].filter(
    (path) =>
      path.startsWith(CHANGESET_DIR) &&
      path.endsWith('.md') &&
      !NOT_A_CHANGESET.has(path.slice(path.lastIndexOf('/') + 1)),
  );
  const totals = { pending: pending.length, publishing: 0, loose: 0, looseFiles: 0, attached: 0, hits: [] };
  const NEGATION = new RegExp(`(?:${NO_CHANGE_ADJECTIVE}|no\\s+change[sd]?|nothing\\s+${CHANGE_VERB})`, 'i');
  for (const [path, source] of readBlobs(root, ref, pending)) {
    const declared = declaredPackages(source);
    if (declared.length === 0) continue;
    totals.publishing += 1;
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
    let looseHere = 0;
    for (const sentence of body.split(/(?<=[.!?])\s+|\n/)) {
      if (!NEGATION.test(sentence)) continue;
      for (const name of declared) {
        const dir = dirOf(name);
        const quoted = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(?:${quoted(name)}${dir ? `|${quoted(dir)}` : ''})`, 'i').test(sentence)) looseHere += 1;
      }
    }
    totals.loose += looseHere;
    if (looseHere > 0) totals.looseFiles += 1;
    for (const row of selfContradictions(source, dirOf)) {
      totals.attached += 1;
      totals.hits.push(`${path}  ~  [${row.package}]  ${row.claim}`);
    }
  }
  return totals;
}

// -- CLI ----------------------------------------------------------------------

if (isEntrypoint(import.meta.url)) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };

  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));

  // ── the self-contradiction population reading (objectui#9841) ─────────────
  //
  // The falsification pass the card demanded before anything was built, kept as
  // a mode rather than written down as a number: both coordinates, re-derived
  // over whatever corpus the tree carries today (AGENTS.md #9).
  if (process.argv.includes('--census')) {
    let totals;
    try {
      totals = census(root, argOf('--ref'));
    } catch (error) {
      console.error(`❌  ${error.message}`);
      process.exit(1);
    }
    console.log(
      `Pending declarations: ${totals.pending}. Publishing a body verbatim at the next release: ${totals.publishing}.`,
    );
    console.log(
      `\nThe CARD'S proposed coordinate — a sentence that names a declared package anywhere in it ` +
        `and\ncarries a negation of change: ${totals.loose} pairing(s) across ${totals.looseFiles} body(ies).`,
    );
    console.log(
      `\nTHIS reading's coordinate — the negation attached DIRECTLY to a bare package spelling, ` +
        `with\nnothing between them but a copula: ${totals.attached} finding(s).`,
    );
    for (const hit of totals.hits) console.log(`      ${hit}`);
    console.log(
      '\n    The gap between those two numbers is the false-positive budget this coordinate buys.\n' +
        '    ⛔ Neither number is a verdict on anybody’s prose: a body that negates an ASPECT of a\n' +
        '    package it patches — a face, a surface, an export, a named symbol, one file — is\n' +
        '    correct English and correct practice, and is the entire content of the first number.',
    );
    process.exit(0);
  }

  if (process.argv.includes('--audit')) {
    let totals;
    try {
      totals = audit(root, argOf('--ref'));
    } catch (error) {
      console.error(`❌  ${error.message}`);
      process.exit(1);
    }
    console.log(
      `Pending declarations: ${totals.pending}. Publishing a body verbatim at the next release: ` +
        `${totals.publishing}. Naming at least one file in backticks: ${totals.naming}.`,
    );
    console.log(
      `File names in those bodies: ${totals.resolved} resolve to exactly one tracked file, ` +
        `${totals.unresolved} resolve to none or to many.`,
    );
    console.log(
      `\nOutside the diff-mode check's reach ENTIRELY: ${totals.silent} publishing body(ies) name no file ` +
        `at all,\nand ${totals.unreachable} spell only names that resolve to none or to many. Those ` +
        `${totals.silent + totals.unreachable} cannot be\nreported for ANY diff — that is the size of the ` +
        'blind spot (objectui#9140), re-derived each run.',
    );
    if (process.argv.includes('--blind')) for (const line of totals.blind) console.log(`      ${line}`);
    console.log(
      '\n    A name that resolves to nothing is ⛔ NOT a false claim on its own — a changeset that\n' +
        '    retired a file names it correctly and the file is correctly gone. This count is the\n' +
        "    reach of the diff-mode check, not a verdict on anybody's prose.\n" +
        '    ⛔ Nor is a body that names no file WRONG for coordinating itself by symbol — that is a\n' +
        '    normal way to write a changeset. It is simply a body this gate cannot carry a request\n' +
        '    to read about, and objectui#9140 measured one WENT-FALSE claim that sat there unseen.',
    );
    process.exit(0);
  }

  const head = argOf('--head');
  const base = resolveBaseRef(root, { explicit: argOf('--base') });
  if (!base.ok) {
    console.error(
      '❌  Cannot resolve the commit to compare against, so there is nothing to diff.\n' +
        `    tried: ${base.tried.join(', ')}\n` +
        (base.named
          ? '    That base was named EXPLICITLY, so it is not guessed around. Name a commit that\n' +
            '    exists in this clone, or pass none.\n'
          : base.shallow
            ? '    This clone is SHALLOW. In CI, give the checkout `fetch-depth: 0`; locally, run\n' +
              '    `git fetch --no-tags origin main` (or `git fetch --unshallow`).\n'
            : '    Fetch the base branch (`git fetch --no-tags origin main`) and re-run.\n') +
        '    A failure, not a skip: report-only means this gate declines to fail on its FINDINGS,\n' +
        '    never that it passes without looking (objectstack#4928, objectui#4690).',
    );
    process.exit(1);
  }

  let result;
  try {
    result = claims(root, { base: base.ref, head });
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: losing an input means this gate cannot tell\n' +
        '    whether anything needs re-reading (objectui#4690).',
    );
    process.exit(1);
  }

  // ── the born-false reading (objectui#9509) ────────────────────────────────
  //
  // The corpus is the prose THIS change publishes about itself, and the pull
  // request body is where two of the three carded instances lived. It is read
  // from the event payload the job already receives — ⛔ no new workflow, no new
  // permission and no API call: `GITHUB_EVENT_PATH` is a file on the runner, and
  // `check-governed-queue-guard.mjs` already reads it the same way.
  //
  // ⚠️ A `merge_group` build has no `pull_request` payload. That is an ABSENCE
  // of corpus, never a clean verdict, and the report below says which.
  const prBodyFile = argOf('--pr-body');
  let prBody = null;
  let prBodyHow = 'not available on this event';
  if (prBodyFile) {
    try {
      prBody = readFileSync(resolve(root, prBodyFile), 'utf8');
      prBodyHow = `--pr-body ${prBodyFile}`;
    } catch (error) {
      console.error(`⚠️  Could not read ${prBodyFile}: ${error.message}`);
      prBodyHow = `--pr-body ${prBodyFile} (UNREADABLE — this run read no pull request body)`;
    }
  } else if (process.env.GITHUB_EVENT_PATH) {
    // ⚠️ GATED, and the gate is the whole point (objectui#9509, patch round 1).
    //
    // `GITHUB_EVENT_PATH` is exported to EVERY process on a runner, not just the
    // workflow step this reading was written for. An ungated read made this gate's
    // corpus AMBIENT: run against a throwaway fixture repository in CI, it picked
    // up the real pull request body of whatever build happened to be running and
    // counted it as "the prose this change publishes about itself" — which in that
    // tree it provably was not. Measured, by this gate's own empty-corpus floor
    // going soft in CI while passing locally.
    //
    // The predicate is about the TREE, not about how the process was launched: the
    // payload names `pull_request.head.sha`, and if the tree under this run cannot
    // resolve that commit then the payload describes some other repository at some
    // other head. Fails CLOSED and says so — ⛔ never silently.
    try {
      const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      const body = payload?.pull_request?.body;
      const sha = payload?.pull_request?.head?.sha;
      const carried = typeof sha === 'string' && git(root, ['cat-file', '-e', `${sha}^{commit}`], { allowFailure: true }) !== null;
      if (typeof body === 'string' && carried) {
        prBody = body;
        prBodyHow = `GITHUB_EVENT_PATH → pull_request.body (head ${String(sha).slice(0, 9)}, carried by this tree)`;
      } else if (typeof body === 'string') {
        prBodyHow =
          `GITHUB_EVENT_PATH names a pull request at ${sha ? String(sha).slice(0, 9) : 'an unstated head'} ` +
          'which THIS TREE DOES NOT CARRY — ⛔ ignored, because a body from another tree is not the prose ' +
          'this change publishes about itself';
      }
    } catch (error) {
      prBodyHow = `GITHUB_EVENT_PATH unreadable (${error.message}) — this run read no pull request body`;
    }
  }

  const bornControls = evaluateBornFalseControls();
  const selfControls = evaluateSelfContradictionControls();
  // Both control suites, in one list. An instrument that cannot fire is not a
  // reading, and which of the three readings broke does not change that verdict.
  const brokenControls = [...bornControls, ...selfControls].filter((control) => !control.ok);

  // ── the self-contradiction reading (objectui#9841) ────────────────────────
  //
  // ⛔ `prBody` is deliberately NOT passed, and no environment is read here. Its
  // corpus is this change's own `.changeset/*.md`, out of this tree — see the
  // hermeticity note on `selfContradiction`.
  let self;
  try {
    self = selfContradiction(root, { base: base.ref, head });
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    The self-contradiction reading lost an input, so it measured nothing. Reported as a\n' +
        '    failure rather than as an empty finding set (objectui#4690).',
    );
    process.exit(1);
  }

  let born;
  try {
    born = bornFalse(root, { base: base.ref, head, prBody });
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    The born-false reading lost an input, so it measured nothing. Reported as a failure\n' +
        '    rather than as an empty finding set (objectui#4690).',
    );
    process.exit(1);
  }

  // The DELIVERY hand-off (objectui#9140). One measurement, two consumers: the
  // log below, which a human reads by opening the job, and this file, which
  // `render-changeset-claims-comment.mjs` turns into the pull request comment.
  //
  // A file rather than a second `claims()` call in the renderer, for the reason
  // `performance-budget.yml` passes its measurement through step outputs: a
  // report that re-derives its own subject can disagree with the log it claims
  // to be reporting, and the disagreement is invisible to both.
  //
  // A write that fails is a WARNING, never a failure. The verdict is the log and
  // it is already printed; losing the hand-off loses the delivery, which the
  // comment step reports as a missing file. Exit 1 here would be this gate
  // failing a build over its own plumbing — the one thing "report-only" forbids.
  const jsonPath = argOf('--json');
  if (jsonPath) {
    try {
      writeFileSync(
        resolve(root, jsonPath),
        `${JSON.stringify(
          {
            base: base.ref,
            baseHow: base.how,
            head,
            changed: result.subject.length,
            pending: result.pending,
            considered: result.considered,
            findings: result.findings,
            bornFalse: born.findings,
            bornFalseCorpus: born.corpus,
            bornFalseControls: bornControls,
            selfContradiction: self.findings,
            selfContradictionCorpus: self.corpus,
            selfContradictionDeclaring: self.declaring,
            selfContradictionControls: selfControls,
            prBodyHow,
          },
          null,
          2,
        )}\n`,
      );
    } catch (error) {
      console.error(`⚠️  Could not write ${jsonPath}: ${error.message} — the log below is unaffected.`);
    }
  }

  console.log(
    `Compared ${head ?? 'the working tree'} with ${base.ref.slice(0, 9)} (${base.how}): ` +
      `${result.subject.length} file(s) changed outside .changeset/, read against ${result.considered} ` +
      `pending declaration(s) that publish a body (${result.pending} pending in total).`,
  );

  // ── the born-false report (objectui#9509) ─────────────────────────────────
  //
  // Printed FIRST and unconditionally. It is about the prose this change is
  // publishing right now, which is the one thing the seat reading this can still
  // change for free — and unlike the went-false half, nothing later will ever
  // turn it red.
  console.log('\n── Born false — claims this change publishes about a tree it replaced ──\n');
  for (const control of bornControls) {
    console.log(`    ${control.ok ? 'PASS' : 'FAIL'}  ${control.id}: ${control.detail}`);
  }
  const corpusRead = born.corpus.reduce((sum, entry) => sum + entry.addresses, 0);
  console.log(
    `\n    Corpus: ${born.corpus.length} body(ies) this change publishes about itself ` +
      `(${prBodyHow}).\n    Line addresses read in them: ${corpusRead}.`,
  );
  if (born.corpus.length === 0) {
    // ⛔ The FLOOR. An empty corpus is an absence of subject, and printing a tick
    // for it would report "this change publishes no false claim" on a run that
    // read no prose at all — the shape objectstack#4928 named.
    console.log(
      '\n    ⛔ NOT a clean verdict: this run read NO published prose, so it measured NOTHING\n' +
        '       of this class. On a pull request the body arrives via GITHUB_EVENT_PATH; on a\n' +
        '       merge_group build there is no pull request and no body to read.',
    );
  } else if (corpusRead === 0) {
    // A SECOND floor, one level in. The corpus was read but spells no address at
    // all, so there was nothing of this class to judge — which is not the same
    // answer as "every address checked out", and printing the same tick for both
    // is how a reader learns to read the tick as noise.
    console.log(
      '\n    ⚠️  Read, but nothing to judge: that prose spells no line address this gate can\n' +
        '        resolve to one tracked file. ⛔ Not the same answer as a clean one.',
    );
  } else if (born.findings.length === 0) {
    console.log(
      `\n    ✅  Every one of those ${corpusRead} address(es) either names the tree it was read\n` +
        '        from, or points at a line this change does not move.',
    );
  } else {
    console.log(
      `\n⚠️  ${born.findings.length} address(es) in the prose this change publishes were read from a\n` +
        "    tree this change itself replaces:\n",
    );
    for (const hit of born.findings) {
      const where =
        hit.verdict === 'unanchored'
          ? `${hit.file} is ADDED by this change — that line exists in no tree outside this pull request`
          : hit.movedTo === null
            ? `this change REWRITES ${hit.file}:${hit.line}`
            : `this change moves ${hit.file}:${hit.line} to :${hit.movedTo}`;
      console.log(`      ${hit.origin}  says \`${hit.span}\`  ->  ${where}`);
      console.log(`             sentence: ${hit.sentence}`);
    }
    console.log(`
    ⛔ This is NOT a claim that any of those sentences is false, and ⛔ not an instruction to
    change the number. Correcting \`:246\` to \`:274\` produces a claim that is true today and
    born false again on the next insertion — objectui#9509 states that before anything else.

    BIND THE NUMBER TO THE TREE IT WAS READ FROM. \`\`\`:246\` at \`b8a006883d\`, \`:274\` at this
    head\`\` cannot re-stale, because each number names its own tree. Both pull requests that
    produced this card converged on that form independently. Or state a RULE instead of a
    coordinate — "every file in \`git diff --name-only\` against the merge base" — which is
    what objectui#9495 did with a file count that had already staled once between rounds.

    Report-only, exactly like the half above it: a moved address is usually a moved address
    and not a lie. The finding is a request to re-read, addressed to the one seat that can
    answer it without re-deriving anything.`);
  }

  // ── the self-contradiction report (objectui#9841) ──────────────────────────
  //
  // One file read against itself: a package the front matter declares, negated
  // in the body that publishes into that package's own CHANGELOG. ⛔ No ambient
  // input reaches this section — no pull request body, no `GITHUB_EVENT_PATH`.
  console.log('\n── Self-contradiction — a declared package this changeset says it did not touch ──\n');
  for (const control of selfControls) {
    console.log(`    ${control.ok ? 'PASS' : 'FAIL'}  ${control.id}: ${control.detail}`);
  }
  console.log(
    `\n    Corpus: ${self.corpus.length} changeset(s) this change adds or modifies, ` +
      `${self.declaring} of them declaring a package.`,
  );
  if (self.corpus.length === 0) {
    // ⛔ FLOOR ONE. No corpus at all. Printing a tick here would report "this
    // change publishes no self-contradicting declaration" on a run that read no
    // changeset whatsoever — the shape objectstack#4928 named, and the one
    // objectui#9744 measured sliding a level in CI.
    console.log(
      '\n    ⛔ NOT a clean verdict: this change adds and modifies NO changeset, so this run read\n' +
        '       nothing of this class and measured nothing.',
    );
  } else if (self.declaring === 0) {
    // ⛔ FLOOR TWO, one level in, and DISTINCT on purpose (objectui#9744). The
    // corpus was read but every body declares nothing, so there is no front
    // matter to read a body against. A `0` from a reader with no declarations to
    // resolve and a `0` from a clean declaration are the same character, and
    // printing one tick for both is how a reader learns to read the tick as
    // noise. Pinned by `not.toContain` on the clean sentence.
    console.log(
      '\n    ⚠️  Read, but nothing to judge: every one of those bodies declares no bump, so there\n' +
        '        is no front matter for a body to contradict. ⛔ Not the same answer as a clean one.',
    );
  } else if (self.findings.length === 0) {
    console.log(
      `\n    ✅  Every package declared across those ${self.declaring} body(ies) is either not negated\n` +
        '        in its own prose, or negated only in an ASPECT of it that may legitimately hold still.',
    );
  } else {
    console.log(
      `\n⚠️  ${self.findings.length} declaration(s) are negated by the body that publishes with them:\n`,
    );
    for (const hit of self.findings) {
      const when =
        hit.when === 'went'
          ? 'WENT FALSE — it stood when written; a later commit on this branch added the declaration'
          : hit.when === 'born'
            ? 'BORN FALSE — the revision that wrote this sentence already declared that package'
            : 'UNDATED — no revision in this range carries the sentence, so ⛔ neither verdict is claimed';
      console.log(`      ${hit.changeset}  declares \`${hit.package}\`  and says \`${hit.claim}\``);
      console.log(`             ${when}`);
      console.log(`             sentence: ${hit.sentence}`);
    }
    console.log(`
    ⛔ This is NOT a prose judgement, and ⛔ not an instruction to drop the declaration. It is
    name resolution between two halves of ONE file: the front matter says this package is
    being released, and a sentence attached to that package's own name says it did not move.
    Both halves publish, verbatim, into that package's CHANGELOG at the next release.

    NAME THE ASPECT, AND NAME WHAT DOES MOVE. That is how PR objectui#9796 repaired the
    carded instance: «No published FACE moves — and one published FILE does». An
    aspect-scoped negation about a package you do patch is correct English, it is the entire
    content of this coordinate's rejected wider reading, and this gate is silent on it.

    ⛔ A WENT FALSE verdict is ⛔ not "you wrote something untrue": the sentence was true at
    the revision that wrote it, and this branch's own later commit is what falsified it. The
    reader it misleads is the one diffing their own \`.d.ts\` after the bump.

    Report-only, exactly like the two halves above it, and for the same measured reason.`);
  }

  if (result.findings.length === 0) {
    console.log('\n✅  No pending changeset names a file this change touches.');
    if (brokenControls.length > 0) {
      console.error(
        `❌  ${brokenControls.length} control(s) FAILED — this run is ` +
          'not a reading. ⛔ Not a finding failure: the instrument failed, and a reader that ' +
          'reports zero because it broke is indistinguishable from clean prose.',
      );
      process.exit(1);
    }
    process.exit(0);
  }

  const byChangeset = new Map();
  for (const finding of result.findings) {
    const bucket = byChangeset.get(finding.changeset);
    if (bucket) bucket.push(finding);
    else byChangeset.set(finding.changeset, [finding]);
  }

  console.log(
    `\n⚠️  ${byChangeset.size} pending changeset(s) describe a file this change touches. ` +
      'Their bodies publish VERBATIM into the CHANGELOG at the next release:\n',
  );
  for (const [changeset, hits] of byChangeset) {
    console.log(`      ${changeset}`);
    for (const hit of hits) {
      console.log(
        `             names \`${hit.span}\`  ->  ${hit.file}  ` +
          `(${hit.severity === 'gone' ? '⚠️  THIS CHANGE LEAVES NO SUCH FILE' : 'edited by this change'})`,
      );
      if (hit.paragraph) console.log(`             paragraph: ${hit.paragraph}`);
    }
  }

  console.log(`
    ⛔ This is NOT a claim that any of those paragraphs is false. This gate judges name
    resolution, never meaning: it asked whether a body NAMES a file you touched, which is
    as mechanical as asking whether a changeset exists. "Is this sentence still true?" is
    the one question it will not answer, and the one you are being asked to answer.

    Read the PARAGRAPH, not the line. Both false halves of the objectui#8617 claim sat in
    one paragraph, and correcting either alone would have left it asserting the same wrong
    thing.

    If a claim did go false, CORRECT THE BODY. That is precedented on this branch's history
    — the docs(changeset) commit that corrected two present-tense claims a later pull
    request falsified, and the one that dropped the stale cardinal from the objectui#8315
    changeset — and both were prose-only, with frontmatter untouched.
    \`check-changeset-overwrite.mjs\` will REPORT that correction, because it reports every
    modification of a changeset the change did not add. That report is its own case 2,
    "correcting a declaration on purpose ... legitimate", it is report-only, and it is the
    intended shape here: one gate asks for the read, the other records the write.

    ⛔ What this gate does NOT cover, stated so nobody reads it as more:
      - A born-false claim carrying no LINE ADDRESS. The section above this one now reads
        that class (objectui#9509) over the prose this change publishes about itself, but
        only where it spells a coordinate: objectui#9495's "a grep finds that member first"
        is an ORDINAL claim, and deciding it means reading what the sentence means.
      - A claim about anything it does not spell as a file name in backticks: a symbol, a
        package, an installed dependency's version, a count. Symbol matching was measured
        and dropped — it asked for 191 paragraphs per commit, which is the release-time
        wall in a different costume.
      - A file named ambiguously (\`index.ts\`, \`package.json\`). A span that resolves to many
        tracked files names none of them, and this gate does not guess.

    Report-only, with no enforcing switch: a pending changeset naming a file you edited is
    usually still true. The finding is a request to read, addressed to the one seat that can
    answer it cheaply — the one whose diff might have falsified it.`);

  if (brokenControls.length > 0) {
    console.error(
      `❌  ${brokenControls.length} control(s) FAILED — this run is ` +
        'not a reading. ⛔ Not a finding failure: the instrument failed, and a reader that ' +
        'reports zero because it broke is indistinguishable from clean prose.',
    );
    process.exit(1);
  }
  process.exit(0);
}
