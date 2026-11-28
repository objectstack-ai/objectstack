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

import {
  CONTROLLED_BY_PARENT_MASTER_INVALID,
  ObjectSchema,
  controlledByParentMasterOf,
  type ControlledByParentMasterShape,
} from '@objectstack/spec/data';
import { readFields, writeFields, type FieldEntry } from '../metadata-admin/previews/object-fields-io.js';

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
 * baseline from, read the way the runtime derives it from a stored object
 * (ADR-0055 §1 as amended by objectstack#30905 ruling A). Which field is the
 * master is the spec's answer, `controlledByParentMasterOf`: the ONE
 * `master_detail` declared `required: true`, or, with none, the object's only
 * `master_detail` declared `required: false` (an optional master, whose rows
 * may name none).
 *
 * An omitted `required` on the object's only `master_detail` reads as
 * `required: true`, as the spec's stored-row conversion
 * `cbp-master-detail-required-defaulted` reads it: Studio defaults it to
 * required, as the builder and stored data do. It names the same master either
 * way.
 *
 * Returns undefined when the spec names no master (two required masters, two
 * `master_detail` fields none of them required, none at all): the runtime
 * derives none from those shapes and never picks one by field order. Undefined
 * is the authoring error, and the overview says so rather than naming a parent.
 */
export function deriveMasterObject(fields: unknown): string | undefined {
  const entries = readFields(fields).entries;
  const masterDetails = entries.filter((e) => e.def.type === MASTER_DETAIL);
  const byName: Record<string, Record<string, unknown>> = {};
  for (const e of entries) {
    byName[e.name] =
      masterDetails.length === 1 && e === masterDetails[0] && e.def.required === undefined
        ? { ...e.def, required: true }
        : e.def;
  }
  const master = controlledByParentMasterOf(byName);
  if (!master) return undefined;
  const ref = byName[master.field].reference;
  return typeof ref === 'string' && ref ? ref : undefined;
}

/**
 * Does Studio's write default this field's `required` to `true` on a
 * `controlled_by_parent` object? A `master_detail` that writes no `required`
 * at all. An explicit `required: false` is the author's choice, an optional
 * master (ADR-0055 §1 as amended, objectstack#30905 ruling A), and is kept.
 */
export function cbpMasterDetailDefaultsRequired(def: Record<string, unknown>): boolean {
  return def.type === MASTER_DETAIL && def.required === undefined;
}

/**
 * The designer's write side of the same rule (objectui#12326): on a
 * `controlled_by_parent` object a `master_detail` field that writes no
 * `required` is made `required: true`, because the save door would otherwise
 * read the omission as an optional master. Returns the fields with that set,
 * in the shape they came in, or the input itself when nothing changes, so a
 * caller can skip a write that would change nothing.
 *
 * It keeps an explicit `required: false`: that is an optional master the
 * author chose, and a save never turns it required. It never picks a master.
 * With two or more `master_detail` fields each omitted one is made required,
 * and the spec refuses the object when that leaves more than one master
 * ({@link cbpMasterRefusal} shows that refusal). The author then chooses
 * which one stays the master, which is the spec's own prescription.
 *
 * `@objectstack/spec`'s `ObjectSchema.create()` applies the same force to an
 * omitted `required` and does not export it, so this is the designer's copy of
 * the WRITE. The rule itself is judged by the spec (see `cbpMasterRefusal`).
 */
export function requireCbpMasterDetails(fields: unknown): unknown {
  const view = readFields(fields);
  if (!view.entries.some((e) => cbpMasterDetailDefaultsRequired(e.def))) {
    return fields;
  }
  return writeFields({
    shape: view.shape,
    entries: view.entries.map((e) =>
      cbpMasterDetailDefaultsRequired(e.def) ? { name: e.name, def: { ...e.def, required: true } } : e,
    ),
  });
}

/**
 * The writability flags the spec judges on the one master (its module-private
 * `UNWRITABLE_MASTER_FLAGS`, `data/controlled-by-parent-master.ts`): a master
 * marked `readonly: true` or `system: true` is refused with the shape
 * `master-not-writable`. The probe carries them on a `master_detail` field, as
 * booleans exactly as written, so the tab shows that refusal too.
 */
const CBP_UNWRITABLE_MASTER_FLAGS = ['readonly', 'system'] as const;

/** The two places `ObjectSchema` reports a `controlled_by_parent` master refusal. */
const CBP_REFUSAL_PATHS: ReadonlySet<string> = new Set(['sharingModel', 'fields']);

/**
 * The business wording for each refusal shape the spec stamps on its issue
 * (`params.shape`, beside `params.code` = `CONTROLLED_BY_PARENT_MASTER_INVALID`).
 * Keyed by the spec's own shape union, so a shape the spec adds fails the
 * type-check here until it has a row; at run time a shape with no row (an
 * issue from a spec this build was not compiled against) falls back to the
 * spec's message.
 */
export const CBP_REFUSAL_KEYS: Readonly<Record<ControlledByParentMasterShape, string>> = {
  'several-required-masters': 'engine.studio.settings.cbpRefusalSeveralRequiredMasters',
  'several-masters': 'engine.studio.settings.cbpRefusalSeveralMasters',
  'master-not-required': 'engine.studio.settings.cbpRefusalMasterNotRequired',
  'required-lookup-only': 'engine.studio.settings.cbpRefusalRequiredLookupOnly',
  'no-master': 'engine.studio.settings.cbpRefusalNoMaster',
  'master-not-writable': 'engine.studio.settings.cbpRefusalMasterNotWritable',
};

/** The installed spec's refusal of a `controlled_by_parent` object's master relation — see {@link cbpMasterRefusal}. */
export interface CbpMasterRefusal {
  /** The spec's own message, in English: the fallback when no business wording applies. */
  readonly message: string;
  /**
   * The refusal's shape, read from the issue's `params` when it carries the
   * spec's code; undefined when it does not, and the message is then shown.
   */
  readonly shape?: ControlledByParentMasterShape;
  /** The fields the author has to act on, in field order (none for `no-master`). */
  readonly fields: readonly FieldEntry[];
}

/** The `params` a refusal issue carries, read defensively (zod types them as unknown). */
function refusalShape(params: unknown): ControlledByParentMasterShape | undefined {
  if (params === null || typeof params !== 'object') return undefined;
  const { code, shape } = params as { code?: unknown; shape?: unknown };
  if (code !== CONTROLLED_BY_PARENT_MASTER_INVALID || typeof shape !== 'string') return undefined;
  return Object.prototype.hasOwnProperty.call(CBP_REFUSAL_KEYS, shape)
    ? (shape as ControlledByParentMasterShape)
    : undefined;
}

/**
 * The fields a refusal of this shape names, read off the probe the spec judged.
 * It selects what to show; the verdict and the shape stay the spec's.
 *
 * The master of a `master-not-writable` refusal is read the way the PARSE read
 * it, not off the raw probe: the one `master_detail` declared `required: true`,
 * else the object's only `master_detail`. On the parsed map an omitted
 * `required` has already defaulted to `false`, so the only `master_detail` is
 * the optional master there (the spec module's header), while the raw probe
 * still has `required` unwritten and `controlledByParentMasterOf` would name no
 * master on it.
 */
function refusalFields(
  shape: ControlledByParentMasterShape,
  entries: readonly FieldEntry[],
  probe: Record<string, Record<string, unknown>>,
): FieldEntry[] {
  const masterDetails = entries.filter((e) => e.def.type === MASTER_DETAIL);
  switch (shape) {
    case 'several-required-masters':
      return masterDetails.filter((e) => probe[e.name]?.required === true);
    case 'several-masters':
    case 'master-not-required':
      return masterDetails;
    case 'required-lookup-only':
      return entries.filter((e) => e.def.type === 'lookup' && probe[e.name]?.required === true);
    case 'master-not-writable': {
      const required = masterDetails.filter((e) => probe[e.name]?.required === true);
      if (required.length === 1) return required;
      return masterDetails.length === 1 ? masterDetails : [];
    }
    case 'no-master':
      return [];
  }
}

/**
 * The installed spec's own refusal of a `controlled_by_parent` object that does
 * not declare exactly one required `master_detail`, or undefined when the spec
 * accepts its master relation. The verdict is the spec's, so the designer says
 * what the save door will say: the issue's `params` carry the spec's code and
 * the refusal's shape, which the settings tab turns into business wording in
 * the author's language ({@link CBP_REFUSAL_KEYS}), naming the fields to fix.
 *
 * It parses `ObjectSchema` — the save door's own parse — rather than calling
 * the spec's exported `controlledByParentMasterRefusal` directly, so the code
 * it reads is the one the door stamps. It parses a PROBE: the object's name,
 * `sharingModel: 'controlled_by_parent'`, and its relationship fields reduced
 * to `type`, `reference` and a boolean `required` — plus, on a `master_detail`,
 * the boolean writability flags ({@link CBP_UNWRITABLE_MASTER_FLAGS}). The
 * probe is needed because a whole draft can carry an issue elsewhere (an
 * unknown key, a malformed field) that stops `ObjectSchema` before the master
 * check runs, and the panel would then read a refused object as accepted. Of
 * the probe's issues it keeps the one whose `params.code` is the spec's code;
 * when none carries it, the custom one at `sharingModel` (zero masters) or at
 * `fields` (two or more, or an unwritable master), the two paths the spec
 * reports this refusal at.
 */
export function cbpMasterRefusal(objectName: unknown, fields: unknown): CbpMasterRefusal | undefined {
  const entries = readFields(fields).entries;
  const probeFields: Record<string, Record<string, unknown>> = {};
  for (const e of entries) {
    const type = e.def.type;
    if (type !== MASTER_DETAIL && type !== 'lookup') continue;
    const def: Record<string, unknown> = { type };
    if (typeof e.def.reference === 'string' && e.def.reference) def.reference = e.def.reference;
    if (typeof e.def.required === 'boolean') def.required = e.def.required;
    if (type === MASTER_DETAIL) {
      for (const flag of CBP_UNWRITABLE_MASTER_FLAGS) {
        if (typeof e.def[flag] === 'boolean') def[flag] = e.def[flag];
      }
    }
    probeFields[e.name] = def;
  }
  const result = ObjectSchema.safeParse({
    name: typeof objectName === 'string' && objectName ? objectName : 'object',
    sharingModel: 'controlled_by_parent',
    fields: probeFields,
  });
  if (result.success) return undefined;
  // The issue carrying the spec's code; with none (a spec that stamps no
  // code), the custom issue at one of the refusal's two paths.
  const issue =
    result.error.issues.find((i) => refusalShape((i as { params?: unknown }).params) !== undefined)
    ?? result.error.issues.find(
      (i) => i.code === 'custom' && i.path.length === 1 && CBP_REFUSAL_PATHS.has(String(i.path[0])),
    );
  if (!issue) return undefined;
  const shape = refusalShape((issue as { params?: unknown }).params);
  return {
    message: issue.message,
    shape,
    fields: shape ? refusalFields(shape, entries, probeFields) : [],
  };
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
