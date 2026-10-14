// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §1 · #23100, maintainer ruling B] The ONE predicate behind "a
 * `controlled_by_parent` object derives its master from exactly one
 * `master_detail` field declared `required: true`".
 *
 * Two readers, one judgement:
 *
 * - `ObjectSchema`'s refinement (`refuseControlledByParentWithoutOneMaster`,
 *   `object.zod.ts`) turns a verdict into the parse issue, with the message
 *   carried here;
 * - the stored-row listing (`conversions/refused-shapes.ts`) turns the same
 *   verdict into the TODO the v18 upgrade prints for a stored row it refuses
 *   (#23270), with the shape that decides its fate.
 *
 * Kept in one module so the two cannot drift: an object the upgrade's preview
 * lists is exactly an object the parse refuses, and the reverse.
 *
 * PUBLIC (`@objectstack/spec/data`, #23272): a producer that must emit an
 * object `ObjectSchema` accepts asks this module rather than restating the
 * rule —
 *
 * - {@link controlledByParentMasterRefusal} answers the object-level question
 *   "does this object satisfy the exactly-one-master rule?": `undefined` is
 *   yes. A producer choosing a default asks it with `'controlled_by_parent'`
 *   as the sharing model it is about to write;
 * - {@link isControlledByParentMasterField} answers the field-level half,
 *   "does this field count as a master?", which the refusal counts. A reader
 *   that lists the candidates itself (`@objectstack/lint`'s
 *   `cbpMasterCandidates`, which names each candidate's `reference` in its
 *   finding) reads this, so what counts as a master is spelled here once.
 *
 * Read on either the PARSED field map or a stored body: `required` is
 * `z.boolean().default(false)`, so on the parsed map an omitted `required` is
 * `false`, and on a stored body it is `undefined`. The predicate counts a
 * master only where `required === true`, so the two give the same verdict.
 */

/**
 * The shape of a refused `controlled_by_parent` object — what decides its
 * fate in the v18 upgrade:
 *
 * - `several-required-masters` — two or more `master_detail` fields declared
 *   `required: true`; choosing the master is the owner's call;
 * - `several-masters` — two or more `master_detail` fields and none declared
 *   `required: true`; again a pick;
 * - `master-not-required` — exactly one `master_detail`, not declared
 *   `required: true`. An OMITTED `required` is converted by the D2 entry
 *   `cbp-master-detail-required-defaulted` before this is read, so on a stored
 *   row that has been through the chain this is an explicit `required: false`
 *   (or a non-boolean the field parse refuses on its own);
 * - `required-lookup-only` — no `master_detail`, one or more required `lookup`
 *   fields (the retired third tier);
 * - `no-master` — no `master_detail` and no required `lookup`.
 */
export type ControlledByParentMasterShape =
  | 'several-required-masters'
  | 'several-masters'
  | 'master-not-required'
  | 'required-lookup-only'
  | 'no-master';

/** Why an object fails the one-required-master rule — see {@link controlledByParentMasterRefusal}. */
export interface ControlledByParentMasterRefusal {
  /** Where the parse reports it: `fields` (more than one candidate) or `sharingModel` (none). */
  readonly path: 'fields' | 'sharingModel';
  readonly shape: ControlledByParentMasterShape;
  /** The `master_detail` fields the object declares, in field order. */
  readonly masterDetails: readonly string[];
  /** The `lookup` fields declared `required: true`, in field order. */
  readonly requiredLookups: readonly string[];
  /** The parse issue's message, naming the object and the fix. */
  readonly message: string;
}

/**
 * Does this field count as a `controlled_by_parent` master under ADR-0055 §1?
 * A `master_detail` field declared `required: true`, and nothing else: a
 * non-required `master_detail` and a required `lookup` are the two tiers
 * ruling B retired (#23100). An object satisfies the rule when EXACTLY ONE of
 * its fields counts — {@link controlledByParentMasterRefusal} is that count.
 *
 * Reads `required === true` on either the parsed field or a stored body (see
 * the module header), and accepts any value: a non-object counts as no master.
 */
export function isControlledByParentMasterField(field: unknown): boolean {
  if (field === null || typeof field !== 'object') return false;
  const f = field as { type?: unknown; required?: unknown };
  return f.type === 'master_detail' && f.required === true;
}

/**
 * Judge one object against ADR-0055 §1's one-required-master rule. Returns
 * `undefined` when the rule does not apply (another sharing model, no field
 * map) or the object satisfies it; otherwise the refusal.
 */
export function controlledByParentMasterRefusal(
  objectName: unknown,
  sharingModel: unknown,
  fields: unknown,
): ControlledByParentMasterRefusal | undefined {
  if (sharingModel !== 'controlled_by_parent') return undefined;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const name = typeof objectName === 'string' && objectName.length > 0 ? objectName : '<unnamed>';
  const entries = Object.entries(fields as Record<string, { type?: unknown; required?: unknown } | undefined>);
  const masterDetails = entries.filter(([, f]) => f?.type === 'master_detail').map(([key]) => key);
  const requiredLookups = entries
    .filter(([, f]) => f?.type === 'lookup' && f.required === true)
    .map(([key]) => key);
  const masters = entries.filter(([, f]) => isControlledByParentMasterField(f)).map(([key]) => key);
  if (masters.length === 1) return undefined;
  if (masters.length > 1) {
    return {
      path: 'fields',
      shape: 'several-required-masters',
      masterDetails,
      requiredLookups,
      message:
        `Object '${name}' declares sharingModel 'controlled_by_parent' with ${masters.length} required `
        + `\`master_detail\` fields (${masters.map((m) => `\`${m}\``).join(', ')}). ADR-0055 §1: since `
        + '@objectstack/spec 18, a controlled-by-parent object derives its master from exactly one required `master_detail` field, so '
        + 'with two the declaration does not say which master governs its rows, and the platform derives none '
        + '(every read is denied, every write refused). Keep `master_detail` on the one master, and declare '
        + 'every other parent as a `lookup` field.',
    };
  }
  const found = [
    ...masterDetails.map((m) => `\`${m}\` is a \`master_detail\` without \`required: true\` — add it`),
    ...requiredLookups.map(
      (l) => `\`${l}\` is a required \`lookup\`, and a lookup derives no access — declare it `
        + "`type: 'master_detail'` (a detail is deleted with its master; declare `deleteBehavior: 'restrict'` "
        + 'to refuse deleting a master that still has rows instead)',
    ),
  ];
  const shape: ControlledByParentMasterShape =
    masterDetails.length > 1
      ? 'several-masters'
      : masterDetails.length === 1
        ? 'master-not-required'
        : requiredLookups.length > 0
          ? 'required-lookup-only'
          : 'no-master';
  return {
    path: 'sharingModel',
    shape,
    masterDetails,
    requiredLookups,
    message:
      `Object '${name}' declares sharingModel 'controlled_by_parent' but no required \`master_detail\` field. `
      + 'ADR-0055 §1: since @objectstack/spec 18, a controlled-by-parent object derives its master from exactly '
      + 'one `master_detail` field declared `required: true`, and from nothing else, so as declared the '
      + 'platform derives no master '
      + '(every read is denied, every write refused). '
      + (found.length > 0 ? `${found.join('; ')}. ` : '')
      + 'If the rows must outlive their parent, this object is not a detail: give it its own sharingModel '
      + "('private', 'public_read' or 'public_read_write').",
  };
}
