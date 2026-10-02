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
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The parser the hook-budget block at the bottom of this file reads THIS file with.
import ts from 'typescript';
// The registry itself, so the denominator block at the bottom of this file can
// hold the gate's output answerable to it rather than to a copied list (#18133).
import {
  listMetadataTypeSchemaTypes,
  listUnregisteredKindSchemaTypes,
} from '../../src/kernel/metadata-type-schemas';
// The published status vocabulary, so the sample builder below moves counts
// between the same columns the artifact publishes rather than a copied order.
import { STATUS_COLUMNS } from './readme-table.mts';
// The bound high-risk coordinates, so the #19062 block can EXCLUDE them when it
// derives its sample carrier: flipping one of those to `live` would demand an
// ADR-0054 proof and give the run a second cause.
import { BOUND_PROOF_PATHS } from './proof-registry.mts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.resolve(HERE, '../..');
const GATE = path.join(HERE, 'check-liveness.mts');
const LEDGERS = path.join(SPEC, 'liveness');

// The budget the gate-spawning CASES run under: `testTimeout` in vitest.config.ts
// (60_000 in both projects). A HOOK runs under `hookTimeout` instead, vitest's
// 10_000 ms default, which that config does not set — so a hook that spawns the
// whole gate names the case budget itself (#21421). A literal, not an import: the
// config cannot be imported from a test (its top level runs the filter preflights
// against process.argv) and exports no constant. The last block of this file holds
// this value at or above the config's, so the two cannot drift apart unseen.
const GATE_BUDGET_MS = 60_000;

// A repo-rooted path shaped exactly like a real pointer (so `evidence.mts`
// extracts it) that this repo has never contained.
const ROTTED = 'packages/plugins/driver-sql/src/sql-driver.ts';

function runGate(ledgerRoot?: string, extraArgs: readonly string[] = []): { status: number | null; output: string } {
  const require = createRequire(import.meta.url);
  const tsx = require.resolve('tsx/cli');
  const argv = [tsx, GATE, ...(ledgerRoot ? [`--ledger-root=${ledgerRoot}`] : []), ...extraArgs];
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

/** The same, one level down — a drilled child entry (`type/prop.child`). */
function setChildEvidence(root: string, type: string, prop: string, child: string, evidence: string): void {
  const file = path.join(root, `${type}.json`);
  const ledger = JSON.parse(readFileSync(file, 'utf8'));
  ledger.props[prop].children[child].evidence = evidence;
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** Rewrite one property's `status` in a copied ledger. */
function setStatus(root: string, type: string, prop: string, status: string): void {
  const file = path.join(root, `${type}.json`);
  const ledger = JSON.parse(readFileSync(file, 'utf8'));
  ledger.props[prop].status = status;
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** One property's row, read back from a copied ledger. */
function readRow(root: string, type: string, prop: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, `${type}.json`), 'utf8')).props[prop];
}

/**
 * The population label the gate renders from `EVIDENCE_SCANNED_STATUSES`
 * (#13041). Mirrored here once rather than inlined at each assertion, and the
 * set itself is pinned against the gate's source in the population block below —
 * so widening or narrowing the scan has to move both, deliberately.
 */
const SCANNED_LABEL = "'live' / 'planned' / 'experimental' / 'live-elsewhere'";

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
    expect(output).toContain(`${SCANNED_LABEL} entr(ies) cite a file that is missing from THIS repo`);
    expect(output).toContain(`query/limit → ${ROTTED}`);
    // ✗, not ⚠ — the grading is the fix, and the two are one character apart.
    expect(output).toContain(`✗ 1 ${SCANNED_LABEL} entr(ies) cite a file`);
    expect(output).not.toMatch(/⚠ \d+ .* entr\(ies\) cite a file/);
  });

  it('names EVERY rotted pointer, not just the first', () => {
    const root = path.join(tmp, 'broken-many');
    cpSync(LEDGERS, root, { recursive: true });
    for (const prop of ['fields', 'where', 'orderBy', 'limit', 'offset']) {
      setEvidence(root, 'query', prop, `${ROTTED} (rotted by the self-test)`);
    }
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain(`✗ 5 ${SCANNED_LABEL} entr(ies) cite a file`);
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

  it('prints the citation count and how many are in range, in the documented two-number shape', () => {
    // The #5623 lesson applied to the counter: printing only "in range" would
    // read as a pass on a run where the parser extracted no citations. Hence two
    // numbers, and the gate prints them on every run — including this one, where
    // the population is zero.
    //
    // The non-vacuity FLOOR that stood here (`> 0`, ruled 2026-08-28 on #13003,
    // comment 5458356183) and the equality check beside it were DELETED
    // 2026-08-29 (#13043), by the standing instruction the floor's own guard
    // comment carried, at the moment that instruction names: #13003 retired the
    // last line citation and the population legitimately reached zero. The floor
    // reds at exactly that moment BY DESIGN, so that reaching zero is a conscious
    // decision rather than a silent pass; the equality check went with it because
    // it now compares two zeroes. What the case still pins is real and is what
    // the deletion could otherwise cost: the gate must keep EMITTING the line, in
    // the shape this regex documents — drop the line, rename it, or collapse it
    // to one number and this reds. A `path:NNN` citation written again gives this
    // case a population back; restore a floor with it.
    const { status, output } = runGate(path.join(tmp, 'liveness'));
    expect(status, output).toBe(0);
    const line = output.split('\n').find((l) => l.startsWith('line citations:')) ?? '';
    const m = /line citations: (\d+) pointer\(s\) written .*?, (\d+) inside the cited file/.exec(line);
    expect(m, line).not.toBeNull();
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

// #13041 — the scanned POPULATION. Everything above pins how the gate judges an
// entry's evidence; these pin WHICH entries it judges at all, which is the one
// question none of those cases can ask.
//
// THE DEFECT. The four evidence checks ran under `status === 'live'` while
// `producer` was scanned at any status, so an entry whose whole content is a
// REFUSAL carried evidence the census COUNTED and no check READ. Measured on
// `api.json`: `inputMapping.transform` and `outputMapping.transform` are
// `planned`, #13039 migrated both to `path#symbol` anchors precisely because the
// refusal disappearing is what should go red — and renaming
// `mappingDeclarationRejection` moved no verdict. Counted and verified had come
// apart, which is the failure the ledger exists to remove.
//
// Every case runs the REAL gate via `--ledger-root`, for the #5623 reason the
// blocks above state: the population lives in check-liveness.mts and a helper
// test would pin a copy of the decision rather than the decision.
describe('check:liveness — the evidence-scan population (#13041)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-pop-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  // THE CARD'S OWN INSTANCE, replayed. Exactly one cause: `api-mapping.ts`
  // resolves, the citation names no line, and the file genuinely names
  // `transform` — so neither the existence check, the line bound, nor the
  // key-mention check can account for the exit code. Under the old `live`-only
  // population this same mutation exited 0.
  it("FAILS when a `planned` entry's anchored REFUSER is gone from the file", () => {
    const root = path.join(tmp, 'planned-anchor');
    cpSync(LEDGERS, root, { recursive: true });
    setChildEvidence(
      root,
      'api',
      'inputMapping',
      'transform',
      'packages/runtime/src/api-mapping.ts#mappingDeclarationRejectionRenamedAway (the refusal, renamed out from under the pointer)',
    );

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('anchored citation(s) name a symbol the cited file does not contain');
    expect(output).toContain(
      'api/inputMapping.transform → packages/runtime/src/api-mapping.ts#mappingDeclarationRejectionRenamedAway',
    );
  });

  it('FAILS when a `planned` entry cites a repo-local file that is gone', () => {
    // The row is MADE `planned` in the copy rather than found that way. This
    // case used to rely on `field.useGrouping` being `planned` in the shipped
    // ledger, and when that row went `live` the case kept passing while it drove
    // a `live` row — the one leg it exists for went unexercised, silently. The
    // row's shipped `producer` and `evidenceScope` cite only objectui-attributed
    // paths and trip nothing on a `planned` row, and `moveCount` keeps the copy's
    // count shard in step with the flip, so the pointer written below is still
    // the run's only cause — and the rot is the plainest kind, the one the
    // existence check has caught for `live` entries since #5623.
    const root = path.join(tmp, 'planned-missing-file');
    cpSync(LEDGERS, root, { recursive: true });
    const shipped = String(readRow(root, 'field', 'useGrouping').status);
    setStatus(root, 'field', 'useGrouping', 'planned');
    if (shipped !== 'planned') moveCount(root, 'field', shipped, 'planned');
    setEvidence(root, 'field', 'useGrouping', `${ROTTED} (rotted by the self-test)`);
    // The control: the row this run judges IS `planned` in the copy.
    expect(readRow(root, 'field', 'useGrouping').status).toBe('planned');

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain(`${SCANNED_LABEL} entr(ies) cite a file that is missing from THIS repo`);
    expect(output).toContain(`field/useGrouping → ${ROTTED}`);
  });

  it('FAILS when an `experimental` entry cites a repo-local file that is gone', () => {
    // The other half of the widening. `agent.lifecycle` is `experimental` and
    // its shipped evidence is a prose absence claim ("no runtime reader"), which
    // extracts no path at all — so before this change nothing about it could
    // ever fail, and after it, a pointer written there is held to the same
    // standard as a `live` one.
    const root = path.join(tmp, 'experimental-missing-file');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(root, 'agent', 'lifecycle', `${ROTTED} (rotted by the self-test)`);

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain(`agent/lifecycle → ${ROTTED}`);
  });

  // THE BOUNDARY, and it is a real one rather than an oversight — which is the
  // half of this card worth doing whichever way the population question went.
  // The SAME rotted string that reds the two cases above stays green on a `dead`
  // entry, so the exclusion is attributable to the status and not to anything
  // else about the fixture.
  //
  // Why `dead` is out, measured across every ledger when this landed: all 80
  // `dead` rows carry a `note` and only 6 carry an `evidence` string. A dead
  // row's pointer is the retirement story in `note` — which no check scans — so
  // scanning `dead.evidence` would hold 6 rows to a standard, read nothing of
  // the other 74, and publish that as coverage of the class.
  //
  // The carrier is `flow.active`, a `retiredKey()` tombstone, because the gate
  // itself holds a tombstoned row at `dead` (the #19062 join) — so it cannot be
  // re-graded out from under this case. The carrier used to be `flow.description`,
  // a docs-shaped row that WAS re-graded `live` (#20299): a borrowed `dead` row is
  // a claim with a timestamp, and the precondition below says so if it moves.
  it('stays GREEN when a `dead` entry carries the SAME rotted pointer', () => {
    const shipped = JSON.parse(readFileSync(path.join(LEDGERS, 'flow.json'), 'utf8'));
    expect(shipped.props.active.status, 'the carrier row must be `dead` in the shipped ledger').toBe('dead');

    const root = path.join(tmp, 'dead-excluded');
    cpSync(LEDGERS, root, { recursive: true });
    setEvidence(root, 'flow', 'active', `${ROTTED} (rotted by the self-test)`);

    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    expect(output).not.toContain(`flow/active → ${ROTTED}`);
  });

  // The partition itself, pinned at the source — the precedent is the
  // `manifest` membership case at the end of this file, and the reason is the
  // same: a status that falls out of BOTH sets has its evidence counted by the
  // census and verified by nothing, silently, which is #13041 re-armed. The gate
  // throws on that at startup; this keeps the two sets legible to a reader who
  // reaches for the test file first.
  it('declares every status either scanned or explicitly unscanned, and prints the population', () => {
    const src = readFileSync(GATE, 'utf8');
    expect(src).toContain(
      "const EVIDENCE_SCANNED_STATUSES = new Set<string>(['live', 'planned', 'experimental', 'live-elsewhere']);",
    );
    expect(src).toContain("const EVIDENCE_UNSCANNED_STATUSES = new Set<string>(['dead']);");

    const { status, output } = runGate();
    expect(status, output).toBe(0);
    // The gate's own output is where the population is published — a reader of a
    // green run should not have to open the source to learn what was scanned.
    expect(summaryLine(output)).toContain(`declared by ${SCANNED_LABEL} entries`);
  });
});

// #13483 — the `live-elsewhere` criteria. The status says "dead here by
// measurement, enforced in a sibling repo", and the gate cannot resolve the
// foreign file — so what it enforces is the SHAPE of the claim (a
// foreign-realm pointer, a declared cross-repo scope, a dated attestation) and
// its CLOCK (the attestation expires). Every case runs the REAL gate via
// `--ledger-root`, for the #5623 reason each block above states, and every
// mutation targets `manifest/runtime` — the row the status shipped with — so
// each run has exactly one cause for its verdict.
describe('check:liveness — the live-elsewhere criteria (#13483)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-elsewhere-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /** Copy the real ledgers and rewrite fields of one property in the copy. */
  function withProp(name: string, type: string, prop: string, edit: (entry: any) => void): string {
    const root = path.join(tmp, name);
    cpSync(LEDGERS, root, { recursive: true });
    const file = path.join(root, `${type}.json`);
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    edit(ledger.props[prop]);
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
    return root;
  }

  // The control, and the population line. The shipped `manifest.runtime` row is
  // the day-one population, so a green run must show it counted AND satisfied —
  // "no findings" over zero rows is also what a check wired to nothing prints.
  it('is green on the shipped ledgers and publishes the population beside the verdict', () => {
    const root = path.join(tmp, 'verbatim');
    cpSync(LEDGERS, root, { recursive: true });
    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    const line = output.split('\n').find((l) => l.startsWith('live-elsewhere:')) ?? '';
    const m = /live-elsewhere: (\d+) entr\(ies\) carry the verdict .*?, (\d+) with a foreign pointer/.exec(line);
    expect(m, line).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
    expect(m![2]).toBe(m![1]);
    expect(line).not.toContain('MALFORMED');
    expect(line).not.toContain('EXPIRED');
  });

  it('FAILS when the evidence attributes no path to a foreign realm — the unverified label itself', () => {
    const root = withProp('no-foreign', 'manifest', 'runtime', (e) => {
      e.evidence = 'enforced at the cloud marketplace publish gate (trust the note)';
    });
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('live-elsewhere entr(ies) missing the criteria the verdict requires');
    expect(output).toContain('manifest/runtime → cites no foreign-attributed path');
    expect(output).toContain('Do not satisfy this from memory');
  });

  it('FAILS when evidenceScope contradicts the verdict — in-repo is well-formed and wrong here', () => {
    // `in-repo` passes the producer report's vocabulary check, so the exit code
    // has exactly one cause: the elsewhere criterion.
    const root = withProp('wrong-scope', 'manifest', 'runtime', (e) => {
      e.evidenceScope = 'in-repo';
    });
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('manifest/runtime → evidenceScope is "in-repo"');
  });

  it('FAILS when verifiedAt is absent — legal on every other status, unfalsifiable on this one', () => {
    const root = withProp('undated', 'manifest', 'runtime', (e) => {
      delete e.verifiedAt;
    });
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('manifest/runtime → carries no verifiedAt');
  });

  it('FAILS when the attestation outlives the window, demanding a re-reading', () => {
    const root = withProp('expired', 'manifest', 'runtime', (e) => {
      e.verifiedAt = '2026-01-01'; // fixed date, only ever further past the 180d window
    });
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('live-elsewhere attestation(s) older than the 180d window — re-attestation required');
    expect(output).toContain('manifest/runtime → attested 2026-01-01');
    // The prescription must survive with the check: the wrong repair here is a
    // bare re-stamp, which is the "trust the prose" downgrade the status ends.
    expect(output).toContain('re-stamp without re-reading');
    expect(output).toContain('needs-user-decision');
  });

  it('reports a MALFORMED verifiedAt once, under the verification heading — never twice', () => {
    // One rot, one heading (the lineCountOf contract): the bad date fails the
    // gate through the verification report; the elsewhere headings must not
    // double-report it as undated or expired.
    const root = withProp('malformed-date', 'manifest', 'runtime', (e) => {
      e.verifiedAt = 'not-a-date';
    });
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('malformed `verifiedAt` value(s)');
    expect(output).not.toContain('live-elsewhere attestation(s) older');
    expect(output).not.toContain('carries no verifiedAt');
  });

  it('holds a live-elsewhere entry\'s LOCAL citations to the scanned-status standard', () => {
    // Membership in EVIDENCE_SCANNED_STATUSES, observed through behaviour: a
    // repo-local path cited beside the foreign pointer must resolve. The `;`
    // ends the realm's scope, so the rotted path is attributed to THIS repo.
    const root = withProp('local-rot', 'manifest', 'runtime', (e) => {
      e.evidence = `cloud: packages/service-cloud/src/plugin-permission-audit.ts#auditPluginPermissions; ${ROTTED}:10 (a local claim gone stale)`;
    });
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain(`manifest/runtime → ${ROTTED}`);
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

// The generated count artifact (#7377), one shard per governed type (#20361).
// Same argument as the block above and the same mechanism: on a green tree the
// shards are current and the README carries no numbers, so `pnpm check:liveness`
// passing says nothing about whether these legs can fire. `--ledger-root` points
// the REAL gate at a copy — which `cpSync` carries the `state-counts/` directory
// into alongside README.md — so a case can delete the shards, skew one number,
// bring the retired single file back or put a column back, and read the real
// exit code.
describe('check:liveness — the generated count artifact (#7377, sharded #20361)', () => {
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
    const root = withCopy('missing', (r) => rmSync(path.join(r, 'state-counts'), { recursive: true }));

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('the generated count artifact is not current');
    expect(output).toContain('is MISSING');
    expect(output).toContain('gen:liveness-counts');
  });

  // The leg that replaces what the hand-edit used to buy. It must name the line
  // that moved: "the file is stale" sends the next reader to diff 30 rows, and
  // the point of the failure is the ONE row whose Note may no longer hold.
  it('FAILS on a single skewed count, and names the shard and the line', () => {
    const root = withCopy('skewed', (r) => {
      const f = path.join(r, 'state-counts', 'view.md');
      const md = readFileSync(f, 'utf8');
      const before = md.match(/^\| `view` \| (\d+) \|/m);
      expect(before, 'the view row moved — repoint this case').not.toBeNull();
      writeFileSync(f, md.replace(before![0], `| \`view\` | ${Number(before![1]) + 1} |`));
    });

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('state-counts/view.md is STALE');
    expect(output).toContain('first difference at line');
    expect(output).toContain('`view`');
    // The half of the hand-edit worth keeping — regenerate AND re-read the Note.
    expect(output).toContain('READ the diff');
  });

  // The transition hazard (#20361). A branch cut before the split meets the
  // deletion as a modify/delete on its next base merge; a resolution that keeps
  // the file would publish a stale table and a stale TOTAL beside the shards,
  // re-rendered by nothing. It must be red, and the repair must be named.
  it('FAILS when the retired single-file artifact comes back beside the shards', () => {
    const root = withCopy('legacy', (r) => writeFileSync(path.join(r, 'state-counts.md'), '| **total** | **1** |\n'));

    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
    expect(output).toContain('state-counts.md is RETIRED');
    expect(output).toContain('gen:liveness-counts');
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
    expect(output).toContain('where README.md and state-counts/ disagree');
    expect(output).toContain('qa — counted in state-counts/qa.md, no row in the README table');
  });

  // The control for all five: the same copy, unedited, is green and says so.
  // Without it every "exit 1" above is also satisfied by the copy being unusable.
  //
  // It is also the PARITY pin the split owes (#20361). The total is no longer
  // committed anywhere, so the one place it is published is this line — and it
  // must be the sum of the shards actually on disk, read back here row by row,
  // not a second copy of the gate's own arithmetic.
  it('is green against a verbatim copy, says the shards are current, and prints their sum', () => {
    const root = path.join(tmp, 'verbatim');
    cpSync(LEDGERS, root, { recursive: true });
    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    expect(output).toMatch(/state-counts\/ is current — one shard per governed type, the same \d+ row\(s\) as the README/);

    const printed = output.match(/summed at read time and committed nowhere: (.+) = (\d+) classified\./);
    expect(printed, output).not.toBeNull();
    const byColumn = Object.fromEntries(
      printed![1].split(' · ').map((part) => {
        const [n, c] = part.split(' ');
        return [c, Number(n)];
      }),
    );

    const onDisk = readdirSync(path.join(root, 'state-counts'));
    expect(onDisk.length).toBeGreaterThan(0);
    const summed = new Array(STATUS_COLUMNS.length + 1).fill(0);
    for (const name of onDisk) {
      const rows = readFileSync(path.join(root, 'state-counts', name), 'utf8')
        .split('\n')
        .filter((l) => /^\| `[a-z_]+` \|/.test(l));
      expect(rows, name).toHaveLength(1);
      rows[0].split('|').slice(2, -1).forEach((c, i) => (summed[i] += Number(c.trim())));
    }
    expect(STATUS_COLUMNS.map((c) => byColumn[c])).toEqual(summed.slice(0, STATUS_COLUMNS.length));
    expect(Number(printed![2])).toBe(summed[STATUS_COLUMNS.length]);
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
    const m = line.match(
      new RegExp(`^evidence paths: (\\d+) repo-local path\\(s\\) declared by ${SCANNED_LABEL} entries, (\\d+) resolved`),
    );
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

// A ledger `status` was free text: any truthy string was classified and counted,
// then dropped by `foldStateCounts`, which reads four names and nothing else. The
// gate stayed GREEN over an understated total, because the count artifact computes
// its `classified` column as the sum of those four columns and the freshness leg
// compares it against a re-render of the same fold — every reconciliation in the
// gate comparing that number against itself.
//
// Measured across all 31 ledgers on the commit that switched this on: live 819,
// planned 10, dead 80, experimental 5 — 914 classified, no fifth value. So the
// population is ZERO and a green `pnpm check:liveness` proves nothing about
// whether either guard can fire. `--ledger-root` is what answers that, for the
// #5623 reason every block above states: the REAL gate, a COPY with one status
// misspelled, and a real exit code.
describe('check:liveness — an unrecognized ledger `status` (#13083)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-status-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /** A copy of the real ledger root with `field.useGrouping` misspelled. */
  function typodRoot(name: string): string {
    const root = path.join(tmp, name);
    cpSync(LEDGERS, root, { recursive: true });
    // The misspelling is the only thing in the copy that can move a verdict — no
    // evidence-scan finding can be confused for it. The gate scans `evidence`
    // only for a status in `EVIDENCE_SCANNED_STATUSES`, which `planed` is not,
    // and it resolves `producer` at any status, but every path this row's
    // `producer` cites is objectui-attributed, so none of them is resolved
    // against this checkout.
    setStatus(root, 'field', 'useGrouping', 'planed');
    return root;
  }

  // DISPOSITION 1. The row is named, with its coordinate and the offending value.
  it("FAILS and names the row when a ledger `status` is misspelled", () => {
    const { status, output } = runGate(typodRoot('d1-names-the-row'));
    expect(status, output).toBe(1);
    expect(output).toContain('whose `status` is not one of live / experimental / live-elsewhere / dead / planned');
    expect(output).toContain('field/useGrouping → "planed"');
  });

  // The misspelled row is still COUNTED, deliberately. Dropping it would keep
  // `classified` and the `byStatus` buckets in agreement and hide the row from
  // the arithmetic below — silencing the second guard with the first.
  it('still counts the misspelled row, under its own bucket name', () => {
    const { output } = runGate(typodRoot('d1-still-counted'));
    expect(output).toMatch(/^ {2}field {2,}\d+ classified \(.*\bplaned 1\b/m);
  });

  // DISPOSITION 2, through the real gate. The walk counted the row; the four
  // columns did not; the artifact would have published the smaller number. This
  // is the leg that fires even if the vocabulary itself grows — see
  // readme-table.test.ts for that case, which no ledger typo can produce.
  it('FAILS the totals arithmetic, because the fold cannot name that bucket', () => {
    const { status, output } = runGate(typodRoot('d2-arithmetic'));
    expect(status, output).toBe(1);
    expect(output).toContain("do not add up to the walk's own count");
    expect(output).toContain('1 in `planed`');
    expect(output).toContain('is not the repair');
  });

  // The two are not one check reported twice: disposition 1 is the only one that
  // can say WHICH row, and disposition 2 is the only one that reads a number the
  // artifact actually publishes. A repair that satisfied one and not the other
  // would leave the class open, so the split is pinned rather than assumed.
  it('reports the two failures separately — one names the row, one names the number', () => {
    const { output } = runGate(typodRoot('d1-d2-separate'));
    const rowLine = output.split('\n').find((l) => l.includes('field/useGrouping → "planed"'));
    const sumLine = output.split('\n').find((l) => l.includes("publishes") && l.includes('the walk counted'));
    expect(rowLine, output).toBeTruthy();
    expect(sumLine, output).toBeTruthy();
    // The arithmetic is per TYPE — it cannot name the property, which is exactly
    // why disposition 1 is not redundant with it.
    expect(sumLine).not.toContain('useGrouping');
    expect(sumLine).toContain('field');
  });

  // The quiet half, and the reason the whole thing could be switched on: the four
  // real statuses are the entire population today, so an unmutated run must be
  // green AND must show neither heading. "Exits 0" alone would also be satisfied
  // by a guard wired to nothing.
  it('stays GREEN on the real ledgers, where every status is one of the published names', () => {
    const { status, output } = runGate();
    expect(status, output).toBe(0);
    expect(output).not.toContain('whose `status` is not one of');
    expect(output).not.toContain("do not add up to the walk's own count");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The drill recurses past one level — and its boundary is never silent (#17424).
//
// WHY THESE RUN THE REAL GATE AND READ ITS REPORT. Everything asserted here is a
// property of the walk as CI invokes it: which coordinates get classified, which
// get reported, and whether a run that classified nothing can still exit 0. The
// defect was precisely that all three were TRUE of a `children` map at depth two
// and the run said nothing, so a unit test of any single helper would have been
// green throughout — the same shape as the #5623 case at the top of this file.
//
// `--json` is used rather than the prose output because the claims are about
// specific report BUCKETS (`unclassified` vs `orphanEntries` vs `staleEvidence`),
// and a substring search over the human summary cannot tell them apart — which
// matters most here, since "reported somewhere" was never the question. The
// question was whether anything was reported at all.
//
// Several fixtures below exit 1 for a SECOND, expected reason: drilling a
// coordinate that the shipped baseline records as undrilled makes that baseline
// row stale, and the baseline is read from the script's own directory rather
// than from `--ledger-root`, so a copy cannot move it. That is why no case here
// asserts on the exit code alone — each names the bucket its finding lands in.
// Note also that `undrilledStale` is deliberately NOT used as evidence of
// recursion: a coordinate the walk cannot see is reported stale too, so the
// pre-fix and post-fix runs agree on it. It does not discriminate; the buckets
// below do.
describe('check:liveness — the drill recurses past one level (#17424)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-depth-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function freshRoot(name: string): string {
    const root = path.join(tmp, name);
    cpSync(LEDGERS, root, { recursive: true });
    return root;
  }

  /** Set one field on an already-drilled child entry (e.g. its `childrenDefault`). */
  function setChildField(root: string, type: string, prop: string, child: string, field: string, value: unknown): void {
    const file = path.join(root, `${type}.json`);
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    ledger.props[prop].children[child][field] = value;
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  }

  /** Nest a `children` map inside an already-drilled child entry — a depth-2 map. */
  function nestChildren(root: string, type: string, prop: string, child: string, children: unknown): void {
    const file = path.join(root, `${type}.json`);
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    ledger.props[prop].children[child].children = children;
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  }

  function report(root?: string, extraArgs: readonly string[] = []): any {
    const { output } = runGate(root, ['--json', ...extraArgs]);
    const start = output.indexOf('{');
    expect(start, output).toBeGreaterThanOrEqual(0);
    return JSON.parse(output.slice(start));
  }

  // The control, and the first thing the fix changes about a GREEN tree: the
  // depth-two container is now VISIBLE. Before the walk recursed, a container
  // sitting under a drilled child was neither classified, nor deferred, nor
  // recorded — it was not in any population at all, which is why nothing could
  // ever have gone red about it. Two coordinates are pinned and the pair is
  // deliberate: `widgets.compareTo` is the exact structural replacement (a
  // container that is a drilled child, the shape that was invisible before the
  // recursion), and `widgets.chartConfig.annotations` is one level deeper again
  // — a container under TWO drilled levels.
  //
  // ⚠️ The depth-3 half has now gone stale TWICE for the same reason, so read
  // the warning the previous author wrote here rather than only the assertion:
  // a pin naming a coordinate that a card is about goes stale the moment that
  // card lands; naming the SHAPE does not. It named `widgets.chartConfig` until
  // the #17385 drill landed, then `widgets.chartConfig.xAxis` until #17385's
  // second half tombstoned that key on the dashboard carrier (a tombstone has no
  // children, so the container left the population). `annotations` is chosen
  // because it is an appearance key — the half of `chartConfig` the ownership
  // ruling deliberately leaves with the author — so the next card about chart
  // STRUCTURE cannot move it. Any depth-3 container serves; what is pinned is
  // that one EXISTS in the population.
  it('SEES a container that sits under a drilled child, at either depth', () => {
    const r = report();
    const seen = [...r.undrilled.map((u: any) => u.key), ...r.deferredContainers.map((d: string) => d.split(' → ')[0])];
    expect(seen).toContain('dashboard/widgets.compareTo');
    expect(seen).toContain('dashboard/widgets.chartConfig.annotations');
  });

  it('is green against a verbatim copy of the shipped ledgers', () => {
    const { status, output } = runGate(freshRoot('control'));
    expect(status, output).toBe(0);
  });

  // ── 1. THE RECURSION ──
  //
  // The sharpest statement of the defect the card makes is "no evidence path is
  // resolved". So rot one, at depth two, and require the evidence guard to reach
  // it. A gate that still exits 0 on this is the pre-fix gate exactly.
  it('RESOLVES a depth-2 entry\'s evidence — the pointer the one-level walk never read', () => {
    const root = freshRoot('depth2-evidence');
    nestChildren(root, 'dashboard', 'widgets', 'chartConfig', {
      title: { status: 'live', evidence: `${ROTTED}:1`, verifiedAt: '2026-09-12' },
    });
    const r = report(root);
    expect(r.staleEvidence.join('\n')).toContain('dashboard/widgets.chartConfig.title');
  });

  it('classifies the depth-2 keys, moving the verdict counts a blanket entry could not move', () => {
    const control = report(freshRoot('depth2-counts-control')).types.dashboard;
    const root = freshRoot('depth2-counts');
    nestChildren(root, 'dashboard', 'widgets', 'options', {
      dateGranularity: { status: 'experimental', evidence: 'packages/spec/liveness/README.md:1', verifiedAt: '2026-09-12' },
    });
    setChildField(root, 'dashboard', 'widgets', 'options', 'childrenDefault', 'live');
    const after = report(root).types.dashboard;
    // One coordinate in, five out: the blanket verdict on `options` is replaced
    // by a verdict per key, and one of them is a status the container never
    // carried. That difference is the whole point of drilling. (This read
    // `chartConfig` until #17385 drilled it in the shipped ledger — the control
    // tree then already carried the fourteen verdicts the mutation was supposed
    // to introduce, so the delta collapsed to zero and the arithmetic measured
    // nothing. The subject has to be a container the shipped ledger has NOT
    // drilled, or the test grades the fixture instead of the walk.)
    expect(after.classified).toBe(control.classified + 4);
    expect(after.byStatus.experimental ?? 0).toBe((control.byStatus.experimental ?? 0) + 1);
  });

  // ── 2. ⭐ THE REPORT — as important as the recursion ──
  //
  // A key the tool did not classify must SURFACE. Each of the three ways an
  // entry can go unclassified at depth one is pinned here at depth two, because
  // "it recurses now" would be satisfied by a walk that recursed and then
  // swallowed everything it could not resolve.

  it('reports a depth-2 key with NO verdict as UNCLASSIFIED rather than dropping it', () => {
    const root = freshRoot('depth2-unclassified');
    // A `children` map that names ONE of the fourteen keys and no
    // `childrenDefault` — the other thirteen have no verdict from anywhere.
    nestChildren(root, 'dashboard', 'widgets', 'chartConfig', {
      title: { status: 'live', evidence: 'packages/spec/liveness/README.md:1', verifiedAt: '2026-09-12' },
    });
    const r = report(root);
    expect(r.unclassified).toContain('dashboard/widgets.chartConfig.type');
    expect(r.unclassified).toContain('dashboard/widgets.chartConfig.series');
    expect(r.unclassified).not.toContain('dashboard/widgets.chartConfig.title');
  });

  it('reports a BOGUS depth-2 entry as an orphan rather than guessing what it meant', () => {
    const root = freshRoot('depth2-bogus');
    nestChildren(root, 'dashboard', 'widgets', 'chartConfig', {
      neverWasAKey: { status: 'live', evidence: 'packages/spec/liveness/README.md:1' },
    });
    const r = report(root);
    expect(r.orphanEntries).toContain('dashboard/widgets.chartConfig.neverWasAKey');
  });

  it('reports `children` declared on a depth-2 NON-container, with the same message as depth one', () => {
    const root = freshRoot('depth2-non-container');
    // `widgets[].title` is a string. A `children` map on it is authorable
    // nonsense, and before the recursion it was authorable nonsense nobody read.
    nestChildren(root, 'dashboard', 'widgets', 'title', { anything: { status: 'live' } });
    const r = report(root);
    expect(r.unclassified).toContain(
      'dashboard/widgets.title (declared children but property is not a container)',
    );
  });

  // ── 3. ⭐ THE CEILING IS NOT SILENT ──
  //
  // The working depth limit is the ledger's own nesting, so this needs a
  // RECURSIVE schema to reach a constant at all: a NavigationItem's `children`
  // are NavigationItems, so the ledger can be nested arbitrarily deep against a
  // real shape. Past `MAX_DRILL_DEPTH` the walk stops — and says so, per key.
  // A limit that truncated quietly would be this card's own defect, rebuilt one
  // level lower.
  it('reports every key below the drill ceiling as UNCLASSIFIED instead of truncating in silence', () => {
    const root = freshRoot('depth-ceiling');
    const file = path.join(root, 'app.json');
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    // Ten nested levels of `children`, all on the real recursive key.
    let node: any = ledger.props.navigation.children.children;
    for (let i = 0; i < 10; i++) {
      node.children = { children: {} };
      node = node.children.children;
    }
    node.children = { label: { status: 'live', evidence: 'packages/spec/liveness/README.md:1' } };
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);

    const r = report(root);
    const ceiling = r.unclassified.filter((u: string) => u.includes('drill ceiling'));
    expect(ceiling.length, JSON.stringify(r.unclassified, null, 2)).toBeGreaterThan(0);
    // It names the coordinate it stopped at, and says nothing beneath it is
    // classified — the sentence whose absence made this invisible for so long.
    expect(ceiling[0]).toContain('app/navigation.children.children');
    expect(ceiling[0]).toContain('NOT walked');
  });

  it('fails the gate when the ceiling is hit — an unwalked subtree is never a pass', () => {
    const root = freshRoot('depth-ceiling-exit');
    const file = path.join(root, 'app.json');
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    let node: any = ledger.props.navigation.children.children;
    for (let i = 0; i < 10; i++) {
      node.children = { children: {} };
      node = node.children.children;
    }
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
    const { status, output } = runGate(root);
    expect(status, output).toBe(1);
  });
});

// The DENOMINATOR the coverage ratchet divides by (#18133).
//
// Everything in the block above asks whether the gate judges what it walks
// correctly. This asks the prior question — WHOM does it walk for? — and it is
// the one question a gate cannot ask about itself, because the failure mode has
// no output: a type in neither `GOVERNED` nor `PENDING_GOVERNANCE` produces no
// row in any bucket, so `ungoverned: []` reads identically whether the gate
// looked and found nothing or never looked at all.
//
// WHAT WAS WRONG. The denominator was `listMetadataTypeSchemaTypes()` under a
// comment claiming it was "exactly the set of authorable metadata types". That
// function deliberately does NOT enumerate `UNREGISTERED_KIND_SCHEMAS` (#6245 —
// enrolling those entries there "would claim a status this change is careful
// not to grant"), while the four kinds bound in that map are authored on every
// boot through their stack collections and on every write through
// `PUT /api/v1/meta/:type/:name`. So `connector`, `sharing_rule` and
// `analytics_cube` were structurally unnameable by `report.ungoverned` — the
// same sentence #17356 measured false for the reachability gate, one gate over.
//
// WHY THESE ASSERT AGAINST THE LIVE REGISTRY rather than against a literal list:
// a hard-coded expectation would pass unchanged if the gate stopped reading the
// registry at all, which is the regression class this whole block exists for.
// The registry is imported here and the gate is spawned; the two have to agree.
describe('check:liveness — the governance denominator is the AUTHORABLE set (#18133)', () => {
  function jsonReport(extraArgs: readonly string[] = []): any {
    const { output } = runGate(undefined, ['--json', ...extraArgs]);
    const start = output.indexOf('{');
    expect(start, output).toBeGreaterThanOrEqual(0);
    return JSON.parse(output.slice(start));
  }

  // The control for every assertion below. Without it, "the denominator omits
  // nothing" is also satisfied by a registry that enumerates nothing.
  it('has a non-empty registry on BOTH sides of the union', () => {
    expect(listMetadataTypeSchemaTypes().length).toBeGreaterThan(20);
    expect(listUnregisteredKindSchemaTypes().length).toBeGreaterThan(0);
    // The two sets are disjoint — that disjointness IS #6245, and it is why the
    // union is not a no-op. If this ever fails, the fix below has become moot
    // and this whole block needs re-reading, not re-pinning.
    const registered = new Set(listMetadataTypeSchemaTypes());
    expect(listUnregisteredKindSchemaTypes().filter((t) => registered.has(t))).toEqual([]);
  });

  it('counts every unregistered kind, which the registered set alone cannot', () => {
    const report = jsonReport();
    for (const kind of listUnregisteredKindSchemaTypes()) {
      expect(report.authorable, `'${kind}' is authored through its stack collection and through `
        + 'PUT /api/v1/meta/:type/:name, so a governance denominator that omits it cannot report '
        + 'on it — which is exactly the state #18133 found').toContain(kind);
    }
    // …and the denominator is STRICTLY larger than the registered set, which is
    // the assertion that goes red the moment somebody "simplifies" the union
    // back into `listMetadataTypeSchemaTypes()`.
    expect(report.authorable.length).toBeGreaterThan(listMetadataTypeSchemaTypes().length);
    expect(report.authorable).toEqual(
      [...new Set([...listMetadataTypeSchemaTypes(), ...listUnregisteredKindSchemaTypes()])].sort(),
    );
  });

  it('accounts for every member of it — governed or explicitly pending, never silent', () => {
    const report = jsonReport();
    expect(report.ungoverned).toEqual([]);
    // An empty `ungoverned` is only meaningful next to a denominator that could
    // have populated it, so assert the population too — this is the pair the
    // old output could not print.
    expect(report.authorable.length).toBeGreaterThan(0);
    // And no pending row claims a debt for a type the denominator does not hold:
    // before the union landed, recording one of the unregistered kinds here would
    // have been reported STALE rather than pending.
    expect(report.stalePending).toEqual([]);
  });

  it('prints the denominator and its composition on EVERY run, green included', () => {
    const { status, output } = runGate();
    expect(status, output).toBe(0);
    const line = output.split('\n').find((l) => l.startsWith('governance denominator:')) ?? '';
    // The line used to print only when `PENDING_GOVERNANCE` was non-empty, so the
    // one state worth reporting — "N types looked at, none unaccounted for" —
    // rendered as nothing at all: the same silence an unseen type produces.
    expect(line, output).not.toBe('');
    expect(line).toMatch(/^governance denominator: \d+ authorable type\(s\) — \d+ registered kind\(s\) \+ \d+ unregistered-kind stack collection\(s\)/);
    for (const kind of listUnregisteredKindSchemaTypes()) expect(line).toContain(kind);
  });

  // #6245's guarantee, asserted from the gate that had the motive to break it.
  // The repair for #18133 belongs in this gate's own denominator; enrolling the
  // unregistered kinds in the registry instead would have granted them a KIND
  // status (`MetadataTypeSchema` enum membership, a `DEFAULT_METADATA_TYPE_REGISTRY`
  // entry, a create seed, a place in the #4001 campaign count) that #6245 and
  // #2657's still-open B/C decision deliberately withhold.
  it('reads the unregistered kinds WITHOUT registering them', () => {
    const registered = listMetadataTypeSchemaTypes();
    for (const kind of listUnregisteredKindSchemaTypes()) {
      expect(registered, `#6245: '${kind}' must not become a registered KIND just because a `
        + 'check needs to enumerate it — listUnregisteredKindSchemaTypes() (#6931) exists so '
        + 'that enumeration costs nothing').not.toContain(kind);
    }
    const src = readFileSync(GATE, 'utf8');
    expect(src).toContain('listUnregisteredKindSchemaTypes');
  });
});


// ── THE TOMBSTONE JOIN (#19062) ──
//
// Same harness and the same #5623 reason as every block above: the grading
// lives in check-liveness.mts, so only a real run can say whether a finding
// class reaches `process.exit(1)`.
//
// This block needs its red/green pair MORE than its neighbours, not less. The
// rule's whole population on the shipped ledgers is rows that are ALREADY
// correct — the one offender that existed when the rule was written (#18304's
// `agent/tools`) was repaired by #19059 while this branch was open — so a green
// `check:liveness` cannot distinguish "the rule holds" from "the rule never
// ran". The pair is what makes it an answer.
//
// WHY THE CARRIER IS DERIVED AND NOT NAMED. The first draft of this block named
// two rows: it flipped `agent/tools` to `dead` to neutralise the then-offender,
// and flipped `hook/timeout` to `live` as the sample. The first of those broke
// within the day — `agent/tools` became `dead` upstream, the "this would be a
// no-op" guard fired, and four cases went red. The guard was right and is kept
// below; what was wrong was pinning a fixture to one row's CURRENT VERDICT,
// which is a moving fact about the ledger and not a property of the rule. So
// the carrier is now derived, per run, from the gate's own `report.tombstones`
// enumeration, under filters that are properties of the SHAPE rather than of
// today's verdicts:
//
//   · top-level — `setCarrierStatus` edits `props[key]`, not a `children` path;
//   · not a BOUND_PROOF_PATHS coordinate — a bound class graded `live` demands
//     an ADR-0054 proof, which would give the red run a second cause;
//   · currently `dead` — the no-op guard, and the only status from which a flip
//     to `live` is a real state change.
//
// A carrier can still stop qualifying; what it can no longer do is stop
// qualifying SILENTLY, because the derivation asserts it found one and names
// the population it searched. And the neutralisation half is gone outright:
// these cases now inherit this file's existing, deliberate dependency on the
// shipped ledgers being green — the same dependency its very first control case
// ("is green against a verbatim copy of the shipped ledgers") already states —
// rather than carrying a private list of rows to paper over.

/** What the fixture writes into the carrier row, so a stray copy is traceable. */
const FIXTURE_NOTE = 'fixture row written by check-liveness.test.ts (#19062 block)';

/** The carrier the #19062 block flips, derived from the gate rather than named. */
interface Carrier {
  key: string;
  type: string;
  prop: string;
  /** How many tombstones the gate enumerated — the population searched. */
  enumerated: number;
  /** How many of them passed every filter — more than one means a real choice. */
  eligible: number;
}

/**
 * Move one unit between two status columns of a copied `state-counts/<type>.md`
 * shard. Its own row only: no file commits a total any more (#20361), so there
 * is no second line to keep in step.
 */
function moveCount(root: string, type: string, from: string, to: string): void {
  const fromCol = STATUS_COLUMNS.indexOf(from as (typeof STATUS_COLUMNS)[number]);
  const toCol = STATUS_COLUMNS.indexOf(to as (typeof STATUS_COLUMNS)[number]);
  expect(fromCol, `unknown status "${from}"`).toBeGreaterThanOrEqual(0);
  expect(toCol, `unknown status "${to}"`).toBeGreaterThanOrEqual(0);

  const countsFile = path.join(root, 'state-counts', `${type}.md`);
  let text = readFileSync(countsFile, 'utf8');
  // The generated count artifact is checked on every run, so a sample that
  // moves a verdict and leaves the counts behind goes red for the WRONG reason
  // and masks the verdict this block is reading.
  const rowRe = new RegExp(`^\\| \`${type}\` \\| (.+) \\|$`, 'm');
  const m = rowRe.exec(text);
  expect(m, `no state-counts row matching ${rowRe}`).not.toBeNull();
  const nums = m![1].split('|').map((c) => Number(c.trim()));
  expect(nums).toHaveLength(STATUS_COLUMNS.length + 1);
  nums[fromCol] -= 1;
  nums[toCol] += 1;
  const rebuilt = `${m![0].slice(0, m![0].indexOf('|', 1) + 1)} ${nums.join(' | ')} |`;
  text = text.slice(0, m!.index) + rebuilt + text.slice(m!.index + m![0].length);
  writeFileSync(countsFile, text);
}

describe('check:liveness — a tombstoned key may not be graded `live` (#19062)', () => {
  let tmp: string;
  let carrier: Carrier;

  // The one hook in this file that spawns the gate: it runs under the case budget
  // (GATE_BUDGET_MS, last argument), not vitest's 10 s `hookTimeout` default (#21421).
  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-tombstone-'));

    // The gate IS the instrument: asking it for its own enumeration means the
    // fixture and the rule can never disagree about what a tombstone is. Read
    // regardless of exit code — the JSON is written before `process.exit`, so a
    // red tree still yields a usable population.
    const { output } = runGate(undefined, ['--json']);
    const report = JSON.parse(output.slice(output.indexOf('{')));
    const enumerated: string[] = report.tombstones ?? [];

    const eligible = enumerated
      .filter((key) => !key.slice(key.indexOf('/') + 1).includes('.'))
      .filter((key) => !BOUND_PROOF_PATHS.has(key))
      .filter((key) => {
        const [type, prop] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
        const file = path.join(LEDGERS, `${type}.json`);
        if (!existsSync(file)) return false;
        return JSON.parse(readFileSync(file, 'utf8')).props?.[prop]?.status === 'dead';
      })
      .sort();

    const key = eligible[0] ?? '';
    carrier = {
      key,
      type: key.slice(0, key.indexOf('/')),
      prop: key.slice(key.indexOf('/') + 1),
      enumerated: enumerated.length,
      eligible: eligible.length,
    };
  }, GATE_BUDGET_MS);
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /**
   * Write the carrier row as a minimal `{ status, note }` in a copied ledger.
   *
   * Wholesale replacement rather than a status edit, so the red and green
   * samples differ in ONE value and nothing else: a retained `evidence` or
   * `proof` pointer would be scanned at `live` and unscanned at `dead`, which
   * is a second difference between the two legs and a second possible cause.
   */
  function sampleWith(name: string, status: string): string {
    const root = path.join(tmp, name);
    cpSync(LEDGERS, root, { recursive: true });
    const file = path.join(root, `${carrier.type}.json`);
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    const prev: string = ledger.props[carrier.prop].status;
    ledger.props[carrier.prop] = { status, note: FIXTURE_NOTE };
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);

    // Proof the edit reached disk. An editor's exit code is not evidence; the
    // read-back is.
    const written = JSON.parse(readFileSync(file, 'utf8')).props[carrier.prop].status;
    expect(written, `${carrier.key} did not take status "${status}" on disk`).toBe(status);

    if (status !== prev) moveCount(root, carrier.type, prev, status);
    return root;
  }

  // THE DERIVATION, asserted before anything is concluded from a run that
  // assumes it worked. An empty enumeration is the drifted-marker failure this
  // whole block exists to keep visible, and it must not read as "no work to do".
  it('derives its carrier from the gate\'s own tombstone enumeration', () => {
    expect(
      carrier.enumerated,
      'the gate enumerated NO tombstones — a scan reaching zero is a degraded scan, not a clean tree',
    ).toBeGreaterThan(0);
    expect(
      carrier.eligible,
      `no eligible carrier among ${carrier.enumerated} tombstone(s): a carrier must be top-level, unbound, and `
      + 'currently `dead` — already `live` would make the flip below a no-op and the red leg would prove nothing',
    ).toBeGreaterThan(0);
    expect(carrier.key, 'the derivation produced no carrier').toMatch(/^[a-z_]+\/[A-Za-z0-9_]+$/);
  });

  it('FAILS when a tombstoned key\'s ledger row claims `live`', () => {
    const root = sampleWith('tombstone-live', 'live');

    const { status, output } = runGate(root);
    // The defect itself, caught. Before this rule the same sample exited 0:
    // the forward pass was satisfied (the tombstone keeps the key in the walked
    // shape), the orphan pass was satisfied (the property is still there), and
    // nothing read the marker at all.
    expect(status, output).toBe(1);
    expect(output).toContain('✗ 1 TOMBSTONED key(s) whose ledger row still claims a forbidden status:');
    expect(output).toContain(`${carrier.key} -> "live"`);
    // The prescription travels with the finding, and rules out deleting the row.
    expect(output).toContain('Do NOT delete the row');
    // ONE cause. A second ✗ block would mean the carrier dragged another check
    // in with it, and the exit 1 above would no longer be this rule's.
    expect(output.split('\n').filter((l) => l.startsWith('✗')), output).toHaveLength(1);
  });

  // THE LIT CONTROL. Without it, the exit 1 above is equally explained by the
  // sample being unreadable, or by any other rule reddening on the same copy.
  it('is GREEN on the same sample with a legal status — one value apart', () => {
    const root = sampleWith('tombstone-dead', 'dead');

    const { status, output } = runGate(root);
    expect(status, output).toBe(0);
    expect(output).toContain('✓ every governed-type property');
    expect(output).toContain("no tombstoned key's row claims a status the tombstone forbids");
  });

  // …and "one value apart" is a claim about bytes, so it is checked as one
  // rather than asserted in prose. Everything outside the carrier's own status
  // and the arithmetic the count artifact requires must be identical.
  it('builds the red and green samples one value apart, and nothing else', () => {
    const red = sampleWith('apart-live', 'live');
    const green = sampleWith('apart-dead', 'dead');

    // Recursive: the counts are a directory of shards now (#20361), and a
    // top-level listing would read that directory as a file.
    const differing = (readdirSync(green, { recursive: true }) as string[])
      .filter((f) => statSync(path.join(green, f)).isFile())
      .filter((f) => readFileSync(path.join(green, f), 'utf8') !== readFileSync(path.join(red, f), 'utf8'));
    expect(differing.sort()).toEqual([`${carrier.type}.json`, path.join('state-counts', `${carrier.type}.md`)].sort());

    const redLedger = JSON.parse(readFileSync(path.join(red, `${carrier.type}.json`), 'utf8'));
    const greenLedger = JSON.parse(readFileSync(path.join(green, `${carrier.type}.json`), 'utf8'));
    expect(redLedger.props[carrier.prop].status).toBe('live');
    expect(greenLedger.props[carrier.prop].status).toBe('dead');
    redLedger.props[carrier.prop].status = 'dead';
    expect(redLedger).toEqual(greenLedger);
  });

  // THE DARK CONTROL. A rule that reddens honest rows is a different gate, not
  // a stricter one — so the ordinary, non-tombstoned `live` rows must keep the
  // verdict they had. Read off the carrier's own type, which carries both: the
  // tombstone under test and every live key beside it.
  it('leaves ordinary `live` rows alone — the per-type verdicts are unchanged', () => {
    const shipped = runGate();
    const sampled = runGate(sampleWith('tombstone-dark', 'dead'));
    expect(sampled.status, sampled.output).toBe(0);

    const verdict = (out: string) =>
      out.split('\n').filter((l) => /^ {2}[a-z_]+ +\d+ classified/.test(l));
    // Every type's verdict line, not just the carrier's: a tightening anywhere
    // in the walk would move one of these.
    expect(verdict(sampled.output)).toEqual(verdict(shipped.output));
    expect(verdict(sampled.output).length, sampled.output).toBeGreaterThan(0);
  });

  // NON-VACUITY. "0 forbidden" reads identically whether every row is honest or
  // the marker drifted and the scan reached nothing, so the gate prints the
  // population it asked on every run, pass or fail.
  it('reports how many tombstones it reached, not only how many were forbidden', () => {
    const { status, output } = runGate(sampleWith('tombstone-census', 'dead'));
    expect(status, output).toBe(0);
    const line = output.split('\n').find((l) => l.startsWith('tombstoned keys:')) ?? '';
    expect(line, 'the gate must publish the population it scanned').not.toBe('');
    const reached = Number(/^tombstoned keys: (\d+) /.exec(line)?.[1] ?? 0);
    expect(reached, 'a scan reaching zero tombstones is a degraded scan, not a clean tree').toBeGreaterThan(0);
    expect(reached, 'the printed population and the enumerated one are the same reading').toBe(carrier.enumerated);
    expect(line).toContain(`${reached} graded with a status the tombstone allows`);
    expect(line).not.toContain('FORBIDDEN');
  });
});

// ── #21127: a `live` row never opts into `authorWarn` ──
//
// The author-side lint (`packages/lint/src/lint-liveness-properties.ts`) picks
// the verdict it shows from a warned row's STATUS, and its `describe()` throws
// on `live` by design — so a warned `live` row turns `os validate` / `os lint`
// into exit 1 for every stack that authors the key. `mapping.connectorSource`
// shipped that row, a CONTAINER that drills into `children`, which is exactly
// the row the graded walk never reads. Every case runs the REAL gate via
// `--ledger-root`, for the #5623 reason the blocks above state.
//
// The carriers are derived from the shipped ledgers by SHAPE — a top-level
// `live` container row with `children`, and a `live` drilled child — never named,
// for the #19062 reason: a named row is a moving verdict. Adding `authorWarn:
// true` to a `live` row moves no status, so the count shards stay byte-identical
// and the red run has exactly one cause.

/** What a derived carrier is: a coordinate in one shipped ledger. */
interface WarnCarrier {
  type: string;
  /** `prop` or `prop.child` — the row the fixture marks. */
  path: string;
}

/** Every `(type, path)` the shipped ledgers carry with a given shape, sorted. */
function liveRows(shape: 'container' | 'child'): WarnCarrier[] {
  const out: WarnCarrier[] = [];
  for (const file of readdirSync(LEDGERS).filter((f) => f.endsWith('.json')).sort()) {
    const type = file.slice(0, -'.json'.length);
    const props: Record<string, any> = JSON.parse(readFileSync(path.join(LEDGERS, file), 'utf8')).props ?? {};
    for (const [prop, row] of Object.entries(props)) {
      if (shape === 'container' && row?.status === 'live' && row?.children && row?.authorWarn !== true) {
        out.push({ type, path: prop });
      }
      if (shape === 'child') {
        for (const [child, crow] of Object.entries<any>(row?.children ?? {})) {
          if (crow?.status === 'live' && !crow?.children && crow?.authorWarn !== true) {
            out.push({ type, path: `${prop}.${child}` });
          }
        }
      }
    }
  }
  return out;
}

describe('check:liveness — a `live` row may not opt into `authorWarn` (#21127)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'os-liveness-authorwarn-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /** Copy the shipped ledgers and mark one row `authorWarn: true`, read back from disk. */
  function sampleWarned(name: string, carrier: WarnCarrier): string {
    const root = path.join(tmp, name);
    cpSync(LEDGERS, root, { recursive: true });
    const file = path.join(root, `${carrier.type}.json`);
    const ledger = JSON.parse(readFileSync(file, 'utf8'));
    const [prop, child] = carrier.path.split('.');
    const row = child ? ledger.props[prop].children[child] : ledger.props[prop];
    row.authorWarn = true;
    writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
    // Proof the edit reached disk — an editor's exit code is not evidence.
    const back = JSON.parse(readFileSync(file, 'utf8')).props[prop];
    expect((child ? back.children[child] : back).authorWarn, `${carrier.type}/${carrier.path} not marked on disk`).toBe(true);
    return root;
  }

  // THE CONTROL, and the census. Green on a verbatim copy, and the line names
  // the population it asked: a `planned` row with `authorWarn` is the legal
  // shape (a consumer is being built — keep the key, it does nothing yet), so
  // the shipped ledgers carry some and the gate leaves them alone.
  it('is green on the shipped ledgers, which carry warned `planned` rows and no warned `live` one', () => {
    const { status, output } = runGate();
    expect(status, output).toBe(0);
    expect(output).toContain('no `live` row opts into an author warning');
    const line = output.split('\n').find((l) => l.startsWith('author warnings:')) ?? '';
    expect(line, 'the gate must publish the population it asked').not.toBe('');
    const reached = Number(/^author warnings: (\d+) /.exec(line)?.[1] ?? 0);
    expect(reached, 'a walk reaching zero warned rows is a degraded walk, not a clean tree').toBeGreaterThan(0);
    expect(line).toMatch(/\bplanned [1-9]\d*\b/);
    expect(line).toContain('; 0 on a `live` row.');
    expect(line).not.toContain('FORBIDDEN');
  });

  // The regression's own shape: a `live` CONTAINER row, whose status the graded
  // walk never reads because only its children are classified.
  it('FAILS when a `live` container row that drills into `children` opts in', () => {
    const [carrier] = liveRows('container');
    expect(carrier, 'no top-level `live` row with `children` in the shipped ledgers to carry the sample').toBeDefined();

    const { status, output } = runGate(sampleWarned('container', carrier));
    expect(status, output).toBe(1);
    expect(output).toContain('✗ 1 `live` ledger row(s) opt into `authorWarn` — the author-side lint throws on them:');
    expect(output).toContain(`    ${carrier.type}/${carrier.path}\n`);
    // The prescription travels with the finding, and rules out the wrong fix.
    expect(output).toContain('Do NOT teach `describe()` a `live` branch');
    // ONE cause: a second ✗ block would mean the sample dragged another check in.
    expect(output.split('\n').filter((l) => l.startsWith('✗')), output).toHaveLength(1);
  });

  // The lint reads a container's direct children too, and the walk goes to any
  // depth `children` nests — a drilled `live` row is the same crash.
  it('FAILS when a drilled `live` child row opts in', () => {
    const [carrier] = liveRows('child');
    expect(carrier, 'no drilled `live` child row in the shipped ledgers to carry the sample').toBeDefined();

    const { status, output } = runGate(sampleWarned('child', carrier));
    expect(status, output).toBe(1);
    expect(output).toContain(`    ${carrier.type}/${carrier.path}\n`);
    expect(output.split('\n').filter((l) => l.startsWith('✗')), output).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A hook that spawns the gate runs under the case budget (#21421)
//
// The cases above spawn the whole gate under `testTimeout`; a hook spawning the
// same gate defaults to `hookTimeout` (10 s), so a 5 to 9 s run had 1 to 5 s of
// margin and a loaded CI shard spent it — the `beforeAll` of the #19062 block
// timed out and its cases were skipped behind it. This reads THIS file's own
// source for every lifecycle hook whose callback reaches `spawnSync`, directly
// or through another function here, and holds each to `GATE_BUDGET_MS` as its
// timeout argument. Parsed rather than matched as text, so a hook is judged by
// its call, never by what a comment or this block's own prose happens to spell.
// ---------------------------------------------------------------------------
describe('check:liveness — a hook that spawns the gate carries the case budget (#21421)', () => {
  const HOOKS = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach']);
  const self = fileURLToPath(import.meta.url);
  const sf = ts.createSourceFile(self, readFileSync(self, 'utf8'), ts.ScriptTarget.Latest, true);

  const calleeOf = (n: ts.Node): string => (ts.isCallExpression(n) && ts.isIdentifier(n.expression) ? n.expression.text : '');
  const callsAny = (root: ts.Node, names: ReadonlySet<string>): boolean => {
    let hit = false;
    const walk = (n: ts.Node): void => {
      if (hit) return;
      if (names.has(calleeOf(n))) hit = true;
      else ts.forEachChild(n, walk);
    };
    walk(root);
    return hit;
  };

  // Every function in this file that reaches `spawnSync`, to a fixpoint.
  const bodies = new Map<string, ts.Node>();
  const collect = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) bodies.set(n.name.text, n.body);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
      && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      bodies.set(n.name.text, n.initializer.body);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const spawners = new Set(['spawnSync']);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, body] of bodies) {
      if (!spawners.has(name) && callsAny(body, spawners)) {
        spawners.add(name);
        grew = true;
      }
    }
  }

  const hooks: { hook: string; line: number; spawns: boolean; timeout: string | null }[] = [];
  const visit = (n: ts.Node): void => {
    if (HOOKS.has(calleeOf(n))) {
      const [fn, timeout] = (n as ts.CallExpression).arguments;
      hooks.push({
        hook: calleeOf(n),
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        spawns: fn !== undefined && callsAny(fn, spawners),
        timeout: timeout === undefined ? null : timeout.getText(sf),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  // The scan must be capable of finding something: a refactor that renames
  // `runGate` or the hooks would otherwise leave the next case green over nothing.
  it('sees the gate runner and this file\'s hooks', () => {
    expect(spawners.has('runGate'), 'the scan no longer recognises runGate as reaching spawnSync').toBe(true);
    expect(hooks.length, 'the scan found no lifecycle hook in this file').toBeGreaterThan(0);
  });

  it('every hook whose callback reaches the gate passes GATE_BUDGET_MS as its timeout', () => {
    const unbudgeted = hooks
      .filter((h) => h.spawns && h.timeout !== 'GATE_BUDGET_MS')
      .map((h) => `${h.hook} at line ${h.line}: timeout argument ${h.timeout ?? 'absent (vitest hookTimeout default, 10 s)'}`);
    expect(
      unbudgeted,
      'a hook that spawns the gate must run under the case budget — pass GATE_BUDGET_MS as its second argument',
    ).toEqual([]);
  });

  it('GATE_BUDGET_MS is not below the testTimeout vitest.config.ts gives the cases', () => {
    const config = readFileSync(path.join(SPEC, 'vitest.config.ts'), 'utf8');
    const budgets = [...config.matchAll(/\btestTimeout:\s*([\d_]+)/g)].map((m) => Number((m[1] ?? '').replaceAll('_', '')));
    expect(budgets.length, 'no testTimeout found in vitest.config.ts').toBeGreaterThan(0);
    expect(GATE_BUDGET_MS, `vitest.config.ts testTimeout values: ${budgets.join(', ')}`).toBeGreaterThanOrEqual(Math.max(...budgets));
  });
});
