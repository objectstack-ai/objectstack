// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Self-test for the liveness gate's EVIDENCE guard (#5623).
//
// WHY IT RUNS THE REAL SCRIPT. Everything this file asserts is a property of the
// gate as CI invokes it: which finding classes reach `process.exit(1)`, and what
// the summary line claims. Those two live in `check-liveness.mts` itself, not in
// a helper, and re-implementing the decision in a test would pin the copy rather
// than the gate — which is the exact failure #5623 reports one layer down. The
// bug was never that the check could not SEE the rot: it named all five rotted
// pointers, correctly, and exited 0 anyway. A test of `checkEvidence` (there is
// one, in evidence.test.ts) was therefore green throughout.
//
// So each case spawns `check-liveness.mts` the way `pnpm check:liveness` does and
// reads its exit code. `--ledger-root=<dir>` lets a case point the walk at a COPY
// of packages/spec/liveness with one pointer broken, so the run has exactly one
// cause for its verdict and no repo file is ever mutated — a crashed test leaves
// the worktree clean. Precedent for spawning a gate in its own test:
// scripts/check-generated-ledger.test.ts.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '../..');
const GATE = path.join(HERE, 'check-liveness.mts');
const LEDGERS = path.join(SPEC, 'liveness');

// A repo-rooted path shaped exactly like a real pointer (so `evidence.mts`
// extracts it) that this repo has never contained.
const ROTTED = 'packages/plugins/driver-sql/src/sql-driver.ts';

function runGate(ledgerRoot?: string): { status: number | null; output: string } {
  const require = createRequire(import.meta.url);
  const tsx = require.resolve('tsx/cli');
  const argv = [tsx, GATE, ...(ledgerRoot ? [`--ledger-root=${ledgerRoot}`] : [])];
  const r = spawnSync(process.execPath, argv, { cwd: SPEC, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Rewrite one property's `evidence` in a copied ledger. */
function setEvidence(root: string, type: string, prop: string, evidence: string): void {
  const file = path.join(root, `${type}.json`);
  const ledger = JSON.parse(readFileSync(file, 'utf8'));
  ledger.props[prop].evidence = evidence;
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

function summaryLine(output: string): string {
  return output.split('\n').find((l) => l.startsWith('evidence paths:')) ?? '';
}

describe('check:liveness — evidence pointers (#5623)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-'));
    cpSync(LEDGERS, path.join(tmp, 'liveness'), { recursive: true });
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  // The control. Without it, every "exit 1" below would also be satisfied by the
  // copy simply not being readable.
  it('is green against a verbatim copy of the shipped ledgers', () => {
    const { status, output } = runGate(path.join(tmp, 'liveness'));
    expect(status, output).toBe(0);
    expect(output).toContain('✓ every governed-type property');
  });

  it('FAILS when a `live` entry cites a repo-local file that is gone', () => {
    const root = path.join(tmp, 'broken-local');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(root, 'query', 'limit', `${ROTTED}:1345`);

    const { status, output } = runGate(root);
    // The regression this pins: before #5623 this run printed the finding and
    // exited 0, so a directory move could rot an ADR-0087 evidence chain with
    // nothing in CI to notice.
    expect(status, output).toBe(1);
    expect(output).toContain("'live' entr(ies) cite a file that is missing from THIS repo");
    expect(output).toContain(`query/limit → ${ROTTED}`);
    // ✗, not ⚠ — the grading is the fix, and the two are one character apart.
    expect(output).toMatch(/✗ 1 'live' entr\(ies\) cite a file/);
    expect(output).not.toMatch(/⚠ \d+ 'live' entr\(ies\)/);
  });

  it('names EVERY rotted pointer, not just the first', () => {
    const root = path.join(tmp, 'broken-many');
    cpSync(LEDGERS, root, { recursive: true });
    for (const prop of ['fields', 'where', 'orderBy', 'limit', 'offset']) {
      setEvidence(root, 'query', prop, `${ROTTED} (rotted by the self-test)`);
    }
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toMatch(/✗ 5 'live' entr\(ies\) cite a file/);
    for (const prop of ['fields', 'where', 'orderBy', 'limit', 'offset']) {
      expect(output).toContain(`query/${prop} → ${ROTTED}`);
    }
  });

  // THE BOUNDARY. Tightening the local case must not drag the ~101 cross-repo
  // attributions in with it: those files are legitimately absent from this
  // checkout, and failing on them would make the gate unsatisfiable for every
  // property whose consumer is the renderer or the closed cloud runtime.
  it('stays green when the missing path is attributed to ANOTHER repo', () => {
    const root = path.join(tmp, 'foreign');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(root, 'query', 'limit', 'objectui: packages/app-shell/src/no-such-file.tsx:12');
    setEvidence(root, 'query', 'offset', 'cloud: packages/ee-runtime/src/also-not-here.ts:9');
    // The closed cloud runtime is repo-ROOTED and still foreign — the shape that
    // would break first if the boundary were drawn on the path text alone.
    setEvidence(root, 'query', 'orderBy', 'packages/services/service-ai/src/nope.ts:1');

    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    expect(output).not.toContain('cite a file that is missing');
  });

  // #11210. Everything above validates the FILE half of a citation. These pin
  // the LINE half, and they run against the real gate for the same reason the
  // cases above do: the grading (✗ vs ⚠, exit 1 vs exit 0) lives in
  // check-liveness.mts, and #5623's defect was a check that named its findings
  // correctly and exited 0 anyway.
  it('FAILS when a citation names a line past the end of a file that EXISTS', () => {
    const root = path.join(tmp, 'past-eof');
    cpSync(LEDGERS, root, { recursive: true });
    // A real file, so the existence check is satisfied and this run has exactly
    // one cause for its verdict — the defect itself: file resolves, line is gone.
    setEvidence(root, 'query', 'limit', 'packages/spec/scripts/liveness/evidence.mts:99999');

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('citation(s) name a line the cited file does not have');
    expect(output).toContain('query/limit → packages/spec/scripts/liveness/evidence.mts:99999');
    // ✗, not ⚠ — same grading argument as the missing-file case above.
    expect(output).toMatch(/✗ 1 citation\(s\) name a line/);
    expect(output).not.toMatch(/⚠ \d+ citation\(s\) name a line/);
    // And it must NOT be reported as a missing FILE: separate checks, separate
    // verdicts. Asserted against the missing-file HEADING rather than against
    // the bare `entry → path` line, because that line is not unique to one
    // check: the key-mention check (#11457) reports the same pair in the same
    // shape for its own reason — this fixture cites `evidence.mts` for
    // `query.limit`, and that file genuinely never names `limit`, so it is a
    // true hit there too. Pinning the heading pins the claim actually being
    // made; pinning the line pinned which OTHER checks happened to exist.
    expect(output).not.toContain('cite a file that is missing from THIS repo');
  });

  it('bounds EVERY citation in a concatenated entry, not just the first', () => {
    // The dispatch-critical case: entries `+`-join several citations, so a
    // parser that stopped at the head would leave the tail unfalsifiable — the
    // exact shape of the shipped `permission.tabPermissions` string.
    const root = path.join(tmp, 'past-eof-tail');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(
      root,
      'query',
      'limit',
      'packages/spec/scripts/liveness/evidence.mts:1 (fine) + packages/spec/scripts/liveness/orphans.mts:88888 (rotted tail)',
    );

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('query/limit → packages/spec/scripts/liveness/orphans.mts:88888');
  });

  it('never bounds a citation attributed to ANOTHER repo', () => {
    // Same boundary as the existence check: those files are absent here, so
    // every line in them would read as past EOF and the gate would become
    // unsatisfiable for every renderer-side property.
    const root = path.join(tmp, 'foreign-line');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(root, 'query', 'limit', 'objectui: packages/app-shell/src/RecordDetailView.tsx:99999');

    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    expect(output).not.toContain('name a line the cited file does not have');
  });

  it('prints the citation count and how many are in range, equal on a green run', () => {
    // The #5623 lesson applied to the new counter: printing only "in range"
    // would read as a pass on a run where the parser extracted no citations.
    // Hence two numbers, and a floor under the first — see the floor's own note
    // at the assertion below for why that floor is `> 0` and when to delete it.
    const { status, output } = runGate(path.join(tmp, 'liveness'));
    expect(status, output).toBe(0);
    const line = output.split('\n').find((l) => l.startsWith('line citations:')) ?? '';
    const m = /line citations: (\d+) pointer\(s\) written .*?, (\d+) inside the cited file/.exec(line);
    expect(m, line).not.toBeNull();
    // Non-vacuity. The failure mode this guards is the parser silently
    // extracting NOTHING (#5623), and that failure mode is exactly zero — so
    // zero is exactly what the floor tests. It was 100 until #13003, which is
    // the migration adopting #12516's `path#symbol` grammar and therefore
    // RETIRING line citations by design (300 at that card's filing, 175 after
    // batch 2, 82 after batch 3). Any floor above zero reds on legitimate
    // drainage and re-opens the same escalation one batch later; `> 0` never
    // lies during the migration and still catches extracts-nothing at full
    // strength. Ruled 2026-08-28 on #13003, comment 5458356183.
    //
    // ⛔ WHEN THIS POPULATION LEGITIMATELY REACHES ZERO — the last line citation
    // retired — DELETE this assertion AND this comment IN THE SAME PR that
    // retires it, along with the equality check below, which then compares two
    // zeroes and asserts nothing. A conscious decision at zero, never a silent
    // one; that is the whole reason the floor sits at `> 0` rather than gone.
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(m![2]).toBe(m![1]);
    expect(line).not.toContain('PAST EOF');
  });

  it('still fails a local path that shares a string with a foreign clause', () => {
    // A realm marker's scope ends at the clause boundary. If it did not, one
    // `objectui:` anywhere in an entry would silence the whole entry — a
    // one-token opt-out of the gate.
    const root = path.join(tmp, 'mixed');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(root, 'query', 'limit', `objectui: packages/app-shell/src/x.tsx; ${ROTTED}:1345`);

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain(`query/limit → ${ROTTED}`);
  });
});

// #12516 — the SYMBOL half of a citation. A line citation rots IN RANGE: the
// consumer moves within its file, the file exists, every cited line is inside
// it, the file still names the key — all three earlier checks stay green and
// the pointer is wrong (measured: both `action.json` entries repointed with
// fresh lines on 2026-08-25 had drifted by 2026-08-26). A `path#symbol` anchor
// moves WITH the consumer; the rot that remains — the symbol renamed, deleted,
// or promoted out of the file — is exactly what these cases replay, against the
// REAL gate via `--ledger-root`, for the #5623 reason: the grading lives in
// check-liveness.mts and a helper test cannot pin it.
describe('check:liveness — symbol anchors (#12516)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-anchor-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('FAILS when an anchored symbol is gone from a file that still exists and still names the key', () => {
    // The measured rot event replayed at anchor granularity: the consumer
    // (dispatchFlowAction) moves out / is renamed. Exactly one cause: the file
    // resolves, the citation names no line, and action-execution.ts genuinely
    // names `target` — so neither the existence check, the line bound, nor the
    // key-mention check can be the reason for the exit code.
    const root = path.join(tmp, 'symbol-gone');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(root, 'action', 'target', 'packages/runtime/src/action-execution.ts#dispatchFlowActionMovedAway');

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('anchored citation(s) name a symbol the cited file does not contain');
    expect(output).toContain('action/target → packages/runtime/src/action-execution.ts#dispatchFlowActionMovedAway');
    // ✗, not ⚠ — same grading argument as every citation check before it.
    expect(output).toMatch(/✗ 1 anchored citation\(s\)/);
  });

  it('FAILS on a malformed anchor instead of silently dropping the standard', () => {
    const root = path.join(tmp, 'malformed');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(root, 'action', 'target', 'packages/runtime/src/action-execution.ts#dispatch-flow (prose naming target)');

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('malformed anchor(s) — not one identifier');
    expect(output).toContain('action/target → packages/runtime/src/action-execution.ts#dispatch-flow');
  });

  it('stays GREEN on the drifted BEFORE-state — the honest residual this grammar exists to retire', () => {
    // The exact evidence string `action.target` carried between 2026-08-25 and
    // this change: every cited line is in range, the file names the key, and
    // the lines hold the wrong code. The gate cannot see that, BY CONSTRUCTION
    // — text cannot tell "the consumer" from "plausible code at the address" —
    // which is why the repair is anchor ADOPTION, not a smarter line check
    // (the #12516 census measured 117-173 of 298 line citations failing a
    // key-proximity window — indistinguishable from matcher noise without
    // re-measuring every entry, i.e. the 48-of-227 era again). This case pins
    // the boundary so the red case above stays attributable to the anchor.
    const root = path.join(tmp, 'before-state');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(
      root,
      'action',
      'target',
      "packages/runtime/src/action-execution.ts:725 (type:'flow' server dispatch — automation.execute(action.target, …), with :718 rejecting an unknown flow name by that same value); packages/runtime/src/action-execution.ts:472 (headlessActionTypeError names the target the client-dispatched types go to instead)",
    );

    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
  });

  it('prints the anchor count and how many resolve, equal on a green run', () => {
    // The #5623 two-number discipline, fourth application: "all resolved" over
    // zero anchors is what a degraded parser prints too.
    const root = path.join(tmp, 'green');
    cpSync(LEDGERS, root, { recursive: true });
    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    const line = output.split('\n').find((l) => l.startsWith('symbol anchors:')) ?? '';
    const m = /symbol anchors: (\d+) pointer\(s\) written .*?, (\d+) naming a symbol the cited file contains/.exec(line);
    expect(m, line).not.toBeNull();
    // The two #12516 repoints are the day-one anchored population.
    expect(Number(m![1])).toBeGreaterThanOrEqual(2);
    expect(m![2]).toBe(m![1]);
    expect(line).not.toContain('UNRESOLVED');
    expect(line).not.toContain('MALFORMED');
  });
});

// The README state table is COMPLETE on a green tree (#7257 back-filled the two
// rows that were missing), so `pnpm check:liveness` passing says nothing about
// whether this direction can fire. Same argument as the evidence guard above,
// and the same mechanism answers it: `--ledger-root` points the gate at a copy
// of packages/spec/liveness — which `cpSync` carries README.md into — so a case
// can delete a row or skew the heading in the COPY and read the real exit code.
describe('check:liveness — the README state table (#7257)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-readme-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /** Copy the real ledgers (README included) and rewrite the README in the copy. */
  function withReadme(name: string, edit: (md: string) => string): string {
    const root = path.join(tmp, name);
    cpSync(LEDGERS, root, { recursive: true });
    const file = path.join(root, 'README.md');
    writeFileSync(file, edit(readFileSync(file, 'utf8')));
    return root;
  }

  it('FAILS when a governed type loses its row — the #7257 defect itself', () => {
    // `qa` is the most recently added row (#6247 / PR #7255), so deleting it
    // reproduces the exact state the two missing rows were in.
    const root = withReadme('missing-row', (md) =>
      md.split('\n').filter((l) => !l.startsWith('| qa | ')).join('\n'));

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('governed type(s) with NO row in the README\'s "Current state" table');
    expect(output).toMatch(/^ {4}qa$/m);
    // The prescription has to survive with the check: without it the next agent
    // to hit this failure writes a Notes cell out of the counts, which is the
    // fabrication #7257 refused to commit.
    expect(output).toContain('never from a guess');
  });

  it('FAILS when the heading count is skewed away from the rows', () => {
    const root = withReadme('skewed-heading', (md) =>
      md.replace(/^## Current state — (\d+) governed types/m, '## Current state — 99 governed types'));

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('README state-table heading error(s)');
    expect(output).toContain('heading says 99 governed types, the table has');
    expect(output).toContain('GOVERNED has');
  });

  it('FAILS on a row that GOVERNED does not back — the mirror direction', () => {
    const root = withReadme('orphan-row', (md) =>
      md.replace(/^\| qa \| /m, '| notatype | 1 | 0 | 0 | 0 | invented by the self-test |\n| qa | '));

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('README state-table row(s) that GOVERNED does not back');
    expect(output).toMatch(/^ {4}notatype$/m);
  });

  // The control for all three: the same copy, unedited, is green. Without it
  // every "exit 1" above is also satisfied by the copy simply being unreadable.
  it('is green against a verbatim copy, and says how many rows it checked', () => {
    const root = path.join(tmp, 'verbatim');
    cpSync(LEDGERS, root, { recursive: true });
    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    expect(output).toMatch(/README state table carries a row for each of the \d+ governed type\(s\)/);
  });
});

// The generated count artifact (#7377). Same argument as the block above and the
// same mechanism: on a green tree the artifact is current and the README carries
// no numbers, so `pnpm check:liveness` passing says nothing about whether these
// legs can fire. `--ledger-root` points the REAL gate at a copy — which `cpSync`
// carries `state-counts.md` into alongside README.md — so a case can delete the
// artifact, skew one number, or put a column back and read the real exit code.
describe('check:liveness — the generated count artifact (#7377)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-counts-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /** Copy the real ledger root (README + artifact included) and mutate one file in the copy. */
  function withCopy(name: string, edit: (root: string) => void): string {
    const root = path.join(tmp, name);
    cpSync(LEDGERS, root, { recursive: true });
    edit(root);
    return root;
  }

  it('FAILS when the artifact is gone — the numbers are published by nothing', () => {
    const root = withCopy('missing', (r) => rmSync(path.join(r, 'state-counts.md')));

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('the generated count artifact is not current');
    expect(output).toContain('is MISSING');
    expect(output).toContain('gen:liveness-counts');
  });

  // The leg that replaces what the hand-edit used to buy. It must name the line
  // that moved: "the file is stale" sends the next reader to diff 30 rows, and
  // the point of the failure is the ONE row whose Note may no longer hold.
  it('FAILS on a single skewed count, and names the line', () => {
    const root = withCopy('skewed', (r) => {
      const f = path.join(r, 'state-counts.md');
      const md = readFileSync(f, 'utf8');
      const before = md.match(/^\| `view` \| (\d+) \|/m);
      expect(before, 'the view row moved — repoint this case').not.toBeNull();
      writeFileSync(f, md.replace(before![0], `| \`view\` | ${Number(before![1]) + 1} |`));
    });

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('is STALE');
    expect(output).toContain('first difference at line');
    expect(output).toContain('`view`');
    // The half of the hand-edit worth keeping — regenerate AND re-read the Note.
    expect(output).toContain('READ the diff');
  });

  // The leg neither of the others can see: a re-added column leaves the artifact
  // fresh and the row sets equal, so the table would publish two sets of numbers
  // with only one of them enforced.
  it('FAILS when a count column comes back into the README', () => {
    const root = withCopy('hand-count', (r) => {
      const f = path.join(r, 'README.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace(/^\| object \| /m, '| object | 49 | – | 0 | 1 | '));
    });

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('carrying a COUNT COLUMN');
    expect(output).toMatch(/^ {4}line \d+ \(object\)/m);
  });

  // Row-set drift between the two halves. `qa` is the most recently added row, so
  // deleting it reproduces the #7257 state with the artifact still complete —
  // both headings must fire, because they say different things: one that the
  // index fell behind GOVERNED, one that a measurement is published with no
  // explanation beside it.
  it('FAILS when a type has counts and no README row', () => {
    const root = withCopy('row-set', (r) => {
      const f = path.join(r, 'README.md');
      writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter((l) => !l.startsWith('| qa | ')).join('\n'));
    });

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('where README.md and state-counts.md disagree');
    expect(output).toContain('qa — counted in state-counts.md, no row in the README table');
  });

  // The control for all four: the same copy, unedited, is green and says so.
  // Without it every "exit 1" above is also satisfied by the copy being unusable.
  it('is green against a verbatim copy, and says the artifact is current', () => {
    const root = path.join(tmp, 'verbatim');
    cpSync(LEDGERS, root, { recursive: true });
    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    expect(output).toMatch(/state-counts\.md is current — the same \d+ row\(s\), no count column left/);
  });
});

describe('check:liveness — the evidence summary line (#5623)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-sum-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('prints declared and resolved as separate numbers, equal on a green run', () => {
    const { status, output } = runGate();
    expect(status, output).toBe(0);
    const line = summaryLine(output);
    const m = line.match(/^evidence paths: (\d+) repo-local path\(s\) declared by 'live' entries, (\d+) resolved/);
    expect(m, line).not.toBeNull();
    expect(m![1]).toBe(m![2]);
    // Guards the same degradation evidence.test.ts guards: a parser that extracts
    // nothing would make "declared === resolved" vacuously true.
    expect(Number(m![1])).toBeGreaterThan(100);
    expect(line).not.toContain('MISSING');
  });

  it('MOVES the resolved count when a pointer rots — the mis-labelled count of #5623', () => {
    const root = path.join(tmp, 'liveness');
    cpSync(LEDGERS, root, { recursive: true });
    const green = summaryLine(runGate(root).output);
    const declared = Number(green.match(/: (\d+) repo-local/)![1]);

    setEvidence(root, 'query', 'limit', `${ROTTED}:1345`);
    const red = summaryLine(runGate(root).output);

    // `declared` is unchanged — the pointer is still DECLARED, it just does not
    // resolve. That is precisely why the old line, which printed this number
    // under the word "resolved", read 330 both before and after five pointers
    // were broken.
    expect(red).toContain(`${declared} repo-local path(s) declared`);
    expect(red).toContain(`${declared - 1} resolved against this checkout`);
    expect(red).toContain('1 MISSING');
  });

  it('reports foreign attributions separately and never as missing', () => {
    const { output } = runGate();
    const line = summaryLine(output);
    expect(line).toMatch(/; \d+ attributed to another repo \(objectui \/ cloud — not resolvable here\)\./);
  });
});

// The universe itself. Everything above asks whether the gate judges what it
// walks correctly; this asks whether a surface is INSIDE the walk at all, which
// is the only question the gate cannot ask about itself.
//
// WHY `manifest` GETS A PIN AND THE OTHER THIRTY DO NOT. The registered types
// are already answerable to the registry — dropping one from `GOVERNED` fails
// the `ungoverned` check, which reads `listMetadataTypeSchemaTypes()`. The four
// `SPEC_ONLY_SCHEMAS` types have no such backstop: they are governed BY the
// override and by nothing else, so removing the entry un-governs the surface,
// and for `manifest` that removal has a green two-step. Dropping `'manifest'`
// from `GOVERNED` alone does go red — but on the README row and the count
// artifact, and both of those are repairable by deleting the row and
// regenerating. Do the three edits together and the gate is green over a
// ~24-key authoring surface nothing asks about again — which is precisely the
// state this type was seeded out of (#10728), and the state in which its
// `loading` block accumulated ten inert keys, one of them `sandboxing`, before
// anyone noticed by hand (#4914).
//
// So the pin is on membership, not on verdicts: the ledger's own rows are free
// to move as the measurement moves.
describe('check:liveness — the manifest is inside the governed universe (#10728)', () => {
  it('walks the plugin manifest and reports its rows', () => {
    const { status, output } = runGate();
    expect(status, output).toBe(0);
    // Named in the governed set the run prints...
    expect(output).toMatch(/governed types:.*\bmanifest\b/);
    // ...and actually walked, rather than merely listed.
    expect(output).toMatch(/^ {2}manifest {2,}\d+ classified/m);
  });

  it('resolves ManifestSchema through the override, not through the registry', () => {
    // The manifest is not a metadata kind, so `getMetadataTypeSchema('manifest')`
    // has nothing to return: `SPEC_ONLY_SCHEMAS` is the ONLY resolution path,
    // and the gate throws by name the moment it is not. Asserting the throw
    // message keeps the reason legible if this ever regresses — a bare "exit 1"
    // would read like any other finding.
    const src = readFileSync(GATE, 'utf8');
    expect(src).toMatch(/^\s*manifest: ManifestSchema,$/m);
    expect(src).toContain("const schema = SPEC_ONLY_SCHEMAS[type] ?? getMetadataTypeSchema(type);");
  });
});
