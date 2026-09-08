// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16559] The machine-readable half of a resume failure is declared ONCE in
 * `packages/spec` and reused by the approval carriers — the contract half of
 * the #16472 family ruling (maintainer 2026-09-07, decision batch #76).
 *
 * The ruling: a resume failure told to the caller is told as a registered
 * error code, the `runId` of the run that is actually stranded, and
 * `repairable`; the door's status code does not move, so a success answer
 * carries the failure behind it as an optional, additive member. The
 * structure is `ResumeFailureReport` (`contracts/approval-service.ts`), and
 * it is NOT a second declaration: its shared members are inherited from
 * `ResumeFailureDetails` (`api/automation-api.zod.ts`, the automation resume
 * door's `400 FLOW_FAILED` details — the ruling's third carrier, #15221), and
 * it adds exactly the one member a success envelope cannot leave to its
 * envelope, the code.
 *
 * Four things are pinned, because each drifts on its own:
 *
 *  1. **Declared once.** `ResumeFailureReport` minus `code` IS
 *     `ResumeFailureDetails` — a type-level identity (`Eq`, the
 *     `automation-result-status.pin.test.ts` form), so a member added to or
 *     dropped from either side reds this file by name under
 *     `check:test-typecheck`, which compiles it. And at runtime the wire
 *     schema PARSES a report and hands the three shared members back out —
 *     the "reused by the carriers" claim, measured rather than asserted.
 *  2. **Both approval carriers carry it, optionally.** `ApprovalRecallResult`
 *     and `ApprovalDecisionResult` declare `resumeFailure?: ResumeFailureReport`
 *     — the exact optional shape, so a carrier that makes it required (which
 *     would make every pre-ruling producer a type error) or drops it reds here.
 *  3. **No new code is minted.** `code` is `ErrorCode`, the ADR-0112
 *     vocabulary, and it is REQUIRED: an unregistered spelling is refused at
 *     compile time (`@ts-expect-error`, real because this file is compiled),
 *     and the codes the docblock names as examples are registered in the
 *     ledger today, so the prose cannot outlive the ledger.
 *  4. **The absence rule and the retired predicate, in the prose.** The
 *     card's acceptance is a docblock that makes the absence rule explicit
 *     ("an absent member must never be readable as not stranded") and a
 *     `resumeError` docblock that no longer asserts "when `resumed` is
 *     false" — batch #76 made `resumed: true` plus a carried failure a legal
 *     shape. Prose is unassertable except by reading it, so the contract
 *     source is read: both `resumeFailure` docblocks must carry the absence
 *     sentence, both widened `resumeError` docblocks must say presence is
 *     decided by the telling and not by `resumed`, and the retired predicate
 *     must be gone from the file.
 *
 * ⛔ Not pinned, deliberately: anything about `StrandedDecisionDetails`
 * (`@objectstack/types`, the ERROR-envelope carrier of #13807) — a different
 * package, a different envelope, and the ruling leaves it as it is — and
 * anything a producer does: no producer lives in spec, and the three
 * consumer cards (#15556, #15970, #15221) each keep their own pins.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { ResumeFailureDetailsSchema } from '../api/automation-api.zod';
import type { ResumeFailureDetails } from '../api/automation-api.zod';
import { REGISTERED_ERROR_CODES } from '../api/error-code-ledger.zod';
import type { ErrorCode } from '../api/error-code-ledger.zod';

import type {
  ApprovalDecisionResult,
  ApprovalRecallResult,
  ResumeFailureReport,
} from './approval-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

/**
 * Exported deliberately — an unread alias inside a test body is TS6196, and a
 * pin no program compiles is no pin at all (`check:test-typecheck` compiles
 * this file under `tsconfig.test.json`).
 */
/** 1. Declared once: the report minus its code IS the wire schema's input type. */
export type ReportSharesTheWireMembers = Assert< Eq< Omit<ResumeFailureReport, 'code'>, ResumeFailureDetails > >;
/** 3. The code member is the ledger vocabulary, exactly. */
export type CodeIsTheLedgerVocabulary = Assert< Eq< ResumeFailureReport['code'], ErrorCode > >;
/** 3. …and it is required — `undefined` is not a member of its type. */
export type CodeIsRequired = Assert< Eq< undefined extends ResumeFailureReport['code'] ? true : false, false > >;
/** 2. Both carriers declare the member at the exact optional shape. */
export type RecallCarriesTheReport = Assert< Eq< ApprovalRecallResult['resumeFailure'], ResumeFailureReport | undefined > >;
export type DecisionCarriesTheReport = Assert< Eq< ApprovalDecisionResult['resumeFailure'], ResumeFailureReport | undefined > >;

/** The codes the report's docblock names as examples; their registration is measured below. */
const DOCUMENTED_EXAMPLE_CODES = ['RESUME_FAILED', 'RESUME_TARGET_LOST', 'RESUME_IN_PROGRESS'] as const satisfies readonly ErrorCode[];

/** A complete report, the shape a consumer card produces on a success answer. */
const strandedParent: ResumeFailureReport = {
  code: 'RESUME_FAILED',
  runId: 'run_parent_001',
  status: 'stranded',
  repairable: true,
};

/** 3. An unregistered code is refused at compile time — no new code is minted here. */
export const unmintedCodeIsRefused: ResumeFailureReport = {
  // @ts-expect-error — `FLOW_STRANDED` is not in the ADR-0112 ledger; the ruling forbids minting it here.
  code: 'FLOW_STRANDED',
  runId: 'run_parent_001',
  repairable: true,
};

const CONTRACT_SOURCE = readFileSync(
  fileURLToPath(new URL('./approval-service.ts', import.meta.url)),
  'utf8',
);

/** The docblock of one optional member, by member name, from the contract source. */
function docblockOf(iface: string, member: string): string {
  const start = CONTRACT_SOURCE.indexOf(`export interface ${iface} {`);
  expect(start, `interface ${iface} is declared`).toBeGreaterThanOrEqual(0);
  const end = CONTRACT_SOURCE.indexOf('\n}\n', start);
  const body = CONTRACT_SOURCE.slice(start, end);
  const memberAt = body.indexOf(`\n  ${member}?:`);
  expect(memberAt, `${iface}.${member} is declared optional`).toBeGreaterThanOrEqual(0);
  const docStart = body.lastIndexOf('/**', memberAt);
  expect(docStart, `${iface}.${member} carries a docblock`).toBeGreaterThanOrEqual(0);
  return body.slice(docStart, memberAt);
}

describe('[#16559] ResumeFailureReport — the resume failure a success answer carries (batch #76)', () => {
  it('1. the wire schema parses a report and hands the three shared members back out (declared once, measured)', () => {
    // A strip-mode object drops undeclared keys silently and would parse
    // anything — so parse success alone proves nothing; the shared values
    // must come back out, and `code` (the member this structure ADDS) must
    // be the only thing the wire schema does not know.
    const parsed = ResumeFailureDetailsSchema.parse(strandedParent);
    expect(parsed).toEqual({ runId: 'run_parent_001', status: 'stranded', repairable: true });
    expect(Object.keys(strandedParent).sort()).toEqual([...Object.keys(parsed), 'code'].sort());
  });

  it('1. the wire schema keeps refusing what the report refuses — repairable is required, status is the two terminal failures', () => {
    // Anti-vacuity for the identity above: the inherited members carry the
    // wire schema's constraints, not merely its names.
    expect(ResumeFailureDetailsSchema.safeParse({ code: 'RESUME_FAILED', runId: 'run_1' }).success).toBe(false);
    expect(ResumeFailureDetailsSchema.safeParse({ code: 'RESUME_FAILED', runId: 'run_1', status: 'paused', repairable: false }).success).toBe(false);
    expect(ResumeFailureDetailsSchema.safeParse({ code: 'RESUME_TARGET_LOST', runId: 'run_1', repairable: false }).success).toBe(true);
  });

  it('3. every code the docblock names as an example is registered in the ledger today', () => {
    expect(DOCUMENTED_EXAMPLE_CODES.length).toBeGreaterThan(0);
    for (const code of DOCUMENTED_EXAMPLE_CODES) {
      expect(REGISTERED_ERROR_CODES, `${code} is a registered code`).toContain(code);
    }
    // The compile-time refusal above is the real pin; this is its runtime
    // shadow, so a ledger that gains `FLOW_STRANDED` is noticed here by name.
    expect(REGISTERED_ERROR_CODES).not.toContain('FLOW_STRANDED');
  });

  it('4. both `resumeFailure` docblocks make the absence rule explicit', () => {
    for (const iface of ['ApprovalRecallResult', 'ApprovalDecisionResult']) {
      const doc = docblockOf(iface, 'resumeFailure');
      expect(doc, `${iface}.resumeFailure states that absence is not a reading`)
        .toContain('An absent member means no report was made');
      expect(doc, `${iface}.resumeFailure states what absence must never mean`)
        .toContain('never that no run is stranded');
    }
  });

  it('4. both widened `resumeError` docblocks say presence is decided by the telling, not by `resumed`', () => {
    for (const iface of ['ApprovalRecallResult', 'ApprovalDecisionResult']) {
      const doc = docblockOf(iface, 'resumeError');
      expect(doc, `${iface}.resumeError is no longer gated on resumed`)
        .toContain('never by `resumed`');
      expect(doc, `${iface}.resumeError names its machine-readable half`)
        .toContain('{@link resumeFailure}');
    }
  });

  it('4. the retired predicate is gone from the contract file', () => {
    // Batch #76 made `resumed: true` plus a carried failure a legal shape, so
    // the sentence "when `resumed` is false" is false wherever it appears.
    // The search is over the FILE, not the four sites the card listed — the
    // card's own warning (seat #6021 correction 85).
    expect(CONTRACT_SOURCE).not.toMatch(/when `resumed` is false/);
    expect(CONTRACT_SOURCE).not.toMatch(/when resumed is false/);
    // Anti-vacuity: the file still declares the members the predicate was about.
    expect(CONTRACT_SOURCE.match(/\n  resumeError\?: string;/g)?.length).toBe(4);
    expect(CONTRACT_SOURCE.match(/\n  resumeFailure\?: ResumeFailureReport;/g)?.length).toBe(2);
  });
});
