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
 * Character budget for a default value spelled inside the Required cell.
 *
 * Over it the cell states that a default exists without printing it, and the
 * JSON Schema under `json-schema/` stays the authority on the value — the same
 * split this renderer already makes for constraints, which it has never printed
 * in any position.
 *
 * WHY 48. Measured over the 1582 emitted documents (4676 property occurrences
 * carrying a `default`, 360 distinct values), counting occurrences whose
 * canonical JSON is wider than each candidate budget:
 *
 *   budget      |   8 |  12 |  16 |  20 |  24 |  32 |  40 |  48 |  60 |  80 | 120
 *   elided      | 553 | 251 | 157 |  78 |  47 |  40 |  34 |  24 |  17 |  17 |  14
 *
 * p50 is 5 characters and p99 is 25: the population is overwhelmingly scalars
 * (`false`, `0`, `"openai"`, `10`). 48 sits just past the collapse — it spells
 * 99.5% of occurrences in full — and everything it withholds is a structural
 * object or array default (the widest is 705 characters, a whole tab layout),
 * which no table cell should carry regardless of what the budget says. Loosening
 * to 60 buys 7 more occurrences at 12 more columns; that trade is not worth
 * widening a column whose job is to answer one yes/no question.
 *
 * The Type column's budgets (80 in a shape summary, 160 in a vocabulary's own
 * cell) are deliberately not reused: this value shares its cell with the
 * `optional (default: …)` wrapper AND sits in the narrowest column of the table.
 */
export const INLINE_DEFAULT_WIDTH_LIMIT = 48;

/**
 * The Required cell for one property — `✅`, `optional`, or `optional (default: …)`.
 *
 * ## The defect this fixes (#8703)
 *
 * `build-schemas.ts` emits each def's JSON Schema as the **output** (post-parse)
 * shape, falling back to the **input** shape only when output emission throws.
 * In the output shape a `.default()`-bearing member is listed in `required` —
 * the parse always produces it — so mirroring `required` straight into this
 * column told the author "you must write this" about a key they may omit. That
 * is precisely the question the column is read as answering, and reference
 * tables are read far more often by an AI author than by a human (ADR-0033),
 * for whom omitting optional keys is the normal authoring mode.
 *
 * Measured on the emitted tree at the time of the fix: **2526 property
 * occurrences across 529 documents** were listed in `required` while carrying a
 * `default`. Every one rendered `✅`.
 *
 * ## Why `default` is read instead of `required`
 *
 * A property carrying a `default` is author-omittable by construction, in BOTH
 * emission modes — that is what the keyword means to whoever writes the
 * document. So the presence of `default` decides this cell and the `required`
 * array only breaks the tie for properties that have none. Two consequences,
 * both wanted:
 *
 *   - The output/input split stops leaking into the docs. Before this, the same
 *     `.default()` member rendered `✅` on an output-shape page and `optional`
 *     on an input-shape one, so a refactor that flipped a def between the two
 *     rewrote its whole Required column with no semantic change to what an
 *     author must write (that flip is what #8703 was filed on). Now both modes
 *     render the same cell.
 *   - The cell says MORE than "optional" did: it names the value the author
 *     gets by omitting the key, which was previously nowhere on the page.
 *
 * ## What is deliberately NOT changed
 *
 * The emitted JSON Schemas. They keep describing the post-parse shape and keep
 * validating post-parse data — `build-schemas.ts` is untouched by this fix.
 * Only the doc rendering reads the author's question differently.
 *
 * @param prop     The property's JSON Schema node.
 * @param required Whether the enclosing object lists the property in `required`.
 */
export function renderRequiredCell(prop: any, required: boolean): string {
  const hasDefault =
    prop !== null && typeof prop === 'object' && Object.prototype.hasOwnProperty.call(prop, 'default');
  if (!hasDefault) return required ? '✅' : 'optional';

  // Canonical JSON, no whitespace — the same spelling the #4666 default ratchet
  // fingerprints, so a value printed here and a value recorded there cannot
  // disagree about what the author gets.
  let json: string | undefined;
  try {
    json = JSON.stringify(prop.default);
  } catch {
    json = undefined;
  }

  // A backtick would close the code span early and spill raw JSON into the
  // table. No emitted default contains one today; the withheld form is the
  // honest answer if one ever arrives, and it still states the fact that
  // matters — the key may be omitted.
  if (json === undefined || json.length > INLINE_DEFAULT_WIDTH_LIMIT || json.includes('`')) {
    return 'optional (has default)';
  }

  // Backslashes first, then pipes — the order every cell in this table uses,
  // and for the reason stated at the type cell. GFM resolves a `\|` escape
  // before inline parsing, so it survives inside the code span too.
  const value = json.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  return `optional (default: \`${value}\`)`;
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
          const isReq = renderRequiredCell(prop, required.has(key));
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
