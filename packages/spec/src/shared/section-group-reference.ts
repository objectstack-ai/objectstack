// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Section → field-group REFERENCE — the shared mixing rule for both layout
 * escape hatches (#13855, maintainer ruling 2026-08-31: 「直接处理b」).
 *
 * ## What this closes
 *
 * ADR-0085 makes `fieldGroups` + `Field.group` the canonical grouping, assembled
 * in ONE place — `deriveFieldGroupLayout` (ADR-0085 §5). The two layout escape
 * hatches — a custom record page's `record:details` `properties.sections`, and a
 * view-level `form.sections` — were whole-takeover shapes: every section
 * enumerated its members by hand, with zero mechanical link back to the
 * declaration. An author who reached for either had to hand-copy the same
 * membership fact a second and third time, and every field added to the object
 * afterwards made those copies quietly staler. Measured on a real app: three
 * disagreeing groupings of one object, with the detail page missing two fields
 * the form showed.
 *
 * A section may now name a declared group instead: `{ group: 'contact_info' }`.
 * Membership and the group's own presentation (label, icon, description,
 * collapse, `visibleWhen`, and the empty-group drop) come from
 * `deriveFieldGroupLayout` — the section re-declares none of it.
 *
 * ## The mixing rule, in one place because it is the same rule twice
 *
 * The two section vocabularies are not identical (a form section has
 * `visibleWhen`/`pane`; a detail section has `hideEmpty`/`showBorder`/
 * `headerColor`), but the RULE over them is, so it is declared once and each
 * surface passes its own key names in. Two copies of a mixing rule is how one
 * gets fixed and the other does not.
 *
 * 1. **A section declares its members exactly one way.** `group` and `fields`
 *    are mutually exclusive, and a section that declares NEITHER is refused —
 *    it has no body at all, and before this shape existed that was
 *    unrepresentable because `fields` was required.
 * 2. **A group-referencing section carries no key the group already declares.**
 *    Not a precedence rule — the ABSENCE of one. Letting a section restate
 *    `label` / `collapse` / `visibleWhen` beside `group` would put group
 *    presentation back in section land, which is the one thing ADR-0085 §5
 *    single-sources; and two writable spellings of one fact is the hand-copy
 *    this whole reference form exists to remove. Refused at parse with the
 *    pointer to the `fieldGroups` entry that owns the key.
 *
 *    ⚠️ This is the CONSERVATIVE direction on purpose. Refusing now and
 *    allowing section-level overrides later is additive; shipping overrides and
 *    withdrawing them later is a breaking change. The alternative reading —
 *    section keys override the group's — is named in the PR body for contract
 *    review rather than decided here.
 * 3. **Across sections, both kinds coexist in declared array order.** A
 *    group-referencing section occupies exactly one slot and expands in place
 *    to that group's derived members. Nothing about ordering changes: `sections`
 *    is still read top to bottom.
 *
 * ## What this module deliberately does NOT do
 *
 * It never resolves the key. A section schema cannot see the object's
 * `fieldGroups` — that is a cross-schema reference, and this repo has one
 * channel for those: reference diagnostics (the `UserFilterFieldSchema.field`
 * precedent, *"must exist — checked by reference diagnostics"*). Parse accepts
 * any well-formed key; `page-section-group-unknown` / `form-section-group-unknown`
 * in `@objectstack/lint` report one that resolves to nothing.
 */

import { z } from 'zod';

import { FIELD_GROUP_KEY_PATTERN } from '../data/field-group-layout';

/**
 * The `group` key as a layout section writes it — the same grammar the
 * declaring `ObjectFieldGroupSchema.key` enforces, read from the one pattern
 * both share so the reference cannot accept a key the declaration refuses.
 *
 * Existence is NOT checked here (see the module note): a well-formed key that
 * names no declared group parses, and reference diagnostics report it.
 */
export const SectionGroupKeySchema = z.string().regex(FIELD_GROUP_KEY_PATTERN, {
  message: 'Field group key must be lowercase snake_case (e.g., "contact_info", "billing", "system")',
});

/** The section keys this rule reads, as any surface's section may carry them. */
interface SectionLike {
  group?: unknown;
  fields?: unknown;
  [key: string]: unknown;
}

export interface SectionGroupReferenceOptions {
  /** Prose name of the section surface, e.g. ``'this `record:details` section'``. */
  surface: string;
  /**
   * Keys whose value `deriveFieldGroupLayout` supplies from the group — refused
   * beside `group`, whatever they are set to.
   */
  derivedKeys: readonly string[];
  /**
   * Derived keys carrying a schema `.default(false)`, so by the time an
   * object-level refinement runs an authored `false` is indistinguishable from
   * the default. Only `true` is refused — the same asymmetry, for the same
   * reason, as the wizard step-key refusals in `view.zod.ts`.
   */
  trueOnlyDerivedKeys?: readonly string[];
}

/**
 * The shared mixing rule as a `superRefine` body. Attach to a section shape
 * whose `group` and `fields` are both optional:
 *
 * ```ts
 * strictObject({ … }, { group: SectionGroupKeySchema.optional(), fields: […].optional(), … })
 *   .superRefine(sectionGroupReferenceRefinement({ surface: '…', derivedKeys: […] }))
 * ```
 */
export function sectionGroupReferenceRefinement(
  options: SectionGroupReferenceOptions,
): (section: SectionLike, ctx: z.RefinementCtx) => void {
  const { surface, derivedKeys, trueOnlyDerivedKeys = [] } = options;
  return (section, ctx) => {
    if (!section || typeof section !== 'object') return;
    const groupKey = typeof section.group === 'string' ? section.group : undefined;
    const hasGroup = groupKey !== undefined && groupKey.length > 0;
    // PRESENCE, not non-emptiness: `fields: []` is an authored (if empty)
    // enumeration and parsed before this key existed, so it must keep parsing.
    const hasFields = Array.isArray(section.fields);

    if (hasGroup && hasFields) {
      ctx.addIssue({
        code: 'custom',
        path: ['group'],
        message:
          '`group` and `fields` are mutually exclusive on ' + surface + '. `group` DERIVES the '
          + "member list from the object's declared `fieldGroups` entry (`deriveFieldGroupLayout`, "
          + 'ADR-0085 §5); `fields` enumerates it by hand. Writing both makes two sources for one '
          + 'fact — the hand-copy this reference form exists to remove, and the copy is what goes '
          + "stale as the object gains fields. Keep `group: '" + groupKey + "'` to inherit the "
          + 'group, or drop `group` and keep the enumerated `fields`.',
      });
      return;
    }

    if (!hasGroup && !hasFields) {
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message:
          'A section must declare its members exactly one way, and ' + surface + ' declares '
          + "neither: write `fields: ['a', 'b']` to enumerate them, or `group: '<field group key>'` "
          + "to inherit the object's declared `fieldGroups` entry (membership and the group's own "
          + 'presentation are derived by `deriveFieldGroupLayout`, ADR-0085 §5). A section with '
          + 'neither has no body and renders nothing.',
      });
      return;
    }

    if (!hasGroup) return;

    for (const key of derivedKeys) {
      if (section[key] === undefined) continue;
      ctx.addIssue({ code: 'custom', path: [key], message: derivedKeyMessage(key, groupKey, surface) });
    }
    for (const key of trueOnlyDerivedKeys) {
      if (section[key] !== true) continue;
      ctx.addIssue({ code: 'custom', path: [key], message: derivedKeyMessage(key, groupKey, surface) });
    }
  };
}

function derivedKeyMessage(key: string, groupKey: string | undefined, surface: string): string {
  return (
    '`' + key + '` cannot be combined with `group` on ' + surface + '. A group-referencing '
    + "section takes its presentation from the object's `fieldGroups` entry for `"
    + (groupKey ?? '<key>') + '` — `deriveFieldGroupLayout` (ADR-0085 §5) is the single source of '
    + 'the label, icon, description, collapse state and `visibleWhen` a group renders with, so '
    + 'restating one here would be a second writable spelling of the same fact. Set `' + key
    + '` on that `fieldGroups` entry instead (it then applies on every surface the group renders '
    + 'on), or drop `group` and enumerate `fields` to author this section standalone.'
  );
}
