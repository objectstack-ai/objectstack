// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Emits the closed list of projectable refinements into the published JSON
 * Schema (#18670 item 2) — the generator half of
 * `src/shared/refinement-projection.ts`.
 *
 * ## What it does
 *
 * `z.toJSONSchema()` calls its `override` hook once per node with that node's
 * emitted object. {@link refinementProjectionOverride} reads the node's `custom`
 * checks, asks `projectableRefinementOf` what each one was DECLARED to mean, and
 * writes the keywords for the ones inside the closed list. A refinement nobody
 * declared gets nothing — it stays dropped, and `dropped-refinements.ts` keeps
 * naming it on the artifact as `x-dropped-refinements`.
 *
 * ## Why the detector runs the same override
 *
 * `dropped-refinements.ts` decides `dropped` vs `projected` by projecting a node
 * twice — once as it is, once with its `custom` checks removed — and comparing
 * bytes. That differential is only about the real published file if BOTH sides
 * go through the generator's own projection, so the detector passes this same
 * override. The consequence is the property the ledger is read for: a site whose
 * rule this module emits flips to `projected` and its ledger row has to go, in
 * the same PR, and a site it does not emit stays `dropped` no matter what the
 * PR says about it. ⛔ There is no third state a PR can put a site into.
 *
 * ## The direction, stated once
 *
 * Every arm's keywords accept exactly the JSON documents its runtime rule
 * accepts (`ProjectableRefinement`'s own docblock argues each equality). So the
 * published file NARROWS toward what the runtime already refuses and no document
 * the runtime accepts becomes refused. ⛔ An arm that could only approximate
 * its rule would be a behaviour change wearing a correction's clothes.
 */
import { z } from 'zod';
import {
  NON_BLANK_PATTERN,
  projectableRefinementOf,
  type ProjectableRefinement,
} from '../../src/shared/refinement-projection';

/**
 * The check kind `.refine()`, `.superRefine()` and a bare `.check(fn)` all
 * compile to in zod 4. Named once here because it is the ONE string this whole
 * instrument turns on: a zod release that renames it must fail as "no
 * refinements found anywhere" against the lit control in the census, never as a
 * quiet zero.
 */
export const CUSTOM_CHECK_KIND = 'custom';

/** A node's own `_zod.def`, or `null` for anything that is not a zod node. */
export function zodDefOf(schema: z.ZodType): Record<string, unknown> | null {
  const def = (schema as unknown as { _zod?: { def?: unknown } })._zod?.def;
  return def && typeof def === 'object' ? (def as Record<string, unknown>) : null;
}

/** One check's `check` tag, e.g. `custom`, `min_length`, `string_format`. */
export function checkKindOf(check: unknown): string | null {
  const kind = (check as { _zod?: { def?: { check?: unknown } } } | null)?._zod?.def?.check;
  return typeof kind === 'string' ? kind : null;
}

/** Every `custom` check this node carries, in declaration order. */
export function customChecksOf(schema: z.ZodType): unknown[] {
  const def = zodDefOf(schema);
  const checks = def?.checks;
  if (!Array.isArray(checks)) return [];
  return checks.filter((c) => checkKindOf(c) === CUSTOM_CHECK_KIND);
}

/** The predicate a `.refine()` check holds, or `undefined` for `.superRefine()` / `.check()`. */
function ruleOf(check: unknown): unknown {
  return (check as { _zod?: { def?: { fn?: unknown } } } | null)?._zod?.def?.fn;
}

/**
 * What the closed list says about this node, in declaration order — empty for
 * every node whose refinements are outside it, which is the common case.
 */
export function projectableRefinementsOf(schema: z.ZodType): ProjectableRefinement[] {
  const out: ProjectableRefinement[] = [];
  for (const check of customChecksOf(schema)) {
    const declared = projectableRefinementOf(ruleOf(check));
    if (declared) out.push(declared);
  }
  return out;
}

type JsonObject = Record<string, unknown>;

/**
 * `anyOf` of one `required` per key, conjoined onto the node through `allOf`.
 *
 * ⭐ The nesting is MEASURED, not stylistic. Written as a TOP-LEVEL `anyOf`
 * beside the node's own `type: 'object'` and `properties`, the pattern is valid
 * JSON Schema and reads correctly to a validator — and it breaks the one real
 * reader this repository has. `scripts/lib/format-type.ts` tests `anyOf` BEFORE
 * `properties`, so the node stopped rendering as its object shape and started
 * rendering as its `anyOf` branches, which carry no `type` at all: measured on
 * `content/docs/references/system/tracing.mdx`, the `condition` cell went from
 * `Record<string, any> | string | { dialect: …; source?: string; ast?: any }` to
 * `Record<string, any> | string | any | any`, and 26 reference pages moved the
 * same way. The reference tables are the authoritative input for AI authors
 * (ADR-0033), so a cell that loses a shape it used to state is a second lie
 * traded for the first one this change exists to remove.
 *
 * `allOf` is the conjunction JSON Schema provides for exactly this — a
 * constraint added BESIDE a node's own keywords rather than instead of them —
 * so a validator reads the same rule, the reference table keeps the shape it
 * always stated, and two arms can land on one node without either replacing
 * the other.
 */
function emitRequiredOneOf(jsonSchema: JsonObject, keys: readonly string[]): void {
  if (keys.length === 0) return;
  const anyOf = keys.map((key) => ({ required: [key] }));
  const allOf = Array.isArray(jsonSchema.allOf) ? (jsonSchema.allOf as unknown[]) : [];
  jsonSchema.allOf = [...allOf, { anyOf }];
}

/**
 * `minLength: 1` plus the non-blank pattern.
 *
 * `minLength` never LOWERS an existing one — a slot that also carries
 * `.min(8)` keeps its 8 — and an existing `pattern` is conjoined through
 * `allOf` rather than replaced, for the same reason `anyOf` is above.
 */
function emitNonBlankString(jsonSchema: JsonObject): void {
  const existing = typeof jsonSchema.minLength === 'number' ? jsonSchema.minLength : 0;
  jsonSchema.minLength = Math.max(existing, 1);
  if (!('pattern' in jsonSchema)) {
    jsonSchema.pattern = NON_BLANK_PATTERN;
    return;
  }
  if (jsonSchema.pattern === NON_BLANK_PATTERN) return;
  const allOf = Array.isArray(jsonSchema.allOf) ? (jsonSchema.allOf as unknown[]) : [];
  jsonSchema.allOf = [...allOf, { pattern: NON_BLANK_PATTERN }];
}

/**
 * JSON Schema's own `dependentRequired` — the keyword whose meaning IS this
 * arm's sentence, so nothing is encoded and nothing approximated.
 *
 * An entry with an empty requirement list is dropped rather than emitted: it
 * constrains nothing, and `{}` in the published file would read as a rule to
 * anyone diffing it. A node that somehow already carries the keyword is
 * conjoined through `allOf` rather than overwritten, for the reason
 * `emitRequiredOneOf` is: two arms on one node must both land.
 */
function emitDependentRequired(
  jsonSchema: JsonObject,
  dependencies: Readonly<Record<string, readonly string[]>>,
): void {
  const emitted: Record<string, string[]> = {};
  for (const [key, required] of Object.entries(dependencies)) {
    if (required.length > 0) emitted[key] = [...required];
  }
  if (Object.keys(emitted).length === 0) return;
  if (!('dependentRequired' in jsonSchema)) {
    jsonSchema.dependentRequired = emitted;
    return;
  }
  const allOf = Array.isArray(jsonSchema.allOf) ? (jsonSchema.allOf as unknown[]) : [];
  jsonSchema.allOf = [...allOf, { dependentRequired: emitted }];
}

/**
 * `propertyNames` with a `not` over the banned names — the keyword JSON Schema
 * has for a rule about NAMES, so nothing is encoded and nothing approximated.
 *
 * A node that already carries `propertyNames` is conjoined through `allOf`
 * rather than overwritten, for the reason `emitRequiredOneOf` is: a record
 * emits `propertyNames: { type: 'string' }` of its own, and replacing it would
 * trade the rule this arm adds for the key-type rule the node already stated.
 * An identical rule already present is left alone rather than duplicated, so
 * the arm is idempotent the way `emitNonBlankString` is.
 */
function emitBannedKeys(jsonSchema: JsonObject, keys: readonly string[]): void {
  if (keys.length === 0) return;
  const rule = { not: { enum: [...keys] } };
  if (!('propertyNames' in jsonSchema)) {
    jsonSchema.propertyNames = rule;
    return;
  }
  if (JSON.stringify(jsonSchema.propertyNames) === JSON.stringify(rule)) return;
  const allOf = Array.isArray(jsonSchema.allOf) ? (jsonSchema.allOf as unknown[]) : [];
  if (allOf.some((clause) => JSON.stringify(clause) === JSON.stringify({ propertyNames: rule }))) return;
  jsonSchema.allOf = [...allOf, { propertyNames: rule }];
}

/** Write one declared arm's keywords onto one emitted node. */
export function emitProjectableRefinement(jsonSchema: JsonObject, declared: ProjectableRefinement): void {
  switch (declared.pattern) {
    case 'required-one-of':
      emitRequiredOneOf(jsonSchema, declared.keys);
      return;
    case 'non-blank-string':
      emitNonBlankString(jsonSchema);
      return;
    case 'dependent-required':
      emitDependentRequired(jsonSchema, declared.dependencies);
      return;
    case 'banned-keys':
      emitBannedKeys(jsonSchema, declared.keys);
      return;
  }
}

/**
 * The `override` callback `z.toJSONSchema()` takes. Safe to pass for every
 * projection of every schema: a node with no declared refinement is left byte
 * for byte as zod emitted it.
 */
export function refinementProjectionOverride(ctx: {
  readonly zodSchema: unknown;
  readonly jsonSchema: unknown;
}): void {
  const jsonSchema = ctx.jsonSchema as JsonObject | null;
  if (!jsonSchema || typeof jsonSchema !== 'object') return;
  for (const declared of projectableRefinementsOf(ctx.zodSchema as z.ZodType)) {
    emitProjectableRefinement(jsonSchema, declared);
  }
}

/**
 * Run `first`, then `second`, on every node — for a projection that already
 * owns the single `override` slot (`union-branch-projection.ts` marks nodes with
 * it) and must also carry this one.
 */
export function composeOverrides<C>(first: (ctx: C) => void, second: (ctx: C) => void): (ctx: C) => void {
  return (ctx: C): void => {
    first(ctx);
    second(ctx);
  };
}

/**
 * The `target` every published projection uses. Named once because it is now
 * passed from one place; a second literal elsewhere would be a second answer to
 * a question that has one.
 */
export const PUBLISHED_JSON_SCHEMA_TARGET = 'draft-2020-12' as const;

/**
 * The context object `z.toJSONSchema` hands its `override`. `jsonSchema` is the
 * node's emitted object, which every override here writes keywords onto, so it
 * is typed as one rather than as `unknown`.
 */
export interface ProjectionOverrideContext {
  readonly zodSchema: unknown;
  readonly jsonSchema: JsonObject;
  readonly path: (string | number)[];
}

/**
 * ⭐ The ONE call through which `z.toJSONSchema` is reached anywhere
 * **`packages/spec` writes a published JSON Schema artifact**. Four producers,
 * named because the claim is only worth as much as its enumeration:
 *
 *   1. `build-schemas.ts` — the generator's three attempts, writing
 *      `json-schema/<category>/<Name>.json`;
 *   2. `lib/union-branch-projection.ts` — the union-branch projector behind the
 *      third of those attempts;
 *   3. `lib/dropped-refinements.ts` — the detector's differential, which is
 *      only about the real published file while it projects the way (1) does;
 *   4. `build-openapi.ts` — the OpenAPI generator, writing
 *      `json-schema/openapi.json`. That file ships in the tarball (`files[]`
 *      carries `json-schema`) and is exported as `./openapi.json`, so it is a
 *      published projection like any other; it reached this list late, and the
 *      shape of the gap is the point — see below.
 *
 * ## ⛔ What is NOT behind it — stated so the next reader need not re-derive it
 *
 * This helper governs the projection CALL for the four producers above. It is
 * ⛔ not a repo-wide guarantee, and three populations sit deliberately outside
 * it. Naming them is the difference between a claim and a slogan; each was
 * measured, not assumed:
 *
 *   - **The representability probe** in `union-branch-projection.ts`
 *     (`projectsUnderStrictMode`) calls `z.toJSONSchema(..., { unrepresentable:
 *     'throw' })` to ask zod a yes/no question and DISCARDS the result. Nothing
 *     it produces is published, so routing it here would answer a different
 *     question.
 *   - **Producers outside `packages/spec`'s own artifacts** — the CLI's
 *     `os generate` writes a JSON Schema of `ObjectStackDefinitionSchema` into
 *     an author's project, and `build-react-blocks-contract.ts` renders block
 *     prop tables into the published skills catalog. Both call
 *     `z.toJSONSchema` directly, and the first was measured DIVERGENT from this
 *     projection at seven declared sites. They are a separate decision about
 *     how wide the published-projection guarantee reaches, ⛔ not an oversight
 *     to be silently swept in here.
 *   - **Runtime derivations** (`packages/metadata-protocol`) project schemas to
 *     SERVE them, not to publish an artifact; they are governed by their own
 *     contracts.
 *
 * `published-projection-choke-point.test.ts` holds the first bullet's boundary
 * mechanically — it fails when a producer in this package grows a direct call —
 * so the enumeration above cannot rot into prose.
 *
 * ## Why a choke point and not a convention
 *
 * The generator and the detector have to project the SAME way or the ledger
 * stops describing the file. While each passed `override:` for itself, that
 * agreement was a convention two call sites kept, and the failure mode was
 * silent and one-sided: drop it on the GENERATOR side alone and every declared
 * site still reads `projected` — the detector is still passing it — so the
 * ledger stays green, the gate stays green, and the published file goes WIDE
 * again with no `x-dropped-refinements` to say so. Measured on the code before
 * this helper existed: with the generator's import stubbed out, `gen:schema`
 * exited 0 and printed the same 553 dropped / 201 schemas / 197 projected as an
 * untouched run, while `shared/Expression.json` lost its `allOf` and the
 * non-blank pattern went from 35 published files to 0. That is the pre-#18729
 * silence restored, standing behind a green ratchet — strictly worse than the
 * state the card was filed about, because the ledger now certifies it.
 *
 * A merge-conflict resolution was enough to cause it; nothing had to be
 * misunderstood. So the override is applied HERE, where the caller has no
 * argument to drop, and both halves lose it together or not at all — which is
 * what makes the ablation that removes it loud rather than silent.
 *
 * A caller that needs an override of its own (the union-branch projector marks
 * nodes with one) hands it in `override` and it runs FIRST, before the
 * refinement pass — the order those two passes were written for.
 */
export function projectPublishedJsonSchema(
  schema: z.ZodType,
  options: {
    readonly io?: 'input' | 'output';
    readonly unrepresentable?: 'any' | 'throw';
    readonly override?: (ctx: ProjectionOverrideContext) => void;
  } = {},
): unknown {
  const { io, unrepresentable, override } = options;
  return z.toJSONSchema(schema, {
    target: PUBLISHED_JSON_SCHEMA_TARGET,
    ...(io === 'input' ? { io } : {}),
    ...(unrepresentable ? { unrepresentable } : {}),
    override: override
      ? composeOverrides<ProjectionOverrideContext>(override, refinementProjectionOverride)
      : refinementProjectionOverride,
  });
}
