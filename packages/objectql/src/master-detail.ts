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
 *
 * ## The tolerance, and the measurement behind it
 *
 * This reader accepts a second spelling of the reference target — the REJECTED
 * alias `referenceTo` — and reports when that is what answered. Both halves
 * are deliberate, and the reasoning is recorded here because the sentence this
 * replaces was an assertion nobody had measured: it read *"`referenceTo` is the
 * stored-row spelling"*, and that is not what the tree says.
 *
 * **What was measured** (whole tree, on `origin/main`, both spellings counted
 * separately, positive controls run so no zero came from a pathspec matching
 * nothing):
 *
 *   - **Authored declarations — zero, both spellings.** Across `*.object.ts`
 *     (112 files), `examples/`, `packages/qa/` and the `create-objectstack`
 *     templates, all 8 `Field.masterDetail(...)` and 132 `Field.lookup(...)`
 *     declarations go through the `@objectstack/spec` builders, which emit the
 *     canonical key. Not one alias spelling is hand-written past them.
 *   - **Stored-metadata seeds, fixtures and `metadata-fs` layouts — zero,
 *     both spellings.** Every raw hit in JSON/YAML is prose.
 *   - **In-tree `referenceTo` on a field def — reader pins only.** Nine files,
 *     each pinning either a refusal or a tolerance. None models a deployment.
 *   - **Metadata AT REST in a live deployment — NOT MEASURED.** No command in
 *     this repository reaches it. The zeros above are zeros for the tree.
 *
 * **Why the tolerance stays anyway** — the population is unmeasured, but the
 * PATH is not, and it is the one path nothing else covers:
 *
 *   - A raw `registerObject` SKIPS Zod by design (`registry.ts` names those
 *     doors), and every caller of this resolver reads that same
 *     `SchemaRegistry`. So an alias-spelled object reaches here verbatim.
 *   - The ADR-0087 conversion layer normalises the OTHER alias — `reference_to`
 *     — on stored rehydration and on `os migrate meta`, and deliberately does
 *     NOT convert `referenceTo` (`spec/src/conversions/registry.ts`, which
 *     records why: camelCase is objectui's resolved action-param dialect, not
 *     what the objectql runtime wrote into stored rows). ⇒ `referenceTo` is the
 *     one spelling that is simultaneously unconverted upstream and read here.
 *     That asymmetry is the reason this reader is not symmetric either: it
 *     reads `referenceTo` and NOT `reference_to`, which is not an oversight.
 *   - And a miss here is not a quiet wrong answer on the readonly path. Two of
 *     this resolver's four callers FAIL CLOSED: an unresolved relation leaves
 *     `parent` unbound, and `rule-validator.ts` reads an unbound scope root as
 *     LOCKED. Narrowing this reader would take a raw-registered, alias-spelled
 *     detail object from "lock enforced against its header" to "every
 *     `parent`-scoped field permanently unwritable, writes silently stripped"
 *     — an availability defect, not a spelling correction.
 *
 * ⛔ So do not narrow this in place, and do not widen it either. Narrowing is
 * only honest behind a migration that sweeps stored and raw-registered metadata
 * first — the same precondition the sibling `controlled_by_parent` reader in
 * `plugin-security` carries, and that reader's card holds the live-deployment
 * census this one could not run. Widening it to `reference_to` would undo the
 * conversion layer's work at the one seam that layer already covers.
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
  /** The one relationship spelling `@objectstack/spec` declares. */
  reference?: string;
  /** A REJECTED alias this reader still accepts — see "The tolerance" above. */
  referenceTo?: string;
}

/**
 * The spellings this reader accepts, in precedence order. Canonical first, so
 * an object carrying both resolves from `reference` and reports nothing.
 */
const REFERENCE_SPELLINGS = ['reference', 'referenceTo'] as const;

type ReferenceKey = (typeof REFERENCE_SPELLINGS)[number];

/**
 * WHICH spelling answers for this field, or `undefined` when neither key is
 * present. Split out so the diagnostic and the resolution cannot disagree
 * about the key that was read — {@link referenceOf} derives its value from
 * this answer rather than spelling a second `??` chain (the invariant
 * `plugin-security`'s `refKey` records for the sibling reader).
 *
 * `!= null` is the exact test `a ?? b` applies, so this selects the same key
 * the previous `def?.reference ?? def?.referenceTo` chain selected — a
 * present-but-empty `reference` still wins the key and still yields
 * `undefined` below, rather than falling through to the alias.
 */
function referenceKeyOf(def: RelationFieldDef | null | undefined): ReferenceKey | undefined {
  return REFERENCE_SPELLINGS.find((k) => def?.[k] != null);
}

/** The reference target under `key`, or `undefined` when it is not a usable name. */
function referenceOf(
  def: RelationFieldDef | null | undefined,
  key: ReferenceKey | undefined,
): string | undefined {
  const raw = key === undefined ? undefined : def?.[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

/** Options bag for {@link resolveMasterDetailRelation}. */
export interface ResolveMasterDetailOptions {
  /**
   * Sink for the rejected-alias report. Defaults to `console.warn`, so a host
   * that injects nothing still hears it — the same caller-supplied-callback
   * shape (and the same default) as `warnFunctionalCompleteness` in
   * `registry.ts`, which is a plain function in a bag rather than a method
   * lifted off a receiver-sensitive logger.
   */
  warn?: (message: string) => void;
}

/**
 * Relations already reported, keyed `object|field|spelling` — the report is
 * once per distinct defect, not per write.
 *
 * Granularity matters here more than it does at the registry seam: this
 * resolver runs on the WRITE path, once per write that wants a `parent`
 * binding, and a per-write line is a noise defect of its own — a channel
 * operators filter out, which would make the tolerance silent again by a
 * longer route. The one boundary of a process-lifetime set, stated rather
 * than discovered: re-introducing the SAME alias on the SAME field of the
 * SAME object after it was corrected in-process reports nothing until the
 * next restart. A new object, a new field or the other spelling all report.
 */
const reportedAliasRelations = new Set<string>();

/**
 * Report a relation that resolved only from a rejected alias. WARN, never
 * throw, never a behaviour change: the relation resolved, and this is the
 * record of HOW it resolved.
 *
 * The text names the spelling as the defect, states that behaviour is
 * unaffected, and corrects the registry's line by name — all three are
 * load-bearing. An operator who reads "rejected alias" and assumes something
 * was denied would go looking for an outage that did not happen; and the
 * registration-time diagnostic this object also trips
 * (`field/relationship-without-reference`) tells them the field is
 * "runtime-DEAD ... never-resolves", which is false for THIS consumer. Two
 * diagnostics that disagree about the same field are worse than one, so this
 * one says which is right where the resolution actually happens.
 *
 * No tracker ids: this string reaches operators, and `#NNNN` means nothing to
 * them (`check:doc-authoring`). The anchors are the module doc above.
 */
function reportRejectedReferenceAlias(
  objectName: string,
  fk: string,
  master: string,
  alias: ReferenceKey,
  options: ResolveMasterDetailOptions | undefined,
): void {
  const seen = `${objectName}|${fk}|${alias}`;
  if (reportedAliasRelations.has(seen)) return;
  reportedAliasRelations.add(seen);
  const warn = options?.warn ?? ((msg: string) => console.warn(msg));
  warn(
    `[objectql/reference-spelling] object "${objectName}": its master-detail relation resolved `
    + `only from the REJECTED alias \`${alias}\` on field "${fk}" (master "${master}") — `
    + '`reference` is the one relationship spelling @objectstack/spec declares, and this object '
    + 'reached the registry without being parsed (a raw registerObject skips Zod by design). '
    + 'Behaviour is UNAFFECTED: the relation still resolves, so `parent`-scoped `readonlyWhen` '
    + 'stays bound and its lock keeps enforcing. The registry\'s functional-completeness line '
    + 'for this same field — `field/relationship-without-reference`, "runtime-DEAD ... '
    + 'never-resolves" — is wrong about THIS consumer; this line is the accurate one. Rename '
    + 'the key to `reference`: every parsed authoring path already refuses the alias by name, '
    + 'so the two answers disagree until you do.',
  );
}

/**
 * The object's master-detail relation, or `null` when it has none — or when it
 * has more than one and "the parent" is therefore not a fact the metadata
 * states (see the module doc).
 */
export function resolveMasterDetailRelation(
  objectSchema:
    | { name?: string; fields?: Record<string, RelationFieldDef | null | undefined> }
    | undefined
    | null,
  options?: ResolveMasterDetailOptions,
): MasterDetailRelation | null {
  const fields = objectSchema?.fields;
  if (!fields) return null;
  let found: MasterDetailRelation | null = null;
  let foundKey: ReferenceKey | undefined;
  for (const [name, def] of Object.entries(fields)) {
    if (def?.type !== 'master_detail') continue;
    const key = referenceKeyOf(def);
    const master = referenceOf(def, key);
    if (!master) continue;
    if (found) return null; // ambiguous — two masters, no single `parent`
    found = { fk: name, master };
    foundKey = key;
  }
  // Reported only for the relation this call RETURNS: a discarded candidate
  // and the ambiguous case (which returns `null`) resolved nothing, so there
  // is no "the alias answered" to report about them.
  if (found && foundKey !== undefined && foundKey !== 'reference') {
    reportRejectedReferenceAlias(
      String(objectSchema?.name ?? '(unnamed)'),
      found.fk,
      found.master,
      foundKey,
      options,
    );
  }
  return found;
}
