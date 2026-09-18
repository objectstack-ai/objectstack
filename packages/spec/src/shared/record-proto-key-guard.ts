// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * `refuseRecordProtoKey` — a pre-parse guard that refuses a `__proto__` own
 * key on the RAW input, before `z.record()` ever gets to run its key schema.
 *
 * ## Why this exists (objectstack#17852)
 *
 * `$ZodRecord`'s open-key branch (zod v4 core, the record parser) reads:
 *
 * ```js
 * for (const key of Reflect.ownKeys(input)) {
 *   if (key === "__proto__") continue;   // <-- runs BEFORE the key schema
 *   if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
 *   let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
 *   ...
 * }
 * ```
 *
 * The `continue` sits above `def.keyType._zod.run`, so **no key schema can
 * ever see a `__proto__` key** — not a regex, not `.refine()`, not
 * `.superRefine()`, not even a key schema that rejects every string. A
 * document whose record carries `__proto__` as an own key (which
 * `JSON.parse` produces routinely) parses as SUCCESS and the key is
 * silently missing from the output — the record accepted a document and
 * handed back a different one. Tightening the key schema does nothing for
 * this one name; the only place left to refuse it is the raw input, ahead
 * of the record entirely. That is what this wrapper does.
 *
 * `constructor` and `prototype` are deliberately NOT handled here: unlike
 * `__proto__`, both reach the key schema unskipped, so a slot that wants to
 * refuse them too does it in its own key grammar instead (see
 * `ObjectSchema.fields` in `data/object.zod.ts`) — adding them to this guard
 * would refuse a name for one slot (`assignments`) whose accept set no
 * ruling has narrowed.
 *
 * @param schema - the `z.record(...)` (or any schema) to guard. The return
 *   type is cast back to `Schema` itself, matching the precedent at
 *   `ObjectSchema.apiMethods` (this file's `data/object.zod.ts` neighbour):
 *   a raw `z.preprocess(fn, schema)` would widen the AUTHORING (input) type
 *   to `unknown`, losing autocomplete/type-checking for every author who
 *   writes this slot as an object literal. The runtime guard is real; only
 *   the declared TS shape is preserved.
 * @param slotLabel - the authored surface name, echoed in the refusal so a
 *   reader learns which slot rejected the document (e.g. `'fields'`).
 */
export function refuseRecordProtoKey<Schema extends z.ZodType>(
  schema: Schema,
  slotLabel: string,
): Schema {
  return z.preprocess((value, ctx) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      Reflect.ownKeys(value).some(
        (key) => key === '__proto__' && Object.prototype.propertyIsEnumerable.call(value, key),
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['__proto__'],
        message:
          `\`${slotLabel}\` cannot contain a key named "__proto__". zod's z.record() ` +
          'silently drops this key from its parse output while reporting success ' +
          '(the document is accepted and a DIFFERENT document, missing this key, is ' +
          'returned) — so it is refused here instead of being silently corrupted. ' +
          'Rename the key.',
      });
    }
    return value;
  }, schema) as unknown as Schema;
}
