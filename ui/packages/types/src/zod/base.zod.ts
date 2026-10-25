/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Base Schema Zod Validators
 * 
 * Zod validation schemas for base component types.
 * These schemas follow the @objectstack/spec UI specification format.
 * 
 * @module zod/base
 * @packageDocumentation
 */

import { z } from 'zod';
import { I18nLabelSchema } from '@objectstack/spec/ui';
import { aliasKeyRefusal, retirementTombstone } from './tombstone.zod.js';
import { ExpressionWireSchema } from './expression.zod.js';
import {
  EvaluatedExpressionInputSchema as SpecEvaluatedExpressionInputSchema,
  EvaluatedExpressionSchema as SpecEvaluatedExpressionSchema,
} from '@objectstack/spec/shared';
import type { SchemaNode } from '../base.js';
import { stripImportedDefaults } from './imported-defaults.js';

/**
 * ⭐ THE IMPORT BOUNDARY (objectui#8317, decision batch #90, 2026-09-08).
 *
 * **This mirror authors no default, imported subschemas included.** Batch #69
 * (objectui#7735) ruled that a validator validates and does not write values
 * into an author's document; batch #90 ruled that this holds for EVERY key
 * `safeValidateSchema` answers, not only the sites this repository wrote. So a
 * schema arriving from `@objectstack/spec` crosses into a mirror shape only
 * through `stripImportedDefaults`, which removes each reachable `ZodDefault`
 * with `.removeDefault()` and keeps the key omissible. Keys, types, checks and
 * the accept set are untouched, and a subtree carrying no default comes back
 * reference-equal — so this is a no-op the day the spec adopts the same
 * principle.
 *
 * ⛔ Spelled at every crossing rather than once per file, deliberately: a local
 * `const Spec… = stripImportedDefaults(…)` would put the spec's provenance one
 * hop away from every declaration that reads it, and `check:spec-symbols`
 * (rule 1) reads exactly one hop — a mirror export under a spec-owned name has
 * to show the spec binding in its OWN initializer. The verbosity is the
 * provenance.
 *
 * ⚠️ A read that is NOT a crossing stays unwrapped and is declared as such: a
 * value VOCABULARY (`./views.zod.ts`'s `SpecListViewTypeEnum` and
 * `./objectql.zod.ts`'s `ViewKindEnum`, which unwrap the spec's own
 * `.default('grid')` to reach its enum) and a TYPE position — neither puts a
 * default into a parsed document. `../__tests__/imported-defaults-8317.test.ts`
 * re-derives that exception list from the source rather than trusting this
 * paragraph, and fails if an entry stops matching a real read.
 */


/**
 * A KEYED i18n label — the runtime mirror of `KeyedI18nLabel` in `../base.ts`.
 *
 * ⚠️ This is objectui's OWN label vocabulary, and it is NOT the spec's
 * `I18nLabelSchema` that `label` / `description` below declare. The two are
 * structurally confusable and answer wrongly for each other's input — the
 * objectui#4167 hazard, which #4580's Q2-B ruling turned on:
 *
 *  - KEYED (this schema): `{ key, defaultValue?, params? }`, a reference INTO a
 *    translation bundle, resolved by `resolveKeyedI18nLabel`
 *    (`packages/react/src/utils/i18n.ts`). `ariaLabel` declares this one.
 *  - INLINE (`I18nLabelSchema`): a locale MAP like `{ en: 'Owner' }`, resolved
 *    against a BCP-47 locale by the spec's own `resolveI18nLabel(label,
 *    locale)`. `label` and `description` declare that one.
 *
 * Hand-written rather than taken from the spec because the spec has no keyed
 * form: `I18nLabelSchema` REJECTS `{ key, defaultValue }` at parse time, and
 * objectstack#9925 made both limbs `never` on its type axis for the same
 * reason. The shape here mirrors `KeyedI18nLabel` limb-for-limb.
 */
export const KeyedI18nLabelSchema = z.object({
  key: z.string().describe('Translation-bundle key, e.g. `dialog.close`'),
  defaultValue: z.string().optional().describe('Rendered when the key is missing from the bundle'),
  params: z.record(z.string(), z.any()).optional().describe("Interpolation values for the key's placeholders"),
});


/**
 * Fill the node recursion point with the component union, and hand it straight
 * back — so the fill is part of `AnyComponentSchema`'s own initializer in
 * `index.zod.ts` rather than a bare statement beside it (objectui#8344).
 *
 * ## ⚠️ Why a WRITE INTO the union's option list, and not a `z.lazy` holder
 *
 * The obvious spelling — a `let` the `z.lazy` getter reads — is WRONG here, and
 * measurably so. `z.lazy` MEMOISES: zod 4.4.3 caches the resolved inner on first
 * access, and merely parsing any component schema resolves it (the union arm walk
 * reads every option to compute its own metadata, so a childless `detail-view` node
 * is enough). ⇒ whatever the getter returned FIRST would be the accept set for the
 * rest of the process, decided by whichever module graph parsed first — and this
 * repo's `isolate: false` unit project shares one module graph across every file in
 * a worker. Measured on this branch with that spelling in place: the #8344 pin
 * PASSED run alone and FAILED in the full run, because
 * `__tests__/handler-keys-string-any-mirrors-7344.test.ts` parses from a barrel-free
 * import graph and froze the base shape in first. Refusing instead of falling back
 * converges, but turns that same import order into dozens of red suites.
 *
 * ⭐ A `z.union` does NOT memoise its options: measured on zod 4.4.3, `z.union(opts)`
 * keeps `opts` BY REFERENCE and re-reads it on every parse, so writing slot 0 takes
 * effect immediately — including after parses have already run through it. That is
 * what makes the window disappear rather than merely move: before the fill a child
 * slot answers exactly as it did pre-#8344, after it every parse sees the component
 * union, and no first-parse ever freezes the wrong answer in.
 *
 * ⚠️ That by-reference behaviour is the load-bearing assumption, so it is ASSERTED
 * here rather than trusted: a zod that copied the array would leave this silently
 * under-enforcing — the one failure direction that never announces itself.
 *
 * ⚠️ The parameter bound is `z.ZodType`, not `z.ZodType< SchemaNode, SchemaNode >`,
 * and that too is measured. The tighter bound is the one this wiring wants — "the
 * recursion point may only be filled with something a declared `SchemaNode` slot
 * could already hold" — and `tsc` refuses it TODAY for exactly one arm out of 106:
 * `complex.zod.ts#ChatbotSchema` mirrors the chat API body params under the key
 * `body`, which is `BaseSchema`'s CHILDREN slot (`Record< string, unknown >` where
 * the base says `SchemaNode | SchemaNode[]`). That collision is pre-existing and
 * already recorded — the parity ledger carries it under `KnownDrift`, the TS
 * declaration renamed the key to `requestBody`, and `ChatbotSharedMirrorShape` in
 * `complex.zod.ts` says in as many words that a ruling on `ChatbotSchema`'s own
 * `body` arm is a separate question. ⛔ #8344 does not decide it either. So the bound
 * is loose HERE and the real check is kept EXACT one level out, as a type-level pin
 * naming that single arm in `__tests__/node-recursion-point-8344.test.ts`. ⇒ a SECOND
 * arm drifting the same way turns that pin red instead of passing unnoticed.
 *
 * ⚠️ AMENDED (objectui#8572 ruling A, recorded here by objectui#9659). The paragraph
 * above is kept in the tense it was written in, because what it records is WHY the bound is
 * loose — but the arm it names has since moved: `ChatbotSchema.body` is an ADR-0049
 * retirement tombstone on both published faces, so the exclusion set that pin reads is now
 * EMPTY and the pin asserts `never`. ⛔ Do not read the paragraph as a live census of what
 * `tsc` refuses today; the pin is the instrument, and it is the one that answers.
 *
 * @internal — the package's only zod entry point is the `./zod` barrel, which is
 * `index.zod.ts`; this exists for that one call site and is not re-exported.
 */
export function defineNodeComponentUnion<T extends z.ZodType>(union: T): T {
  // ⭐ objectui#8344 F2 — what goes into the slot is the component union itself.
  //
  // WHY A `superRefine` WRAPPER USED TO SIT HERE. `ChatbotSchema.body` mirrored the chat API's
  // body params as a record, which was WIDER than `BaseSchemaCore.body` — the only wider
  // redeclaration among the 109 base-key redeclarations across the arms — so installing the
  // union bare would have narrowed at 108 child slots and WIDENED at one. #8344's appetite
  // forbade widening in flight, so the INSTALLED arm carried a clause that re-issued the
  // node-slot's own refusal under `body` for a `chatbot` node, and the published mirror was
  // left alone.
  //
  // WHY IT IS GONE (objectui#9659, carrying a contract-review residual on objectui#9639).
  // Ruling A on objectui#8572 made `ChatbotSchema.body` an ADR-0049 retirement tombstone on
  // both published faces, so the arm refuses the key BY ITSELF, at every depth. The note that
  // stood here said the clause was REDUNDANT but ⛔ not removable "until a card decides
  // otherwise". This is that card, and the disposition rests on a MEASUREMENT rather than on
  // the redundancy argument:
  //
  //   1. the clause could no longer FIRE, not merely no longer matter. zod skips a check once
  //      the schema it wraps has refused, and the arm refuses every DEFINED `body` — measured
  //      key by key over record / node / node[] / string / number / boolean / null / [] / {},
  //      all REFUSED — while the clause's own first line returns early on `undefined`. ⇒ the
  //      two conditions "reaches the clause" and "has a `body` to check" had become disjoint;
  //   2. read on the issue tree of a nested refusal: the arm's tombstone at `body.0.body` and
  //      NO clause-shaped issue. The same probe against the pre-#9639 record arm produces the
  //      clause's `body.0.body` issue and no tombstone — the lit control that makes the zero
  //      above a reading rather than a broken instrument;
  //   3. ⇒ the accept set does not move: a clause that cannot fire cannot be narrowing
  //      anything. Pinned over the 432-document schema catalog plus a 60-case sweep of the
  //      three chatbot faces x ten `body` shapes x both depths, byte-identical either way.
  //
  // ⛔ What must NOT happen now is the opposite of #8344's old instruction: do not restore a
  // record `body` arm on that mirror to make a narrowing clause meaningful again.
  //
  // ⚠️ The WRAPPER was load-bearing independently of what it checked, and that role is kept,
  // not dropped: `__tests__/node-recursion-point-8344.test.ts` reads that slot 0 holds the
  // component union and not the pre-#8344 `BaseSchemaCore`, and the read-back assertion below
  // throws when the recursion point did not take. Retiring the clause re-points both at the
  // INSTALLATION, which is what they were really for.
  nodeUnionOptions[0] = union;
  // The assertion the paragraph above exists for. ⛔ Do not delete it as noise: it is
  // the only thing standing between a zod that copies its option array and a
  // recursion point that silently reverts to the pre-#8344 base shape.
  const readBack = (nodeUnion as unknown as { _zod: { def: { options: readonly unknown[] } } })._zod.def.options[0];
  if (readBack !== union) {
    throw new Error(
      'objectui#8344: `z.union` no longer keeps its option array by reference, so the node '
      + 'recursion point did not take. The redirect is INERT and every nested node is being '
      + 'judged by `BaseSchemaCore` again — see `defineNodeComponentUnion` in base.zod.ts.',
    );
  }
  return union;
}

/**
 * The type of {@link SchemaNodeSchema}, named by a type alias rather than spelled in
 * the annotation (objectui#11466). `SchemaNode` (`../base.ts`) is the declared-node
 * union, and resolving it walks back into this module's consts: through
 * `AuthoringNode`, whose public-block members are the `z.input` of arms built on
 * `BaseSchema` below. Type arguments spelled in a const's annotation are resolved
 * eagerly, so they would reference themselves (TS4109); inside a type alias they are
 * resolved when they are read. Typing only: the schema object does not change.
 */
type SchemaNodeZodType = z.ZodType<SchemaNode, SchemaNode>;

/**
 * The type of {@link NodeSlotSchema}, the single-or-list node slot, written out for
 * the same reason as {@link SchemaNodeZodType}: inferring it from the `z.union` call
 * would resolve `SchemaNode` while `SchemaNode` is being resolved.
 */
type NodeSlotZodType = z.ZodOptional<z.ZodUnion<readonly [SchemaNodeZodType, z.ZodArray<SchemaNodeZodType>]>>;

/**
 * Schema Node — what a child slot holds: a COMPONENT document, or a primitive.
 *
 * ## The component arm is `AnyComponentSchema` (objectui#8344)
 *
 * Every child slot (`body`, `children`, and every per-component redeclaration of
 * them) is `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`, so this const
 * is where the whole node tree recurses. Until #8344 the component arm was
 * `BaseSchemaCore` — the ~21 base keys and NOTHING type-specific — which made
 * per-type enforcement ROOT-ONLY, at every depth, for every component type. That
 * is the finding objectui#8344 discharged: an off-spec `size` on a NESTED `icon` node was
 * accepted, and the same node alone was refused. Pointing the arm at the union of
 * the registered component mirrors is the whole of this change; ⛔ nothing here is
 * `.strict()`, and `BaseSchemaCore` keeps its passthrough.
 *
 * Priced at 9 newly-refused corpus documents (objectui#8344's R3, 54 / 553 against
 * R1's 45 / 553), each one pre-existing debt this SURFACES rather than creates:
 * four whose child `type` resolves in no arm, five already red under their own
 * schema and shielded until now by the recursion point.
 *
 * ## ⚠️ Why the arm is late-bound and not imported
 *
 * `AnyComponentSchema` is built in `index.zod.ts` out of every category module, and
 * each of those modules imports THIS one — so naming it here is a module cycle, and
 * `z.lazy` defers the EVALUATION, not the module graph. With that import in place,
 * entering the graph at `base.zod.js` evaluates `app.zod.ts`'s body while
 * `BaseSchema` is still in its temporal dead zone and the package throws on import.
 * ⇒ the break is deliberate: `index.zod.ts` fills the holder through
 * {@link defineNodeComponentUnion} as it constructs the union, which is module
 * evaluation and therefore strictly before anything can parse.
 *
 * ⚠️ BEFORE the fill — a module graph that reaches a parse without ever evaluating
 * `index.zod.js` — the arm is `BaseSchemaCore`, i.e. exactly the pre-#8344 accept
 * set, and it switches the moment the barrel loads. That is a property of the WRITE,
 * not a tolerated fallback: `z.union` re-reads its option array on every parse, so
 * nothing can freeze the pre-fill answer in ({@link defineNodeComponentUnion} carries
 * the measurement, and why the obvious `z.lazy` holder is wrong). No published entry
 * point can reach that window BY MODULE GRAPH: `./zod` is this package's only zod
 * subpath and it IS `index.zod.js`. Pinned in
 * `__tests__/node-recursion-point-8344.test.ts`.
 *
 * ⛔ ⚠️ THAT SENTENCE IS ABOUT MODULE GRAPHS, AND A BUNDLER IS NOT ONE. This package
 * declares `"sideEffects": false` and the fill is a statement in this barrel's body,
 * so a bundler that honours the flag and sees no reference to `AnyComponentSchema`
 * may drop the whole const — fill included — and then every child slot validates
 * with the PRE-#8344 arm. Measured on the published `dist/zod` face of this package
 * (Vite 8.2.1 lib build, `es`, esbuild-minified, `zod` 4.4.3 and `@objectstack/spec`
 * external, so the figures are this package's own bytes — the same instrument and
 * the same figures the objectui#8344 changeset cites): a barrel entry importing only
 * `CardSchema` ACCEPTS a nested off-spec node (212,567 bytes, fill absent), an entry
 * that deep-links `layout.zod.js` ACCEPTS it too (212,563 bytes, fill absent), and
 * the barrel entry with `AnyComponentSchema` also imported REFUSES it (750,542
 * bytes, fill present). The guard below cannot see this: it runs inside the code
 * that was dropped. ⇒ this window is silent, it is NOT the pre-fill window this
 * paragraph describes, and it ships DECLARED (objectui#8344 decision batch #98): an
 * external consumer whose bundler honours the flag and never reads
 * `AnyComponentSchema` keeps the pre-#8344 accept set for NESTED nodes; root-level
 * enforcement and every consumer whose graph reads the union get the new set.
 * Closing it is objectui#8598 — the `./zod` face built as ONE module — ⛔ not an
 * import of the union from here: that spelling was measured to throw at load in a
 * real consumer's bundle (the changeset carries the CI evidence).
 *
 * ## Both type arguments are filled, and that is the whole published input face
 *
 * `z.ZodType< SchemaNode, SchemaNode >` — OUTPUT and INPUT. The annotation is still
 * here for the reason it always was: the initializer names `BaseSchemaCore`, which
 * names this const back through its own `body` / `children` slots, so without an
 * explicit type TypeScript cannot resolve either one. What changed (objectui#7760,
 * maintainer ruling, decision batch #69) is the ARGUMENT. It used to be `any`, and
 * zod 4 defaults the INPUT parameter of `z.ZodType< any >` to `unknown` — so every
 * slot spelled through this const published `unknown` as the shape an author may
 * write, which is wider than every declaration BY DEFINITION and says nothing about
 * what this schema accepts at runtime.
 *
 * ⛔ `SchemaNode` in `../base.ts` did NOT move under #8344 either: the TS face still
 * said `BaseSchema | primitive`, and `BaseSchema` carried an index signature, so the
 * runtime accept set was NARROWER than the declaration rather than wider. The
 * declaration repair was its own worklist and ⛔ not this const's to make.
 * ⚠️ Dated note, 2026-10-02 (objectui#11466): that repair has landed. `SchemaNode`'s
 * object arm is `DeclaredNode`, the union of the declared node types with no
 * `type: string` arm, so an undeclared `type` is refused on the TS face too. The
 * members that extend `BaseSchema` kept its index signature until objectui#8347
 * removed it; a key they do not declare is refused on the TS face now as well.
 * The two sentences above are kept as the reading at #8344.
 *
 * ⭐ What #7760 bought: `__tests__/zod-mirror-parity.test.ts` can now compare the
 * `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])` single-or-list slots that
 * the card behind `2760075ff` called this repo's systematic producer and had to EXCLUDE — its
 * `Unconstrained` predicate was dropping every one of them. Three real widenings came
 * out of that region on the first run and are ledgered there.
 *
 * ⚠️ Seven of the ten recursion-breaking mirrors took this treatment; three refused
 * it and keep `z.ZodType<any>` (`app.zod.ts#NavigationItemSchema`,
 * `complex.zod.ts#FilterBuilderConditionSchema` and, transitively,
 * `complex.zod.ts#FilterGroupSchema`) — in each case because the mirror already
 * ACCEPTS more than its declaration states, so filling the argument is the wider
 * comparison and `tsc` refuses the assignment. ⛔ Do not "fix" those three by widening
 * a declaration or narrowing a mirror to make the annotation fit: either is a
 * contract change wearing a type-annotation's clothes, and both are ruled elsewhere.
 */
export const SchemaNodeSchema: SchemaNodeZodType = z.lazy(() => {
  // `z.lazy` memoises this getter, and that is FINE — because what it returns is the
  // one live union, whose option slot 0 IS the recursion point and is written by
  // {@link defineNodeComponentUnion}. ⛔ Do not move the union's CONSTRUCTION in here:
  // a getter that builds the union is the memoising spelling objectui#8344 measured
  // wrong, and it would put the accept set back at the mercy of import order.
  return nodeUnion;
});

/**
 * `BaseSchemaCore`'s `children` slot: one node or a list of nodes. It is the same
 * schema it always was, `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`,
 * held in a const only so its type can be written out ({@link NodeSlotZodType},
 * objectui#11466). Typing only: the accept set does not change.
 */
const NodeSlotSchema: NodeSlotZodType = z
  .union([SchemaNodeSchema, z.array(SchemaNodeSchema)])
  .optional()
  .describe('Child components (React-style)');

/**
 * `visibleWhen`'s wire: the spec's `EvaluatedExpressionInputSchema`, by
 * reference, WITHOUT its string transform (objectui#8347, ruled Q6 = B).
 *
 * The TypeScript twin is the spec's input type, `EvaluatedExpressionInput`
 * (`../base.ts`). The accept set here is that type's: a predicate string, or
 * the envelope arm, which is the spec's own `EvaluatedExpressionSchema` read by
 * reference. Every verdict is the spec's: the value is handed to
 * `EvaluatedExpressionInputSchema` and its issues are the refusal, so a blank
 * predicate string is refused with the spec's sentence. What is NOT taken is
 * the spec's transform, which rewrites a bare string into
 * `{ dialect: 'cel', source }` at parse: this mirror authors nothing into a
 * parsed document, so a string stays a string.
 * `../__tests__/visible-when-spec-input-8347.test.ts` pins both halves.
 */
const VisibleWhenInputSchema = z
  .union([z.string(), stripImportedDefaults(SpecEvaluatedExpressionSchema)])
  .superRefine((predicate, ctx) => {
    const verdict = stripImportedDefaults(SpecEvaluatedExpressionInputSchema).safeParse(predicate);
    if (!verdict.success) {
      for (const issue of verdict.error.issues) ctx.addIssue({ code: 'custom', message: issue.message });
    }
  });

/**
 * Base Schema - Core validation schema that all components extend
 * 
 * This is the foundation for all UI component schemas in ObjectUI.
 * Following @objectstack/spec UI specification format.
 */
const BaseSchemaCore = z.object({
  /**
   * Component type identifier
   */
  type: z.string().describe('Component type identifier'),

  /**
   * Unique identifier for the component
   */
  id: z.string().optional().describe('Unique component identifier'),

  /**
   * Human-readable name
   */
  name: z.string().optional().describe('Component name'),

  /**
   * Display label.
   *
   * The spec's INLINE locale map (`string | Record<string, string>`), embedded
   * BY REFERENCE so a change to the spec's own label contract is picked up
   * here rather than re-typed — the same property `specFieldsExcept` below
   * relies on. Mirrors `BaseSchema.label: string | I18nLabel` (`../base.ts`),
   * widened by #4580's revised Q1-A ruling.
   */
  label: stripImportedDefaults(I18nLabelSchema).optional().describe('Display label (plain string or inline locale map)'),

  /**
   * Description text.
   *
   * Same vocabulary and same resolver as `label` above — see `BaseSchema.description`.
   */
  description: stripImportedDefaults(I18nLabelSchema).optional().describe('Description text (plain string or inline locale map)'),

  /**
   * Placeholder text
   */
  placeholder: z.string().optional().describe('Placeholder text'),

  /**
   * Tailwind CSS classes
   */
  className: z.string().optional().describe('Tailwind CSS classes'),

  /**
   * Inline styles
   */
  style: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Inline CSS styles'),

  /**
   * Arbitrary data
   */
  data: z.any().optional().describe('Custom data payload'),

  /**
   * Data-scope path, resolved by `useDataScope()`.
   *
   * Mirrors `BaseSchema.bind: string` (`../base.ts`, objectui#6357). The pair
   * `base.zod.ts#BaseSchema` carries no `KnownDrift` / `UnmirroredDeclared`
   * entry, so this member is not optional housekeeping: a key declared on the
   * TS side and missing here reddens `zod-mirror-parity.test.ts` by name.
   *
   * `z.string()` and not `z.any()` because that is what the resolver accepts —
   * `useDataScope` is `(path?: string)` and resolves via `path.split('.')`, so
   * a non-string value threw at render time and this rejects it at parse time.
   */
  bind: z.string().optional().describe('Data-scope binding path (resolved by useDataScope)'),

  /**
   * RETIRED (objectui#6771) — mirrors `BaseSchema.body: never` (`../base.ts`).
   *
   * A bare deletion would be a silent accept, not a refusal: this object ends
   * `.passthrough()`, so an undeclared `body` parses green and reaches a
   * renderer that no longer reads it. The alias refusal keeps the key
   * declared and unwritable, and names `children` in the issue message —
   * the remedy, not just the rejection.
   */
  body: aliasKeyRefusal(
    'body',
    'children',
    'this node',
    'The `body` child-list spelling was retired by objectui#6771 — one concept, '
    + 'one spelling. Every registration that read it now reads `children`.',
  ),

  /**
   * Child components or content — the one child-list spelling (objectui#6771)
   */
  children: NodeSlotSchema,

  /**
   * Visibility control — a boolean, or the predicate STRING the renderer
   * evaluates.
   *
   * Mirrors `BaseSchema.visible: boolean | string` (`../base.ts`), widened by
   * #4581. `SchemaRenderer.tsx` passes this key to
   * `evaluator.evaluateCondition`, which is declared
   * `(condition: string | boolean | undefined, …) => boolean` — so the string
   * form is an implemented, evaluated capability, and this validator was the
   * one surface still refusing it.
   *
   * Widened again by objectui#7530 (ruled 2026-09-04, option A, all three
   * predicate keys at once) to the CEL envelope object: the expression half is
   * now `ExpressionWireSchema` (`./expression.zod.ts`), the one string-or-
   * envelope union `visibleWhen` on form fields already used, imported rather
   * than spelled a second time. Measured before: the envelope this validator
   * refused at path `visible` (`invalid_union`) parsed on `FormField.visibleWhen`
   * one file over, while the renderer evaluated it on both.
   */
  visible: z.union([z.boolean(), ExpressionWireSchema]).optional().describe('Visibility control (boolean, predicate expression string, or CEL envelope object)'),

  /**
   * Canonical conditional-visibility predicate (ADR-0089) — shown when truthy.
   * The spec folds the deprecated `visibleOn` / `visibility` aliases into this.
   * The spec's evaluated-slot input, by reference and untransformed — see
   * `VisibleWhenInputSchema` above (objectui#8347).
   */
  visibleWhen: VisibleWhenInputSchema.optional().describe('Canonical conditional-visibility predicate (ADR-0089)'),

  /**
   * Conditional visibility expression
   * @deprecated ADR-0089 — use `visibleWhen`.
   */
  visibleOn: z.string().optional().describe('[DEPRECATED → visibleWhen] Expression for conditional visibility'),

  /**
   * Hidden control -- a boolean, or the predicate STRING the renderer evaluates.
   *
   * Mirrors `BaseSchema.hidden: boolean | string` (`../base.ts`), widened by
   * objectui#7455 (ruled 2026-09-03) on the same evidence that widened
   * `visible` (#4581) and `disabled` (#4580 Q3-A): `SchemaRenderer`'s
   * `shouldHide` chain asks `hasDeclaredPredicate` and then evaluates the
   * value, never reading this key as a boolean. Measured before the widening:
   * `BaseSchema.safeParse({ type, hidden: '${data.status === "draft"}' })`
   * returned `success: false` with `invalid_type` (expected boolean, received
   * string) while the identical string on `visible` parsed -- this validator
   * was the one surface still refusing a shipped, pinned capability.
   *
   * The CEL envelope object form is declared too, since objectui#7530 (ruled
   * 2026-09-04, option A, all three keys at once): the expression half is
   * `ExpressionWireSchema` (`./expression.zod.ts`), shared with `visible`,
   * `disabled` and the form predicate keys. `hasDeclaredPredicate` had accepted
   * `{ dialect: 'cel', source }` on this key all along.
   */
  hidden: z.union([z.boolean(), ExpressionWireSchema]).optional().describe('Hidden control (boolean, predicate expression string, or CEL envelope object)'),

  /**
   * Conditional hidden expression
   */
  hiddenOn: z.string().optional().describe('Expression for conditional hiding'),

  /**
   * Disabled state — a boolean, or the predicate STRING the renderer evaluates.
   *
   * Mirrors `BaseSchema.disabled: boolean | string` (`../base.ts`), widened by
   * #4581 under #4580's Q3-A ruling: the renderer reads this key through the
   * same `evaluateCondition` as `visible`, and the asymmetry between the two
   * was accidental rather than deliberate.
   *
   * Widened again by objectui#7530 (ruled 2026-09-04, option A, all three
   * predicate keys at once) to the CEL envelope object, through the shared
   * `ExpressionWireSchema` (`./expression.zod.ts`).
   */
  disabled: z.union([z.boolean(), ExpressionWireSchema]).optional().describe('Disabled state (boolean, predicate expression string, or CEL envelope object)'),

  /**
   * Conditional disabled expression
   */
  disabledOn: z.string().optional().describe('Expression for conditional disabling'),

  /**
   * Test ID for automated testing
   */
  testId: z.string().optional().describe('Test identifier'),

  /**
   * Accessibility label — a plain string, or the KEYED i18n reference.
   *
   * Mirrors `BaseSchema.ariaLabel: string | KeyedI18nLabel` (`../base.ts`).
   * ⚠️ KEYED, NOT the spec's inline locale map two properties up: the renderer
   * reads this slot with `resolveKeyedI18nLabel`, which returns `undefined`
   * for a locale map and would render an EMPTY aria-label. #4580's Q2-B ruling
   * withdrew the `I18nLabel` spelling as measured-wrong for exactly that.
   */
  ariaLabel: z.union([z.string(), KeyedI18nLabelSchema]).optional().describe('Accessibility label (plain string or keyed i18n reference)'),
}).passthrough(); // Allow additional properties for type-specific extensions

/**
 * Base Schema - Export for use in other schemas
 */
export const BaseSchema = BaseSchemaCore;

/**
 * The one node union every child slot recurses through — built HERE, immediately
 * below `BaseSchemaCore`, because slot 0 holds it (objectui#8344).
 *
 * Slot 0 is the RECURSION POINT and is the only slot that ever changes:
 * `BaseSchemaCore` while `index.zod.ts` has not been evaluated, `AnyComponentSchema`
 * from the moment it has. `z.union` re-reads this array on every parse, so the swap
 * is live and no parse can freeze the pre-fill answer in — the whole reason the
 * arm is a written slot rather than a `z.lazy` holder ({@link defineNodeComponentUnion}
 * carries the measurement).
 *
 * ⛔ Never export this array or this union. `SchemaNodeSchema` is the public handle
 * and identity on it is what objectui#7918 consequence ① says is stable; a second
 * exported name for the same shape would give the parity census a row to compare
 * that has no TS declaration behind it.
 */
/**
 * ⚠️ Both of these are `const` DECLARATIONS, ⛔ never assignments to a `let` hoisted
 * above `BaseSchemaCore`. `@object-ui/types` declares `"sideEffects": false`, and a
 * bare top-level assignment is a load-time side effect a bundler is entitled to drop
 * whole — `scripts/__tests__/side-effects-declaration-consistency.test.ts` fails on
 * exactly that, and it caught this file mid-#8344. Everything above that names them
 * does so from inside a function body, which runs long after this line.
 */
const nodeUnionOptions: [z.ZodType, ...z.ZodType[]] = [
  BaseSchemaCore,
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.undefined(),
];

const nodeUnion = z.union(nodeUnionOptions) as unknown as SchemaNodeZodType;

/**
 * A spec schema's fields, minus the keys objectui declares locally, as an
 * all-optional shape ready for `BaseSchema.extend(…)` (objectstack#4115).
 *
 * `BaseSchema` is `.passthrough()` while the spec's document schemas are
 * strict, so a renderer node that does not declare the spec's fields lets
 * every one of them ride through *unvalidated*. Spreading this result back in
 * makes them validated again without closing the node to renderer props.
 *
 * Two deliberate properties:
 *  - **by reference** — a field the spec adds is picked up automatically
 *    rather than re-typed (and the per-node drift guard fails if it was never
 *    triaged);
 *  - **`.partial()`** — no future spec field can become required and silently
 *    invalidate payloads objectui has already stored.
 *
 * Reads `.shape` rather than calling `SpecSchema.omit({…}).partial()` because
 * zod 4 refuses `.omit()` on an object carrying refinements — spec's
 * `PageSchema` has one, so the idiomatic form throws at import time.
 */
export function specFieldsExcept<T extends z.ZodRawShape, K extends keyof T & string>(
  shape: T,
  omit: readonly K[],
) {
  const kept = Object.fromEntries(
    Object.entries(shape).filter(([key]) => !omit.includes(key as K)),
  ) as Omit<T, K>;
  return z.object(kept).partial();
}

/**
 * One coarse control kind an input may declare — the enforced half of
 * `ComponentInputControlType` in `../base.ts`. Exported so a consumer that
 * needs the arm vocabulary at runtime reads it from here instead of writing a
 * twelfth copy of the list.
 */
export const ComponentInputControlTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'enum',
  'array',
  'object',
  'color',
  'date',
  'code',
  'file',
  'slot',
]);

/**
 * Component Input Configuration
 */
export const ComponentInputSchema = z.object({
  name: z.string().describe('Property name'),
  /**
   * One coarse kind, or a NON-EMPTY array of distinct kinds for a key whose
   * contract is a union (objectui#3832). Both bounds are enforced rather than
   * tolerated, because this is where an authoring slip is cheapest to catch:
   * an empty array declares an input nothing can satisfy (and the serializer
   * would have to invent an arm for it), and a repeated arm means the author
   * believes they said something they did not. The single-kind form stays
   * valid — it is the canonical spelling for a one-arm key.
   */
  type: z.union([
    ComponentInputControlTypeSchema,
    z.array(ComponentInputControlTypeSchema)
      .min(1)
      .refine((arms) => new Set(arms).size === arms.length, {
        message: 'Input control type arms must be distinct',
      }),
  ]).describe('Input control type, or the arms of a union type'),
  /**
   * The coarse kind(s) of the input's MEMBERS — array elements, or the values
   * of an object used as a map (objectui#8067). Same shape and same two bounds
   * as `type` one level up, for the same reason: an empty array declares a
   * member contract nothing can satisfy, and a repeated arm means the author
   * believes they said something they did not. Optional — an input that
   * declares no member kind is judged exactly as it was before this key
   * existed. See `ComponentInput.of` in `../base.ts` for the ruling boundary it
   * stays inside (it is a KIND, never a value domain) and for its readers.
   */
  of: z.union([
    ComponentInputControlTypeSchema,
    z.array(ComponentInputControlTypeSchema)
      .min(1)
      .refine((arms) => new Set(arms).size === arms.length, {
        message: 'Input member kind arms must be distinct',
      }),
  ]).optional().describe('Coarse kind of the input\'s members, or the arms of a union'),
  /**
   * ADR-0049 RETIREMENT TOMBSTONES (objectui#7493 item ① / objectui#7781,
   * maintainer ruling A of 2026-09-06) — `label` / `defaultValue` /
   * `advanced`, the three keys the manifest serializer does not forward and
   * no consumer of `ComponentMeta.inputs` reads; the sixth, seventh and
   * eighth tombstones of the shape the block below this one describes, and
   * everything it says about the mechanism applies to them too. The route was
   * MEASURED on the built face before it was chosen: this schema is a
   * non-strict `z.object`, so an undeclared key parses green and is silently
   * stripped — a deletion would have swallowed 1,162 authored values in
   * silence, which is why each key stays declared and refuses BY NAME. See
   * `ComponentInput.label` in `../base.ts` for the census and the ruling.
   */
  label: retirementTombstone(
    'RETIRED (objectui#7493) — `ComponentInput.label` was never read, and never published: the manifest '
    + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
    + 'so an authored value was silently dropped. Delete the key; an input is identified by its `name` on '
    + 'every path that reaches it, and nothing ever rendered a label for it.',
  ),
  defaultValue: retirementTombstone(
    'RETIRED (objectui#7493) — `ComponentInput.defaultValue` was never read, and never published: the manifest '
    + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
    + 'so an authored value was silently dropped. Delete the key; the renderer\'s own fallback read is the '
    + 'default, and `description`, which IS published, is where to state it.',
  ),
  required: z.boolean().optional().describe('Required flag'),
  enum: z.union([
    z.array(z.string()),
    z.array(z.object({
      label: z.string(),
      value: z.any(),
    })),
  ]).optional().describe('Enum options'),
  description: z.string().optional().describe('Help text'),
  advanced: retirementTombstone(
    'RETIRED (objectui#7493) — `ComponentInput.advanced` was never read, and never published: the manifest '
    + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
    + 'so an authored value was silently dropped. Delete the key; no designer surface ever hid an "advanced" '
    + 'input, so there is nothing to write instead.',
  ),
  /**
   * ADR-0049 RETIREMENT TOMBSTONE (objectui#5905) — the FIFTH key, retired
   * later than the four below and by its own ruling (maintainer, 2026-08-31).
   * It was declared-and-DROPPED rather than declared-and-unread:
   * `plugin-markdown`'s registration really did author it while the serializer
   * dropped it, so retiring it meant ruling on that registration first. The
   * ruling deleted the write as a measured no-op and REFUSED teaching
   * `sdui-parser` to forward the key. See `ComponentInput.inputType` in
   * `../base.ts` for the full record.
   */
  inputType: retirementTombstone(
    'RETIRED (objectui#5905) — `ComponentInput.inputType` was never read, and never published: the manifest '
    + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
    + 'so an authored value was silently dropped. Delete the key; put the control hint in `description`, '
    + 'which IS published.',
  ),
  /**
   * ADR-0049 RETIREMENT TOMBSTONES (objectui#5905) — `min` / `max` / `step` /
   * `placeholder`, the four `ComponentInput` keys measured with no reader on
   * either the consumption or the publication path. `inputType` directly above
   * is a fifth tombstone of the same shape, added by a later ruling; everything
   * this block says about the mechanism applies to it too.
   *
   * `retirementTombstone()` (`./tombstone.zod.ts`) writes each guidance string
   * ONCE into both author-facing channels — the parse-time issue message and
   * `.describe()`, which feeds generated JSON-Schema and docs — so the two
   * cannot drift. Without a tombstone the non-strict mirror would SILENTLY
   * STRIP an authored value, trading one silent no-op for another; with it, a
   * write from outside this repository (the half objectui#5905 could not
   * measure) arrives as a NAMED REFUSAL carrying its own remedy.
   *
   * The accept set is the point, not a side effect: issue `code` stays
   * `invalid_type` and the issue `path` names the key. A `refine`-based
   * spelling would report `custom` and was rejected for exactly that reason
   * (objectui#6105).
   */
  min: retirementTombstone(
    'RETIRED (objectui#5905) — `ComponentInput.min` was never read, and never published: the manifest '
    + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
    + 'so an authored value was silently dropped. Delete the key; spell the numeric domain out in `description`, '
    + 'which IS published.',
  ),
  max: retirementTombstone(
    'RETIRED (objectui#5905) — `ComponentInput.max` was never read, and never published: the manifest '
    + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
    + 'so an authored value was silently dropped. Delete the key; spell the numeric domain out in `description`, '
    + 'which IS published.',
  ),
  step: retirementTombstone(
    'RETIRED (objectui#5905) — `ComponentInput.step` was never read, and never published: the manifest '
    + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
    + 'so an authored value was silently dropped. Delete the key; spell the numeric domain out in `description`, '
    + 'which IS published.',
  ),
  placeholder: retirementTombstone(
    'RETIRED (objectui#5905) — `ComponentInput.placeholder` was never read, and never published: the manifest '
    + 'serializer forwards `name`/`type`/`of`/`required`/`enum`/`binding`/`description` and this is not one of them, '
    + 'so an authored value was silently dropped. Delete the key; put the hint in `description`, which IS '
    + 'published. `BaseSchema.placeholder`, the node-level prop, is a DIFFERENT key and is unaffected.',
  ),
});

/**
 * Component Metadata
 */
export const ComponentMetaSchema = z.object({
  label: z.string().optional().describe('Display name'),
  icon: z.string().optional().describe('Icon name or SVG'),
  category: z.string().optional().describe('Component category'),
  inputs: z.array(ComponentInputSchema).optional().describe('Configurable properties'),
  defaultProps: z.record(z.string(), z.any()).optional().describe('Default property values'),
  examples: z.record(z.string(), z.any()).optional().describe('Example configurations'),
  isContainer: z.boolean().optional().describe('Layout container (skipped by the react-page JSX scope, listed in the public layout ledger); not "can have children" — a renderer that puts `children` on the page declares a `children` slot input (objectui#9910)'),
  resizable: z.boolean().optional().describe('Can be resized'),
  resizeConstraints: z.object({
    width: z.boolean().optional(),
    height: z.boolean().optional(),
    minWidth: z.number().optional(),
    maxWidth: z.number().optional(),
    minHeight: z.number().optional(),
    maxHeight: z.number().optional(),
  }).optional().describe('Resize constraints'),
  tags: z.array(z.string()).optional().describe('Search tags'),
  description: z.string().optional().describe('Component description'),
});

/**
 * Component Configuration
 */
export const ComponentConfigSchema = ComponentMetaSchema.extend({
  type: z.string().describe('Component type identifier'),
  component: z.any().describe('Component renderer'),
});

/**
 * HTML Attributes (generic)
 */
export const HTMLAttributesSchema = z.record(z.string(), z.any()).describe('HTML attributes');

/**
 * Event handlers — NOTE, not a declaration. There is deliberately no
 * event-handlers const here (objectui#6910).
 *
 * `EventHandlersSchema`, a `z.record(z.string(), z.function())`, stood at this
 * spot until objectui#6910 retired it under ADR-0049 enforce-or-remove
 * (maintainer ruling on objectui#6124, decision batch #8, reconfirmed in batch
 * #25). It was a published export of `@object-ui/types/zod` that **no JSON
 * document could ever satisfy** — every value it accepted had to be a function
 * — and that nothing in this package composed. It could therefore neither
 * admit a correct authoring nor refuse a wrong one: an author reading the
 * published surface got no signal in either direction, which is exactly the
 * shape ADR-0049 exists to remove.
 *
 * Why no JSON-authorable replacement can be written here, i.e. why this is a
 * NOTE and not a narrower schema: on the JSON face handlers are not values at
 * all. The per-node `on*` handler keys that do exist are declared through
 * `handlerKeyRefusal()` in `./tombstone.zod.ts`, which refuses EVERY value —
 * an authored object and a live function alike — and carries the remedy in
 * its own message: author behaviour as a NODE TYPE, an `action:` node with a
 * declared action, the spelling PR #6498 established. A record of function
 * values is that same unauthorable shape with the key set left open as well,
 * so narrowing it could only make the refusal harder to read. The
 * function-valued face is a TypeScript prop shape, declared as `EventHandlers`
 * in `../base.ts`; a zod mirror of it would mirror something that never
 * crosses the wire.
 *
 * ⚠️ `BaseSchema` declares NO `events` key, and this note asserted that it did
 * until the claim was checked against the tree. AGENTS.md's abridged protocol
 * sketch shows `events?: Record<string, ActionSchema[]>` and its action-system
 * commandment authors one, but `BaseSchemaCore` declares no such member and
 * nothing reads `schema.events`: whatever a document writes under that key,
 * no renderer runs it. `BaseSchemaCore` is `.passthrough()`, so such a node is
 * KEPT, judged by nothing and run by nothing. ⛔ Do not send an author there.
 * ⛔ No count of authored `events` keys is stated here — a separate card carried
 * that census. A census answer frozen into a comment is the defect AGENTS.md
 * commandment #9 forbids, and this note shipped one once already: the first
 * version of this paragraph named a total that was wrong on the day it was
 * written, and it reached the emitted `.d.ts` before review caught it.
 *
 * ⚠️ Do not conclude from a clean sweep that no second one of these exists.
 * Both standing instruments are structurally blind to this shape: the
 * `z.function()` census matches the `key: z.function(` spelling and a record's
 * VALUE type is not a key, and `../__tests__/zod-mirror-parity.test.ts`
 * exempts index signatures by design ("no keys to compare"). This note, not a
 * gate, is what records the absence.
 *
 * Precedent of the same shape: objectstack `89448a52b`.
 */

/**
 * The two CSS passthrough attributes a node exposes: a Tailwind class string and
 * an inline style record.
 *
 * ⚠️ NOT a mirror of `StyleProps` in `../base.ts` (objectui#5928). That
 * declaration is the Tailwind-SCALE vocabulary (`padding`, `margin`, `gap`,
 * `backgroundColor`, …) and shares ZERO keys with this object — the two only ever
 * shared a name, and pairing them by that name reported drift on a mirror
 * relationship that does not exist. The old name is gone: with this const named
 * for its own keys there is no like-named declaration left to pair it with, and
 * the reason it mirrors nothing is recorded against this name in
 * `../__tests__/zod-mirror-parity.test.ts`'s `EXCLUSIONS`.
 *
 * The `.describe()` text below names those same two keys, for the half of #5928
 * the rename could not reach (objectui#7578): `.describe()` is runtime metadata
 * that feeds generated JSON-Schema and docs, where the const name is never in
 * view, so the label is the only thing telling that reader what is in here. The
 * generic wording it carried until #7578 was the one the const was renamed away
 * from, and it left a reader hunting `padding` or `gap` under this schema in
 * exactly the confusion #5928 was filed about, one layer down.
 */
export const ClassNameStylePropsSchema = z.object({
  className: z.string().optional(),
  style: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
}).describe('className and inline style');
