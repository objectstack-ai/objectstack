// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Orphan ledger entries — the silent half of the liveness gate's asymmetry.
//
// WHY THIS EXISTS. The gate walks the SCHEMA and looks each property up in the
// ledger. That direction is well defended: a property with no row reports
// UNCLASSIFIED and fails CI (the ratchet — no new undeclared surface). The
// reverse direction had no check at all, and the two removal routes make that
// gap load-bearing:
//
//   - `retiredKey()` tombstone — `z.never()` is still a property, so the key
//     STAYS in the walked shape and its row must stay with it. Deleting the row
//     reports UNCLASSIFIED and fails loudly (14 at once in the #3896 close-out
//     sweep, which is how this asymmetry got mapped in the first place).
//   - strict removal — the key leaves the shape entirely, so its row must go.
//     Nothing asked. The forward pass simply stops enquiring about a key it can
//     no longer see, and the row rots in place: a `dead`/`live` claim about a
//     property that does not exist, still read by anyone treating the ledger as
//     the capability catalogue it doubles as.
//
// That is not hypothetical. The report `aria`/`performance` rows outlived their
// schema keys by a full release — the keys had left in the report-liveness
// close-out — and were deleted by hand in the #3896 sweep as hygiene, noticed
// only because a human happened to be reading the file. One direction fails
// loudly; the other never failed at all.
//
// So this closes it, and closes it as a FAILURE rather than a warning. The tree
// was clean when the check landed (zero orphans across all sixteen governed
// types), so there is no debt to amortise and nothing to soften: it is a pure
// ratchet on the remaining direction. A warning here would have re-created the
// original defect one layer up — the ledger README's own verdict is that a
// permanently-noisy check is a check nobody reads, the same way a stale row is a
// claim nobody re-tests.

/** One orphaned ledger coordinate, with the cause narrowed as far as data allows. */
export interface Orphan {
  /** `<type>/<propPath>` — the ledger coordinate that has no schema property. */
  key: string;
  /** Whether the row sits at the top level or under a parent's `children`. */
  level: 'top' | 'child';
}

export interface OrphanScanInput {
  /** The governed metadata type being scanned. */
  type: string;
  /** The ledger's `props` object (may be empty / absent). */
  props: Record<string, any> | undefined;
  /** Top-level keys the gate's schema walk produced for this type. */
  shapeKeys: readonly string[];
  /**
   * Child keys of the container at a property PATH (`['widgets']`,
   * `['widgets', 'chartConfig']`), or `null` when that path is not a container.
   * Injected so every Zod-walking detail stays in the gate and this module stays
   * pure and testable.
   *
   * A PATH rather than a key because the forward walk recurses: the ledger may
   * nest `children` as deep as it likes, and a reverse direction that only ever
   * asked about depth one would stop asking exactly where the forward pass
   * started looking — re-creating this module's own asymmetry one level down.
   */
  childKeysOf: (path: readonly string[]) => readonly string[] | null;
}

/**
 * Find ledger rows with no corresponding schema property, at EVERY depth the
 * ledger declares.
 *
 * Recursion terminates on the data: a parsed ledger is a finite acyclic JSON
 * tree, so the descent is bounded by the file the author can read rather than by
 * a constant in here.
 *
 * Deliberately silent in one case: a row that declares `children` on a property
 * that is not a container. The FORWARD pass already reports that as
 * UNCLASSIFIED with a more specific message, and reporting it twice under two
 * different headings would obscure the single fix.
 *
 * Deliberately silent in one more: an orphan's OWN `children` are not descended
 * into. The parent coordinate does not exist, so every key beneath it is the
 * same single fix, and listing the subtree would bury the row that has to move.
 */
export function findOrphanEntries({ type, props, shapeKeys, childKeysOf }: OrphanScanInput): Orphan[] {
  const orphans: Orphan[] = [];
  const shape = new Set(shapeKeys);

  const scanChildren = (entry: any, path: readonly string[]): void => {
    const declaredChildren = entry?.children;
    if (!declaredChildren) return;

    const childKeys = childKeysOf(path);
    if (!childKeys) return; // the forward pass owns this one — see the docblock
    const childShape = new Set(childKeys);
    for (const childKey of Object.keys(declaredChildren)) {
      const childPath = [...path, childKey];
      if (!childShape.has(childKey)) {
        orphans.push({ key: `${type}/${childPath.join('.')}`, level: 'child' });
        continue;
      }
      scanChildren(declaredChildren[childKey], childPath);
    }
  };

  for (const key of Object.keys(props ?? {})) {
    if (!shape.has(key)) {
      orphans.push({ key: `${type}/${key}`, level: 'top' });
      continue;
    }
    scanChildren(props![key], [key]);
  }

  return orphans;
}

/**
 * The prescription printed under the orphan list. Both causes are actionable,
 * and which one applies is a judgement the author has to make — so name both
 * rather than guessing, and state the asymmetry that makes the wrong guess
 * tempting.
 */
export const ORPHAN_GUIDANCE = [
  'A ledger row outlives its property when a key is removed from the schema and',
  'its row is left behind. That is the STRICT-REMOVAL route: the key leaves the',
  'walked shape, so the forward pass stops asking about it and nothing else ever',
  'does. Delete the row (and any CLI advisory-lint expectation keyed on it).',
  '',
  'Mind the asymmetry before you reach for the opposite fix: a `retiredKey()`',
  'tombstone KEEPS the key in the walked shape, so a tombstoned key\'s row must',
  'STAY — deleting it reports UNCLASSIFIED instead. Route decides disposition.',
  '',
  'If the property IS still authorable, then the ledger is right and the WALK is',
  'wrong — the gate cannot see it (e.g. it lives on a union member `shapeOf`',
  'skips). Fix the walk, not the row: a property the walk cannot see is also a',
  'property the ratchet cannot govern.',
  '',
  'See .claude/skills/spec-property-retirement/SKILL.md §2.',
];

// ── THE TOMBSTONE HALF OF THE SAME ASYMMETRY (#19062) ──
//
// The guidance above states one half of the tombstone rule and nothing enforced
// the other. `retiredKey()` keeps the key in the walked shape, so the row must
// STAY — that is the half written down, and deleting the row fails loudly as
// UNCLASSIFIED. What the row is allowed to SAY was never constrained: the
// forward pass reads `status` and is satisfied by any value, the orphan pass is
// satisfied because the property is still there, and `markerStatus()` reads
// `[experimental` and `[planned` markers with no reading of the tombstone marker
// at all. So `tombstone + status: live` was a structurally permitted
// combination, not an oversight, and a key nobody can author could be graded a
// live capability indefinitely with CI green.
//
// That is measured, not hypothetical: `agent.tools` was tombstoned in the spec
// and its only reader deleted in a sibling repo, while the ledger graded the row
// `live` for three months and no gate objected (#18304).
//
// WHY `live` IS THE FORBIDDEN VALUE, AND WHY THE SET IS A CONSTANT. `live` is
// defined in the ledger README as "has a runtime consumer". A tombstoned key
// types as `never`, fails `tsc` at the authoring site and is refused at parse
// with the retirement prescription — no author in any repo can put a value
// behind it and no consumer can read one. So `live` is not a judgement call per
// row, it is false by construction. The other verdicts are a separate question
// with no census behind them yet (`planned` and `experimental` on a tombstone
// are equally false, `live-elsewhere` too) and their population here is ZERO
// today — widening this set is its own measurement, which is why it is a named
// constant rather than an inlined comparison.
//
// WHY IT LIVES HERE. This module already owns the ledger-versus-schema
// direction and already carries the prose that states the rule's other half; a
// rule and its guidance drifting apart is the failure this file was written to
// end. And it stays PURE for the reason `findOrphanEntries` does: the Zod
// walking stays in the gate, so the judgement can be tested without one.

/**
 * The marker `retiredKey()` writes at the head of a tombstoned key's
 * description — `packages/spec/src/shared/retired-key.ts`.
 *
 * Held equal to the real producer by `orphans.test.ts`, which reads an actual
 * `retiredKey()` description rather than restating the literal: a marker that
 * drifts would leave this scan matching nothing and reporting a clean tree,
 * which is the vacuous-pass shape the scanned/forbidden two-number report below
 * exists to make visible.
 */
export const TOMBSTONE_MARKER = '[REMOVED]';

/**
 * The statuses a tombstoned key's row may not claim. One entry, deliberately —
 * see the block above for why widening it is a separate measurement.
 */
export const TOMBSTONE_FORBIDDEN_STATUSES: readonly string[] = ['live'];

/** One property the gate's walk graded, with the description it graded it from. */
export interface GradedProperty {
  /** `<type>/<propPath>` — the coordinate the gate classified. */
  key: string;
  /** The property's resolved Zod description; the tombstone marker lives in it. */
  description: string;
  /** The status the walk resolved — from the ledger row, a marker, or `childrenDefault`. */
  status: string;
}

/** A tombstoned key whose ledger row claims a status the tombstone forbids. */
export interface TombstonedRow {
  /** `<type>/<propPath>` — the ledger coordinate making the claim. */
  key: string;
  /** The forbidden status it claims. */
  status: string;
}

/**
 * Two numbers, because one cannot carry both facts — the same discipline the
 * gate's evidence and citation lines already print. `scanned` is the
 * extraction-health signal; `findings` is the verdict. Reporting only the
 * verdict would read as a pass on a run where the marker had drifted and the
 * scan saw no tombstones at all.
 */
export interface TombstoneScan {
  /** How many `[REMOVED]` tombstones the walk actually reached. */
  scanned: number;
  /** The ones whose row claims a forbidden status. */
  findings: TombstonedRow[];
}

/**
 * Ask every tombstone the walk reached what its ledger row claims.
 *
 * This is the join the gate lacked: the tombstone lives in the SCHEMA
 * (a description), the claim lives in the LEDGER (a status), and until they were
 * read together neither side could be wrong on its own.
 */
export function scanTombstonedRows(graded: readonly GradedProperty[]): TombstoneScan {
  const forbidden = new Set(TOMBSTONE_FORBIDDEN_STATUSES);
  const findings: TombstonedRow[] = [];
  let scanned = 0;
  for (const prop of graded) {
    if (!prop.description.includes(TOMBSTONE_MARKER)) continue;
    scanned++;
    if (forbidden.has(prop.status)) findings.push({ key: prop.key, status: prop.status });
  }
  return { scanned, findings };
}

/**
 * The prescription printed under the tombstoned-row list. The wrong fix is the
 * tempting one — deleting the row — so name it and rule it out in the same
 * breath, exactly as {@link ORPHAN_GUIDANCE} does for the opposite direction.
 */
export const TOMBSTONE_STATUS_GUIDANCE = [
  'A `retiredKey()` tombstone declares the key REMOVED: it types as `never`, so',
  'writing it is a tsc error, and a value reaching the parse is refused with the',
  'retirement prescription. No author can write it and no consumer in any repo',
  'can read one — so `live` ("has a runtime consumer") is false by construction,',
  'whatever evidence the row still carries.',
  '',
  'Fix the ROW: grade it `dead` and move the retirement story (which sweep, which',
  'ADR, which tombstone refuses the key now) into `note`. A `dead` row carries no',
  'evidence pointer by convention — the prose is the record.',
  '',
  '⛔ Do NOT delete the row. The tombstone KEEPS the key in the walked shape, so',
  'a deleted row reports UNCLASSIFIED instead — the asymmetry ORPHAN_GUIDANCE',
  'above states. Route decides disposition; here the route is the tombstone.',
  '',
  'If the key is genuinely still readable somewhere, then the SCHEMA is wrong and',
  'the tombstone is the thing to remove — a retirement that left a live consumer',
  'behind is a bigger finding than this row.',
  '',
  'See .claude/skills/spec-property-retirement/SKILL.md §2.',
];
