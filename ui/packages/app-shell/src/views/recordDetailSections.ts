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

import { deriveFieldGroupDetailSections } from '@object-ui/plugin-detail';
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

/** Display text the derivation writes into a section it authors itself. */
export interface RecordDetailSectionLabels {
  /** Heading of the collapsible secondary section (section name `details`). */
  moreDetails: string;
}

/**
 * The English heading of the "More details" section, for a surface with no
 * translator to hand: the Studio page-create seed, which persists it. It is the
 * en text of the `detail.sectionMoreDetails` key the runtime and the preview
 * translate (their call sites keep the literal default so `check:i18n-keys`
 * judges it against the en pack).
 */
export const MORE_DETAILS_DEFAULT_LABEL = 'More details';

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
    const splitPrimarySecondary = (keys: string[]) => {
      const primaryKeys = keys.filter((k) => !isSecondaryField(k, fields[k]));
      const secondaryKeys = keys.filter((k) => isSecondaryField(k, fields[k]));

      // Keep the legacy single-untitled-section behaviour when the
      // split would leave one side empty.
      if (secondaryKeys.length === 0 || primaryKeys.length === 0) {
        return [
          {
            showBorder: false as const,
            fields: keys.map(toField),
          },
        ];
      }

      return [
        {
          showBorder: false as const,
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
          fields: secondaryKeys.map(toField),
        },
      ];
    };

    // 1) fieldGroups-derived sections (the ADR-0085 semantic role,
    //    same shared derivation the runtime form honours). Declared
    //    groups render as titled cards in declared order; the
    //    trailing untitled bucket (ungrouped fields) still goes
    //    through the primary/"More details" split so long-form
    //    fields stay tucked away.
    const grouped = deriveFieldGroupDetailSections(objectDef as any);
    if (grouped) {
      return grouped.flatMap<Record<string, unknown>>((sec: any) => {
        if (!sec.name) {
          return splitPrimarySecondary(
            (sec.fields as any[]).map((f: any) => f.name),
          );
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
 * `undefined` when the object's `fieldGroups` apply: the synthesizer's own
 * `resolveDetailSections` then writes the groups as spec `{ group }`
 * references, which is what Studio has written for a grouped object since
 * objectui#11630, and this card leaves it so. Otherwise the running app's own
 * split — the same call, not a copy of it.
 */
export function deriveStudioDetailSections(
  objectDef: RecordDetailSectionsObject | null | undefined,
  labels: RecordDetailSectionLabels,
): Array<Record<string, unknown>> | undefined {
  if (!objectDef) return undefined;
  if (deriveFieldGroupDetailSections(objectDef as any)) return undefined;
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
