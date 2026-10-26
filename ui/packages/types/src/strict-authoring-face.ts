/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The STRICT AUTHORING FACE — a derived, unknown-key-closing twin of the node
 * face (objectui#8345, under the objectui#5250 ruling: maintainer 2026-09-04,
 * decision batch #25, option 2 — "each node schema gets a derived strict
 * variant; `objectui validate` and the doc-snippet gates run strict; renderer
 * props keep the tolerant face unchanged").
 *
 * ## What this is, and what it deliberately is NOT
 *
 * It is a SECOND face over the SAME declarations. `BaseSchemaCore` stays
 * `.passthrough()` and every published mirror keeps the accept set it has: this
 * module adds a face, it does not change the existing one. `objectui validate`
 * and `objectui check` consume it: both judge an authored document through
 * `StrictAnyComponentSchema`, by way of `@object-ui/cli`'s
 * `validateAuthoredDocument` (objectui#5250, slice A). The JSON-fence gate is
 * the ruling's next slice.
 *
 * It is DERIVED, never hand-written. A second hand-maintained copy of the 107
 * component schemas would be a parity ledger nobody can keep honest — this
 * repository already carries the bill for that shape (objectui#6058, #6152,
 * #7759). Everything below walks the mirrors that already exist.
 *
 * It is a RUNTIME face only. `deriveStrictAuthoringSchema` returns the same
 * TypeScript type it was given, because strictness here is a property of the
 * parse and not of the declaration — a document that type-checks against
 * `SchemaNode` still type-checks. The TypeScript authoring face is a separate
 * card with a separate ruling (objectui#7927).
 *
 * ## Why objects are CLONED and not rebuilt
 *
 * Every object is cloned by patching a copy of its own `_zod.def` and calling
 * its own constructor. ⛔ Never rebuild one with `z.object(shape)`: that
 * spelling keeps the shape and DROPS `def.checks`, so every `.refine()` and
 * `.superRefine()` on the way down is silently lost and the twin UNDER-reports
 * red — a strict face that quietly stopped enforcing a refinement is worse than
 * no strict face, because it reads as evidence. The pin file holds a control
 * that shows the rebuild spelling losing a real check.
 *
 * ## What strict cannot close, stated as the complete list
 *
 * Opaque validators — `custom`, `function` and `transform` — have no shape
 * inside them to close, so the walker returns them untouched and REPORTS them
 * through `onOpaqueShape`. That is the whole limit list, not a sample of it,
 * and the pin file re-derives it rather than quoting this sentence.
 *
 * The reporter's contract is wider than that list, and the difference is the
 * follow-up the director owed this card: EVERY shape the walker meets and does
 * not close is reported. The first round's `default:` arm treated whatever it
 * had no arm for as a leaf, so `set`, `map`, `prefault` and `promise` — each a
 * wrapper carrying a schema — were handed back in silence with the object
 * inside them still open and nothing reported. Those four are walked now. What
 * still falls through is reported under its own def type rather than swallowed;
 * on zod 4.4.3 the only schema-bearing kind that does is `success`, which
 * parses its inner schema into a boolean and can never refuse, so reporting it
 * is the truth and walking it would move an output value while closing nothing.
 *
 * One further limit is worth naming because it is invisible in the shape: a
 * check installed with `.superRefine()` is a CLOSURE, and a closure that
 * consults another schema keeps consulting the TOLERANT one. The live instance
 * is the `chatbot` body clause in `defineNodeComponentUnion` — it is preserved
 * by the clone and still fires, but the schema it defers to inside is the
 * tolerant `BaseSchemaCore.shape.body`. That direction is conservative: such a
 * check can only ADD refusals, never accept something the strict shape refused.
 *
 * ONE closure is re-pointed rather than left tolerant, because what it consults
 * IS the node union: the nested-component judgment on `AnyComponentSchema`
 * (objectui#11223, `./zod/nested-component-walk.ts`), which judges a component
 * nested in a props bag. Copied as it is, it would judge those components
 * against the tolerant union, and the strict face would pass an unknown key one
 * bag down that it refuses one child slot down. The walker below swaps it for
 * the same judgment bound to THIS face's twin of the union
 * (`rebindNestedJudgments`), so a nested component is judged strictly here and
 * tolerantly there, like every other node.
 *
 * ## "Declared" means the shape declares it — for every node
 *
 * objectui#11022 once made one exception: the widget-slot `metric-card` node
 * spelled its props with its catchall, so this face admitted the input names
 * its registration declared from a side table, each judged by the catchall.
 * objectui#11467 declared those inputs as members of the node, so the side
 * table and its arm below are gone: a key is declared when the shape declares
 * it, and any other key is refused by name.
 *
 * ## The recursion point, and why this card waited for it
 *
 * A child slot is `z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)])`, and
 * since objectui#8344 `SchemaNodeSchema`'s component arm IS the component union
 * rather than the ~21 base keys. Strict-ifying the OLD recursion point measured
 * the recursion point instead of the components — every child node's own
 * declared props read as unrecognised. That is the order-of-magnitude error
 * objectui#7935 exists to prevent, and it is why the derivation below can now
 * run over the whole tree with no boundary at all.
 */

import { z } from 'zod';
import { SchemaNodeSchema } from './zod/base.zod.js';
// ⚠️ A DELIBERATE MODULE CYCLE, and the reason it is safe is structural rather
// than lucky. `zod/index.zod.ts` re-exports the three values below, so it
// depends on this module and this module depends on it. ESM links cycles fine;
// what throws is READING a binding whose defining module has not run its body
// yet. `AnyComponentSchema` is therefore read ONLY inside the `z.lazy` getters
// at the bottom — never at this module's top level — so by the time anything
// can read it, `index.zod.ts` has finished evaluating and the objectui#8344
// recursion-point fill is installed. The pin file asserts that end state from
// the published barrel rather than trusting this paragraph.
import { AnyComponentSchema } from './zod/index.zod.js';
import {
  carryRegistryMeta,
  closeStrictUnionArms,
  cloneWithDef,
  internals,
  isZodType,
  type WalkableDef,
} from './zod/node-derivation.js';
import { isNestedComponentJudgment, rebindNestedComponentJudgment } from './zod/nested-component-walk.js';

/**
 * One shape the strict walker could not close, reported as it is met.
 *
 * `kind` is the zod def type of the opaque node; `path` is the trail from the
 * root of the walk, so a consumer can say WHERE rather than only how many.
 */
export interface StrictAuthoringLimit {
  /**
   * The zod def type that has no shape to close — `custom`, `function` or
   * `transform` — or, for a schema-bearing wrapper the walker has no arm for,
   * that wrapper's own def type (reported rather than swallowed; see the
   * `default:` arm).
   */
  kind: string;
  /** Trail from the walk root, e.g. `#/options/8/shape/props`. */
  path: string;
}

/** Options for {@link deriveStrictAuthoringSchema}. */
export interface DeriveStrictAuthoringOptions {
  /**
   * Called once per opaque node the walker meets, in walk order. Present so the
   * limit list is a MEASUREMENT a caller can re-derive, not a claim in a
   * docblock. Deduplication is the caller's business: the walker memoises by
   * schema identity, so each distinct node is reported once per walk.
   */
  onOpaqueShape?: (limit: StrictAuthoringLimit) => void;
}

/**
 * ⭐ THE DEF READER, THE GUARD AND THE CLONE RULE LIVE IN
 * `./zod/node-derivation.ts`, NOT HERE (objectui#9102).
 *
 * They were three near-identical local copies of what the import boundary
 * already had, and the copy is how they drifted: objectui#9086 taught the
 * boundary's `cloneWithDef` to carry a node's registry metadata, this file's
 * copy was deliberately not widened at the time, and objectui#9102 measured
 * what that cost — `deriveStrictAuthoringSchema` rebuilds every container it
 * walks, so every description this repository's own mirrors declare was
 * dropped from the derived twin, and any `title` or `externalVocabulary` on an
 * imported subtree with it.
 *
 * ⛔ A local re-spelling is the defect, not the fix. The metadata carry is
 * invisible at the call site — a derived node with no description parses
 * identically to one with — so a second copy loses it again with no symptom.
 * `__tests__/registry-meta-carry-9102.test.ts` measures both faces through the
 * one helper.
 *
 * ⚠️ What is NOT shared: the arms. This walker closes objects with
 * `catchall: z.never()` and reports opaque shapes; the boundary strips defaults
 * and holds an identity property this face deliberately does not have (it
 * rebuilds unconditionally, because "strict" is a property every node must
 * acquire). Only the three primitives above are common, and only they moved.
 */

/**
 * The def members through which a node can hold another schema — the union of
 * what the arms above read. A def carrying none of them is a leaf; one carrying
 * any of them and reaching the `default:` arm is an unclosed shape to report.
 * `getter` is absent on purpose: `lazy` is resolved before the switch.
 */
const SCHEMA_BEARING_MEMBERS = [
  'shape', 'options', 'items', 'element', 'rest',
  'valueType', 'keyType', 'left', 'right', 'in', 'out', 'innerType',
] as const satisfies readonly (keyof WalkableDef)[];

const carriesSchema = (def: WalkableDef): boolean =>
  SCHEMA_BEARING_MEMBERS.some((member) => def[member] != null);

/**
 * objectui#11223: the derived node, with every nested-component judgment among
 * the source's checks re-pointed at `deriveJudge` of its judge — this face's
 * own twin of the node union (see the module docblock). Every other check is
 * kept as it is, in its place; a node carrying none is returned untouched.
 *
 * `checks` is not a `WalkableDef` member because no arm of the walk reads it;
 * this is the one place that patches it, through the shared clone rule.
 */
const rebindNestedJudgments = (
  def: WalkableDef,
  out: z.ZodType,
  deriveJudge: (judge: z.ZodType) => z.ZodType,
): z.ZodType => {
  const checks = (def as { checks?: readonly unknown[] }).checks;
  if (!checks?.some(isNestedComponentJudgment)) return out;
  const patch = { checks: checks.map((check) => rebindNestedComponentJudgment(check, deriveJudge) ?? check) };
  return cloneWithDef(out, patch as unknown as Partial<WalkableDef>);
};

/**
 * A walker with ONE memo. Two schemas derived through the same walker share
 * their derived subgraph, so the second costs nothing and the two twins agree
 * by construction instead of by assertion.
 */
function createStrictWalker(options: DeriveStrictAuthoringOptions = {}): <T extends z.ZodType>(schema: T, path?: string) => T {
  const memo = new Map<z.ZodType, z.ZodType>();

  const walk = (schema: z.ZodType, path: string): z.ZodType => {
    if (!isZodType(schema)) return schema;
    const cached = memo.get(schema);
    if (cached) return cached;
    const def = internals(schema)._zod.def;

    // `lazy` first, and memoised BEFORE the getter can re-enter: the node face
    // is self-referential through every child slot, so a walker that recursed
    // into the getter eagerly would not terminate.
    //
    // ⚠️ A FRESH `z.lazy` and not `cloneWithDef`, unlike the import boundary:
    // this arm has to re-enter the getter it is replacing, and the boundary's
    // clone spelling would keep the ORIGINAL getter alongside the patched one.
    // It goes through `carryRegistryMeta` for the same reason every other arm
    // does — a fresh node carries none of this one's registry state. The
    // population of described `z.lazy` nodes on this face is empty today, so
    // this is guarded by a hand-built control in the pin file rather than by a
    // census that would assert nothing (objectui#9102).
    if (def.type === 'lazy') {
      const out: z.ZodType = carryRegistryMeta(
        schema,
        z.lazy(() => walk(def.getter!(), `${path}/lazy`)),
      );
      memo.set(schema, out);
      return out;
    }

    let out: z.ZodType;
    switch (def.type) {
      case 'object': {
        const shape: Record<string, z.ZodType> = {};
        for (const [key, value] of Object.entries(def.shape ?? {})) {
          shape[key] = walk(value, `${path}/shape/${key}`);
        }
        // `catchall: z.never()` IS `.strict()` — spelled through the def so the
        // clone keeps this object's own checks. `.strict()` would too, but only
        // on a `ZodObject`; this arm also has to serve loose objects, which is
        // every `BaseSchema` heir.
        out = cloneWithDef(schema, { shape, catchall: z.never() });
        break;
      }
      // A discriminated union carries `type: 'union'` too, plus a
      // `discriminator` the spread preserves — so both union kinds land here
      // and neither is flattened into the other.
      case 'union': {
        const options = (def.options ?? []).map((option, i) => walk(option, `${path}/options/${i}`));
        // objectui#11073: every object this face closes is a strict object, so on a PLAIN
        // union its unknown-key refusal is made terminal, as on the node face, and the union
        // answers with every arm rather than with the one arm that failed only on unknown
        // keys. A discriminated union routes to one arm and is left as it is.
        out = cloneWithDef(schema, {
          options: (def as { discriminator?: unknown }).discriminator === undefined ? closeStrictUnionArms(options) : options,
        });
        break;
      }
      case 'array':
        out = cloneWithDef(schema, { element: walk(def.element!, `${path}/element`) });
        break;
      case 'tuple':
        out = cloneWithDef(schema, {
          items: (def.items ?? []).map((item, i) => walk(item, `${path}/items/${i}`)),
          ...(def.rest ? { rest: walk(def.rest, `${path}/rest`) } : {}),
        });
        break;
      case 'record':
        out = cloneWithDef(schema, { valueType: walk(def.valueType!, `${path}/valueType`) });
        break;
      // A `set` keeps its element under `valueType`, exactly like `record`; a
      // `map` keeps BOTH a key schema and a value schema, and a key can be an
      // object as easily as a value can. These two, with `prefault` and
      // `promise` below, are the wrappers the first round's `default:` arm
      // swallowed — inner object open, nothing reported.
      case 'set':
        out = cloneWithDef(schema, { valueType: walk(def.valueType!, `${path}/valueType`) });
        break;
      case 'map':
        out = cloneWithDef(schema, {
          keyType: walk(def.keyType!, `${path}/keyType`),
          valueType: walk(def.valueType!, `${path}/valueType`),
        });
        break;
      case 'intersection':
        out = cloneWithDef(schema, {
          left: walk(def.left!, `${path}/left`),
          right: walk(def.right!, `${path}/right`),
        });
        break;
      case 'pipe':
        // BOTH sides, and the `out` side is the one worth naming. A pipe
        // spelled `X.transform(f)` holds the schema in `in` and the opaque
        // transform in `out`; a pipe spelled `z.preprocess(f, X)` holds them
        // the other way round. Walking only `in` closes the first and silently
        // leaves the second's real schema tolerant — an asymmetry with no
        // symptom, because the accept set it produces looks exactly like a
        // schema that had nothing to close.
        //
        // Re-derived on the published face at the head this landed on, once the
        // guard above stopped skipping callable nodes: FOUR pipes are reachable
        // — `transform` into `enum` (a preprocessor, under
        // `page.interfaceConfig.filterBy[]`), and `object`, `string` and
        // `array` each into a `transform`. So a preprocessor is already here,
        // and today no OBJECT sits on an `out` side, which is why this arm
        // moves no accept set yet. It is here so the first preprocessor that
        // wraps an object does not open a hole. ⚠️ The earlier version of this
        // comment said "one pipe reachable" — that was a reading taken through
        // the blind guard, and it is exactly the class of number this file's
        // pins now re-derive instead of quoting.
        out = cloneWithDef(schema, {
          in: walk(def.in!, `${path}/in`),
          ...(def.out ? { out: walk(def.out, `${path}/out`) } : {}),
        });
        break;
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'nonoptional':
      case 'readonly':
      case 'catch':
      case 'promise':
        out = cloneWithDef(schema, { innerType: walk(def.innerType!, `${path}/innerType`) });
        break;
      case 'custom':
      case 'transform':
      case 'function':
        // No shape inside to close. Reported, ⛔ never silently skipped.
        options.onOpaqueShape?.({ kind: def.type, path });
        out = schema;
        break;
      default:
        // Leaves — string, number, boolean, literal, enum, any, unknown, never,
        // date, … — have nothing to close and nothing to walk into. ⚠️ But a
        // wrapper this switch has NO ARM FOR is not a leaf: it carries a schema
        // the walk never reached, i.e. an unclosed shape, and the reporter's
        // contract is that every unclosed shape the walker meets is reported.
        // So it is reported under its own def type rather than handed back in
        // silence, which is how `set` / `map` / `prefault` / `promise` slipped
        // through the first round with their inner objects open. The pin file
        // holds `success` — the one schema-bearing kind zod 4.4.3 still routes
        // here — as the live instance, and a row of leaves as the control.
        if (carriesSchema(def)) options.onOpaqueShape?.({ kind: def.type, path });
        out = schema;
    }
    // Read through the memo at parse time, so the judge resolves to the twin
    // this walk has finished building — the union the check sits on included.
    out = rebindNestedJudgments(def, out, (judge) => walk(judge, `${path}/nestedJudge`));
    memo.set(schema, out);
    return out;
  };

  return <T extends z.ZodType>(schema: T, path = '#'): T => walk(schema, path) as T;
}

/**
 * Derive the strict authoring twin of any schema on the published zod face.
 *
 * Every reachable object gains `catchall: z.never()`, reached through unions,
 * discriminated unions, arrays, tuples, records, sets, maps, intersections,
 * optionals, nullables, defaults, prefaults, promises, pipes and `z.lazy`
 * (memoised, so the self-referential node face terminates). A schema-bearing
 * wrapper with no arm here is reported through `onOpaqueShape`, never skipped. The returned schema has the same TypeScript type as
 * the input and shares no mutable state with it — the input is left exactly as
 * it was, which is what keeps the rendering face untouched.
 *
 * Each call builds its own memo, so deriving two schemas separately builds two
 * graphs. The two faces below are derived through one shared walker for that
 * reason.
 */
export function deriveStrictAuthoringSchema<T extends z.ZodType>(
  schema: T,
  options?: DeriveStrictAuthoringOptions,
): T {
  return createStrictWalker(options)(schema);
}

/**
 * The one walker behind both published faces, so the document face and the node
 * face share a single derived graph.
 */
const faceWalker = createStrictWalker();

/**
 * The strict authoring twin of `AnyComponentSchema` — a DOCUMENT root.
 *
 * Same accept set as `AnyComponentSchema` minus every undeclared key, at every
 * depth. Undeclared keys are reported as `unrecognized_keys` issues naming the
 * offending keys.
 *
 * Typed by its input and output rather than by its runtime class: the walk is
 * deferred behind `z.lazy` (see the import comment above for why it must be),
 * so this is a `ZodLazy` whose inner is the derived discriminated union.
 */
export const StrictAnyComponentSchema: z.ZodType<
  z.output<typeof AnyComponentSchema>,
  z.input<typeof AnyComponentSchema>
> = z.lazy(() => faceWalker(AnyComponentSchema));

/**
 * The strict authoring twin of `SchemaNodeSchema` — a CHILD SLOT: a component
 * document, or one of the primitives a slot admits.
 *
 * Prefer {@link StrictAnyComponentSchema} for a whole document: this face
 * accepts a bare string or number, because a child slot does.
 */
export const StrictSchemaNodeSchema: z.ZodType<
  z.output<typeof SchemaNodeSchema>,
  z.input<typeof SchemaNodeSchema>
> = z.lazy(() => faceWalker(SchemaNodeSchema));
