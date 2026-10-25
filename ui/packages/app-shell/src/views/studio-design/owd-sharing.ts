// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared org-wide-default (OWD) helpers for the Studio authoring surfaces.
 *
 * The per-object Settings tab (`ObjectSettingsPanel`) and the package-level
 * OWD overview (`PackageOwdOverviewPanel`) both edit the SAME record-sharing
 * baseline — `sharingModel` (ADR-0090 D1/D4). This module is the single home
 * for the pieces they must agree on: the canonical value set and the
 * master-object derivation used for `controlled_by_parent` rows. Pure and
 * DOM-free, so both surfaces can share one validated implementation.
 */

import { ObjectSchema } from '@objectstack/spec/data';
import { readFields, writeFields } from '../metadata-admin/previews/object-fields-io.js';

/**
 * The four canonical OWD values (ADR-0090 D4). The legacy `read` / `read_write`
 * / `full` aliases are rejected at authoring time, so authoring surfaces only
 * ever offer these.
 */
export const OWD_MODELS = [
  'private',
  'public_read',
  'public_read_write',
  'controlled_by_parent',
] as const;
export type OwdModel = (typeof OWD_MODELS)[number];

/** The field type a `controlled_by_parent` object derives its master from. */
const MASTER_DETAIL = 'master_detail';

/**
 * The master (parent) object a `controlled_by_parent` child inherits its
 * baseline from, read the way the runtime derives it (ADR-0055 §1, enforced
 * since `@objectstack/spec` 18, objectstack#23100): the `reference` of the ONE
 * `master_detail` field declared `required: true`.
 *
 * Returns undefined when the object declares zero such fields, or two or more:
 * the runtime derives no master from either shape (every read is denied, every
 * write refused), and it never picks one by field order. It used to return the
 * FIRST `master_detail` by order, required or not, which showed a master for
 * an object the runtime derives none from (objectui#12326). A non-required
 * `master_detail` is not a master. Undefined is the authoring error, and the
 * overview says so rather than naming a parent.
 */
export function deriveMasterObject(fields: unknown): string | undefined {
  const masters = readFields(fields).entries.filter(
    (e) => e.def.type === MASTER_DETAIL && e.def.required === true,
  );
  if (masters.length !== 1) return undefined;
  const ref = masters[0].def.reference;
  return typeof ref === 'string' && ref ? ref : undefined;
}

/**
 * The designer's write side of the same rule (objectui#12326): on a
 * `controlled_by_parent` object every `master_detail` field is `required: true`,
 * because the protocol admits no other value there. Returns the fields with
 * that set on each `master_detail` that does not carry it, in the shape they
 * came in, or the input itself when nothing changes, so a caller can skip a
 * write that would change nothing.
 *
 * It never picks a master. With two or more `master_detail` fields every one
 * of them is made required, and the spec refuses the object for declaring more
 * than one ({@link cbpMasterRefusal} shows that refusal). The author then
 * chooses which one stays the master, which is the spec's own prescription.
 *
 * `@objectstack/spec`'s `ObjectSchema.create()` applies the same force to an
 * omitted `required` and does not export it, so this is the designer's copy of
 * the WRITE. The rule itself is judged by the spec (see `cbpMasterRefusal`).
 */
export function requireCbpMasterDetails(fields: unknown): unknown {
  const view = readFields(fields);
  if (!view.entries.some((e) => e.def.type === MASTER_DETAIL && e.def.required !== true)) {
    return fields;
  }
  return writeFields({
    shape: view.shape,
    entries: view.entries.map((e) =>
      e.def.type === MASTER_DETAIL && e.def.required !== true
        ? { name: e.name, def: { ...e.def, required: true } }
        : e,
    ),
  });
}

/** The two places `ObjectSchema` reports a `controlled_by_parent` master refusal. */
const CBP_REFUSAL_PATHS: ReadonlySet<string> = new Set(['sharingModel', 'fields']);

/**
 * The installed spec's own refusal of a `controlled_by_parent` object that does
 * not declare exactly one required `master_detail`, or undefined when the spec
 * accepts its master relation. The text is the spec's, so the designer says
 * what the save door will say, and names the fix the same way.
 *
 * The spec does not export the check, only `ObjectSchema`, so this parses a
 * PROBE: the object's name, `sharingModel: 'controlled_by_parent'`, and its
 * relationship fields reduced to `type`, `reference` and a boolean `required`.
 * The probe is needed because a whole draft can carry an issue elsewhere (an
 * unknown key, a malformed field) that stops `ObjectSchema` before the master
 * check runs, and the panel would then read a refused object as accepted. Of
 * the probe's issues it keeps the custom ones at `sharingModel` (zero masters)
 * and at `fields` (two or more), the two paths the spec reports this refusal at.
 */
export function cbpMasterRefusal(objectName: unknown, fields: unknown): string | undefined {
  const probeFields: Record<string, Record<string, unknown>> = {};
  for (const e of readFields(fields).entries) {
    const type = e.def.type;
    if (type !== MASTER_DETAIL && type !== 'lookup') continue;
    const def: Record<string, unknown> = { type };
    if (typeof e.def.reference === 'string' && e.def.reference) def.reference = e.def.reference;
    if (typeof e.def.required === 'boolean') def.required = e.def.required;
    probeFields[e.name] = def;
  }
  const result = ObjectSchema.safeParse({
    name: typeof objectName === 'string' && objectName ? objectName : 'object',
    sharingModel: 'controlled_by_parent',
    fields: probeFields,
  });
  if (result.success) return undefined;
  const refusal = result.error.issues.find(
    (i) => i.code === 'custom' && i.path.length === 1 && CBP_REFUSAL_PATHS.has(String(i.path[0])),
  );
  return refusal?.message;
}

/**
 * The OWD baseline a BRAND-NEW object starts from, and the models it can
 * actually choose at creation.
 *
 * `OWD_DEFAULT` is `'private'` because that is what the platform itself
 * treats as the recommended baseline, in two independent places:
 *   - the framework's own minimal create body seeds `sharingModel: 'private'`
 *     (`@objectstack/spec` `kernel/metadata-create-seeds.ts`), on the stated
 *     grounds that the runtime already resolves an absent value to `private`
 *     (fail-closed, ADR-0090 D1) so making it explicit changes no tenant's
 *     effective sharing;
 *   - the `security-owd-unset` rule's own fix-it hint calls `'private'` the
 *     "recommended default".
 * It is a PRE-SELECTED, VISIBLE choice on the create form — not a value
 * written behind the author's back. The ADR's requirement is that the
 * baseline be authored, and an author who sees the control, reads the gloss
 * and accepts the default has authored it.
 *
 * `OWD_CREATE_MODELS` deliberately OMITS `controlled_by_parent`: it derives
 * access from a master relation, and a just-created object has no
 * master-detail field yet, so offering it would trade the `security-owd-unset`
 * publish wall for the `security-controlled-by-parent-no-relation` one. The
 * lint's own hint draws the same line — "If the object has no master, its
 * baseline is its own decision — use sharingModel: 'private' (owner +
 * shares), 'public_read', or 'public_read_write'." The full four-value set
 * stays available in the object's Settings tab, where the object may since
 * have gained the master-detail field that makes the fourth value authorable.
 */
export const OWD_CREATE_MODELS = ['private', 'public_read', 'public_read_write'] as const;
export type OwdCreateModel = (typeof OWD_CREATE_MODELS)[number];

/**
 * Typed as `OwdCreateModel`, not `OwdModel`: the default has to be a value the
 * create surface can actually offer. Widening it to the full four-value set
 * would let a future edit default new objects to `controlled_by_parent`, which
 * a just-created object has no master relation to derive from.
 */
export const OWD_DEFAULT: OwdCreateModel = 'private';
