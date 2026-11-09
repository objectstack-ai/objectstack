// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `currency-config-precision-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `currencyConfigPrecisionRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * `currencyConfig.precision` — a declared, validated key no renderer or runtime
 * ever read (#19992, ADR-0049 enforce-or-remove; triage direction REMOVE under
 * ruling 乙 on #19910, 「a currency's decimal places are the currency's, not a
 * setting」). objectui's `CurrencyField` derives an amount's decimal places from
 * the currency's CLDR fraction digits and never looked at the key; its only
 * reader was its own #7918 ISO 4217 contradiction check, which policed a width
 * nothing applied.
 *
 * The strip is a pure lossless delete: the key never had an effect to lose.
 * It matters for data AT REST more than for authors, because the schema's
 * `.overwrite()` (#7918/#11423) BAKED `precision: 2` into the parse output of
 * nearly every `currencyConfig` — so stored `sys_metadata` object rows and
 * built artifacts carry it without anyone having written it. The stored-row
 * and artifact seams replay this entry (`includeRetired`), so those rows are
 * served canonical instead of being refused by the now-closed shape.
 *
 * `retiredFromLoadPath`: `CurrencyConfigSchema` is a `strictObject`, so an
 * authored `precision` is refused with the prescription
 * (`CURRENCY_CONFIG_DECIMAL_PLACES_GUIDANCE`, data/field.zod.ts) rather than
 * silently rewritten. The never-legal `decimals` / `scale` spellings are NOT
 * walked: the closed shape always refused them, so no stored row carries them
 * and there is nothing to convert. Fields are a RECORD keyed by name and
 * `currencyConfig` sits one level below the field, so the top-level-only
 * `stripKeys` runs per field config (pattern of
 * `object-tenancy-organization-field-removed`); objects and object extensions
 * carry the same `FieldSchema`, so both are walked.
 */
const currencyConfigPrecisionRemoved: MetadataConversion = {
  id: 'currency-config-precision-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'object.fields.*.currencyConfig.precision',
  summary:
    "currency field key 'currencyConfig.precision' removed (ADR-0049 — no renderer or "
    + 'runtime ever read it: an amount\'s decimal places are its currency\'s CLDR fraction digits, '
    + 'derived from the currency itself. Its ISO 4217 contradiction check and the default `2` '
    + 'baked into parse output went with it; the field-level `precision` is a total digit count '
    + 'and is untouched)',
  apply(stack, emit) {
    const stripOn = (input: Dict, collection: string): Dict =>
      mapCollection(input, collection, (owner, path) => {
        const fields = owner.fields;
        if (!isDict(fields)) return owner;
        let changed = false;
        const next: Dict = {};
        for (const [name, def] of Object.entries(fields)) {
          if (!isDict(def) || !isDict(def.currencyConfig)) {
            next[name] = def;
            continue;
          }
          const stripped = stripKeys(
            def.currencyConfig,
            ['precision'],
            emit,
            `${path}.fields.${name}.currencyConfig`,
          );
          if (stripped === def.currencyConfig) {
            next[name] = def;
            continue;
          }
          next[name] = { ...def, currencyConfig: stripped };
          changed = true;
        }
        return changed ? { ...owner, fields: next } : owner;
      });
    return stripOn(stripOn(stack, 'objects'), 'objectExtensions');
  },
  fixture: {
    before: {
      objects: [{
        name: 'billing_invoice',
        label: 'Invoice',
        fields: {
          // Authored in the source: the shape the showcase examples carried.
          amount: {
            type: 'currency',
            currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' },
          },
          // The baked default on a dynamic config — what a stored row carries
          // without anyone having written it. (Its baked `defaultCurrency` is
          // `currency-config-dynamic-default-currency-removed`'s, left out so
          // the two fixtures stay disjoint.)
          tax: { type: 'currency', currencyConfig: { precision: 2, currencyMode: 'dynamic' } },
          // No `precision` under `currencyConfig`: untouched, reference kept.
          fee: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } },
          // The FIELD-level `precision` (total digits) is a different key and
          // is never walked.
          quantity: { type: 'number', precision: 10, scale: 0 },
        },
      }],
    },
    after: {
      objects: [{
        name: 'billing_invoice',
        label: 'Invoice',
        fields: {
          amount: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
          tax: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
          fee: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } },
          quantity: { type: 'number', precision: 10, scale: 0 },
        },
      }],
    },
    // One per stripped key — `fee` and `quantity` are untouched.
    expectedNotices: 2,
  },
};

export { currencyConfigPrecisionRemoved };
