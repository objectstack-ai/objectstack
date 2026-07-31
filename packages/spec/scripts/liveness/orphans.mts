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
   * Child keys of a container property, or `null` when the property is not a
   * container. Injected so every Zod-walking detail stays in the gate and this
   * module stays pure and testable.
   */
  childKeysOf: (key: string) => readonly string[] | null;
}

/**
 * Find ledger rows with no corresponding schema property.
 *
 * Deliberately silent in one case: a row that declares `children` on a property
 * that is not a container. The FORWARD pass already reports that as
 * UNCLASSIFIED with a more specific message, and reporting it twice under two
 * different headings would obscure the single fix.
 */
export function findOrphanEntries({ type, props, shapeKeys, childKeysOf }: OrphanScanInput): Orphan[] {
  const orphans: Orphan[] = [];
  const shape = new Set(shapeKeys);

  for (const key of Object.keys(props ?? {})) {
    if (!shape.has(key)) {
      orphans.push({ key: `${type}/${key}`, level: 'top' });
      continue;
    }
    const declaredChildren = props![key]?.children;
    if (!declaredChildren) continue;

    const childKeys = childKeysOf(key);
    if (!childKeys) continue; // the forward pass owns this one — see the docblock
    const childShape = new Set(childKeys);
    for (const childKey of Object.keys(declaredChildren)) {
      if (!childShape.has(childKey)) orphans.push({ key: `${type}/${key}.${childKey}`, level: 'child' });
    }
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
