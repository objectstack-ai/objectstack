#!/usr/bin/env node
// check-skill-frame-freshness — is THIS WORKING TREE's copy of the escalation
// decision frame still current with `origin/main`? (#5866)
//
//   node scripts/check-skill-frame-freshness.mjs              # fetch, then judge
//   node scripts/check-skill-frame-freshness.mjs --no-fetch   # judge against the local ref only
//   node scripts/check-skill-frame-freshness.mjs --ref <rev>  # judge against a named rev
//   node scripts/check-skill-frame-freshness.mjs --self-test
//
// ⚠️ NOT the same gate as `check:skill-frame-sync` (#5798, PR #5865). The two
// read the same documents and answer DIFFERENT questions — the #5866 triage
// ruled explicitly that they stay two scripts, and the reason is worth stating
// because "just add it to the other script" is the obvious wrong move:
//
//   check:skill-frame-sync       "are the FOUR COPIES IN THIS TREE isomorphic?"
//                                 → compares copy against copy, one tree.
//   check:skill-frame-freshness  "is THIS TREE's frame current with origin/main?"
//                                 → compares this tree against a remote ref.
//
// They are independent: a tree that is 173 commits behind, whose four copies are
// CONSISTENTLY the old two-axis frame, is **green** on the sync gate — correctly
// so, the copies really are isomorphic — while being exactly the defect #5866
// reports. The self-test pins that independence rather than asserting it: the
// stale fixture is run through BOTH gates and asserted green on sync, red here.
//
// WHY THIS EXISTS (#5866)
// ----------------------
// Dispatch prompts are assembled by the harness from a working tree on disk, not
// from `origin/main`. A shared PM checkout parked on a long-lived branch drifts:
// on 2026-08-06 one was 173 commits behind, and all three framework documents in
// it still carried the pre-#5130 TWO-axis decision frame. Every dev agent
// dispatched from that tree was handed a system prompt missing the business-need
// axis — the axis #5130 ruled **changes verdicts** rather than decorating them
// (#5021 and #4936 are the same shape ruled opposite ways, and only that axis
// separates them). A PM receiving such an escalation cannot tell from the report
// that an axis was missing: it is a lying green light. This is measured, not
// hypothetical, and the channel is still live — at the time this gate was
// written the shared checkout was 59 commits behind on a different branch.
//
// The frame lives in three files / four copies; COPIES and AXIS_MAP are imported
// from check-skill-frame-sync.mjs so that "the frame's structure" has exactly ONE
// definition. Forking those anchors into this script would reproduce, in the
// gates themselves, the hand-copied-text disease they exist to police.
//
// STRUCTURE, NEVER BYTES
// ----------------------
// The verdict is the axis COUNT and the axis NAME SEQUENCE, mapped through
// AXIS_MAP — the same criterion the sync gate uses, and for the same reason
// transposed one axis over: a byte comparison against `origin/main` would be red
// on every branch that legitimately edits this prose (and on every branch that
// merely reflows it), so it would be bypassed within a day. Byte difference is
// reported as INFORMATION in the summary and never decides anything.
//
// BEHIND IN COMMITS IS NOT THE QUESTION
// -------------------------------------
// A tree 59 commits behind whose frame nobody touched is FINE, and this gate
// says so. Commit distance is printed as context; the frame's structure is the
// verdict. Conversely a tree that already CONTAINS origin/main cannot be stale by
// construction, so a structural difference there is a deliberate local edit — the
// gate downgrades it to a notice and names it as such instead of nagging the very
// PR that is changing the frame on purpose.
//
// OFFLINE DEGRADES TO A WARNING — DELIBERATELY
// --------------------------------------------
// The criterion needs `origin/main`, so it needs a fetch. When the fetch fails,
// this gate WARNS and exits 0. That is the #5866 triage's explicit ruling and it
// is right: a gate that goes hard-red on a plane is a gate that gets bypassed,
// and a bypassed gate is worse than no gate (the same lesson as #5864's
// reports-on-arrival false positive). Precedent shape: check-console-sha.mjs
// warns rather than fails when the dist carries no SHA stamp.
//
// The degradation is implemented as a SEVERITY CLAMP over the one code path, not
// as a second code path: offline runs the identical comparison and prints the
// identical diagnosis, and only the exit code changes. A separate "degraded"
// branch would be exercised by nobody and would rot; this way the offline path is
// the online path.
//
// Note the contrast with check-objectui-pin-fresh.mjs, whose header says network
// failure is NEVER green. Both are right, because the audiences differ: that gate
// runs in CI on a release PR where the network is part of the contract; this one
// runs on a long-lived human/agent working tree where being offline is an
// ordinary Tuesday. Same word "freshness", different blast radius.
//
// WHERE IT RUNS
// -------------
// `pnpm check:frame-freshness`, run by hand (or by a PM at dispatch time) in a
// long-lived working tree. Deliberately NOT wired into lint.yml — see the PR body
// and the note above `--ref`: CI checks out a fresh merge ref, where this gate is
// a tautological green, and on any PR that legitimately edits the frame it would
// be a FALSE red, since "differs from main" is that PR's whole purpose.
//
// KNOWN LIMIT, STATED RATHER THAN HIDDEN
// --------------------------------------
// A tree old enough to predate this file cannot run it. The gate is therefore
// forward-looking: it protects trees from drifting away from main, not trees that
// already drifted past its own introduction. #5866's disposition 1 (have the
// harness read agent definitions from `origin/main` directly) is the root fix and
// lives outside this repo; this gate is mitigation, and the triage says so.
//
// Exit codes:
//   0  the frame is current; or the local frame is a deliberate local edit; or
//      freshness could not be established (offline — warns, never fails)
//   1  this tree's frame is structurally BEHIND origin/main, with a live ref to
//      prove it

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AXIS_MAP, COPIES, analyzeCopy, runAllChecks } from './check-skill-frame-sync.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The one-line fix, quoted verbatim from the #5866 triage. */
const REMEDY = 'git fetch origin main && git merge --ff-only origin/main';

/** Short by design: at dispatch time nobody waits a minute for a gate. */
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

const FRAME_FILES = [...new Set(COPIES.map((c) => c.file))];

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

function git(args, { cwd = REPO_ROOT, timeoutMs } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: !r.error && r.status === 0,
    stdout: r.stdout ?? '',
    stderr: (r.stderr ?? '') + (r.error ? `${r.error.message}` : ''),
    status: r.status,
  };
}

const firstLine = (s) => String(s ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/**
 * Establish what to judge against, degrading in a fixed order. Everything that
 * is not a live, freshly-resolved ref sets `degraded`, which later clamps the
 * severity to a warning — see the header.
 */
export function resolveReference({
  root = REPO_ROOT,
  ref = null,
  noFetch = false,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
} = {}) {
  // An explicitly named rev is an override for advanced use and for the
  // self-test. It is authoritative (not degraded) when it resolves, and a hard
  // error when it does not: the caller asked for THAT rev, and silently judging
  // against something else would be the worst of both worlds.
  if (ref) {
    const sha = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root });
    if (!sha.ok) return { mode: 'bad-ref', degraded: false, fatal: true, ref, sha: null, label: ref };
    return { mode: 'pinned', degraded: false, ref, sha: sha.stdout.trim(), label: ref };
  }

  let why = null;
  if (noFetch) {
    why = '--no-fetch was passed, so nothing was fetched';
  } else {
    const fetched = git(['fetch', '--quiet', '--no-tags', 'origin', 'main'], { cwd: root, timeoutMs });
    if (fetched.ok) {
      const sha = git(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}'], { cwd: root });
      if (sha.ok) {
        return { mode: 'fetched', degraded: false, ref: 'FETCH_HEAD', sha: sha.stdout.trim(), label: 'origin/main (fetched just now)' };
      }
      why = 'git fetch reported success but FETCH_HEAD did not resolve to a commit';
    } else {
      why = firstLine(fetched.stderr) || `git fetch exited with status ${fetched.status}`;
    }
  }

  // Degraded rung 1: a remote-tracking ref from some earlier fetch. Usable, but
  // it may itself be as stale as the tree, so nothing it says can be a hard red.
  const local = git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}'], { cwd: root });
  if (local.ok) {
    const when = git(['log', '-1', '--format=%cI', 'refs/remotes/origin/main'], { cwd: root });
    return {
      mode: 'local-ref',
      degraded: true,
      ref: 'refs/remotes/origin/main',
      sha: local.stdout.trim(),
      label: 'refs/remotes/origin/main (local copy, itself possibly stale)',
      why,
      refDate: when.ok ? when.stdout.trim() : null,
    };
  }

  // Degraded rung 2: nothing to compare against at all.
  return { mode: 'no-ref', degraded: true, ref: null, sha: null, label: null, why };
}

// ---------------------------------------------------------------------------
// reading the frame from both sides
// ---------------------------------------------------------------------------

const treeReader = (root) => (file) => {
  const p = join(root, file);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

const refReader = (root, ref) => (file) => {
  // `git show <rev>:<path>` — path is repo-relative with forward slashes, which
  // is exactly how COPIES spells it. A non-zero exit means "absent at that rev".
  const r = git(['show', `${ref}:${file}`], { cwd: root });
  return r.ok ? r.stdout : null;
};

/**
 * Extract `{ count, sequence }` per copy using the sync gate's own extractor, so
 * both gates provably mean the same thing by "structure". Extraction failure is
 * recorded, never skipped (#4690).
 */
function structuresOf(read) {
  const extractionProblems = [];
  const byCopy = new Map();
  const missing = [];
  const texts = new Map();

  for (const copy of COPIES) {
    if (!texts.has(copy.file)) texts.set(copy.file, read(copy.file));
    const text = texts.get(copy.file);
    if (text == null) {
      if (!missing.includes(copy.file)) missing.push(copy.file);
      continue;
    }
    const r = analyzeCopy({ ...copy, text }, AXIS_MAP, extractionProblems);
    if (r) byCopy.set(copy.id, { declared: r.declared, ids: r.ids, file: copy.file });
  }
  return { byCopy, missing, extractionProblems };
}

const signature = (s) => `${s.declared} axes: ${s.ids.join(' → ')}`;

// ---------------------------------------------------------------------------
// the verdict
// ---------------------------------------------------------------------------

const RANK = { ok: 0, warn: 1, error: 2 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

/**
 * Run the whole judgement over one repository root. Returns a structured verdict
 * so the self-test can assert on severity rather than on scraped stdout.
 */
export function evaluate({
  root = REPO_ROOT,
  ref = null,
  noFetch = false,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
} = {}) {
  const reference = resolveReference({ root, ref, noFetch, timeoutMs });

  if (reference.fatal) {
    return {
      severity: 'error',
      reference,
      problems: [
        `the ref you named (\`${reference.ref}\`) does not resolve to a commit in this repository.\n` +
        `    Nothing was compared. Name a rev that exists, or drop --ref to judge against origin/main.`,
      ],
      notes: [],
      diffs: [],
    };
  }

  if (reference.mode === 'no-ref') {
    // Nothing to compare against. Warn loudly and pass: an unverifiable tree is
    // not a proven-stale tree, and failing here would only teach the bypass.
    return {
      severity: 'warn',
      reference,
      problems: [],
      notes: [
        `freshness could NOT be established: there is no \`origin/main\` to compare against.\n` +
        `    ${reference.why}\n` +
        `    This is a warning, never a failure — but it also means this run proves nothing\n` +
        `    about how current your decision frame is. When you are back online:\n` +
        `      ${REMEDY}`,
      ],
      diffs: [],
    };
  }

  const tree = structuresOf(treeReader(root));
  const remote = structuresOf(refReader(root, reference.ref));

  const problems = [];
  const notes = [];
  let severity = 'ok';

  // --- ancestry: can this tree be stale at all? ----------------------------
  const contains = git(['merge-base', '--is-ancestor', reference.sha, 'HEAD'], { cwd: root }).ok;
  const behindOut = git(['rev-list', '--count', `HEAD..${reference.sha}`], { cwd: root });
  const behind = behindOut.ok ? Number(behindOut.stdout.trim()) : null;

  // --- extraction failures -------------------------------------------------
  for (const p of tree.extractionProblems) {
    problems.push(
      `THIS WORKING TREE — the frame could not be read out of your own files:\n    ${p}\n` +
      `    Freshness cannot be judged until this parses. \`pnpm check:skill-frame-sync\`\n` +
      `    diagnoses the in-tree side of it.`,
    );
    severity = worst(severity, 'error');
  }
  for (const p of remote.extractionProblems) {
    problems.push(
      `${reference.label} — the frame could not be read out of the REMOTE copy:\n    ${p}\n` +
      `    Read this as staleness until proven otherwise: the anchors doing the reading\n` +
      `    come from YOUR tree, so "main's frame no longer parses here" usually means\n` +
      `    main moved the frame and your tree predates the move.\n` +
      `      ${REMEDY}`,
    );
    severity = worst(severity, 'error');
  }

  // --- files present on one side only --------------------------------------
  for (const file of remote.missing) {
    // Absent upstream: either this tree ADDS the file, or main deleted it. This
    // gate cannot tell the two apart without walking history, so it says both
    // out loud rather than picking one and being quietly wrong.
    notes.push(
      `${file} exists here but NOT at ${reference.label}.\n` +
      `    Either your tree adds this file (fine — nothing to be stale against), or\n` +
      `    origin/main removed it and your tree still carries it (stale). This gate\n` +
      `    cannot tell which; if you did not add it, run:  ${REMEDY}`,
    );
    severity = worst(severity, 'warn');
  }
  for (const file of tree.missing) {
    problems.push(
      `${file} exists at ${reference.label} but is MISSING from this working tree.\n` +
      `    A framework document that main has and you do not is staleness by definition.\n` +
      `      ${REMEDY}`,
    );
    severity = worst(severity, 'error');
  }

  // --- the comparison itself ------------------------------------------------
  const diffs = [];
  for (const copy of COPIES) {
    const here = tree.byCopy.get(copy.id);
    const there = remote.byCopy.get(copy.id);
    if (!here || !there) continue; // already reported above
    if (signature(here) !== signature(there)) diffs.push({ copy, here, there });
  }

  if (diffs.length > 0) {
    const detail = diffs.map(({ copy, here, there }) =>
      `      ${copy.file}  (${copy.id} — ${copy.what})\n` +
      `        this tree      : ${signature(here)}\n` +
      `        ${reference.label.padEnd(13).slice(0, 13)}: ${signature(there)}`,
    ).join('\n');

    if (contains) {
      // HEAD already contains the reference, so nothing here can be stale. The
      // difference is a deliberate local edit — very likely the PR that is
      // changing the frame on purpose. Say so; do not nag it.
      notes.push(
        `${diffs.length} copy/copies of the decision frame differ from ${reference.label}, but your\n` +
        `    HEAD already CONTAINS that commit — so this is a LOCAL CHANGE, not staleness:\n` +
        detail + `\n` +
        `    If you are editing the frame on purpose, this is the expected reading and\n` +
        `    \`pnpm check:skill-frame-sync\` is the gate that judges the edit itself.`,
      );
      severity = worst(severity, 'warn');
    } else {
      problems.push(
        `this working tree's decision frame is STRUCTURALLY BEHIND ${reference.label}` +
        (behind == null ? '' : ` (HEAD is ${behind} commit(s) behind)`) + ':\n' +
        detail + '\n' +
        `    Anything dispatched from this tree carries the frame on the FIRST line above.\n` +
        `    That is #5866: the agent escalates on a frame the repo no longer rules by, and\n` +
        `    the report it returns looks complete. Bring the tree forward before dispatching:\n` +
        `      ${REMEDY}`,
      );
      severity = worst(severity, 'error');
    }
  }

  // --- the degradation clamp -----------------------------------------------
  // One code path, one diagnosis; offline only changes what the exit code does
  // with it. See the header on why this is a clamp and not a second branch.
  let clamped = false;
  if (reference.degraded && severity === 'error') {
    severity = 'warn';
    clamped = true;
  }

  return { severity, reference, problems, notes, diffs, contains, behind, clamped, tree, remote };
}

// ---------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------

/** Byte identity per file — INFORMATION only, never part of the verdict. */
function byteIdentity(root, reference) {
  if (!reference?.sha) return null;
  const present = FRAME_FILES.filter((f) => existsSync(join(root, f)));
  if (present.length === 0) return null;
  const here = git(['hash-object', '--', ...present], { cwd: root });
  if (!here.ok) return null;
  const hereShas = here.stdout.trim().split('\n');
  let identical = 0;
  for (const [i, file] of present.entries()) {
    const there = git(['rev-parse', '--verify', '--quiet', `${reference.ref}:${file}`], { cwd: root });
    if (there.ok && there.stdout.trim() === hereShas[i]) identical += 1;
  }
  return { identical, total: present.length };
}

function render(verdict, { root = REPO_ROOT } = {}) {
  const { severity, reference, problems, notes, behind, clamped } = verdict;
  const out = [];

  if (severity === 'error') {
    out.push(`\n✗ check-skill-frame-freshness: this tree's decision frame is out of date.\n`);
  } else if (severity === 'warn') {
    out.push(`\n⚠ check-skill-frame-freshness: ${clamped ? 'a staleness signal could not be confirmed' : 'read this before dispatching'}.\n`);
  }

  for (const p of problems) out.push(`  • ${p}\n`);
  for (const n of notes) out.push(`  • ${n}\n`);

  if (clamped) {
    out.push(
      `  ⚠ DEGRADED — the finding above WOULD be a hard failure, but this run could not\n` +
      `    reach the remote, so it is reported as a warning and the command exits 0:\n` +
      `      ${reference.why}\n` +
      `    ${reference.label} may be as stale as your tree, so the comparison above is\n` +
      `    evidence, not proof. Confirm with:  ${REMEDY}\n`,
    );
  } else if (reference?.degraded && reference.mode === 'local-ref') {
    out.push(
      `  ⚠ Compared against a LOCAL ref, not a fresh one (${reference.why}).\n` +
      `    ${reference.refDate ? `That ref was last updated ${reference.refDate}. ` : ''}` +
      `A green here proves only that\n    you match a possibly-stale local copy of main.\n`,
    );
  }

  if (severity === 'ok') {
    const bytes = byteIdentity(root, reference);
    out.push(
      `✓ check-skill-frame-freshness: the decision frame in this tree is current with ` +
      `${reference.label}.\n` +
      `  ${COPIES.length} copies across ${FRAME_FILES.length} files; ` +
      `${signature([...verdict.tree.byCopy.values()][0])}\n` +
      (behind ? `  HEAD is ${behind} commit(s) behind, but the frame itself is unchanged — that is fine.\n` : '') +
      (bytes ? `  ${bytes.identical}/${bytes.total} framework files are byte-identical to the ref (wording differences are not drift).\n` : ''),
    );
  }

  return out.join('');
}

// ---------------------------------------------------------------------------
// self-test — real temp git repositories, never the network
// ---------------------------------------------------------------------------

/**
 * The mutation set that turns the REAL three-axis documents into a COHERENT
 * two-axis tree — the #5866 specimen. Coherent matters: every count sentence and
 * every in-file mention moves with the axes, which is precisely why the sync gate
 * stays green on it. The self-test asserts that green, so this table is validated
 * by the sync gate itself: an incomplete mutation makes sync red and fails the
 * case loudly instead of quietly weakening it.
 *
 * `drop` un-marks the business-need entry so it stops being an axis entry (a
 * leading space is enough — the sync gate's ENTRY_START is anchored at column 0),
 * which is the #5130 damage this whole family exists to prevent.
 */
const TO_TWO_AXES = [
  // counts, bindings and mentions — global, so one rule covers several copies
  { from: /on three fixed axes/g, to: 'on two fixed axes' },
  { from: /on the three fixed axes below/g, to: 'on the two fixed axes below' },
  { from: /on all three axes/g, to: 'on both axes' },
  { from: /on \*\*all three\*\* axes/g, to: 'on **both** axes' },
  { from: /three-axis(\s+)analysis/g, to: 'two-axis$1analysis' },
  { from: /three-axis decision frame/g, to: 'two-axis decision frame' },
  { from: /沿三条固定评估轴/g, to: '沿两条固定评估轴' },
  { from: /这三条轴给出理由;三轴冲突时/g, to: '这两条轴给出理由;两轴冲突时' },
  // the axis entries themselves, one per copy
  { from: '\n- **Real business need**: does this option serve', to: '\n  **Real business need**: does this option serve' },
  { from: '\n   - **实际业务需求** — 每个方案先问', to: '\n     **实际业务需求** — 每个方案先问' },
  { from: '\n**Axis ① — real business need.**', to: '\n _Axis ① — real business need._' },
  { from: '\n- Real business need — does the option serve', to: '\n  Real business need — does the option serve' },
];

function applyRules(text, rules) {
  let out = text;
  const unapplied = [];
  for (const { from, to } of rules) {
    const next = out.replace(from, to);
    if (next === out) unapplied.push(String(from));
    out = next;
  }
  return { text: out, unapplied };
}

/** The real documents, as committed on this branch — fixtures are never synthetic. */
function realFrameFiles() {
  const files = new Map();
  for (const file of FRAME_FILES) files.set(file, readFileSync(join(REPO_ROOT, file), 'utf8'));
  return files;
}

function twoAxisFrameFiles() {
  const files = new Map();
  const unapplied = [];
  for (const [file, text] of realFrameFiles()) {
    const r = applyRules(text, TO_TWO_AXES);
    files.set(file, r.text);
    unapplied.push(...r.unapplied.map((u) => `${file}: ${u}`));
  }
  // Each rule must land somewhere; a rule that matches nothing means the real
  // document drifted and the fixture is no longer the frame it claims to be.
  const everywhere = unapplied.filter((u) => {
    const rule = u.slice(u.indexOf(': ') + 2);
    return unapplied.filter((x) => x.endsWith(rule)).length === FRAME_FILES.length;
  });
  if (everywhere.length > 0) {
    throw new Error(`self-test fixture drifted — rule(s) matched nothing anywhere: ${[...new Set(everywhere)].join(', ')}`);
  }
  return files;
}

function writeFiles(dir, files) {
  for (const [file, text] of files) {
    const p = join(dir, file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
}

function commitAll(dir, message) {
  git(['add', '-A'], { cwd: dir });
  git(['commit', '-q', '-m', message], { cwd: dir });
  return git(['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
}

/**
 * A throwaway repository whose `origin` deliberately points at a path that does
 * not exist, so the real fetch in resolveReference() really fails — the offline
 * rung is exercised by the actual code, not by a mock, and without touching the
 * network.
 */
function makeRepo(label) {
  const dir = mkdtempSync(join(tmpdir(), `check-skill-frame-freshness-${label}-`));
  git(['init', '-q', '-b', 'work'], { cwd: dir });
  git(['config', 'user.email', 'selftest@example.invalid'], { cwd: dir });
  git(['config', 'user.name', 'self test'], { cwd: dir });
  git(['config', 'commit.gpgsign', 'false'], { cwd: dir });
  git(['remote', 'add', 'origin', join(dir, 'no-such-remote.git')], { cwd: dir });
  return dir;
}

function setOriginMain(dir, sha) {
  git(['update-ref', 'refs/remotes/origin/main', sha], { cwd: dir });
}

function selfTest() {
  const real = realFrameFiles();
  const twoAxis = twoAxisFrameFiles();
  const temps = [];

  /** Build: commit `first`, then `second` on top; return both shas. */
  const linear = (label, first, second) => {
    const dir = makeRepo(label);
    temps.push(dir);
    writeFiles(dir, first);
    const a = commitAll(dir, 'first');
    writeFiles(dir, second);
    const b = commitAll(dir, 'second');
    return { dir, a, b };
  };

  const cases = [];

  // --- 1/2: the SAME stale tree, judged online vs offline -------------------
  // The pair is the whole point of the degradation contract: identical fixture,
  // identical diagnosis, severity decided only by whether a live ref was reached.
  {
    const { dir, a: stale, b: current } = linear('stale', twoAxis, real);
    git(['checkout', '-q', stale], { cwd: dir });
    setOriginMain(dir, current);
    cases.push({
      label: 'stale tree + authoritative ref → ERROR naming the stale files (the #5866 shape)',
      run: () => evaluate({ root: dir, ref: current }),
      expect: 'error',
      wants: [/STRUCTURALLY BEHIND/, /\.claude\/agents\/os-dev\.md/, /2 axes: long-term-soundness/, /3 axes: business-need/, new RegExp(REMEDY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
    });
    cases.push({
      label: 'the SAME stale tree, fetch impossible → degrades to WARN, exit 0, same diagnosis',
      run: () => evaluate({ root: dir }),
      expect: 'warn',
      wants: [/STRUCTURALLY BEHIND/, /\.claude\/agents\/os-dev\.md/],
      alsoAssert: (v) => (v.clamped ? null : 'expected the verdict to be marked as clamped'),
    });
    // The independence proof: the sync gate is GREEN on this very fixture.
    cases.push({
      label: 'the sync gate is GREEN on that same stale tree — the two invariants are independent',
      run: () => {
        const copies = COPIES.map((c) => ({ ...c, text: twoAxis.get(c.file) }));
        const scan = FRAME_FILES.map((f) => ({ file: f, text: twoAxis.get(f) }));
        const { problems } = runAllChecks(copies, AXIS_MAP, scan);
        return { severity: problems.length > 0 ? 'error' : 'ok', problems, notes: [] };
      },
      expect: 'ok',
    });
  }

  // --- 3: fresh tree --------------------------------------------------------
  {
    const { dir, b: current } = linear('fresh', twoAxis, real);
    setOriginMain(dir, current);
    cases.push({
      label: 'tree equals origin/main → OK',
      run: () => evaluate({ root: dir, ref: current }),
      expect: 'ok',
    });
  }

  // --- 4: behind in commits, frame untouched -------------------------------
  // Today's shared checkout is 59 commits behind with an intact frame. That must
  // be green, or the gate cries wolf on the ordinary case and gets ignored.
  {
    const wording = new Map([...real].map(([f, t]) => [f, `${t}\n<!-- unrelated later edit -->\n`]));
    const { dir, a: older, b: newer } = linear('wording', real, wording);
    git(['checkout', '-q', older], { cwd: dir });
    setOriginMain(dir, newer);
    cases.push({
      label: 'tree is BEHIND in commits but the frame is unchanged → OK (bytes are not the criterion)',
      run: () => evaluate({ root: dir, ref: newer }),
      expect: 'ok',
      alsoAssert: (v) => (v.behind === 1 ? null : `expected behind=1, got ${v.behind}`),
    });
  }

  // --- 5: deliberate local edit --------------------------------------------
  {
    const { dir, b: local } = linear('local', real, twoAxis);
    const base = git(['rev-parse', 'HEAD~1'], { cwd: dir }).stdout.trim();
    git(['checkout', '-q', local], { cwd: dir });
    setOriginMain(dir, base);
    cases.push({
      label: 'HEAD already contains the ref → the difference is a LOCAL edit, WARN not ERROR',
      run: () => evaluate({ root: dir, ref: base }),
      expect: 'warn',
      wants: [/LOCAL CHANGE, not staleness/],
      alsoAssert: (v) => (v.contains ? null : 'expected contains=true'),
    });
  }

  // --- 6: a framework file main has and we do not --------------------------
  {
    const { dir, b: current } = linear('missing-here', real, real);
    git(['rm', '-q', '.claude/agents/os-dev.md'], { cwd: dir });
    const without = commitAll(dir, 'drop a framework file');
    setOriginMain(dir, current);
    cases.push({
      label: 'a framework file exists on the ref but not in the tree → ERROR',
      run: () => evaluate({ root: dir, ref: current }),
      expect: 'error',
      wants: [/MISSING from this working tree/, /os-dev\.md/],
      alsoAssert: () => (without ? null : 'fixture did not commit'),
    });
  }

  // --- 7: a framework file we have and main does not -----------------------
  {
    const dir = makeRepo('missing-there');
    temps.push(dir);
    const partial = new Map([...real].filter(([f]) => f !== '.claude/agents/os-dev.md'));
    writeFiles(dir, partial);
    const refSha = commitAll(dir, 'main without the dev-agent definition');
    writeFiles(dir, real);
    commitAll(dir, 'tree adds it');
    setOriginMain(dir, refSha);
    cases.push({
      label: 'a framework file exists here but not on the ref → WARN, both readings stated',
      run: () => evaluate({ root: dir, ref: refSha }),
      expect: 'warn',
      wants: [/exists here but NOT at/, /cannot tell which/],
    });
  }

  // --- 8: the frame moved on main, our anchors predate it ------------------
  {
    const moved = new Map([...real]);
    moved.set(
      '.claude/agents/os-dev.md',
      real.get('.claude/agents/os-dev.md').replace(
        '**Analyze every option on three fixed axes',
        '**Weigh every option on the standing axes',
      ),
    );
    const { dir, b: current } = linear('anchors', real, moved);
    git(['checkout', '-q', git(['rev-parse', 'HEAD~1'], { cwd: dir }).stdout.trim()], { cwd: dir });
    setOriginMain(dir, current);
    cases.push({
      label: 'the ref\'s copy no longer parses with our anchors → ERROR, read as staleness',
      run: () => evaluate({ root: dir, ref: current }),
      expect: 'error',
      wants: [/could not be read out of the REMOTE copy/, /your tree predates the move/],
    });
  }

  // --- 9: our own tree does not parse --------------------------------------
  {
    const broken = new Map([...real]);
    broken.set(
      '.claude/agents/os-dev.md',
      real.get('.claude/agents/os-dev.md').replace(
        '**Analyze every option on three fixed axes',
        '**Weigh every option sensibly',
      ),
    );
    const { dir, b: current } = linear('broken-here', broken, real);
    git(['checkout', '-q', git(['rev-parse', 'HEAD~1'], { cwd: dir }).stdout.trim()], { cwd: dir });
    setOriginMain(dir, current);
    cases.push({
      label: 'our own copy does not parse → ERROR pointing at check:skill-frame-sync',
      run: () => evaluate({ root: dir, ref: current }),
      expect: 'error',
      wants: [/could not be read out of your own files/, /check:skill-frame-sync/],
    });
  }

  // --- 10: offline with no origin/main at all ------------------------------
  {
    const dir = makeRepo('no-ref');
    temps.push(dir);
    writeFiles(dir, twoAxis);
    commitAll(dir, 'stale tree, no remote-tracking ref anywhere');
    cases.push({
      label: 'no origin/main reference at all → WARN and pass, stating that nothing was proven',
      run: () => evaluate({ root: dir }),
      expect: 'warn',
      wants: [/could NOT be established/, /proves nothing/],
    });
  }

  // --- 11: an explicitly named ref that does not exist ---------------------
  {
    const dir = makeRepo('bad-ref');
    temps.push(dir);
    writeFiles(dir, real);
    commitAll(dir, 'only commit');
    cases.push({
      label: '--ref names a rev that does not exist → ERROR (never silently judged against something else)',
      run: () => evaluate({ root: dir, ref: 'v99.99.99-nope' }),
      expect: 'error',
      wants: [/does not resolve to a commit/],
    });
  }

  let failed = 0;
  try {
    for (const c of cases) {
      let verdict;
      try {
        verdict = c.run();
      } catch (err) {
        console.error(`  ✗ ${c.label}\n      threw: ${err.message}`);
        failed += 1;
        continue;
      }
      if (verdict.severity !== c.expect) {
        failed += 1;
        console.error(
          `  ✗ ${c.label}\n      expected ${c.expect}, got ${verdict.severity}\n      ` +
          [...verdict.problems, ...verdict.notes].join('\n      '),
        );
        continue;
      }
      const blob = [...verdict.problems, ...verdict.notes].join('\n');
      const missing = (c.wants ?? []).filter((rx) => !rx.test(blob));
      if (missing.length > 0) {
        failed += 1;
        console.error(
          `  ✗ ${c.label}\n      severity as expected, but the message does not name ` +
          `${missing.map((m) => `/${m.source}/`).join(', ')}\n      ${blob}`,
        );
        continue;
      }
      const extra = c.alsoAssert?.(verdict);
      if (extra) {
        failed += 1;
        console.error(`  ✗ ${c.label}\n      ${extra}`);
        continue;
      }
      console.log(`  ✓ ${c.label}`);
    }
  } finally {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  }

  if (failed > 0) {
    console.error(`\n✗ check-skill-frame-freshness self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ check-skill-frame-freshness self-test: ${cases.length} cases pass.`);
}

// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const refAt = argv.indexOf('--ref');
  const verdict = evaluate({
    ref: refAt >= 0 ? argv[refAt + 1] ?? null : null,
    noFetch: argv.includes('--no-fetch'),
  });

  const text = render(verdict);
  if (verdict.severity === 'error') {
    process.stderr.write(text);
    process.exit(1);
  }
  process.stdout.write(text);
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  main();
}
