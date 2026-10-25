/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE IMPORT BOUNDARY — **this mirror authors no default, imported subschemas
 * included** (objectui#8317, director ruling, decision batch #90, 2026-09-08,
 * under the maintainer's standing delegation).
 *
 * Decision batch #69 (objectui#7735) ruled a principle, not two rows: *a
 * validator validates; it does not write values into an author's document.*
 * PR #8299 delivered it for the 41 `.default()` call sites written in this
 * repository's own mirrors, and stopped there — the ruling's named scope could
 * not reach a default this repository never wrote. Measured after that landing,
 * **57 `ZodDefault` nodes were still reachable from the published
 * `@object-ui/types/zod` barrel**, every one inside a subschema imported by
 * reference from `@objectstack/spec`. So `safeValidateSchema` went on
 * substituting on those keys: an author who wrote `navigation: {}` got back
 * `navigation: { mode, preventNavigation, openNewTab, size }` — four keys they
 * did not write — and the "one authored document, two shapes" defect
 * objectui#7735 was opened about survived there.
 *
 * Batch #90 ruled option A: the principle holds for **every** key
 * `safeValidateSchema` answers, not only the 41 this repository authored, and
 * the imported defaults are stripped **here, at the boundary where the spec
 * enters this package**. ⛔ Option B — the 1546-site spec-side change on
 * another repository's release train — was NOT taken, and A is reversible into
 * it: every strip below becomes a no-op the day `@objectstack/spec` adopts the
 * same principle, with nothing to roll back. ⛔ Option C-unstated — 41 stripped,
 * 57 not, indistinguishable from the document — was refused as the one outcome
 * nobody defended.
 *
 * ## Why a WALK and not 57 hand-written `.removeDefault()` calls
 *
 * `.removeDefault()` is the established local pattern (`objectql.zod.ts`'s
 * `ViewKindEnum`, `views.zod.ts`'s `SpecListViewTypeEnum`) and it is what runs
 * below — but it only reaches a default sitting at the TOP of a member's
 * wrapper chain. Of the 57, four are at that depth; the rest are nested inside
 * imported subtrees (`page.interfaceConfig.*`, dashboard `chartConfig.*`,
 * `kanban.grouping.fields[].*`), where reaching one by hand means restating the
 * spec's own object locally. That is the "narrower than the contract it
 * implements" shape this directory already records twice, and it is how a
 * mirror silently stops being a mirror. Walking the graph instead keeps every
 * key, every type and every check exactly as the spec declares them, and
 * removes only the substitution.
 *
 * ## The accept set does not move, and that is load-bearing
 *
 * `.default(v)` carries optionality as well as a value: a member spelled
 * `.default(v)` with no `.optional()` is omissible BECAUSE of the default, and
 * a naive unwrap makes it REQUIRED — a silent accept-set narrowing on a
 * published surface, which this ruling did not authorise. So the `default` arm
 * below re-optionalises whatever `.removeDefault()` hands back, unless it is
 * already optional. `__tests__/imported-defaults-8317.test.ts` re-derives that
 * as a live differential over the repository's own document corpus rather than
 * trusting this paragraph.
 *
 * ## Why objects are CLONED and not rebuilt
 *
 * Every node is cloned by patching a copy of its own `_zod.def` and calling its
 * own constructor. ⛔ Never rebuild one with `z.object(shape)`: that spelling
 * keeps the shape and DROPS `def.checks`, so every `.refine()` and
 * `.superRefine()` the spec installed on the way down is silently lost and this
 * package would accept documents the spec refuses. Sibling precedent, and the
 * file this walker is modelled on: `../strict-authoring-face.ts`.
 *
 * ⛔ The input is never mutated. `@objectstack/spec`'s own exports are shared
 * with every other consumer in the workspace; this module derives and returns a
 * new graph, and leaves the spec's objects exactly as it found them.
 */

import { z } from 'zod';
import { carryRegistryMeta, cloneWithDef, internals, isZodType } from './node-derivation.js';

/**
 * ⭐ THE METADATA CARRY LIVES IN `./node-derivation.ts`, NOT HERE (objectui#9102).
 *
 * This module used to hold its own `cloneWithDef` and its own one-key carry,
 * spelled THE ONE DESCRIPTION RULE and defended in a sentence about `id`. Both
 * halves of that sentence were wrong about this surface, and objectui#9102
 * measured how: `id` does not occur in the spec's registry metadata here at all,
 * while `title` and `externalVocabulary` sit on nodes this walker rebuilds —
 * so the rule guarded a key that was never present and dropped the ones that
 * were. `@objectstack/spec` emits `{default, description, title, type}` for a
 * datasource `host`; this boundary emitted `{description, type}`.
 *
 * ⛔ The trade-off is NOT "description versus everything". It is a bounded,
 * enumerated carry set versus a blanket spread, and the bound is written down
 * as `CARRIED_REGISTRY_META_KEYS` with `id` refused by name in
 * `REFUSED_REGISTRY_META_KEYS` — `id` for the `_idmap` mutation it would cause,
 * which is the one part of the old sentence that was correct. The census that
 * fails when the protocol grows a key outside either list is
 * `../__tests__/registry-meta-carry-9102.test.ts`.
 *
 * ⛔ And it is SHARED, because the identical rebuild in
 * `../strict-authoring-face.ts` carried the identical loss. A local copy is how
 * the two drifted apart in the first place.
 */

/** Does this node already answer "omissible" to an enclosing object? */
const isAlreadyOptional = (schema: z.ZodType): boolean =>
  internals(schema)._zod.optin === 'optional';

/**
 * A walker with ONE memo, shared by every call. Two schemas stripped through it
 * share their derived subgraph, so `ListViewSchema` and the
 * `UserActionsConfigSchema` nested inside it agree by construction rather than
 * by assertion, and the second costs nothing.
 */
const memo = new Map<z.ZodType, z.ZodType>();

const walk = (schema: z.ZodType): z.ZodType => {
  if (!isZodType(schema)) return schema;
  const cached = memo.get(schema);
  if (cached) return cached;
  const def = internals(schema)._zod.def;

  // `lazy` first, and memoised BEFORE the getter can re-enter: spec subtrees are
  // self-referential (a filter clause contains filter clauses), so a walker that
  // forced the getter eagerly would not terminate.
  //
  // ⚠️ This is the ONE arm that cannot answer "was anything stripped below me?"
  // without forcing the getter, so it ALWAYS rebuilds — the identity property
  // below stops at a `z.lazy`. Measured on the imported population at the head
  // this landed on: THREE distinct `lazy` nodes are reachable
  // (`AppSchema.navigation[]` and `NavigationAreaSchema.navigation[]`, which are
  // the same recursive nav item; the recursive filter clause under
  // `DashboardWidgetSchema.filter` / `GlobalFilterSchema.optionsFrom.filter` /
  // `PageSchema.slots.header…dataSource.filter`; and `PageSchema.regions[].components[]`).
  // objectui#7928 added a FOURTH by importing the view container `ViewSchema`
  // for its `listViews` slot: the recursive form-field group under
  // `ViewSchema.formViews[…].groups[].fields[]`, walked because the whole
  // container crosses the boundary, not only the slot. objectui#11070 added a
  // FIFTH by importing the spec's `FieldSchema` for nine `FormFieldSchema`
  // members: the one under `FieldSchema.relatedListFilter`, walked for the
  // same reason. `@objectstack/spec` 17.7.0 added a SIXTH (objectui#11717): the
  // recursive form-field group under `ObjectFormPropsSchema.sections[].fields[]`,
  // reached from the `object-form` and `object-master-detail-form` rows, whose
  // `sections` take the page-block section shape since that release.
  // Each sits inside a schema that carries a default anyway, so the exception
  // costs no extra rebuild. objectui#10872 batch 2 had ONE named exception,
  // `ElementDataSourceSchema` (the `element:number` arm's `dataSource`), whose
  // `filter` reached the recursive filter clause with no default above it;
  // `@objectstack/spec` 17.5.0 converged that `filter` on the `ViewFilterRule`
  // array, which reaches no `z.lazy`, so it is clean and comes back as the
  // spec's own object (objectui#11073). The pin file re-derives the count and
  // the named set of clean rebuilt imports (`REBUILT_CLEAN`, empty today), and
  // goes red if either moves, rather than trusting this sentence.
  //
  // ⛔ Rebuilt through `cloneWithDef`, not `z.lazy(…)`: a fresh `z.lazy` would
  // be a different class with none of this node's own `def.checks` or registry
  // metadata, which is the same silent-loss shape the clone rule exists for.
  // ⚠️ `cloneWithDef` carries that metadata only because it asks
  // `carryRegistryMeta` to; registry state lives in `z.globalRegistry`, not in
  // `def`, so copying `def` never carried it. This sentence read as though it
  // did until objectui#9034 measured the description half and objectui#9102 the
  // rest of the vocabulary.
  if (def.type === 'lazy') {
    const out = cloneWithDef(schema, { getter: () => walk(def.getter!()) });
    memo.set(schema, out);
    return out;
  }

  /**
   * ⭐ THE IDENTITY PROPERTY, and it is the ruling's reversibility made literal.
   *
   * A node is rebuilt ONLY if the walk actually changed something beneath it.
   * A subtree with no `ZodDefault` in it therefore comes back REFERENCE-EQUAL
   * to the spec's own object — so this module is exactly the identity function
   * the day `@objectstack/spec` adopts the same principle, with nothing to roll
   * back, and today it leaves every already-clean imported schema binding by
   * reference exactly as it was before batch #90.
   *
   * ⚠️ `| null` on the sides, because the `tuple` arm below hands this helper
   * `def.rest` RAW — comparing like with like is the whole of objectui#9088's
   * repair, and zod spells a rest-less tuple's `rest` as `null`. ⛔ NOT a
   * relaxation of the comparison: it stays `===`, so `null` still matches only
   * `null` and `undefined` still matches only `undefined`. Widening the
   * parameter is what lets the arm keep passing the value zod actually minted
   * instead of normalising it back into the objectui#9088 defect to satisfy a
   * signature (objectui#9491).
   */
  const unchanged = (
    children: readonly (readonly [z.ZodType | null | undefined, z.ZodType | null | undefined])[],
  ): boolean => children.every(([before, after]) => before === after);

  let out: z.ZodType;
  switch (def.type) {
    /**
     * THE STRIP. `.removeDefault()` is the ruled spelling and the established
     * local pattern; it returns this node's inner type, which is then walked so
     * a default nested under a default is reached too.
     *
     * The re-optionalisation is the accept-set half. `ZodDefault(ZodOptional(T))`
     * — the `.optional().default(v)` spelling — unwraps to something already
     * omissible and is left alone; a bare `ZodDefault(T)` unwraps to a REQUIRED
     * member and is made optional again, because its omissibility was the
     * default's doing and removing it must not narrow what this package accepts.
     *
     * `carryRegistryMeta` is the documentation half, and it is the same one rule
     * `cloneWithDef` invokes on every other arm. The protocol spells its
     * guidance on the OUTER node — `.default(v).describe(d)`, and
     * `.default(v).meta({title})` on the datasource configs — which is the very
     * node `.removeDefault()` discards. Without the carry, every described
     * `ZodDefault` reachable from the spec arrives on this side with no
     * description, and every one carrying a `title` or an `externalVocabulary`
     * arrives without it: this boundary would convey strictly LESS than the
     * protocol it mirrors. `__tests__/imported-defaults-describe-9034.test.ts`
     * and `__tests__/registry-meta-carry-9102.test.ts` re-derive those
     * populations rather than trusting this paragraph.
     */
    case 'default': {
      const inner = walk((schema as unknown as { removeDefault: () => z.ZodType }).removeDefault());
      const next = isAlreadyOptional(inner) ? inner : z.optional(inner);
      out = carryRegistryMeta(schema, next);
      break;
    }
    case 'object': {
      const shape: Record<string, z.ZodType> = {};
      let same = true;
      for (const [key, value] of Object.entries(def.shape ?? {})) {
        shape[key] = walk(value);
        if (shape[key] !== value) same = false;
      }
      out = same ? schema : cloneWithDef(schema, { shape });
      break;
    }
    // A discriminated union carries `type: 'union'` too, plus a `discriminator`
    // the spread preserves — so both union kinds land here and neither is
    // flattened into the other.
    case 'union': {
      const options = (def.options ?? []).map(walk);
      out = unchanged((def.options ?? []).map((o, i) => [o, options[i]] as const))
        ? schema
        : cloneWithDef(schema, { options });
      break;
    }
    case 'array': {
      const element = walk(def.element!);
      out = element === def.element ? schema : cloneWithDef(schema, { element });
      break;
    }
    // ⭐ `: def.rest`, ⛔ NOT `: undefined` (objectui#9088).
    //
    // Zod 4 spells "no rest element" as an OWN `rest` key holding `null` — not
    // as an absent key — and that is the only `null` zod mints into any def
    // member this walker reads. Normalising the absent case to `undefined` put
    // a `null` on one side of `unchanged`'s `===` and an `undefined` on the
    // other, so the pair never matched and EVERY rest-less tuple took the
    // `cloneWithDef` branch whether or not anything beneath it had changed.
    // Three published spec exports were rebuilt for no reason
    // (`FieldOperatorsSchema`, `RangeOperatorSchema`, `ListMapConfigSchema`),
    // and the identity property above — batch #90's reversibility argument made
    // literal — was false wherever a rest-less tuple occurred.
    //
    // Copying `def.rest` compares like with like: `null` against `null`,
    // `undefined` against `undefined`, a schema against its walked self. ⛔ The
    // repair is NOT to relax `unchanged` to `==`; that would make
    // `null == undefined` true for every arm at once and erase a real zod-4
    // spelling distinction another arm may come to depend on.
    //
    // ⚠️ `WalkableDef.rest` is declared `z.ZodType | null` (objectui#9491) —
    // it admits the `null` zod actually mints, so the value below is typed as
    // what it is. Until that landed the declaration said `z.ZodType |
    // undefined`, and that is what made `: undefined` look correct here.
    //
    // ⭐ PROVING REMOVAL: put `: undefined` back and
    // `__tests__/imported-defaults-rest-less-tuple-9088.test.ts` reddens on
    // "a rest-less tuple ... comes back REFERENCE-EQUAL", as does
    // `__tests__/imported-defaults-describe-9034.test.ts` on the three exports.
    case 'tuple': {
      const items = (def.items ?? []).map(walk);
      const rest = def.rest ? walk(def.rest) : def.rest;
      out = unchanged([...(def.items ?? []).map((it, i) => [it, items[i]] as const), [def.rest, rest] as const])
        ? schema
        : cloneWithDef(schema, { items, ...(def.rest ? { rest: rest! } : {}) });
      break;
    }
    case 'record': {
      const valueType = walk(def.valueType!);
      out = valueType === def.valueType ? schema : cloneWithDef(schema, { valueType });
      break;
    }
    case 'intersection': {
      const left = walk(def.left!);
      const right = walk(def.right!);
      out = unchanged([[def.left, left], [def.right, right]]) ? schema : cloneWithDef(schema, { left, right });
      break;
    }
    // BOTH sides. A pipe spelled `X.transform(f)` holds the schema in `in`; one
    // spelled `z.preprocess(f, X)` holds it in `out`. Walking only `in` leaves
    // the second's real schema — and any default inside it — untouched, with no
    // symptom other than a residue this module claims to have removed.
    case 'pipe': {
      const inSide = walk(def.in!);
      const outSide = def.out ? walk(def.out) : undefined;
      out = unchanged([[def.in, inSide], [def.out, outSide]])
        ? schema
        : cloneWithDef(schema, { in: inSide, ...(def.out ? { out: outSide! } : {}) });
      break;
    }
    case 'optional':
    case 'nullable':
    case 'nonoptional':
    case 'readonly':
    case 'catch': {
      const innerType = walk(def.innerType!);
      out = innerType === def.innerType ? schema : cloneWithDef(schema, { innerType });
      break;
    }
    case 'custom':
    case 'transform':
    case 'function':
      // No shape inside, so no default inside either. Returned as-is.
      out = schema;
      break;
    default:
      // Leaves: string, number, boolean, literal, enum, any, unknown, never,
      // date, … — nothing to walk into.
      out = schema;
  }
  memo.set(schema, out);
  return out;
};

/**
 * Strip every `ZodDefault` reachable from an imported `@objectstack/spec`
 * schema, at this package's import boundary.
 *
 * Returns a schema with the same TypeScript type, the same keys, the same
 * checks, the same registry metadata and the same accept set — differing only
 * in that a key the author omitted stays omitted in `parse` output instead of
 * being written for them. The input is left untouched.
 *
 * ⚠️ "the same registry metadata" is carried deliberately and is not free — see
 * `carryRegistryMeta` in `./node-derivation.ts`. A description, a `title` and an
 * `externalVocabulary` are all registry state keyed by the node, so every
 * derivation here has to re-attach them explicitly (objectui#9034 for the
 * description, objectui#9102 for the rest). The carry set is bounded and
 * enumerated there; `id` is refused by name.
 *
 * ⚠️ A schema that HAD a default in it is not reference-equal to the spec's
 * afterwards: a mirror member re-exporting one of these re-exports this
 * package's derivation, not the spec object itself. That is exactly what batch
 * #90 ruled. A schema with nothing to strip comes back REFERENCE-EQUAL — see
 * the identity property in the walker — so applying this at a crossing that is
 * already clean changes nothing at all.
 *
 * ⚠️ Memoised across every call, so writing this at each crossing costs one
 * walk per spec schema, not one per call site. `stripImportedDefaults(X)` is
 * the SAME object every time, which is what lets the mirrors spell it inline
 * instead of parking it in a local `const` — and inline is required, not
 * stylistic: `check:spec-symbols` reads exactly one hop, so a mirror export
 * under a spec-owned name has to show the spec binding in its own initializer.
 *
 * ⚠️ The STATIC type is deliberately unchanged — strictly, `T` in and `T` out —
 * following `../strict-authoring-face.ts`, whose derivation makes the same
 * choice for the same reason: this is a property of the PARSE, not of the
 * declaration, and the TypeScript twins in `../*.ts` are hand-written and
 * already declare these keys omissible. The one consequence worth naming, since
 * it bites silently: on a member that HAD a default, `.removeDefault()` still
 * TYPECHECKS against the unchanged static type and THROWS at runtime, because
 * the node there is now a `ZodOptional`. Derive a value vocabulary off the
 * `Imported…` binding instead (`views.zod.ts`'s `SpecListViewTypeEnum`).
 *
 * @example
 * ```ts
 * import { ListViewSchema as ImportedSpecListViewSchema } from '@objectstack/spec/ui';
 * const SpecListViewSchema = stripImportedDefaults(ImportedSpecListViewSchema);
 * ```
 */
export function stripImportedDefaults<T extends z.ZodType>(schema: T): T {
  return walk(schema) as T;
}
