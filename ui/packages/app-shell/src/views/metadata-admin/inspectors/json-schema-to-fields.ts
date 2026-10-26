// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * json-schema-to-fields — adapt an engine-published config JSON Schema into the
 * inspector's {@link FlowConfigField} model, so the flow designer renders a
 * node's property form **from the server** rather than a hardcoded client form.
 *
 * The automation engine owns each node type's config contract: built-in node
 * packs and plugins publish an `ActionDescriptor` whose `configSchema` is the
 * JSON Schema compiled from the executor's Zod (ADR-0018 §configSchema). The
 * approval plugin (ADR-0019) is the first to publish one. Driving the inspector
 * from that schema keeps the property form in lock-step with what the running
 * backend actually validates — when a plugin evolves its config, the designer
 * updates with no client release.
 *
 * We map onto `FlowConfigField[]` (rather than rendering JSON Schema directly)
 * so the existing, polished field widgets — select, boolean, the `objectList`
 * repeater (e.g. approvers), the optional Advanced-JSON escape hatch — are
 * reused unchanged. Anything the mapping can't express (deeply nested objects,
 * unions, an untyped property) is left off the mapped list; it stays editable in
 * the Advanced block, unless the offline table edits that key, whose editor
 * then stands in for it (`mergeServerFlowFields`, objectui#11788).
 *
 * Scope mirrors what `z.toJSONSchema` emits for real node configs:
 *   • string                      → text  (enum → select; an `xExpression:
 *                                   'expression'` marker makes it a CEL expression)
 *   • number / integer            → number
 *   • boolean                     → boolean
 *   • array of string             → stringList
 *   • array of number / integer   → numberList
 *   • array of object             → objectList (columns from item props; an item
 *                                   prop that is itself an array of string /
 *                                   number / object becomes a nested list column
 *                                   — a repeater-in-repeater, not a text cell;
 *                                   a number / integer item prop becomes a
 *                                   number column, as at the top level)
 *   • object with fixed `properties`
 *                                 → flattened sub-fields under config.<key>.*
 *                                   (a nested `enabled: boolean` makes the
 *                                    group's other fields reveal when enabled)
 *   • object with `additionalProperties` (a free-form string-keyed map, no fixed
 *     properties)                 → keyValue (the flat `{ var: value }` editor,
 *                                   e.g. CRUD `fields`/`filter`, assignments)
 */

import type { FlowConfigField, FlowConfigColumn, FlowConfigFieldKind, FlowReferenceSpec, ReferenceKind, RefValueSource } from './flow-node-config.js';

/** Loose JSON Schema node shape — we only read the keys we map. */
interface JsonSchemaNode {
  type?: string | string[];
  enum?: unknown[];
  /**
   * Enum members that still parse but must not be offered for new authoring
   * (`@objectstack/spec` `.meta({ xEnumDeprecated })`). We drop them from the
   * select's options while leaving them valid: a stored value keeps rendering,
   * the designer just stops handing authors the deprecated spelling. Without
   * this, a backward-compatible alias in the spec enum reappears in every
   * picker derived from it — e.g. the approver `role` trap (ADR-0090 D3).
   */
  xEnumDeprecated?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  title?: string;
  format?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  /**
   * Value schema (or `true`) for a free-form string-keyed map — the JSON-Schema
   * idiom for "an object of arbitrary keys". With no fixed `properties`, such an
   * object maps to the flat `keyValue` editor (e.g. a CRUD node's `fields` /
   * `filter`, an assignment's `assignments`, a connector's `input`). `false`
   * (closed object) is treated as absent.
   */
  additionalProperties?: boolean | JsonSchemaNode;
  /**
   * Reference annotation carried from the executor's Zod `.meta({ xRef })`
   * (ADR-0018). Marks a string as a typed reference so the inspector renders a
   * picker instead of free text. Either static (`kind`) or **polymorphic**
   * (`kindFrom` + `map`): the concrete kind is chosen at render time from a
   * sibling field/column value (e.g. an approver's `value` follows its `type`).
   */
  xRef?: {
    kind?: string;
    objectSource?: string;
    kindFrom?: string;
    map?: Record<string, string>;
    /**
     * Per-discriminator data contract (objectstack-ai/objectstack#3508 follow-up): where each
     * kind's candidates live and which column the picker commits. `map` names
     * only a picker KIND, which is how this package came to query the metadata
     * REGISTRY for data records; with `sources` the designer reads the answer
     * off the schema instead of mirroring it locally.
     */
    sources?: Record<string, unknown>;
  };
  /**
   * Authoring-semantics marker carried from the executor's Zod
   * `.meta({ xExpression })` (ADR-0018), on a string property. `'expression'`
   * declares a bare-CEL string (a predicate / value expression), so the designer
   * renders the expression editor (mono styling, bare-reference picker, the CEL
   * brace-trap) instead of guessing from the field name. Any other value
   * degrades to a plain text box: a `'value'` slot is rendered from the spec's
   * expression ledger whatever its descriptor field is, and the single-brace
   * `'template'` marker is retired with its dialect (objectui#12329).
   */
  xExpression?: unknown;
}

const REFERENCE_KINDS: ReadonlySet<string> = new Set<ReferenceKind>([
  'object',
  'object-field',
  'flow',
  'org-membership-level',
  'position',
  'node',
  'user',
  'team',
  'queue',
  'department',
  // Auto-resolved approver (submitter's manager) — renders as a disabled
  // cell, not a picker (objectstack-ai/objectstack#3508). Listed so the spec's xRef map entry
  // survives validation; an older designer without it just degraded to text.
  'manager',
  'connector',
  'email-template',
]);

/**
 * Validate one `xRef.sources` entry. An entry the designer cannot act on is
 * DROPPED rather than half-trusted: a `data` source missing its object or
 * committed column — or a `registry` source missing its metadata type — would
 * produce a picker that queries nothing, which is the failure this annotation
 * exists to end (framework#3508). A dropped entry simply leaves the consumer on
 * its local fallback.
 *
 * `registry` (objectstack#22710, objectui#7611 Q3b) is read here, not dropped:
 * a server on that spec binds `position` to it, and dropping it sent the
 * picker back to the local fallback — under the installed spec a lookup over
 * `sys_position` rows, a mirror a fresh environment leaves empty.
 */
function sourceOf(raw: unknown): RefValueSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  if (s.source === 'data') {
    return typeof s.object === 'string' && s.object && typeof s.valueField === 'string' && s.valueField
      ? { source: 'data', object: s.object, valueField: s.valueField }
      : undefined;
  }
  if (s.source === 'registry') {
    return typeof s.type === 'string' && s.type ? { source: 'registry', type: s.type } : undefined;
  }
  if (s.source === 'enum') {
    const values = Array.isArray(s.values) ? s.values.filter((v): v is string => typeof v === 'string') : [];
    return values.length ? { source: 'enum', values } : undefined;
  }
  if (s.source === 'auto' || s.source === 'trigger-field' || s.source === 'expression' || s.source === 'unsupported') {
    return { source: s.source };
  }
  return undefined;
}

/** Read the per-discriminator data contract, or undefined when none survives. */
function sourcesOf(raw: unknown): Record<string, RefValueSource> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, RefValueSource> = {};
  for (const [disc, entry] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = sourceOf(entry);
    if (parsed) out[disc] = parsed;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Read a valid `xRef` annotation off a schema node, or undefined. Accepts both
 * the static shape (`{ kind }`) and the polymorphic shape (`{ kindFrom, map }`),
 * validating every referenced kind against {@link REFERENCE_KINDS} so an unknown
 * kind degrades to free text rather than a broken picker.
 */
function refOf(node: JsonSchemaNode): FlowReferenceSpec | undefined {
  const x = node.xRef;
  if (!x || typeof x !== 'object') return undefined;
  const objectSource = typeof x.objectSource === 'string' && x.objectSource ? { objectSource: x.objectSource } : {};

  // Polymorphic: kindFrom + a map of discriminator value → kind.
  if (typeof x.kindFrom === 'string' && x.kindFrom && x.map && typeof x.map === 'object') {
    const map: Record<string, ReferenceKind> = {};
    for (const [disc, kind] of Object.entries(x.map)) {
      if (typeof kind === 'string' && REFERENCE_KINDS.has(kind)) map[disc] = kind as ReferenceKind;
    }
    if (Object.keys(map).length === 0) return undefined;
    // `sources` is optional and additive: a server that predates it simply
    // leaves the consumer on its local fallback (framework#3508 follow-up).
    const sources = sourcesOf(x.sources);
    return { kindFrom: x.kindFrom, map, ...objectSource, ...(sources ? { sources } : {}) };
  }

  // Static: a single concrete kind.
  if (typeof x.kind === 'string' && REFERENCE_KINDS.has(x.kind)) {
    return { kind: x.kind as ReferenceKind, ...objectSource };
  }
  return undefined;
}

/** "approvalStatusField" → "Approval Status Field"; "approve" → "Approve". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return key;
  return spaced
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function isObject(v: unknown): v is JsonSchemaNode {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The JSON Schema `type`, normalized to a single string (first non-null of a union). */
function schemaType(node: JsonSchemaNode): string | undefined {
  if (Array.isArray(node.type)) return node.type.find((t) => t !== 'null');
  if (typeof node.type === 'string') return node.type;
  // Infer from shape when `type` is omitted (common with enum-only schemas).
  if (Array.isArray(node.enum)) return 'string';
  if (node.properties) return 'object';
  if (node.items) return 'array';
  return undefined;
}

/**
 * Build `{ value, label }` options from a string enum, minus any member the
 * schema marks deprecated ({@link JsonSchemaNode.xEnumDeprecated}).
 */
function enumOptions(values: unknown[], deprecated?: unknown[]): Array<{ value: string; label: string }> {
  const skip = new Set((deprecated ?? []).filter((v): v is string => typeof v === 'string'));
  return values
    .filter((v): v is string => typeof v === 'string')
    .filter((v) => !skip.has(v))
    .map((v) => ({ value: v, label: humanizeKey(v) }));
}

/** Default coerced to the string form the inspector's `defaultValue` expects. */
function defaultString(node: JsonSchemaNode): string | undefined {
  if (node.default === undefined || node.default === null) return undefined;
  if (typeof node.default === 'boolean') return String(node.default);
  if (typeof node.default === 'number') return String(node.default);
  if (typeof node.default === 'string') return node.default;
  return undefined;
}

/**
 * Read a valid `xExpression` marker off a schema node, or undefined. The engine
 * publishes this on a string property (Zod `.meta({ xExpression })`, ADR-0018)
 * to declare its authoring semantics; `'expression'` (bare CEL, a predicate /
 * value expression) is the one that picks an editor here.
 *
 * Any other value degrades to undefined, so the string renders as a plain text
 * box rather than a mis-moded editor. That includes `'template'`
 * (objectui#12329): it marked a string read in the single-brace dialect, which
 * objectstack#19939 S7 deleted, and the installed spec publishes it nowhere (its
 * loop / map `collection` is marked `'value'` now). Mapping it to a picker
 * would offer a token no flow string reads.
 */
function exprModeOf(node: JsonSchemaNode): 'expression' | undefined {
  return node.xExpression === 'expression' ? 'expression' : undefined;
}

/**
 * Scalar (non-object, non-array) → field kind, plus an optional data-picker
 * `refMode` when the schema marks the string as an expression surface
 * ({@link exprModeOf}). Enum still wins (→ select). String mapping:
 *   • xExpression 'expression'  → expression (bare CEL, predicate-validated);
 *                                 multiline → textarea + refMode 'expression'
 *                                 (script-body mode — bare refs, no predicate check)
 *   • plain string (any other marker) → text; multiline → textarea: a literal,
 *                                 with no picker
 */
function scalarField(
  node: JsonSchemaNode,
): { kind: FlowConfigFieldKind; refMode?: 'expression' } | undefined {
  if (Array.isArray(node.enum)) return { kind: 'select' };
  const t = schemaType(node);
  if (t === 'boolean') return { kind: 'boolean' };
  if (t === 'number' || t === 'integer') return { kind: 'number' };
  if (t === 'string') {
    const multiline = node.format === 'multiline';
    const mode = exprModeOf(node);
    if (mode === 'expression') {
      return multiline ? { kind: 'textarea', refMode: 'expression' } : { kind: 'expression' };
    }
    return { kind: multiline ? 'textarea' : 'text' };
  }
  return undefined;
}

/**
 * Recursion budget for nested `objectList` columns (array-of-objects nested
 * inside an array-of-objects). Real engine configs nest one, occasionally two
 * levels; the cap is a backstop so a pathologically deep — or, via inlined
 * `$ref`, cyclic — schema can't build a non-terminating / unusable form. Beyond
 * it, the offending array column is left to the Advanced JSON block.
 */
const MAX_COLUMN_NEST_DEPTH = 4;

/**
 * A nested-array item property → a nested list column (repeater-in-repeater),
 * or `null` when the array isn't representable as a list (the caller then falls
 * back to the scalar mapping, i.e. a plain text cell — the legacy behavior):
 *   • array of string           → stringList column
 *   • array of number / integer → numberList column
 *   • array of object           → objectList column (nested columns derived
 *                                 recursively, honoring {@link MAX_COLUMN_NEST_DEPTH})
 */
function nestedListColumn(
  prop: JsonSchemaNode,
  depth: number,
): { kind: 'stringList' | 'numberList' | 'objectList'; columns?: FlowConfigColumn[] } | null {
  const item = isObject(prop.items) ? prop.items : undefined;
  const itemType = item ? schemaType(item) : undefined;
  if (item && itemType === 'object' && isObject(item.properties)) {
    if (depth >= MAX_COLUMN_NEST_DEPTH) return null; // too deep → Advanced JSON
    return { kind: 'objectList', columns: columnsFor(item, depth + 1) };
  }
  if (itemType === 'string') return { kind: 'stringList' };
  if (itemType === 'number' || itemType === 'integer') return { kind: 'numberList' };
  return null;
}

/** Derive `objectList` columns from an item object's properties. */
function columnsFor(item: JsonSchemaNode, depth = 0): FlowConfigColumn[] {
  const props = item.properties ?? {};
  const cols: FlowConfigColumn[] = [];
  for (const [key, prop] of Object.entries(props)) {
    if (!isObject(prop)) continue;
    const t = schemaType(prop);

    // A nested array → a nested list column (repeater-in-repeater). When the
    // array isn't a representable list we fall through to the scalar mapping
    // below (a plain text cell — legacy behavior), so nothing regresses.
    if (t === 'array') {
      const nested = nestedListColumn(prop, depth);
      if (nested) {
        cols.push({
          key,
          label: prop.title || humanizeKey(key),
          kind: nested.kind,
          ...(nested.columns ? { columns: nested.columns } : {}),
          ...(prop.description ? { placeholder: prop.description } : {}),
        });
        continue;
      }
    }

    let kind: FlowConfigColumn['kind'];
    let options: Array<{ value: string; label: string }> | undefined;
    // A reference annotation wins over the plain scalar mapping — the column is
    // a typed reference and gets a picker (static or polymorphic via kindFrom).
    const ref = refOf(prop);
    if (ref) {
      kind = 'reference';
    } else if (Array.isArray(prop.enum)) {
      kind = 'select';
      options = enumOptions(prop.enum, prop.xEnumDeprecated);
    } else if (t === 'boolean') {
      kind = 'boolean';
    } else if (scalarField(prop)?.kind === 'number') {
      // objectui#11664 — the top-level number mapping, reused rather than
      // re-detected: a `number` / `integer` item property (a screen field's
      // `min` / `max`) is a number column, which commits the JSON number the
      // node contract declares. As a text cell it saved a string.
      kind = 'number';
    } else {
      // A string column marked xExpression:'expression' becomes a CEL column
      // (mono, predicate-checked by flow-expr-problems). Every other string
      // column stays text: a literal cell (objectui#12329).
      kind = exprModeOf(prop) === 'expression' ? 'expression' : 'text';
    }
    cols.push({
      key,
      label: prop.title || humanizeKey(key),
      kind,
      ...(options ? { options } : {}),
      ...(ref ? { ref } : {}),
      // Columns have no help slot — surface the schema description as a hint.
      ...(prop.description ? { placeholder: prop.description } : {}),
    });
  }
  return cols;
}

/** Common field metadata derived from a schema node. */
function meta(node: JsonSchemaNode, key: string): { label: string; help?: string; defaultValue?: string } {
  return {
    label: node.title || humanizeKey(key),
    ...(node.description ? { help: node.description } : {}),
    ...(defaultString(node) ? { defaultValue: defaultString(node) } : {}),
  };
}

/** One config key a published schema declares, with the schema's own words for it. */
export interface DeclaredConfigKey {
  key: string;
  /** The property's `title`, when the schema gives one. */
  title?: string;
  /** The property's `description`, when the schema gives one. */
  description?: string;
}

/**
 * The config keys a published config JSON Schema DECLARES, in declaration
 * order — including the ones {@link jsonSchemaToFlowFields} cannot type and so
 * emits no field for (objectui#11788). `null` exactly when that function
 * returns `null`.
 *
 * The two lists differ on purpose: a declared key with no mapped field is a key
 * the engine accepts (it rejects UNdeclared keys at `registerFlow()`) that the
 * mapper cannot draw. `mergeServerFlowFields` reads the difference to keep the
 * hand-written editor for such a key instead of demoting it to Advanced (JSON),
 * under the schema's own title and description.
 */
export function declaredConfigKeys(schema: unknown): DeclaredConfigKey[] | null {
  if (!isObject(schema) || schemaType(schema) !== 'object' || !isObject(schema.properties)) {
    return null;
  }
  const out: DeclaredConfigKey[] = [];
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!isObject(prop)) continue;
    out.push({
      key,
      ...(typeof prop.title === 'string' && prop.title ? { title: prop.title } : {}),
      ...(typeof prop.description === 'string' && prop.description ? { description: prop.description } : {}),
    });
  }
  return out;
}

/**
 * Convert a published config JSON Schema (an object schema) into the inspector's
 * `FlowConfigField[]`. Property order is preserved. Returns `null` when the
 * schema is not a usable object schema, so callers fall back to their hardcoded
 * field group.
 */
export function jsonSchemaToFlowFields(schema: unknown): FlowConfigField[] | null {
  if (!isObject(schema) || schemaType(schema) !== 'object' || !isObject(schema.properties)) {
    return null;
  }
  const fields: FlowConfigField[] = [];

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!isObject(prop)) continue;
    const t = schemaType(prop);

    // ── arrays ────────────────────────────────────────────────────────────
    if (t === 'array') {
      const item = isObject(prop.items) ? prop.items : undefined;
      const itemType = item ? schemaType(item) : undefined;
      if (item && itemType === 'object' && isObject(item.properties)) {
        fields.push({ id: key, path: ['config', key], kind: 'objectList', columns: columnsFor(item), ...meta(prop, key) });
      } else if (itemType === 'string') {
        fields.push({ id: key, path: ['config', key], kind: 'stringList', ...meta(prop, key) });
      } else if (itemType === 'number' || itemType === 'integer') {
        fields.push({ id: key, path: ['config', key], kind: 'numberList', ...meta(prop, key) });
      }
      // arrays of anything else fall through to the Advanced block.
      continue;
    }

    // ── nested object → flatten one level under config.<key>.* ──────────────
    if (t === 'object' && isObject(prop.properties)) {
      const subProps = Object.entries(prop.properties).filter(([, p]) => isObject(p));
      // A boolean `enabled` toggle gates the rest of the group (mirrors the SLA
      // escalation UX): the group's other fields reveal only when it is on.
      const hasEnabled = subProps.some(([k, p]) => k === 'enabled' && schemaType(p as JsonSchemaNode) === 'boolean');
      for (const [subKey, subProp] of subProps) {
        const sp = subProp as JsonSchemaNode;
        const subRef = refOf(sp);
        const scalar = subRef ? undefined : scalarField(sp);
        const kind = subRef ? 'reference' : scalar?.kind;
        if (!kind) continue; // deeper nesting / unsupported → Advanced block
        const id = `${key}.${subKey}`;
        const isGate = hasEnabled && subKey === 'enabled';
        const field: FlowConfigField = {
          id,
          path: ['config', key, subKey],
          kind,
          // The gate adopts the parent group's label; siblings keep their own.
          ...(isGate ? { label: prop.title || humanizeKey(key), ...(prop.description ? { help: prop.description } : {}), ...(defaultString(sp) ? { defaultValue: defaultString(sp) } : {}) } : meta(sp, subKey)),
          ...(subRef ? { ref: subRef } : {}),
          ...(scalar?.refMode ? { refMode: scalar.refMode } : {}),
          ...(kind === 'select' && Array.isArray(sp.enum) ? { options: enumOptions(sp.enum, sp.xEnumDeprecated) } : {}),
          ...(hasEnabled && !isGate ? { showWhen: { field: `${key}.enabled`, equals: ['true'] } } : {}),
        };
        fields.push(field);
      }
      continue;
    }

    // ── free-form object map → keyValue ─────────────────────────────────────
    // An object with `additionalProperties` but no fixed `properties` is a
    // dynamic string-keyed map (the object-with-`properties` case is handled
    // above and `continue`s, so it never reaches here). objectui edits it with
    // the flat keyValue widget — the engine reads `config.<key>` as
    // `{ var: value }` (CRUD `fields`/`filter`, assignment `assignments`, …).
    if (t === 'object' && prop.additionalProperties !== undefined && prop.additionalProperties !== false) {
      fields.push({ id: key, path: ['config', key], kind: 'keyValue', ...meta(prop, key) });
      continue;
    }

    // ── scalars ─────────────────────────────────────────────────────────────
    // A reference annotation (xRef) wins over the plain scalar mapping — the
    // string is really a typed reference and gets a picker.
    const ref = refOf(prop);
    if (ref) {
      fields.push({ id: key, path: ['config', key], kind: 'reference', ref, ...meta(prop, key) });
      continue;
    }
    const scalar = scalarField(prop);
    if (!scalar) continue; // unrepresentable → Advanced block
    fields.push({
      id: key,
      path: ['config', key],
      kind: scalar.kind,
      ...meta(prop, key),
      ...(scalar.refMode ? { refMode: scalar.refMode } : {}),
      ...(scalar.kind === 'select' && Array.isArray(prop.enum) ? { options: enumOptions(prop.enum, prop.xEnumDeprecated) } : {}),
    });
  }

  return fields;
}
