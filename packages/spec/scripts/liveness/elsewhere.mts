// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `live-elsewhere` — the fifth liveness verdict, and its executable criteria (#13483).
//
// WHY THIS STATUS EXISTS. `manifest.runtime` is dead HERE by measurement — the
// only local reads are two CLI lines that echo the value — and genuinely
// enforced in the closed cloud repo: the marketplace publish gate hard-rejects
// (HTTP 422) an unverified publisher requesting the `node` tier (#12400,
// measured 2026-08-29 on cloud @15f55df). Neither existing verdict can say
// that. `dead` is true only of the local half — read alone it licenses deleting
// a key with a real cross-repo consumer, and the maintainer ruling of
// 2026-08-30 (#11330) explicitly ruled that deletion OUT. `live` is refused by
// the gate itself: a live verdict's repo-local evidence must resolve against
// this checkout, and cloud's enforcer is not local. The stopgap was a
// qualifying sentence in the row's `note` — prose, which no check reads, i.e.
// the weakest protection this ledger knows. So: a status that SAYS the split —
// dead here, enforced there — and reads as NOT deletable.
//
// THE HARD CONSTRAINT (the card's own): check-liveness.mts deliberately forces
// a decision on unknown statuses rather than defaulting, so a fifth status must
// carry criteria the gate can EXECUTE — otherwise it just replaces `dead`'s lie
// with an unverified label. The gate cannot resolve another repo's file (that
// boundary is deliberate and load-bearing — see evidence.mts), so the
// executable surface is everything about the claim EXCEPT the foreign file's
// content:
//
//   1. FOREIGN POINTER — the `evidence` string must attribute at least one
//      path to a foreign realm (`cloud: packages/…/file.ts#symbol` — the
//      realm-marker grammar evidence.mts already machine-reads). A
//      live-elsewhere verdict IS a pointer at another repo's enforcer; an entry
//      with no such pointer is the unverified label the constraint names.
//   2. DECLARED SCOPE — `evidenceScope` must be `"cross-repo"`. The verdict is
//      a cross-repo claim by definition; an `in-repo` or absent scope asserts
//      elsewhere-ness that no look ever covered.
//   3. DATED ATTESTATION — `verifiedAt` must be present. For every other
//      status an absent date is a worklist row, because the file/line/symbol/
//      key-mention checks keep watching the cited code; for THIS status no
//      local check can ever observe the foreign consumer rot, so an undated
//      claim would be unfalsifiable forever.
//   4. EXPIRY — the attestation must be younger than the window below. Age is
//      a worklist everywhere else in this ledger and a MERGE GATE here, for
//      the reason in 3: expiry is the only mechanical event this repo can
//      generate about a claim it cannot re-measure.
//
// THE RE-VERIFICATION DISCIPLINE those criteria implement: `verifiedAt` on a
// live-elsewhere row records the date somebody with access to the named repo
// actually RE-READ the enforcer (the measured precedent: #10812 read cloud
// @5b5925a on 2026-08-24; #12400 read cloud @15f55df on 2026-08-29 — pin the
// foreign commit in the evidence prose, house style since `action.undoable`).
// This repo's CI never reads the foreign repo — reachability is measured to be
// seat-dependent (`add_repo` denied from some seats, the two readings above
// from others) — so the gate enforces the SHAPE and the CLOCK, and the
// re-reading itself happens wherever access exists. ⛔ Never re-stamp
// `verifiedAt` without re-reading the foreign enforcer: that is exactly the
// "trust the prose note" downgrade this status exists to end. When the window
// closes and nobody with access has re-attested, the gate goes red and STAYS
// red — that red is the escalation: either a fresh reading lands, or the
// maintainer re-rules the row (needs-user-decision), or the verdict
// re-classifies. Trust is time-boxed, never institutional.

import { scanEvidence } from './evidence.mts';
import { DEFAULT_STALE_DAYS, parseVerifiedAt, verificationAgeDays } from './verification.mts';

/** The status string a ledger row carries. */
export const LIVE_ELSEWHERE_STATUS = 'live-elsewhere';

/**
 * How old a live-elsewhere attestation may grow before the gate fails demanding
 * a re-reading. Deliberately the SAME number as the ledger-wide staleness
 * worklist threshold (`DEFAULT_STALE_DAYS`): "how fresh is fresh" stays decided
 * in exactly one place, and what differs per status is the CONSEQUENCE — a
 * worklist row where mechanical checks keep watching the citation, a merge gate
 * where nothing can.
 */
export const ELSEWHERE_MAX_AGE_DAYS = DEFAULT_STALE_DAYS;

/** The ledger fields the criteria read, plus the coordinate for messages. */
export interface ElsewhereEntry {
  /** `<type>/<propPath>` — the ledger coordinate. */
  key: string;
  evidence?: unknown;
  evidenceScope?: unknown;
  verifiedAt?: unknown;
}

export interface ElsewhereCheck {
  /**
   * Criteria 1–3: the row's SHAPE never carried the claim — no foreign-attributed
   * path, wrong or missing scope, no attestation date. The repair is writing the
   * entry the status requires.
   */
  malformed: string[];
  /**
   * Criterion 4: the row was well-formed and its attestation TIMED OUT. The
   * repair is a re-reading (by someone with access to the named repo), a
   * maintainer re-ruling, or a re-classification — never a bare re-stamp.
   */
  expired: string[];
}

/**
 * Execute the live-elsewhere criteria against one ledger row. Pure — `now` is
 * injected so the gate, the tests, and any future sweep see the same arithmetic
 * (the `buildVerificationReport` contract, one status over).
 *
 * A MALFORMED `verifiedAt` is deliberately NOT reported here: the verification
 * report already fails the gate on it for every status, and reporting one rot
 * twice under two headings teaches a reader to discount both lists (the
 * `lineCountOf` contract in check-liveness.mts). Absent is this check's to
 * catch, because for every OTHER status absent is legal.
 */
export function checkElsewhereEntry(
  entry: ElsewhereEntry,
  { now = new Date(), maxAgeDays = ELSEWHERE_MAX_AGE_DAYS }: { now?: Date; maxAgeDays?: number } = {},
): ElsewhereCheck {
  const malformed: string[] = [];
  const expired: string[] = [];

  // 1. FOREIGN POINTER — at least one path attributed to another realm.
  const foreign = typeof entry.evidence === 'string' ? scanEvidence(entry.evidence).foreign : [];
  if (foreign.length === 0) {
    malformed.push(
      `${entry.key} → cites no foreign-attributed path — a live-elsewhere verdict IS a pointer at ` +
      'another repo\'s enforcer; name it with a realm marker (`cloud: packages/…/file.ts#symbol`) ' +
      'and pin the foreign commit in the prose',
    );
  }

  // 2. DECLARED SCOPE — the claim is cross-repo by definition.
  if (entry.evidenceScope !== 'cross-repo') {
    malformed.push(
      `${entry.key} → evidenceScope is ${entry.evidenceScope === undefined ? 'undeclared' : JSON.stringify(entry.evidenceScope)} ` +
      '— a live-elsewhere verdict is a cross-repo claim by definition; declare "cross-repo" ' +
      '(and mean it: the scope records that the named realm was actually walked)',
    );
  }

  // 3 + 4. DATED ATTESTATION, and its EXPIRY.
  if (entry.verifiedAt === undefined) {
    malformed.push(
      `${entry.key} → carries no verifiedAt — no local check can ever observe the foreign consumer ` +
      'rot, so an undated live-elsewhere claim is unfalsifiable forever; date the reading that ' +
      'closed the foreign call graph',
    );
  } else {
    const parsed = parseVerifiedAt(entry.verifiedAt, now);
    // Malformed → the verification report owns that verdict (see the doc above).
    if (parsed.ok) {
      const ageDays = verificationAgeDays(parsed.date, now);
      if (ageDays > maxAgeDays) {
        expired.push(
          `${entry.key} → attested ${String(entry.verifiedAt)} (${ageDays}d ago; the window is ${maxAgeDays}d)`,
        );
      }
    }
  }

  return { malformed, expired };
}

/** The prescription printed under a shape failure (criteria 1–3). */
export const ELSEWHERE_GUIDANCE = [
  'A live-elsewhere verdict says: dead HERE by measurement, genuinely enforced in a',
  'sibling repo. The gate cannot resolve another repo\'s file — that boundary is',
  'deliberate — so what it holds instead is the SHAPE of the claim: a foreign-realm',
  'pointer at the enforcer (`cloud: packages/…/file.ts#symbol`, foreign commit pinned',
  'in the prose), `"evidenceScope": "cross-repo"`, and a dated attestation',
  '(`verifiedAt` = the day someone with access actually read the enforcer). An entry',
  'missing any of these is not a verdict, it is a label nothing can falsify — the',
  'exact thing this status exists to replace the qualifying-note stopgap with.',
  '',
  '⛔ Do not satisfy this from memory or from the row\'s own note. The evidence for',
  '"enforced there" is a reading of THAT repo, by a seat that can reach it.',
];

/** The prescription printed under an expired attestation (criterion 4). */
export const ELSEWHERE_EXPIRED_GUIDANCE = [
  'The attestation timed out. Everywhere else in this ledger, age is a worklist —',
  'the file/line/symbol/key-mention checks keep watching the cited code between',
  're-verifications. A live-elsewhere claim has no such watcher: nothing in this',
  'repo can observe the foreign enforcer rot, so expiry is the one mechanical event',
  'this repo can generate about it, and it is a merge gate on purpose.',
  '',
  'Three repairs, and the first is the normal one:',
  '  • RE-ATTEST — someone with access to the named repo re-reads the enforcer at',
  '    its current head, updates the evidence (new commit pin, repaired path/symbol',
  '    if it moved) and re-stamps `verifiedAt` with the reading\'s date. ⛔ Never',
  '    re-stamp without re-reading — that is the "trust the prose" downgrade this',
  '    status exists to end.',
  '  • the enforcer is GONE from the foreign repo → the verdict is not',
  '    live-elsewhere any more; re-classify (usually `dead`) under ADR-0049',
  '    enforce-or-remove, with the reading as evidence.',
  '  • nobody with access can be found before the window closes → this red IS the',
  '    escalation: the row returns to the maintainer (needs-user-decision) to rule',
  '    whether an unverifiable pointer still counts as evidence. Do not silence it',
  '    by widening the window or re-stamping the date.',
];
