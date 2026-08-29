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
import {
  discriminantKeyOf,
  formatPropertyType,
  formatType,
  nestedShapesOf,
  variantSelector,
  type NestedShape,
  type TypeContext,
} from './format-type';

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
 * WHY 64, and why it is NOT chosen from the density curve. Measured over the
 * 1582 emitted documents (4676 property occurrences carrying a `default`, 360
 * distinct values), counting occurrences whose canonical JSON is wider than
 * each candidate:
 *
 *   budget   |   8 |  12 |  16 |  24 |  40 |  48 |  56 |  60 |  64 |  80 | 120
 *   elided   | 553 | 251 | 157 |  47 |  34 |  24 |  18 |  17 |  17 |  17 |  14
 *
 * p50 is 5 characters and p99 is 25 — the population is overwhelmingly scalars
 * (`false`, `0`, `"openai"`, `10`) — so a budget picked off that curve lands
 * near 24 and the counts barely move after it. What decides this budget is the
 * DISCONTINUITY further out, which the counts alone hide. Sorting the distinct
 * wide values, they stop being one population at exactly one place:
 *
 *      43 … 59   scalars and one-line lists an author reads and copies:
 *                `["urn:ietf:params:scim:schemas:core:2.0:User"]`,
 *                `"/api/v1/automation/resume/{executionId}/{nodeId}"`,
 *                `["MIT","Apache-2.0","BSD-3-Clause","BSD-2-Clause","ISC"]`
 *      88 … 705  structural objects and arrays — a whole logging redact list,
 *                a designer's tab layout, a mount table
 *
 * Nothing at all falls between 60 and 87. 64 sits inside that gap, so the rule
 * it encodes is the real one — *spell a value the author could retype, withhold
 * a nested structure* — rather than a percentile that would have to be
 * re-tuned every time a default moves. It costs nothing on either side: 56 and
 * 80 elide the same 17-18 occurrences, so the choice inside the gap is free.
 *
 * The Type column's budgets (80 in a shape summary, 160 in a vocabulary's own
 * cell) are deliberately not reused: this value shares its cell with the
 * `optional (default: …)` wrapper AND sits in the narrowest column of the table.
 */
export const INLINE_DEFAULT_WIDTH_LIMIT = 64;

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
 * Does this nested shape carry `.describe()` text a table could publish and a
 * `{ … }` cell cannot (#11601)?
 *
 * The test is on the shape's OWN keys, one level, matching what the table under
 * the heading will contain — never a deep walk. A deep walk would answer "yes"
 * for a shape whose own keys are all undescribed and whose grandchildren carry
 * prose, and then emit a table that publishes none of it: a section that exists
 * because of text it does not contain.
 *
 * Tombstoned keys count. `retiredKey()` puts the whole `[REMOVED]` migration
 * prescription in `description`, and `format-type.ts` drops tombstones from the
 * `{ … }` summary precisely because a summary has no column to carry it — so a
 * shape whose only described key is a tombstone is a shape whose only
 * documentation is currently unreachable, which is this fix's case exactly.
 */
function carriesDescription(shape: NestedShape): boolean {
  const props = shape.node?.properties;
  if (!props || typeof props !== 'object') return false;
  return Object.values(props).some(
    (child: any) => typeof child?.description === 'string' && child.description.trim() !== '',
  );
}

/**
 * Render one schema's section, heading included.
 *
 * `category` is not a parameter: everything category-scoped reaches this
 * through `ctx.schemaHref`, which the generator closes over the rendering
 * category with (`schemaHrefFrom`) precisely because a bare name is not a
 * schema identity (#4696).
 *
 * ## The section grammar is NOT addressable — decided, not overlooked (#12862)
 *
 * Four of the headings below carry no qualifier by construction: `### Properties`,
 * `### Allowed Values` (the whole-schema vocabulary branch), `### Union Options`
 * and `#### Option N`. One page carries many schema sections, so these **repeat by
 * design** — and that is the whole difference between them and the per-key
 * headings emitted beside them. `### Nested Shape: \`Schema.key\`` and
 * `### Allowed Values: \`Owner.key\`` are qualified *precisely* so that one page
 * cannot mint the same anchor twice (#12590); those stay addressable. This
 * grammar never was.
 *
 * Measured on the emitted tree: **1316 excess section-grammar headings across 162
 * of the 214 reference pages** — 1133 `### Properties`, 145 `### Allowed Values`,
 * 12 `### Union Options`, 26 `#### Option N`. `content/docs/references/ui/view.mdx`
 * alone carries 45 `### Properties`.
 *
 * They do not COLLIDE. Measured by driving the docs site's own compile path
 * (`fumadocs-mdx/node` `register` configured by `apps/docs/source.config.ts`, ids
 * read out of the compiled module — never inferred from library docs):
 * `remarkHeading` plus the workspace's single copy of `github-slugger@2.0.0`
 * de-duplicates them into `properties`, `properties-1`, `properties-2`, …,
 * identically on all three surfaces that consume an anchor — the rendered HTML
 * `id`, the fumadocs TOC url, and the search index. `ui/view.mdx` renders 215
 * headings with 215 distinct ids and 0 duplicates.
 *
 * ⛔ **So nothing should link to them**, and the missing qualifier is not a bug to
 * repair. That suffix is **positional**: `properties-17` means *the 18th
 * `Properties` heading in document order*, so inserting a schema section earlier
 * on the same page silently renumbers every anchor below it. A section-grammar
 * anchor is therefore unstable even though it is unique — only qualifying the
 * headings could buy stable addressing. Nothing in the repo links to one today
 * (measured: 0 hits across all 7296 tracked files, with a positive control and a
 * pattern control), and `check:doc-anchors` verifies that links RESOLVE, never
 * that anchors are UNIQUE — so its green says nothing about this in either
 * direction.
 *
 * Disposition: **accepted on the measurement.** The two alternatives were
 * qualifying the section grammar (rewriting every heading on 162 pages) and
 * demoting it to a non-heading rendering (changing the published rendering shape);
 * both pay a large price for a defect that has zero correctness harm — no
 * collision exists — and zero measured demand — no inbound link exists. Not closed
 * forever: should stable addressing of the section grammar ever become a product
 * requirement, qualification returns to the table, and the counts above are what
 * price it.
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

  const renderProperties = (
    props: any,
    required: Set<string> = new Set(),
    // The largest section-grammar population on the tree — 1133 of the 1316
    // excess headings (#12862). It repeats once per schema section on the page
    // and is deliberately unqualified; see the anchor note on
    // `renderSchemaSection` above for why, and for why nothing may link to it.
    heading = '### Properties',
    // A nested-shape table does not open tables of its own. ONE level, matched
    // to the ONE shape level `SHAPE_DEPTH_LIMIT` lets a cell open: the table
    // documents exactly what the cell above it summarized, and a page's depth
    // stays a fact about the renderer rather than about how deeply an author
    // happened to nest a schema.
    //
    // It also turns the cells into SUMMARY cells — `INLINE_ENUM_WIDTH_LIMIT`
    // with the unquantified `…`, and no `### Allowed Values` relocation. That
    // is the same flag `format-type.ts` sets below a `{ … }`, and it must be
    // set here for the same reason: this table is a SECOND position for those
    // keys, and #6225's relocation budget is only spendable where the
    // vocabulary's authoritative copy lives. Measured by regenerating without
    // it: the 288-member `ApiError.code` vocabulary relocated into a bullet
    // list under every nested `error` shape — **20,260 bullet lines across the
    // tree**, `api/metadata.mdx` alone +6097 — for a vocabulary already
    // published in full on `api/errors.mdx` and in `json-schema/`. #9182 took
    // the COUNT out of this position for a smaller version of the same cost;
    // taking the whole list out of it is the same decision.
    expandNested = true,
    // What the `### Nested Shape:` and `### Allowed Values:` headings below
    // qualify themselves BY — `schemaName` for a schema rendered whole, and
    // `schemaName` plus a variant selector (`ViewItem[viewKind='list']`) for a
    // table rendered from inside one arm of a top-level `### Union Options`.
    //
    // ## Why this is a parameter now (#12590)
    //
    // The union branch calls this function once per variant, and both halves of
    // the old `${schemaName}.${key}` qualifier are shared by every sibling
    // variant of one schema. Two `ViewItem` variants each declaring a
    // shape-opening `config` therefore emitted `### Nested Shape:
    // \`ViewItem.config\`` twice: two identical headings, i.e. **two identical
    // anchors on one page**, on the very heading whose qualifier exists to
    // prevent exactly that. Measured across the tree: 12 excess occurrences,
    // 10 distinct headings, 4 pages — every one of them under a schema
    // rendering `### Union Options`.
    //
    // The comment on `path` below (#12316) reasoned that an `owner` parameter
    // "would be a parameter nothing ever reads", and that was true of the level
    // it was written about: a nested-shape sub-table opens nothing of its own.
    // It did not hold one level UP, where the union branch is a second caller
    // of this function on the same schema name. So the owner is threaded from
    // there and nowhere else, and defaults to `schemaName` so that every
    // non-union call site — and the recursive sub-table call, which emits no
    // headings at all — is byte-identical to what it rendered before.
    //
    // ⛔ Not a new notation: the selector spelling comes from `variantSelector`
    // in `format-type.ts`, the same function that stamps the variant segment
    // into a property accessor (#12316). One grammar, one implementation.
    owner: string = schemaName,
  ) => {
      // Vocabularies too wide for their own table cell. Collected while the
      // table is built and printed as `### Allowed Values` bullets right after
      // it, so the complete list never leaves the page the cell sits on
      // (#6225) — the same rendering a hoisted `type: 'string'` + `enum` schema
      // has always got, now reachable from a property position too.
      const relocated: Array<{ key: string; members: string[] }> = [];
      // Shapes whose keys' `.describe()` text the cell above cannot carry at
      // all — there is no description column inside `{ … }` (#11601).
      const nested: Array<{ path: string; ownDescription: string; shape: NestedShape }> = [];
      // Empty for a nested-shape table: its `### Nested Shape: \`path\`` heading
      // IS its heading, and a `#### Properties` under every one of them would
      // put ~1200 identically-titled headings into the tree for no reader.
      let t = heading ? `${heading}\n\n` : '';
      t += `| Property | Type | Required | Description |\n`;
      t += `| :--- | :--- | :--- | :--- |\n`;
      for (const [key, prop] of Object.entries(props) as [string, any][]) {
          const { cell, allowedValues } = expandNested
            ? formatPropertyType(prop, typeCtx)
            : { cell: formatType(prop, { ...typeCtx, inShapeSummary: true }), allowedValues: null };
          if (allowedValues) relocated.push({ key, members: allowedValues });
          if (expandNested) {
            // EVERY shape the cell opens, not just the single-shape case
            // (#12316). A property whose type is a union of object shapes —
            // `ui/App.navigation`'s nine variants, `data/ConditionalValidation`'s
            // five — gets one sub-table per variant, each under the accessor
            // path that selects that variant (`navigation[number][type='sidebar']`).
            // The loop IS the whole change on this side: #12309 already emitted
            // a list of tables, it was `nestedShapeOf` that could only ever put
            // one thing in it.
            for (const shape of nestedShapesOf(prop, typeCtx)) {
              // Only where there is text to relocate, and decided PER VARIANT.
              // The cell already states the shape's KEYS (four of them, then
              // `…`) and their types; what it structurally cannot state is a
              // description, so a table carrying none would restate the cell in
              // more space. Applying it per variant is what keeps the rule the
              // same rule: `ui/FormView.submitBehavior` opens four shapes and
              // exactly one of them carries prose, so it gets exactly one
              // table. Measured on the tree at the time of #12309: 1208 of the
              // 1293 shape-opening rows carry at least one described key.
              if (!carriesDescription(shape)) continue;
              const own = typeof shape.node.description === 'string' ? shape.node.description : '';
              nested.push({
                // Qualified by OWNER and property, for the reason the
                // `### Allowed Values` headings below are: one page carries
                // many schemas, and a heading naming only the property would
                // give it two identical anchors. The owner is `schemaName`
                // alone everywhere except inside a top-level union variant,
                // where it carries that variant's selector too — because the
                // schema name is shared by all of a union's siblings and so
                // qualifies nothing between them (#12590). The variant
                // selector inside `accessor` is what extends that same
                // qualification down one more level, so nine sub-tables under
                // one property still carry nine distinct anchors.
                path: `${owner}.${key}${shape.accessor}`,
                // The element/value node's OWN describe, when it is not simply
                // the property's — that one is already in the row above. On a
                // union this is the VARIANT's describe, which is the line that
                // says what distinguishes it from its eight siblings, so it
                // earns its position here more than it does on a lone shape.
                ownDescription: own && own !== prop.description ? own : '',
                shape,
              });
            }
          }
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
      // Qualified by OWNER and property: `api/errors.mdx` carries a wide
      // `code` on both `EnhancedApiError` and `FieldError`, so a heading naming
      // only the property would give one page two identical anchors. Sibling
      // variants of ONE union are the same collision one level in — they share
      // the schema name — so the owner carries the variant selector there
      // (#12590). No page has two such headings today; covering this position
      // in the same change is what stops the next wide vocabulary declared on
      // two variants from reopening the defect.
      for (const { key, members } of relocated) {
          t += `### Allowed Values: \`${owner}.${key}\`\n\n`;
          t += members.map(m => `* \`${m}\``).join('\n');
          t += `\n\n`;
      }
      // The relocations above, for shapes. Same position (immediately under the
      // table whose cells they complete), same addressing (`Schema.key…`), same
      // heading level — one page grammar, not a second one. The heading names
      // the shape with a TypeScript indexed accessor (`items[number]`), so it
      // states WHICH shape without inventing a sigil for the table.
      for (const { path, ownDescription, shape } of nested) {
          t += `### Nested Shape: \`${path}\`\n\n`;
          if (ownDescription) {
              t += `${escapeMdxDescription(ownDescription.replace(/\n/g, ' '))}\n\n`;
          }
          // Tombstoned keys are rendered here, unlike in the cell above: the
          // `[REMOVED]` prescription needs a description column, and a summary
          // has none — which is exactly why `format-type.ts` drops them from
          // `{ … }` and says a named schema's own row is where they survive.
          // This IS that row, for a shape that never had one.
          t += renderProperties(
              shape.node.properties,
              new Set(shape.node.required || []),
              '',
              false,
              // Passed through rather than defaulted: this call emits no
              // headings today (`expandNested: false` collects neither
              // relocation nor nested shape), so it is the owner's value that
              // is unobservable here, never the owner's correctness. Letting it
              // fall back to `schemaName` would plant a wrong value waiting for
              // the day this table is allowed to open something.
              owner,
          );
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

     // Which variants are heading-emitting contexts at all — only the object
     // branch below calls `renderProperties`, and only `renderProperties`
     // emits `### Nested Shape:` / `### Allowed Values:` headings. An `enum`,
     // `$ref` or scalar arm prints one line and can collide with nothing.
     const emitsHeadings: boolean[] = variants.map(
       (variant: any) => variant?.type === 'object' && !!variant.properties,
     );
     const emitters = emitsHeadings.filter(Boolean).length;
     // Fewer than two and there is nothing to tell apart: a lone object arm's
     // headings are already unique on the page, so it keeps the exact bytes it
     // rendered before. This mirrors the walk's own `total < 2` rule in
     // `nestedShapesOf` — a selector is spent only where the union is what
     // distinguishes the thing being named — measured on the same principle:
     // every heading outside the duplicate population stays byte-identical.
     const discriminant = emitters >= 2 ? discriminantKeyOf(variants, emitsHeadings) : null;

     variants.forEach((variant: any, index: number) => {
         const variantTitle = variant.title || `Option ${index + 1}`;
         md += `#### ${variantTitle}\n\n`;
         if (variant.description) md += `${escapeMdxDescription(variant.description)}\n\n`;

         if (variant.type === 'object' && variant.properties) {
              if (variant.properties.type && variant.properties.type.const) {
                  md += `**Type:** \`${variant.properties.type.const}\`\n\n`;
              }
              // The owner this variant's headings qualify themselves by. The
              // selector segment is the one `format-type.ts` stamps into a
              // property accessor for the same union (#12316) — discriminant
              // where every emitting variant pins a distinct literal, positional
              // otherwise. Getting that fallback right IS the fix: a
              // discriminant shared by two variants would re-create the
              // duplicate anchors through the qualifier meant to remove them,
              // which is exactly what `discriminantKeyOf`'s distinctness test
              // refuses to answer.
              const variantOwner =
                emitters >= 2
                  ? `${schemaName}${variantSelector(variant, index, discriminant)}`
                  : schemaName;
              md += renderProperties(
                variant.properties,
                new Set(variant.required || []),
                '### Properties',
                true,
                variantOwner,
              );
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
