// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One published schema → the `## SchemaName` section a reference page carries.
 *
 * Extracted from `build-docs.ts` for the same reason `format-type.ts` was
 * (#4912): the generator is a top-level script with side effects, so the only
 * way to assert on what a section CONTAINS used to be to run the whole thing
 * and grep the emitted `.mdx` — and the defect this module exists to fix was a
 * section that rendered as the empty string, which is exactly what grepping
 * emitted pages cannot see. #7658 was filed after the shape survived
 * unnoticed for months on 45 published schemas.
 */

import { escapeMdxDescription } from './escape-mdx';
import { formatPropertyType, formatType, type TypeContext } from './format-type';

/** What a section needs from the generator that a unit test can supply. */
export interface SectionContext {
  /**
   * Resolve a schema name to its page href, or `null` when the name does not
   * identify one — same contract as `TypeContext.schemaHref`, and passed
   * straight through to it.
   */
  schemaHref?: (name: string) => string | null;
}

/**
 * Which node of the published document IS the schema the section documents.
 *
 * The four steps are ordered, and the order is load-bearing — each is a
 * narrower claim than the next, so a document that satisfies two must be read
 * by the first:
 *
 *   1. `definitions`/`$defs` entry under the schema's own name — the bundled
 *      spelling, and unambiguous when present.
 *   2. The ROOT, when it carries a shape this renderer recognizes. JSON Schema
 *      2020-12 puts a single schema's content at root level.
 *   3. The first definition entry, for a document whose root is a `$ref` into
 *      its own `$defs` under some other key.
 *   4. The ROOT, unconditionally (#7658).
 *
 * STEP 4 IS THE FIX, and it is appended rather than folded into step 2 on
 * purpose. Step 2's condition (`properties || enum || anyOf || oneOf`) is an
 * enumeration of shapes, and a JSON Schema root can be plenty of things that
 * are none of them: a bare scalar (`{ type: 'string', description: … }`, what
 * `z.string().describe()` compiles to), a record map (`type: 'object'` +
 * `additionalProperties`, no `properties`), an array, an `allOf`. Every one of
 * those left `mainDef` undefined, and the caller answered that with
 * `return ''` — dropping the heading, the schema's own `.describe()` text and
 * the whole section, while the page's `## TypeScript Usage` import line (driven
 * by the export surface, not by this function) went on naming the export. The
 * page read as though it had forgotten to finish rendering an entry it had just
 * imported.
 *
 * Widening step 2 instead would have been the smaller diff and the wrong one:
 * a document that reaches step 3 today must keep reaching it, or a root that
 * merely LOOKS renderable would start outranking the definition the old code
 * chose. Appending leaves every one of the 1533 sections that render today
 * byte-identical (measured: regenerating with this change moves only the 45
 * that produced nothing).
 *
 * Never returns `undefined` now — the document itself is always an answer.
 */
export function selectRootDef(schemaName: string, schema: any): any {
  const defs = schema?.definitions || schema?.$defs || {};
  let mainDef = defs[schemaName];

  if (!mainDef && (schema.properties || schema.enum || schema.anyOf || schema.oneOf)) {
    mainDef = schema;
  }

  if (!mainDef) {
    mainDef = Object.values(defs)[0];
  }

  // The document IS the schema (#7658). See above for why this is last.
  if (!mainDef) {
    mainDef = schema;
  }

  return mainDef;
}

/**
 * Render one schema's section, heading included.
 *
 * `category` is not a parameter: everything category-scoped reaches this
 * through `ctx.schemaHref`, which the generator closes over the rendering
 * category with (`schemaHrefFrom`) precisely because a bare name is not a
 * schema identity (#4696).
 */
export function renderSchemaSection(schemaName: string, schema: any, ctx: SectionContext = {}): string {
  const defs = schema?.definitions || schema?.$defs || {};
  const mainDef = selectRootDef(schemaName, schema);

  let md = '';

  // Add schema heading
  md += `## ${schemaName}\n\n`;

  // Description text is made MDX-safe by `lib/escape-mdx.ts` — extracted so the
  // escaping can be pinned directly instead of by grepping emitted `.mdx`.

  // Add description with better formatting
  if (mainDef.description) {
    md += `${escapeMdxDescription(mainDef.description)}\n\n`;
  }

  const typeCtx: TypeContext = { defs, currentSchema: schemaName, schemaHref: ctx.schemaHref };

  const renderProperties = (props: any, required: Set<string> = new Set()) => {
      // Vocabularies too wide for their own table cell. Collected while the
      // table is built and printed as `### Allowed Values` bullets right after
      // it, so the complete list never leaves the page the cell sits on
      // (#6225) — the same rendering a hoisted `type: 'string'` + `enum` schema
      // has always got, now reachable from a property position too.
      const relocated: Array<{ key: string; members: string[] }> = [];
      let t = `### Properties\n\n`;
      t += `| Property | Type | Required | Description |\n`;
      t += `| :--- | :--- | :--- | :--- |\n`;
      for (const [key, prop] of Object.entries(props) as [string, any][]) {
          const { cell, allowedValues } = formatPropertyType(prop, typeCtx);
          if (allowedValues) relocated.push({ key, members: allowedValues });
          // Backslashes first, then pipes — same order as `desc` below, and for
          // the same reason: escaping pipes first lets a literal backslash in
          // the input pair with the escape and free the pipe again.
          const typeStr = cell
            .replace(/\\/g, '\\\\')
            .replace(/\|/g, '\\|');
          const isReq = required.has(key) ? '✅' : 'optional';
          // Escape for the GFM table cell last: backslashes first (so an existing
          // `\|` in a description can't decay into an escaped backslash + live
          // pipe), then pipes — an unescaped `|` (even inside a code span)
          // splits the cell.
          const desc = escapeMdxDescription((prop.description || '').replace(/\n/g, ' '))
            .replace(/\\/g, '\\\\')
            .replace(/\|/g, '\\|');
          t += `| **${key}** | \`${typeStr}\` | ${isReq} | ${desc} |\n`;
      }
      t += '\n';
      // Qualified by schema AND property: `api/errors.mdx` carries a wide
      // `code` on both `EnhancedApiError` and `FieldError`, so a heading naming
      // only the property would give one page two identical anchors.
      for (const { key, members } of relocated) {
          t += `### Allowed Values: \`${schemaName}.${key}\`\n\n`;
          t += members.map(m => `* \`${m}\``).join('\n');
          t += `\n\n`;
      }
      return t;
  };

  if (mainDef.type === 'object' && mainDef.properties) {
    md += renderProperties(mainDef.properties, new Set(mainDef.required || []));

  } else if (mainDef.type === 'string' && mainDef.enum) {
    md += `### Allowed Values\n\n`;
    md += mainDef.enum.map((e: string) => `* \`${e}\``).join('\n');
    md += `\n\n`;

  } else if (mainDef.anyOf || mainDef.oneOf) {
     md += `### Union Options\n\nThis schema accepts one of the following structures:\n\n`;
     const variants = mainDef.anyOf || mainDef.oneOf;
     variants.forEach((variant: any, index: number) => {
         const variantTitle = variant.title || `Option ${index + 1}`;
         md += `#### ${variantTitle}\n\n`;
         if (variant.description) md += `${escapeMdxDescription(variant.description)}\n\n`;

         if (variant.type === 'object' && variant.properties) {
              if (variant.properties.type && variant.properties.type.const) {
                  md += `**Type:** \`${variant.properties.type.const}\`\n\n`;
              }
              md += renderProperties(variant.properties, new Set(variant.required || []));
         } else if (variant.enum) {
              md += `Allowed Values: ${variant.enum.map((e:string) => `\`${e}\``).join(', ')}\n\n`;
         } else if (variant.$ref) {
              md += `Reference: ${formatType(variant, typeCtx)}\n\n`;
         } else {
             md += `Type: \`${formatType(variant, typeCtx)}\`\n\n`;
         }
         md += `---\n\n`;
     });

  } else {
    // Everything the three branches above do not claim: a bare scalar, a record
    // map, an array, a `$ref` alias (#7658). Before this branch existed these
    // schemas reached the caller's `if (!mainDef) return ''` and lost their
    // section whole — description included — so the fix is only half done at
    // `selectRootDef`: a heading with nothing under it states no less than the
    // empty string did.
    //
    // ONE LINE, and it is `formatType`'s rendering, not a second one. That is
    // what every property row on the page already prints for the same node, so
    // `ObjectName`'s own section and a property typed `ObjectName` cannot
    // disagree about what it is. It is also why the line does NOT spell
    // `pattern` / `minLength` / `minimum`: this renderer has never printed a
    // constraint in any position, and inventing constraint prose here alone
    // would make a root section say more than the identical property row two
    // pages over. The JSON Schema under `json-schema/` stays the authority on
    // constraints, exactly as it is for every table cell.
    //
    // `allOf` is spelled here rather than in `formatType`, because it is a ROOT
    // spelling: `z.intersection(...)` / `.and(...)` compiles to it at the top of
    // a document (`data/FilterCondition`) and `formatType` has never met one in
    // a property position. Reaching it through `formatType` would return the
    // node's `type` — absent on an intersection — i.e. `any`, which on this page
    // reads as "free-form slot, nothing validates it", the exact misreading
    // #5606 fixed for tombstones. `&` is not a new notation either: the object
    // branch of `formatType` already joins a declared shape to its open tail
    // with it.
    //
    // Identical member spellings collapse. That is safe HERE and deliberately
    // not the union rule: `A & A` is `A`, so a repeat carries nothing, whereas
    // #6569's dedupe had to keep counting the variants it withheld because a
    // union's ARITY is a fact about what the author must choose between.
    //
    // `any` is still withheld rather than printed, for a node that is none of
    // the above and carries no `type` at all. A heading and the schema's
    // description, with no claim about its type, is the honest output.
    const rendered = Array.isArray(mainDef.allOf)
      ? [...new Set(mainDef.allOf.map((member: any) => formatType(member, typeCtx)))].join(' & ')
      : formatType(mainDef, typeCtx);
    if (rendered !== 'any') {
      md += `**Type:** \`${rendered}\`\n\n`;
    }
  }

  return md;
}
