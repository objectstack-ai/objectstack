// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `currency-config-dynamic-default-currency-removed`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `currencyConfigDynamicDefaultCurrencyRemoved` and lists it where it
// stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict, stripKeys } from '../shared.js';

/**
 * `currencyConfig.defaultCurrency` on a `dynamic` config → removed (protocol
 * 18, #27157 — ruling 6464202770 on #27119, Q2 = X: an amount whose currency
 * is not known takes the tenant default, and nothing guesses; the D3 semantic
 * entry `currency-config-fixed-default-currency-required`).
 *
 * `defaultCurrency` was `.default('CNY')`, so EVERY parse wrote a code into
 * the config: a `fixed` config with none became a yuan field, and a `dynamic`
 * config — which reads no code, its amounts display in the tenant default
 * currency — carried a `'CNY'` nobody wrote and every reader had to know to
 * ignore. The default is gone, and the parse now refuses `fixed` without a
 * code instead of filling one in.
 *
 * **Why data at rest needs this entry.** A built artifact holds the parsed
 * stack, so every `dynamic` config in it carries the baked `'CNY'`; a stored
 * `sys_metadata` object row is kept as authored, so its `dynamic` config may
 * carry a code (written, or copied from a parsed body) or none. JSON cannot
 * say which code was written. This entry strips it from every config whose
 * mode is `dynamic` (or absent, which parses to `dynamic`), so those rows read
 * as a parse of their source now does. **Lossless against the runtime:** no
 * reader takes a `dynamic` config's code (the console's `resolveFieldCurrency`,
 * the analytics field-currency relay and the formula return inference all
 * read it under `fixed` only).
 *
 * **A `fixed` config is never touched.** One with a code keeps it (in an
 * artifact, the code the old parse filled in). A stored row saved as
 * `{ currencyMode: 'fixed' }` has NO code, because the row is kept as
 * authored, and this entry does not write one: a guessed `'CNY'` is exactly
 * what the ruling forbids. That row loads and registers unchanged, is counted
 * invalid with a `[metadata_spec_invalid]` boot line at
 * `fields.<f>.currencyConfig.defaultCurrency`, and its next save is refused
 * with the prescription. Its display does not change (the console reads a
 * `fixed` code only when one is present, so it showed the tenant default
 * before too); `@objectstack/formula` reads a formula over it as an unproven
 * currency instead of fixed CNY.
 *
 * **Retired from the load path, from day one.** An authored `defaultCurrency`
 * on a `dynamic` config is legal and unread, so the authoring funnel does not
 * rewrite a source; only stored rows (`applyConversionsToStoredItem`) and a
 * built artifact inside its declared-floor window get the strip. Fields are a
 * RECORD keyed by name with `currencyConfig` one level down, walked per field
 * on objects and object extensions, as `currency-config-precision-removed`
 * does. A formula field returning `currency` carries the same key and is
 * walked the same way. Idempotent: a stripped config has no `defaultCurrency`
 * for the next pass to find.
 */
const currencyConfigDynamicDefaultCurrencyRemoved: MetadataConversion = {
  id: 'currency-config-dynamic-default-currency-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface: 'object.fields.*.currencyConfig.defaultCurrency — under currencyMode: dynamic',
  summary:
    "currency field key 'currencyConfig.defaultCurrency' removed from a 'dynamic' config "
    + '(no reader takes a dynamic config\'s code — amounts display in the tenant default currency; '
    + 'the `\'CNY\'` an earlier parse baked in goes; a `fixed` config is never touched)',
  apply(stack, emit) {
    const stripOn = (input: Dict, collection: string): Dict =>
      mapCollection(input, collection, (owner, path) => {
        const fields = owner.fields;
        if (!isDict(fields)) return owner;
        let changed = false;
        const next: Dict = {};
        for (const [name, def] of Object.entries(fields)) {
          const config = isDict(def) ? def.currencyConfig : undefined;
          if (!isDict(config) || (config.currencyMode !== undefined && config.currencyMode !== 'dynamic')) {
            next[name] = def;
            continue;
          }
          const stripped = stripKeys(config, ['defaultCurrency'], emit, `${path}.fields.${name}.currencyConfig`);
          if (stripped === config) {
            next[name] = def;
            continue;
          }
          next[name] = { ...(def as Dict), currencyConfig: stripped };
          changed = true;
        }
        return changed ? { ...owner, fields: next } : owner;
      });
    return stripOn(stripOn(stack, 'objects'), 'objectExtensions');
  },
  fixture: {
    before: {
      objects: [{
        name: 'billing_ledger',
        label: 'Ledger',
        fields: {
          // The baked default on a dynamic config — what a built artifact
          // carries without anyone having written it.
          tax: { type: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'CNY' } },
          // No mode: parses to dynamic, so its code is unread too.
          fee: { type: 'currency', currencyConfig: { defaultCurrency: 'EUR' } },
          // A formula returning currency carries the same shape.
          net: { type: 'formula', expression: 'record.fee - record.tax', returnType: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'CNY' } },
          // Fixed: the code is the field's currency, kept; reference kept.
          amount: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
          // Dynamic with no code: nothing to strip.
          credit: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
        },
      }],
    },
    after: {
      objects: [{
        name: 'billing_ledger',
        label: 'Ledger',
        fields: {
          tax: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
          fee: { type: 'currency', currencyConfig: {} },
          net: { type: 'formula', expression: 'record.fee - record.tax', returnType: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
          amount: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
          credit: { type: 'currency', currencyConfig: { currencyMode: 'dynamic' } },
        },
      }],
    },
    // One per stripped code: `tax`, `fee` and `net`.
    expectedNotices: 3,
  },
};

export { currencyConfigDynamicDefaultCurrencyRemoved };
