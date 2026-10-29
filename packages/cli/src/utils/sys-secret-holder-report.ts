// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27721 — REPORT-ONLY: the `sys_secret` handles more than one holder names,
 * and the ones a column other than their own holds.
 *
 * A non-system write to a `secret` field may now only seal a new value or keep
 * its own record's ref, but values stored before that rule are not
 * re-examined. The orphan report answers which handles NOTHING names; this
 * answers the two questions it leaves open about the handles something does
 * name:
 *
 *  - **shared** — named by more than one holder record. Every producer mints
 *    one handle per value it seals, so two records naming one handle did not
 *    each seal it.
 *  - **misplaced** — held by a column other than the one its `(namespace, key)`
 *    names. A producer records on the row the pair of the column it minted the
 *    handle for ({@link SecretHolderColumn.mintedPair}), and the engine's
 *    release asks the same question before it removes a handle: a handle held
 *    elsewhere is one that column's release does not count.
 *
 * ## The one share a producer makes, listed apart
 *
 * A predicate update seals ONE value and writes its ref onto every row it
 * matched, all in the column the handle was minted for. That is the only
 * producer path that puts one handle on more than one record, and its stored
 * shape is exact: every holder is in the `object-field` family and in place,
 * so every holder is a row of the handle's own `OBJECT.FIELD`. A share of that
 * shape is listed in {@link SysSecretHolderReport.sharedInOwnColumn} and in
 * neither class above. Stored rows cannot tell it from a ref copied between
 * rows of that same column before non-system writes were limited to their own
 * record's ref, and the report says so rather than judging it.
 *
 * ## Read-only, and never a verdict
 *
 * A pure pass over the readings the command already made: the `sys_secret`
 * snapshots and the reference union's holder coordinates. Nothing here reads,
 * writes, decrypts or deletes, and nothing here feeds the deletion plan. ⛔ No
 * repair path belongs here; whether one follows is a maintainer decision.
 *
 * ⛔ Never cipher material and never a plaintext. A finding carries the handle
 * id, its `(namespace, key)` and its holders' coordinates — what the orphan
 * report already prints — and the input type {@link SecretRowSnapshot} has no
 * `ciphertext` member to carry.
 */

import type { SecretRowSnapshot } from '@objectstack/service-settings';
import type {
  SecretReference,
  SecretReferenceFamily,
  SecretReferenceUnion,
} from './secret-reference-union.js';

/**
 * Whether one holder is the column its handle's `(namespace, key)` names.
 *
 *  - `in_place` — the pair this holder's producer mints for it is the row's pair.
 *  - `misplaced` — it is another pair, and the producer fixes the pair.
 *  - `not_judged` — the producer lets its caller choose the pair, so a pair
 *    that differs shows nothing about where the ref came from.
 */
export type HolderPlacement = 'in_place' | 'misplaced' | 'not_judged';

/** One holder of a reported handle. Coordinates only. */
export interface ReportedHolder {
  family: SecretReferenceFamily;
  /** The union's printable coordinate. */
  holder: string;
  object: string;
  field: string;
  record: string | null;
  placement: HolderPlacement;
}

/** One reported handle. */
export interface HolderFinding {
  /** `sys_secret.id`. */
  id: string;
  namespace: string;
  key: string;
  /** How many holder records name it. */
  holderCount: number;
  /** Every holder that names it, each with its placement. */
  holders: ReportedHolder[];
  /** Justification, safe to print. */
  reason: string;
}

/** The report. Counts, handle ids and holder coordinates — never cipher material. */
export interface SysSecretHolderReport {
  counts: {
    /** `sys_secret` rows read. */
    total: number;
    /** Of those, rows at least one holder names. */
    named: number;
    shared: number;
    misplaced: number;
    sharedInOwnColumn: number;
    /** Holders whose placement was not judged. */
    placementNotJudged: number;
  };
  /** Handles named by more than one holder record, other than an own-column share. */
  shared: HolderFinding[];
  /** Handles at least one holder of which is not the column their pair names. */
  misplaced: HolderFinding[];
  /** Listed apart: every holder is a row of the handle's own minting column. */
  sharedInOwnColumn: HolderFinding[];
  /** What the counts depend on. */
  notes: string[];
}

/** The placement of one holder against the row it names. */
function placementOf(ref: SecretReference, secret: SecretRowSnapshot): HolderPlacement {
  const pair = ref.column.mintedPair;
  if (pair === null) return 'not_judged';
  return pair.namespace === secret.namespace && pair.key === secret.key ? 'in_place' : 'misplaced';
}

/**
 * Report every named `sys_secret` row that is shared or misplaced.
 *
 * @param input.secrets every `sys_secret` row, read unscoped.
 * @param input.union the cross-producer reference union. Incomplete is legal:
 *   the report covers the holders that were enumerated and says which family
 *   was not.
 */
export function reportSysSecretHolders(input: {
  secrets: readonly SecretRowSnapshot[];
  union: SecretReferenceUnion;
}): SysSecretHolderReport {
  const secrets = input.secrets ?? [];
  const { union } = input;

  const refsById = new Map<string, SecretReference[]>();
  for (const ref of union.references) {
    const list = refsById.get(ref.handleId);
    if (list) list.push(ref);
    else refsById.set(ref.handleId, [ref]);
  }

  const shared: HolderFinding[] = [];
  const misplaced: HolderFinding[] = [];
  const sharedInOwnColumn: HolderFinding[] = [];
  let named = 0;
  let placementNotJudged = 0;

  for (const secret of secrets) {
    const refs = refsById.get(secret.id);
    if (!refs || refs.length === 0) continue; // the orphan report's question, not this one
    named += 1;

    const holders: ReportedHolder[] = refs.map((ref) => ({
      family: ref.family,
      holder: ref.holder,
      object: ref.column.object,
      field: ref.column.field,
      record: ref.column.record,
      placement: placementOf(ref, secret),
    }));
    placementNotJudged += holders.filter((h) => h.placement === 'not_judged').length;
    const finding = (reason: string): HolderFinding => ({
      id: secret.id,
      namespace: secret.namespace,
      key: secret.key,
      holderCount: holders.length,
      holders,
      reason,
    });

    const away = holders.filter((h) => h.placement === 'misplaced');
    if (away.length > 0) {
      misplaced.push(finding(
        `held by ${away.length} column(s) other than the one its (namespace, key) names: `
          + `${away.map((h) => `${h.object}.${h.field}`).join(', ')}`,
      ));
    }

    if (holders.length < 2) continue;
    const ownColumn = holders.every((h) => h.family === 'object-field' && h.placement === 'in_place');
    if (ownColumn) {
      sharedInOwnColumn.push(finding(
        `named by ${holders.length} rows of ${secret.namespace}.${secret.key}, the column it was minted `
          + 'for: the shape a predicate update writes. Not judged: stored rows cannot tell it from a ref '
          + 'copied between rows of that column before writes were limited to their own record\'s ref.',
      ));
    } else {
      shared.push(finding(
        `named by ${holders.length} holder records (${[...new Set(holders.map((h) => h.family))].join(', ')}); `
          + 'a producer seals one handle per value, and the one share a producer makes (a predicate '
          + 'update, every holder a row of the handle\'s own column) is not this one.',
      ));
    }
  }

  const notes = [
    'Report-only: nothing is repaired or removed, and nothing here changes what --delete removes.',
    'Told apart: a predicate update writes one handle onto every row it matched, so a handle whose '
      + 'every holder is a row of its own minting column (object and field = its namespace and key) is '
      + 'listed under sharedInOwnColumn, not under shared or misplaced. Stored rows cannot tell that '
      + 'from a ref copied between rows of the same column, so it is listed, not judged.',
    'Placement compares the pair each producer records for the column it mints into: the settings '
      + 'row\'s (namespace, key), and the object and field name for a secret field. The pair is a name: '
      + 'a handle whose pair matches another producer\'s column reads as in place there.',
  ];
  if (placementNotJudged > 0) {
    notes.push(
      `${placementNotJudged} datasource holder(s) not judged for placement: the datasource binder `
        + 'records the pair its caller passes, so that pair names no column.',
    );
  }
  if (!union.complete) {
    notes.push(
      `The reference union is incomplete (${union.gaps.map((g) => g.family).join(', ')} could not be `
        + 'enumerated). A holder in that family is not counted, so shared and misplaced may be '
        + 'under-reported.',
    );
  }

  return {
    counts: {
      total: secrets.length,
      named,
      shared: shared.length,
      misplaced: misplaced.length,
      sharedInOwnColumn: sharedInOwnColumn.length,
      placementNotJudged,
    },
    shared,
    misplaced,
    sharedInOwnColumn,
    notes,
  };
}
