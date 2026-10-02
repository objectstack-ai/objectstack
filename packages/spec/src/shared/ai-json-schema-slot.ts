// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The AI runtime's JSON-Schema slots — one declaration for both, and the one
 * structural rule the runtime's schema reader imposes on what they carry.
 *
 * ## The two slots
 *
 * - `action.ai.outputSchema` (`ui/action.zod.ts`): the cloud AI runtime
 *   compiles it before the action runs and validates the action's result
 *   against it.
 * - `agent.structuredOutput.schema` (`ai/agent.zod.ts`): the cloud AI runtime
 *   compiles it as the agent's structured-output contract.
 *
 * Both readers call ONE guard in the cloud AI service
 * (`packages/service-ai/src/tools/json-schema-untyped.ts`, read at cloud
 * `main` 55f04d12), so both slots are declared by ONE factory here
 * ({@link aiJsonSchemaSlot}). ⛔ No per-slot copy of the rule: two copies of a
 * mirror is how one of them drifts from the runtime.
 *
 * ## The rule, mirrored exactly — no more and no less
 *
 * The runtime's schema reader does not check a type-scoped keyword
 * (`properties`, `items`, `pattern`, `minimum`, …) on a subschema that declares
 * no `type`, so it refuses such a schema outright, before it runs. The
 * declaration refuses the same schemas at authoring, at the same subschema
 * path, instead of letting them through to a refusal the author never sees:
 *
 * - **A node is refused** when it is an object (not an array, not `null`), its
 *   `type` key reads `undefined`, and any of the 22
 *   {@link TYPE_SCOPED_KEYWORDS} is present on it, whatever its value. The
 *   keyword named is the first one present, in list order.
 * - **Accepted:** a boolean schema, `{}`, and any node whose `type` is present
 *   with ANY value (an array of types, an unknown string). `enum`, `const`,
 *   `dependentRequired`, `$ref`, `not`, `anyOf` / `oneOf` / `allOf`,
 *   `if` / `then` / `else`, `title`, `description` and `default` are not on the
 *   list, so none of them is refused alone.
 * - **The walk is unconditional.** It descends into every subschema whether or
 *   not the current node is typed, so an untyped subschema under a typed
 *   parent is still refused: every value of the five
 *   {@link SUBSCHEMA_MAP_KEYWORDS}, and the single subschema or each array
 *   entry of the fourteen {@link SUBSCHEMA_SLOT_KEYWORDS}. `$ref` is not
 *   followed — a `$defs` / `definitions` entry is walked because it is a map
 *   value, not because something references it.
 *
 * The runtime stops at its first finding; this declaration reports EVERY
 * offending node, in the runtime's order (the node itself, then the map
 * keywords, then the slot keywords, each in list order), so the first issue is
 * the one the runtime would have named. The accept set is identical either way.
 *
 * ## Why this is validation and not business logic (Prime Directive #2)
 *
 * It is a pure, total structural predicate over the value the slot declares —
 * the same kind of check the spec already makes in its refinements. It reads
 * no service, no registry and no other metadata; it judges only whether the
 * declared JSON Schema is one the slot's only reader can enforce, which is the
 * declaration's own contract ("declared ⇒ enforced", Prime Directive #10).
 *
 * This module is deliberately not re-exported from the `shared` barrel: it adds
 * no public export, only the refusal on the two slots that use it.
 */

import { z } from 'zod';

/**
 * The type-scoped keywords the runtime's guard refuses on an untyped node, in
 * the runtime's own order (its `TYPE_SCOPED_KEYWORDS`). The order decides which
 * keyword a refusal names when a node carries several.
 */
export const TYPE_SCOPED_KEYWORDS = [
  'properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames',
  'minProperties', 'maxProperties', 'items', 'prefixItems', 'contains', 'minItems', 'maxItems',
  'uniqueItems', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
] as const;

/** One of the {@link TYPE_SCOPED_KEYWORDS}. */
export type TypeScopedKeyword = (typeof TYPE_SCOPED_KEYWORDS)[number];

/**
 * Keywords whose value is a MAP of subschemas: every value is walked, at
 * `<path>.<keyword>.<name>` (the runtime's `SUBSCHEMA_MAPS`).
 */
export const SUBSCHEMA_MAP_KEYWORDS = [
  'properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas',
] as const;

/**
 * Keywords whose value is ONE subschema, walked at `<path>.<keyword>`, or an
 * array of them, each walked at `<path>.<keyword>[i]` (the runtime's
 * `SUBSCHEMA_SLOTS`).
 */
export const SUBSCHEMA_SLOT_KEYWORDS = [
  'items', 'additionalProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else',
  'unevaluatedProperties', 'unevaluatedItems', 'anyOf', 'oneOf', 'allOf', 'prefixItems',
] as const;

/**
 * The `type` a refusal prescribes for each keyword: the JSON Schema type the
 * keyword applies to. Prose only — the rule itself refuses on presence and
 * prescribes nothing a reader parses.
 */
const TYPE_FOR_KEYWORD: Readonly<Record<TypeScopedKeyword, string>> = {
  properties: '"object"',
  required: '"object"',
  additionalProperties: '"object"',
  patternProperties: '"object"',
  propertyNames: '"object"',
  minProperties: '"object"',
  maxProperties: '"object"',
  items: '"array"',
  prefixItems: '"array"',
  contains: '"array"',
  minItems: '"array"',
  maxItems: '"array"',
  uniqueItems: '"array"',
  minLength: '"string"',
  maxLength: '"string"',
  pattern: '"string"',
  format: '"string"',
  minimum: '"number" or "integer"',
  maximum: '"number" or "integer"',
  exclusiveMinimum: '"number" or "integer"',
  exclusiveMaximum: '"number" or "integer"',
  multipleOf: '"number" or "integer"',
};

/** One untyped subschema carrying a type-scoped keyword. */
export interface UntypedSubschema {
  /** Where the node sits, relative to the schema root (`[]` for the root itself). */
  readonly path: readonly (string | number)[];
  /** The first {@link TYPE_SCOPED_KEYWORDS} member present on the node. */
  readonly keyword: TypeScopedKeyword;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every untyped subschema in `schema` that carries a type-scoped keyword, in
 * the order the runtime's guard visits them. Empty when the runtime's reader
 * accepts the schema. Pure and total: a non-object input has no findings, and a
 * node already on the current descent path is not entered again.
 */
export function findUntypedSubschemas(schema: unknown): UntypedSubschema[] {
  const found: UntypedSubschema[] = [];
  const onPath = new Set<object>();

  const walk = (node: unknown, path: (string | number)[]): void => {
    if (!isRecord(node) || onPath.has(node)) return;
    onPath.add(node);

    if (node.type === undefined) {
      const keyword = TYPE_SCOPED_KEYWORDS.find((k) => k in node);
      if (keyword !== undefined) found.push({ path, keyword });
    }
    for (const key of SUBSCHEMA_MAP_KEYWORDS) {
      const map = node[key];
      if (!isRecord(map)) continue;
      for (const [name, sub] of Object.entries(map)) walk(sub, [...path, key, name]);
    }
    for (const key of SUBSCHEMA_SLOT_KEYWORDS) {
      const slot = node[key];
      if (Array.isArray(slot)) slot.forEach((sub, i) => walk(sub, [...path, key, i]));
      else walk(slot, [...path, key]);
    }

    onPath.delete(node);
  };

  walk(schema, []);
  return found;
}

/** `root` plus a subschema path, spelled the way the runtime spells it. */
function displayPath(root: string, path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : `${acc}.${seg}`),
    root,
  );
}

/** The refusal text for one finding under the slot named `root`. */
export function untypedSubschemaMessage(root: string, finding: UntypedSubschema): string {
  const { keyword } = finding;
  return (
    `${displayPath(root, finding.path)} uses "${keyword}" without a "type", which the AI `
    + 'runtime\'s schema reader does not check, so the runtime refuses this whole schema before it '
    + `runs; declare its "type" — "${keyword}" applies to "type": ${TYPE_FOR_KEYWORD[keyword]}`
  );
}

/**
 * The JSON-Schema slot both AI-runtime readers compile: an open JSON object
 * that refuses, at its subschema path, every untyped subschema carrying a
 * type-scoped keyword. `root` is the slot as an author writes it
 * (`ai.outputSchema`, `structuredOutput.schema`); it names the slot in the
 * refusal text, and the issue `path` locates the subschema under the slot.
 */
export function aiJsonSchemaSlot(root: string) {
  return z.record(z.string(), z.unknown()).superRefine((schema, ctx) => {
    for (const finding of findUntypedSubschemas(schema)) {
      ctx.addIssue({
        code: 'custom',
        path: [...finding.path],
        message: untypedSubschemaMessage(root, finding),
      });
    }
  });
}
