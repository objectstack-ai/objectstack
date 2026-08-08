// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Master-detail relation resolution (ADR-0035).
 *
 * A detail object declares its owner as a `master_detail` field whose
 * `reference` names the master object. ADR-0035 makes that relationship the
 * single declaration point for the whole master-detail story — inline grids,
 * cascade delete, `controlled_by_parent` sharing (ADR-0055), roll-up summaries
 * — and it is also what gives a child field's `readonlyWhen` / `requiredWhen`
 * predicate its `parent` binding (#1581, ADR-0072's scope table).
 *
 * This module answers exactly one question — *which field points at the master,
 * and which object is it?* — so the write path can resolve the header row
 * without re-deriving the relationship at each call site. `plugin-security`
 * keeps its own `controlled_by_parent` resolver: that one is deliberately more
 * permissive (it falls back to a required `lookup`) because a CBP object with
 * no derivable master must deny reads rather than open them, which is a
 * different question from "what does `parent` mean in this predicate".
 *
 * ## Why `parent` is not guessed
 *
 * The resolution is deliberately narrow: a `master_detail` field, and only when
 * the object declares exactly ONE of them. A junction object with two masters
 * has no single "the parent", and picking one by declaration order would make
 * a data-integrity lock depend on field ordering — PD #12's "declared, not
 * guessed". Such an object simply has no `parent` binding, which the build-time
 * gate in `@objectstack/lint` (`validate-expressions`) rejects at authoring
 * time — for `readonlyWhen` since #4889 and for `requiredWhen` since #4977.
 *
 * The two runtimes then part ways on the unbindable case, deliberately: an
 * unbound `parent` leaves a `readonlyWhen` field LOCKED (#4889 — refusing to
 * wave a declared lock through), while a `requiredWhen` stays fail-OPEN
 * (#4977 — a 422 on a write whose header is merely unreadable was ruled too
 * loud, and left to the next review of ADR-0058 D5). That asymmetry is why the
 * build-time gate covers BOTH slots: it is the only thing standing between an
 * unbindable `requiredWhen` and a requirement that enforces nothing in silence.
 */

/** The child→master link: the FK field on the detail, and the master object. */
export interface MasterDetailRelation {
  /** Field on the DETAIL object holding the master's id. */
  fk: string;
  /** Object name of the MASTER (header) record. */
  master: string;
}

/** The subset of a field definition this resolution reads. */
export interface RelationFieldDef {
  type?: string;
  /** Canonical reference target. `referenceTo` is the stored-row spelling. */
  reference?: string;
  referenceTo?: string;
}

/** The reference target a relation field names, or `undefined`. */
function referenceOf(def: RelationFieldDef | null | undefined): string | undefined {
  const raw = def?.reference ?? def?.referenceTo;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

/**
 * The object's master-detail relation, or `null` when it has none — or when it
 * has more than one and "the parent" is therefore not a fact the metadata
 * states (see the module doc).
 */
export function resolveMasterDetailRelation(
  objectSchema: { fields?: Record<string, RelationFieldDef | null | undefined> } | undefined | null,
): MasterDetailRelation | null {
  const fields = objectSchema?.fields;
  if (!fields) return null;
  let found: MasterDetailRelation | null = null;
  for (const [name, def] of Object.entries(fields)) {
    if (def?.type !== 'master_detail') continue;
    const master = referenceOf(def);
    if (!master) continue;
    if (found) return null; // ambiguous — two masters, no single `parent`
    found = { fk: name, master };
  }
  return found;
}
