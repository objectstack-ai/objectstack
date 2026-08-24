// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * #11286 — CONTRACT: the two `managerIsProvablyOutsideOrg` screens are EQUAL.
 *
 * `sys_user.manager_id` is read by two packages, and each screens the manager
 * it finds against the caller's organization with its OWN implementation:
 *
 *   | package           | entry point                                   | screen                        |
 *   | ----------------- | --------------------------------------------- | ----------------------------- |
 *   | `plugin-approvals`| `ApprovalService.lookupManager` (#10153)       | private method, `this.engine`  |
 *   | `plugin-sharing`  | `TeamGraphService.managerOf`,                 | module function, engine param  |
 *   |                   | `BusinessUnitGraphService.managerOf` (#10231)  |                                |
 *
 * They share no code. The `plugin-sharing` one was written to mirror the
 * `plugin-approvals` one precisely BECAUSE a screen that differed between them
 * would route an approval one way and share a record the other — but nothing
 * enforced the mirroring, and three separate posture decisions live inside it:
 * the fail-open limb on an ABSENT tenancy fact, the "provably outside" shape
 * (rather than "must prove membership"), and reading `sys_member` at all
 * (`sys_user` is the global better-auth identity table and carries no
 * `organization_id`). Any one of them could be changed on one side alone,
 * silently. This file is the cross-referencing pin that says so out loud.
 *
 * ## What this file does NOT do
 *
 * ⛔ It does not remove the duplication. Collapsing the two into shared code is
 * a cross-package dependency decision — `plugin-approvals` does not depend on
 * `plugin-sharing` today, `plugin-sharing` deliberately does not re-export its
 * copy from the package index, and #7497 (does approver routing imply record
 * read visibility?) is open precisely on whether the two questions should
 * converge at all. Fusing the implementations would prejudge it. This file
 * PINS the duplication so that it cannot drift while that question is open;
 * the removal question stays open.
 *
 * ## What it asserts, and in which order
 *
 * Per fixture row, two assertions, parity FIRST so a failure attributes itself:
 *
 *   1. PARITY — the two screens return the same verdict for the same inputs.
 *      This is the contract. A failure here is a real divergence between two
 *      independent authorization screens and is not a test to be adjusted.
 *   2. VALUE — the agreed verdict is still the one both sources say it is.
 *      This catches the two drifting TOGETHER, which parity alone cannot see.
 *
 * `true` = "provably outside the organization" ⇒ drop the manager.
 * `false` = leave routing/sharing exactly as it was.
 *
 * The double PROJECTS `fields` and APPLIES `where`, deliberately: that is what
 * lets a verdict row stand in for a read-shape difference. A side that stopped
 * asking for `organization_id` reads `undefined` and fails open while the other
 * screens out (rows 6/8); a side that dropped the `user_id` predicate sees
 * another user's rows (row 5). `limit: 1000` is bracketed from both directions
 * by rows 19/20. No read shape is asserted DIRECTLY — that would be a wider pin
 * than the contract, so the recorded reads are logged as diagnostics only.
 */
import { describe, it, expect } from 'vitest';
import { ApprovalService } from './approval-service.js';
// [#11286] plugin-sharing's screen is reached by RELATIVE SOURCE PATH, and that
// is the only way in: it is deliberately NOT exported from that package's index
// (exporting it would hoist a security screen into another plugin's public API
// surface — the very decision this card is fenced out of), and the package's
// `exports` map publishes `.` only, so there is no subpath to import. The read
// escapes this package, so it is declared in `CROSS_PACKAGE_TEST_INPUTS` in
// scripts/check-cross-package-test-inputs.mjs and mirrored into the
// `@objectstack/plugin-approvals#test` `inputs` in turbo.json — without both,
// a change to the sharing screen would never re-run this pin.
import { managerIsProvablyOutsideOrg as sharingScreen } from '../../plugin-sharing/src/team-graph.js';

const MGR = 'u_mgr';
const OTHER_USER = 'u_other';
const ORG_A = 'org_a';

type FindReaction =
  | { kind: 'rows'; rows: Array<Record<string, unknown>> }
  | { kind: 'throw' }
  | { kind: 'undefined' }
  | { kind: 'null' };

interface RecordedRead {
  object: string;
  where: unknown;
  fields: unknown;
  limit: unknown;
}

/**
 * Flat equality only — and it REFUSES anything else rather than reading a
 * combinator as a field name (`pnpm check:where-matcher`). A double looser than
 * the engine it stands in for turns a green suite into no suite, which is the
 * same failure its sibling gate `check:engine-double-contract` exists for.
 *
 * Both screens under test issue exactly one predicate, `{ user_id: managerId }`,
 * so a combinator arriving here means a screen's READ SHAPE changed and this
 * fixture has stopped modelling it. The refusal is recorded before it is thrown
 * because both screens wrap their read in `catch { return false }` — a bare
 * throw would be swallowed into a fail-open verdict on BOTH sides, so parity
 * would stay green while the fixture quietly stopped asserting anything. The
 * caller asserts the collector is empty.
 */
function matchesWhere(row: Record<string, unknown>, where: unknown, refusals: string[]): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
    if (k.startsWith('$')) {
      const msg =
        `[fixture] this double implements flat equality only and cannot answer the `
        + `'${k}' combinator. A screen under test changed its read shape — update the `
        + `double deliberately rather than letting it guess (#11286).`;
      refusals.push(msg);
      throw new Error(msg);
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function project(row: Record<string, unknown>, fields: unknown): Record<string, unknown> {
  if (!Array.isArray(fields) || fields.length === 0) return { ...row };
  const out: Record<string, unknown> = {};
  for (const f of fields) if (String(f) in row) out[String(f)] = row[String(f)];
  return out;
}

/**
 * A `find`-only engine double. The screens under test read exactly one object
 * (`sys_member`) and perform no writes, so this double has no write verbs to
 * pin against `assertEngineDeleteDispatch` / `assertEngineUpdateDispatch`
 * (`pnpm check:engine-double-contract`) — a write verb it does not have cannot
 * be looser than the real engine's. Any read of a DIFFERENT object is recorded
 * and answered with `[]`, so an off-target read shows up in the diagnostics
 * rather than being silently served the fixture.
 */
function makeMemberEngine(reaction: FindReaction, reads: RecordedRead[], refusals: string[]) {
  return {
    async find(object: string, options?: Record<string, unknown>) {
      reads.push({
        object,
        where: options?.where ?? options?.filter,
        fields: options?.fields,
        limit: options?.limit,
      });
      if (object !== 'sys_member') return [];
      if (reaction.kind === 'throw') throw new Error('[fixture] sys_member unreadable');
      if (reaction.kind === 'undefined') return undefined as unknown as unknown[];
      if (reaction.kind === 'null') return null as unknown as unknown[];
      const matched = reaction.rows.filter((r) => matchesWhere(r, options?.where ?? options?.filter, refusals));
      const limit = typeof options?.limit === 'number' ? (options.limit as number) : matched.length;
      return matched.slice(0, limit).map((r) => project(r, options?.fields));
    },
  };
}

const rows = (...list: Array<Record<string, unknown>>): FindReaction => ({ kind: 'rows', rows: list });
const member = (user: string, org: unknown, id = `m_${user}_${String(org)}`) => ({
  id,
  user_id: user,
  organization_id: org,
  role: 'member',
});

/**
 * `total` membership rows for the manager, all in throwaway organizations
 * except ONE at `callerOrgIndex`, which is the caller's. Placing that row
 * INSIDE and then OUTSIDE the declared `limit: 1000` brackets the limit from
 * both directions: a narrower limit flips row 19, a wider one flips row 20.
 */
function bulkRows(callerOrgIndex: number, total = 1200): FindReaction {
  const list: Array<Record<string, unknown>> = [];
  for (let i = 0; i < total; i++) {
    list.push(member(MGR, i === callerOrgIndex ? ORG_A : `org_bulk_${i}`, `m_bulk_${i}`));
  }
  return { kind: 'rows', rows: list };
}

interface MatrixRow {
  id: string;
  name: string;
  org: string | null | undefined;
  reaction: FindReaction;
  /** The verdict BOTH sources say this row produces. */
  expected: boolean;
}

/**
 * The fixture matrix. Every row's `expected` was derived by reading both
 * implementations before this file was first run, not by recording what they
 * did — see the PR body for the written-first prediction table.
 */
const MATRIX: MatrixRow[] = [
  // ── no organization in play ⇒ nothing to screen against, and no read ──────
  { id: 'R1', name: 'organization argument undefined', org: undefined, reaction: rows(member(MGR, 'org_b')), expected: false },
  { id: 'R2', name: 'organization argument null', org: null, reaction: rows(member(MGR, 'org_b')), expected: false },
  { id: 'R3', name: 'organization argument empty string', org: '', reaction: rows(member(MGR, 'org_b')), expected: false },

  // ── ABSENT tenancy fact ⇒ fail open (the ruled posture, #10153) ───────────
  { id: 'R4', name: 'sys_member holds no rows at all', org: ORG_A, reaction: rows(), expected: false },
  { id: 'R5', name: 'sys_member holds rows for ANOTHER user only (pins the user_id predicate)', org: ORG_A, reaction: rows(member(OTHER_USER, 'org_b')), expected: false },
  { id: 'R10', name: 'his only row carries organization_id null', org: ORG_A, reaction: rows(member(MGR, null)), expected: false },
  { id: 'R11', name: 'his only row carries organization_id empty string', org: ORG_A, reaction: rows(member(MGR, '')), expected: false },
  { id: 'R14', name: 'the membership read THROWS', org: ORG_A, reaction: { kind: 'throw' }, expected: false },
  { id: 'R15', name: 'the membership read returns undefined', org: ORG_A, reaction: { kind: 'undefined' }, expected: false },
  { id: 'R16', name: 'the membership read returns null', org: ORG_A, reaction: { kind: 'null' }, expected: false },

  // ── tenancy fact PRESENT and NEGATIVE ⇒ screen out ────────────────────────
  { id: 'R6', name: 'his only membership is in another organization', org: ORG_A, reaction: rows(member(MGR, 'org_b')), expected: true },
  { id: 'R7', name: 'memberships in two other organizations, none here', org: ORG_A, reaction: rows(member(MGR, 'org_b'), member(MGR, 'org_c')), expected: true },
  { id: 'R12', name: 'a null row plus a real cross-org row (the real fact survives)', org: ORG_A, reaction: rows(member(MGR, null), member(MGR, 'org_b')), expected: true },

  // ── tenancy fact PRESENT and POSITIVE ⇒ route as before ───────────────────
  { id: 'R8', name: 'he is a member of the caller organization', org: ORG_A, reaction: rows(member(MGR, ORG_A)), expected: false },
  { id: 'R9', name: 'he is a member here AND elsewhere', org: ORG_A, reaction: rows(member(MGR, 'org_b'), member(MGR, ORG_A)), expected: false },
  { id: 'R13', name: 'a null row plus a caller-org row', org: ORG_A, reaction: rows(member(MGR, null), member(MGR, ORG_A)), expected: false },

  // ── String() coercion of a non-string organization_id ─────────────────────
  { id: 'R17', name: 'numeric organization_id 7 matches the caller org "7"', org: '7', reaction: rows(member(MGR, 7)), expected: false },
  { id: 'R18', name: 'numeric organization_id 7 against caller org "8"', org: '8', reaction: rows(member(MGR, 7)), expected: true },

  // ── the declared `limit`, bracketed from both directions ──────────────────
  { id: 'R19', name: 'caller-org row at index 999 of 1200 — INSIDE limit 1000', org: ORG_A, reaction: bulkRows(999), expected: false },
  { id: 'R20', name: 'caller-org row at index 1100 of 1200 — OUTSIDE limit 1000', org: ORG_A, reaction: bulkRows(1100), expected: true },
];

function describeInputs(row: MatrixRow): string {
  const fixture =
    row.reaction.kind === 'rows'
      ? row.reaction.rows.length <= 3
        ? JSON.stringify(row.reaction.rows.map((r) => ({ user_id: r.user_id, organization_id: r.organization_id })))
        : `${row.reaction.rows.length} rows (bulk)`
      : `find() ${row.reaction.kind}`;
  return `organizationId=${JSON.stringify(row.org)} managerId=${JSON.stringify(MGR)} sys_member=${fixture}`;
}

describe('#11286 manager org screen parity — plugin-approvals vs plugin-sharing', () => {
  it('GUARD — both screens are reachable and callable', () => {
    expect(typeof sharingScreen).toBe('function');
    const svc = new ApprovalService({ engine: makeMemberEngine(rows(), [], []) as never });
    // Reached through `any` because it is a PRIVATE method — deliberately, and
    // this guard exists so that a rename on either side fails HERE with a
    // readable message instead of as a TypeError inside every row below.
    expect(typeof (svc as unknown as Record<string, unknown>).managerIsProvablyOutsideOrg).toBe('function');
  });

  for (const row of MATRIX) {
    it(`${row.id} — ${row.name}`, async () => {
      // A fresh double per side: the two screens must not be able to see each
      // other's reads, and each side's reads are recorded separately.
      const sharingReads: RecordedRead[] = [];
      const approvalsReads: RecordedRead[] = [];
      const refusals: string[] = [];
      const warns: string[] = [];

      const sharingVerdict: boolean = await sharingScreen(
        makeMemberEngine(row.reaction, sharingReads, refusals) as never,
        MGR,
        row.org,
      );

      const svc = new ApprovalService({
        engine: makeMemberEngine(row.reaction, approvalsReads, refusals) as never,
        logger: { warn: (m: string) => void warns.push(String(m)) } as never,
      });
      const approvalsVerdict: boolean = await (
        svc as unknown as { managerIsProvablyOutsideOrg(m: string, o?: string | null): Promise<boolean> }
      ).managerIsProvablyOutsideOrg(MGR, row.org);

      console.log(
        `[${row.id}] ${describeInputs(row)}\n`
        + `        plugin-sharing => ${sharingVerdict} (reads: ${JSON.stringify(sharingReads)})\n`
        + `        plugin-approvals => ${approvalsVerdict} (reads: ${JSON.stringify(approvalsReads)}, warns: ${warns.length})`,
      );

      // (0) The double refuses read shapes it does not model, and BOTH screens
      // swallow a throwing read into a fail-open `false`. So an unmodelled shape
      // would look like agreement. Assert it never happened, before reading the
      // verdicts at all.
      expect(
        refusals,
        `The fixture double REFUSED a read shape it does not model on ${row.id}, and both `
        + `screens swallowed it into a fail-open verdict. The verdicts below assert nothing. `
        + `Refusals: ${JSON.stringify(refusals)}`,
      ).toEqual([]);

      // (1) THE CONTRACT. A failure here is a genuine divergence between two
      // independent authorization screens over one column. It is not a fixture
      // to be adjusted, an assertion to be relaxed, or a winner to be picked —
      // it is a finding, and it belongs back with the maintainer (#7497 is the
      // open question about whether these two should converge at all).
      expect(
        approvalsVerdict,
        `PARITY BROKEN on ${row.id} (${row.name}).\n`
        + `  inputs: ${describeInputs(row)}\n`
        + `  plugin-sharing  managerIsProvablyOutsideOrg => ${sharingVerdict}\n`
        + `  plugin-approvals managerIsProvablyOutsideOrg => ${approvalsVerdict}\n`
        + `  The two screens over sys_user.manager_id have drifted. Do not fix this by\n`
        + `  editing the fixture: report both verdicts and these inputs (#11286).`,
      ).toBe(sharingVerdict);

      // (2) Both may still have drifted TOGETHER, which (1) cannot see.
      expect(
        sharingVerdict,
        `Both screens AGREE on ${row.id} but the agreed verdict moved: expected `
        + `${row.expected}, both now say ${sharingVerdict}. Inputs: ${describeInputs(row)}`,
      ).toBe(row.expected);
    });
  }
});
