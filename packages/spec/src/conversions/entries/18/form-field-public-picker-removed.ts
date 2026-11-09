// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `form-field-public-picker-removed` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `formFieldPublicPickerRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapViewPayloads } from '../../walk.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * [#21180] The form field's `publicPicker` block leaves the FormField
 * vocabulary (protocol 18, ADR-0087 D2 — the maintainer's ruling E on #21079,
 * comment 5933054144, which reverses the #7467 ruling that had declared it).
 *
 * The block opted a lookup / `master_detail` / `user` field on an ANONYMOUS
 * public form into a record-search picker served by an unauthenticated route.
 * The ruling retired the capability: anonymous public forms no longer take
 * those three field types, the route (`GET /forms/:slug/lookup/:field`) is
 * deleted, and the public-form resolve route now leaves them off the anonymous
 * rendering unconditionally. The schema tombstones the key with the
 * prescription (`FORM_FIELD_PUBLIC_PICKER_RETIRED`, `ui/view.zod.ts`); this
 * entry strips it from stored sources.
 *
 * A pure delete, and lossless in effect: the only reader of the block was the
 * deleted route, and the resolve route no longer consults it — the field is
 * left off the anonymous rendering whether or not a stored row still carries
 * the key. There is no conversion TO anything: an anonymous form that needs a
 * choice uses a `select` field with static `options`, and one that needs an
 * existing record goes behind sign-in — a judgement the semantic entry
 * `form-field-public-picker-retired` asks the upgrader to make.
 *
 * Walks the same payloads as `form-view-option-default-removed` — every FORM
 * payload {@link mapViewPayloads} reaches, in all three persisted spellings —
 * through `sections[]` / `groups[]` and top-level `fields[]`, recursing into
 * nested `fields`. Only the exact key `publicPicker` is stripped; a
 * string-shorthand field entry carries no keys and rides through untouched.
 */
const formFieldPublicPickerRemoved: MetadataConversion = {
  id: 'form-field-public-picker-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.5.0',
  surface: 'view.form.sections[].fields[].publicPicker',
  summary:
    "form field 'publicPicker' removed (ADR-0087 D2 — the anonymous public-form record-search "
    + 'picker is retired: an anonymous public form no longer takes lookup, master_detail or user '
    + 'fields, and the anonymous lookup route is gone. Use a select field with static options, or '
    + 'put the form behind sign-in)',
  apply(stack, emit) {
    const mapFields = (fields: unknown, path: string): unknown => {
      if (!Array.isArray(fields)) return fields;
      let changed = false;
      const next = fields.map((field, i) => {
        if (!isDict(field)) return field;
        let dict: Dict = stripKeys(field, ['publicPicker'], emit, `${path}[${i}]`);
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
        object: 'crm_inquiry',
        formViews: {
          contact: {
            sections: [{
              label: 'About you',
              fields: [
                // A string-shorthand entry carries no keys and rides through.
                'subject',
                // The measured authored shape: a lookup field opted into the
                // anonymous picker. The block goes whole, whatever it held.
                {
                  field: 'account',
                  publicPicker: { displayFields: ['name'], maxResults: 10, object: 'crm_account' },
                },
                // A nested row — the strip recurses through `fields`.
                {
                  field: 'details',
                  type: 'composite',
                  fields: [{ field: 'owner', publicPicker: { displayFields: ['name'] } }],
                },
              ],
            }],
            sharing: { allowAnonymous: true, publicLink: '/forms/contact' },
          },
        },
      }],
    },
    after: {
      views: [{
        object: 'crm_inquiry',
        formViews: {
          contact: {
            sections: [{
              label: 'About you',
              fields: [
                'subject',
                { field: 'account' },
                {
                  field: 'details',
                  type: 'composite',
                  fields: [{ field: 'owner' }],
                },
              ],
            }],
            sharing: { allowAnonymous: true, publicLink: '/forms/contact' },
          },
        },
      }],
    },
    // One per stripped field entry — the top-level row's block and the nested one's.
    expectedNotices: 2,
  },
};

export { formFieldPublicPickerRemoved };
