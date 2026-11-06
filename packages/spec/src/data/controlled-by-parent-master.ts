// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §1 · #23100, maintainer ruling B, as amended by ruling A of
 * #30905] The ONE predicate behind "a `controlled_by_parent` object derives
 * its master from exactly one `master_detail` field": the one declared
 * `required: true`, or, when the object declares no required one, its only
 * `master_detail` declared `required: false` (an OPTIONAL master: a detail row
 * may name none, and such a row is readable by its owner and by View All on
 * the detail, never through a master).
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
 *   "does this field count as a REQUIRED master?", which the refusal counts:
 *   two of them are two masters whatever else the object declares;
 * - {@link controlledByParentMasterOf} answers "which field is the one
 *   master, and is it optional?" on a field map. The optional master is an
 *   object-level judgement, not a field-level one: a `master_detail` declared
 *   `required: false` is the master only where no required one stands beside
 *   it, so a reader that resolves the master (the security runtime's
 *   `resolveCbpRelation`, the engine's boot refusal of an unservable master,
 *   `@objectstack/lint`'s relation rules) reads this, and what counts as the
 *   master is spelled here once.
 *
 * Read on either the PARSED field map or a stored body: `required` is
 * `z.boolean().default(false)`, so on the parsed map an omitted `required` is
 * `false`, and on a stored body it is `undefined`. The required master counts
 * only where `required === true` and the optional master only where
 * `required === false`, so a body that writes no `required` at all on its one
 * `master_detail` derives no master here (shape `master-not-required`). That
 * is the one place the two readings differ, and it is deliberate: the spec
 * names an OMITTED `required` a required master everywhere it can see the
 * omission — `ObjectSchema.create()` forces it to `true`
 * (`forceCbpMasterDetailRequired`), the stored-row seams convert it to `true`
 * (the D2 conversion `cbp-master-detail-required-defaulted`), and
 * `@objectstack/lint`'s `relationship/master-detail-required` reports it at
 * `error` — and an object registered without the parse keeps failing closed
 * on it. A raw parse cannot see the omission (the field default has already
 * written `false` when the object refinement runs), so there an omitted
 * `required` reads as the optional master.
 * `readonly` (`z.boolean().default(false)`) and `system` (optional) are read
 * the same way: only `=== true` marks the one master unwritable.
 */

/**
 * The shape of a refused `controlled_by_parent` object — what decides its
 * fate in the v18 upgrade:
 *
 * - `several-required-masters` — two or more `master_detail` fields declared
 *   `required: true`; choosing the master is the owner's call;
 * - `several-masters` — two or more `master_detail` fields and none declared
 *   `required: true`; again a pick;
 * - `master-not-required` — exactly one `master_detail`, declaring neither
 *   `required: true` nor `required: false`: an OMITTED `required` on a body no
 *   parse has defaulted (or a non-boolean the field parse refuses on its own).
 *   The D2 entry `cbp-master-detail-required-defaulted` converts the omitted
 *   key before a stored row is read, so a stored row that has been through the
 *   chain never carries it, and a parsed field map never does either. An
 *   explicit `required: false` is not this shape: it is the optional master
 *   (ADR-0055 §1 as amended, #30905);
 * - `required-lookup-only` — no `master_detail`, one or more required `lookup`
 *   fields (the retired third tier);
 * - `no-master` — no `master_detail` and no required `lookup`;
 * - `master-not-writable` — the one master (required, or optional),
 *   declared `readonly: true` or `system: true`. ADR-0055 §1 derives the master from a
 *   reference every write of a detail supplies, and those two flags mark a
 *   field an author's write does not supply (one the platform fills, or one a
 *   write may not set), so it cannot be the one master. Dropping the flag is
 *   the owner's call: it changes who may write the reference.
 */
export type ControlledByParentMasterShape =
  | 'several-required-masters'
  | 'several-masters'
  | 'master-not-required'
  | 'required-lookup-only'
  | 'no-master'
  | 'master-not-writable';

/** Why an object fails the one-required-master rule — see {@link controlledByParentMasterRefusal}. */
export interface ControlledByParentMasterRefusal {
  /**
   * Where the parse reports it: `fields` (more than one candidate, or the one
   * master is not writable) or `sharingModel` (none).
   */
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
 * Does this field count as a REQUIRED `controlled_by_parent` master under
 * ADR-0055 §1? A `master_detail` field declared `required: true`, and nothing
 * else: a required `lookup` is the tier ruling B retired (#23100), and a
 * `master_detail` declared `required: false` is the optional master only when
 * no required one stands beside it, which a field alone cannot say —
 * {@link controlledByParentMasterOf} judges that on the field map. An object
 * with two counting fields has two masters, whatever else it declares.
 * The flags are judged on the one master, not here: a flagged required
 * `master_detail` is still the field the runtime resolves as the master, so a
 * second one beside it is still two masters.
 *
 * Reads `required === true` on either the parsed field or a stored body (see
 * the module header), and accepts any value: a non-object counts as no master.
 */
export function isControlledByParentMasterField(field: unknown): boolean {
  if (field === null || typeof field !== 'object') return false;
  const f = field as { type?: unknown; required?: unknown };
  return f.type === 'master_detail' && f.required === true;
}

/** The one master a `controlled_by_parent` object derives its access from — see {@link controlledByParentMasterOf}. */
export interface ControlledByParentMaster {
  /** The master reference field's key: the detail's master FK column. */
  readonly field: string;
  /**
   * `true` when the master is declared `required: false` (ADR-0055 §1 as
   * amended, #30905): a detail row may name no master, and such a row is read
   * by its owner and by View All on the detail, never through a master. `false`
   * for the required master.
   */
  readonly optional: boolean;
}

/**
 * Which field of this field map is the `controlled_by_parent` master, and is
 * it optional? (ADR-0055 §1 as amended, #30905.)
 *
 * - exactly one `master_detail` declared `required: true`
 *   ({@link isControlledByParentMasterField}) is the master, whatever else the
 *   map declares — a second `master_detail` declared `required: false` beside
 *   it is an ordinary parent, as it was before the optional master existed;
 * - otherwise, when the map declares exactly ONE `master_detail` and it is
 *   declared `required: false`, that field is the optional master;
 * - anything else (two required masters, two `master_detail` fields none of
 *   them required, one whose `required` is not written, a required `lookup`
 *   only, nothing) names no master: `undefined`.
 *
 * Judges the master only. Whether the one master is writable (`readonly` /
 * `system`) is {@link controlledByParentMasterRefusal}'s question, and the
 * sharing model is the caller's: this reads any field map. Reads `required`
 * as written (see the module header), and accepts any value: a non-object
 * map names no master.
 */
export function controlledByParentMasterOf(fields: unknown): ControlledByParentMaster | undefined {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const entries = Object.entries(fields as Record<string, unknown>);
  const required = entries.filter(([, f]) => isControlledByParentMasterField(f));
  if (required.length === 1) return { field: required[0]![0], optional: false };
  if (required.length > 1) return undefined;
  const masterDetails = entries.filter(
    ([, f]) => f !== null && typeof f === 'object' && (f as { type?: unknown }).type === 'master_detail',
  );
  if (masterDetails.length !== 1) return undefined;
  const [field, def] = masterDetails[0]!;
  return (def as { required?: unknown }).required === false ? { field, optional: true } : undefined;
}

/**
 * The writability flags a `controlled_by_parent` master may not carry, in the
 * order a refusal names them. See the `master-not-writable` shape.
 */
const UNWRITABLE_MASTER_FLAGS = ['readonly', 'system'] as const;

/**
 * Judge one object against ADR-0055 §1's one-master rule (as amended,
 * #30905): exactly one required `master_detail`, or, with none, exactly one
 * `master_detail` declared `required: false`; and that one master writable.
 * Returns `undefined` when the rule does not apply (another sharing model, no
 * field map) or the object satisfies it; otherwise the refusal.
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
  const master = controlledByParentMasterOf(fields);
  if (master !== undefined) {
    const def = (fields as Record<string, Record<string, unknown> | undefined>)[master.field];
    const flags = UNWRITABLE_MASTER_FLAGS.filter((flag) => def?.[flag] === true);
    if (flags.length === 0) return undefined;
    const which = master.optional ? 'one optional `master_detail` (declared `required: false`)' : 'one required `master_detail`';
    return {
      path: 'fields',
      shape: 'master-not-writable',
      masterDetails,
      requiredLookups,
      message:
        `Object '${name}' declares sharingModel 'controlled_by_parent' with its ${which}, `
        + `\`${master.field}\`, marked ${flags.map((f) => `\`${f}: true\``).join(' and ')}. ADR-0055 §1: since `
        + '@objectstack/spec 18, a controlled-by-parent object derives its master from exactly one '
        + '`master_detail` field that every write of a detail supplies, and a field marked `readonly` or '
        + '`system` is not one an author\'s write supplies, so this reference cannot be that master. '
        + `Remove ${flags.map((f) => `\`${f}: true\``).join(' and ')} from \`${master.field}\` and declare the `
        + `master reference as an ordinary ${master.optional ? '' : 'required '}field; if the rows must outlive their parent, this object `
        + "is not a detail: give it its own sharingModel ('private', 'public_read' or 'public_read_write').",
    };
  }
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
    ...(masterDetails.length > 1
      ? [
          `${masterDetails.map((m) => `\`${m}\``).join(', ')} are \`master_detail\` fields and none declares `
            + '`required: true`, so none of them is the master — keep `master_detail` on the one master and '
            + 'declare every other parent as a `lookup`',
        ]
      : masterDetails.map(
          (m) => `\`${m}\` is a \`master_detail\` that declares no \`required\` — declare \`required: true\` `
            + '(every row names its master) or `required: false` (a row may name none)',
        )),
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
      `Object '${name}' declares sharingModel 'controlled_by_parent' but no required \`master_detail\` field, `
      + 'nor a single `master_detail` declared `required: false`. '
      + 'ADR-0055 §1: since @objectstack/spec 18, a controlled-by-parent object derives its master from exactly '
      + 'one `master_detail` field declared `required: true`, or, with none, from its only `master_detail` '
      + 'declared `required: false` (an optional master: a row that names none is readable only by its owner '
      + 'and by View All on the object), and from nothing else, so as declared the platform derives no master '
      + '(every read is denied, every write refused). '
      + (found.length > 0 ? `${found.join('; ')}. ` : '')
      + 'If the rows must outlive their parent, this object is not a detail: give it its own sharingModel '
      + "('private', 'public_read' or 'public_read_write').",
  };
}
