// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Container coverage — the third direction of the liveness gate, and the one
// that let a key hide in plain sight.
//
// WHY THIS EXISTS. The gate classifies a property at ONE level. A container
// property (object / record / array-of-object) may be drilled via `children`;
// without one, the ledger README's rule is that "the top-level entry covers the
// whole subtree". That inheritance is invisible in three ways at once:
//
//   1. The entry looks complete. `{ "status": "live" }` on `dashboard.widgets`
//      reads as a finished classification, not as a blanket claim standing in
//      for 22 unexamined keys.
//   2. The COUNTS look complete. The gate credited `widgets` as ONE classified
//      property and the run printed "✓ all governed-type properties are
//      classified" — a sentence that was false for 562 child keys across the
//      tree, and the instrument said it every single run.
//   3. Nothing could contradict it. The entry's own `note` said "Per-widget
//      props live in the DashboardWidgetSchema subtree", and the file `_note`
//      repeated it — a claim about a subtree that has never existed in any of
//      the 28 ledger files. Prose cannot fail a build, so the gate had no
//      opinion, and every later reader (human and AI) inherited the claim.
//
// That is not hypothetical: `dashboard.widgets[].responsive` survived the #3896
// inert-key sweep that removed its sibling `widgets[].performance` and its
// literal namesake `view.responsive`. `view` is drilled through `children`, so
// `list.responsive` got a `dead` verdict and went out. `widgets` was not, so
// nobody was ever asked. The ledger could not say why it kept the key, because
// it had never had a verdict on it. It was finally retired in #4876/#4995 — on
// a hand measurement, four days late, and only because a human happened to
// notice the asymmetry. Filed as #4956.
//
// WHAT THIS FIXES, AND WHAT IT DELIBERATELY DOES NOT. Inheritance is a
// legitimate granularity — drilling all 65 container entries would mean
// inventing 562 per-key verdicts with no evidence behind them, which is the
// opposite of what this ledger is for (a fabricated `live` is worse than an
// honest coarse one). So inheritance stays legal and becomes DECLARED:
//
//   - Every container entry either drills (`children`) or is listed in
//     `undrilled-containers.baseline.json`, whose header says in plain words
//     that the listed subtrees are NOT classified. A container that is neither
//     FAILS, with the child keys it would be covering printed. New undrilled
//     surface can no longer arrive silently — the shape that made #4956.
//   - A baseline row whose entry now drills (or is no longer a container) also
//     FAILS. Same rot as an orphan ledger row, opposite direction: it claims a
//     gap that is already closed and overstates how much is left.
//   - The gate REPORTS the population every run and its success line stops
//     claiming completeness it does not have.
//
// The baseline is a shrink-only RATCHET, not an allowlist to grow — the same
// posture as PENDING_GOVERNANCE and the `scripts/*.baseline.json` files. Adding
// a row is a visible edit to a file named for the debt it records, which is the
// point: prose in a `note` cost nothing to write and could not be checked, and
// that asymmetry is exactly what this module removes.
//
// Two exclusions, both deliberate:
//   - ADR-0010 framework overlay fields (`protection`, `_lock*`, `_provenance`)
//     are auto-classified `live` by the gate and never consulted the ledger, so
//     they are outside this rule for the same reason they are outside the walk.
//   - A container with no ledger row at all already reports UNCLASSIFIED. This
//     rule only asks about entries the gate credited.

/** One container property the gate classified with a single blanket verdict. */
export interface ContainerCoverage {
  /** `<type>/<propPath>` — the ledger coordinate carrying the blanket verdict. */
  key: string;
  /** The child keys the walk can see under it — the surface the verdict silently covers. */
  childKeys: readonly string[];
}

export interface CoverageReconcileInput {
  /** Containers the walk observed riding on inheritance, in walk order. */
  observed: readonly ContainerCoverage[];
  /** Coordinates the baseline records as knowingly undrilled. */
  baseline: readonly string[];
}

export interface CoverageReconcileResult {
  /** Observed but NOT baselined — new undrilled surface. Fails the gate. */
  undeclared: ContainerCoverage[];
  /** Baselined but no longer observed — the debt is paid or the property moved. Fails the gate. */
  stale: string[];
  /** Child keys covered by inheritance across every baselined container — the real size of the gap. */
  inheritedChildKeys: number;
}

/**
 * Reconcile the containers the walk found against the recorded debt, in BOTH
 * directions. Pure — every Zod-walking detail stays in the gate, mirroring
 * `orphans.mts`, so this stays unit-testable against a tree that is (by
 * construction) fully reconciled and would otherwise prove nothing.
 */
export function reconcileContainerCoverage({
  observed,
  baseline,
}: CoverageReconcileInput): CoverageReconcileResult {
  const recorded = new Set(baseline);
  const seen = new Set(observed.map((o) => o.key));

  const undeclared = observed.filter((o) => !recorded.has(o.key));
  const stale = baseline.filter((k) => !seen.has(k)).sort();
  const inheritedChildKeys = observed
    .filter((o) => recorded.has(o.key))
    .reduce((n, o) => n + o.childKeys.length, 0);

  return { undeclared, stale, inheritedChildKeys };
}

/**
 * Read the baseline file's parsed JSON into a coordinate list, rejecting a
 * shape the gate would otherwise read as "no debt recorded". A malformed
 * baseline must fail loudly rather than silently disable the ratchet — the same
 * reasoning as a malformed `verifiedAt`.
 */
export function parseUndrilledBaseline(json: unknown): string[] {
  const entries = (json as { containers?: unknown })?.containers;
  if (!Array.isArray(entries) || entries.some((e) => typeof e !== 'string')) {
    throw new Error(
      "undrilled-containers.baseline.json must have a `containers` array of '<type>/<prop>' strings",
    );
  }
  return entries as string[];
}

/** Prescription printed under newly-undrilled containers. */
export const UNDRILLED_GUIDANCE = [
  'A container property classified by ONE blanket verdict covers every key beneath',
  'it, unasked. That is legal — inheritance is a real granularity, and inventing',
  'per-key verdicts without evidence would be worse — but it must be DECLARED, not',
  'inherited by default. Silence is what let `dashboard.widgets[].responsive` sit',
  'outside the map through an entire inert-key sweep (#4956).',
  '',
  'Two ways forward, and the evidence decides which:',
  '',
  '  1. DRILL it — add `"children": { … }` with a status + evidence per key, the',
  '     way `view.list` / `view.form` are drilled. Do this when you can actually',
  '     close the call graph for those keys; divergent sub-statuses are the',
  '     signal (one dead key under a live container is the whole point).',
  '  2. RECORD it — add the coordinate to',
  '     scripts/liveness/undrilled-containers.baseline.json. The file is',
  '     shrink-only: a row says "these child keys are classified NOWHERE", which',
  '     is honest, greppable, and a worklist. It is not a way to get green — a',
  '     reviewer sees the row arrive.',
  '',
  'Do NOT reach for option 2 by writing a `note` that says the subtree is',
  'classified elsewhere. That sentence is what #4956 was: a claim no checker',
  'could cash, believed for a release by everyone who read the file.',
];

/** Prescription printed under stale baseline rows. */
export const STALE_UNDRILLED_GUIDANCE = [
  'The container now drills (or its property is gone / no longer a container), so',
  'the row records a gap that no longer exists. Delete it — a shrink-only ratchet',
  'that never shrinks is just an allowlist, and an overstated debt is as',
  'misleading as an unrecorded one.',
];
