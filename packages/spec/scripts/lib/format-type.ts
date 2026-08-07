// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * JSON Schema node → the type string a reference page prints in its table cell.
 *
 * Extracted from `build-docs.ts` so the rendering can be pinned directly
 * (#4912). The generator is a top-level script with side effects, so the only
 * way to assert on its type strings used to be to run the whole thing and grep
 * the emitted `.mdx` — which is why the passthrough collapse below survived
 * unnoticed through the whole #4001 campaign.
 */

/**
 * Context a page needs to turn a `$ref` into a link that actually resolves.
 *
 * Pages are named after the *zod file* (`data/object.mdx`) while refs name a
 * *schema* (`Field`), so a ref can only be linked by looking the schema name up
 * in the generator's category maps — injected here as `schemaHref` rather than
 * imported, so this module stays free of the generator's module-level state.
 * Anonymous refs (`__schemaN`, emitted when Zod hoists a reused inline schema
 * into `$defs`) have no page at all and are rendered structurally instead.
 */
export interface TypeContext {
  /** `$defs` of the document being rendered — for resolving local refs. */
  defs: Record<string, any>;
  /** The schema whose section is being rendered — target of a self `$ref` (`"#"`). */
  currentSchema: string;
  /**
   * Anonymous refs already being expanded on this branch. Schemas are cyclic
   * (a node contains nodes), so inlining without this recurses forever.
   */
  expanding?: Set<string>;
  /**
   * Resolve a schema name to its page href, or `null` when the schema isn't one
   * the generator produces a page for — the type is then rendered without a
   * link rather than emitting a 404.
   */
  schemaHref?: (name: string) => string | null;
}

export const refName = (ref: string): string => ref.split('/').pop() || ref;
export const isAnonymousRef = (name: string) => /^__schema\d+$/.test(name);

/** A page-local anchor, matching how fumadocs slugs the `## SchemaName` heading. */
export const anchorFor = (schemaName: string) => `#${schemaName.toLowerCase()}`;

/** How many declared keys an inline object shows before eliding the rest. */
const INLINE_KEY_LIMIT = 4;

/**
 * Does this rendered type carry a top-level `&` or `|`, i.e. would suffixing
 * `[]` re-associate it?
 *
 * `[]` binds tighter than both operators: `A & B[]` is `A & (B[])` and
 * `A | B[]` is `A | (B[])`, never `(A & B)[]` / `(A | B)[]`. So an array whose
 * element renders as a top-level intersection OR union MUST be parenthesized,
 * or the cell states a different type than the schema — `string | number[]`
 * reads as "a string, or an array of numbers", while the schema said "an array
 * whose elements are string or number". Depth is tracked across `{}`, `<>`,
 * `[]` and `()` so operators nested inside a shape, a `Record<…>` type
 * argument, an `Enum<'a' | 'b'>` or a markdown link target are correctly
 * ignored.
 *
 * The `&` half arrived with #4912, which had *introduced* intersection
 * elements (`{ declared keys } & Record<string, any>`) and so fixed only what
 * it caused. The `|` half is the older defect, filed separately as #5338 and
 * fixed here: it predated that renderer change and its regeneration diff would
 * have buried the passthrough fix. Both halves are one rule — `[]` is not
 * distributive over either operator — so they share one scan.
 */
function hasTopLevelUnionOrIntersection(rendered: string): boolean {
  let depth = 0;
  for (const ch of rendered) {
    if (ch === '{' || ch === '<' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === '>' || ch === ']' || ch === ')') depth--;
    else if (depth === 0 && (ch === '&' || ch === '|')) return true;
  }
  return false;
}

/**
 * Is this node the JSON Schema encoding of `z.never()` — i.e. a `retiredKey()`
 * tombstone (`packages/spec/src/shared/retired-key.ts`)?
 *
 * `z.toJSONSchema` renders `z.never()` as `{ "not": {} }` — the negation of the
 * always-true empty schema, so nothing validates against it. That node carries
 * no `type`, no `$ref` and no `enum`, so before #5606 it fell all the way
 * through `formatType` to the `prop.type || 'any'` tail and printed as **`any`**
 * — the one rendering that reads as "free-form slot, nothing validates it",
 * which is the exact inverse of what a tombstone means. A key retired from
 * `heading?: string` to a tombstone came out of the generator as
 * `heading?: any`, i.e. *more* inviting to write than before it was removed.
 *
 * A **non-empty** `not` (`{ not: { type: 'string' } }`) is an ordinary negation
 * constraint, not `never`, and is deliberately not matched here.
 */
function isNeverNode(prop: any): boolean {
  return (
    !!prop &&
    typeof prop.not === 'object' &&
    prop.not !== null &&
    Object.keys(prop.not).length === 0
  );
}

export function formatType(prop: any, ctx?: TypeContext): string {
  if (!prop) return 'any';

  // A `retiredKey()` tombstone. `never` is both the accurate TypeScript (the
  // key's `z.input` type IS `never`) and the only rendering that survives the
  // inline shape summary below, where there is no description column to carry
  // the `[REMOVED]` prescription. Checked FIRST: `{ not: {} }` accepts nothing
  // whatever else the node says, so no later branch can be more specific.
  if (isNeverNode(prop)) return 'never';

  if (prop.$ref) {
    // Self-reference: link to the current section rather than a bare `#`.
    if (prop.$ref === '#') {
      return ctx ? `[${ctx.currentSchema}](${anchorFor(ctx.currentSchema)})` : 'object';
    }

    const name = refName(prop.$ref);

    // Zod-hoisted inline schema: no page exists. Render its shape instead.
    if (isAnonymousRef(name)) {
      const target = ctx?.defs?.[name];
      if (!target) return 'object';
      // Cycle guard: these schemas are recursive (a node contains nodes).
      if (ctx!.expanding?.has(name)) return 'object';
      const expanding = new Set(ctx!.expanding ?? []);
      expanding.add(name);
      return formatType({ ...target, $ref: undefined }, { ...ctx!, expanding });
    }

    const href = ctx?.schemaHref?.(name) ?? null;
    return href ? `[${name}](${href})` : name;
  }

  if (prop.type === 'array') {
    const element = formatType(prop.items, ctx);
    // An open object element renders as an intersection and a multi-variant
    // element as a union — `[]` would re-associate either — so parenthesize
    // and the cell keeps meaning "array of that".
    return hasTopLevelUnionOrIntersection(element) ? `(${element})[]` : `${element}[]`;
  }

  if (prop.enum) {
    return `Enum<${prop.enum.map((e: any) => `'${e}'`).join(' | ')}>`;
  }

  if (prop.const !== undefined) {
    return `'${prop.const}'`;
  }

  if (prop.anyOf || prop.oneOf) {
    const variants = prop.anyOf || prop.oneOf;
    return variants.map((v: any) => formatType(v, ctx)).join(' | ');
  }

  if (prop.type === 'object') {
    // Declared keys and openness are INDEPENDENT facts, and JSON Schema states
    // them independently: a `.passthrough()` / `.catchall()` object carries
    // `properties` AND `additionalProperties` at once. Testing the latter first
    // — as this renderer did until #4912 — made them alternatives, so every
    // open object with a declared shape printed as a bare `Record<string, any>`
    // and the author-facing page lost keys the schema *requires*.
    const open = prop.additionalProperties
      ? `Record<string, ${formatType(prop.additionalProperties, ctx)}>`
      : null;

    // Inline object: show its shape one level deep instead of an opaque `Object`.
    //
    // Tombstoned keys are dropped BEFORE `INLINE_KEY_LIMIT` is applied, not
    // rendered as `never` and counted. They are not authorable surface any
    // more, so spending one of the four slots on one — and pushing a key the
    // author MUST write behind the `…` to afford it — sells a removed key in
    // place of a live one. The elision cannot be worked around by ordering,
    // either: #5248 retired `IndexSchema.type`/`.partial` down to three live
    // keys, so with a limit of four the first tombstone is *mathematically*
    // guaranteed into the summary however low in the shape it sits (#5606).
    // Their own table row still carries the `[REMOVED]` prescription wherever
    // the shape is a named schema; a summary cell has no description column to
    // carry it at all.
    const keys = prop.properties
      ? Object.keys(prop.properties).filter(k => !isNeverNode(prop.properties[k]))
      : [];

    if (keys.length > 0) {
      const shown = keys.slice(0, INLINE_KEY_LIMIT).map(k => {
        const child = prop.properties[k];
        const optional = (prop.required || []).includes(k) ? '' : '?';
        // Depth-limited: nested objects stay opaque so a table cell can't explode.
        const childType = child?.type === 'object' && child.properties
          ? 'object'
          : formatType(child, ctx);
        return `${k}${optional}: ${childType}`;
      });
      // `…` elides further LIVE declared keys; `& Record<…>` states that
      // UNDECLARED ones are accepted. Different facts — a cell may need both.
      // Tombstones are in neither set: they are declared and rejected, so a
      // summary that ends without `…` now means "these are all the keys you may
      // write", which is a stronger and truer claim than it used to be.
      if (keys.length > shown.length) shown.push('…');
      const shape = `{ ${shown.join('; ')} }`;
      // Declared shape first: the reader needs the keys they MUST write before
      // the note that extra ones are tolerated.
      return open ? `${shape} & ${open}` : shape;
    }

    // No LIVE key declared — either `properties: {}` outright, or a shape whose
    // every declared key is now a tombstone. Both state the same authorable
    // fact, and neither is a shape: intersecting one would print
    // `{  } & Record<…>`, so fall through to the record/opaque renderings
    // exactly as before.
    if (open) return open;
    if (!prop.properties) return 'object';
    return '{  }';
  }

  if (Array.isArray(prop.type)) {
    return prop.type.join(' | ');
  }

  return prop.type || 'any';
}
