// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * The `__proto__` pre-parse guard family — two wrappers, one mechanism.
 *
 * ## The shared defect (objectstack#17852, objectstack#19151)
 *
 * Zod v4 has TWO open-key branches — the ones that accept keys no shape
 * declares — and BOTH skip a `__proto__` own key before anything author-facing
 * can see it. Measured on the version this package resolves, zod 4.4.3
 * (`node_modules/zod/v4/core/schemas.js`):
 *
 * ```js
 * // $ZodRecord's open-key branch (the record parser, ~line 1494):
 * for (const key of Reflect.ownKeys(input)) {
 *   if (key === "__proto__") continue;   // <-- runs BEFORE the key schema
 *   if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
 *   let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
 *   ...
 * }
 *
 * // handleCatchall — z.object().catchall()'s branch (~line 767):
 * for (const key in input) {
 *   // skip __proto__ so it can't replace the result prototype via the
 *   // assignment setter on the plain {} we build into
 *   if (key === "__proto__") continue;   // <-- runs BEFORE the catchall schema
 *   if (keySet.has(key)) continue;
 *   const r = _catchall.run({ value: input[key], issues: [] }, ctx);
 *   ...
 * }
 * ```
 *
 * In both, the `continue` sits above the schema that would judge the key, so
 * **no schema can ever see a `__proto__` key** — not a regex, not `.refine()`,
 * not `.superRefine()`, not even a key schema that rejects every string, and
 * not a catchall of `z.never()` (whose `unrecognized_keys` list is populated
 * inside the loop the `continue` already left). A document carrying `__proto__`
 * as an own key — which `JSON.parse` produces routinely, while an object
 * literal's `{ __proto__: … }` sets the prototype instead and never reaches
 * either loop — parses as SUCCESS and the key is silently missing from the
 * output: the schema accepted a document and handed back a different one.
 * Tightening the key schema, or closing the shape, does nothing for this one
 * name; the only place left to refuse it is the raw input, ahead of the parse.
 * That is what these wrappers do.
 *
 * ## Which names each wrapper refuses, and why it is only this one
 *
 * `constructor` and `prototype` are deliberately NOT handled here, in either
 * position: unlike `__proto__`, both reach the judging schema unskipped and
 * round-trip intact (measured at both sites), so a slot that wants to refuse
 * them too does it in its own key grammar instead (see `ObjectSchema.fields`
 * in `data/object.zod.ts`) — adding them to this guard would refuse a name for
 * slots whose accept set no ruling has narrowed.
 *
 * ## Why a `z.preprocess` and not a declared key
 *
 * Declaring `__proto__` in the object's own shape was measured and does not
 * work: zod reads a declared key as `input["__proto__"]` and tests presence as
 * `"__proto__" in input`, and on an ordinary object BOTH answer through the
 * inherited accessor — the value is `Object.prototype` and the key is always
 * "present" — so such a declaration refuses every config, including the ones
 * that authored nothing. (It is also unwritable as an object literal at all:
 * `{ __proto__: schema }` sets the shape object's prototype rather than adding
 * a key.) A pre-parse guard on the raw input is the only mechanism that can
 * tell an authored `__proto__` apart from the prototype every object has.
 */

/**
 * The shared body: refuse a `__proto__` OWN enumerable key on the raw input,
 * ahead of `schema`.
 *
 * @param schema - the schema to guard. The return type is cast back to
 *   `Schema` itself, matching the precedent at `ObjectSchema.apiMethods` (the
 *   `data/object.zod.ts` neighbour): a raw `z.preprocess(fn, schema)` would
 *   widen the AUTHORING (input) type to `unknown`, losing autocomplete/type-
 *   checking for every author who writes this slot as an object literal. The
 *   runtime guard is real; only the declared TS shape is preserved.
 * @param message - the refusal an author meets. It names the parser that would
 *   otherwise drop the key, because the two positions drop it for different
 *   reasons and an author reading the wrong one goes looking in the wrong place.
 */
function refuseProtoOwnKey<Schema extends z.ZodType>(schema: Schema, message: string): Schema {
  const guarded = z.preprocess((value, ctx) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      Reflect.ownKeys(value).some(
        (key) => key === '__proto__' && Object.prototype.propertyIsEnumerable.call(value, key),
      )
    ) {
      ctx.addIssue({ code: 'custom', path: ['__proto__'], message });
    }
    return value;
  }, schema);

  // [objectstack#17852] `z.preprocess`'s `in` half is a `ZodTransform`, which
  // unconditionally hardcodes `_zod.optin = "optional"` (zod v4 core,
  // `$ZodTransform.init`) — a preprocess accepts any input, including
  // `undefined`, REGARDLESS of whether the wrapped schema does. Left alone,
  // that makes a REQUIRED slot (e.g. `ObjectSchema.fields`, which carries no
  // `.optional()`) report as optional to anything that reads `optin`/`optout`
  // instead of actually parsing: `$ZodObject`'s own requiredness check for an
  // "input shape" JSON Schema (`objectProcessor`, `io === 'input'` branch)
  // reads exactly this flag, so — measured — the published JSON Schema for
  // `data/Object` silently dropped `fields` from its `required` array without
  // this correction, while the RUNTIME parse still refuses a missing
  // `fields` exactly as before (confirmed separately: `optout`, which
  // governs the OTHER direction and this object's own accept/reject
  // behaviour, already mirrors `schema`, unaffected by this bug — only the
  // requiredness *declaration* was wrong).
  //
  // The patch lands on `def.in` — the inner `ZodTransform` — rather than on
  // `guarded` itself, and that placement is load-bearing, not stylistic:
  // every classic combinator this schema is chained with afterward
  // (`.describe()`, `.optional()`, …) CLONES the outer pipe into a fresh
  // instance whose `optin`/`optout` are RE-DERIVED from `def.in._zod.optin`
  // (measured — a patch on the outer instance is silently dropped by the
  // very first `.describe()` a caller chains). `def.in` itself is carried
  // over by reference across every such clone, so patching it here is what
  // makes the correction survive the callers' own `.describe()` / `.optional()`
  // chaining below.
  guarded._zod.def.in._zod.optin = schema._zod.optin;
  guarded._zod.def.in._zod.optout = schema._zod.optout;

  return guarded as unknown as Schema;
}

/**
 * `refuseRecordProtoKey` — a pre-parse guard that refuses a `__proto__` own
 * key on the RAW input, before `z.record()` ever gets to run its key schema
 * (objectstack#17852; the module docblock above is the authority on why).
 *
 * @param schema - the `z.record(...)` (or any schema) to guard.
 * @param slotLabel - the authored surface name, echoed in the refusal so a
 *   reader learns which slot rejected the document (e.g. `'fields'`).
 */
export function refuseRecordProtoKey<Schema extends z.ZodType>(
  schema: Schema,
  slotLabel: string,
): Schema {
  return refuseProtoOwnKey(
    schema,
    `\`${slotLabel}\` cannot contain a key named "__proto__". zod's z.record() ` +
      'silently drops this key from its parse output while reporting success ' +
      '(the document is accepted and a DIFFERENT document, missing this key, is ' +
      'returned) — so it is refused here instead of being silently corrupted. ' +
      'Rename the key.',
  );
}

/**
 * `refuseCatchallProtoKey` — the same pre-parse guard for the OTHER open-key
 * branch: an object whose own top-level keys are author-named and admitted by
 * `.catchall(...)` (objectstack#19151).
 *
 * A sibling of {@link refuseRecordProtoKey} rather than a reuse of it, for one
 * reason: the refusal text names the parser that would otherwise drop the key,
 * and here that is `handleCatchall`, not `z.record()`. An author told their
 * top-level flow variable was dropped by "z.record()" would go looking at the
 * `assignments` map, which is a different slot with a different guard. The
 * mechanism, the refused name and the issue shape are identical by
 * construction — both call {@link refuseProtoOwnKey}.
 *
 * @param schema - the `z.object(...).catchall(...)` (or any schema) to guard.
 * @param slotLabel - what the guarded surface IS, echoed in the refusal as the
 *   subject of a sentence (e.g. `'an \`assignment\` node config'`) — not a key
 *   path, because at this position the refused key sits at the document root.
 */
export function refuseCatchallProtoKey<Schema extends z.ZodType>(
  schema: Schema,
  slotLabel: string,
): Schema {
  return refuseProtoOwnKey(
    schema,
    `${slotLabel} cannot carry a top-level key named "__proto__". zod's ` +
      '`.catchall()` branch silently drops this key from its parse output while ' +
      'reporting success (the document is accepted and a DIFFERENT document, ' +
      'missing this key, is returned) — so it is refused here instead of being ' +
      'silently corrupted. Rename the key.',
  );
}
