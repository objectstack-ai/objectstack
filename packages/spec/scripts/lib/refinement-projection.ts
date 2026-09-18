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
import type { z } from 'zod';
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
 * `anyOf` of one `required` per key, conjoined with whatever the node already
 * says.
 *
 * Written into `anyOf` when that keyword is free — the spelling a reader of the
 * file and the reference tables expect — and nested inside `allOf` when it is
 * not, because two `anyOf`s on one node would silently replace one rule with the
 * other. (No node on the shipped tree needs the `allOf` arm today; it is here so
 * that the day one does, the file states both rules instead of one.)
 */
function emitRequiredOneOf(jsonSchema: JsonObject, keys: readonly string[]): void {
  if (keys.length === 0) return;
  const anyOf = keys.map((key) => ({ required: [key] }));
  if (!('anyOf' in jsonSchema)) {
    jsonSchema.anyOf = anyOf;
    return;
  }
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

/** Write one declared arm's keywords onto one emitted node. */
export function emitProjectableRefinement(jsonSchema: JsonObject, declared: ProjectableRefinement): void {
  switch (declared.pattern) {
    case 'required-one-of':
      emitRequiredOneOf(jsonSchema, declared.keys);
      return;
    case 'non-blank-string':
      emitNonBlankString(jsonSchema);
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
