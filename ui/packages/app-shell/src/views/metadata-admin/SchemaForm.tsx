// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SchemaForm — minimal JSONSchema-driven form (Phase 3c).
 *
 * The framework's `/meta/types` endpoint returns a `schema` field per
 * type, generated from Zod via `zod-to-json-schema`. We render that
 * schema as a form so admins can edit *any* metadata type without
 * the platform having to write a bespoke editor for each.
 *
 * Scope (MVP):
 *   • string  → Input (or Textarea if `format: 'multiline'`)
 *   • number  → Input type="number"
 *   • boolean → Switch
 *   • enum    → Select
 *   • array of strings → tag editor (comma-separated for MVP)
 *   • object  → recursive collapsed section
 *   • anyOf / oneOf / unknown → JSON textarea fallback
 *
 * NOT covered (yet) — those types use bespoke editors registered via
 * `registerMetadataResource()`:
 *   • Permission matrix (rows × columns × actions)
 *   • Object/Field designers
 *   • View / dashboard / page canvas designers
 *
 * Error display:
 *   • Pass `issues` in the shape `[{ path: 'a.b', message: '...' }, ...]`
 *     to render inline error chips next to the offending fields.
 *   • Matches the framework's `error.issues` envelope from `sendError`.
 */

import * as React from 'react';
import { Input } from '@object-ui/components';
import { Textarea } from '@object-ui/components';
import { Label } from '@object-ui/components';
import { Switch } from '@object-ui/components';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { Button } from '@object-ui/components';
import { Plus, Trash2, ChevronDown, ChevronRight, GripVertical, Settings2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@object-ui/components';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@object-ui/components';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@object-ui/components';
import { usePredicateScope } from '@object-ui/react';
import { resolveSectionGroupReferences } from '@object-ui/plugin-form';
import { evaluatePredicate, buildPredicateCtx, visibleOptions } from './predicate.js';
import type { FormFieldSpec, FormSectionSpec, FormViewSpec, VisibilityPredicate } from './form-spec.js';
import {
  WIDGETS,
  widgetLabelling,
  resolveColorWidgetKey,
  type RegisteredWidgetKey,
  type WidgetContext,
  type WidgetLabelling,
  type WidgetRenderer,
} from './widgets.js';
import { useMetadataLocale, t, tFormat, translateValidationMessage, translateEnumOption, translateSchemaFieldLabel, translateSchemaFieldHelp } from './i18n.js';
import { untranslatedFieldLabel } from './field-source-label.js';

/**
 * The form authoring surface — `FormFieldSpec` and the `VisibilityPredicate`
 * it is written in — is declared in `./form-spec.js`, a leaf that `./widgets.js`
 * imports too, so the two halves of that contract cannot drift apart again
 * (objectui#5040). Re-exported here because this is the module every importer
 * already reaches for.
 */
export type { FormFieldSpec, FormSectionSpec, FormViewSpec, VisibilityPredicate } from './form-spec.js';

type JsonSchema = Record<string, any>;

/* ----- `$ref` indirection (objectui#9912) --------------------------------- */

/**
 * JSON Schema keywords whose value is DATA, not a subschema — never walked by
 * {@link inlineSchemaRefs}. Mirrors the producer's own position-aware walk
 * (`@objectstack/metadata-protocol` `unauthorable-nodes.ts`), for the same
 * reason: a metadata `default` or `const` is an author's VALUE, and a value
 * that happens to carry a `$ref` key is not an indirection this renderer may
 * follow.
 */
const REF_WALK_DATA_KEYS: ReadonlySet<string> = new Set([
  'default', 'const', 'enum', 'examples', 'title', 'description',
  '$schema', '$id', '$comment', 'required',
]);

/**
 * Keywords whose value is a MAP of author-chosen NAME to subschema. The map is
 * not a schema node; every VALUE in it is. Reading such a map as a node is how
 * a property literally named `items` or `not` gets its own value treated as a
 * keyword.
 */
const REF_WALK_MAP_KEYS: ReadonlySet<string> = new Set([
  'properties', 'patternProperties', 'dependentSchemas',
]);

/**
 * Inline a served schema's `$ref` nodes against its own `$defs`, so the widget
 * decision sees the shape the document declares instead of an indirection it
 * has no branch for (objectui#9912).
 *
 * ## What the platform actually serves, and which rows this moves
 *
 * `/meta/types` derives each type with `z.toJSONSchema()`, and Zod emits a
 * `$defs` entry plus a `$ref` for any schema reached more than once or defined
 * recursively. The resulting node carries no `type`, no `properties` and no
 * `enum`, so it reaches {@link resolveFieldFace} with nothing to classify and
 * falls to the last-resort JSON editor — while the shape it points at is right
 * there in the same document.
 *
 * ⚠️ Measured on the installed `@objectstack/spec`, and the headline is a
 * NEGATIVE: most of the served `$ref` rows are the recursive Query-DSL
 * `FilterCondition` (`dataset.filter`, `field.relatedListFilter`,
 * `report.runtimeFilter`, `dashboard.widgets[].filter`, …), whose target
 * derives to `allOf: [ an open record, { $and / $or / $not } ]` — no top-level
 * `type`, so the face after inlining is the SAME JSON editor. Those rows are
 * NOT what this buys; `SchemaForm.refIndirection-9912.test.tsx` pins both
 * directions so a later reader does not mistake one for the other, and the
 * `widget: 'json'` the spec's own `report` form declares on `runtimeFilter`
 * says the JSON editor is the intended control there.
 *
 * ## The cycle guard is not defensive, it is load-bearing
 *
 * That same `FilterCondition` target refers to ITSELF (`$and` is an array of
 * it), so an eager resolver does not terminate. A pointer already on the
 * resolution stack is left as the `$ref` node it is — which is exactly the
 * behaviour this function replaces, applied one level in.
 *
 * ## Sibling keywords win
 *
 * JSON Schema 2020-12 allows keywords beside `$ref`, and the derivation uses
 * that for the row's own `description` — its help text in the form. The inlined
 * target is therefore the BASE and the node's own keys are laid over it, never
 * the other way round.
 *
 * Pure and copy-on-write: a document with no resolvable `$ref` is returned by
 * reference, so every type that carries none renders from the very same object
 * it does today.
 */
function inlineSchemaRefs(doc: JsonSchema | undefined): JsonSchema | undefined {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;

  /** The target of a LOCAL pointer into this document's own definitions. */
  const target = (ref: string): JsonSchema | undefined => {
    const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
    if (!match) return undefined;
    // RFC 6901 escapes, in the order the spec mandates (`~1` before `~0`).
    const key = match[2].replace(/~1/g, '/').replace(/~0/g, '~');
    const dictionary = doc[match[1]];
    if (!dictionary || typeof dictionary !== 'object') return undefined;
    const found = dictionary[key];
    return found && typeof found === 'object' && !Array.isArray(found)
      ? (found as JsonSchema)
      : undefined;
  };

  function walkNode(node: unknown, stack: readonly string[]): unknown {
    if (Array.isArray(node)) {
      let changed = false;
      const out = node.map((entry) => {
        const next = walkNode(entry, stack);
        if (next !== entry) changed = true;
        return next;
      });
      return changed ? out : node;
    }
    if (!node || typeof node !== 'object') return node;
    const source = node as JsonSchema;

    const ref = typeof source.$ref === 'string' ? source.$ref : undefined;
    if (ref) {
      // A pointer already being resolved — the recursive arm. Leave it.
      if (stack.includes(ref)) return node;
      const found = target(ref);
      if (!found) return node;
      const inlined = walkNode(found, [...stack, ref]) as JsonSchema;
      const siblings: Record<string, unknown> = { ...source };
      delete siblings.$ref;
      return Object.keys(siblings).length > 0 ? { ...inlined, ...siblings } : inlined;
    }

    let out: Record<string, unknown> | undefined;
    for (const [key, entry] of Object.entries(source)) {
      if (REF_WALK_DATA_KEYS.has(key)) continue;
      // The definition dictionary stays byte-identical: pointers into it must
      // keep resolving, and each target is walked when it is inlined.
      if (key === '$defs' || key === 'definitions') continue;
      const next = REF_WALK_MAP_KEYS.has(key)
        ? walkMap(entry, stack)
        : walkNode(entry, stack);
      if (next !== entry) {
        out ??= { ...source };
        out[key] = next;
      }
    }
    return out ?? node;
  }

  function walkMap(map: unknown, stack: readonly string[]): unknown {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
    let out: Record<string, unknown> | undefined;
    for (const [key, entry] of Object.entries(map as Record<string, unknown>)) {
      const next = walkNode(entry, stack);
      if (next !== entry) {
        out ??= { ...(map as Record<string, unknown>) };
        out[key] = next;
      }
    }
    return out ?? map;
  }

  return walkNode(doc, []) as JsonSchema;
}

/** Widgets that don't need a custom renderer — they overlay on the
 * existing default control (textarea/input/etc) and just act as a hint. */
const KNOWN_PASSTHROUGH_WIDGETS = new Set<string>([
  'text',
  'textarea',
  'number',
  'switch',
  'select',
  'json',
]);

/**
 * A union member that is ITSELF nothing but a union — no `type`, no
 * `properties`, just `oneOf` / `anyOf`. Such a member accepts exactly what its
 * own members accept, so {@link unionMembers} lists those in its place.
 */
function isBareUnion(node: unknown): node is JsonSchema {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const n = node as JsonSchema;
  return n.type === undefined && n.properties === undefined && Array.isArray(n.oneOf ?? n.anyOf);
}

/**
 * The branches a union offers the value, with a bare nested union
 * ({@link isBareUnion}) replaced by its own members (objectui#11251).
 *
 * The served `view` schema is the reason this exists: its top level is
 * `anyOf: [ { oneOf: [ list ViewItem, form ViewItem ] }, container, list
 * overlay, form overlay ]`. Scored as one member, the ViewItem wrapper has no
 * `type` and no `required` of its own, so it scores zero and a stored ViewItem
 * lost to the list overlay — whose form then showed that ViewItem's columns as
 * empty, and whose top-level edits the ViewItem member strips on save. Listing
 * the two ViewItem shapes directly is what lets the value reach them. The
 * wrapper's own keywords (a `title` / `description`) ride along on each member,
 * and the member's own keys win.
 */
function unionMembers(schema: JsonSchema): JsonSchema[] | undefined {
  const own = (schema.oneOf ?? schema.anyOf) as unknown;
  if (!Array.isArray(own) || own.length === 0) return undefined;
  return (own as JsonSchema[]).flatMap((member) => {
    if (!isBareUnion(member)) return [member];
    const { oneOf: _oneOf, anyOf: _anyOf, ...wrapper } = member;
    return (unionMembers(member) ?? [member]).map((inner) => ({ ...wrapper, ...inner }));
  });
}

/**
 * How many ways an object VALUE rules the branch out (objectui#11251): a key
 * the branch does not declare while it is closed (`additionalProperties:
 * false`); a primitive held under a key whose `const` / `enum` the branch pins
 * to something else; a key the branch `required` that the value lacks.
 *
 * A value that carries no key at all contradicts no branch — an empty
 * create-mode value is no evidence, and it still lands on the first branch.
 *
 * This is what tells the four `view` members apart: `viewKind` is a `const` /
 * one-value `enum` on each of them, the overlays require `object` + `viewKind`
 * (a container carries no `viewKind`), and the ViewItem member declares
 * neither the overlay's inline keys nor the container's slots.
 */
function valueContradictions(branch: JsonSchema, value: Record<string, unknown>): number {
  const props = branch.properties as Record<string, unknown> | undefined;
  if (!props || typeof props !== 'object') return 0;
  const present = Object.keys(value).filter((key) => value[key] !== undefined);
  if (present.length === 0) return 0;
  let n = 0;
  if (Array.isArray(branch.required)) {
    for (const key of branch.required as string[]) {
      if (value[key] === undefined) n += 1;
    }
  }
  for (const key of present) {
    const held = value[key];
    const prop = props[key] as JsonSchema | undefined;
    if (!prop || typeof prop !== 'object') {
      if (branch.additionalProperties === false) n += 1;
      continue;
    }
    if (held === null || typeof held === 'object') continue;
    if ('const' in prop) {
      if (prop.const !== held) n += 1;
    } else if (Array.isArray(prop.enum) && !(prop.enum as unknown[]).includes(held)) {
      n += 1;
    }
  }
  return n;
}

/**
 * Pick the best-matching branch of a JSON Schema `oneOf` / `anyOf`
 * union for the given value. Scores each branch by how many of its
 * `required` keys are present in the value (and same `type`); falls
 * back to the first branch when nothing matches (so create-mode forms
 * with empty values still render *something* structured).
 *
 * Ranking, in order (objectui#11251):
 *  1. the branch whose `type` fits the value's kind;
 *  2. among those, the one the value contradicts least
 *     ({@link valueContradictions});
 *  3. then the items-type tiebreak and the count of `required` keys present;
 *  4. then declaration order.
 * Where the contradictions tie — every scalar and array value, an empty object,
 * and an object no branch rules out — steps 1 and 3 are the score this
 * function always computed, in the same order, so those picks are unchanged.
 * (The one order the old sum could invert — a branch with no `type`
 * outscoring a typed one on `required` keys alone — was absent from every
 * served derivation of the installed spec when this was written; nothing
 * re-checks that.) A bare nested union is scored member by member
 * ({@link unionMembers}).
 *
 * Returns the original schema unchanged when there's no union to
 * resolve. Used by the recursive renderer so View `data` (provider
 * discriminator), `columns`, `sort`, etc. produce real labelled
 * inputs instead of a raw JSON blob — and by `SchemaFormBody` for a
 * served schema whose TOP level is a union (the `view` type).
 */
function resolveUnionBranch(
  schema: JsonSchema | undefined,
  value: unknown,
): JsonSchema | undefined {
  if (!schema) return schema;
  const branches = unionMembers(schema);
  if (!branches) return schema;

  const isPlainObj = value != null && typeof value === 'object' && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const valKeys = isPlainObj ? new Set(Object.keys(value as Record<string, unknown>)) : null;

  let best: { branch: JsonSchema; kind: number; contradictions: number; rest: number } | null = null;
  const firstItem = isArray && (value as unknown[]).length ? (value as unknown[])[0] : undefined;
  const firstItemIsObj = firstItem != null && typeof firstItem === 'object' && !Array.isArray(firstItem);
  for (const b of branches) {
    let kind = 0;
    let rest = 0;
    if (b.type === 'array' && isArray) {
      kind += 5;
      // Tiebreaker for `anyOf [array<string>, array<object>]` etc — match the
      // branch's items.type against the actual element type.
      const itemType = (b.items as JsonSchema | undefined)?.type;
      if (itemType === 'object' && firstItemIsObj) rest += 3;
      else if (
        (itemType === 'string' && typeof firstItem === 'string') ||
        (itemType === 'number' && typeof firstItem === 'number') ||
        (itemType === 'integer' && typeof firstItem === 'number')
      ) rest += 3;
    }
    if (b.type === 'object' && isPlainObj) kind += 5;
    if (b.type === 'string' && typeof value === 'string') kind += 5;
    if (b.type === 'number' && typeof value === 'number') kind += 5;
    if (b.type === 'boolean' && typeof value === 'boolean') kind += 5;
    if (valKeys && Array.isArray(b.required)) {
      for (const r of b.required as string[]) {
        if (valKeys.has(r)) rest += 1;
      }
    }
    const contradictions = isPlainObj
      ? valueContradictions(b, value as Record<string, unknown>)
      : 0;
    if (
      !best ||
      kind > best.kind ||
      (kind === best.kind &&
        (contradictions < best.contradictions ||
          (contradictions === best.contradictions && rest > best.rest)))
    ) {
      best = { branch: b, kind, contradictions, rest };
    }
  }
  // Merge the branch's shape on top of any parent metadata (title /
  // description) so the recursive renderer still sees the field's
  // documentation.
  const picked = best?.branch ?? branches[0];
  return {
    ...schema,
    ...picked,
    oneOf: undefined,
    anyOf: undefined,
  } as JsonSchema;
}

/**
 * Resolve the row (item) schema for a `repeater` field. The repeater derives
 * its per-row sub-fields from `items.properties`, but the field's JSONSchema
 * may wrap the canonical array form in a union (`anyOf` / `oneOf`) — e.g. a
 * View `sort` (`anyOf: [ "field desc" string, {field,order}[] ]`, kept as a
 * union so the legacy bare-string form still validates). Reading
 * `schema.items` at the top level then misses the array branch nested inside
 * the union, leaving the repeater with zero sub-fields — a blank row with no
 * field picker or order dropdown (objectui#3379).
 *
 * Resolve the union to its ARRAY branch first (forcing an array value so the
 * score lands on that branch even before any row exists), then return its
 * `items`, itself union-resolved against the first existing row. A plain
 * array schema (no union) passes straight through unchanged.
 */
function repeaterItemSchema(
  schema: JsonSchema | undefined,
  value: unknown,
): JsonSchema {
  if (!schema) return {};
  const arrayBranch = resolveUnionBranch(
    schema,
    Array.isArray(value) ? value : [],
  );
  const items = arrayBranch?.items as JsonSchema | undefined;
  if (!items || typeof items !== 'object') return {};
  const firstRow = Array.isArray(value) && value.length ? value[0] : undefined;
  return (resolveUnionBranch(items, firstRow) ?? {}) as JsonSchema;
}

/**
 * Infer widget name from FormFieldSpec.type (Data.FieldType) and schema.
 * Priority: explicit widget > type-based inference > schema-based inference > default.
 */
function inferWidget(
  fieldSpec: FormFieldSpec | undefined,
  schema: JsonSchema | undefined,
): string | undefined {
  // 1. Explicit widget always wins
  if (fieldSpec?.widget) return fieldSpec.widget;

  // 2. Infer from Data.FieldType
  if (fieldSpec?.type) {
    const t = fieldSpec.type;
    // Text types
    if (t === 'text' || t === 'email' || t === 'url' || t === 'phone' || t === 'password') return 'text';
    if (t === 'textarea' || t === 'markdown' || t === 'html' || t === 'richtext') return 'textarea';
    
    // Number types
    if (t === 'number' || t === 'currency' || t === 'percent') return 'number';
    
    // Date/time
    if (t === 'date' || t === 'datetime' || t === 'time') return 'date-picker';
    
    // Boolean
    if (t === 'boolean' || t === 'toggle') return 'switch';
    
    // Selection
    if (t === 'select' || t === 'radio') return fieldSpec.multiple ? 'multiselect' : 'select';
    if (t === 'multiselect' || t === 'checkboxes' || t === 'tags') return 'string-tags';

    // Embedded structured (composite/repeater handled natively in FieldControl
    // BEFORE the WIDGETS registry — return the type name so the badge is
    // accurate; FieldControl short-circuits before widget lookup).
    if (t === 'composite') return 'composite';
    if (t === 'repeater') return 'repeater';
    if (t === 'record') return 'record';

    // Relational
    if (t === 'lookup' || t === 'master_detail') return 'ref-object';
    if (t === 'tree') return 'ref-object';
    
    // Media
    if (t === 'image' || t === 'file' || t === 'avatar' || t === 'video' || t === 'audio') return 'file-upload';
    
    // Code/JSON
    if (t === 'code') return 'code';
    if (t === 'json') return 'json';
    
    // Enhanced
    if (t === 'location' || t === 'address') return 'json';
    if (t === 'color') return 'color-picker';
    if (t === 'rating') return 'number';
    if (t === 'slider') return 'slider';
    if (t === 'signature') return 'signature';
    if (t === 'qrcode') return 'qrcode';
    if (t === 'progress') return 'number';
    
    // Calculated
    if (t === 'formula' || t === 'summary' || t === 'autonumber') return 'text';
    
    // Vector
    if (t === 'vector') return 'json';
  }

  // 3. Infer from JSON Schema
  if (schema) {
    const type = schema.type;
    
    // Array of enum → multi-select of the allowed values (picker, not free
    // text). Checked before the generic string-array case because a Zod
    // `z.enum` serialises as `items: { type: 'string', enum: [...] }`.
    if (type === 'array' && Array.isArray(schema.items?.enum)) return 'multiselect';

    // Array of strings → string-tags
    if (type === 'array' && schema.items?.type === 'string') return 'string-tags';
    
    // Array of objects → master-detail
    if (type === 'array' && schema.items?.type === 'object') return 'master-detail';
    
    // Object → object-fields
    if (type === 'object') return 'object-fields';
    
    // Boolean → switch
    if (type === 'boolean') return 'switch';
    
    // Number → number
    if (type === 'number' || type === 'integer') return 'number';
    
    // Enum → select
    if (Array.isArray(schema.enum)) return 'select';
    
    // String with format
    if (type === 'string') {
      if (schema.format === 'date' || schema.format === 'date-time') return 'date-picker';
      if (schema.format === 'email' || schema.format === 'uri' || schema.format === 'uri-reference') return 'text';
      if (schema.format === 'multiline') return 'textarea';
    }
  }

  // 4. Default fallback
  return undefined;
}

/**
 * The served declaration's mark on an arm whose authoring type a transform
 * erased (objectui#9830), as `@objectstack/metadata-protocol` emits it — and the
 * one version of its value this reader was written against. `@objectstack/spec`
 * exports neither, so this is the reader's single spelling of the keyword.
 */
const ERASED_AUTHORING_INPUT_KEYWORD = 'x-objectstack-erased-authoring-input';
const ERASED_AUTHORING_INPUT_VERSION = 1;

/**
 * The authoring type(s) the declaration says a transform erased from THIS
 * node, or `undefined` when it carries no mark this reader understands — an
 * absent mark, a malformed one, and one of another version all decline the same
 * way, back to the unmarked husk. {@link admitsString} documents what the mark
 * disambiguates and why it is the only signal read for it.
 */
function erasedAuthoringType(node: JsonSchema): string[] | undefined {
  const mark = node[ERASED_AUTHORING_INPUT_KEYWORD];
  if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return undefined;
  if (mark.version !== ERASED_AUTHORING_INPUT_VERSION) return undefined;
  const type: unknown = mark.type;
  if (typeof type === 'string') return [type];
  if (Array.isArray(type) && type.every((t) => typeof t === 'string')) return type as string[];
  return undefined;
}

/**
 * Does this schema admit a STRING value — looking THROUGH nested unions?
 *
 * ## Why this is not `schema.anyOf.some(b => b.type === 'string')`
 *
 * Five NAME-CONVENTION detectors below share one gate: the name says which
 * widget a property WANTS, and this shape test says whether the property can
 * actually hold what that widget writes. Each of them used to spell the gate
 * inline as a ONE-LEVEL scan of `anyOf`, and a one-level scan is blind to a
 * union nested inside a union — which is exactly the shape the platform serves
 * for a predicate that also accepts a boolean literal. Derived from the
 * installed `@objectstack/spec` through the same `z.toJSONSchema` call
 * `/meta/types` is served with, an `action`'s own `visible` reads:
 *
 * ```
 * anyOf: [ { type: 'boolean' },
 *          { anyOf: [ { type: 'string', minLength: 1 },
 *                     { type: 'object', properties: { dialect, source, … } } ] } ]
 * ```
 *
 * The string arm IS there, one `anyOf` deeper, and the one-level scan returned
 * false for it — so `detectConditionWidget` declined a key it was written to
 * claim and the author got a plain text box for a CEL predicate, on a runtime
 * that fails CLOSE on an unevaluable one (objectui#9830). The same `action`
 * type's `params[].visible` carries its string arm at the TOP level and was
 * routed all along: one property, two nesting depths, two different faces.
 *
 * `oneOf` is walked with `anyOf` because {@link pickBranch} and the scalar
 * chain already read `schema.oneOf ?? schema.anyOf` as one union — a detector
 * that disagreed with the branch picker about what a union is would reopen this
 * same split one combinator over. `allOf` is deliberately NOT walked: it is an
 * intersection, so an arm typed string does not mean the value may be one.
 *
 * ## ⛔ An EMPTY schema is not a string arm — unless the declaration marks it
 *
 * JSON Schema says `{}` admits everything, strings included, and the
 * platform's output-mode derivation emits exactly `anyOf: [ {}, { …envelope } ]`
 * for `hook.condition`, `sharing_rule.condition` and `field.visibleWhen` /
 * `readonlyWhen` / `requiredWhen` — the transform on those keys erases its own
 * input type. `{}` is what "we could not derive this" and "anything goes" BOTH
 * look like on the wire, so a BARE `{}` is still not read as a string arm:
 * doing so would mount the condition builder on any predicate-named key whose
 * schema derived to nothing, including one that is genuinely boolean-only.
 *
 * Telling the two apart needed a signal only the DECLARATION side can send, and
 * it now sends one (objectui#9830, maintainer ruling B): the served projection
 * annotates an erased arm IN PLACE with
 * `"x-objectstack-erased-authoring-input": { "version": 1, "type": "string" }`,
 * where `type` names the authoring type the transform erased. The mark sits on
 * the erased arm itself — inside the member's `anyOf`, not on the member's own
 * schema and not on the envelope — so this walk reads it on every node it
 * visits, the same place it already reads `type`. {@link erasedAuthoringType}
 * is that read, and it answers "string" only when the mark says so:
 *
 *  - a mark whose `type` names `string` IS a string arm: the arm accepted a
 *    string before the transform ran, which is what an author writes there;
 *  - a mark naming any other type says nothing about strings — the emitter
 *    names whatever authoring type was erased, not only `string`;
 *  - a mark of a version this reader was not written for is not evidence of
 *    anything, so it declines exactly as an unmarked husk does;
 *  - an UNMARKED `{}` keeps the veto — a genuinely open member is served that
 *    way, and so is the envelope's own `ast` key one level below a marked arm.
 *
 * ⛔ Never a key-name rule instead (`condition` / `*When` ⇒ "must be a
 * string"): the ruling refused that as an inference copied into every consumer
 * and wrong in a direction nothing reports. The mark is SHAPE information, so it
 * is read here, in the one shape test all five detectors share — a detector
 * that saw it and a detector that did not would answer "does this admit a
 * string?" two ways for one schema, the split this helper exists to close.
 *
 * ## The precedence this gate is one third of
 *
 * 1. an explicit `fieldSpec.widget` wins outright — {@link resolveFieldWidget}
 *    runs no detector at all when the form spec pinned one;
 * 2. then THIS shape test VETOES: a name convention never mounts a widget on a
 *    schema that cannot hold what the widget writes;
 * 3. then the name convention SELECTS among the widgets whose shape fits.
 *
 * So neither side "wins" globally: the declaration decides, the shape holds a
 * veto, the name chooses. Written down here because it was readable only by
 * reading five copies of one expression.
 *
 * Iterative with a visited set rather than plain recursion: the schemas reaching
 * this engine include hand-written objects from registries and tests, not only
 * parsed JSON, so a self-referential one must terminate rather than blow the
 * stack.
 */
function admitsString(schema: JsonSchema | undefined): boolean {
  const seen = new Set<object>();
  const pending: unknown[] = [schema];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    const branch = node as JsonSchema;
    if (branch.type === 'string') return true;
    if (erasedAuthoringType(branch)?.includes('string')) return true;
    for (const key of ['anyOf', 'oneOf'] as const) {
      const arms = branch[key];
      if (Array.isArray(arms)) pending.push(...(arms as unknown[]));
    }
  }
  return false;
}

/**
 * Detect a field-reference widget by NAME CONVENTION, gated on having an
 * object field catalog in `widgetContext`. This is what makes every view
 * type's field-reference config (titleField, groupByField, startDateField,
 * xAxisField, visibleFields, yAxisFields, …) render as an object-field
 * picker instead of free text — without hardcoding per-type knowledge.
 *
 * Convention (spec props carry no `format:'field'` marker, so name + shape
 * is the pragmatic signal):
 *   • SINGLE (`field-ref`): a string prop named `*Field` (or bare `field`),
 *     excluding enum props (those are real selects).
 *   • MULTI  (`field-multi`): an array-of-strings prop named `*Fields`
 *     (or `columns` / `fieldOrder`).
 */
function detectFieldRefWidget(
  name: string,
  schema: JsonSchema | undefined,
  widgetContext?: WidgetContext,
): string | undefined {
  // Tests WIRING, not contents: is a field catalog plumbed to this form at all?
  // Deliberately NOT a read of the catalog — under objectui#5228's union every
  // arm (`idle` / `loading` / `loaded` / `error`) answers yes, and it must, or a
  // FAILED catalog would silently demote the picker back to the free-text input
  // whose typos the picker exists to prevent. The picker itself renders the
  // failure. (Before the union this line read the same way for a different
  // reason: the array was `[]` on failure, and `[]` is truthy.)
  if (!widgetContext?.objectFields) return undefined;
  if (Array.isArray(schema?.enum)) return undefined;

  const isStringArray =
    schema?.type === 'array' &&
    (schema.items as JsonSchema | undefined)?.type === 'string';
  if (isStringArray && (/Fields$/.test(name) || name === 'columns' || name === 'fieldOrder')) {
    return 'field-multi';
  }

  if (admitsString(schema) && (/.Field$/.test(name) || name === 'field')) {
    return 'field-ref';
  }
  return undefined;
}

/**
 * Detect the icon picker by NAME CONVENTION: a string prop named `icon` (or
 * `*Icon`) with no enum. Mirrors {@link detectFieldRefWidget} so every metadata
 * type's icon field renders the searchable Lucide picker instead of a free-text
 * input, without each spec `*.form.ts` having to pin `widget: 'icon'`.
 */
function detectIconWidget(name: string, schema: JsonSchema | undefined): string | undefined {
  if (Array.isArray(schema?.enum)) return undefined;
  if (!admitsString(schema)) return undefined;
  if (name === 'icon' || /Icon$/.test(name)) return 'icon';
  return undefined;
}

/**
 * Detect the color swatch picker by NAME CONVENTION: a string field named
 * `color`, `colorVariant`, or `*Color`. An enum gets the semantic swatch row;
 * a free string gets the native hex picker. Mirrors the icon/field-ref
 * conventions so color fields are consistent across every metadata type.
 */
function detectColorWidget(name: string, schema: JsonSchema | undefined): string | undefined {
  if (!admitsString(schema) && !Array.isArray(schema?.enum)) return undefined;
  if (name === 'color' || name === 'colorVariant' || /Color$/.test(name)) return 'color-picker';
  return undefined;
}

/**
 * Resolve a CONDITIONAL widget name to the concrete registration that will
 * render (objectui#4871, maintainer ruling point 4).
 *
 * `color-picker` used to be one registry entry that chose between a swatch
 * `radiogroup` and a labelable `input[type="color"]` at RUNTIME, from
 * `schema`/`fieldSpec` — i.e. AFTER `FieldRow` had already written
 * `<Label htmlFor>`, which is exactly why the host could not know which naming
 * channel to emit. The two surfaces are two registrations now, and this
 * function is where the host picks between them: from the schema, BEFORE the
 * label. `resolveColorWidgetKey` lives beside the widgets and is what both of
 * them read their palette through, so host and widget cannot disagree.
 *
 * Runs on the AUTHORED name too, not only the inferred one: a spec that pins
 * `widget: 'color-picker'` on a free-colour field must still land on the
 * registration that actually renders, or the declaration would describe a
 * different surface than the one on screen.
 */
function resolveRegisteredWidget(
  widget: string | undefined,
  schema: JsonSchema | undefined,
  fieldSpec: FormFieldSpec | undefined,
): string | undefined {
  if (widget === 'color-picker' || widget === 'color-input') {
    return resolveColorWidgetKey(schema, fieldSpec);
  }
  return widget;
}

/* ----- which face renders, resolved BEFORE the label (objectui#5039) ------- */

/**
 * The face {@link FieldControl} will render for a field — a closed set, so the
 * host can name it without rendering it first.
 */
export type FieldFace =
  /** `fieldSpec.type: 'composite'` → {@link CompositeField}. */
  | { kind: 'composite' }
  /** `fieldSpec.type: 'repeater'` → {@link RepeaterField}. */
  | { kind: 'repeater'; itemSchema: JsonSchema }
  /** `fieldSpec.type: 'record'` → {@link RecordField}. */
  | { kind: 'record'; itemSchema: JsonSchema }
  /** A key of {@link WIDGETS} — the face objectui#4871's declaration covers. */
  | { kind: 'registered'; widget: RegisteredWidgetKey }
  /** Object-with-properties → a recursive {@link SchemaForm} in a bordered box. */
  | { kind: 'nested-form'; effective: JsonSchema }
  /** Array-of-object → {@link RepeaterField} with per-row inputs. */
  | { kind: 'object-rows'; effective: JsonSchema; itemSchema: JsonSchema }
  /**
   * {@link RawJsonEditor}. `hint` is the unregistered widget name whose
   * fallback we are announcing; absent for the last-resort (`small`) editor.
   */
  | { kind: 'raw-json'; hint?: string }
  /** Every builtin branch: select / switch / number / input / tag input. */
  | { kind: 'scalar'; effective: JsonSchema };

/**
 * Resolve which face a field renders, from exactly the inputs `FieldControl`
 * renders from — no DOM, no render (objectui#5039).
 *
 * `FieldRow` must decide how its visible label reaches the control BEFORE it
 * writes that label. For the twenty REGISTERED widgets objectui#4871 answered
 * that from the registry's `labelling` declaration. Six paths never reach the
 * registry, so they had no declaration and took the default `control` channel:
 * `composite` / `repeater` / `record` come from `fieldSpec.type`, and the three
 * structural fallbacks (recursive `SchemaForm` / `RepeaterField` /
 * `RawJsonEditor`) were picked INSIDE `FieldControl` from the union-resolved
 * `effective` schema — i.e. after the label had already been written. None of the
 * six consumed the id, so all six emitted a `<label for>` aimed at an id no
 * element in the document carried (`for=DANGLING hostIdEl=NONE`, both states).
 *
 * This function is that late decision lifted out whole. `FieldRow` calls it
 * before the label; `FieldControl` calls it instead of deciding again — one
 * resolution, so the naming channel and the rendered DOM cannot drift apart.
 * Same shape as `resolveRegisteredWidget()`, applied to the paths that have no
 * registry entry to declare anything.
 *
 * Branch order mirrors `FieldControl` exactly, asymmetry included: with a widget
 * hint present the structural checks run BEFORE the scalar chain, and an
 * unregistered non-passthrough hint short-circuits to the JSON editor; with no
 * hint (or a passthrough one that matched no structure) the scalar chain runs
 * first.
 */
export function resolveFieldFace({
  fieldSpec,
  widget,
  schema,
  value,
}: {
  fieldSpec?: FormFieldSpec;
  widget?: string;
  schema?: JsonSchema;
  value?: unknown;
}): FieldFace {
  // 1. Spec-declared structured types — known from `fieldSpec.type` alone, and
  // short-circuited in `FieldControl` ahead of the registry lookup.
  if (fieldSpec?.type === 'composite') return { kind: 'composite' };
  if (fieldSpec?.type === 'repeater') {
    return { kind: 'repeater', itemSchema: repeaterItemSchema(schema, value) };
  }
  if (fieldSpec?.type === 'record') {
    return {
      kind: 'record',
      itemSchema: (schema?.additionalProperties as JsonSchema | undefined) ?? {},
    };
  }

  const effective = resolveUnionBranch(schema, value) ?? schema ?? {};
  const isObjectForm = (s: JsonSchema | undefined) =>
    s?.type === 'object' && !!s.properties && typeof s.properties === 'object';
  /** The row schema of an array-of-object face, or undefined if it isn't one. */
  const objectRowSchema = (s: JsonSchema | undefined): JsonSchema | undefined => {
    if (s?.type !== 'array' || !s.items || typeof s.items !== 'object') return undefined;
    const itemSchema = resolveUnionBranch(
      s.items as JsonSchema,
      Array.isArray(value) && value.length ? value[0] : undefined,
    );
    return isObjectForm(itemSchema) ? itemSchema : undefined;
  };

  // 2. A widget hint: the registry first, then the structural fallbacks, then
  // the announced JSON editor — the order of `FieldControl`'s `if (widget)` block.
  if (widget) {
    if (WIDGETS[widget as RegisteredWidgetKey]) {
      return { kind: 'registered', widget: widget as RegisteredWidgetKey };
    }
    if (isObjectForm(effective)) return { kind: 'nested-form', effective };
    const rows = objectRowSchema(effective);
    if (rows) return { kind: 'object-rows', effective, itemSchema: rows };
    if (!KNOWN_PASSTHROUGH_WIDGETS.has(widget)) return { kind: 'raw-json', hint: widget };
  }

  // 3. The builtin scalar chain. Each of these branches spreads the host id onto
  // its own labelable control, so they are all one face as far as naming goes.
  const effectiveType = effective?.type as string | undefined;
  const hasOptions = Array.isArray(fieldSpec?.options) && fieldSpec.options.length > 0;
  const hasEnum = Array.isArray(effective?.enum) && (effective.enum as unknown[]).length > 0;
  if (
    hasOptions ||
    hasEnum ||
    effectiveType === 'boolean' ||
    widget === 'switch' ||
    fieldSpec?.type === 'boolean' ||
    fieldSpec?.type === 'toggle' ||
    effectiveType === 'number' ||
    effectiveType === 'integer' ||
    effectiveType === 'string'
  ) {
    return { kind: 'scalar', effective };
  }
  if (effectiveType === 'array') {
    const itemsSchema = (effective?.items as JsonSchema | undefined) ?? {};
    if (
      itemsSchema.type === 'string' ||
      itemsSchema.type === 'number' ||
      itemsSchema.type === 'integer'
    ) {
      return { kind: 'scalar', effective };
    }
  }

  // 4. Structured fallback, then the last-resort JSON editor.
  if (isObjectForm(effective)) return { kind: 'nested-form', effective };
  const rows = objectRowSchema(effective);
  if (rows) return { kind: 'object-rows', effective, itemSchema: rows };
  return { kind: 'raw-json' };
}

/**
 * The naming channel each face needs — what `WIDGET_LABELLING` does for the
 * registry, for the paths that have no registry entry. Decided on the same
 * MEASURED basis (objectui#5039's ledger: real `SchemaForm` renders, both
 * states, does the `for` resolve and to a labelable element / what does the face
 * actually own).
 *
 * `'group'` — five of the six. `composite` and the recursive `nested-form` are
 * containers of independently labelled sub-rows: every labelable element inside
 * them is addressed by a SUB-field's own label, so the outer `for` had nothing of
 * its own to point at. `repeater` / `object-rows` / `record` own nothing but
 * auxiliary buttons — collapse, add, remove — in the editable state, and just the
 * collapse toggles when read-only. All five take the objectui#4788 container
 * shape: the label publishes its id, the container answers `aria-labelledby` on
 * a `role="group"`, and the `for` is dropped rather than left pointing at a
 * container it can neither activate nor name (objectui#3978/#4010).
 *
 * `'control'` — `raw-json`, MEASURED rather than assumed (objectui#5039 named
 * this the reading to confirm). `RawJsonEditor`'s face is exactly ONE labelable
 * element, a `<textarea>` no other label addresses, in every branch and both
 * states — `readOnly` only sets the attribute. Its `hostIdEl=NONE` reading was
 * the id never being PLUMBED to it, not a face that cannot hold one. Naming a
 * wrapper `role="group"` around a lone textarea instead would name the container
 * and leave the control the user actually types in anonymous, which is
 * objectui#4010's ruling in reverse. So the id reaches the textarea and the plain
 * `<label for>` channel is what this face gets.
 *
 * `'registered'` defers to the widget's own declaration — this function must not
 * second-guess objectui#4871's reviewed table. `'scalar'` is every builtin
 * branch, each of which already spreads the host id onto its own control.
 */
export function faceLabelling(face: FieldFace): WidgetLabelling {
  switch (face.kind) {
    case 'registered':
      return widgetLabelling(face.widget);
    case 'composite':
    case 'repeater':
    case 'record':
    case 'nested-form':
    case 'object-rows':
      return 'group';
    case 'raw-json':
    case 'scalar':
      return 'control';
  }
}

const CONDITION_FIELD_NAMES = new Set(['visible', 'hidden', 'disabled', 'condition', 'predicate']);
/**
 * Detect a CEL predicate field by NAME CONVENTION (`visible` / `hidden` /
 * `disabled` / `condition` / `*When`) so it renders the no-code
 * condition builder instead of a raw expression text box. No enum, and the
 * schema must admit a string — {@link admitsString} holds that veto and
 * documents why it looks through nested unions, why an empty schema is not
 * one, and why an empty schema the declaration MARKS as an erased string arm is
 * (objectui#9830).
 */
function detectConditionWidget(name: string, schema: JsonSchema | undefined): string | undefined {
  if (Array.isArray(schema?.enum)) return undefined;
  if (!admitsString(schema)) return undefined;
  if (CONDITION_FIELD_NAMES.has(name) || /When$/.test(name)) return 'condition';
  return undefined;
}

const SECRET_FIELD_NAME_RE = /(^|_)(secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|credential|private[_-]?key|passphrase)$/i;
/**
 * Detect a write-only credential field → the masked `secret` widget. The
 * reliable signals are `format: 'password'` (driver configSchemas use this) and
 * JSON-Schema `writeOnly: true`; a conservative NAME CONVENTION (secret / token
 * / apiKey / accessKey / clientSecret / credential / privateKey / passphrase)
 * is the secondary cue. So credential fields render masked + write-only on every
 * metadata type, without each spec pinning `widget: 'secret'`. Bare `password`
 * is intentionally NOT matched here (auth owns that field, one-way hashed).
 */
function detectSecretWidget(name: string, schema: JsonSchema | undefined): string | undefined {
  if (schema?.format === 'password' || (schema as { writeOnly?: boolean } | undefined)?.writeOnly === true) return 'secret';
  if (Array.isArray(schema?.enum)) return undefined;
  if (!admitsString(schema)) return undefined;
  if (SECRET_FIELD_NAME_RE.test(name)) return 'secret';
  return undefined;
}

/**
 * The widget a field renders with — ONE decision, reached by every layout
 * (objectui#9859).
 *
 * The five NAME-CONVENTION detectors above used to be spelled out inline in
 * `FieldRow`, which made the chain a property of THAT row component rather than
 * of the form engine. `RepeaterField`'s grid/table layout deliberately does not
 * go through `FieldRow` — a grid row has no `<label>`, so it names its cells
 * from the column header by IDREF instead (objectui#5063) — and it therefore
 * reached `FieldControl` with `inferWidget` alone. All five detectors were
 * skipped for every grid cell, `detectSecretWidget` included: the same property
 * in the same repeater rendered masked in the card layout and in the clear in
 * the grid one, with no warning and nothing an author could see.
 *
 * Adding a `detectSecretWidget` call to the grid branch would have closed that
 * one hole and left the next detector to be forgotten again, so the chain is
 * lifted out whole instead and both layouts call THIS. Same shape, and for the
 * same reason, as {@link resolveFieldFace}: one set of predicates, not two that
 * have to be kept in step.
 *
 * `resolveRegisteredWidget` is part of the lift, not an extra: it is what turns
 * a conditional widget name into the registration that actually renders
 * (objectui#4871), and `inferWidget` alone already yields `color-picker` for a
 * `type: 'color'` field — so a grid cell that skipped it landed on the swatch
 * `radiogroup` even where the free-colour input was the right face.
 */
function resolveFieldWidget({
  name,
  schema,
  fieldSpec,
  widgetContext,
}: {
  name: string;
  schema: JsonSchema | undefined;
  fieldSpec: FormFieldSpec | undefined;
  widgetContext?: WidgetContext;
}): string | undefined {
  let widget = inferWidget(fieldSpec, schema);
  // Field-reference props become object-field pickers when a field catalog
  // is available and the spec didn't pin an explicit widget.
  if (!fieldSpec?.widget) {
    const refWidget = detectFieldRefWidget(name, schema, widgetContext);
    if (refWidget) widget = refWidget;
    else {
      const secretWidget = detectSecretWidget(name, schema);
      if (secretWidget) widget = secretWidget;
      else {
        const iconWidget = detectIconWidget(name, schema);
        if (iconWidget) widget = iconWidget;
        else {
          const colorWidget = detectColorWidget(name, schema);
          if (colorWidget) widget = colorWidget;
          else {
            const condWidget = detectConditionWidget(name, schema);
            if (condWidget) widget = condWidget;
          }
        }
      }
    }
  }
  return resolveRegisteredWidget(widget, schema, fieldSpec);
}

/**
 * Read a visibility predicate off a spec node: `visibleWhen`, and only that.
 *
 * ADR-0089 renamed the FormView predicate `visibleOn` → `visibleWhen`, and
 * `@objectstack/spec` 18 retires the old spelling. A parsed `FormView` carries
 * `visibleWhen` and no `visibleOn` at all (`@objectstack/spec`
 * `shared/visibility.ts`). Reading only `visibleOn`, which this admin engine did
 * until `7a197e7c5`, found `undefined` on every spec-served form and
 * short-circuited each predicate to "always visible".
 *
 * The retired key is NOT read as a fallback (objectui#12696). Its last in-app
 * producer, the view anchor's create schema (`anchors.ts`), writes `visibleWhen`
 * now, and every authoring form the bundled spec ships carries `visibleWhen`
 * only. A layout that still spells `visibleOn` is shown unconditionally here,
 * exactly as the runtime form (`@object-ui/plugin-form` `sectionFields.ts`) and
 * the console form page treat it, so the designer preview cannot pass a
 * predicate that nothing else honours. Rename the key to `visibleWhen`.
 */
function readVisibility(
  node: { visibleWhen?: VisibilityPredicate } | undefined | null,
): VisibilityPredicate | undefined {
  return node?.visibleWhen;
}

export interface SchemaFormIssue {
  path: string;
  message: string;
}

export interface SchemaFormProps {
  /** JSONSchema for the root object. */
  schema: JsonSchema | undefined;
  /**
   * Ancestor id path this form is nested under. Two kinds of caller set it:
   *
   *  - the recursive render inside {@link FieldControl}, which passes the path
   *    of the field hosting this form (objectui#5062);
   *  - a host that mounts a SECOND form into a document that already has one,
   *    which passes an artificial ancestor SEGMENT to scope the whole instance
   *    (objectui#5092 — see {@link DRAWER_METADATA_ID_SCOPE}). The semantics
   *    are unchanged: it is still just an ancestor path.
   *
   * The PAGE-level form leaves it undefined, which is what keeps top-level ids
   * spelled `mdf-{field}`.
   */
  idPath?: string;
  /**
   * Optional FormView layout (sections, tabs, widget hints, visibleWhen)
   * shipped by the framework alongside `schema`. When present, fields
   * are grouped into sections and visibility predicates are honoured.
   */
  form?: FormViewSpec;
  /** Current form value. */
  value: Record<string, unknown> | undefined;
  /** Called with the next full value on every change. */
  onChange: (next: Record<string, unknown>) => void;
  /** Inline validation errors, keyed by JSON path. */
  issues?: SchemaFormIssue[];
  /** Field keys to hide (still preserved on save). */
  hiddenFields?: string[];
  /** Preferred top-level field order. */
  fieldOrder?: string[];
  /** Disable all inputs (e.g. when env-var write lock is off). */
  readOnly?: boolean;
  /**
   * True when rendering the "new record" form (no existing item).
   * Used by per-field `immutable: true` flag to allow editing on
   * create but lock the value once the record exists.
   */
  createMode?: boolean;
  /** Out-of-band data widgets need (object list, etc). */
  widgetContext?: WidgetContext;
}

function SchemaFormBody({
  schema,
  form,
  value,
  onChange,
  issues = [],
  hiddenFields = [],
  fieldOrder = [],
  readOnly = false,
  createMode = false,
  widgetContext,
  idPath,
}: SchemaFormProps) {
  // Live app locale (follows the i18next language, not just the browser) —
  // hoisted above the no-schema early return so the hook order is stable.
  const locale = useMetadataLocale();
  // The host shell's predicate scope (`ExpressionProvider` → `usePredicateScope`).
  // Hoisted here with `locale` so the hook order is stable across the early
  // returns below. `buildPredicateCtx` selects only the ADR-0068 identity roots
  // out of it and keeps `data` = the draft (objectui#6247).
  const hostScope = usePredicateScope();
  // No schema → synthesize one from the value's top-level keys so the
  // form renderer can still produce a structured, labelled view (with
  // proper read-only semantics) instead of falling back to a raw JSON
  // dump. This handles metadata types the framework hasn't yet shipped
  // a Zod schema for (`hook`, `trigger`, `validation`, etc.).
  //
  // Editable + truly unknown shape → keep the raw JSON editor as a
  // last resort, since we can't safely guess primitive types for
  // fields the user might add.
  // Hoisted above the schema-synthesis guard below so this hook runs on every
  // render (the guard can early-return a <RawJsonEditor/>).
  const issuesByPath = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const i of issues) {
      (map[i.path] ??= []).push(translateValidationMessage(i.message, locale));
    }
    return map;
  }, [issues, locale]);

  // objectui#9912 — follow the ONE indirection the served derivation uses
  // before any widget decision reads the node. Memoised for cost only: the
  // result is consumed as a VALUE, never as an identity (AGENTS.md #10).
  const derefSchema = React.useMemo(() => inlineSchemaRefs(schema), [schema]);

  let effectiveSchema: JsonSchema | undefined = derefSchema;
  if (!effectiveSchema || typeof effectiveSchema !== 'object') {
    if (value && typeof value === 'object') {
      effectiveSchema = inferSchemaFromValue(value as Record<string, unknown>);
    } else {
      return (
        <RawJsonEditor value={value} onChange={onChange} readOnly={readOnly} />
      );
    }
  }

  // objectui#11251 — a served schema whose TOP level is a union has no
  // `properties` of its own. The `view` type is served that way: the server
  // derives `ViewMetadataSchema`, an `anyOf` over the stored shapes (ViewItem,
  // `defineView` container, list / form overlay). Read as-is it yields zero
  // fields, the sectioned pre-flight below matches none of the served form, and
  // the flat fallback has zero keys: an empty editor for every stored view.
  // Resolve it against the value with the same resolver a union-typed FIELD
  // goes through (`repeaterItemSchema`, `resolveFieldFace`), so the form
  // describes the shape this body actually is. A schema that declares its own
  // `properties` beside a union is left as it is.
  if (
    effectiveSchema.properties === undefined &&
    Array.isArray(effectiveSchema.anyOf ?? effectiveSchema.oneOf)
  ) {
    effectiveSchema = resolveUnionBranch(effectiveSchema, value) ?? effectiveSchema;
  }

  // Resolve top-level object properties.
  const props = (effectiveSchema.properties ?? {}) as Record<string, JsonSchema>;
  const required: string[] = Array.isArray(effectiveSchema.required) ? effectiveSchema.required : [];
  // Per-property visibility predicate context — the current draft under
  // `data`, mirroring the sectioned form's field-level filtering. Lets a flat
  // (create) schema gate a field on a sibling value (e.g. show the list layout
  // picker only when `data.viewKind == 'list'`). No predicate → always shown.
  const predicateData = (value ?? {}) as Record<string, unknown>;
  const keys = orderKeys(Object.keys(props), fieldOrder)
    .filter((k) => !hiddenFields.includes(k))
    .filter((k) => {
      const visibility = readVisibility(props[k] as any);
      return !visibility || evaluatePredicate(visibility, buildPredicateCtx(predicateData, hostScope));
    });

  const v = value ?? {};

  function setField(key: string, fieldValue: unknown) {
    const next = { ...v, [key]: fieldValue };
    if (fieldValue === undefined || fieldValue === '') {
      delete (next as Record<string, unknown>)[key];
    }
    onChange(next);
  }

  // If the framework provided a FormView layout, render sections (tabbed
  // or simple). Otherwise fall through to the flat property list.
  //
  // Guard: when none of the fields declared by the layout actually exist
  // in the JSON schema (typically because the schema was reshaped under
  // a nested wrapper, e.g. `view` now bundles its props under
  // `list/form/listViews/formViews`), the layout would render a wall of
  // amber "missing from schema" warnings and nothing else. Detect that
  // total mismatch and fall through to the flat schema-driven
  // rendering so the user still gets a usable form.
  if (form?.sections?.length) {
    // Every read below — this pre-flight included, which is the one that threw
    // first — sees RESOLVED sections: a `{ group }` section has been through
    // `resolveSectionGroupReferences` and a section declaring neither member
    // source has been refused (objectui#8725).
    const sections = resolveFormSections(form);
    const declaredFields: string[] = [];
    for (const s of sections) {
      for (const f of s.fields) {
        declaredFields.push(typeof f === 'string' ? f : f.field);
      }
    }
    const matched = declaredFields.filter((f) => props[f]).length;
    const usable = declaredFields.length === 0 || matched > 0;
    if (usable) {
      return (
        <SectionedSchemaForm
          sections={sections}
          formType={form.type}
          props={props}
          idPath={idPath}
          required={required}
          hiddenFields={hiddenFields}
          issuesByPath={issuesByPath}
          value={v as Record<string, unknown>}
          readOnly={readOnly}
          createMode={createMode}
          widgetContext={widgetContext}
          onChange={setField}
        />
      );
    }
    if (typeof console !== 'undefined') {
      console.warn(
        '[SchemaForm] form layout declares no fields that exist in the schema; ' +
          'falling back to flat schema-driven rendering. Declared:',
        declaredFields,
        'Available:',
        Object.keys(props),
      );
    }
  }

  return (
    <div className="space-y-4">
      {keys.map((key) => (
        <FieldRow
          key={key}
          name={key}
          idPath={idPath}
          schema={props[key]}
          value={(v as Record<string, unknown>)[key]}
          required={required.includes(key)}
          issues={issuesByPath[key]}
          readOnly={readOnly}
          widgetContext={widgetContext}
          // Honor an explicit `widget` declared on a raw JSON-schema property
          // (e.g. createSchema's `object: { widget: 'ref:object' }`) so the
          // flat auto-form can use rich pickers, not just type inference.
          fieldSpec={(props[key] as any)?.widget ? { field: key, widget: (props[key] as any).widget } : undefined}
          formData={v as Record<string, unknown>}
          onChange={(val) => setField(key, val)}
        />
      ))}
    </div>
  );
}

/* ----- instance scoping (objectui#5092) ----------------------------------- */

/**
 * Scope segments for the SECOND `SchemaForm` a metadata-admin document can
 * host (objectui#5092).
 *
 * `MetadataDetailDrawer` is a Radix `Sheet`: when it opens, the page's own
 * form STAYS IN THE DOM behind it. Both forms render top-level fields, and
 * top-level ids are `mdf-{field}` with no instance dimension — so a field
 * name both forms have (`name`, `label`, `description` — nearly always) is
 * one id twice, and a `label[for]` resolves to the FIRST match in document
 * order, i.e. the PAGE form. The drawer's labels then name and focus the
 * controls of the form hidden behind the drawer.
 *
 * The fix is the ancestor path {@link joinIdPath} already threads: each
 * drawer-side mount point passes a scope segment as its form's `idPath`, so
 * its top-level fields become `mdf-{scope}.{field}`. The PAGE form passes
 * nothing and its ids are byte-for-byte what they always were — the selector
 * surface the metadata-admin tests read does not move (the same additive
 * contract objectui#5062 kept for nested rows).
 *
 * Requirements on a segment, and why these two satisfy them:
 *
 *  - **Distinct per mount point** — two scoped forms must not collide with
 *    each other either. Pinned by `SchemaForm.instanceIdScope.test.tsx`.
 *  - **Whitespace-free** — these ids are consumed as `aria-labelledby` IDREFs,
 *    which tokenize on whitespace (objectui#5062, `joinIdPath`).
 *  - **Cannot be spelled by a real field** — a segment equal to some top-level
 *    field name would let `mdf-{scope}.{field}` be reached from two different
 *    paths. Both segments contain `-`, which is outside the metadata
 *    machine-name grammar (`^[a-z][a-z0-9_]*$`) and outside the camelCase
 *    property names the metadata JSON-Schemas use.
 */
export const DRAWER_METADATA_ID_SCOPE = 'drawer-metadata';

/** @see DRAWER_METADATA_ID_SCOPE — the drawer's embedded-item editor. */
export const DRAWER_EMBEDDED_ITEM_ID_SCOPE = 'drawer-embedded-item';

/**
 * True inside any `SchemaForm`, so the OUTERMOST form of a subtree runs the
 * duplicate-id scan and the nested ones (a composite/repeater page mounts
 * dozens) do not repeat it.
 *
 * Per SUBTREE, not per document: the page form and the drawer's form are
 * siblings, so both are outermost and both scan. That is intended — the scan
 * is precisely what tells the two of them apart.
 */
const SchemaFormNestingContext = React.createContext(false);

/**
 * Defer validation DISPLAY until the author has touched the field
 * (`add10d8f9`).
 *
 * A CREATE form opens on an empty draft, so every required field already
 * fails `safeParse` before a single keystroke: `新建软件包` used to open with
 * two red `输入无效` lines the author did not cause, and then jumped a line
 * height per field as each one cleared — enough to make a click land on the
 * wrong control while filling the form top to bottom.
 *
 * What is deferred is the RED LINE, never the rule: `issues` still flows to
 * the host unchanged, so the submit button stays gated on exactly the same
 * validation it was gated on before. This is the mount→blur move the card
 * asks for, not a relaxation.
 *
 * Off for edit/view forms on purpose: there the issues describe values that
 * came out of storage, not something the author is mid-way through typing, so
 * hiding them until touched would hide a real diagnostic. Carried in context
 * rather than as a prop so a nested sub-form inside a create form inherits it
 * without `createMode` (which also drives `immutable` locking) leaking down.
 */
const DeferIssueDisplayContext = React.createContext(false);

const isDevBuild = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.NODE_ENV !== 'production';

/**
 * Dev-only: say out loud that two field host ids collide in this document.
 *
 * Scoping by mount point (above) relies on every host that mounts a SECOND
 * form remembering to pass a segment — a new mount point that forgets brings
 * the cross-wiring back SILENTLY, because a duplicate id is not an error to
 * the DOM and the association still resolves, just to the wrong element.
 * This is the half that makes that failure loud. Production is untouched:
 * the whole body is behind the dev gate, so the effect does no work.
 */
function useDuplicateFieldHostIdCheck(enabled: boolean): void {
  // Report a given collision set once per form instance instead of on every
  // keystroke; a fresh mount reports again, which is what makes it visible.
  const lastReported = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!enabled || !isDevBuild() || typeof document === 'undefined') return;
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[id^="mdf-"]'))) {
      const id = el.id;
      if (!seen.has(id)) seen.add(id);
      else if (!duplicates.includes(id)) duplicates.push(id);
    }
    const signature = duplicates.join(',');
    if (signature === lastReported.current) return;
    lastReported.current = signature;
    if (duplicates.length === 0) return;
    console.error(
      `[SchemaForm] duplicate field host id(s) in this document: ${duplicates.join(', ')}. ` +
        'Two SchemaForm instances are mounted at once — the metadata detail drawer sits on ' +
        'top of the page form, which stays in the DOM — and at least one of them renders ' +
        'unscoped top-level ids. A `label[for]` resolves to the FIRST match in the document, ' +
        "so the later form's labels name and focus the earlier form's controls " +
        '(objectui#5092). Give the secondary form a distinct `idPath` scope segment — see ' +
        'DRAWER_METADATA_ID_SCOPE / DRAWER_EMBEDDED_ITEM_ID_SCOPE in SchemaForm.tsx.',
    );
  });
}

/**
 * Renders a metadata form for `schema` (see {@link SchemaFormProps}).
 *
 * The wrapper exists for the two document-level concerns above: it marks the
 * subtree as "inside a SchemaForm" so nested forms know they are not the
 * outermost one, and it runs the dev-only duplicate-host-id check.
 */
export function SchemaForm(props: SchemaFormProps) {
  const nested = React.useContext(SchemaFormNestingContext);
  const inheritedDefer = React.useContext(DeferIssueDisplayContext);
  useDuplicateFieldHostIdCheck(!nested);
  // `add10d8f9` — a create form defers issue DISPLAY to first touch; a
  // nested form inherits whatever the form hosting it decided.
  const deferIssues = props.createMode === true || inheritedDefer;
  return (
    <SchemaFormNestingContext.Provider value={true}>
      <DeferIssueDisplayContext.Provider value={deferIssues}>
        <SchemaFormBody {...props} />
      </DeferIssueDisplayContext.Provider>
    </SchemaFormNestingContext.Provider>
  );
}

/* ----- sectioned layout (FormView spec) ---------------------------------- */

function normaliseField(f: string | FormFieldSpec): FormFieldSpec {
  return typeof f === 'string' ? { field: f } : f;
}

/**
 * A form section whose members are known: `fields` is present. Every read of a
 * section's `fields` in this module takes this type, never a raw
 * {@link FormSectionSpec}, so a `{ group }` section cannot reach a read without
 * first passing {@link resolveFormSections} (objectui#8725).
 */
type ResolvedFormSection = FormSectionSpec & { fields: Array<string | FormFieldSpec> };

function declaresMembers(s: FormSectionSpec): s is ResolvedFormSection {
  return Array.isArray(s.fields);
}

/**
 * Resolve a form's sections into ones with a member list (objectui#8725).
 *
 * `@objectstack/spec` lets a section declare its members one of two ways:
 * enumerate `fields`, or point `group` at a declared field group. A `{ group }`
 * section reaches this renderer on the `/meta/types` server document, which is
 * not validated on the way in, and before this function the first read of
 * `s.fields` threw `TypeError: s.fields is not iterable` out of the component
 * body, taking every well-formed sibling section with it.
 *
 * ⛔ No assembly rule is decided here. A `{ group }` section is resolved by
 * `@object-ui/plugin-form`'s `resolveSectionGroupReferences`, the one resolver
 * `ObjectForm` and `apps/console`'s `FormPage` already use, so this renderer
 * gives the same answer they give, including for a group that names no
 * declared field group: the section resolves EMPTY and the resolver reports the
 * dangling key on `console.error`.
 *
 * `objectDef` is `null` and `resolvable` is `false`, and that is a measurement,
 * not a default. A group resolves against the BOUND OBJECT's `fieldGroups`, and
 * nothing this component renders has one: its forms are metadata-type editors
 * (`data: { provider: 'schema', schemaId }`), the `/meta/types` entry carries a
 * `schema` and a `form` but no field groups, and no host hands this component an
 * object definition. `resolvable: false` is the resolver's own flag for "this
 * form can never load an object definition", so a `{ group }` section is
 * reported as unresolvable instead of being left to look like a load in flight.
 * If a host ever does hold a real object definition, it is passed here.
 *
 * ⛔ Not `?? []`. A section that declares NEITHER `fields` nor `group` is
 * refused by `FormSectionSchema` at parse ("A section must declare its members
 * exactly one way"), and the resolver leaves it untouched because it is not a
 * group reference. It is refused here too, out loud: rendering it as an empty
 * section would turn a malformed document into a silent drop.
 */
function resolveFormSections(form: FormViewSpec): ResolvedFormSection[] {
  const data = form.data;
  const schemaId = data && 'schemaId' in data ? data.schemaId : undefined;
  const resolved = (resolveSectionGroupReferences(
    // Two packages describing ONE authored document, exactly as in `FormPage`:
    // `FormSectionSpec` is this package's authoring type and `ObjectFormSection`
    // the plugin's. The parameter type is taken FROM the published signature,
    // so a change to it lands here as a compile error.
    form.sections as unknown as Parameters<typeof resolveSectionGroupReferences>[0],
    {
      objectName: schemaId ?? '',
      formType: form.type,
      objectDef: null,
      resolvable: false,
    },
  ) ?? []) as unknown as FormSectionSpec[];
  return resolved.map((s, index) => {
    if (declaresMembers(s)) return s;
    throw new TypeError(
      `[SchemaForm] form section ${index}${s.label ? ` ("${s.label}")` : ''} declares neither ` +
        '`fields` nor `group`. A section must declare its members exactly one way, and ' +
        "`@objectstack/spec`'s FormSectionSchema refuses this shape at parse: enumerate " +
        '`fields`, or point `group` at a declared field group.',
    );
  });
}

function SectionedSchemaForm({
  sections: resolvedSections,
  formType,
  props,
  required,
  hiddenFields,
  issuesByPath,
  value,
  readOnly,
  createMode,
  widgetContext,
  idPath,
  onChange,
}: {
  /** The form's sections, already through {@link resolveFormSections}. */
  sections: ResolvedFormSection[];
  formType: FormViewSpec['type'];
  props: Record<string, JsonSchema>;
  required: string[];
  hiddenFields: string[];
  issuesByPath: Record<string, string[]>;
  value: Record<string, unknown>;
  readOnly?: boolean;
  createMode?: boolean;
  widgetContext?: WidgetContext;
  /** Ancestor id path, forwarded from the hosting `SchemaForm` (#5062). */
  idPath?: string;
  onChange: (key: string, val: unknown) => void;
}) {
  const locale = useMetadataLocale();
  // The host shell's predicate scope (`ExpressionProvider` → `usePredicateScope`).
  // Hoisted here with `locale` so the hook order is stable across the early
  // returns below. `buildPredicateCtx` selects only the ADR-0068 identity roots
  // out of it and keeps `data` = the draft (objectui#6247).
  const hostScope = usePredicateScope();
  const sections = resolvedSections.filter((s) => {
    const visibility = readVisibility(s);
    return !visibility || evaluatePredicate(visibility, buildPredicateCtx(value, hostScope));
  });

  // Decide whether to render as tabs or stacked sections.
  const isTabbed = formType === 'tabbed' && sections.length > 1;

  const renderSection = (s: ResolvedFormSection, idx: number) => {
    const fields = s.fields
      .map(normaliseField)
      .filter((f) => {
        if (f.hidden) return false;
        if (hiddenFields.includes(f.field)) return false;
        const visibility = readVisibility(f);
        if (visibility && !evaluatePredicate(visibility, buildPredicateCtx(value, hostScope))) {
          return false;
        }
        return true;
      });
    if (fields.length === 0) return null;
    const cols = s.columns ?? 1;
    const fieldsGrid = (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          }}
        >
          {fields.map((f) => {
            const propSchema = props[f.field];
            if (!propSchema) {
              return (
                <div
                  key={f.field}
                  className="rounded border border-dashed border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300"
                  style={{ gridColumn: `span ${f.colSpan ?? 1}` }}
                >
                  {tFormat('engine.form.missingField', locale, { field: f.field })}
                </div>
              );
            }
            // The row schema's `title` takes the form label's UNTRANSLATED
            // source, never a locale overlay's translation (objectui#8231):
            // the translation reaches every reader through `fieldSpec.label`,
            // which each of them prefers over `title`, while `FieldRow`'s
            // machine-name chip falls back to `title` as the source label when
            // the form authored none — so copying a translation here would
            // hand the chip the very string it must not judge. With no
            // overlay involved the source IS `f.label`: nothing changes.
            const sourceTitle = untranslatedFieldLabel(f);
            return (
              <div
                key={f.field}
                style={{ gridColumn: `span ${f.colSpan ?? 1}` }}
              >
                <FieldRow
                  name={f.field}
                  idPath={idPath}
                  schema={{
                    ...propSchema,
                    ...(sourceTitle ? { title: sourceTitle } : {}),
                    ...(f.helpText ? { description: f.helpText } : {}),
                    ...(f.placeholder ? { placeholder: f.placeholder } : {}),
                  }}
                  value={value[f.field]}
                  required={f.required ?? required.includes(f.field)}
                  issues={issuesByPath[f.field]}
                  readOnly={readOnly || f.readonly || (f.immutable && !createMode)}
                  fieldSpec={f}
                  widgetContext={widgetContext}
                  formData={value}
                  onChange={(val) => onChange(f.field, val)}
                />
              </div>
            );
          })}
        </div>
    );

    // Collapsible section (FormSectionSpec.collapsible) — the spec marks
    // rarely-used groups (Advanced, type-specific options) collapsible and
    // often `collapsed: true`. Honour both so the panel opens lean and the
    // author expands only what they need. Non-collapsible sections render
    // as a plain bordered block (unchanged).
    if (s.collapsible && s.label) {
      return (
        <Collapsible
          key={idx}
          defaultOpen={!s.collapsed}
          className="rounded-md border border-border/40 bg-card/30"
        >
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 p-4 text-left">
            <span>
              <span className="block text-sm font-semibold text-foreground/90">
                {s.label}
              </span>
              {s.description && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {s.description}
                </span>
              )}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 px-4 pb-4">
            {fieldsGrid}
          </CollapsibleContent>
        </Collapsible>
      );
    }

    return (
      <section
        key={idx}
        className="space-y-3 rounded-md border border-border/40 bg-card/30 p-4"
      >
        {s.label && (
          <header>
            <h3 className="text-sm font-semibold text-foreground/90">
              {s.label}
            </h3>
            {s.description && (
              <p className="text-xs text-muted-foreground">{s.description}</p>
            )}
          </header>
        )}
        {fieldsGrid}
      </section>
    );
  };

  if (isTabbed) {
    const tabSections = sections.filter(
      (s) =>
        s.fields
          .map(normaliseField)
          .some((f) => {
            if (f.hidden) return false;
            if (hiddenFields.includes(f.field)) return false;
            const visibility = readVisibility(f);
            return !visibility || evaluatePredicate(visibility, buildPredicateCtx(value, hostScope));
          }),
    );
    if (tabSections.length === 0) return null;
    const defaultTab = (tabSections[0].label ?? 'section-0').toLowerCase();
    return (
      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="flex flex-wrap gap-1">
          {tabSections.map((s, i) => (
            <TabsTrigger
              key={i}
              value={(s.label ?? `section-${i}`).toLowerCase()}
            >
              {s.label ?? tFormat('engine.form.sectionN', locale, { n: i + 1 })}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabSections.map((s, i) => (
          <TabsContent
            key={i}
            value={(s.label ?? `section-${i}`).toLowerCase()}
            className="mt-4"
          >
            {renderSection(s, i)}
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  return <div className="space-y-4">{sections.map(renderSection)}</div>;
}

/* ----- id scoping (objectui#5062) ----------------------------------------- */

/**
 * Extend an ancestor id path with one more segment.
 *
 * DOM ids in this form are derived from the field's PATH, not from its local
 * name: `FieldRow` is called recursively (composite sub-rows, repeater card
 * rows, record items, the recursive `SchemaForm`), and two same-named
 * sub-fields under different parents used to build the same id
 * (`mdf-field` twice). A duplicate id is not a cosmetic problem here — a
 * `<label for>` resolves to the FIRST match in the document, so the second
 * field's label named and focused the first field's control: an association
 * that is present, closed-looking to tooling, and cross-wired (objectui#5062;
 * same failure class as the fixed-id collision objectui#3343 fixed in
 * `packages/fields`).
 *
 * A TOP-LEVEL field passes no parent and keeps its historical `mdf-{field}`
 * id — the selector surface the metadata-admin tests read stays exactly as it
 * was; only nested rows gain a prefix.
 *
 * Segments are machine names (schema property / form-spec field names) and
 * numeric row indices — the same class of input the flat `mdf-{field}` id
 * already carried, so the ids stay derivable from the data path and
 * whitespace-free for identifier-shaped names. Runtime user input is
 * deliberately NOT a segment: a `record` item contributes its INDEX, never its
 * author-typed key, which may contain spaces that an `aria-labelledby` IDREF
 * would tokenize into two references.
 */
function joinIdPath(parent: string | undefined, segment: string | number): string {
  return parent ? `${parent}.${segment}` : String(segment);
}

/** The host DOM id for a field at `path` — the `mdf-` namespace, path-scoped. */
function fieldHostId(path: string): string {
  return `mdf-${path}`;
}

/* ----- inner field row ---------------------------------------------------- */

function FieldRow({
  name,
  idPath,
  schema,
  value,
  required,
  issues,
  readOnly,
  fieldSpec,
  widgetContext,
  formData,
  onChange,
}: {
  name: string;
  /**
   * The path of this row's ANCESTOR field, or undefined at the top level
   * (objectui#5062). Each recursion point knows its own segment: a composite
   * passes its own path, a repeater card row appends the row index, a record
   * item appends the item index, and the recursive `SchemaForm` forwards the
   * path of the field that hosts it.
   */
  idPath?: string;
  schema: JsonSchema;
  value: unknown;
  required: boolean;
  issues?: string[];
  readOnly?: boolean;
  fieldSpec?: FormFieldSpec;
  widgetContext?: WidgetContext;
  formData?: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const locale = useMetadataLocale();
  // `add10d8f9` — validation-display timing. `touched` flips on the first
  // focusout anywhere in this row (React's onBlur IS focusout, so it bubbles
  // out of every widget, including the composite ones that never emit a DOM
  // change event) and on this field's own first edit. While a create form is
  // still untouched here, the row renders no error line — see
  // {@link DeferIssueDisplayContext} for why edit forms opt out.
  const deferIssues = React.useContext(DeferIssueDisplayContext);
  const [touched, setTouched] = React.useState(false);
  const markTouched = React.useCallback(() => setTouched(true), []);
  const visibleIssues = !deferIssues || touched ? issues : undefined;
  const handleChange = React.useCallback(
    (v: unknown) => {
      setTouched(true);
      onChange(v);
    },
    [onChange],
  );
  // A curated client `fieldSpec.label` always wins; otherwise localize the raw
  // schema title/description for known generic field names (e.g. the flow
  // edge/node sub-forms), falling back to the schema's own English text.
  const label =
    (fieldSpec?.label as string | undefined) ||
    translateSchemaFieldLabel(name, schema?.title as string | undefined, locale) ||
    prettify(name);
  const description =
    (fieldSpec?.helpText as string | undefined) ||
    translateSchemaFieldHelp(name, schema?.description as string | undefined, locale);
  // This row's own path — its id, and the ancestor path every nested row this
  // field renders builds on (objectui#5062).
  const path = joinIdPath(idPath, name);
  const id = fieldHostId(path);

  // Which widget renders — the shared decision, so a card row and a grid cell
  // holding the same property cannot resolve to different faces (objectui#9859).
  // It ends in `resolveRegisteredWidget`, so the registration is settled BEFORE
  // the label below declares how it will be named (objectui#4871).
  const widget = resolveFieldWidget({ name, schema, fieldSpec, widgetContext });

  // Which face `FieldControl` will render — resolved HERE, before the label, from
  // the same inputs it renders from (objectui#5039). The six paths that never
  // reach the `WIDGETS` registry (`composite` / `repeater` / `record` and the
  // three structural fallbacks) used to be decided inside `FieldControl`, i.e.
  // after this label was written, which is why they all emitted a dangling `for`.
  const face = resolveFieldFace({ fieldSpec, widget, schema, value });

  // How this field's visible label must reach what that face renders — a
  // DECLARATION either way, never an inference from the DOM it happens to
  // produce (objectui#4871, the vocabulary of `ComponentMeta.labelling`): the
  // registry's `labelling` for a registered widget, `faceLabelling` for the
  // structural faces that have no registry entry (objectui#5039).
  //
  //  - `'control'` — the face puts this `id` on a labelable element, so the
  //    label associates the plain way, `<label for>` → id.
  //  - `'group'` — no `<label for>` can reach the surface. The label publishes
  //    its OWN id, the face answers `aria-labelledby`, and the `for` is
  //    DROPPED: aimed at a container it activates nothing and names nothing,
  //    and leaving it beside the working channel is one label with two
  //    associations, one of them broken (the `form.tsx` `labelling: 'group'`
  //    branch, objectui#3961/#3978, and objectui#4010's refusal to relocate
  //    the id onto the radiogroup instead).
  const labelling = faceLabelling(face);
  const groupLabelled = labelling === 'group';
  // Whitespace-free by construction (`mdf-` + a dotted path of field names and
  // row indices — see `joinIdPath`), and consumed as an `aria-labelledby`
  // IDREF: a space in it would silently resolve to two ids.
  const labelId = groupLabelled ? `${id}-label` : undefined;
  // Exactly one of these two reaches the widget, ever.
  const channel = groupLabelled
    ? { id: undefined, ariaLabelledBy: labelId }
    : { id, ariaLabelledBy: undefined };
  const labelAssociation = groupLabelled ? { id: labelId } : { htmlFor: id };

  // Booleans with a schema default are never *missing* — don't show the
  // required asterisk (which would otherwise lie about user obligation).
  const isBoolean = schema?.type === 'boolean' || widget === 'switch';
  const hasDefault = schema?.default !== undefined;
  const showRequiredStar = required && !(isBoolean && hasDefault);
  // The `*` below is visual-only (objectui#3299, objectui#10367): it sits inside
  // the label that names the control, so without `aria-hidden` it is read as
  // part of the name ("Title *"). The requirement reaches the control as a
  // STATE instead — `FieldControl` takes this same flag, puts `aria-required`
  // on every control it renders itself, and hands the flag to a registered
  // widget, so the state and the marker agree.
  // `aria-required`, not native `required`: `SchemaForm` is exported, and a host
  // `<form>` would otherwise gain the browser's own submit-blocking verdict
  // beside this form's own validation.

  // The row shows the LABEL only (objectui#13352). The machine name is a
  // developer identifier: drawn inline beside the label it put `name` next to
  // "Display name" on every Setup form. It is offered on demand instead, as
  // the label's hover tooltip, and only when it materially differs from the
  // prettified label (e.g. `is_active` → "Is Active" matches, nothing to add;
  // `rls` → "Rls" doesn't, offer it).
  //
  // Judged against the UNTRANSLATED source label — the label this row would
  // show in English — never against `label` above (objectui#8231). The visible
  // label is a translation in a localized panel, and `prettify('columns')` can
  // never equal 「列数」, so the old comparison showed the chip beside every
  // field in Chinese and hid it beside the same fields in English. The source
  // label is the one a locale overlay replaced (`untranslatedFieldLabel`, in
  // `./field-source-label.ts`), else the schema's own title, else the
  // prettified name — the same chain as `label`, minus every translation
  // step, so the tooltip answers alike in every locale.
  const sourceLabel =
    untranslatedFieldLabel(fieldSpec) ||
    (schema?.title as string | undefined) ||
    prettify(name);
  const labelMatchesName = prettify(name).toLowerCase() === sourceLabel.toLowerCase();
  const machineNameHint = labelMatchesName
    ? undefined
    : `${t('engine.form.machineName', locale)}: ${name}`;

  // Booleans render inline (label · description · switch) on one row to
  // save vertical space and feel like a real settings panel.
  if (isBoolean) {
    return (
      <div className="flex items-start justify-between gap-3 py-1.5" onBlur={markTouched}>
        <div className="min-w-0 flex-1">
          <Label {...labelAssociation} className="text-sm font-medium cursor-pointer">
            {label}
            {showRequiredStar && (
              <span className="text-destructive ml-0.5" aria-hidden="true" data-required-marker="true">*</span>
            )}
          </Label>
          {description && (
            <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
          )}
          {visibleIssues?.map((m, i) => (
            <div key={i} data-testid="schema-form-issue" className="text-xs text-destructive mt-0.5">{m}</div>
          ))}
        </div>
        <FieldControl
          id={channel.id}
          ariaLabelledBy={channel.ariaLabelledBy}
          required={showRequiredStar}
          fieldName={name}
          idPath={path}
          schema={schema}
          value={value}
          onChange={handleChange}
          readOnly={readOnly}
          widget={widget}
          fieldSpec={fieldSpec}
          widgetContext={widgetContext}
          formData={formData}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5" onBlur={markTouched}>
      <div className="flex items-center justify-between gap-2">
        <Label
          {...labelAssociation}
          className="text-sm font-medium"
          title={machineNameHint}
          data-machine-name={machineNameHint ? name : undefined}
        >
          {label}
          {showRequiredStar && (
            <span className="text-destructive ml-0.5" aria-hidden="true" data-required-marker="true">*</span>
          )}
        </Label>
      </div>
      <FieldControl
        id={channel.id}
        ariaLabelledBy={channel.ariaLabelledBy}
        required={showRequiredStar}
        fieldName={name}
        idPath={path}
        schema={schema}
        value={value}
        onChange={handleChange}
        readOnly={readOnly}
        widget={widget}
        fieldSpec={fieldSpec}
        widgetContext={widgetContext}
        formData={formData}
      />
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
      {visibleIssues?.map((m, i) => (
        <div key={i} data-testid="schema-form-issue" className="text-xs text-destructive">
          {m}
        </div>
      ))}
    </div>
  );
}

function FieldControl({
  id,
  ariaLabelledBy,
  required,
  fieldName,
  idPath,
  schema,
  value,
  onChange,
  readOnly,
  widget,
  fieldSpec,
  widgetContext,
  formData,
}: {
  /**
   * The host field id. From `FieldRow` it is present only on the
   * `labelling: 'control'` channel and `undefined` on the `'group'` one
   * (objectui#4871): every builtin branch below renders a labelable element and
   * spreads it unconditionally, as does the JSON editor whose `<textarea>` is
   * exactly such an element (objectui#5039), while the `'group'` faces never
   * read it because `FieldRow` doesn't hand it to them.
   */
  id?: string;
  /**
   * An IDREF naming whatever this control renders.
   *
   * From `FieldRow` this is the host label's id on the `'group'` channel only,
   * and exactly one of `id` / `ariaLabelledBy` is ever defined — that mutual
   * exclusion is `FieldRow`'s rule about a LABEL, not a rule about this
   * component. A grid/table repeater cell has no `<label>` at all: its name is
   * the column header, reached by IDREF, while the id stays on the control as a
   * plain anchor. So a cell passes BOTH, and every branch below emits the IDREF
   * alongside the id rather than treating them as alternatives (objectui#5063).
   */
  ariaLabelledBy?: string;
  /**
   * Whether the host shows a required `*` for this field — `FieldRow`'s
   * `showRequiredStar`, or a grid column header's own marker (objectui#10367).
   * That `*` is `aria-hidden`, so this is the channel that announces the
   * requirement: every control this component renders ITSELF (the builtin
   * scalar chain and the JSON editor) carries `aria-required` from it, and a
   * REGISTERED widget receives it as `WidgetProps.required`, which each
   * `labelling: 'control'` widget except `filter-builder` (a plain `button`)
   * emits through `controlNaming`, and which `color-picker` puts on its
   * `radiogroup`.
   *
   * ⚠️ The structured faces (composite / repeater / record / nested form)
   * render a `role="group"`, where ARIA 1.2 does not support `aria-required`.
   */
  required?: boolean;
  /** Machine field name — keys enum-option localization (e.g. flow `type`). */
  fieldName?: string;
  /**
   * The PATH of the field this control renders (objectui#5062) — the ancestor
   * path for every nested row the structured faces below render. Distinct from
   * `fieldName`, which is the local segment and keys localization only.
   */
  idPath?: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  readOnly?: boolean;
  widget?: string;
  fieldSpec?: FormFieldSpec;
  widgetContext?: WidgetContext;
  formData?: Record<string, unknown>;
}) {
  const locale = useMetadataLocale();
  // The host shell's predicate scope (`ExpressionProvider` → `usePredicateScope`).
  // Hoisted here with `locale` so the hook order is stable across the early
  // returns below. `buildPredicateCtx` selects only the ADR-0068 identity roots
  // out of it and keeps `data` = the draft (objectui#6247).
  const hostScope = usePredicateScope();
  // WHICH face renders is not decided here — `resolveFieldFace` decides it, and
  // `FieldRow` already called it with these very inputs to pick the naming
  // channel (objectui#5039). Calling the same pure function again here, rather
  // than re-testing `fieldSpec.type` / the union-resolved schema inline, is what
  // makes the declaration and the DOM impossible to drift apart: there is one
  // set of branch predicates, not two that must be kept in step.
  const face = resolveFieldFace({ fieldSpec, widget, schema, value });
  // `undefined` when optional, so the attribute is omitted rather than "false".
  const ariaRequired = required ? true : undefined;

  // Composite/repeater are first-class structured types — render natively
  // with recursive FieldRow calls so all UI features (widgets, options,
  // visibility, readonly) work uniformly at every nesting level.
  // When `fields` is omitted, fall back to schema-derived sub-fields
  // (all schema.properties / items.properties) so authors don't have to
  // enumerate every sub-property by hand.
  if (face.kind === 'composite') {
    const fields =
      fieldSpec?.fields?.length
        ? fieldSpec.fields
        : derivePropertyNames(schema);
    return (
      <CompositeField
        value={value}
        fields={fields}
        schema={schema}
        readOnly={readOnly}
        widgetContext={widgetContext}
        fieldSpec={fieldSpec}
        ariaLabelledBy={ariaLabelledBy}
        idPath={idPath}
        onChange={onChange}
      />
    );
  }
  if (face.kind === 'repeater') {
    // The row schema may be nested inside a union (`anyOf` / `oneOf`) — e.g.
    // a View `sort` authored as `anyOf: [ string, {field,order}[] ]`. Reading
    // `schema.items` at the top level misses the array branch and renders a
    // blank row with no sub-fields (objectui#3379). `resolveFieldFace` resolved
    // to the array branch's items; hand RepeaterField a schema whose `items` is
    // that object schema, so both the derived field list and `pickSubSchema`
    // (per-row controls) see real sub-schemas.
    const itemSchema = face.itemSchema;
    const fields =
      fieldSpec?.fields?.length
        ? fieldSpec.fields
        : derivePropertyNames(itemSchema);
    return (
      <RepeaterField
        value={value}
        fields={fields}
        schema={{ ...schema, items: itemSchema }}
        readOnly={readOnly}
        widgetContext={widgetContext}
        widget={fieldSpec?.widget}
        ariaLabelledBy={ariaLabelledBy}
        idPath={idPath}
        onChange={onChange}
      />
    );
  }
  if (face.kind === 'record') {
    // Record<string, item> — name-keyed map. Insertion order is display
    // order. JSON Schema shape: { type:'object', additionalProperties: itemSchema }.
    const itemSchema = face.itemSchema;
    const fields =
      fieldSpec?.fields?.length
        ? fieldSpec.fields
        : derivePropertyNames(itemSchema);
    return (
      <RecordField
        value={value}
        fields={fields}
        schema={schema}
        readOnly={readOnly}
        widgetContext={widgetContext}
        widget={fieldSpec?.widget}
        keyField={(fieldSpec as any)?.keyField}
        formData={formData}
        ariaLabelledBy={ariaLabelledBy}
        idPath={idPath}
        onChange={onChange}
      />
    );
  }

  // Widget hint takes precedence: the registry first, then the structural
  // fallbacks, then JSON with an inline hint — all four already resolved.
  if (face.kind === 'registered') {
    const Renderer = WIDGETS[face.widget] as WidgetRenderer;
    return (
      <Renderer
        // Exactly one of these is defined, decided by the widget's own
        // `labelling` declaration in `FieldRow` (objectui#4871).
        id={id}
        ariaLabelledBy={ariaLabelledBy}
        // A `'control'` widget puts it on its control as `aria-required`,
        // through `controlNaming` (objectui#10367).
        required={required}
        schema={schema}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        context={widgetContext}
        fieldSpec={fieldSpec}
        formData={formData}
      />
    );
  }

  // Nested object schema with a `properties` map: recurse into a nested
  // SchemaForm so the user gets real labelled inputs instead of raw JSON.
  // Covers the auto-inferred `object-fields` widget that SchemaForm picks for
  // every `type: 'object'` schema, any custom widget name that wasn't
  // registered but still describes structured data, and the same shape reached
  // with no widget hint at all (a union whose object branch won).
  if (face.kind === 'nested-form') {
    return (
      // A container of independently labelled sub-rows: the host label names it
      // by IDREF and dropped its `for`, because every labelable element in here
      // belongs to a SUB-field's own label (objectui#5039, #4788's shape). The
      // inner `SchemaForm` publishes its own per-field channels, untouched — this
      // name is the outer field's, not theirs.
      <div className="rounded-md border border-border/40 bg-card/30 p-3" role="group" aria-labelledby={ariaLabelledBy}>
        <SchemaForm
          schema={face.effective}
          value={(value as Record<string, unknown>) ?? {}}
          onChange={(v) => onChange(v)}
          readOnly={readOnly}
          widgetContext={widgetContext}
          idPath={idPath}
        />
      </div>
    );
  }
  // Array-of-object schemas: route through RepeaterField so the user gets
  // per-row inputs rather than a JSON blob. Sub-field names come from the
  // union-resolved `items.properties`.
  if (face.kind === 'object-rows') {
    return (
      <RepeaterField
        value={value}
        fields={derivePropertyNames(face.itemSchema)}
        schema={{ ...face.effective, items: face.itemSchema }}
        readOnly={readOnly}
        widgetContext={widgetContext}
        widget={fieldSpec?.widget}
        ariaLabelledBy={ariaLabelledBy}
        idPath={idPath}
        onChange={onChange}
      />
    );
  }
  // Raw JSON — the announced fallback for an unregistered widget name (`hint`),
  // or the last resort for a shape no branch could type. Its `<textarea>` IS a
  // labelable element and takes the host id: this face is `labelling: 'control'`
  // (objectui#5039), so `id` is defined here whenever the host has a label.
  if (face.kind === 'raw-json') {
    if (face.hint) {
      return (
        <div className="space-y-1">
          <RawJsonEditor
            id={id}
            ariaLabelledBy={ariaLabelledBy}
            required={required}
            value={value as any}
            onChange={(v) => onChange(v)}
            readOnly={readOnly}
          />
          <div className="text-[10px] text-muted-foreground">
            {tFormat('engine.form.fallbackJson', locale, { widget: face.hint })}
          </div>
        </div>
      );
    }
    return (
      <RawJsonEditor id={id} ariaLabelledBy={ariaLabelledBy} required={required} value={value} onChange={onChange} readOnly={readOnly} small />
    );
  }

  // The builtin scalar chain. For schemas authored as `anyOf` / `oneOf` (e.g.
  // `width: anyOf[string, number]`, `sort: anyOf[string, array<obj>]`), the
  // outer schema's `type` / `enum` are undefined and every primitive branch
  // below would miss; `resolveFieldFace` already resolved the union against the
  // current value, so these checks run on the concrete branch.
  const effective = face.effective;
  const effectiveType = effective?.type as string | undefined;
  // Enum / Select — fieldSpec.options takes precedence over schema.enum.
  const options = fieldSpec?.options;
  const enumValues = (effective?.enum as unknown[] | undefined) ?? undefined;
  
  // ⚠️ The BRANCH condition reads the RAW list, deliberately (objectui#6247,
  // Fork B → B1). Testing the FILTERED length here is the trap: a field whose
  // every option is withdrawn would fall through this branch, then through
  // `enumValues`, and land on the `string → Input` tail — so "withdraw every
  // option" would render as a FREE-TEXT box, i.e. the exact opposite of the
  // narrowing the author wrote. The face stays a Select; only its CONTENT is
  // filtered, so an emptied set renders an empty picker.
  if (Array.isArray(options) && options.length > 0) {
    // Render from fieldSpec.options (Data.SelectOption[])
    return (
      <Select
        value={value == null ? '' : String(value)}
        onValueChange={(v) => onChange(v)}
        disabled={readOnly}
      >
        <SelectTrigger id={id} aria-labelledby={ariaLabelledBy} aria-required={ariaRequired}>
          <SelectValue placeholder={t('engine.form.selectEllipsis', locale)} />
        </SelectTrigger>
        <SelectContent>
          {visibleOptions(options, buildPredicateCtx(formData, hostScope)).map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
              {opt.color && (
                <span
                  className="ml-2 inline-block h-3 w-3 rounded"
                  style={{ backgroundColor: opt.color }}
                />
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    // Fallback to schema.enum
    return (
      <Select
        value={value == null ? '' : String(value)}
        onValueChange={(v) => onChange(v)}
        disabled={readOnly}
      >
        <SelectTrigger id={id} aria-labelledby={ariaLabelledBy} aria-required={ariaRequired}>
          <SelectValue placeholder={t('engine.form.selectEllipsis', locale)} />
        </SelectTrigger>
        <SelectContent>
          {enumValues.map((opt) => (
            <SelectItem key={String(opt)} value={String(opt)}>
              {translateEnumOption(fieldName ?? '', String(opt), locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Boolean → Switch (no redundant "true/false" text; the toggle state
  // already conveys the value).
  //
  // We must also honor `widget === 'switch'` (resolved by inferWidget from
  // `fieldSpec.type === 'boolean'` / `'toggle'`), because for composite
  // sub-fields the JSON schema fragment is often `{}` — the parent declares
  // `additionalProperties: true` and no per-property `properties`, so
  // `schema?.type` is undefined even though the form spec clearly marks
  // the sub-field as boolean. Without this, capability toggles inside the
  // Object editor's "Capabilities" section fell through to RawJsonEditor
  // and rendered as empty textareas.
  if (effectiveType === 'boolean' || widget === 'switch' || fieldSpec?.type === 'boolean' || fieldSpec?.type === 'toggle') {
    return (
      <Switch
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-required={ariaRequired}
        checked={!!value}
        onCheckedChange={(c) => onChange(c)}
        disabled={readOnly}
      />
    );
  }

  // Number / integer → numeric input with min/max from fieldSpec, falling back
  // to the JSON Schema's own bounds.
  //
  // objectui#8218 — two halves of the same complaint, both about a box that
  // shows nothing while the help text underneath describes a live value:
  //
  //  • The BOUNDS. Only `fieldSpec.min`/`.max` were read, and a spec-derived
  //    authoring form (`dashboardForm`, …) declares neither — the numbers live
  //    on the JSON Schema the same spec produced (`columns` is `minimum: 1,
  //    maximum: 24`). So the panel accepted a negative column count that the
  //    contract had already ruled out. Read the schema when the form is silent;
  //    the form still wins where it speaks.
  //  • The DEFAULT. An empty box read as "unknown" when it means "using the
  //    default". `schema.default` now greys in behind it, so empty says which
  //    value is in force. It is a PLACEHOLDER, not a value: nothing is written
  //    until the author types, so "leave it alone" stays distinguishable from
  //    "pin it to today's default" in the saved metadata.
  //
  // ⚠️ Scope of the second half at the current spec pin: `columns` / `gap` /
  // `refreshIntervalSeconds` carry NO `default` in `DashboardSchema` — "(default 12)"
  // exists only as prose in the description, and the 12 is applied by the
  // renderer. Those three boxes therefore stay empty until the spec declares
  // the defaults it documents; filed upstream rather than hard-coded here,
  // because a number this file invents is a second source of truth for a value
  // the contract owns.
  if (effectiveType === 'number' || effectiveType === 'integer') {
    const schemaNumber = (key: string): number | undefined => {
      const raw = (effective as Record<string, unknown> | undefined)?.[key];
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    };
    const min = fieldSpec?.min ?? schemaNumber('minimum');
    const max = fieldSpec?.max ?? schemaNumber('maximum');
    const step = schemaNumber('multipleOf');
    const defaultValue = schemaNumber('default');
    return (
      <Input
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-required={ariaRequired}
        type="number"
        value={value == null ? '' : String(value)}
        placeholder={defaultValue == null ? undefined : String(defaultValue)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(undefined);
          const n = effectiveType === 'integer' ? parseInt(raw, 10) : Number(raw);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
        readOnly={readOnly}
      />
    );
  }

  // String → Input (or Textarea if it looks long), with maxLength from fieldSpec.
  if (effectiveType === 'string') {
    const maxLength = fieldSpec?.maxLength;
    const long =
      effective?.format === 'multiline' ||
      effective?.contentMediaType === 'text/markdown' ||
      (typeof value === 'string' && value.length > 80);
    if (long) {
      return (
        <Textarea
          id={id}
          aria-labelledby={ariaLabelledBy}
          aria-required={ariaRequired}
          rows={4}
          value={(value as string | undefined) ?? ''}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value || undefined)}
          readOnly={readOnly}
        />
      );
    }
    return (
      <Input
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-required={ariaRequired}
        value={(value as string | undefined) ?? ''}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value || undefined)}
        readOnly={readOnly}
      />
    );
  }

  // Array of primitives → comma-separated tag editor (MVP).
  if (effectiveType === 'array') {
    const itemsSchema = (effective?.items as JsonSchema | undefined) ?? {};
    const isPrimitive =
      itemsSchema.type === 'string' ||
      itemsSchema.type === 'number' ||
      itemsSchema.type === 'integer';
    if (isPrimitive) {
      const arr = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <Input
          id={id}
          aria-labelledby={ariaLabelledBy}
          aria-required={ariaRequired}
          value={arr.map(String).join(', ')}
          placeholder={t('engine.form.arrayPlaceholder', locale)}
          onChange={(e) => {
            const raw = e.target.value;
            const parts = raw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            if (itemsSchema.type === 'number' || itemsSchema.type === 'integer') {
              onChange(parts.map((p) => Number(p)).filter((n) => Number.isFinite(n)));
            } else {
              onChange(parts);
            }
          }}
          readOnly={readOnly}
        />
      );
    }
  }

  // The structured fallbacks that used to be re-tested here — object-with-
  // properties → nested SchemaForm, array-of-object → RepeaterField, and the
  // last-resort JSON editor — are the `nested-form` / `object-rows` / `raw-json`
  // faces, returned above. `resolveFieldFace` keeps their precedence relative to
  // this scalar chain (structural checks come after it when there is no widget
  // hint, before it when there is), so the rendering order is unchanged; what is
  // gone is the second copy of the predicates.
  //
  // Unreachable by construction: a `'scalar'` face is returned only when one of
  // the branches above matches, and every one of them returns. The compiler can't
  // prove that correspondence, so this terminal stays — spelled as the same
  // `'control'`-channel JSON editor the `raw-json` face renders, so that if a
  // future edit did make it reachable the label channel would still be right.
  return (
    <RawJsonEditor id={id} ariaLabelledBy={ariaLabelledBy} required={required} value={value} onChange={onChange} readOnly={readOnly} small />
  );
}

/* ----- composite / repeater (embedded structured values) ----------------- */

/**
 * Resolve the JSONSchema fragment for a sub-field of a composite/repeater.
 * Looks under parent `schema.properties[subName]` (composite) or
 * `schema.items.properties[subName]` (repeater). Falls back to `{}`.
 */
function pickSubSchema(parent: JsonSchema | undefined, kind: 'composite' | 'repeater' | 'record', subName: string): JsonSchema {
  if (!parent) return {};
  let props: Record<string, JsonSchema> | undefined;
  if (kind === 'composite') {
    props = parent.properties as Record<string, JsonSchema> | undefined;
  } else if (kind === 'repeater') {
    props = (parent.items as JsonSchema | undefined)?.properties as Record<string, JsonSchema> | undefined;
  } else {
    // record: items live under additionalProperties.properties
    props = (parent.additionalProperties as JsonSchema | undefined)?.properties as Record<string, JsonSchema> | undefined;
  }
  return (props?.[subName] as JsonSchema) ?? {};
}

// Compact, human-readable summary of a composite value for the popover
// disclosure trigger — booleans show their field label when true, arrays show
// their entries, scalars show the value. Keeps the collapsed row informative.
function summariseComposite(obj: Record<string, unknown>, specs: FormFieldSpec[]): string {
  const parts: string[] = [];
  for (const spec of specs) {
    const v = obj[spec.field];
    if (v == null || v === '' || v === false) continue;
    const label = spec.label || spec.field;
    if (v === true) parts.push(label);
    else if (Array.isArray(v)) { if (v.length) parts.push(v.map((x) => (typeof x === 'object' && x ? ((x as any).field ?? (x as any).name ?? '') : String(x))).filter(Boolean).join(', ')); }
    else if (typeof v === 'object') parts.push(label);
    else parts.push(String(v));
  }
  return parts.join(' · ');
}

function CompositeField({
  value,
  fields,
  schema,
  readOnly,
  widgetContext,
  fieldSpec,
  ariaLabelledBy,
  idPath,
  onChange,
}: {
  value: unknown;
  fields: Array<string | FormFieldSpec>;
  schema: JsonSchema;
  readOnly?: boolean;
  widgetContext?: WidgetContext;
  fieldSpec?: FormFieldSpec;
  /**
   * The host label's id — this face is `labelling: 'group'` (objectui#5039).
   * Answered on the box, not on any inner control: every labelable element in
   * here is addressed by a SUB-field's own label.
   */
  ariaLabelledBy?: string;
  /** This composite's own path — the ancestor path of its sub-rows (#5062). */
  idPath?: string;
  onChange: (v: unknown) => void;
}) {
  const locale = useMetadataLocale();
  const obj = (value && typeof value === 'object' && !Array.isArray(value))
    ? (value as Record<string, unknown>)
    : {};
  const specs = fields.map(normaliseField);

  const rows = specs.map((spec) => {
    const subSchema = pickSubSchema(schema, 'composite', spec.field);
    return (
      <FieldRow
        key={spec.field}
        name={spec.field}
        idPath={idPath}
        schema={subSchema}
        value={obj[spec.field]}
        required={Boolean(spec.required)}
        readOnly={readOnly || spec.readonly}
        fieldSpec={spec}
        widgetContext={widgetContext}
        formData={obj}
        onChange={(v) => onChange({ ...obj, [spec.field]: v })}
      />
    );
  });

  // Progressive disclosure (Airtable parity): summary line + gear → popover.
  if (fieldSpec?.disclosure === 'popover') {
    const summary = summariseComposite(obj, specs);
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5"
        role="group"
        aria-labelledby={ariaLabelledBy}
      >
        <span className="text-sm text-muted-foreground truncate" title={summary}>
          {summary || (
            <span className="italic opacity-70">{t('engine.form.notConfigured', locale)}</span>
          )}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" aria-label={t('engine.form.configure', locale)} data-testid={`composite-popover-${fieldSpec.field}`}>
              <Settings2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3">
            {rows}
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-3" role="group" aria-labelledby={ariaLabelledBy}>
      {rows}
    </div>
  );
}

function RepeaterField({
  value,
  fields,
  schema,
  readOnly,
  widgetContext,
  widget,
  ariaLabelledBy,
  idPath,
  onChange,
}: {
  value: unknown;
  fields: Array<string | FormFieldSpec>;
  schema: JsonSchema;
  readOnly?: boolean;
  widgetContext?: WidgetContext;
  widget?: string;
  /**
   * The host label's id — this face is `labelling: 'group'` (objectui#5039).
   * Both layouts own only auxiliary buttons (collapse, add, remove) plus rows
   * that label themselves, so the name belongs on the list, not on a control.
   */
  ariaLabelledBy?: string;
  /**
   * This repeater's own path. Each ROW appends its index to it, so two rows —
   * and two repeaters carrying the same sub-field names — cannot build the same
   * id (objectui#5062).
   */
  idPath?: string;
  onChange: (v: unknown) => void;
}) {
  const locale = useMetadataLocale();
  const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const specs = fields.map(normaliseField);
  const [openIdx, setOpenIdx] = React.useState<number | null>(null);

  // Default to card layout (one fieldset per row). `widget: 'grid'` opts
  // into compact inline-table layout for short, atomic sub-fields.
  const useGrid = widget === 'grid' || widget === 'table';

  /**
   * Ids for the grid/table layout, path-scoped exactly like the card layout's
   * rows (objectui#5062), so the same data cell has the same id under either
   * layout and two repeaters carrying the same column names cannot collide.
   *
   * `cellId` replaces the flat `rep-{row}-{field}`, which was duplicated
   * verbatim by every other grid repeater in the form
   * (`DUPLICATES: ["rep-0-field"]`, measured).
   *
   * `columnHeaderId` names the `<th>` so the cells under it can point at it.
   * The `-col` suffix (rather than `FieldRow`'s `-label`) says what it is: one
   * header shared by a whole column, not one field's label — and it cannot be
   * confused with the label id of a row at the same path.
   */
  const cellId = (idx: number, field: string) => fieldHostId(joinIdPath(joinIdPath(idPath, idx), field));
  const columnHeaderId = (field: string) => `${fieldHostId(joinIdPath(idPath, field))}-col`;

  const update = (i: number, patch: Record<string, unknown>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => {
    const blank: Record<string, unknown> = {};
    specs.forEach((s) => { blank[s.field] = undefined; });
    onChange([...rows, blank]);
    setOpenIdx(rows.length);
  };

  // objectui#10239 — the rows are SCALARS. `repeaterItemSchema` resolves a
  // union-typed repeater against its first row, so a `view.columns` stored as
  // `['name', 'status']` lands on the array-of-string arm, and `items` here is
  // `{ type: 'string' }`. The object-row layouts below would still hand every
  // row the form's declared sub-fields: the card summary indexed a string by
  // sub-field name (`'name'.link` is `String.prototype.link`), and editing a
  // sub-field spread the string into `{"0":"n","1":"a",…,"field":"title"}`,
  // which neither arm accepts. So each row is ONE control over the row value
  // itself, and Add appends a scalar, keeping the array one the arm accepts.
  //
  // Only when there IS a row: an empty value resolves to the first arm by
  // declaration order, which is no evidence the author wants scalars, and its
  // first Add keeps giving the object row it always gave.
  const itemSchema = (schema.items as JsonSchema | undefined) ?? {};
  const itemType = itemSchema.type as string | undefined;
  const scalarItems =
    itemType === 'string' || itemType === 'number' || itemType === 'integer' || itemType === 'boolean';
  if (scalarItems && rows.length > 0) {
    const values = rows as unknown[];
    // A cleared text row stays a string: `undefined` would serialise as `null`.
    const replace = (i: number, v: unknown) =>
      onChange(values.map((r, idx) => (idx === i ? (v === undefined && itemType === 'string' ? '' : v) : r)));
    const addScalar = () => onChange([...values, itemType === 'string' ? '' : undefined]);
    return (
      <div className="space-y-2" role="group" aria-labelledby={ariaLabelledBy}>
        {values.map((row, idx) => {
          const rowPath = joinIdPath(idPath, idx);
          const rowId = fieldHostId(rowPath);
          // The row's control is named "HOST LABEL #n": the host label by IDREF,
          // as every other row of this group face is, plus its own ordinal.
          const ordinalId = `${rowId}-ordinal`;
          const isScalar = row === null || typeof row !== 'object';
          return (
            <div key={idx} className="flex items-center gap-2">
              <span id={ordinalId} className="w-8 shrink-0 text-xs text-muted-foreground">
                #{idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <FieldControl
                  id={rowId}
                  ariaLabelledBy={ariaLabelledBy ? `${ariaLabelledBy} ${ordinalId}` : ordinalId}
                  idPath={rowPath}
                  // A stray non-scalar row in a scalar list is shown as the JSON
                  // it is, never coerced into the scalar control.
                  schema={isScalar ? itemSchema : {}}
                  value={row}
                  readOnly={readOnly}
                  widgetContext={widgetContext}
                  onChange={(v) => replace(idx, v)}
                />
              </div>
              {!readOnly && (
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}
                  className="h-7 w-7 p-0" aria-label={t('engine.form.remove', locale)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={addScalar}>
            <Plus className="h-3.5 w-3.5 mr-1" /> {t('engine.form.addItem', locale)}
          </Button>
        )}
      </div>
    );
  }

  if (useGrid) {
    return (
      <div className="space-y-2" role="group" aria-labelledby={ariaLabelledBy}>
        <div className="overflow-x-auto rounded-md border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                {/*
                  The column name is written ONCE, here, and every cell below
                  points at it by IDREF (objectui#5063). Before, the name existed
                  only as this header's visible text: no `label`, no `id` to
                  reference, no `scope` — so each cell control had `label[for]`,
                  `aria-label` and `aria-labelledby` all absent and read out as an
                  unnamed edit box. Per-cell `aria-label` was the rejected
                  alternative: it copies the column name into every row and drifts
                  the moment a column is renamed.
                */}
                {specs.map((s) => (
                  <th
                    key={s.field}
                    id={columnHeaderId(s.field)}
                    scope="col"
                    className="px-2 py-1.5 text-left text-xs font-medium"
                  >
                    {s.label || prettify(s.field)}
                    {/* Visual-only (objectui#10367): every cell below is NAMED
                        by this header through `aria-labelledby`, so a bare `*`
                        here was read as part of each cell's name. The cells
                        carry the requirement as `aria-required` instead. */}
                    {s.required && (
                      <span className="text-destructive ml-0.5" aria-hidden="true" data-required-marker="true">*</span>
                    )}
                  </th>
                ))}
                {/* Row actions: no name to publish, but still a column header. */}
                {!readOnly && <th scope="col" className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={specs.length + 1} className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {t('engine.repeater.empty', locale)}
                </td></tr>
              )}
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t border-border/30 align-top">
                  {specs.map((s) => {
                    const sub = pickSubSchema(schema, 'repeater', s.field);
                    return (
                      <td key={s.field} className="p-1.5">
                        <FieldControl
                          id={cellId(idx, s.field)}
                          // This cell's only naming channel — there is no
                          // `<label>` in a grid row (objectui#5063).
                          ariaLabelledBy={columnHeaderId(s.field)}
                          // Mirrors the header's `*` exactly (objectui#10367).
                          required={Boolean(s.required)}
                          fieldName={s.field}
                          idPath={joinIdPath(joinIdPath(idPath, idx), s.field)}
                          schema={sub}
                          value={row?.[s.field]}
                          readOnly={readOnly || s.readonly}
                          // The SAME widget decision the card layout's
                          // `FieldRow` makes — detectors included, so a
                          // credential column is masked here too
                          // (objectui#9859).
                          widget={resolveFieldWidget({ name: s.field, schema: sub, fieldSpec: s, widgetContext })}
                          fieldSpec={s}
                          widgetContext={widgetContext}
                          formData={row}
                          onChange={(v) => update(idx, { [s.field]: v })}
                        />
                      </td>
                    );
                  })}
                  {!readOnly && (
                    <td className="p-1.5 text-right">
                      <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}
                        className="h-7 w-7 p-0" aria-label={t('engine.form.remove', locale)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="h-3.5 w-3.5 mr-1" /> {t('engine.form.add', locale)}
          </Button>
        )}
      </div>
    );
  }

  // Card layout — one collapsible fieldset per row.
  return (
    <div className="space-y-2" role="group" aria-labelledby={ariaLabelledBy}>
      {rows.length === 0 && (
        <div className="rounded-md border border-dashed border-border/50 px-3 py-4 text-center text-xs text-muted-foreground">
          {t('engine.list.empty', locale)}
        </div>
      )}
      {rows.map((row, idx) => {
        const isOpen = openIdx === idx;
        const summary = specs
          .map((s) => row?.[s.field])
          .find((v) => v != null && v !== '');
        return (
          <div key={idx} className="rounded-md border border-border/50 bg-muted/10">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border/30">
              <button
                type="button"
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                className="flex items-center gap-1.5 text-sm font-medium text-left flex-1 min-w-0"
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span className="truncate">#{idx + 1}{summary != null ? ` — ${String(summary)}` : ''}</span>
              </button>
              {!readOnly && (
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}
                  className="h-7 w-7 p-0" aria-label={t('engine.form.remove', locale)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {isOpen && (
              <div className="p-3 space-y-3">
                {specs.map((s) => {
                  const sub = pickSubSchema(schema, 'repeater', s.field);
                  return (
                    <FieldRow
                      key={s.field}
                      name={s.field}
                      idPath={joinIdPath(idPath, idx)}
                      schema={sub}
                      value={row?.[s.field]}
                      required={Boolean(s.required)}
                      readOnly={readOnly || s.readonly}
                      fieldSpec={s}
                      widgetContext={widgetContext}
                      formData={row}
                      onChange={(v) => update(idx, { [s.field]: v })}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1" /> {t('engine.form.addItem', locale)}
        </Button>
      )}
    </div>
  );
}

/* ----- RecordField — Record<string, item> editor -------------------------- */

/**
 * Editor for `type: 'record'` form fields. The value is a name-keyed map
 * (`Record<string, item>`) where insertion order is display order.
 *
 * Layout:
 *  - If `widget` matches a renderer in WIDGETS, delegate to it (e.g.
 *    `widget: 'airtable'` → AirtableTableWidget). The widget receives the
 *    Record value directly and is responsible for emitting a Record back.
 *  - Otherwise, fall back to an inline card list with a key column +
 *    per-row sub-fields, similar to RepeaterField's card layout.
 *
 * The key is mirrored into the item as a property (default name: 'name')
 * so downstream consumers can treat each item as self-describing.
 *
 * See ADR-0007.
 */
function RecordField({
  value,
  fields,
  schema,
  readOnly,
  widgetContext,
  widget,
  keyField,
  formData,
  ariaLabelledBy,
  idPath,
  onChange,
}: {
  value: unknown;
  fields: Array<string | FormFieldSpec>;
  schema: JsonSchema;
  readOnly?: boolean;
  widgetContext?: WidgetContext;
  widget?: string;
  /**
   * The host label's id — this face is `labelling: 'group'` (objectui#5039).
   * Answered on the card list, and forwarded to a delegated widget so the
   * declaration holds in BOTH of this face's shapes.
   */
  ariaLabelledBy?: string;
  /**
   * This record field's own path. Each item appends its INDEX in display order
   * — never its author-typed key, which is runtime user input and may contain
   * whitespace an IDREF would tokenize (objectui#5062, `joinIdPath`).
   */
  idPath?: string;
  keyField?: {
    field?: string;
    label?: string;
    placeholder?: string;
    helpText?: string;
    regex?: string;
    immutable?: boolean;
  };
  formData?: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const locale = useMetadataLocale();
  // The host shell's predicate scope (`ExpressionProvider` → `usePredicateScope`).
  // Hoisted here with `locale` so the hook order is stable across the early
  // returns below. `buildPredicateCtx` selects only the ADR-0068 identity roots
  // out of it and keeps `data` = the draft (objectui#6247).
  const hostScope = usePredicateScope();
  // State hoisted above every early return below (the widget delegation and the
  // specialized-editor branches) so hook order stays stable across renders.
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [pendingKey, setPendingKey] = React.useState('');
  const [keyError, setKeyError] = React.useState<string | null>(null);
  const [dragKey, setDragKey] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  // Delegate to a registered widget if the form spec asked for one
  // explicitly (e.g. `widget: 'airtable'`). The widget owns the entire UI.
  if (widget) {
    const Renderer = WIDGETS[widget as RegisteredWidgetKey] as WidgetRenderer | undefined;
    if (Renderer) {
      return (
        // The `id` channel is deliberately NOT handed down: a `record` field is
        // declared `labelling: 'group'`, so the host published its label's id and
        // dropped the `for` (objectui#5039). The IDREF is forwarded, because this
        // delegated widget IS what the record field renders — leaving it out is
        // what left this shape unnamed while objectui#4871 measured it and left
        // it alone.
        <Renderer
          ariaLabelledBy={ariaLabelledBy}
          schema={schema}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          context={widgetContext}
          fieldSpec={{ field: '', type: 'record', fields, widget } as any}
          formData={formData}
        />
      );
    }
  }

  // Inline fallback — card list with a key column + sub-fields.
  const keyProp = keyField?.field ?? 'name';
  const keyLabel = keyField?.label ?? prettify(keyProp);
  const keyRegex = keyField?.regex ? new RegExp(keyField.regex) : null;
  const keyImmutable = keyField?.immutable !== false; // default true
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, Record<string, unknown>>)
      : {};
  const entries = Object.entries(record);
  const specs = fields.map(normaliseField).filter((s) => s.field !== keyProp);

  const emit = (next: Record<string, Record<string, unknown>>) => onChange(next);

  const updateItem = (key: string, patch: Record<string, unknown>) => {
    const next: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of entries) {
      next[k] = k === key ? { ...v, ...patch } : v;
    }
    emit(next);
  };
  const removeItem = (key: string) => {
    const next: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of entries) {
      if (k !== key) next[k] = v;
    }
    emit(next);
  };
  const renameItem = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return;
    if (record[newKey]) {
      setKeyError(tFormat('engine.form.keyExists', locale, { key: newKey }));
      return;
    }
    if (keyRegex && !keyRegex.test(newKey)) {
      setKeyError(tFormat('engine.form.keyPattern', locale, { pattern: String(keyRegex) }));
      return;
    }
    const next: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of entries) {
      if (k === oldKey) {
        next[newKey] = { ...v, [keyProp]: newKey };
      } else {
        next[k] = v;
      }
    }
    setKeyError(null);
    emit(next);
  };
  const addItem = () => {
    const trimmed = pendingKey.trim();
    if (!trimmed) {
      setKeyError(t('engine.form.keyRequired', locale));
      return;
    }
    if (record[trimmed]) {
      setKeyError(tFormat('engine.form.keyExists', locale, { key: trimmed }));
      return;
    }
    if (keyRegex && !keyRegex.test(trimmed)) {
      setKeyError(tFormat('engine.form.keyPattern', locale, { pattern: String(keyRegex) }));
      return;
    }
    const blank: Record<string, unknown> = { [keyProp]: trimmed };
    specs.forEach((s) => { blank[s.field] = undefined; });
    emit({ ...record, [trimmed]: blank });
    setPendingKey('');
    setKeyError(null);
    setOpenKey(trimmed);
  };

  // Drag-to-reorder. We rebuild the Record with the new key order, since
  // insertion order = display order for `type: 'record'`. (dragKey/dropTarget
  // state is declared at the top of the component with the other hooks.)
  const reorder = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    const keys = entries.map(([k]) => k);
    const from = keys.indexOf(sourceKey);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    keys.splice(from, 1);
    keys.splice(to, 0, sourceKey);
    const next: Record<string, Record<string, unknown>> = {};
    for (const k of keys) next[k] = record[k];
    emit(next);
  };

  return (
    <div className="space-y-2" role="group" aria-labelledby={ariaLabelledBy}>
      {entries.length === 0 && (
        <div className="rounded-md border border-dashed border-border/50 px-3 py-4 text-center text-xs text-muted-foreground">
          {t('engine.list.empty', locale)}
        </div>
      )}
      {entries.map(([key, row], idx) => {
        const isOpen = openKey === key;
        const summary = specs
          .map((s) => row?.[s.field])
          .find((v) => v != null && v !== '');
        const isDropTarget = dropTarget === key && dragKey && dragKey !== key;
        return (
          <div
            key={key}
            className={`rounded-md border bg-muted/10 ${isDropTarget ? 'border-primary border-2' : 'border-border/50'}`}
            onDragOver={(e) => {
              if (!dragKey || readOnly) return;
              e.preventDefault();
              if (dropTarget !== key) setDropTarget(key);
            }}
            onDragLeave={() => {
              if (dropTarget === key) setDropTarget(null);
            }}
            onDrop={(e) => {
              if (!dragKey || readOnly) return;
              e.preventDefault();
              reorder(dragKey, key);
              setDragKey(null);
              setDropTarget(null);
            }}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border/30">
              {!readOnly && (
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragKey(key);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', key);
                  }}
                  onDragEnd={() => { setDragKey(null); setDropTarget(null); }}
                  className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
                  aria-label={t('engine.form.dragToReorder', locale)}
                  title={t('engine.form.dragToReorder', locale)}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
              )}
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? null : key)}
                className="flex items-center gap-1.5 text-sm font-medium text-left flex-1 min-w-0"
              >
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted/60">{key}</span>
                {summary != null && <span className="truncate text-muted-foreground">— {String(summary)}</span>}
              </button>
              {!readOnly && (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(key)}
                  className="h-7 w-7 p-0" aria-label={t('engine.form.remove', locale)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {isOpen && (
              <div className="p-3 space-y-3">
                <FieldRow
                  name={keyProp}
                  idPath={joinIdPath(idPath, idx)}
                  schema={{ type: 'string' }}
                  value={key}
                  required
                  readOnly={readOnly || keyImmutable}
                  fieldSpec={{ field: keyProp, type: 'text', label: keyLabel, helpText: keyField?.helpText }}
                  widgetContext={widgetContext}
                  formData={row}
                  onChange={(v) => renameItem(key, String(v ?? '').trim())}
                />
                {specs.map((s) => {
                  const visibility = readVisibility(s);
                  if (visibility && !evaluatePredicate(visibility, buildPredicateCtx(row, hostScope))) return null;
                  const sub = pickSubSchema(schema, 'record', s.field);
                  return (
                    <FieldRow
                      key={s.field}
                      name={s.field}
                      idPath={joinIdPath(idPath, idx)}
                      schema={sub}
                      value={row?.[s.field]}
                      required={Boolean(s.required)}
                      readOnly={readOnly || s.readonly}
                      fieldSpec={s}
                      widgetContext={widgetContext}
                      formData={row}
                      onChange={(v) => updateItem(key, { [s.field]: v })}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Input
            value={pendingKey}
            onChange={(e) => { setPendingKey(e.target.value); if (keyError) setKeyError(null); }}
            placeholder={keyField?.placeholder ?? keyLabel}
            className="h-8 text-xs font-mono max-w-[220px]"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
          />
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="h-3.5 w-3.5 mr-1" /> {t('engine.form.add', locale)}
          </Button>
          {keyError && <span className="text-xs text-destructive">{keyError}</span>}
        </div>
      )}
    </div>
  );
}


/* ----- raw JSON fallback -------------------------------------------------- */

function RawJsonEditor({
  id,
  ariaLabelledBy,
  required,
  value,
  onChange,
  readOnly,
  small,
}: {
  /**
   * The host field id, when this editor is a field's control. It goes on the
   * `<textarea>` — the one labelable element this face renders, in every branch
   * and both states — which is why the face is declared `labelling: 'control'`
   * rather than wrapped in a named group (objectui#5039). Absent when
   * `SchemaForm` renders this as the whole-form fallback, where there is no host
   * label to associate.
   */
  id?: string;
  /**
   * An IDREF that names the `<textarea>` when the host has no `<label for>` to
   * give it — a grid/table repeater cell, named by its column header
   * (objectui#5063).
   */
  ariaLabelledBy?: string;
  /** The host's required flag, announced as `aria-required` (objectui#10367). */
  required?: boolean;
  value: unknown;
  onChange: (v: any) => void;
  readOnly?: boolean;
  small?: boolean;
}) {
  const locale = useMetadataLocale();
  const [text, setText] = React.useState<string>(() =>
    safeStringify(value),
  );
  const [error, setError] = React.useState<string | null>(null);

  // Re-sync when external value changes (e.g. Reset Overlay).
  React.useEffect(() => {
    setText(safeStringify(value));
    setError(null);
  }, [JSON.stringify(value)]); // intentional: stringify-deep-equal

  return (
    <div className="space-y-1">
      <Textarea
        id={id}
        aria-labelledby={ariaLabelledBy}
        aria-required={required ? true : undefined}
        rows={small ? 4 : 12}
        className="font-mono text-xs"
        value={text}
        readOnly={readOnly}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(next);
            setError(null);
            onChange(parsed);
          } catch (err: any) {
            setError(err?.message ?? t('engine.form.invalidJson', locale));
          }
        }}
      />
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}

/**
 * Synthesize a minimal JSON Schema by introspecting a runtime value.
 *
 * Used as the fallback when the framework hasn't shipped a Zod schema
 * for a metadata type (e.g. `hook`, `trigger`, `validation`). The
 * resulting schema lets `SchemaForm` render a real labelled form
 * (respecting `readOnly`) instead of bailing out to a raw JSON dump.
 *
 * Types are guessed conservatively from the value: scalars become
 * `string` / `number` / `boolean`; arrays of strings become string
 * tags; arrays of objects become master-detail tables; objects become
 * nested JSON regions. Anything indeterminate falls back to `string`
 * so the field still renders.
 */
function inferSchemaFromValue(value: Record<string, unknown>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('_')) continue;
    if (v === null || v === undefined) {
      properties[k] = { type: 'string' };
    } else if (typeof v === 'string') {
      properties[k] = v.length > 80 || v.includes('\n')
        ? { type: 'string', format: 'multiline' }
        : { type: 'string' };
    } else if (typeof v === 'number') {
      properties[k] = { type: Number.isInteger(v) ? 'integer' : 'number' };
    } else if (typeof v === 'boolean') {
      properties[k] = { type: 'boolean' };
    } else if (Array.isArray(v)) {
      if (v.length > 0 && typeof v[0] === 'string') {
        properties[k] = { type: 'array', items: { type: 'string' } };
      } else if (v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
        const sample = v[0] as Record<string, unknown>;
        const itemProps: Record<string, JsonSchema> = {};
        for (const key of Object.keys(sample)) {
          itemProps[key] = { type: 'string' };
        }
        properties[k] = {
          type: 'array',
          items: { type: 'object', properties: itemProps },
        };
      } else {
        properties[k] = { type: 'array', items: { type: 'string' } };
      }
    } else if (typeof v === 'object') {
      properties[k] = { type: 'object', additionalProperties: true };
    } else {
      properties[k] = { type: 'string' };
    }
  }
  return { type: 'object', properties, additionalProperties: true };
}

/* ----- helpers ------------------------------------------------------------ */

function safeStringify(v: unknown): string {
  if (v === undefined) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function prettify(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function orderKeys(keys: string[], preferred: string[]): string[] {
  if (!preferred.length) return keys;
  const set = new Set(keys);
  const head = preferred.filter((k) => set.has(k));
  const tail = keys.filter((k) => !preferred.includes(k));
  return [...head, ...tail];
}

/**
 * Derive a fields[] list for `composite` / `repeater` from a JSON schema.
 * Used when the form author hasn't explicitly enumerated sub-fields.
 */
function derivePropertyNames(schema: JsonSchema | undefined): string[] {
  const props = (schema?.properties ?? {}) as Record<string, unknown>;
  return Object.keys(props);
}
