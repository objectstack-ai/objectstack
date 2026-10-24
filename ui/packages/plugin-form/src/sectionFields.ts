/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared section-field normalizer for every `object-form` arm that takes
 * sections: Tabbed / Wizard / Split / Drawer / Modal, and — since
 * objectui#10475, through `SectionFieldsContext.pool` — the default arm
 * (`SimpleObjectForm`).
 *
 * A form-view section lists its fields in one of three shapes:
 *
 *   1. a plain string — the field name:                 `'account_number'`
 *   2. a spec FormFieldSchema object (canonical) —      `{ field: 'name', required: true, colSpan: 2 }`
 *   3. an already-built runtime FormField object —       `{ name: 'x', type: 'text', ... }`
 *
 * Shape (2) is what `@objectstack/spec` emits — see FormFieldSchema, where the
 * key is `field`, NOT `name`. The variants used to read `fieldDef.name` and push
 * the raw object straight through, so a spec entry reached react-hook-form with
 * `name === undefined` and crashed the whole form on `name.split('.')`. This
 * helper normalizes all three shapes into a runtime FormField with a real
 * `name`, merging object-schema metadata (type/options/validation) with the
 * spec-level overrides.
 *
 * Also hosts the two top-level counterparts of this file's own
 * `warnOnMixedVocabulary`, both about the SAME vocabulary shape (2) documents,
 * and all three kept here so they do not drift in voice:
 *
 *   - `warnUnresolvedTopLevelField` (objectui#8738 route 1) — a top-level
 *     `fields` member that resolves to no field name, shared by
 *     `ObjectForm.tsx`'s `SimpleObjectForm` and `flatFields.ts`'s
 *     `buildFlatFields`, neither of which is a sectioned variant.
 *   - `warnSectionMemberExcludedByFields` (objectui#9884) — a `sections[].fields`
 *     member the object really declares, dropped because the form's top-level
 *     `fields` does not list it. The two keys INTERSECT; this is the warning
 *     that makes the loser audible.
 */

import type { FormField } from '@object-ui/types';
import { evalFieldPredicate, isBlankPredicateText, type FieldRulePredicate } from '@object-ui/core';
import { mapFieldTypeToFormType, buildValidationRules, fieldHelpText } from '@object-ui/fields';
import { isCreateFormMode, isRequiredInForm } from './schemaDefaults';
import { findCustomFieldMember } from './customFieldsMerge';
import { isInlineFieldDef } from './submitTarget';

export interface SectionFieldsContext {
  /** Resolved object schema (`{ fields: { [name]: fieldDef } }`) or null. */
  objectSchema: any;
  /** Object name, for label translation. */
  objectName: string;
  /** Whole-form read-only flag. */
  readOnly?: boolean;
  /** Form mode — `view` forces every field disabled. */
  mode?: 'create' | 'edit' | 'view';
  /**
   * The record this form is editing, if any. Together with `mode` it answers
   * "is there a persisted record behind this form", which decides whether a
   * runtime `defaultValue` excuses the field from `required` (#4069) — see
   * `isCreateFormMode`. Passed rather than derived from `mode` alone because
   * the containers' own create branch is `mode === 'create' || !recordId`, and
   * a form that omits `mode` entirely is still a create form to them.
   */
  recordId?: unknown;
  /**
   * Translation-aware label resolver (from `useSafeFieldLabel`).
   *
   * `fallback` is required, matching the producer in `@object-ui/i18n`: the
   * resolver returns the fallback when no translation exists, so an omitted
   * one could not satisfy the `=> string` return. Every call site already
   * passes it.
   */
  fieldLabel: (objectName: string, fieldName: string, fallback: string) => string;
  /**
   * The authored inline members (`schema.customFields`). A member naming the
   * field a section entry names is that entry's BASE definition, in place of
   * the one generated from the object schema — the precedence `ObjectForm`'s
   * default arm resolves its section members with (`findCustomFieldMember`,
   * objectui#10254). Only the base moves: the entry's own overrides still
   * apply on top, by the rules below. Omitted or empty → every base is
   * generated, as before.
   */
  customFields?: readonly FormField[] | null;
  /**
   * The parent field POOL the section resolves its members against, for the
   * one caller that has one: `ObjectForm`'s default arm (`SimpleObjectForm`),
   * whose pool is built from top-level `fields` (or the object) merged with
   * `customFields` (objectui#10475).
   *
   * When set, {@link buildSectionFields} still walks the section's entries in
   * AUTHORED order and applies each entry's overrides by the same rules as
   * every other arm; for a NAME-ONLY entry — shape (1) or (2), which names a
   * field and leaves its definition to be resolved — two things change, both
   * the pool's to decide:
   *
   *   - membership — an entry naming a field the pool does not hold is
   *     dropped. That is objectui#9884's INTERSECTION of `fields` and
   *     `sections`; the caller emits its warning
   *     (`warnSectionMemberExcludedByFields`), this module only drops;
   *   - the BASE — the pooled field is what a name string draws and what a
   *     spec entry's overrides are written onto (a copy), in place of
   *     `fromObjectSchema` / the member lookup. The pool already resolved the
   *     member-over-generated precedence, and its generated fields carry the
   *     default arm's own per-field facts (the lock on a computed `formula` /
   *     `summary` / `auto_number` field, the input type, the step), which only
   *     LAYOUT and per-entry overrides may move. The managed-object lock is
   *     not one of them: every arm applies it after this builder, in
   *     `gateFormFields` (objectui#10612).
   *
   * An already-built runtime FormField entry (shape 3) carrying its own
   * `name` is its own definition, and the pool decides NOTHING about it: it is
   * drawn whatever the pool holds, exactly as the pool-less arms draw it
   * (objectui#11615). The intersection catches a NAME the object does not
   * declare or `fields` does not list — a typo, a stale name — and an entry
   * that declares itself names nothing to resolve, so dropping it guarded
   * nothing and made this arm the one that skipped what the other five drew.
   * "Self-describing" is `isInlineFieldDef` (`submitTarget.ts`), the one
   * predicate the submit-target rule already reads.
   * Omitted → no pool: every entry is drawn, from the bases above.
   */
  pool?: readonly FormField[] | null;
}

/**
 * Carry a `visibleOn` predicate through to the runtime FormField so the form
 * renderer evaluates it with the canonical CEL engine (`evalFieldPredicate`,
 * same record scope as `visibleWhen`). Accepts both wire shapes — a bare CEL
 * string and the spec Expression object `{ dialect, source }` (#2212).
 *
 * The previous implementation attached a `visible(formData)` closure backed
 * by `evaluateCondition`, which is a legacy `{field, operator, value}`
 * matcher, not a CEL evaluator — and nothing in the form render chain ever
 * called the closure, so `visibleOn` silently did nothing.
 *
 * ## A BLANK predicate is dropped — and said (objectui#11262)
 *
 * Blank predicate TEXT — `''`, whitespace-only, or an envelope whose `source`
 * is either — is not attached: the runtime field draws with no view-level gate,
 * which is the verdict a blank gate has everywhere (ADR-0137 D3 / D4, "no
 * gate"). What ADR-0137 D4 rules out is the SILENCE of that: a blank gate
 * predicate is "diagnosed, never a silent `true`". Dropped here, it never
 * reached the form renderer's own evaluation — the one place that would have
 * reported it — so this function reports it, through the channel that
 * evaluation (and `ExpressionEvaluator`'s blank gate guard) already use:
 * `isBlankPredicateText` decides, `evalFieldPredicate`'s `[blank]` report
 * speaks, deduped per blank text and field. No engine call is made.
 *
 * Only what this function DROPS is reported here. A runtime field that already
 * carries the blank in its own `visibleOn` (an inline member drawn as it is)
 * keeps it, and the form renderer that evaluates it reports it at render, so a
 * second line here would describe a drop that did not happen.
 */
function attachVisibility(formField: FormField, expr: unknown): FormField {
  const isPredicateText =
    typeof expr === 'string' ||
    (expr != null && typeof expr === 'object' && typeof (expr as { source?: unknown }).source === 'string');
  if (!isPredicateText) return formField;
  if (isBlankPredicateText(expr)) {
    if ((formField as { visibleOn?: unknown }).visibleOn !== expr) {
      evalFieldPredicate(expr as FieldRulePredicate, {}, true, undefined, undefined, {
        context: `view-level visibility of field '${formField.name}', read as no gate`,
      });
    }
    return formField;
  }
  return { ...formField, visibleOn: expr } as FormField;
}

/**
 * Mixed-vocabulary lint (#3090): an authored section field carrying BOTH the
 * spec identity key (`field`, a string) and the runtime one (`name`) is
 * ambiguous — the spec branch below derives the runtime name from `field`, so
 * an authored `name` is silently overwritten. Say so once per site (this runs
 * inside render loops, hence the dedupe).
 */
const warnedMixedVocabulary = new Set<string>();
function warnOnMixedVocabulary(fd: Record<string, any>, objectName: string): void {
  if (typeof fd.name !== 'string' || fd.name === fd.field) return;
  const key = `${objectName}:${fd.field}:${fd.name}`;
  if (warnedMixedVocabulary.has(key)) return;
  warnedMixedVocabulary.add(key);
  console.warn(
    `[object-ui] section field { field: '${fd.field}' } also carries name: '${fd.name}' — mixed form-field ` +
      `vocabularies. The spec key wins (the runtime name becomes '${fd.field}'); drop \`name\` from authored ` +
      `form views.`,
  );
}

/**
 * The TOP-LEVEL counterpart of `warnOnMixedVocabulary` above (objectui#8738).
 *
 * `sections[].fields` accepts the spec `FormFieldSchema` object — identity key
 * `field`, normalized by `normalizeSectionField` above. TOP-LEVEL `fields` —
 * `SimpleObjectForm`'s `fieldsToShow` loop in `ObjectForm.tsx`, and
 * `buildFlatFields` below in `flatFields.ts` for the drawer/modal
 * presentations — does NOT: it takes only bare field-name strings. (A STORED
 * `{ name }` entry still reads, but it is no authoring spelling and neither
 * this warning nor the registrations teach it: objectui#11550.) The exact same
 * `{ field: 'x', ... }` object `normalizeSectionField` treats as canonical
 * resolves to no `name` at the top level, and both read
 * sites used to drop it in total silence — no throw, no warning, no
 * empty-state. This is the same voice and the same once-per-occurrence
 * discipline as `warnOnMixedVocabulary`, for the sibling mistake where a
 * member resolves to NOTHING rather than to two conflicting names.
 *
 * ⛔ This function only WARNS — it never resolves a name from `entry`. Reading
 * `entry.field` as a fallback name here would be exactly the lenient `?? f.field`
 * second dialect objectui#8738 forbids: it would make the wrong spelling work
 * instead of making its failure audible.
 */
const warnedUnresolvedTopLevelField = new Set<string>();
export function warnUnresolvedTopLevelField(entry: unknown, objectName: string): void {
  const isSpecFieldObject =
    entry !== null && typeof entry === 'object' && typeof (entry as any).field === 'string';
  const shape = isSpecFieldObject ? `{ field: '${(entry as any).field}' }` : JSON.stringify(entry);
  const key = `${objectName}:${shape}`;
  if (warnedUnresolvedTopLevelField.has(key)) return;
  warnedUnresolvedTopLevelField.add(key);
  console.warn(
    `[object-ui] top-level \`fields\` entry ${shape} resolved to no field name and was skipped. ` +
      `Top-level \`fields\` takes bare field-name strings — it is NOT the ` +
      `same vocabulary as \`sections[].fields\`, which also accepts the spec \`FormFieldSchema\` object ` +
      `(identity key \`field\`, e.g. \`{ field: 'note', colSpan: 2 }\`). That shape has no \`name\` here ` +
      `and is silently dropped; use a bare field-name string, or move the entry into a ` +
      `\`sections[].fields\` entry instead.`,
  );
}

/**
 * The THIRD member of this file's warning family (objectui#9884), and the one
 * about an interaction rather than about a single member's shape.
 *
 * Top-level `fields` and `sections` are NOT layers — they INTERSECT.
 * `SimpleObjectForm` builds the parent field pool from `schema.fields` first
 * (`fieldsToShow` in `ObjectForm.tsx`), and each section then resolves its own
 * members against THAT pool. So a member a section names, that the object
 * really declares, is dropped for the single reason that the form's top-level
 * `fields` does not list it — and when it is that section's last surviving
 * member the section is dropped whole, heading and all.
 *
 * ⛔ This function only WARNS, for the same reason `warnUnresolvedTopLevelField`
 * above only warns: resolving the member here — widening the pool to the union
 * of `fields` and every section's members — would change what a landed schema
 * renders, submits and prefills, because that pool is also what feeds create
 * defaults, the `initialValues` merge and the submitted value set. The
 * intersection is the behaviour three of this package's four `fields`
 * registrations declare and `objectFormFieldsMembers-8071` pins; what was
 * wrong was `object-master-detail-form`'s registration claiming `fields` is
 * "Ignored when `sections` is given", and that sentence is what objectui#9884
 * corrected. The remaining defect was the SILENCE, and this is it.
 *
 * ⚠️ Deliberately NOT fired for a member the object never declares at all —
 * a typo, or a detail-collection column borrowed into the parent's vocabulary.
 * That member resolves to nothing whether or not `fields` is authored, so it
 * is a different silence with a different remedy; it is pinned as behaviour by
 * `objectFormSectionMembers-8071` row 2 and `masterDetailSectionMembers-8071`
 * row 2, and widening this warning to cover it would make those two rows fire
 * it on every run while saying nothing this card measured.
 */
const warnedSectionMemberExcluded = new Set<string>();
export function warnSectionMemberExcludedByFields(
  memberName: string,
  objectName: string,
  sectionLabel?: string,
): void {
  const where = sectionLabel ? `section '${sectionLabel}'` : 'an untitled section';
  const key = `${objectName}:${where}:${memberName}`;
  if (warnedSectionMemberExcluded.has(key)) return;
  warnedSectionMemberExcluded.add(key);
  console.warn(
    `[object-ui] ${where} names '${memberName}', which object '${objectName}' declares, but the ` +
      `form's top-level \`fields\` does not list it — so it was dropped from the rendered form. ` +
      `Top-level \`fields\` and \`sections\` INTERSECT (the parent field pool is built from ` +
      `\`fields\` first, and every section resolves its members against that pool); they are ` +
      `alternatives, not layers. Author one or the other, or list every section member in ` +
      `\`fields\` too. A section that loses EVERY member this way disappears with its heading.`,
  );
}

/**
 * Build a runtime FormField from object-schema metadata for `fieldName`.
 *
 * The ONE object-field-to-FormField mapping in this package. Exported because
 * the flat (no-sections) containers need the identical mapping — see
 * `flatFields.ts`, and objectui#4755 for what a second hand-copied version
 * costs.
 */
export function fromObjectSchema(fieldName: string, ctx: SectionFieldsContext): FormField {
  const field = ctx.objectSchema?.fields?.[fieldName];
  if (!field) {
    return { name: fieldName, label: fieldName, type: 'input' } as FormField;
  }
  return {
    name: fieldName,
    label: ctx.fieldLabel(ctx.objectName, fieldName, field.label || fieldName),
    // The widget id is a function of the (type, multiple) PAIR, not of the type
    // alone: a `select` declared `multiple: true` renders the multi-value chip
    // picker, and the label-association declaration is keyed on the widget that
    // actually renders (objectui#3986).
    type: mapFieldTypeToFormType(field.type, { multiple: field.multiple }),
    // Mode-aware: a CREATE form does not enforce `required` on a field whose
    // `defaultValue` is a runtime instruction the server resolves at insert
    // (#4069) — the control is deliberately left empty for exactly that
    // resolution, so refusing the submit would leave nothing to type.
    required: isRequiredInForm(field, isCreateFormMode(ctx)),
    disabled: ctx.readOnly || ctx.mode === 'view' || field.readonly,
    placeholder: field.placeholder,
    // The help line under the control: the spec's `inlineHelpText`, else
    // `description`, through the one read `ObjectForm`'s field builder shares
    // (`fieldHelpText` from `@object-ui/fields`, objectui#12213).
    description: fieldHelpText(field),
    validation: buildValidationRules(field),
    field,
    options: field.options,
    multiple: field.multiple,
    // Field-level conditional rules (ADR-0036) — the form renderer resolves
    // them via `resolveFieldRuleState`; without this copy a sectioned form
    // silently dropped rules that the flat (schema-order) form honors.
    visibleWhen: field.visibleWhen,
    readonlyWhen: field.readonlyWhen,
    requiredWhen: field.requiredWhen,
  } as FormField;
}

/**
 * The field name a section entry resolves to — the identity rule of the three
 * shapes above, spelled once: a string is the name; a spec entry's identity is
 * its `field` STRING; an already-built runtime FormField's is its `name`.
 * `undefined` when the entry names nothing.
 */
export function sectionEntryName(fieldDef: unknown): string | undefined {
  if (typeof fieldDef === 'string') return fieldDef;
  if (fieldDef === null || typeof fieldDef !== 'object') return undefined;
  const fd = fieldDef as Record<string, unknown>;
  if (typeof fd.field === 'string') return fd.field;
  return typeof fd.name === 'string' ? fd.name : undefined;
}

/**
 * Normalize one section field definition (string | spec object | runtime
 * FormField) into a runtime FormField with a guaranteed `name`.
 */
export function normalizeSectionField(
  fieldDef: string | Record<string, any>,
  ctx: SectionFieldsContext,
): FormField {
  return resolveSectionEntry(fieldDef, ctx, undefined);
}

/**
 * {@link normalizeSectionField}'s body, with the one seam the default arm
 * needs: `pooled`, the field {@link SectionFieldsContext.pool} holds for this
 * entry's name, which replaces the generated / member BASE when given.
 * Module-private: a pooled base only ever comes from {@link buildSectionFields}.
 */
function resolveSectionEntry(
  fieldDef: string | Record<string, any>,
  ctx: SectionFieldsContext,
  pooled: FormField | undefined,
): FormField {
  // (1) string shorthand → build entirely from the object schema, unless a
  // `customFields` member names the field: the member is then the whole
  // definition, drawn as shape (3) below (objectui#10254). A pooled field is
  // already that resolution, so it is drawn as it is.
  if (typeof fieldDef === 'string') {
    if (pooled) return pooled;
    const member = findCustomFieldMember(ctx.customFields, fieldDef);
    if (member) return normalizeSectionField(member, ctx);
    // No view-level predicate is read off the object field (objectui#12719):
    // the spec `FieldSchema` declares no `visibleOn` (nor the snake_case
    // `visible_on`, objectui#12242). An object field's visibility is its
    // `visibleWhen`, which `fromObjectSchema` carries as the field-level rule.
    return fromObjectSchema(fieldDef, ctx);
  }

  const fd = fieldDef as Record<string, any>;

  // (3) already a runtime FormField (inline customFields): it carries its own
  // `name` (and usually `type`). NOTE: in the spec shape `field` is a *string*
  // (the field name); in a runtime FormField `field` is the *metadata object*.
  // So a string `field` is the disambiguator for the spec shape below.
  if (typeof fd.field !== 'string') {
    return attachVisibility(fd as FormField, fd.visibleOn);
  }

  // (2) spec FormFieldSchema object — merge base + spec overrides. The base is
  // the pooled field when the caller has a pool (objectui#10475), else the
  // `customFields` member naming the field when there is one, else the
  // object-schema field (objectui#10254) — a COPY in the first two cases: the
  // overrides below write onto it.
  warnOnMixedVocabulary(fd, ctx.objectName);
  const fieldName = fd.field;
  const member = findCustomFieldMember(ctx.customFields, fieldName);
  const base = (
    pooled ? { ...pooled } : member ? { ...member } : fromObjectSchema(fieldName, ctx)
  ) as any;

  if (fd.widget != null) base.widget = fd.widget;
  if (fd.label != null) base.label = fd.label;
  if (fd.placeholder != null) base.placeholder = fd.placeholder;
  if (fd.helpText != null) base.description = fd.helpText;
  // A view may restate `required` over the object field. Re-run the create-mode
  // test on the EFFECTIVE value (#4069): what excuses the field is the runtime
  // `defaultValue` on the object field, not which layer asserted `required` —
  // a form view saying `required: true` over `defaultValue: 'NOW()'` makes the
  // same claim the object schema does, and hits the same wall.
  if (fd.required != null) {
    base.required = isRequiredInForm(
      { required: fd.required, defaultValue: ctx.objectSchema?.fields?.[fieldName]?.defaultValue },
      isCreateFormMode(ctx),
    );
  }
  if (fd.readonly != null) base.disabled = fd.readonly || base.disabled;
  if (fd.immutable != null) base.immutable = fd.immutable;
  if (fd.hidden != null) base.hidden = fd.hidden;
  if (fd.colSpan != null) base.colSpan = fd.colSpan;
  if (fd.span != null) base.span = fd.span;
  if (fd.options != null) base.options = fd.options;
  if (fd.multiple != null) base.multiple = fd.multiple;
  // The widget id is decided ONCE, here, from the EFFECTIVE (type, multiple)
  // pair — because both halves are overridable at the view level and either one
  // alone moves the widget (objectui#3986). A view restating only `multiple:
  // true` over an object-schema `select` must land on the multi-value picker
  // just as a view restating `type: 'select'` alongside it does; resolving from
  // `fd.type` before `multiple` had been merged could see only one half.
  //
  // `rawType` is the PRE-alias spelling, kept because `base.type` is already the
  // mapped id (`field:…`) and re-deciding from it would need an inverse mapping.
  // Absent on both sides (a spec field naming nothing in the object schema and
  // declaring no type) it stays untouched — `fromObjectSchema`'s `input`.
  // Over a MEMBER base only the entry's own `type` re-decides: the object
  // schema's type is the generated definition's, which the member replaces
  // whole, and the member's `type` is drawn as authored, as the flat path
  // draws it.
  const rawType = fd.type ?? (member ? undefined : ctx.objectSchema?.fields?.[fieldName]?.type);
  if (rawType != null) base.type = mapFieldTypeToFormType(rawType, { multiple: base.multiple });
  // Spec canon for the lookup target is `reference` — `@objectstack/spec`'s
  // form-field schema declares it and refuses `reference_to` by name — and it
  // is the only spelling the lookup / user widgets read (objectui#11070
  // round 4), so it is the only one read and written here.
  if (fd.reference != null) base.reference = fd.reference;
  if (fd.maxLength != null) base.maxLength = fd.maxLength;
  if (fd.minLength != null) base.minLength = fd.minLength;
  if (fd.min != null) base.min = fd.min;
  if (fd.max != null) base.max = fd.max;
  if (fd.precision != null) base.precision = fd.precision;
  if (fd.scale != null) base.scale = fd.scale;
  if (fd.language != null) base.language = fd.language;
  if (Array.isArray(fd.fields)) base.fields = fd.fields;
  // View-level cascading declaration (spec FormField.dependsOn, a bare parent
  // name). The form renderer gates + recomputes options off the runtime
  // field's top-level `dependsOn`; without this copy the declaration vanished.
  if (fd.dependsOn != null) base.dependsOn = fd.dependsOn;
  // Record/composite widget config (ADR-0007). Pass-through: no widget reads
  // them from the runtime field yet, but dropping them here would make that
  // support impossible to ship metadata-first.
  if (fd.keyField != null) base.keyField = fd.keyField;
  if (fd.disclosure != null) base.disclosure = fd.disclosure;

  // View-level visibility predicate. ADR-0089 renamed it to `visibleWhen` —
  // which collides with the runtime slot holding the OBJECT-level rule (copied
  // from the object schema in `fromObjectSchema`). Route the view predicate
  // into the view-level slot (`visibleOn`, the RUNTIME FormField's own slot)
  // instead: the renderer evaluates the two slots independently and ANDs them,
  // so layering is preserved and the object rule is never clobbered.
  //
  // Read from the spec field's `visibleWhen` ONLY (objectui#12654): spec 18
  // retires the spec field's old `visibleOn` spelling as a `retiredKey`
  // tombstone (objectstack#23543 F4) — every parsing door refuses it by name
  // and a stored row is rehydrated to `visibleWhen` before it is served — so a
  // raw spec field still carrying it is not folded back here.
  return attachVisibility(base as FormField, fd.visibleWhen);
}

/**
 * Normalize every field def in a section, in the section's AUTHORED order.
 *
 * With a {@link SectionFieldsContext.pool}, a name-only entry naming a field
 * the pool does not hold is dropped, and a pooled field is the base the entry
 * starts from; a self-describing inline entry is drawn as it stands, pooled
 * or not (objectui#11615); the order stays the section's own either way
 * (objectui#10475).
 */
export function buildSectionFields(
  section: { fields?: Array<string | Record<string, any>> },
  ctx: SectionFieldsContext,
): FormField[] {
  const entries = section.fields ?? [];
  const pool = ctx.pool;
  if (!pool) return entries.map((fieldDef) => normalizeSectionField(fieldDef, ctx));

  // First pooled field of a name wins, the precedence `findCustomFieldMember`
  // gives a member.
  const pooledByName = new Map<string, FormField>();
  for (const f of pool) {
    if (f?.name && !pooledByName.has(f.name)) pooledByName.set(f.name, f);
  }
  const drawn: FormField[] = [];
  for (const fieldDef of entries) {
    // A self-describing inline entry needs nothing the pool holds: drawn the
    // way the pool-less branch above draws it (objectui#11615).
    if (isInlineFieldDef(fieldDef)) {
      drawn.push(normalizeSectionField(fieldDef, ctx));
      continue;
    }
    const name = sectionEntryName(fieldDef);
    const pooled = name === undefined ? undefined : pooledByName.get(name);
    if (!pooled) continue;
    drawn.push(resolveSectionEntry(fieldDef, ctx, pooled));
  }
  return drawn;
}
