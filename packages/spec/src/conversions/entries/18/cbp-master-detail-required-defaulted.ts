// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `cbp-master-detail-required-defaulted` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `cbpMasterDetailRequiredDefaulted` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict } from '../shared.js';

/**
 * The one `master_detail` of a `controlled_by_parent` object with `required`
 * OMITTED → `required: true` (protocol 18, #23100 — ADR-0055 §1, maintainer
 * ruling B; the data-at-rest half of the D3 semantic entry
 * `cbp-master-relation-tiers-retired`).
 *
 * Ruling B made the parse refuse a `controlled_by_parent` object without
 * exactly one `master_detail` declared `required: true`, and retired the
 * security runtime's second tier, which derived the master from ANY
 * `master_detail`. One shape inside that refusal has a producer at rest:
 * objectui's Studio adds a field as `{ type, label }` and its Required toggle
 * writes `required: true` or nothing, and the object's Settings tab offers
 * `controlled_by_parent`. So a Studio-authored detail can be stored with its
 * one master reference carrying no `required` key at all. Before protocol 18
 * that row loaded and derived its master through the second tier; after it, the
 * row would register under `[metadata_spec_invalid]` and be denied every read.
 *
 * **Lossless — this is the builder's own force, applied to data at rest.**
 * `ObjectSchema.create()` already turns an omitted `required` on every
 * `master_detail` under this sharing model into `required: true`
 * (`forceCbpMasterDetailRequired`, `data/object.zod.ts`), so the converted row
 * is exactly the object the builder would have produced from the same source.
 * The relation it resolves is the one the second tier resolved. Of the two
 * writes the row could not legally take, the insert without its master was
 * refused before as well, by the security gate: on an insert
 * `packages/plugins/plugin-security/src/security-plugin.ts#assertControlledByParentWrite`
 * reads the master FK from the incoming body. The update nulling it was not.
 * On a by-id update that gate reads the STORED row's FK, never the incoming
 * value, so the write was accepted and left a detail row with a null master
 * FK, which the `controlled_by_parent` read filter
 * (`masterFK IN (accessible master ids)`) never matches. The refusal for that
 * update is the record validator's ADR-0113 check, a PATCH may not null out a
 * required field (the update branch of
 * `packages/objectql/src/validation/record-validator.ts#validateRecordInScope`),
 * and only `required: true` arms it. So the converted row loses no write the
 * contract allows: it gains the refusal the builder's force already gives an
 * authored object.
 *
 * **Deliberately narrow — exactly one shape, nothing else.**
 * - An explicit `required: false` is NOT converted. The builder refuses it
 *   loudly rather than forcing it (an authored contradiction, ADR-0032), so the
 *   stored pass does not overrule an author the builder would have stopped.
 * - An object with two or more `master_detail` fields is NOT converted. Choosing
 *   which reference becomes the master is exactly the pick ADR-0055 §1 refuses.
 * - A required `lookup` (the retired third tier) is NOT converted. Turning it
 *   into a `master_detail` changes what deleting the master does to every row.
 * - Any other sharing model is NOT touched. The force is this sharing model's
 *   rule only.
 *
 * **Retired from the load path, from day one.** The authoring funnel does not
 * replay it, so a live author still meets the parse's refusal and its
 * prescription. A stored row, a built artifact inside its declared-floor window
 * and `os migrate meta --from 17` all replay it. Idempotent by construction: a
 * converted field carries `required`, which this transform never touches again.
 */
const cbpMasterDetailRequiredDefaulted: MetadataConversion = {
  id: 'cbp-master-detail-required-defaulted',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: "object.fields.MASTER.required, MASTER being the one master_detail of a sharingModel: 'controlled_by_parent' object",
  summary:
    "the one `master_detail` of a `controlled_by_parent` object with `required` omitted → `required: true` "
    + '(ADR-0055 §1: the master is exactly one required master_detail; this is the force '
    + '`ObjectSchema.create()` already applies, so the row resolves the same master it always did; '
    + 'an explicit `required: false`, two masters and a required lookup are not converted)',
  apply(stack, emit) {
    return mapCollection(stack, 'objects', (obj, path) => {
      if (obj.sharingModel !== 'controlled_by_parent') return obj;
      const fields = obj.fields;
      if (!isDict(fields)) return obj;
      const masters = Object.entries(fields).filter(([, def]) => isDict(def) && def.type === 'master_detail');
      if (masters.length !== 1) return obj;
      const [name, def] = masters[0] as [string, Dict];
      if ('required' in def) return obj;
      emit({ from: '(omitted)', to: 'true', path: `${path}.fields.${name}.required` });
      return { ...obj, fields: { ...fields, [name]: { ...def, required: true } } };
    });
  },
  fixture: {
    before: {
      objects: [
        {
          // The Studio-authored shape: converted.
          name: 'cbpd_line',
          label: 'Line',
          sharingModel: 'controlled_by_parent',
          fields: {
            header: { type: 'master_detail', label: 'Header', reference: 'cbpd_header' },
            note: { type: 'text', label: 'Note' },
          },
        },
        {
          // An explicit `required: false` — refused by the builder, not converted here.
          name: 'cbpd_explicit',
          label: 'Explicit',
          sharingModel: 'controlled_by_parent',
          fields: { header: { type: 'master_detail', label: 'Header', reference: 'cbpd_header', required: false } },
        },
        {
          // Two masters — no pick.
          name: 'cbpd_two',
          label: 'Two',
          sharingModel: 'controlled_by_parent',
          fields: {
            a: { type: 'master_detail', label: 'A', reference: 'cbpd_header' },
            b: { type: 'master_detail', label: 'B', reference: 'cbpd_other' },
          },
        },
        {
          // The retired third tier — a required lookup — is not converted.
          name: 'cbpd_member',
          label: 'Member',
          sharingModel: 'controlled_by_parent',
          fields: { header: { type: 'lookup', label: 'Header', reference: 'cbpd_header', required: true } },
        },
        {
          // Not controlled_by_parent: untouched.
          name: 'cbpd_plain',
          label: 'Plain',
          sharingModel: 'private',
          fields: { header: { type: 'master_detail', label: 'Header', reference: 'cbpd_header' } },
        },
      ],
    },
    after: {
      objects: [
        {
          name: 'cbpd_line',
          label: 'Line',
          sharingModel: 'controlled_by_parent',
          fields: {
            header: { type: 'master_detail', label: 'Header', reference: 'cbpd_header', required: true },
            note: { type: 'text', label: 'Note' },
          },
        },
        {
          name: 'cbpd_explicit',
          label: 'Explicit',
          sharingModel: 'controlled_by_parent',
          fields: { header: { type: 'master_detail', label: 'Header', reference: 'cbpd_header', required: false } },
        },
        {
          name: 'cbpd_two',
          label: 'Two',
          sharingModel: 'controlled_by_parent',
          fields: {
            a: { type: 'master_detail', label: 'A', reference: 'cbpd_header' },
            b: { type: 'master_detail', label: 'B', reference: 'cbpd_other' },
          },
        },
        {
          name: 'cbpd_member',
          label: 'Member',
          sharingModel: 'controlled_by_parent',
          fields: { header: { type: 'lookup', label: 'Header', reference: 'cbpd_header', required: true } },
        },
        {
          name: 'cbpd_plain',
          label: 'Plain',
          sharingModel: 'private',
          fields: { header: { type: 'master_detail', label: 'Header', reference: 'cbpd_header' } },
        },
      ],
    },
    // One notice: `cbpd_line.header` only.
    expectedNotices: 1,
  },
};

export { cbpMasterDetailRequiredDefaulted };
