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
 * Does this rendered type carry a top-level `&`, i.e. would suffixing `[]`
 * re-associate it?
 *
 * `A & B[]` is `A & (B[])` in TypeScript, not `(A & B)[]` — so an array whose
 * element is an intersection MUST be parenthesized or the cell states a
 * different type than the schema. Depth is tracked across `{}`, `<>`, `[]` and
 * `()` so operators nested inside a shape, a `Record<…>` type argument, an
 * `Enum<'a' | 'b'>` or a markdown link target are correctly ignored.
 *
 * Scoped to `&` deliberately. Arrays whose element is a top-level UNION have
 * the identical defect (`string | number[]` for an array of `string | number`)
 * on 164 sites, but that one PREDATES this renderer change and is filed as
 * #5338 — bundling its ~170-line regeneration in here would bury the #4912 fix
 * this function exists for. Widening to `|` is the whole of that fix; the depth
 * scan below already ignores nested operators correctly.
 */
function hasTopLevelIntersection(rendered: string): boolean {
  let depth = 0;
  for (const ch of rendered) {
    if (ch === '{' || ch === '<' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === '>' || ch === ']' || ch === ')') depth--;
    else if (depth === 0 && ch === '&') return true;
  }
  return false;
}

export function formatType(prop: any, ctx?: TypeContext): string {
  if (!prop) return 'any';

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
    // An open object element renders as an intersection, which `[]` would
    // re-associate — parenthesize so the cell keeps meaning "array of that".
    return hasTopLevelIntersection(element) ? `(${element})[]` : `${element}[]`;
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
    const keys = prop.properties ? Object.keys(prop.properties) : [];

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
      // `…` elides further DECLARED keys; `& Record<…>` states that UNDECLARED
      // ones are accepted. Different facts — a cell may need both.
      if (keys.length > shown.length) shown.push('…');
      const shape = `{ ${shown.join('; ')} }`;
      // Declared shape first: the reader needs the keys they MUST write before
      // the note that extra ones are tolerated.
      return open ? `${shape} & ${open}` : shape;
    }

    // Nothing declared. An empty `properties: {}` is not a shape — intersecting
    // it would print `{  } & Record<…>`, so fall through to the record/opaque
    // renderings exactly as before.
    if (open) return open;
    if (!prop.properties) return 'object';
    return '{  }';
  }

  if (Array.isArray(prop.type)) {
    return prop.type.join(' | ');
  }

  return prop.type || 'any';
}
