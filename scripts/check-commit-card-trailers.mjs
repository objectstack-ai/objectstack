#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check:commit-card-trailers — the PRE-PUSH refusal over what a commit message
 * may not carry. TWO finding classes, one event: a card relation, whose only
 * carrier is the pull request body; and a model identifier in the harness
 * trailer pair, which the rules declare model-free.
 *
 *   node scripts/check-commit-card-trailers.mjs --pre-push   # git hands the refs on stdin
 *   node scripts/check-commit-card-trailers.mjs --range origin/main..HEAD
 *   node scripts/check-commit-card-trailers.mjs --self-test
 *
 * ⚠️ Repo paths are named UNQUOTED in this header, for the reason the sibling
 * gate's header states at length: the dispatch-gates derivation turns a quoted
 * path literal in a gate's source into a watch hint, header prose included, so
 * a backticked path here would fabricate MATCHED leads for cards that touch
 * none of this. The only quoted paths in this file are its real inputs.
 *
 * ## Why this is a pre-push hook and not a check on the pull request
 *
 * The rule itself is older than this file and was enforced at PR time, by the
 * commit-list half of check-partof-closing-keyword. That placement was measured
 * to be a post-push detector for a pre-push mistake, and the measurement is the
 * argument for this file:
 *
 *   - Two rounds, hours apart, pushed a branch whose commit message carried the
 *     relation, read the red correctly, and ⛔ declined to amend, rebase or
 *     force-push, which is the right call and the only one available. Each paid
 *     a FULL EXTRA ROUND: a new branch, the diff re-applied, a new pull request,
 *     the old one closed as superseded.
 *   - By the time that gate spoke, the cheap repair no longer existed. It read
 *     the pull request's COMMIT LIST, so a new commit on top JOINS that list and
 *     leaves the offending message in it; nothing an author may legally do
 *     removes it.
 *
 * A push is the moment the repair stops being free, so it is the moment to
 * refuse. Everything this file judges is, BY CONSTRUCTION, unpublished: the
 * range excludes every commit reachable from a remote-tracking ref and, on a
 * re-push, everything the remote already has. So the remedy it prints —
 * reword the message — rewrites nothing anybody else has, and this gate can
 * prescribe it without contradicting the prohibition on rewriting pushed
 * history. That is the whole trade the move buys.
 *
 * ## What "a card relation" means here, and where the grammar comes from
 *
 * ⛔ NOT A NEW PARSER. The relation extractors are the half-state sweep's,
 * imported: this repository spells GitHub's closing-keyword grammar in three
 * places and holds them behaviourally equal with a parity gate, and a FOURTH
 * spelling would be a fourth thing to keep in step — the one nobody remembers
 * when the grammar next moves. The parity gate's own sweep would find it.
 *
 * They are read at `markdown: false`, which is a measured contract rather than
 * a default: a commit message is not markdown, nothing renders it, so backticks
 * and fences are ordinary characters there and a relation inside them binds
 * exactly like one in plain prose. An author who "quotes" a trailer to defuse
 * it has defused nothing.
 *
 * Three relations, because all three are the body's to declare: a closing
 * keyword acts on merge, while Part-of and Refs are read by this repo's own
 * board tooling, so a commit carrying either tells the board something its
 * author only meant to tell the pull request.
 *
 * ## The fourth shape: a bare reference in TRAILER POSITION
 *
 * The three relations above are all spelled KEYWORD plus reference. A trailer
 * block can carry the same declaration with no keyword at all — a token, a
 * colon, a bare reference — and the board tooling reads a trailer. So the last
 * paragraph of the message is judged as a block when it IS one: every line a
 * git trailer (a token, a colon, a value) or a continuation of one. Inside it,
 * any reference is a finding.
 *
 * Deliberately NOT judged: a reference in ordinary body PROSE. A commit message
 * that explains which card's discussion a decision came out of is not declaring
 * a relation, and refusing it would tax the one kind of commit prose worth
 * writing. The trailer block is where a machine reads a declaration, and that
 * is the line this draws.
 *
 * ## The three false-positive shapes this must NOT refuse
 *
 * Measured by the spec seat, three times in one day, against the hand grep this
 * file replaces — which counted BARE STEMS and therefore flagged each of them:
 *
 *     a closed ten-member enum       the stem inside ordinary prose
 *     findClosestMatches             the stem inside an identifier
 *     fixture                        the stem inside an ordinary word
 *
 * None is a card relation and all three cost a real rewrite before a commit.
 * The imported extractors bind the word AND the reference that follows it, so
 * all three are silent here — and they are pinned below as cases that must
 * stay green, because a future widening that is "obviously harmless" is exactly
 * how a gate starts taxing correct commits.
 *
 * The harness trailer pair — the session URL and the co-author line — carries
 * no reference at all and is pinned green for the same reason.
 *
 * ## The SECOND finding class: a model identifier in the trailer pair
 *
 * The rules declare the pair exactly — a session trailer carrying a session URL
 * and a co-author trailer reading `Claude` at the anthropic address — and
 * declare it model-free. That rule had no instrument at all until this class:
 * eighteen commits on five open branches carried a model-named co-author value
 * past green CI in one shift, and 「landed history is not rewritten」, so the
 * residue is permanent the moment a branch lands. Same bet as the class above,
 * then: refuse at the one moment the repair is still free.
 *
 * WHAT IS JUDGED is the trailer VALUE, and only inside the trailer block:
 *
 *   - a `Co-authored-by` value that names Claude at the anthropic address must
 *     read exactly `Claude` in front of the address; whatever else stands there
 *     is the finding, quoted back. A co-author who is NOT that identity — a
 *     human, any other address — is never this rule's business.
 *   - an id-form model name (the word claude, a hyphen, a model word) anywhere
 *     in that value, which is how a model reaches a trailer through the address
 *     instead of the display name.
 *   - the session trailer's value, cheaply: a session URL or a finding, and a
 *     session URL carries no model.
 *
 * ⛔ NOT A LIST OF MODEL NAMES. A list goes stale the day a model is renamed,
 * and the population this exists for is whatever the harness writes NEXT. The
 * shape above is the declared spelling itself, so a name nobody has seen yet
 * fails it for exactly the reason the measured four do.
 *
 * ⛔ NOT the message body. The rule this enforces is about the PAIR, so a
 * commit whose prose names a model for a legitimate reason — explaining a
 * fixture, quoting the order it is correcting — declares nothing and is
 * untouched. That is the line the bare-reference class above already draws, and
 * it is where GitHub reads co-authorship from too: trailer position only.
 *
 * The merge commits scripts/pm/os-regen-merge.sh writes carry no trailer at
 * all, so they carry no model and are CLEAN here. The rule is about the pair
 * when the pair is present, which is the disposition this class ships with.
 *
 * ## The range, and why the zero sha is not the interesting half
 *
 * git hands a pre-push hook one line per ref on stdin:
 *
 *     <local ref> <local sha> <remote ref> <remote sha>
 *
 * A deleted ref arrives with a zero LOCAL sha and is skipped: there is no
 * commit to judge. A NEW branch arrives with a zero REMOTE sha, which is git's
 * sample hook's cue to exclude what is already published rather than to judge
 * the whole history.
 *
 * This goes one step further than the sample and excludes BOTH: the remote sha
 * when the remote has one, and every remote-tracking ref in the clone. The
 * second exclusion is what keeps a branch that has merged the default branch
 * back in from reporting ANOTHER author's landed trailers as this push's —
 * the same failure mode the PR-time gate avoided by reading an endpoint instead
 * of walking a shallow clone. Since the repository's squash message is now the
 * pull request BODY, landed commits carry the relations their bodies declared,
 * so that exclusion is load-bearing rather than theoretical.
 *
 * A remote sha the clone does not have (someone else pushed since the last
 * fetch) is dropped from the exclusion rather than failing the walk, and the
 * remote-tracking exclusion still bounds it.
 *
 * ## Exit codes — and why "could not judge" refuses the push
 *
 *   0  judged, clean.
 *   1  judged, finding. The push is refused and each offending commit is named
 *      with its line.
 *   2  NOT JUDGED — no mode, or the walk could not run. A usage or wiring
 *      failure, never a statement about anybody's commits.
 *
 * Exit 2 refuses the push too, and that is the deliberate half. A verifier that
 * silently degrades reports success, which is the failure this repository keeps
 * paying for; the refusal names the deliberate override instead —
 * `OS_ALLOW_CARD_TRAILER_PUSH=1`, spelled the way this repo spells an escape
 * hatch, so that bypassing it is a visible act and not a flag anyone reaches
 * for by habit.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// The relation extractors are the sweep's, imported and not re-spelled — see
// the header. `markdown: false` is the commit surface, also the sweep's call.
import { closingKeywordTargets, partOfTargets, refsTargets } from './pm/check-half-states.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

export const EXIT_CLEAN = 0;
export const EXIT_FINDING = 1;
export const EXIT_NOT_JUDGED = 2;

/** The deliberate override, spelled as this repo spells a dangerous one. */
export const OVERRIDE_ENV = 'OS_ALLOW_CARD_TRAILER_PUSH';

/** The hook that calls this. Quoted: editing it really does implicate this gate. */
const HOOK_SOURCE = '.githooks/pre-push';

/**
 * The contract BOTH finding classes CITE — one sentence carries both halves,
 * which is why there is one constant. Quoted, not restated: the sentence is
 * written down elsewhere in this repository, that copy is the authority, and a
 * gate that paraphrased it would become a second source for one rule.
 *
 * ⛔ Nothing inside the corner brackets may be written HERE — a sentence added
 * here rather than there attributes to the ruling a claim it does not make, and
 * prints that attribution to the very population that reads the rules file. The
 * brackets are held to their source MECHANICALLY: the self-test reads the rules
 * file and requires every sentence between them to appear in it verbatim.
 *
 * The path is named in prose here rather than as a literal because it is
 * spelled once, as a literal, at AGENT_RULES_SOURCE.
 */
const TRAILER_CONTRACT =
  'The contract is written down in the agent rules at .claude/agents/os-dev.md — '
  + '「卡片关系只在 PR 正文声明一次:commit ⛔ 不带卡片 trailer,其 trailer pair 一律 model-free。」 '
  + '(The card relation is declared ONCE, in the PR body; a commit carries no card trailer, '
  + 'and its trailer pair is model-free.)';

/**
 * The file TRAILER_CONTRACT quotes — a REAL input, read by the self-test.
 *
 * Quoted as a path literal on purpose, unlike the paths in the header: editing
 * the sentence at the other end of it breaks the citation pin, so a card
 * touching that file really does want this gate run.
 */
const AGENT_RULES_SOURCE = '.claude/agents/os-dev.md';

/** Every sentence inside the corner brackets of a citation, in order. */
export function citedSentences(text) {
  const quoted = /「([^」]*)」/.exec(String(text ?? ''));
  if (quoted === null) return [];
  return quoted[1]
    .split(/(?<=。)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/**
 * Every card-relation trailer one commit message carries, in a fixed order.
 *
 * ⛔ No grammar of its own: three imported extractors, read at the commit
 * surface. A fourth spelling belongs nowhere, least of all here.
 */
export function commitRelations(message) {
  const found = [];
  for (const card of partOfTargets(message, { markdown: false })) found.push({ keyword: 'Part of', card });
  for (const card of refsTargets(message, { markdown: false }).keys()) found.push({ keyword: 'Refs', card });
  for (const [card, keyword] of closingKeywordTargets(message, { markdown: false })) found.push({ keyword, card });
  return found;
}

/** A git trailer line: a token, a colon, a value. */
const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*:[ \t]/;

/** A continuation of the trailer above it. */
const TRAILER_CONTINUATION = /^[ \t]+\S/;

/**
 * The message's trailer block — `{ from, lines }` — or null when it has none.
 *
 * The LAST paragraph, and only when every line in it is a trailer or a
 * continuation. Stricter than git's own "at least a quarter of the lines" rule,
 * deliberately: this decides whether a bare reference is a DECLARATION, and the
 * cost of reading an ordinary closing paragraph as a trailer block is a refused
 * push over prose. A message with no blank line at all has a subject and no
 * trailer block — a subject is not a trailer, whatever its shape.
 */
export function trailerBlock(message) {
  const lines = String(message ?? '').replace(/[ \t\r\n]+$/, '').split('\n');
  let from = lines.length;
  while (from > 0 && lines[from - 1].trim() !== '') from--;
  if (from === 0) return null;
  const block = lines.slice(from);
  if (block.length === 0) return null;
  if (!TRAILER_LINE.test(block[0])) return null;
  if (!block.every((line) => TRAILER_LINE.test(line) || TRAILER_CONTINUATION.test(line))) return null;
  return { from, lines: block };
}

/**
 * Bare references sitting in trailer position — `{ line, text, card }` each.
 *
 * A reference in a trailer is a declaration whether or not a keyword is beside
 * it, which is why this is judged at all; a reference in body prose is not, and
 * is deliberately untouched.
 */
export function trailerCardRefs(message) {
  const block = trailerBlock(message);
  if (block === null) return [];
  const found = [];
  block.lines.forEach((text, i) => {
    for (const m of text.matchAll(/#(\d+)\b/g)) found.push({ line: block.from + i + 1, text, card: m[1] });
  });
  return found;
}

/** The declared co-author value — the whole model-free rule, as one string. */
export const DECLARED_COAUTHOR = 'Claude <noreply@anthropic.com>';

/** The declared session value's prefix. A URL is the only legal shape here. */
export const DECLARED_SESSION_PREFIX = 'https://claude.ai/code/session_';

/** The address domain that makes a co-author trailer the harness identity. */
const HARNESS_ADDRESS = /@anthropic\.com$/i;

/** A trailer line split into its token and its value. */
const TRAILER_FIELD = /^([A-Za-z][A-Za-z0-9-]*):[ \t]+(.*)$/;

/**
 * The id form of a model name — the word claude, a hyphen, a model word.
 *
 * Deliberately not a list of models: it binds the SHAPE, so a model nobody has
 * named yet matches for the same reason the measured ones do. Read over a
 * trailer VALUE only, never a whole line: the session trailer's own TOKEN is
 * the word claude and a hyphen, and a rule read one field wider would refuse
 * the model-free pair itself.
 */
const MODEL_ID_FORM = /\bclaude-[a-z]+(?:[-.][a-z0-9]+)*\b/i;

/**
 * The trailer block's fields — `{ line, token, value, text }` each.
 *
 * A continuation line carries no token of its own and is skipped: it belongs
 * to the field above it, which is where the value is judged.
 */
export function trailerFields(message) {
  const block = trailerBlock(message);
  if (block === null) return [];
  const fields = [];
  block.lines.forEach((text, i) => {
    const parsed = TRAILER_FIELD.exec(text);
    if (parsed === null) return;
    fields.push({ line: block.from + i + 1, token: parsed[1], value: parsed[2].trim(), text });
  });
  return fields;
}

/** The address inside a trailer value, or '' when it names none. */
function trailerAddress(value) {
  const found = /<([^<>]*)>[ \t]*$/.exec(String(value ?? ''));
  return found === null ? '' : found[1].trim();
}

/** The display name standing in front of that address. */
function trailerDisplayName(value) {
  return String(value ?? '').replace(/<[^<>]*>[ \t]*$/, '').trim();
}

/**
 * What a co-author trailer value carries in place of the model-free name, or
 * null when it carries nothing — which includes every co-author who is not the
 * harness identity at all.
 *
 * Two shapes, in order: the id form anywhere in the value (an address can carry
 * a model as easily as a display name), then the display name, which must read
 * exactly the bare name and nothing more. Case is not the rule's business —
 * a differently-cased bare name carries no model — so it is compared folded.
 */
export function coauthorModelIdentifier(value) {
  const text = String(value ?? '');
  const id = MODEL_ID_FORM.exec(text);
  if (id !== null) return id[0];
  const address = trailerAddress(text);
  if (!HARNESS_ADDRESS.test(address)) return null;
  const display = trailerDisplayName(text);
  const bare = trailerDisplayName(DECLARED_COAUTHOR);
  if (display.toLowerCase() === bare.toLowerCase()) return null;
  return display === '' ? address : display;
}

/**
 * What a session trailer value carries in place of a session URL, or null.
 *
 * The cheap half of the pair: a URL has no room for a model, so asserting the
 * shape asserts the rule. The id form is read first so a value that carries a
 * model AND a URL is named by the model it carries.
 */
export function sessionTrailerProblem(value) {
  const text = String(value ?? '').trim();
  const id = MODEL_ID_FORM.exec(text);
  if (id !== null) return id[0];
  if (text.startsWith(DECLARED_SESSION_PREFIX)) return null;
  return text === '' ? '(an empty value)' : text;
}

/**
 * The trailer pair's findings — `{ line, text, why }` each, empty when clean.
 *
 * Only the two tokens the rules name are judged, by git's own case-insensitive
 * key matching; any other trailer a commit carries is nobody's business here.
 */
export function trailerPairFindings(message) {
  const found = [];
  for (const field of trailerFields(message)) {
    const token = field.token.toLowerCase();
    if (token === 'co-authored-by') {
      const carried = coauthorModelIdentifier(field.value);
      if (carried === null) continue;
      found.push({
        line: field.line,
        text: field.text.trim(),
        why: `\`${carried}\` in a co-author trailer — the pair is model-free: \`${DECLARED_COAUTHOR}\`.`,
      });
    } else if (token === 'claude-session') {
      const carried = sessionTrailerProblem(field.value);
      if (carried === null) continue;
      found.push({
        line: field.line,
        text: field.text.trim(),
        why: `\`${carried}\` in the session trailer — its value is a session URL, which carries no model.`,
      });
    }
  }
  return found;
}

/** The commit's subject, trimmed to a length that keeps a log line readable. */
export function commitSubject(message) {
  const first = String(message ?? '').split('\n', 1)[0].trim();
  return first.length > 72 ? `${first.slice(0, 69)}…` : first;
}

/** The 1-based line that first names the card, or 1 when nothing does. */
function lineNaming(message, card) {
  const lines = String(message ?? '').split('\n');
  const at = lines.findIndex((line) => new RegExp(`#${card}\\b`).test(line));
  return at < 0 ? 1 : at + 1;
}

/**
 * One commit's findings — `{ line, text, why }` each, empty when clean.
 *
 * Deduplicated per line and card: a trailer line carrying a relation is one
 * mistake and one line to edit, not two findings because two rules saw it. The
 * trailer-pair class dedupes per LINE for the same reason — that line is one
 * reword whatever else is wrong with it.
 */
export function commitFindings(message) {
  const lines = String(message ?? '').split('\n');
  const found = new Map();
  for (const { keyword, card } of commitRelations(message)) {
    const line = lineNaming(message, card);
    found.set(`${line}:${card}`, {
      line,
      text: (lines[line - 1] ?? '').trim(),
      why: `\`${keyword} #${card}\` — a card relation.`,
    });
  }
  for (const { line, text, card } of trailerCardRefs(message)) {
    const key = `${line}:${card}`;
    if (found.has(key)) continue;
    found.set(key, {
      line,
      text: text.trim(),
      why: `\`#${card}\` in a TRAILER line — a bare card reference is a declaration too.`,
    });
  }
  const claimed = new Set([...found.values()].map((finding) => finding.line));
  for (const finding of trailerPairFindings(message)) {
    if (claimed.has(finding.line)) continue;
    claimed.add(finding.line);
    found.set(`${finding.line}:pair`, finding);
  }
  return [...found.values()].sort((a, b) => a.line - b.line || a.why.localeCompare(b.why));
}

/** Every offending commit, as `{ sha, subject, findings }`. */
export function offendingCommits(commits) {
  const out = [];
  for (const commit of commits) {
    const findings = commitFindings(commit.message);
    if (findings.length === 0) continue;
    out.push({
      sha: String(commit.sha ?? '').slice(0, 9) || '(unknown sha)',
      subject: commitSubject(commit.message),
      findings,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The push
// ---------------------------------------------------------------------------

const ZERO_SHA = /^0{40,}$/;

/**
 * git's pre-push stdin, parsed — one row per ref, malformed lines dropped.
 *
 * `{ localRef, localSha, remoteRef, remoteSha }`. A row whose LOCAL sha is zero
 * is a deletion and carries no commit to judge; it is dropped here rather than
 * downstream so that a push of only deletions reaches the verdict as a push
 * with no commits, which is clean rather than unjudged.
 */
export function parsePrePushRefs(stdin) {
  const rows = [];
  for (const line of String(stdin ?? '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4) continue;
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    if (ZERO_SHA.test(localSha)) continue;
    rows.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return rows;
}

/**
 * The rev-list arguments for one pushed ref.
 *
 * The local sha, then the exclusions: the remote sha when the remote has one
 * and this clone holds it, and every remote-tracking ref — see the header on
 * why both are present and why a missing remote sha is dropped rather than
 * fatal.
 */
export function revListArgs(row, { hasObject = () => true } = {}) {
  const args = [row.localSha, '--not'];
  if (!ZERO_SHA.test(row.remoteSha) && hasObject(row.remoteSha)) args.push(row.remoteSha);
  args.push('--remotes');
  return args;
}

function objectExists(sha, cwd) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The record separator `git log -z` writes between commits.
 *
 * Built rather than typed: this repository refuses a raw control byte in any
 * tracked file (`pnpm check:nul-bytes`), and an editor asked to write the
 * escape can materialise it as the byte itself — which is how this line got
 * the gate's attention once already. `String.fromCharCode` cannot be
 * materialised into anything.
 */
const NUL = String.fromCharCode(0);

/**
 * The commits a rev-list range names, as `{ sha, message }` rows.
 *
 * NUL-terminated records: a commit message is multi-line by nature, so no
 * line-oriented separator can be trusted to bound one.
 */
export function readCommits(args, { cwd = ROOT, run = execFileSync } = {}) {
  const out = run('git', ['log', '-z', '--format=%H%n%B', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows = [];
  for (const record of String(out).split(NUL)) {
    if (record.trim() === '') continue;
    const nl = record.indexOf('\n');
    if (nl < 0) {
      rows.push({ sha: record.trim(), message: '' });
      continue;
    }
    rows.push({ sha: record.slice(0, nl).trim(), message: record.slice(nl + 1) });
  }
  return rows;
}

/**
 * Every commit this push would publish, or `{ problem }`.
 *
 * Deduplicated by sha: pushing two refs that share history must not report one
 * commit twice.
 */
export function pushedCommits(rows, { cwd = ROOT, run = execFileSync } = {}) {
  const seen = new Map();
  for (const row of rows) {
    const args = revListArgs(row, { hasObject: (sha) => objectExists(sha, cwd) });
    let commits;
    try {
      commits = readCommits(args, { cwd, run });
    } catch (err) {
      return { problem: `the commit walk for ${row.localRef} failed — ${err?.message ?? err}` };
    }
    for (const commit of commits) if (!seen.has(commit.sha)) seen.set(commit.sha, commit);
  }
  return { commits: [...seen.values()] };
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/** `{ exit, lines }`, pure, so the self-test drives it directly. */
export function judge({ commits, problem, where = 'this push' }) {
  if (problem) {
    return {
      exit: EXIT_NOT_JUDGED,
      lines: [
        `✗ check:commit-card-trailers: NOT JUDGED — ${problem}`,
        '',
        "  This is a wiring or usage failure, NOT a verdict about anybody's commits: nothing was read,",
        '  so nothing can be said to be clean. The push is refused rather than waved through, because a',
        '  check that cannot read its input and exits 0 reports success it never measured.',
        '',
        `  Deliberate override, if you know why this cannot run:  ${OVERRIDE_ENV}=1 git push …`,
      ],
    };
  }

  const offenders = offendingCommits(commits);
  if (offenders.length === 0) {
    return {
      exit: EXIT_CLEAN,
      lines: [
        `✓ check:commit-card-trailers: ${commits.length} commit message(s) on ${where} carry no card relation`
          + ' and no model identifier in the trailer pair.',
      ],
    };
  }

  const lines = [
    `✗ check:commit-card-trailers: ${offenders.length} commit message(s) on ${where} carry a card relation`,
    '  or a model identifier in the trailer pair. The PR body is the only carrier of the relation, and',
    '  the pair names Claude and no model.',
    '',
  ];
  for (const commit of offenders) {
    lines.push(`  commit ${commit.sha} ("${commit.subject}")`);
    for (const finding of commit.findings) {
      lines.push(`    line ${finding.line}: ${finding.text}`);
      lines.push(`             ${finding.why}`);
    }
    lines.push('');
  }
  lines.push(
    `  ${TRAILER_CONTRACT}`,
    '',
    '  REMEDY — and it is the cheap one, which is the whole reason this refusal happens HERE. Every',
    '  commit above is UNPUBLISHED: this check judges only what the remote does not already have, so',
    '  rewording these messages rewrites nothing anybody else has and needs no force-push.',
    '',
    '    the tip commit only    git commit --amend        (then push)',
    '    an older one           git reset --soft <the commit before it>, then commit again with the',
    '                           finding removed from the message',
    '',
    '  A card relation is stated ONCE, in the pull request body, where the contract puts it — and where,',
    '  since the squash message is taken from the body, it is also what lands on the default branch.',
    `  A model identifier is removed by rewording the trailer to the model-free pair: \`${DECLARED_COAUTHOR}\``,
    `  beside a session trailer whose value is a ${DECLARED_SESSION_PREFIX}… URL.`,
    '',
    '  ⛔ Do NOT reach for the override to get past this. Once these commits are pushed the repair above',
    '  is gone: the only thing that would remove the message from a published branch is the history',
    '  rewrite this repository forbids, and two rounds have already paid a full redo for exactly that.',
    `  The override exists for a push whose history is not yours to reword:  ${OVERRIDE_ENV}=1 git push …`,
  );
  return { exit: EXIT_FINDING, lines };
}

// ---------------------------------------------------------------------------
// Self-test — the rule, the range arithmetic, the verdict layer and the wiring.
// ---------------------------------------------------------------------------

const SELF_TEST_BATTERIES = Object.freeze({
  'Every card-relation spelling in a commit message is a finding, including': 12,
  'The shapes that must stay green, so the gate does not tax ordinary commit': 8,
  'A bare reference in TRAILER position is a declaration; one in prose is not.': 7,
  'The trailer pair is model-free: every measured spelling is a finding, and': 15,
  '…and the shapes it must NOT refuse, so the pair stays cheap to write.': 10,
  'The finding names the commit AND the line, which is what a pusher acts on.': 6,
  'Delegation, not a second copy of the rule: the commit surface is the': 4,
  'The push arithmetic: which refs are judged, and what the range excludes.': 8,
  'The verdict layer: clean, finding, and a walk that could not run.': 6,
  'The wiring: the hook still calls this, and the cited contract is still': 5,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 10;

const UNATTRIBUTED_BATTERY = '(no battery open)';

/** Cases registered per battery: `battery()` opens one, `registerCase()` files into it. */
const batteryCases = new Map();
let openBattery = null;

function battery(name) {
  openBattery = name;
}

function registerCase() {
  const name = openBattery ?? UNATTRIBUTED_BATTERY;
  batteryCases.set(name, (batteryCases.get(name) ?? 0) + 1);
}

/** The floor: every declared battery RAN, and ran its cases. */
function batteryFloorFailures() {
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const problems = [];
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    problems.push(
      `SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batteryCases) {
    if (declared.includes(name)) continue;
    problems.push(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declared) {
    const count = batteryCases.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    problems.push(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (problems.length) {
    problems.push(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  return problems;
}

const SELF_TEST_VERDICT = 'check-commit-card-trailers self-test reached its verdict';

function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => {
    registerCase();
    return cases.push([name, actual, expected]);
  };
  const verdict = (...messages) =>
    judge({ commits: messages.map((message, i) => ({ sha: `${i}0deadbeef1234567`, message })), problem: null });

  battery('Every card-relation spelling in a commit message is a finding, including');
  for (const spelling of ['Fixes', 'Closes', 'Resolves', 'Part of', 'Refs']) {
    t(
      `a commit message carrying "${spelling}" bound to a card is a finding`,
      verdict(`fix(x): a subject\n\n${spelling} #4242\n`).exit,
      EXIT_FINDING,
    );
  }
  // The measured gap: every spelling the dispatch orders forbid. The hyphen and
  // the colon forms were invisible to this grammar until the extractors were
  // widened, so a dev who greppped for them got 0 from a net with no thread in
  // that square.
  for (const spelling of ['Part-of #4242', 'Part of: #4242', 'Part-of: #4242', 'Refs: #4242', 'Fixes: #4242']) {
    t(`"${spelling}" is a finding too`, verdict(`fix(x): a subject\n\n${spelling}\n`).exit, EXIT_FINDING);
  }
  t(
    'a lower-case spelling binds as well — the extractors are case-insensitive',
    verdict('fix(x): a subject\n\npart-of: #4242\n').exit,
    EXIT_FINDING,
  );
  t(
    'a relation in the SUBJECT is a finding, not only one in the trailer block',
    verdict('fix(x): a subject that resolves #4242 on its own\n').exit,
    EXIT_FINDING,
  );

  battery('The shapes that must stay green, so the gate does not tax ordinary commit');
  t(
    'an ordinary commit message with no card relation is clean',
    verdict('fix(cli): stop counting the walk instead of the tree\n\nBody prose about the change.\n').exit,
    EXIT_CLEAN,
  );
  // The three substring shapes measured against the hand grep this replaces.
  t(
    'the stem inside ordinary prose is not a relation (a ten-member enum, closed)',
    verdict('refactor(spec): read the enum as a closed ten-member set\n').exit,
    EXIT_CLEAN,
  );
  t(
    'the stem inside an identifier is not a relation (findClosestMatches)',
    verdict('perf(cli): hoist findClosestMatches out of the loop\n').exit,
    EXIT_CLEAN,
  );
  t(
    'the stem inside an ordinary word is not a relation (fixture)',
    verdict('test(rest): add a fixture for the empty page\n').exit,
    EXIT_CLEAN,
  );
  t(
    'the harness trailer pair carries no reference and stays clean',
    verdict(
      'fix(x): a subject\n\nClaude-Session: https://claude.ai/code/session_0\n'
        + 'Co-authored-by: Claude <nobody@example.invalid>\n',
    ).exit,
    EXIT_CLEAN,
  );
  t(
    'the squash subject marker is not a card relation (the paren stands between)',
    verdict('fix(cli): report key counts off the emitted bytes (#16247)\n').exit,
    EXIT_CLEAN,
  );
  t(
    'a keyword with no reference beside it binds nothing',
    verdict('docs: explain why closing the card by hand would drop the severe half\n').exit,
    EXIT_CLEAN,
  );
  t('an empty push is clean rather than unjudged', judge({ commits: [], problem: null }).exit, EXIT_CLEAN);

  battery('A bare reference in TRAILER position is a declaration; one in prose is not.');
  t('a bare reference on a trailer line is a finding', verdict('fix(x): a subject\n\nIssue: #4242\n').exit, EXIT_FINDING);
  t(
    'the same reference in body prose is NOT a finding',
    verdict('fix(x): a subject\n\nThe decision this came out of is #4242, which stays open.\n').exit,
    EXIT_CLEAN,
  );
  t(
    'a last paragraph that is prose is not a trailer block, however it ends',
    trailerBlock('fix(x): a subject\n\nSo the remedy landed: see #4242 for the rest.\n'),
    null,
  );
  t(
    'a trailer block is only one when EVERY line in it is a trailer',
    trailerBlock('fix(x): a subject\n\nCo-authored-by: A <a@example.invalid>\nand a trailing prose line\n'),
    null,
  );
  t('a subject-only message has no trailer block at all', trailerBlock('fix(x): a subject'), null);
  t('a continuation line stays inside the block', trailerBlock('s\n\nToken: value\n  continued\n')?.lines.length, 2);
  t('the trailer reference is reported at its own line number', trailerCardRefs('s\n\nbody\n\nIssue: #4242\n')[0]?.line, 5);

  battery('The trailer pair is model-free: every measured spelling is a finding, and');
  // The four display-name spellings measured on this board, each as the harness
  // wrote it. They are fixtures, not a vocabulary — the rule below them binds a
  // shape, and the ninth case proves it on a model nobody has shipped.
  const pairWith = (coauthor, session = `${DECLARED_SESSION_PREFIX}01EXAMPLE`) =>
    `fix(x): a subject\n\nbody prose\n\nClaude-Session: ${session}\nCo-authored-by: ${coauthor}\n`;
  for (const name of ['Claude Opus 5', 'Claude Fable 5.1', 'Claude Sonnet 5', 'Claude Haiku 4.5']) {
    t(
      `the measured display-name spelling "${name}" is a finding`,
      verdict(pairWith(`${name} <noreply@anthropic.com>`)).exit,
      EXIT_FINDING,
    );
  }
  for (const id of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-haiku-4-5']) {
    t(
      `the id form "${id}" is a finding wherever in the value it sits`,
      verdict(pairWith(`Claude <${id}@anthropic.com>`)).exit,
      EXIT_FINDING,
    );
  }
  t(
    'a model word nobody has shipped binds too — the rule is the declared spelling, not a list',
    verdict(pairWith('Claude Quartz 9 <noreply@anthropic.com>')).exit,
    EXIT_FINDING,
  );
  t(
    "the qualified harness form binds as well (the display name is still not the declared one)",
    verdict(pairWith('Claude Opus 5 (1M context) <noreply@anthropic.com>')).exit,
    EXIT_FINDING,
  );
  t(
    "git's trailer keys are case-insensitive, so the other capitalisation binds",
    verdict(`fix(x): a subject\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n`).exit,
    EXIT_FINDING,
  );
  t(
    'a session trailer whose value is not a session URL is a finding',
    verdict(pairWith(DECLARED_COAUTHOR, 'Claude Opus 5, this round')).exit,
    EXIT_FINDING,
  );
  const modelNamed = verdict(pairWith('Claude Opus 5 <noreply@anthropic.com>')).lines.join('\n');
  t('the finding quotes the offending trailer line back', modelNamed.includes('Co-authored-by: Claude Opus 5'), true);
  t('the finding names its line number', modelNamed.includes('line 6'), true);
  t('the remedy names the model-free pair verbatim', modelNamed.includes(DECLARED_COAUTHOR), true);

  battery('…and the shapes it must NOT refuse, so the pair stays cheap to write.');
  t(
    'the declared model-free pair is clean',
    verdict(pairWith(DECLARED_COAUTHOR)).exit,
    EXIT_CLEAN,
  );
  t(
    'a differently-cased bare name carries no model and stays clean',
    verdict(pairWith('claude <noreply@anthropic.com>')).exit,
    EXIT_CLEAN,
  );
  t(
    'the merge commit os-regen-merge writes carries no trailer at all and is clean',
    verdict("Merge remote-tracking branch 'origin/main' into claude/issue-1-x\n").exit,
    EXIT_CLEAN,
  );
  t(
    'a human co-author at their own address is never this rule’s business',
    verdict(`fix(x): a subject\n\nCo-authored-by: A Maintainer <maintainer@example.invalid>\n`).exit,
    EXIT_CLEAN,
  );
  t(
    'body PROSE naming a model — explaining a fixture — is not a declaration and stays clean',
    verdict(
      'test(scripts): pin the Claude Opus 5 spelling as a fixture\n\n'
        + 'The fixture reads Claude Opus 5 because that is what the harness wrote.\n\n'
        + `Claude-Session: ${DECLARED_SESSION_PREFIX}01EXAMPLE\nCo-authored-by: ${DECLARED_COAUTHOR}\n`,
    ).exit,
    EXIT_CLEAN,
  );
  t(
    'a model name in the SUBJECT is prose too — the rule is about the pair',
    verdict('docs(agents): say the pair carries Claude Opus 5 nowhere\n').exit,
    EXIT_CLEAN,
  );
  t(
    "the three substring false positives stay clean under the second class too",
    [
      'refactor(spec): read the enum as a closed ten-member set\n',
      'perf(cli): hoist findClosestMatches out of the loop\n',
      'test(rest): add a fixture for the empty page\n',
    ].every((message) => verdict(message).exit === EXIT_CLEAN),
    true,
  );
  t(
    'the session trailer TOKEN is not read as an id form (it would refuse the model-free pair)',
    coauthorModelIdentifier(DECLARED_COAUTHOR),
    null,
  );
  t(
    'a trailer pair sitting in a paragraph that is not a trailer block is out of scope',
    verdict('fix(x): a subject\n\nCo-authored-by: Claude Opus 5 <noreply@anthropic.com>\nand a prose line\n').exit,
    EXIT_CLEAN,
  );
  t(
    'one line carrying BOTH a card relation and a model is ONE finding — one line to reword',
    commitFindings(`fix(x): a subject\n\nCo-authored-by: Claude Opus 5 <noreply@anthropic.com> #4242\n`).length,
    1,
  );

  battery('The finding names the commit AND the line, which is what a pusher acts on.');
  const named = verdict('fix(x): the subject that must be quoted back\n\nsome body\n\nPart-of: #4242\n').lines.join('\n');
  t('the finding names the offending commit by short sha', named.includes('00deadbee'), true);
  t('the finding quotes the commit subject back', named.includes('the subject that must be quoted back'), true);
  t('the finding names the line number', named.includes('line 5'), true);
  t('the finding quotes the offending line', named.includes('Part-of: #4242'), true);
  t('the finding CITES the contract rather than restating it', named.includes(TRAILER_CONTRACT), true);
  t(
    'the remedy is the cheap one and says why it is available here',
    named.includes('UNPUBLISHED') && named.includes('git commit --amend') && named.includes('needs no force-push'),
    true,
  );

  battery('Delegation, not a second copy of the rule: the commit surface is the');
  t(
    'a relation inside backticks is still a finding (a commit is not markdown)',
    verdict('fix(x): a subject\n\n`Fixes #4242`\n').exit,
    EXIT_FINDING,
  );
  t(
    'a relation inside a fenced block is still a finding',
    verdict('fix(x): a subject\n\n```\nFixes #4242\n```\n').exit,
    EXIT_FINDING,
  );
  t(
    "the relations found are exactly the sweep extractors' union over the message",
    commitRelations('Part of #1 and Refs #2 and Fixes #3').map((r) => `${r.keyword} #${r.card}`),
    ['Part of #1', 'Refs #2', 'Fixes #3'],
  );
  t(
    'the verdict is exactly the extractors over every fixture (no forked rule)',
    ['Fixes #1', 'nothing here', 'Part-of: #2', 'a fixture and a closed enum'].every(
      (message) => (verdict(message).exit === EXIT_FINDING) === (commitRelations(message).length > 0),
    ),
    true,
  );

  battery('The push arithmetic: which refs are judged, and what the range excludes.');
  const STDIN = [
    'refs/heads/a 1111111111111111111111111111111111111111 refs/heads/a 2222222222222222222222222222222222222222',
    'refs/heads/new 3333333333333333333333333333333333333333 refs/heads/new 0000000000000000000000000000000000000000',
    'refs/heads/gone 0000000000000000000000000000000000000000 refs/heads/gone 4444444444444444444444444444444444444444',
    '',
  ].join('\n');
  const refs = parsePrePushRefs(STDIN);
  t('a deleted ref carries no commits to judge and is dropped', refs.length, 2);
  t('the surviving rows keep their local shas in order', refs.map((r) => r.localSha[0]).join(''), '13');
  t('a malformed line is dropped rather than judged', parsePrePushRefs('not four fields\n').length, 0);
  t('empty stdin yields no rows', parsePrePushRefs('').length, 0);
  t(
    'an existing remote tip is excluded by sha AND by the remote-tracking refs',
    revListArgs(refs[0]).join(' '),
    '1111111111111111111111111111111111111111 --not 2222222222222222222222222222222222222222 --remotes',
  );
  t(
    'a new branch excludes the remote-tracking refs only (the zero sha is not a commit)',
    revListArgs(refs[1]).join(' '),
    '3333333333333333333333333333333333333333 --not --remotes',
  );
  t(
    'a remote sha this clone does not have is dropped, never fatal',
    revListArgs(refs[0], { hasObject: () => false }).join(' '),
    '1111111111111111111111111111111111111111 --not --remotes',
  );
  t(
    'the walk reads NUL-terminated records, so a multi-line message stays one commit',
    readCommits([], { run: () => ['abc\nfix(x): s\n\nbody\n', 'def\nfix(y): t\n'].join(NUL) }).map((c) => c.sha).join(','),
    'abc,def',
  );

  battery('The verdict layer: clean, finding, and a walk that could not run.');
  const clean = judge({ commits: [{ sha: 'a1b2c3d4e5', message: 'chore: a clean subject\n' }], problem: null });
  t('a clean push says how many messages it read', clean.lines.join('\n').includes('1 commit message(s)'), true);
  t('a clean push exits clean', clean.exit, EXIT_CLEAN);
  const broken = judge({ commits: null, problem: 'the commit walk for refs/heads/x failed — boom' });
  t('a walk that could not run is NOT JUDGED', broken.exit, EXIT_NOT_JUDGED);
  t('…and does not read as a clean push', broken.lines.join('\n').includes('✓'), false);
  t("…and says it is not a verdict about anybody's commits", broken.lines.join('\n').includes('NOT a verdict'), true);
  t('…and names the deliberate override', broken.lines.join('\n').includes(OVERRIDE_ENV), true);

  battery('The wiring: the hook still calls this, and the cited contract is still');
  const hook = readFileSync(join(ROOT, HOOK_SOURCE), 'utf8');
  t('the pre-push hook calls this script', hook.includes('check-commit-card-trailers.mjs'), true);
  t('the hook hands it the ref lines git wrote on stdin', hook.includes('--pre-push'), true);
  t(
    'the hook still runs the os-regen deferral check it carried before',
    hook.includes('check-regen-pending.mjs'),
    true,
  );
  const agentRules = readFileSync(join(ROOT, AGENT_RULES_SOURCE), 'utf8');
  const cited = citedSentences(TRAILER_CONTRACT);
  t('the citation carries quoted sentences at all (never a vacuous zero)', cited.length > 0, true);
  t(
    'every sentence inside the corner brackets is verbatim in the cited rules file',
    cited.filter((sentence) => !agentRules.includes(sentence)),
    [],
  );

  // The floor runs BEFORE the verdict below, so a success line can only be
  // printed by a run in which every declared battery registered its cases.
  for (const message of batteryFloorFailures()) cases.push([message, false, true]);

  let failedCount = 0;
  for (const [name, actual, expected] of cases) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failedCount++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  }
  if (failedCount) {
    console.error(`✗ check-commit-card-trailers self-test: ${failedCount} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ check-commit-card-trailers self-test: ${cases.length} cases pass.`);

  return SELF_TEST_VERDICT;
}

// ---------------------------------------------------------------------------

/** The mode dispatch, pure in its inputs so the entry point stays thin. */
export function run(argv, env, stdin) {
  if (env[OVERRIDE_ENV]) {
    return {
      exit: EXIT_CLEAN,
      lines: [`⚠️ check:commit-card-trailers: SKIPPED — ${OVERRIDE_ENV} is set. Nothing was judged.`],
    };
  }
  const rangeAt = argv.indexOf('--range');
  if (rangeAt >= 0) {
    const range = argv[rangeAt + 1];
    if (!range) return judge({ commits: null, problem: '`--range` was given no revision range.' });
    let commits;
    try {
      commits = readCommits([range]);
    } catch (err) {
      return judge({ commits: null, problem: `the commit walk for ${range} failed — ${err?.message ?? err}` });
    }
    return judge({ commits, problem: null, where: range });
  }
  if (!argv.includes('--pre-push')) {
    return judge({ commits: null, problem: 'no mode given — expected --pre-push, --range <range> or --self-test.' });
  }
  const rows = parsePrePushRefs(stdin);
  if (rows.length === 0) return judge({ commits: [], problem: null });
  const walked = pushedCommits(rows);
  return judge({ commits: walked.commits ?? null, problem: walked.problem ?? null });
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ check-commit-card-trailers self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test that never\n'
          + 'finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    let stdin = '';
    if (process.argv.includes('--pre-push')) {
      try {
        stdin = readFileSync(0, 'utf8');
      } catch {
        stdin = '';
      }
    }
    const result = run(process.argv.slice(2), process.env, stdin);
    const emit = result.exit === EXIT_CLEAN ? console.log : console.error;
    for (const line of result.lines) emit(line);
    process.exit(result.exit);
  }
}
