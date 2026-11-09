// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `field-malformed-scale-precision-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `fieldMalformedScalePrecisionRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict } from '../shared.js';

/**
 * Field `scale` / `precision`: malformed declarations removed (protocol 18,
 * #8321).
 *
 * NOT a rename — both keys are digit COUNTS, so a non-integer or negative
 * value (`scale: 2.5`, `precision: -1`) declares nothing the runtime could
 * enforce. #7501's write-time enforcement deliberately guards on
 * `Number.isInteger(v) && v >= 0` and leaves a malformed declaration
 * unenforced (inventing floor/round semantics in a consumer would be PD #12
 * guessing), so removing the key is a pure lossless delete: the declaration
 * never had a runtime effect to lose, and after removal the field behaves
 * byte-identically (unenforced). The authoring schema now refuses these
 * values (`z.number().int().min(0)`, ADR-0078 declared=enforced), so this is
 * **retired from the load path**: a live author gets the loud refusal and
 * fixes the source; only `migrate meta` and the stored-row rehydration seam
 * (`applyConversionsToStoredItem`, which replays retired entries by design)
 * apply the delete — which is what keeps an existing tenant with
 * `scale: 2.5` at rest in `sys_metadata` loadable rather than hard-broken.
 *
 * Guarded to `typeof v === 'number'`: a non-number value there was never
 * schema-legal in any protocol and is a validation problem, not a conversion
 * target — this seam never manufactures shape. `NaN`/`Infinity` fall in
 * (`Number.isInteger` is false for both). A WELL-FORMED count (`0`, `2`, any
 * non-negative integer) is untouched.
 *
 * ⚠️ `currencyConfig.precision` (under `currencyConfig`) is a different key —
 * deliberately not walked here; it was removed outright later in this major by
 * `currency-config-precision-removed` below.
 */
const fieldMalformedScalePrecisionRemoved: MetadataConversion = {
  id: 'field-malformed-scale-precision-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.0.0',
  surface: 'object.fields.*.scale / object.fields.*.precision',
  summary:
    "malformed field 'scale'/'precision' declarations (non-integer or negative) are removed — "
    + 'they were silently unenforced; the schema now refuses them at authoring',
  apply(stack, emit) {
    const MALFORMED_KEYS = ['scale', 'precision'] as const;
    const stripMalformed = (input: Dict, collection: string): Dict =>
      mapCollection(input, collection, (owner, path) => {
        const fields = owner.fields;
        if (!isDict(fields)) return owner;
        let changed = false;
        const next: Dict = {};
        for (const [name, def] of Object.entries(fields)) {
          if (!isDict(def)) {
            next[name] = def;
            continue;
          }
          let current = def;
          for (const key of MALFORMED_KEYS) {
            const value = current[key];
            if (typeof value !== 'number') continue;
            if (Number.isInteger(value) && value >= 0) continue;
            const { [key]: _removed, ...rest } = current;
            current = rest;
            emit({ from: `${key}: ${value}`, to: '(removed)', path: `${path}.fields.${name}.${key}` });
          }
          next[name] = current;
          if (current !== def) changed = true;
        }
        return changed ? { ...owner, fields: next } : owner;
      });
    return stripMalformed(stripMalformed(stack, 'objects'), 'objectExtensions');
  },
  fixture: {
    before: {
      objects: [{
        name: 'crm_deal',
        label: 'Deal',
        fields: {
          // Non-integer scale: the #8321 repro — declared, silently unenforced.
          amount: { type: 'number', precision: 18, scale: 2.5 },
          // Negative precision: the other malformed direction.
          weight: { type: 'number', precision: -1, scale: 2 },
          // Well-formed counts survive byte-identically.
          quantity: { type: 'number', precision: 10, scale: 0 },
        },
      }],
    },
    after: {
      objects: [{
        name: 'crm_deal',
        label: 'Deal',
        fields: {
          amount: { type: 'number', precision: 18 },
          weight: { type: 'number', scale: 2 },
          quantity: { type: 'number', precision: 10, scale: 0 },
        },
      }],
    },
    // One per removed malformed key — `quantity` (and `weight.scale`,
    // `amount.precision`) are untouched.
    expectedNotices: 2,
  },
};

export { fieldMalformedScalePrecisionRemoved };
