// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `view-visibleOn-to-visibleWhen` conversion (`toMajor:
// 15`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `viewVisibleOnToVisibleWhen` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapViewPayloads } from '../../walk.js';
import { type Dict, renameVisibilityAlias } from '../shared.js';

/**
 * View form `visibleOn` → `visibleWhen` (protocol 15, ADR-0089 D2).
 *
 * The conditional-visibility predicate is unified under the canonical
 * `visibleWhen` across all layers. Applies to form sections and (recursively
 * nested) form fields in every FORM payload {@link mapViewPayloads} reaches —
 * `views[].form` / `views[].formViews.*`, a ViewItem record's `config`, and a
 * flattened form overlay's top level (commit b799ac553).
 *
 * ## Retired from the load path at 18 (#23543, ruling F4 A)
 *
 * Through 17 it stayed live because `visibleOn` was still a declared
 * `[DEPRECATED]` key on the form field and section schemas, which folded it
 * into `visibleWhen` at parse, so retired alone it would have left the old
 * spelling silently accepted (the verdict #23487 recorded). The ruling retired
 * the key: both shapes carry a `retiredKey()` tombstone naming `visibleWhen`
 * (`FORM_FIELD_VISIBLE_ON_RETIRED` / `FORM_SECTION_VISIBLE_ON_RETIRED`,
 * `ui/view.zod.ts`), and the fold went with it. So the authoring funnel
 * (`defineStack`, `os validate` / `os build` / `os lint`) no longer replays
 * this entry, and an author is taught the canonical key instead of being
 * rewritten. Stored form views are the `includeRetired` seams: stored-row
 * rehydration (`applyConversionsToStoredItem`) still renames a `sys_metadata`
 * view row's `visibleOn` before anything parses it, and so does the
 * artifact-ingestion door inside its window. `os migrate meta` does not reach
 * it: protocol 15 is below `MIGRATION_SUPPORT_FLOOR`. The family's D3 entry,
 * `ui-visibility-alias-keys-retired`, states the edit for authored sources.
 */
const viewVisibleOnToVisibleWhen: MetadataConversion = {
  id: 'view-visibleOn-to-visibleWhen',
  toMajor: 15,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'view.form.visibleOn',
  summary: "view form section/field key 'visibleOn' → 'visibleWhen' (ADR-0089)",
  apply(stack, emit) {
    const mapFields = (fields: unknown, path: string): unknown => {
      if (!Array.isArray(fields)) return fields;
      let changed = false;
      const next = fields.map((field, i) => {
        if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
        let dict = field as Record<string, unknown>;
        dict = renameVisibilityAlias(dict, 'visibleOn', `${path}[${i}]`, emit);
        const nested = mapFields(dict.fields, `${path}[${i}].fields`);
        if (nested !== dict.fields) dict = { ...dict, fields: nested };
        if (dict !== field) changed = true;
        return dict;
      });
      return changed ? next : fields;
    };

    const mapSections = (sections: unknown, path: string): unknown => {
      if (!Array.isArray(sections)) return sections;
      let changed = false;
      const next = sections.map((section, i) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
        let dict = section as Record<string, unknown>;
        dict = renameVisibilityAlias(dict, 'visibleOn', `${path}[${i}]`, emit);
        const fields = mapFields(dict.fields, `${path}[${i}].fields`);
        if (fields !== dict.fields) dict = { ...dict, fields };
        if (dict !== section) changed = true;
        return dict;
      });
      return changed ? next : sections;
    };

    const mapForm = (form: unknown, path: string): unknown => {
      if (!form || typeof form !== 'object' || Array.isArray(form)) return form;
      let dict = form as Record<string, unknown>;
      for (const key of ['sections', 'groups'] as const) {
        const mapped = mapSections(dict[key], `${path}.${key}`);
        if (mapped !== dict[key]) dict = { ...dict, [key]: mapped };
      }
      const fields = mapFields(dict.fields, `${path}.fields`);
      if (fields !== dict.fields) dict = { ...dict, fields };
      return dict;
    };

    return mapViewPayloads(stack, (payload, kind, path) => {
      if (kind !== 'form') return payload;
      return mapForm(payload, path) as Dict;
    });
  },
  fixture: {
    before: {
      views: [
        {
          object: 'crm_lead',
          form: {
            sections: [
              {
                label: 'Details',
                visibleOn: "record.status == 'open'",
                fields: ['name', { field: 'priority', visibleOn: "record.priority != ''" }],
              },
            ],
          },
        },
      ],
    },
    after: {
      views: [
        {
          object: 'crm_lead',
          form: {
            sections: [
              {
                label: 'Details',
                visibleWhen: "record.status == 'open'",
                fields: ['name', { field: 'priority', visibleWhen: "record.priority != ''" }],
              },
            ],
          },
        },
      ],
    },
    expectedNotices: 2,
  },
};

export { viewVisibleOnToVisibleWhen };
