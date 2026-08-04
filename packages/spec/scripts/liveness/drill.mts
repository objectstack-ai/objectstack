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
// honest coarse one). So inheritance stays legal and becomes DECLARED, in one
// of exactly three dispositions:
//
//   - DRILLED (`children` on the entry) — per-key verdicts, as before.
//   - DEFERRED — the container embeds a surface that IS classified elsewhere,
//     with the reference RESOLVED rather than asserted (see below).
//   - RECORDED — genuinely unclassified, listed in
//     `undrilled-containers.baseline.json`, whose header says so in plain words.
//
// A container in none of the three FAILS, with the child keys it would be
// covering printed — new undrilled surface can no longer arrive silently, which
// is the shape that made #4956. A baseline row whose container now drills (or is
// no longer a container) also FAILS: same rot as an orphan ledger row, opposite
// direction, claiming a gap that is already closed. And the gate REPORTS the
// population every run, its success line no longer claiming completeness it does
// not have.
//
// WHY A DEFERRAL IS RESOLVED AND NOT BELIEVED. "Classified elsewhere" is the
// exact sentence that caused #4956, so it must never come back as prose. But it
// is sometimes TRUE: `object.fields[]` really is `FieldSchema`, and the `field`
// ledger classifies all 66 of its keys; `object.listViews[]` is the same
// ListView surface `view.list` already drills. Six containers — 248 child keys,
// nearly half the population — are in that position, so recording them as
// "classified NOWHERE" would have been this module's own false claim, in a file
// written to end false claims.
//
// The difference from #4956 is not the sentence, it is who checks it. A deferral
// names its target as DATA (`{ container, to }`) and the gate RESOLVES it: the
// target must exist — a governed type root, or a drilled `type/prop` coordinate
// — and its classified key set must EQUAL the container's child key set. A
// dangling target fails. A drifted one fails too: equality rather than "subset"
// on purpose, because a container that grows a key its target never classifies
// is #4956 reappearing one level down. This is the issue's own second option
// ("let the checker PARSE such a reference and error when it dangles"), and it
// is what lets the first option be honest.
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

/** A declared cross-reference: this container's subtree is classified at `to`. */
export interface DeferredContainer {
  /** `<type>/<propPath>` — the container riding on someone else's classification. */
  container: string;
  /** Target coordinate: a governed type root (`field`) or a drilled coordinate (`view/list`). */
  to: string;
}

export interface CoverageReconcileInput {
  /** Containers the walk observed riding on inheritance, in walk order. */
  observed: readonly ContainerCoverage[];
  /** Coordinates the baseline records as knowingly unclassified. */
  baseline: readonly string[];
  /** Declared cross-references, each resolved against `classifiedKeysAt`. */
  deferred?: readonly DeferredContainer[];
  /**
   * The set of keys CLASSIFIED at a target coordinate, or `null` when the
   * target does not exist. Injected so every Zod/ledger detail stays in the
   * gate and this module stays pure (the `orphans.mts` contract).
   */
  classifiedKeysAt?: (target: string) => readonly string[] | null;
}

export interface CoverageReconcileResult {
  /** Observed but neither baselined nor deferred — new undrilled surface. Fails the gate. */
  undeclared: ContainerCoverage[];
  /** Baselined/deferred but no longer observed — the debt is paid or the property moved. Fails the gate. */
  stale: string[];
  /** A deferral whose target is missing or whose key set has drifted. Fails the gate. */
  brokenDeferrals: string[];
  /** Child keys with NO verdict anywhere — the honest size of the gap. */
  inheritedChildKeys: number;
  /** Child keys covered by a RESOLVED deferral — classified, just not here. */
  deferredChildKeys: number;
}

/**
 * Reconcile the containers the walk found against their declared dispositions,
 * in BOTH directions, resolving every deferral rather than believing it.
 *
 * Pure — all Zod/ledger lookups arrive through `classifiedKeysAt`, mirroring
 * `orphans.mts`, so this stays unit-testable against a tree that is (by
 * construction) fully reconciled and would otherwise prove nothing.
 */
export function reconcileContainerCoverage({
  observed,
  baseline,
  deferred = [],
  classifiedKeysAt = () => null,
}: CoverageReconcileInput): CoverageReconcileResult {
  const recorded = new Set(baseline);
  const deferredBy = new Map(deferred.map((d) => [d.container, d.to]));
  const seen = new Map(observed.map((o) => [o.key, o]));

  const undeclared = observed.filter((o) => !recorded.has(o.key) && !deferredBy.has(o.key));
  // Deduped: a coordinate could be named by both lists, and reporting it twice
  // would obscure the single fix.
  const stale = [...new Set([...recorded, ...deferredBy.keys()])].filter((k) => !seen.has(k)).sort();

  const brokenDeferrals: string[] = [];
  let deferredChildKeys = 0;
  for (const { container, to } of deferred) {
    const here = seen.get(container);
    // Already reported as stale. Say nothing more about it — including the
    // both-lists contradiction below — because the single fix is to delete the
    // row(s), and a second heading about a coordinate that no longer exists
    // would obscure it (the `orphans.mts` rule, same reasoning).
    if (!here) continue;
    // Declared in BOTH lists — "classified nowhere" AND "classified at `to`"
    // cannot both be true, and whichever the gate silently preferred would
    // decide whether these keys count as a gap. Refuse instead of picking.
    if (recorded.has(container)) {
      brokenDeferrals.push(
        `${container} is declared in BOTH lists — 'containers' says its child keys are classified nowhere, ` +
        `'deferred' says they are classified at '${to}'. Delete whichever is wrong.`,
      );
      continue;
    }
    const target = classifiedKeysAt(to);
    if (!target) {
      brokenDeferrals.push(
        `${container} defers to '${to}', which does not exist — no governed type and no drilled ledger coordinate of that name`,
      );
      continue;
    }
    // EQUALITY, not subset: a key on either side the other does not know about
    // is the #4956 hole one level down.
    const targetSet = new Set(target);
    const missing = here.childKeys.filter((k) => !targetSet.has(k));
    const extra = target.filter((k) => !here.childKeys.includes(k));
    if (missing.length || extra.length) {
      brokenDeferrals.push(
        `${container} defers to '${to}' but the key sets have drifted — ` +
        `${missing.length} key(s) here that '${to}' does not classify` +
        `${missing.length ? ` (${missing.join(', ')})` : ''}, ` +
        `${extra.length} classified there but absent here` +
        `${extra.length ? ` (${extra.join(', ')})` : ''}`,
      );
      continue;
    }
    deferredChildKeys += here.childKeys.length;
  }

  const inheritedChildKeys = observed
    .filter((o) => recorded.has(o.key))
    .reduce((n, o) => n + o.childKeys.length, 0);

  return { undeclared, stale, brokenDeferrals, inheritedChildKeys, deferredChildKeys };
}

export interface UndrilledBaseline {
  /** Genuinely unclassified containers — the shrink-only debt. */
  containers: string[];
  /** Declared cross-references, resolved by the gate. */
  deferred: DeferredContainer[];
}

/**
 * Read the baseline file's parsed JSON, rejecting a shape the gate would
 * otherwise read as "no debt recorded". A malformed baseline must fail loudly
 * rather than silently disable the ratchet — the same reasoning as a malformed
 * `verifiedAt`.
 */
export function parseUndrilledBaseline(json: unknown): UndrilledBaseline {
  const doc = json as { containers?: unknown; deferred?: unknown } | null;
  const entries = doc?.containers;
  if (!Array.isArray(entries) || entries.some((e) => typeof e !== 'string')) {
    throw new Error(
      "undrilled-containers.baseline.json must have a `containers` array of '<type>/<prop>' strings",
    );
  }
  const deferred = doc?.deferred ?? [];
  if (
    !Array.isArray(deferred) ||
    deferred.some((d) => !d || typeof (d as DeferredContainer).container !== 'string' || typeof (d as DeferredContainer).to !== 'string')
  ) {
    throw new Error(
      'undrilled-containers.baseline.json `deferred` must be an array of { container, to } objects',
    );
  }
  return { containers: entries as string[], deferred: deferred as DeferredContainer[] };
}

/** Prescription printed under newly-undrilled containers. */
export const UNDRILLED_GUIDANCE = [
  'A container property classified by ONE blanket verdict covers every key beneath',
  'it, unasked. That is legal — inheritance is a real granularity, and inventing',
  'per-key verdicts without evidence would be worse — but it must be DECLARED, not',
  'inherited by default. Silence is what let `dashboard.widgets[].responsive` sit',
  'outside the map through an entire inert-key sweep (#4956).',
  '',
  'Three ways forward, and the evidence decides which:',
  '',
  '  1. DRILL it — add `"children": { … }` with a status + evidence per key, the',
  '     way `view.list` / `view.form` are drilled. Do this when you can actually',
  '     close the call graph for those keys; divergent sub-statuses are the',
  '     signal (one dead key under a live container is the whole point).',
  '  2. DEFER it — if the container embeds a surface that is ALREADY classified',
  '     (a governed type, or a coordinate someone else drilled), add',
  '     `{ "container": …, "to": … }` to the `deferred` list in',
  '     scripts/liveness/undrilled-containers.baseline.json. The gate RESOLVES',
  '     it: the target must exist and its classified key set must EQUAL this',
  '     container\'s. A dangling or drifted target fails.',
  '  3. RECORD it — add the coordinate to the `containers` list in that same',
  '     file, scripts/liveness/undrilled-containers.baseline.json. It is',
  '     shrink-only: a row says "these child keys are classified NOWHERE",',
  '     which is honest, greppable, and a worklist. It is not a way to get',
  '     green — a reviewer sees the row arrive.',
  '',
  'Note what option 2 is NOT: writing a `note` that says the subtree is classified',
  'elsewhere. That sentence is what #4956 was — a claim no checker could cash,',
  'believed for a release by everyone who read the file. Same claim, as data the',
  'gate resolves, is fine; as prose it is the defect.',
];

/** Prescription printed under stale baseline rows. */
export const STALE_UNDRILLED_GUIDANCE = [
  'The container now drills (or its property is gone / no longer a container), so',
  'the row records a gap that no longer exists. Delete it — a shrink-only ratchet',
  'that never shrinks is just an allowlist, and an overstated debt is as',
  'misleading as an unrecorded one.',
];
