// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `form-view-option-default-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `formViewOptionDefaultRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapViewPayloads } from '../../walk.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * [commit c459da6bc] The per-option `default` key leaves the FORM-VIEW options
 * vocabulary (protocol 18; maintainer-ruled narrowing 2026-08-28 on the
 * objectui#6263 analysis, disposition 甲).
 *
 * `SelectOptionSchema` serves two surfaces and only one reads the key: on an
 * OBJECT field's option list `default` is ENFORCED (#7246 / PR #7388 —
 * `applyFieldDefaults` falls back to the option marked `default: true`), and
 * that face is untouched by this conversion. On a form-view field's option
 * list the key parsed clean and nothing read it — the engine's insert-path
 * fallback consults the object definition's options, never a form view's, and
 * no form renderer seeds a value from it (measured on objectui#6263). The
 * FormView vocabulary now refuses the key (`FormSelectOptionSchema`,
 * `ui/view.zod.ts`) with the prescription; this entry strips it from stored
 * sources, a pure lossless delete (it never had an effect on this surface to
 * lose).
 *
 * Walks the same payloads as `view-visibleOn-to-visibleWhen` — every FORM
 * payload {@link mapViewPayloads} reaches, in all three persisted spellings
 * (commit b799ac553) — through `sections[]`/`groups[]` and top-level
 * `fields[]`, recursing into nested `fields` (composite/repeater/record rows
 * carry their own option lists). Only the exact key `default` is stripped —
 * the alias spellings `isDefault`/`selected` were never accepted on this
 * surface (the option shape has been strict since it closed), so there is
 * nothing stored to strip for them.
 */
const formViewOptionDefaultRemoved: MetadataConversion = {
  id: 'form-view-option-default-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.2.0',
  surface: 'view.form.sections[].fields[].options[].default',
  summary:
    "form-view per-option 'default' removed from the FormView vocabulary (ADR-0049 "
    + 'declared-but-unenforced — nothing on the form path read it: the insert-path default '
    + "falls back to the OBJECT definition's option list, and no form renderer seeds a value "
    + "from a form view's. The object field option's 'default' stays enforced; declare the "
    + "pre-selected choice there — field-level 'defaultValue', or 'default: true' on that "
    + "field's own options entry)",
  apply(stack, emit) {
    const stripOptionDefault = (options: unknown, path: string): unknown => {
      if (!Array.isArray(options)) return options;
      let changed = false;
      const next = options.map((opt, i) => {
        if (!isDict(opt)) return opt;
        const stripped = stripKeys(opt, ['default'], emit, `${path}[${i}]`);
        if (stripped !== opt) changed = true;
        return stripped;
      });
      return changed ? next : options;
    };
    const mapFields = (fields: unknown, path: string): unknown => {
      if (!Array.isArray(fields)) return fields;
      let changed = false;
      const next = fields.map((field, i) => {
        if (!isDict(field)) return field;
        let dict: Dict = field;
        const options = stripOptionDefault(dict.options, `${path}[${i}].options`);
        if (options !== dict.options) dict = { ...dict, options };
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
        if (!isDict(section)) return section;
        let dict: Dict = section;
        const fields = mapFields(dict.fields, `${path}[${i}].fields`);
        if (fields !== dict.fields) dict = { ...dict, fields };
        if (dict !== section) changed = true;
        return dict;
      });
      return changed ? next : sections;
    };
    const mapForm = (form: unknown, path: string): unknown => {
      if (!isDict(form)) return form;
      let dict: Dict = form;
      for (const key of ['sections', 'groups'] as const) {
        const mapped = mapSections(dict[key], `${path}.${key}`);
        if (mapped !== dict[key]) dict = { ...dict, [key]: mapped };
      }
      const fields = mapFields(dict.fields, `${path}.fields`);
      if (fields !== dict.fields) dict = { ...dict, fields };
      return dict;
    };
    return mapViewPayloads(stack, (payload, kind, path) =>
      kind === 'form' ? (mapForm(payload, path) as Dict) : payload);
  },
  fixture: {
    before: {
      views: [{
        object: 'crm_task',
        form: {
          sections: [{
            label: 'Details',
            fields: [
              // The measured authored shape: a select row whose option carries
              // the key nothing on the form path read.
              {
                field: 'status',
                type: 'select',
                options: [
                  { label: 'Open', value: 'open', default: true },
                  { label: 'Closed', value: 'closed' },
                ],
              },
              // A nested row (composite) — options recurse through `fields`.
              {
                field: 'meta',
                type: 'composite',
                fields: [
                  {
                    field: 'priority',
                    type: 'radio',
                    options: [
                      { label: 'Low', value: 'low' },
                      { label: 'High', value: 'high', default: true },
                    ],
                  },
                ],
              },
            ],
          }],
        },
        formViews: {
          quick: {
            fields: [{
              field: 'channel',
              type: 'select',
              options: [
                { label: 'Email', value: 'email', default: true },
                // An option WITHOUT the key rides through untouched.
                { label: 'Phone', value: 'phone' },
              ],
            }],
          },
        },
      }],
    },
    after: {
      views: [{
        object: 'crm_task',
        form: {
          sections: [{
            label: 'Details',
            fields: [
              {
                field: 'status',
                type: 'select',
                options: [
                  { label: 'Open', value: 'open' },
                  { label: 'Closed', value: 'closed' },
                ],
              },
              {
                field: 'meta',
                type: 'composite',
                fields: [
                  {
                    field: 'priority',
                    type: 'radio',
                    options: [
                      { label: 'Low', value: 'low' },
                      { label: 'High', value: 'high' },
                    ],
                  },
                ],
              },
            ],
          }],
        },
        formViews: {
          quick: {
            fields: [{
              field: 'channel',
              type: 'select',
              options: [
                { label: 'Email', value: 'email' },
                { label: 'Phone', value: 'phone' },
              ],
            }],
          },
        },
      }],
    },
    // Three notices: one stripped key per option carrying it — the `form`
    // section row, its nested composite row, and the named `formViews` entry.
    expectedNotices: 3,
  },
};

export { formViewOptionDefaultRemoved };
