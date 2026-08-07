#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-adr-0087-registration -- a PR that DECLARES a breaking change must state,
// in writing, what it did about the ADR-0087 migration ledger (#6148).
//
//   node scripts/check-adr-0087-registration.mjs --base <ref-or-sha> [--head <ref>]
//   node scripts/check-adr-0087-registration.mjs              # base defaults to origin/main
//   node scripts/check-adr-0087-registration.mjs --self-test   # verify the checker itself
//   node scripts/check-adr-0087-registration.mjs --list        # audit the whole .changeset stock
//
// `--base` names the BRANCH POINT, not the first commit of the diff: the scan
// always starts at `merge-base(<base>, <head>)`, for the #6129 reason its sibling
// `check-empty-changeset.mjs` documents at length. Fed a frozen `base.sha`, this
// gate would judge an author against changesets main gained while their PR was open.
//
// ## The hole this closes (#6148)
//
// The ADR-0087 ledger (`packages/spec/src/migrations/registry.ts`) had two gates:
// `check:spec-changes` (vs `packages/spec/spec-changes.json`) and
// `check:upgrade-guide` (vs `docs/protocol-upgrade-guide.md`). Both pin ledger
// <-> ARTIFACT SYNCHRONY: change the registry without regenerating and they fail.
//
// NEITHER pins that a retirement which actually happened has a ledger entry at
// all. The artifacts are a pure PROJECTION of the registry, so when an entry was
// never written the registry and its artifacts are perfectly consistent -- every
// gate green, repo-wide. The gate family is structurally blind to OMISSION.
//
// Measured instance: PR #6048 removed the `roles` alias on `ActorUser`
// (`ctx.user.roles` / `req.user.roles`). The ledger got nothing, while three other
// faces of the same ADR-0090 rename WERE registered. CI was green throughout. It
// was caught by a human triage seat comparing by eye (#6011) and backfilled by a
// separate dispatch round (PR #6138). The only detector that has ever fired on
// this class is a person.
//
// Why it matters, precisely: the consequence is not a runtime error but a SILENT
// GAP ON THE UPGRADE PATH. Ledger entries are the sole data source for
// `objectstack migrate meta`, `spec-changes.json` and the generated upgrade guide.
// For a surface with no spec schema at all -- `ctx.user` is only a runtime TS
// interface -- there is no `retiredKey()` tombstone and no schema rejection
// either, so the ledger entry is the ONLY notification channel that exists.
//
// ## What this gate does NOT do, deliberately
//
// It does not detect retirements. "What counts as a retirement that must be
// registered" is undecidable in the case that actually happened -- the removal
// was in `packages/runtime` while the ledger lives in `packages/spec` -- and a
// cross-package retirement detector is exactly the thing the maintainer's ruling
// (2026-08-07, on #6148) routes AROUND rather than through.
//
// The ruling: drive the gate off the changeset's own breaking/major declaration,
// cross-checked against ledger entries. That sidesteps the hard problem because
// THE AUTHOR HAS ALREADY DECLARED "this is breaking". Nothing has to be inferred;
// the gate only notices that a declared-breaking change arrived saying NOTHING
// about the ledger. Silence is the single thing it forbids.
//
// ## The rule
//
// A changeset this PR newly ADDS (or newly turns breaking) that declares a
// breaking change must carry exactly one ADR-0087 disposition marker:
//
//   <!-- adr-0087: registered <id>[, <id>...] -->
//   <!-- adr-0087: not-required (unpublished) <why> -->
//   <!-- adr-0087: not-required (already-registered <id>[, <id>...]) <why> -->
//   <!-- adr-0087: not-required (no-migration-prescription) <why> -->
//
// An HTML comment rather than a visible line, for one reason: a changeset body is
// copied VERBATIM into CHANGELOG.md and shipped to end users. The marker is for
// this repo's authors and reviewers, and it stays fully visible where they read --
// the PR diff, `git grep`, this gate's log, and `--list` -- while rendering as
// nothing in a published changelog. It is not hidden from anyone who reviews.
//
// ## Why the escape hatch is the MAJORITY path, and why that is fine (measured)
//
// Measured over the last 400 first-parent commits on main: 32 newly-added
// changesets declared breaking, and only 5 of them (15.6%) touched an ADR-0087
// registry. Corroborated independently from stock: the v17 train carries 213
// breaking changesets against 29 step-17 semantic entries -- about 1 in 7.
//
// So `not-required` is not an exception here, it is the common answer, and this
// gate is designed for that rather than against it. Its value is NOT precision
// about which change needs an entry; it is that the QUESTION IS ANSWERED IN
// WRITING on every breaking change. #6048 did not answer it -- it said nothing at
// all, and nothing asked. Note the burden is small in absolute terms: ~32
// dispositions per 400 PRs, of which ~27 are one `not-required` line.
//
// ## What keeps `not-required` honest -- re-validated on EVERY run
//
// A bare allow-list nobody re-checks is the failure mode to avoid, so three of the
// four dispositions are checked against facts rather than taken on trust, and the
// fourth is checked against the changeset's own prose:
//
//   registered            -- every id must resolve in the ADR-0087 registries at
//                            HEAD, AND at least one must be NEW in this diff. A
//                            PR cannot claim a registration it did not make.
//   unpublished           -- every package the changeset bumps must be
//                            `private: true` in its workspace manifest. Fully
//                            mechanical; a published package fails it outright.
//   already-registered    -- every named id must resolve at HEAD *and* already
//                            exist at the merge base. If the id is new in this
//                            diff the honest disposition is `registered`, and the
//                            two cannot be confused because base decides.
//   no-migration-prescription
//                         -- REFUSED when the changeset's own body carries a
//                            FROM -> TO migration prescription. A changeset that
//                            ships instructions for rewriting a consumer's code
//                            cannot also claim no consumer has to rewrite
//                            anything: that is a self-contradiction, checked
//                            statement-against-statement, not a retirement
//                            detector.
//
// That last check is the one that reaches #6048: its changeset carries a
// `### 迁移:FROM → TO` section with a worked before/after block, so the catch-all
// exemption is closed to it and the author must either register or name a
// mechanically-verified category. Measured on the same 400 commits: 11 of the 32
// breaking changesets carry such a prescription, and it covers 4 of the 5 that did
// register -- a genuine forcing function, not a blanket demand.
//
// ## Absence is never a pass (#4690)
//
// A gate that cannot find its input and exits 0 is worse than no gate. Every input
// is asserted non-empty before any verdict, and two of the assertions exist purely
// to catch this gate rotting into a green no-op:
//
//   * PARSER ROT -- every `migrationId` in the generated `spec-changes.json` must
//     be found by the source parser. If the registry is ever refactored to a
//     declaration shape the regex stops matching, the id set silently shrinks and
//     every `registered` claim would start failing; this catches it as parser drift
//     instead. The direction is deliberate (projection is a SUBSET of source): a
//     new entry not yet regenerated is `check:spec-changes`'s red, not this one's,
//     so the two gates never double-report the same fact.
//   * CONVENTION ROT -- at least one changeset in the current stock must match the
//     breaking detector. If `**BREAKING**` / `major` / `feat!:` are ever reworded
//     wholesale, this gate would match nothing and pass everything in silence.
//
// Zero third-party dependencies, so it can run in a minimal CI environment before
// `pnpm install` -- the same constraint its neighbours in the Check Changeset job
// carry.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/** The ADR-0087 ledger sources. Order matters only for reporting. */
export const LEDGER_SOURCES = [
  'packages/spec/src/migrations/registry.ts',
  'packages/spec/src/conversions/registry.ts',
];

/** The generated projection used to prove the source parser still matches (#4690). */
const SPEC_CHANGES = 'packages/spec/spec-changes.json';

/** Package roots holding workspace manifests, for the `unpublished` precondition. */
const PACKAGE_ROOTS = ['packages', 'apps', 'examples'];

/** The closed disposition vocabulary. Adding a category is a deliberate act. */
export const CATEGORIES = ['unpublished', 'already-registered', 'no-migration-prescription'];

// ---------------------------------------------------------------------------
// Changeset reading
// ---------------------------------------------------------------------------

/** `.changeset/README.md` is documentation, never a changeset. */
const isChangesetFile = (p) => p.startsWith('.changeset/') && p.endsWith('.md') && !p.endsWith('/README.md');

/**
 * Split a changeset into its frontmatter bump entries and its body.
 *
 * The entry regex is deliberately the SAME shape `check-changeset-no-major.mjs`
 * and `check-empty-changeset.mjs` use. Three gates reading one block must agree on
 * what counts as a declaration, or one of them is judging a different file than it
 * appears to.
 *
 * @param {string} text
 * @returns {{ fenced: boolean, bumps: {pkg: string, bump: string}[], body: string }}
 */
export function parseChangeset(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++; // tolerate leading blank lines
  if (lines[i]?.trim() !== '---') return { fenced: false, bumps: [], body: text };

  const bumps = [];
  let end = -1;
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '---') { end = j; break; }
    const m = /^\s*["']?([^"':]+)["']?\s*:\s*([A-Za-z]+)\s*$/.exec(lines[j]);
    if (m) bumps.push({ pkg: m[1].trim(), bump: m[2].trim().toLowerCase() });
  }
  if (end < 0) return { fenced: false, bumps: [], body: text };
  return { fenced: true, bumps, body: lines.slice(end + 1).join('\n') };
}

/**
 * Does this changeset DECLARE a breaking change?
 *
 * Three spellings are in live use in this repo and all three count, because the
 * gate's subject is the author's own declaration and an author who used any of
 * them has declared it:
 *
 *   1. a `major` bump in the frontmatter                (118 of 1304 in stock)
 *   2. a `**BREAKING` marker in the body                 (52)
 *   3. a conventional-commit `!` in the summary line     (175)
 *
 * The union is 213. Narrowing to any one of them would drop real declarations:
 * #6048's changeset used (1) and (2) and NOT (3), while the launch-window guard
 * `check-changeset-no-major.mjs` pushes breaking changes to `minor` outside
 * pre-mode, which would leave (2)/(3) carrying the signal alone.
 *
 * @param {ReturnType<typeof parseChangeset>} parsed
 * @returns {{ breaking: boolean, signals: string[] }}
 */
export function breakingDeclaration(parsed) {
  const signals = [];
  if (parsed.bumps.some((b) => b.bump === 'major')) signals.push('major');
  if (/\*\*BREAKING/i.test(parsed.body) || /^\s*BREAKING[ -]CHANGE/mi.test(parsed.body)) signals.push('BREAKING');
  const summary = (parsed.body.trim().split(/\n/)[0] || '').replace(/^\*\*|^#+\s*/, '');
  if (/^[a-z]+(\([^)]*\))?!:/.test(summary)) signals.push('bang');
  return { breaking: signals.length > 0, signals };
}

/**
 * Does the changeset carry a FROM -> TO migration prescription?
 *
 * Case-SENSITIVE and anchored on this repo's house spellings only. An earlier,
 * case-insensitive draft matched ordinary prose ("from the old value to the new")
 * and fired on 14 of 32 breaking changesets instead of 11; the uppercase
 * convention is what authors actually use for a prescription, so the pattern reads
 * that and nothing else.
 *
 * This is a CONTRADICTION check on one exemption, never a trigger and never a
 * retirement detector: a changeset that ships instructions for rewriting a
 * consumer's code cannot simultaneously claim no consumer must rewrite anything.
 *
 * @param {string} body
 */
export function hasMigrationPrescription(body) {
  return /(?:^|[^A-Za-z])FROM(?:\s|\*|`|\)|:)[^\n]{0,60}?(?:→|->|—>)[^\n]{0,60}?TO(?![A-Za-z])|^\s*\|?\s*\**FROM\**\s*(?:\(|\|)|^\s*\/\/\s*FROM\b|迁移[^\n]{0,12}FROM\s*(?:→|->)\s*TO/m.test(body);
}

/**
 * The ADR-0087 disposition marker, or a structured miss.
 *
 * Returns `{ ok: false, reason }` rather than a silent null so "no marker" and
 * "a marker nobody can parse" are reportable as different facts.
 *
 * @param {string} body
 */
export function readDisposition(body) {
  const all = [...body.matchAll(/<!--\s*adr-0087\s*:\s*([\s\S]*?)-->/g)].map((m) => m[1].trim());
  if (all.length === 0) return { ok: false, reason: 'no `adr-0087:` disposition marker' };
  if (all.length > 1) {
    return { ok: false, reason: `${all.length} \`adr-0087:\` markers -- exactly one disposition is expected` };
  }
  const raw = all[0].replace(/\s+/g, ' ').trim();

  const reg = /^registered\s+(.+)$/i.exec(raw);
  if (reg) {
    const ids = reg[1].split(/[,\s]+/).map((s) => s.replace(/^[`'"]|[`'"]$/g, '')).filter(Boolean);
    if (ids.length === 0) return { ok: false, reason: '`registered` names no migration id' };
    return { ok: true, verdict: 'registered', ids, raw };
  }

  const nr = /^not-required\s*\(\s*([a-z-]+)\s*([^)]*)\)\s*(.*)$/i.exec(raw);
  if (nr) {
    const category = nr[1].toLowerCase();
    const ids = nr[2].split(/[,\s]+/).map((s) => s.replace(/^[`'"]|[`'"]$/g, '')).filter(Boolean);
    return { ok: true, verdict: 'not-required', category, ids, why: nr[3].trim(), raw };
  }

  return {
    ok: false,
    reason: `unparseable disposition: "${raw}" -- expected \`registered ...\` or \`not-required (...) ...\``,
  };
}

// ---------------------------------------------------------------------------
// Ledger id extraction
// ---------------------------------------------------------------------------

/**
 * Every migration / conversion id declared in an ADR-0087 registry source.
 *
 * The id character class is `[A-Za-z][A-Za-z0-9._-]*` and the leading capital
 * matters: `object-titleFormat-to-nameField` is a real live id, and a lowercase-only
 * class silently dropped it while extracting a plausible-looking 38 of 39. The
 * `spec-changes.json` cross-check in `assertInputs` exists so a future narrowing of
 * this pattern is caught rather than absorbed.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function extractIds(source) {
  return [...source.matchAll(/^\s*id:\s*['"`]([A-Za-z][A-Za-z0-9._-]*)['"`]\s*,?\s*$/gm)].map((m) => m[1]);
}

/** Every `migrationId` the generated projection carries. */
export function projectedMigrationIds(specChangesJson) {
  const ids = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') {
      if (typeof node.migrationId === 'string') ids.push(node.migrationId);
      Object.values(node).forEach(walk);
    }
  };
  walk(specChangesJson);
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

function git(args, cwd) {
  // stderr is PIPED, not inherited: `showOrNull` probes paths that legitimately do
  // not exist at a rev (a ledger file added mid-history, a changeset deleted), and
  // git's "fatal: path ... does not exist" would otherwise print as though the gate
  // had failed while it is in fact answering the question it asked.
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** File contents at a rev, or `null` when the path does not exist there. */
function showOrNull(rev, path, cwd) {
  try { return git(['show', `${rev}:${path}`], cwd); } catch { return null; }
}

/**
 * Bulk `showOrNull`: every path at one rev, in a SINGLE `git cat-file --batch`.
 *
 * Not a micro-optimisation. The convention-rot assertion has to look at the whole
 * changeset stock, which is ~1300 files; one `git show` per file is ~1300 process
 * spawns and measured at 5.2s per invocation, which is a real cost on a gate that
 * runs on every PR and is paid again by every historical replay. One batched call
 * is ~0.2s.
 *
 * @param {string} rev
 * @param {string[]} paths
 * @param {string} cwd
 * @returns {Map<string, string>} path -> contents, absent when missing at `rev`
 */
function showManyOrNull(rev, paths, cwd) {
  const found = new Map();
  if (paths.length === 0) return found;
  const input = paths.map((p) => `${rev}:${p}`).join('\n') + '\n';
  let out;
  try {
    out = execFileSync('git', ['cat-file', '--batch'], {
      cwd, input, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { return found; }

  // `<oid> <type> <size>\n<contents>\n` per hit; `<request> missing\n` per miss.
  let off = 0;
  for (const path of paths) {
    const nl = out.indexOf(0x0a, off);
    if (nl < 0) break;
    const header = out.subarray(off, nl).toString('utf8');
    if (header.endsWith(' missing')) { off = nl + 1; continue; }
    const size = Number(header.split(' ')[2]);
    if (!Number.isFinite(size)) break;
    found.set(path, out.subarray(nl + 1, nl + 1 + size).toString('utf8'));
    off = nl + 1 + size + 1; // trailing newline after the blob
  }
  return found;
}

function resolveCommit(ref, cwd) {
  try { return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).trim() || null; } catch { return null; }
}

export function mergeBase(base, head, cwd) {
  try { return git(['merge-base', base, head], cwd).trim() || null; } catch { return null; }
}

/** Every changeset path present at a rev. */
function changesetsAt(rev, cwd) {
  let out;
  try { out = git(['ls-tree', '-r', '--name-only', rev, '--', '.changeset'], cwd); } catch { return []; }
  return out.split('\n').map((s) => s.trim()).filter((p) => p && isChangesetFile(p));
}

/**
 * The ADR-0087 id set at a rev, plus the per-source counts the input assertions read.
 * @returns {{ ids: Set<string>, bySource: Record<string, number>, missingSources: string[] }}
 */
export function ledgerAt(rev, cwd) {
  const ids = new Set();
  const bySource = {};
  const missingSources = [];
  for (const path of LEDGER_SOURCES) {
    const src = showOrNull(rev, path, cwd);
    if (src === null) { missingSources.push(path); continue; }
    const found = extractIds(src);
    bySource[path] = found.length;
    for (const id of found) ids.add(id);
  }
  return { ids, bySource, missingSources };
}

// ---------------------------------------------------------------------------
// Input assertions -- absence is never a pass (#4690)
// ---------------------------------------------------------------------------

/**
 * Prove every input this gate reasons over is present and non-empty BEFORE any
 * verdict is produced. Each failure here is a red, never a skip.
 *
 * @param {{ cwd: string, head: string }} opts
 * @returns {string[]} problems
 */
export function assertInputs({ cwd, head }) {
  const problems = [];

  // (1) the subject matter exists at all
  const stock = changesetsAt(head, cwd);
  if (stock.length === 0) {
    problems.push(
      'no changesets found at HEAD (`.changeset/*.md` is empty or absent).\n' +
      '    This gate judges changesets; with none to read it would report success while checking\n' +
      '    nothing (#4690). If the changeset directory genuinely moved, this gate moves with it.',
    );
  }

  // (2) the ledger exists and is non-empty
  const { ids, bySource, missingSources } = ledgerAt(head, cwd);
  for (const path of missingSources) {
    problems.push(
      `ADR-0087 ledger source not found at HEAD: ${path}\n` +
      '    fix: if the ledger moved, update LEDGER_SOURCES in this script. A missing ledger is a\n' +
      '    red, never a silent skip -- every `registered` claim would otherwise be unverifiable.',
    );
  }
  for (const [path, n] of Object.entries(bySource)) {
    if (n === 0) {
      problems.push(
        `ADR-0087 ledger source ${path} yielded ZERO ids.\n` +
        '    Either the ledger was emptied, or extractIds() no longer matches its declaration shape.\n' +
        '    Both are red: with no ids, every `registered` disposition would fail and every\n' +
        '    `already-registered` one would too.',
      );
    }
  }

  // (3) PARSER ROT -- the generated projection is the independent witness that the
  //     source parser still sees what the build sees. Projection must be a SUBSET of
  //     source: a new entry not yet regenerated is `check:spec-changes`'s red, not
  //     ours, so the two gates never double-report one fact.
  const rawSpecChanges = showOrNull(head, SPEC_CHANGES, cwd);
  if (rawSpecChanges === null) {
    problems.push(
      `${SPEC_CHANGES} not found at HEAD.\n` +
      '    It is this gate\'s only independent witness that the ledger parser still matches the\n' +
      '    registry\'s declaration shape. Without it the parser could rot unnoticed.',
    );
  } else {
    let parsed = null;
    try { parsed = JSON.parse(rawSpecChanges); } catch (e) {
      problems.push(`${SPEC_CHANGES} does not parse as JSON: ${e.message}`);
    }
    if (parsed) {
      const projected = projectedMigrationIds(parsed);
      if (projected.length === 0) {
        problems.push(
          `${SPEC_CHANGES} carries no \`migrationId\` at all.\n` +
          '    The projection is this gate\'s witness for the source parser; an empty witness\n' +
          '    witnesses nothing (#4690).',
        );
      }
      const unseen = projected.filter((id) => !ids.has(id));
      if (unseen.length > 0) {
        problems.push(
          `ledger parser drift: ${unseen.length} id(s) present in the generated ${SPEC_CHANGES}\n` +
          `    are NOT found by extractIds() in ${LEDGER_SOURCES[0]}:\n` +
          unseen.slice(0, 8).map((id) => `      - ${id}`).join('\n') +
          (unseen.length > 8 ? `\n      ... and ${unseen.length - 8} more` : '') +
          '\n    The registry\'s declaration shape changed underneath this gate. Left alone, the id\n' +
          '    set shrinks silently and every `registered` disposition starts failing for the wrong\n' +
          '    reason. fix: widen extractIds() to match the new shape, in the same PR that changes it.',
        );
      }
    }
  }

  // (4) CONVENTION ROT -- if `major` / `**BREAKING` / `feat!:` are ever reworded
  //     wholesale, this gate matches nothing and passes everything in silence.
  let breakingInStock = 0;
  for (const text of showManyOrNull(head, stock, cwd).values()) {
    if (breakingDeclaration(parseChangeset(text)).breaking) breakingInStock++;
  }
  if (stock.length > 0 && breakingInStock === 0) {
    problems.push(
      `not one of ${stock.length} changeset(s) in stock matches the breaking-change detector.\n` +
      '    This gate fires on declared-breaking changesets; with zero detectable it is a no-op\n' +
      '    reporting success (#4690). If the breaking-change convention was deliberately reworded,\n' +
      '    this gate\'s contract changed with it -- update breakingDeclaration() and this assertion\n' +
      '    together, rather than leaving a green gate that checks nothing.',
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Workspace manifests -- the `unpublished` precondition
// ---------------------------------------------------------------------------

/**
 * name -> { private, file } for every workspace package at a rev.
 *
 * Read from git rather than the working tree so the whole gate is a pure function
 * of two revs, which is what lets the self-test drive the shipping code path with
 * real temp repositories instead of an imitation of it.
 */
export function workspacePackagesAt(rev, cwd) {
  const pkgs = new Map();
  let out;
  try { out = git(['ls-tree', '-r', '--name-only', rev], cwd); } catch { return pkgs; }
  const manifests = out
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => p.endsWith('/package.json') && !p.includes('node_modules/') && PACKAGE_ROOTS.some((r) => p.startsWith(`${r}/`)));
  for (const [p, raw] of showManyOrNull(rev, manifests, cwd)) {
    try {
      const json = JSON.parse(raw);
      if (json.name && !pkgs.has(json.name)) pkgs.set(json.name, { private: json.private === true, file: p });
    } catch { /* an unparseable manifest is another gate's problem */ }
  }
  return pkgs;
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

const FIXIT = (ids) =>
  [
    '      Add ONE of these lines to the changeset body:',
    '',
    ids && ids.length
      ? `        <!-- adr-0087: registered ${ids.join(', ')} -->`
      : '        <!-- adr-0087: registered SOME-MIGRATION-ID -->',
    '        <!-- adr-0087: not-required (unpublished) why -->',
    '        <!-- adr-0087: not-required (already-registered SOME-MIGRATION-ID) why -->',
    '        <!-- adr-0087: not-required (no-migration-prescription) why -->',
  ].join('\n');

/**
 * Judge the breaking changesets this diff introduces.
 *
 * @param {{ cwd: string, base: string, head?: string }} opts
 * @returns {{ problems: {file: string, message: string}[], judged: object[], skipped: string[], base: string, ledgerAdded: string[] }}
 * @throws when `base` and `head` have no merge base (#4690: not a pass)
 */
export function scan({ cwd, base, head = 'HEAD' }) {
  const from = mergeBase(base, head, cwd);
  if (!from) {
    throw new Error(
      `no merge base between '${base}' and '${head}' -- the diff has no trustworthy starting point. ` +
        'Refusing to fall back to the raw base, which is the #6129 defect.',
    );
  }

  const headLedger = ledgerAt(head, cwd);
  const baseLedger = ledgerAt(from, cwd);
  const ledgerAdded = [...headLedger.ids].filter((id) => !baseLedger.ids.has(id));
  // Lazily resolved: only an `unpublished` claim needs the workspace manifests, and
  // reading ~90 of them on every run is pure cost on the 99% of PRs that make no
  // such claim.
  let pkgsCache = null;
  const packages = () => (pkgsCache ??= workspacePackagesAt(head, cwd));

  const out = git(['diff', '--name-status', '--diff-filter=AM', from, head, '--', '.changeset/*.md'], cwd);
  const problems = [];
  const judged = [];
  const skipped = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [status, file] = line.split('\t');
    if (!file || !isChangesetFile(file)) continue;

    const headText = showOrNull(head, file, cwd);
    if (headText === null) continue; // vanished under us; nothing to judge

    const parsed = parseChangeset(headText);
    const decl = breakingDeclaration(parsed);
    if (!decl.breaking) { skipped.push(file); continue; }

    // A changeset that was ALREADY breaking at base is inherited, not introduced.
    // Same philosophy as check-empty-changeset: this gate judges what a PR brings,
    // never the stock it forked from.
    if (status === 'M') {
      const baseText = showOrNull(from, file, cwd);
      if (baseText !== null && breakingDeclaration(parseChangeset(baseText)).breaking) {
        skipped.push(file);
        continue;
      }
    }

    const push = (message) => problems.push({ file, message });
    const d = readDisposition(parsed.body);

    if (!d.ok) {
      push(
        `declares a breaking change (${decl.signals.join(', ')}) but ${d.reason}.\n` +
        '      A declared-breaking change that says nothing about the ADR-0087 ledger is exactly the\n' +
        '      #6148 hole: the ledger and its generated artifacts stay mutually consistent when an\n' +
        '      entry was NEVER written, so every other gate is green (this is what happened on\n' +
        '      PR #6048 / #6011).\n' +
        FIXIT(ledgerAdded),
      );
      continue;
    }

    if (d.verdict === 'registered') {
      const unknown = d.ids.filter((id) => !headLedger.ids.has(id));
      if (unknown.length > 0) {
        push(
          `claims \`registered ${d.ids.join(', ')}\` but ${unknown.length} of those id(s) do not exist in\n` +
          `      the ADR-0087 registries at HEAD: ${unknown.join(', ')}\n` +
          `      Searched: ${LEDGER_SOURCES.join(', ')}\n` +
          '      fix: correct the id, or add the entry the marker claims exists.',
        );
        continue;
      }
      const fresh = d.ids.filter((id) => ledgerAdded.includes(id));
      if (fresh.length === 0) {
        push(
          `claims \`registered ${d.ids.join(', ')}\`, but none of those ids is NEW in this diff --\n` +
          '      every one of them already existed at the merge base. `registered` asserts that THIS PR\n' +
          '      made the registration.\n' +
          '      fix: if the surface is covered by an entry that already existed, say so instead:\n' +
          `        <!-- adr-0087: not-required (already-registered ${d.ids.join(', ')}) why it covers this change -->`,
        );
        continue;
      }
      judged.push({ file, verdict: 'registered', ids: d.ids, fresh, signals: decl.signals });
      continue;
    }

    // not-required.
    //
    // The verdict is dispatched EXPLICITLY rather than by falling through from the
    // `registered` arm above. Found by ablation while reverse-verifying #6148: with
    // the "a marker is required" branch removed, an unparseable disposition reached
    // here carrying `category === undefined` and was reported as `unknown category
    // "undefined"` -- still red, but for a nonsense reason that named neither the
    // real fault nor its fix. Correctness that depends on an earlier `continue`
    // rather than on a stated condition is one edit away from being wrong.
    if (d.verdict !== 'not-required') {
      push(
        `internal: disposition parsed to an unexpected verdict "${d.verdict}".\n` +
        '      This is a bug in readDisposition() or in this dispatch, not in the changeset.',
      );
      continue;
    }

    if (!CATEGORIES.includes(d.category)) {
      push(
        `unknown \`not-required\` category "${d.category}".\n` +
        `      The vocabulary is closed on purpose: ${CATEGORIES.join(', ')}.\n` +
        '      A free-text category would make the exemption unverifiable, which is the allow-list\n' +
        '      failure mode this gate exists to avoid.\n' +
        FIXIT(ledgerAdded),
      );
      continue;
    }

    if (d.why.length < 40) {
      push(
        `\`not-required (${d.category})\` carries a ${d.why.length}-character justification.\n` +
        '      An exemption with no stated reason cannot be re-judged by the next reader. Write what\n' +
        '      makes this break need no ledger entry (40 characters minimum).',
      );
      continue;
    }

    if (d.category === 'unpublished') {
      if (parsed.bumps.length === 0) {
        push('`not-required (unpublished)` on a changeset that declares no package at all -- nothing to verify.');
        continue;
      }
      const pkgs = packages();
      const unresolved = parsed.bumps.filter((b) => !pkgs.has(b.pkg)).map((b) => b.pkg);
      if (unresolved.length > 0) {
        push(
          `\`not-required (unpublished)\` names package(s) with no workspace manifest: ${unresolved.join(', ')}\n` +
          '      The claim cannot be verified, and an unverifiable exemption is refused rather than\n' +
          '      assumed true (#4690).',
        );
        continue;
      }
      const published = parsed.bumps.filter((b) => !pkgs.get(b.pkg).private).map((b) => b.pkg);
      if (published.length > 0) {
        push(
          `\`not-required (unpublished)\` is false: ${published.join(', ')} ${published.length === 1 ? 'is' : 'are'} PUBLISHED\n` +
          `      (\`private\` is not true in ${published.map((p) => pkgs.get(p).file).join(', ')}).\n` +
          '      A breaking change that reaches a published package reaches consumers, so the\n' +
          '      "nothing ships" exemption does not apply.',
        );
        continue;
      }
      judged.push({ file, verdict: 'not-required', category: d.category, why: d.why, signals: decl.signals });
      continue;
    }

    if (d.category === 'already-registered') {
      if (d.ids.length === 0) {
        push(
          '`not-required (already-registered)` names no migration id.\n' +
          '      The whole content of this exemption is WHICH entry already covers the change, so an\n' +
          '      unnamed one asserts nothing checkable.\n' +
          '      fix: <!-- adr-0087: not-required (already-registered SOME-MIGRATION-ID) why -->',
        );
        continue;
      }
      const unknown = d.ids.filter((id) => !headLedger.ids.has(id));
      if (unknown.length > 0) {
        push(
          `\`not-required (already-registered ${d.ids.join(', ')})\` names id(s) that do not exist in the\n` +
          `      ADR-0087 registries at HEAD: ${unknown.join(', ')}`,
        );
        continue;
      }
      const fresh = d.ids.filter((id) => ledgerAdded.includes(id));
      if (fresh.length === d.ids.length) {
        push(
          `\`already-registered\` names only id(s) this very diff ADDS: ${fresh.join(', ')}\n` +
          '      "already" means it existed at the merge base. If this PR made the registration, the\n' +
          `      honest disposition is:  <!-- adr-0087: registered ${fresh.join(', ')} -->`,
        );
        continue;
      }
      judged.push({ file, verdict: 'not-required', category: d.category, ids: d.ids, why: d.why, signals: decl.signals });
      continue;
    }

    // no-migration-prescription
    if (hasMigrationPrescription(parsed.body)) {
      push(
        '`not-required (no-migration-prescription)` contradicts the changeset\'s own body, which carries\n' +
        '      a FROM -> TO migration prescription.\n' +
        '      A changeset that ships instructions for rewriting a consumer\'s code cannot also claim\n' +
        '      that no consumer has to rewrite anything. This is the shape #6048 had: its changeset\n' +
        '      carried a worked `迁移:FROM → TO` block and the ledger got no entry.\n' +
        '      fix: register the migration, or -- if the prescription is genuinely for someone the\n' +
        '      ledger does not serve -- use a category that can be verified (`unpublished`,\n' +
        '      `already-registered`).',
      );
      continue;
    }
    judged.push({ file, verdict: 'not-required', category: d.category, why: d.why, signals: decl.signals });
  }

  return { problems, judged, skipped, base: from, ledgerAdded };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(problems) {
  console.error(`\n✗ check-adr-0087-registration: ${problems.length} problem(s).\n`);
  for (const { file, message } of problems) console.error(`  • ${file}\n      ${message}\n`);
  console.error(
    [
      'WHY THIS GATE EXISTS (#6148).',
      '',
      '  The ADR-0087 ledger (packages/spec/src/migrations/registry.ts) had two gates and both',
      '  pin ledger <-> ARTIFACT SYNCHRONY. Neither pins that a retirement which actually',
      '  happened has an entry AT ALL -- and because the artifacts are a pure projection of the',
      '  registry, an entry that was never written leaves the two perfectly consistent. Every',
      '  gate goes green, repo-wide. PR #6048 removed `ctx.user.roles` that way; a human triage',
      '  seat caught it by eye (#6011) and a separate round backfilled it (PR #6138).',
      '',
      '  Ledger entries are the sole data source for `objectstack migrate meta`,',
      '  `spec-changes.json` and the generated upgrade guide. For a surface with no spec schema',
      '  -- `ctx.user` is only a runtime TS interface -- there is no tombstone and no schema',
      '  rejection either, so the ledger entry is the ONLY channel that reaches an upgrader.',
      '',
      '  This gate does not decide whether your change needs an entry. It requires that the',
      '  question was ANSWERED IN WRITING. Measured: ~1 declared-breaking change in 7 needs an',
      '  entry, so `not-required` is the ordinary answer and costs one line.',
    ].join('\n'),
  );
  for (const { file } of problems) {
    console.error(
      `::error file=${file}::${file} declares a breaking change with no valid ADR-0087 disposition. Add an \`adr-0087:\` marker to the changeset body (see this step's log). A retirement that never reaches the ledger is invisible to every upgrade channel and to every other gate (#6148).`,
    );
  }
}

/** `--list`: the standing audit surface over the whole stock. */
function list(cwd, head) {
  const stock = changesetsAt(head, cwd);
  const rows = [];
  for (const path of stock) {
    const text = showOrNull(head, path, cwd);
    if (text === null) continue;
    const parsed = parseChangeset(text);
    const decl = breakingDeclaration(parsed);
    if (!decl.breaking) continue;
    const d = readDisposition(parsed.body);
    rows.push({
      path,
      signals: decl.signals.join('+'),
      disposition: d.ok ? (d.verdict === 'registered' ? `registered ${d.ids.join(',')}` : `not-required (${d.category})`) : '-- none --',
      prescription: hasMigrationPrescription(parsed.body),
    });
  }
  for (const r of rows) {
    console.log(`${r.disposition === '-- none --' ? ' ' : '✓'} ${r.path}\n    signals=${r.signals}  prescription=${r.prescription ? 'yes' : 'no'}  disposition=${r.disposition}`);
  }
  const none = rows.filter((r) => r.disposition === '-- none --').length;
  console.log(`\n${rows.length} declared-breaking changeset(s) in stock; ${rows.length - none} carry a disposition, ${none} do not.`);
  console.log('Every one of the above is EXEMPT for any PR that does not touch it -- this gate judges diffs, not stock.');
}

// ---------------------------------------------------------------------------
// Self-test -- pins the RED paths so the gate cannot rot into a no-op.
//
// Real temp git repositories driven through the SAME exported scan()/assertInputs(),
// the check-empty-changeset.mjs convention. This gate's whole subject is a diff
// between two commits and a ledger read at two revs, so a fixture that is not two
// real commits would be testing an imitation of the code path that ships.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (cond, msg) => {
    checked++;
    if (!cond) failures.push(msg);
  };

  const REG = (ids) =>
    'export const X = {\n  semantic: [\n' +
    ids.map((i) => `    {\n      id: '${i}',\n      surface: 's',\n    },`).join('\n') +
    '\n  ],\n};\n';
  const CONV = (ids) => REG(ids);
  const SPEC_CHANGES_JSON = (ids) =>
    JSON.stringify({ perMajor: [{ to: 17, migrated: ids.map((id) => ({ migrationId: id })) }] }, null, 2);

  const CS = (opts = {}) => {
    const bumps = opts.bumps ?? [['@objectstack/spec', 'major']];
    const fm = bumps.map(([p, b]) => `'${p}': ${b}`).join('\n');
    return `---\n${fm}\n---\n\n${opts.body ?? 'a summary line\n\nsome prose that is quite long indeed and explains the change.\n'}`;
  };

  /**
   * Build a two-commit repo: base carries the ledger + a breaking changeset in
   * stock (so the convention assertion is satisfied), head adds `files`.
   */
  const build = ({ baseIds = ['old-entry-one', 'old-entry-two'], headIds = null, files = {}, pkgs = null }) => {
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-'));
    const w = (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);

    w(LEDGER_SOURCES[0], REG(baseIds));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(SPEC_CHANGES, SPEC_CHANGES_JSON(baseIds));
    // stock: one declared-breaking changeset so the convention-rot assertion holds
    w('.changeset/stock-breaking.md', CS({ body: 'stock\n\n**BREAKING** something\n' }));
    for (const [name, p] of Object.entries(pkgs ?? { '@objectstack/spec': { dir: 'packages/spec', private: false } })) {
      w(`${p.dir}/package.json`, JSON.stringify({ name, version: '1.0.0', ...(p.private ? { private: true } : {}) }));
    }
    git(['add', '-A'], dir);
    git(['commit', '-qm', 'base'], dir);
    const base = git(['rev-parse', 'HEAD'], dir).trim();

    if (headIds) {
      w(LEDGER_SOURCES[0], REG(headIds));
      w(SPEC_CHANGES, SPEC_CHANGES_JSON(headIds));
    }
    for (const [rel, text] of Object.entries(files)) w(rel, text);
    git(['add', '-A'], dir);
    // `--allow-empty`: some cases deliberately add nothing at head (the "this PR
    // touches no changeset" and "inherited changeset" shapes), and an empty commit
    // is the honest way to express that rather than padding the fixture.
    git(['commit', '-q', '--allow-empty', '-m', 'head'], dir);
    return { dir, base };
  };

  const run = ({ dir, base }) => scan({ cwd: dir, base, head: 'HEAD' });
  const cleanup = [];
  const mk = (o) => { const r = build(o); cleanup.push(r.dir); return r; };

  const red = (label, res, wants) => {
    assert(res.problems.length > 0, `${label}: expected RED, got green`);
    const text = res.problems.map((p) => `${p.file} ${p.message}`).join('\n');
    for (const re of wants) assert(re.test(text), `${label}: message must match ${re}\n--- actual ---\n${text}`);
  };
  const green = (label, res) => {
    assert(res.problems.length === 0, `${label}: expected GREEN, got:\n${res.problems.map((p) => p.file + ' ' + p.message).join('\n')}`);
  };

  // ---- G1: a non-breaking changeset is not this gate's business -------------
  green('G1 non-breaking changeset ignored', run(mk({
    files: { '.changeset/nb.md': CS({ bumps: [['@objectstack/spec', 'patch']], body: 'a patch\n\nprose.\n' }) },
  })));

  // ---- R1: THE #6011 SHAPE -- declared breaking, no ledger entry, no marker --
  // #6048's changeset reconstructed: major + **BREAKING** + a FROM -> TO block,
  // and nothing said about the ledger.
  const SIX048 = CS({
    bumps: [['@objectstack/runtime', 'major']],
    body: '**BREAKING**: `ctx.user.roles` removed\n\n### 迁移:FROM → TO\n\n```js\n// FROM\nctx.user.roles;\n// TO\nctx.user.positions;\n```\n',
  });
  red('R1 the #6011 shape (breaking, no disposition)', run(mk({
    files: { '.changeset/tidy-donkeys-yawn.md': SIX048 },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })), [/tidy-donkeys-yawn/, /no `adr-0087:` disposition marker/, /#6148/, /adr-0087: registered/]);

  // ---- R2: the catch-all exemption cannot cover a FROM -> TO prescription ----
  red('R2 no-migration-prescription contradicted by the body', run(mk({
    files: {
      '.changeset/tidy-donkeys-yawn.md': SIX048.replace(
        '```\n',
        '```\n\n<!-- adr-0087: not-required (no-migration-prescription) nobody in this repo reads the alias, we grepped -->\n',
      ),
    },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })), [/contradicts the changeset's own body/, /FROM -> TO/, /#6048/]);

  // ---- G2: THE RECONCILIATION STEP -- register it and the same input passes --
  green('G2 same input, registered by this diff', run(mk({
    headIds: ['old-entry-one', 'old-entry-two', 'actor-user-roles-to-positions'],
    files: {
      '.changeset/tidy-donkeys-yawn.md': SIX048.replace(
        '```\n',
        '```\n\n<!-- adr-0087: registered actor-user-roles-to-positions -->\n',
      ),
    },
    pkgs: { '@objectstack/runtime': { dir: 'packages/runtime', private: false }, '@objectstack/spec': { dir: 'packages/spec', private: false } },
  })));

  // ---- R3: `registered` naming an id that does not exist --------------------
  red('R3 registered names a nonexistent id', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: registered no-such-entry -->\n' }) },
  })), [/do not exist in/, /no-such-entry/]);

  // ---- R4: `registered` claiming a registration this PR did not make --------
  red('R4 registered names only pre-existing ids', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: registered old-entry-one -->\n' }) },
  })), [/none of those ids is NEW in this diff/, /already-registered/]);

  // ---- G3: already-registered, naming a genuinely pre-existing entry --------
  green('G3 already-registered on a base entry', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (already-registered old-entry-one) the same rename this entry already covers, second half -->\n' }),
    },
  })));

  // ---- R5: already-registered pointing at an id this diff just added --------
  red('R5 already-registered names a freshly added id', run(mk({
    headIds: ['old-entry-one', 'old-entry-two', 'brand-new-entry'],
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (already-registered brand-new-entry) this pre-existing entry already covers the change completely -->\n' }),
    },
  })), [/names only id\(s\) this very diff ADDS/, /adr-0087: registered brand-new-entry/]);

  // ---- R6: `unpublished` claimed for a published package --------------------
  red('R6 unpublished is false', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (unpublished) this is only our internal build tooling and ships to nobody -->\n' }),
    },
  })), [/is PUBLISHED/, /@objectstack\/spec/]);

  // ---- G4: `unpublished` on a genuinely private package ---------------------
  green('G4 unpublished on a private package', run(mk({
    files: {
      '.changeset/x.md': CS({
        bumps: [['@objectstack/example-showcase', 'major']],
        body: '**BREAKING** x\n\n<!-- adr-0087: not-required (unpublished) the showcase example is private and publishes to no registry at all -->\n',
      }),
    },
    pkgs: {
      '@objectstack/spec': { dir: 'packages/spec', private: false },
      '@objectstack/example-showcase': { dir: 'examples/showcase', private: true },
    },
  })));

  // ---- R7: an unknown category is refused (the vocabulary is closed) --------
  red('R7 unknown category', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (whatever-i-like) because I say so and this is a long enough sentence -->\n' }) },
  })), [/unknown `not-required` category/, /vocabulary is closed/]);

  // ---- R8: an empty justification is refused --------------------------------
  red('R8 justification too short', run(mk({
    files: { '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (no-migration-prescription) n/a -->\n' }) },
  })), [/character justification/]);

  // ---- G5: the catch-all, on a changeset carrying no prescription -----------
  green('G5 no-migration-prescription with no FROM/TO in the body', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: not-required (no-migration-prescription) an internal error string changed; no key, symbol or stored value moves -->\n' }),
    },
  })));

  // ---- R9: two markers is ambiguous, not "the first one wins" ---------------
  red('R9 two disposition markers', run(mk({
    files: {
      '.changeset/x.md': CS({ body: '**BREAKING** x\n\n<!-- adr-0087: registered old-entry-one -->\n<!-- adr-0087: not-required (unpublished) whatever this says it is ambiguous -->\n' }),
    },
  })), [/markers -- exactly one disposition is expected/]);

  // ---- G6: a changeset that was ALREADY breaking at base is inherited -------
  {
    const r = mk({ files: {} });
    // modify the stock breaking changeset -- it was breaking at base, so it is not
    // this PR's declaration to answer for.
    writeFileSync(join(r.dir, '.changeset/stock-breaking.md'), CS({ body: 'stock\n\n**BREAKING** something, now with more prose\n' }));
    git(['commit', '-qam', 'touch stock'], r.dir);
    green('G6 inherited breaking changeset not re-judged', run(r));
  }

  // ---- Input assertions (#4690) --------------------------------------------
  {
    const r = mk({ files: {} });
    assert(assertInputs({ cwd: r.dir, head: 'HEAD' }).length === 0, 'I0: a well-formed repo must produce no input problems');
  }
  {
    // parser rot: the projection knows an id the source parser cannot see
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-rot-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w(LEDGER_SOURCES[0], REG(['seen-one']));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(SPEC_CHANGES, SPEC_CHANGES_JSON(['seen-one', 'invisible-to-the-parser']));
    w('.changeset/stock-breaking.md', CS({ body: 'stock\n\n**BREAKING** something\n' }));
    git(['add', '-A'], dir); git(['commit', '-qm', 'base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD' });
    assert(probs.some((p) => /parser drift/.test(p) && /invisible-to-the-parser/.test(p)), `I1: parser rot must be RED, got: ${probs.join('|')}`);
  }
  {
    // convention rot: stock exists but nothing in it reads as breaking
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-conv-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w(LEDGER_SOURCES[0], REG(['seen-one']));
    w(LEDGER_SOURCES[1], CONV(['a-conversion']));
    w(SPEC_CHANGES, SPEC_CHANGES_JSON(['seen-one']));
    w('.changeset/quiet.md', CS({ bumps: [['@objectstack/spec', 'patch']], body: 'nothing breaking here\n' }));
    git(['add', '-A'], dir); git(['commit', '-qm', 'base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD' });
    assert(probs.some((p) => /breaking-change detector/.test(p)), `I2: convention rot must be RED, got: ${probs.join('|')}`);
  }
  {
    // a missing ledger is a red, never a skip
    const dir = mkdtempSync(join(tmpdir(), 'adr0087-noledger-'));
    cleanup.push(dir);
    const w = (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 't@t'], dir);
    git(['config', 'user.name', 't'], dir);
    w('.changeset/stock-breaking.md', CS({ body: 'stock\n\n**BREAKING** x\n' }));
    git(['add', '-A'], dir); git(['commit', '-qm', 'base'], dir);
    const probs = assertInputs({ cwd: dir, head: 'HEAD' });
    assert(probs.some((p) => /ledger source not found/.test(p)), `I3: a missing ledger must be RED, got: ${probs.join('|')}`);
  }

  // ---- Unit pins on the two pattern-shaped judgements ----------------------
  assert(hasMigrationPrescription('### 迁移:FROM → TO\n'), 'P1: the Chinese prescription heading must match');
  assert(hasMigrationPrescription('**FROM → TO**\n'), 'P2: the inline FROM -> TO heading must match');
  assert(hasMigrationPrescription('| FROM (legacy) | TO (primitives) |\n'), 'P3: a FROM/TO table header must match');
  assert(!hasMigrationPrescription('moved from the old value to the new one\n'), 'P4: ordinary lowercase prose must NOT match');
  assert(!hasMigrationPrescription('this is from A to B in prose\n'), 'P5: lowercase "from ... to" must NOT match');
  assert(breakingDeclaration(parseChangeset(CS({ body: 'feat(spec)!: x\n' }))).breaking, 'P6: a conventional-commit bang is a declaration');
  assert(!breakingDeclaration(parseChangeset(CS({ bumps: [['a', 'patch']], body: 'plain\n' }))).breaking, 'P7: a plain patch is not');
  assert(extractIds("  id: 'object-titleFormat-to-nameField',\n").length === 1, 'P8: an id with a capital letter must be extracted');

  for (const d of cleanup) rmSync(d, { recursive: true, force: true });

  if (failures.length) {
    console.error(`✗ check-adr-0087-registration --self-test -- ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  • ${f}\n`);
    process.exit(1);
  }
  console.log(`✓ check-adr-0087-registration --self-test: ${checked} assertions over real temp git repos (real scan()/assertInputs() path)`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const readFlag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (argv.includes('--self-test')) {
  selfTest();
} else if (argv.includes('--list')) {
  list(REPO_ROOT, 'HEAD');
} else {
  const head = readFlag('--head') ?? 'HEAD';
  const requested = readFlag('--base');
  let base = requested;
  if (base) {
    if (!resolveCommit(base, REPO_ROOT)) {
      console.error(`⛔ check-adr-0087-registration: --base '${base}' does not resolve to a commit.`);
      console.error('   A base that cannot be resolved is a failure, never a pass (#4690).');
      process.exit(1);
    }
  } else {
    base = ['origin/main', 'main'].find((r) => resolveCommit(r, REPO_ROOT));
    if (!base) {
      console.error('⛔ check-adr-0087-registration: neither origin/main nor main resolves in this checkout.');
      console.error('   Pass one explicitly: --base <ref-or-sha>. Missing input is a failure, never a pass (#4690).');
      process.exit(1);
    }
  }

  const inputProblems = assertInputs({ cwd: REPO_ROOT, head });
  if (inputProblems.length > 0) {
    console.error(`\n✗ check-adr-0087-registration: ${inputProblems.length} input problem(s) -- refusing to report a verdict.\n`);
    for (const p of inputProblems) console.error(`  • ${p}\n`);
    console.error('  A gate that cannot find its input and exits 0 is worse than no gate (#4690).');
    process.exit(1);
  }

  let result;
  try {
    result = scan({ cwd: REPO_ROOT, base, head });
  } catch (e) {
    console.error(`⛔ check-adr-0087-registration: ${e.message}`);
    process.exit(1);
  }

  if (result.problems.length > 0) {
    report(result.problems);
    process.exit(1);
  }

  const n = result.judged.length;
  if (n === 0) {
    console.log(`✓ check-adr-0087-registration: this PR adds no declared-breaking changeset (${result.skipped.length} non-breaking changeset(s) seen).`);
  } else {
    console.log(`✓ check-adr-0087-registration: ${n} declared-breaking changeset(s), each carrying an ADR-0087 disposition.`);
    for (const j of result.judged) {
      const what = j.verdict === 'registered' ? `registered ${j.ids.join(', ')} (new here: ${j.fresh.join(', ')})` : `not-required (${j.category})`;
      console.log(`    ${j.file}  [${j.signals.join('+')}]  ${what}`);
      if (j.why) {
        // Every exemption is printed AND annotated, on every run: an exemption
        // nobody re-reads is the allow-list failure mode this gate exists to avoid.
        console.log(`        reason: ${j.why}`);
        console.log(`::notice file=${j.file}::ADR-0087 exemption (${j.category}): ${j.why}`);
      }
    }
  }
}
