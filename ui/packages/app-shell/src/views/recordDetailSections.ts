/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The detail sections of an object's DEFAULT record page — one derivation for
 * every surface that builds that page (objectui#12442).
 *
 * The running app (`RecordDetailView`) always hands `buildDefaultPageSchema`
 * explicit sections: the object's field groups, else the visible fields split
 * into a primary section and a collapsible "More details" section. Studio's
 * page-create seed (`metadata-admin/anchors.ts`) and its slotted page preview
 * (`metadata-admin/previews/PagePreview.tsx`) used to call the synthesizer with
 * no sections, so on an object with no `fieldGroups` they drew a bare
 * `record:details` while the running app drew the split. All three now take
 * the sections from this module; ⛔ do not restate the split anywhere else.
 *
 * Pinned by `recordDetailSections.agreement-12442.test.ts` beside this file.
 */

import { deriveFieldGroupDetailSections, resolveDetailSections } from '@object-ui/plugin-detail/core';
import { BUILT_IN_LANGUAGE_CODES, loadBuiltInLocale } from '@object-ui/i18n';
import { AUDIT_FIELD_NAMES, HIDDEN_SYSTEM_FIELD_NAMES } from './record-detail-system-fields.js';

/**
 * Field-type signals that suggest a "secondary / system / metadata"
 * placement when auto-grouping fields. These move out of the main
 * section and into a collapsible "More details" section by default,
 * keeping the primary section dense with business-critical fields.
 *
 * The heuristic is conservative: when no objectDef metadata is available
 * we surface most fields in the main section; long-form text and
 * audit-by-name fields drop down.
 */
const SECONDARY_FIELD_NAME_HINTS = ['description', 'notes', 'note', 'remark', 'remarks', 'comments'];
/**
 * Matched against the RAW `objectDef.fields[x].type`, so every member must be a
 * `@objectstack/spec` `FieldType` name. `rich-text` was not one: the spec spells
 * the type `richtext` and REJECTS `rich-text`, which survives only as a typo key
 * in the spec's own `suggestFieldType` table — a spelling no producer can emit.
 * The member therefore demoted nothing while a real `richtext` field stayed in
 * the dense primary section, and the same field failed to read wide in the
 * detail and form auto-layouts, which carried the identical hole (#4250).
 */
const SECONDARY_FIELD_TYPES = new Set(['textarea', 'markdown', 'html', 'richtext', 'json', 'code']);

/**
 * Exported for the cross-surface pin in `richtextSurfaceParity.test.ts` — the
 * rule is the behaviour under test, not the set's string membership.
 * `RecordDetailView` re-exports it for that pin. Not re-exported from the
 * package barrel (`views/index.ts` names `RecordDetailView` only), so this
 * widens no public API.
 */
export function isSecondaryField(fieldName: string, fieldDef: any): boolean {
  if (SECONDARY_FIELD_TYPES.has(fieldDef?.type)) return true;
  const lc = fieldName.toLowerCase();
  return SECONDARY_FIELD_NAME_HINTS.some((hint) => lc === hint || lc.endsWith(`_${hint}`));
}

/** The object-definition keys the section derivation reads. */
export interface RecordDetailSectionsObject {
  name?: string;
  fields?: Record<string, any>;
  fieldGroups?: unknown;
}

/**
 * A section heading in one of the two forms `@objectstack/spec`'s `I18nLabel`
 * declares for `record:details` `sections[].label`: text, or an inline locale
 * map (`{ en, 'zh-Hans', … }`) that `record:details` resolves for the viewer's
 * language with `pickLocalized`.
 */
export type SectionHeading = string | Readonly<Record<string, string>>;

/** Display text the derivation writes into a section it authors itself. */
export interface RecordDetailSectionLabels {
  /**
   * Heading of the collapsible secondary section (section name `details`).
   *
   * A surface that draws the page passes the translated text. A surface that
   * PERSISTS the page passes {@link loadPersistedSectionLabels}' inline locale
   * map, so the saved heading stays translated.
   */
  moreDetails: SectionHeading;
  /**
   * Heading of the section holding the fields no declared field group claims
   * (`deriveFieldGroupLayout`'s keyless trailing bucket). Read only when the
   * object's `fieldGroups` apply, so the bucket always follows at least one
   * titled group and never sits headerless under it (a collapsed one
   * included). An object with no groups keeps its untitled primary section.
   *
   * A surface that draws the page passes the translated text. A surface that
   * PERSISTS the page passes {@link loadPersistedSectionLabels}' inline locale
   * map, so the saved heading stays translated.
   */
  ungrouped: SectionHeading;
}

/**
 * The English heading of the "More details" section: the en text of the
 * `detail.sectionMoreDetails` key the runtime and the preview translate (their
 * call sites keep the literal default so `check:i18n-keys` judges it against
 * the en pack). ⛔ Never persisted as a heading: a page Studio saves carries
 * {@link loadPersistedSectionLabels}' locale map instead.
 */
export const MORE_DETAILS_DEFAULT_LABEL = 'More details';

/**
 * The English heading of the ungrouped-fields section: the en text of the
 * `common.ungroupedSection` key. ⛔ Never persisted as a heading: a page Studio
 * saves carries {@link loadPersistedSectionLabels}' locale map instead.
 */
export const UNGROUPED_SECTION_DEFAULT_LABEL = 'Other';

/** The English headings, for a page that writes neither heading. */
const ENGLISH_SECTION_LABELS: RecordDetailSectionLabels = {
  moreDetails: MORE_DETAILS_DEFAULT_LABEL,
  ungrouped: UNGROUPED_SECTION_DEFAULT_LABEL,
};

/**
 * Whether the object's default record page writes a heading of the
 * derivation's own: the ungrouped bucket's when the object's `fieldGroups`
 * apply, else the "More details" section's when the split yields one.
 */
function writesDerivedHeading(objectDef: RecordDetailSectionsObject): boolean {
  if (deriveFieldGroupDetailSections(objectDef as any) !== null) return true;
  return deriveRecordDetailSections(objectDef, ENGLISH_SECTION_LABELS).some((section) => section.name === 'details');
}

/**
 * The derivation's own headings in the form a PERSISTED page writes them: each
 * an inline locale map holding its key's text in every catalogue
 * `@object-ui/i18n` ships, keyed by the catalogue's language tag —
 * `detail.sectionMoreDetails` for `moreDetails`, `common.ungroupedSection` for
 * `ungrouped`.
 *
 * A saved page is metadata, so it cannot carry the shell's `t()` call, and a
 * plain string would render in one language for every viewer. The inline map
 * is the `I18nLabel` form `@objectstack/spec` declares for exactly this, and
 * `record:details` resolves it for the viewer's language (`pickLocalized`), so
 * the saved page reads the same heading the running page translates. The
 * "More details" section keeps its `name: 'details'`, and `record:details`
 * hands the resolved text to `sectionLabel` as the fallback, so the object's
 * own `objects.OBJECT._sections.details.label` still wins over the map.
 *
 * The catalogues are fetched only when the page writes one of these headings.
 * Otherwise it answers the English defaults, which no section reads. A
 * catalogue that fails to load rejects the whole call: a partial map would
 * save English for the missing languages.
 */
export async function loadPersistedSectionLabels(
  objectDef: RecordDetailSectionsObject | null | undefined,
): Promise<RecordDetailSectionLabels> {
  if (!objectDef || !writesDerivedHeading(objectDef)) return ENGLISH_SECTION_LABELS;
  const catalogues = await Promise.all(
    BUILT_IN_LANGUAGE_CODES.map(async (code) => [code, await loadBuiltInLocale(code)] as const),
  );
  const moreDetails: Record<string, string> = {};
  const ungrouped: Record<string, string> = {};
  const put = (heading: Record<string, string>, code: string, namespace: unknown, key: string) => {
    const text = (namespace as Record<string, unknown> | undefined)?.[key];
    if (typeof text === 'string' && text.length > 0) heading[code] = text;
  };
  for (const [code, catalogue] of catalogues) {
    put(moreDetails, code, catalogue?.detail, 'sectionMoreDetails');
    put(ungrouped, code, catalogue?.common, 'ungroupedSection');
  }
  return { moreDetails, ungrouped };
}

/**
 * The sections the running app's default record page passes to
 * `buildDefaultPageSchema` (ADR-0085: grouping is the `fieldGroups` semantic
 * role — there is no per-surface sections override; per-page customization
 * goes through an assigned Page schema):
 *   1) sections derived from the object's `fieldGroups`;
 *   2) auto-grouping (primary + collapsible "More details").
 *
 * Field entries are rich descriptors (`{ name, label, type, … }`), the shape
 * `DetailSection` renders. A surface that PERSISTS the sections writes them
 * through {@link toAuthoredDetailSections} instead.
 */
export function deriveRecordDetailSections(
  objectDef: RecordDetailSectionsObject,
  labels: RecordDetailSectionLabels,
): Array<Record<string, unknown>> {
  const fields: Record<string, any> = objectDef.fields || {};
    const toField = (key: string) => {
      const fieldDef = fields[key];
      // objectui#6837 half 2 — maintainer 2026-08-31: protocol normalization
      // belongs on the SERVER, the front end just executes the protocol.
      // `reference` is the only target spelling `@objectstack/spec`'s
      // `FieldSchema` declares; it refuses `reference_to` by name with its own
      // "did you mean -> `reference`?" rename. objectstack#13847 rewrites
      // stored `reference_to` on the serve path and in `os migrate meta`. A
      // legacy-only def is canonicalised ONCE at the ingestion choke point
      // (`normalizeSchemaReferenceKeys`, which warns in dev) — never here.
      const refTarget = fieldDef.reference;
      return {
        name: key,
        label: fieldDef.label || key,
        type: fieldDef.type || 'text',
        ...(fieldDef.options && { options: fieldDef.options }),
        ...(refTarget && { reference: refTarget }),
        ...(fieldDef.reference_field && { reference_field: fieldDef.reference_field }),
        ...(fieldDef.currency && { currency: fieldDef.currency }),
      };
    };

    // Auto-grouping (platform B): split fields into a primary section
    // and a collapsible "More details" section so long-form/secondary
    // fields don't dilute the main grid. The primary section stays
    // untitled so DetailSection still flattens its chrome when alone.
    // Shared by the pure-fallback path and the ungrouped remainder of
    // the fieldGroups path below.
    //
    // objectstack#36404 — every section the split writes says
    // `hideEmpty: false`. `record:details` resolves an omitted `hideEmpty`
    // to `true` on the sections it is handed, and an all-empty section with
    // `true` renders nothing and is left out of the record page's one
    // 「Show N empty fields」 row (objectstack#36147). Nobody authored these
    // sections, so nobody can write `false` on them: an empty "More details"
    // section (an empty long-text field alone) vanished from read mode, its
    // field uncounted and unrevealable. Written here, at the producer, they
    // fold their empty rows like every other group: counted by that row,
    // drawn in place when the reader shows them.
    const splitPrimarySecondary = (keys: string[]) => {
      const primaryKeys = keys.filter((k) => !isSecondaryField(k, fields[k]));
      const secondaryKeys = keys.filter((k) => isSecondaryField(k, fields[k]));

      // Keep the legacy single-untitled-section behaviour when the
      // split would leave one side empty.
      if (secondaryKeys.length === 0 || primaryKeys.length === 0) {
        return [
          {
            showBorder: false as const,
            hideEmpty: false as const,
            fields: keys.map(toField),
          },
        ];
      }

      return [
        {
          showBorder: false as const,
          hideEmpty: false as const,
          fields: primaryKeys.map(toField),
        },
        {
          name: 'details',
          // The heading rides `label` — the one slot `record:details`
          // reads and `@object-ui/types` declares (objectui#6190). This
          // section is authored HERE, not emitted by the synthesizer, so
          // it has to carry the declared slot at its own source.
          label: labels.moreDetails,
          collapsible: true,
          defaultCollapsed: false,
          showBorder: true as const,
          hideEmpty: false as const,
          fields: secondaryKeys.map(toField),
        },
      ];
    };

    // 1) fieldGroups-derived sections (the ADR-0085 semantic role,
    //    same shared derivation the runtime form honours). Declared
    //    groups render as titled cards in declared order; the
    //    trailing keyless bucket (ungrouped fields) still goes
    //    through the primary/"More details" split so long-form
    //    fields stay tucked away.
    const grouped = deriveFieldGroupDetailSections(objectDef as any);
    if (grouped) {
      return grouped.flatMap<Record<string, unknown>>((sec: any) => {
        if (!sec.name) {
          // The bucket only exists after at least one declared group, so
          // its primary half gets its own heading and card: drawn
          // untitled, its fields read as members of the group above it,
          // and as hidden ones when that group is collapsed. No `name`, so
          // `record:details` uses the translated label as written.
          const [primary, ...rest] = splitPrimarySecondary(
            (sec.fields as any[]).map((f: any) => f.name),
          );
          return [{ ...primary, label: labels.ungrouped, showBorder: true as const }, ...rest];
        }
        // A declared group is written as the spec's own REFERENCE form,
        // `{ group: KEY }` (`RecordDetailsProps.sections[].group`,
        // ADR-0085 §5), never as an enumerated copy of the group
        // (objectui#11630). `record:details` resolves it against the
        // object's `fieldGroups` — members, heading (through the same
        // per-object i18n convention, `sectionLabel`), icon,
        // description, collapse — and evaluates the group's
        // `visibleWhen` against this record, which an enumerated copy
        // cannot carry: the spec refuses `visibleWhen` on one. The
        // Card chrome stays this page's layout choice, a key the spec
        // permits beside `group`.
        return [{ group: sec.name as string, showBorder: true as const }];
      });
    }

    // 3) Pure auto-grouping fallback.
    const allFields = Object.keys(fields)
      .filter((key) => !AUDIT_FIELD_NAMES.has(key) && !HIDDEN_SYSTEM_FIELD_NAMES.has(key) && !fields[key]?.hidden);
    return splitPrimarySecondary(allFields);
}

/**
 * The sections a Studio surface passes to `buildDefaultPageSchema` for the
 * object's default record page.
 *
 * When the object's `fieldGroups` apply: the synthesizer's own sections
 * (`resolveDetailSections`), which write each group as the spec's
 * `{ group, columns }` reference and the trailing ungrouped bucket as an
 * enumerated section, with the bucket headed by `labels.ungrouped`. Untitled,
 * that bucket read as part of the group above it, while the running page draws
 * it under its own heading. Otherwise the running app's own split — the same
 * call, not a copy of it.
 */
export function deriveStudioDetailSections(
  objectDef: RecordDetailSectionsObject | null | undefined,
  labels: RecordDetailSectionLabels,
): Array<Record<string, unknown>> | undefined {
  if (!objectDef) return undefined;
  const references = resolveDetailSections(objectDef as any) as Array<Record<string, unknown>> | undefined;
  if (references) {
    return references.map((section) =>
      typeof section.group === 'string' ? section : { label: labels.ungrouped, ...section },
    );
  }
  return deriveRecordDetailSections(objectDef, labels);
}

/**
 * The derived sections in the shape a page PERSISTS: each field entry reduced
 * to its name, the only `fields` spelling `@objectstack/spec`'s
 * `RecordDetailsProps.sections[].fields` declares. `record:details` re-reads
 * the label, type, options and reference of a named field from the object
 * definition (`DetailSection`'s `enrichDetailField`), so the page draws what
 * the rich descriptors draw. A section without `fields` (a `{ group }`
 * reference) passes through unchanged.
 */
export function toAuthoredDetailSections(
  sections: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!sections) return undefined;
  return sections.map((section) =>
    Array.isArray(section.fields)
      ? {
          ...section,
          fields: section.fields.map((f: unknown) =>
            typeof f === 'string' ? f : (f as { name: string }).name,
          ),
        }
      : section,
  );
}
