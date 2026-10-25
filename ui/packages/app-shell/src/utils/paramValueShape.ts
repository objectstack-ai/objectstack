/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * paramValueShape — the emitted **value-shape contract** for action params.
 *
 * Since ADR-0059 (#2700/#2704) `ActionParamDialog` routes every param through
 * the shared form field-widget renderer (`paramToField()` → `getLazyFieldWidget`),
 * so each param now emits **its widget's own value shape** on confirm. Those
 * shapes differ per type — `number` emits a `number`, `boolean` a `boolean`,
 * `date` an ISO string, `select` a `string` (`string[]` when `multiple`, #2709),
 * `lookup`/`user` an id `string`/`string[]`, `file`/`image` a fileId `string`/
 * `string[]` after `serializeParamValues` (#2698/#2710) — and an endpoint's
 * input contract depends on getting the shape it declared.
 *
 * This module is that contract, made explicit and machine-checkable:
 *   - {@link PARAM_VALUE_SHAPES} — the table: one entry per `FORM_FIELD_TYPES`
 *     widget key, describing the shape the dialog POSTs for that type.
 *   - {@link expectedParamShape} — resolves a concrete `ActionParamDef` to its
 *     emitted shape, reusing the SAME `paramToField()` the dialog uses (so the
 *     contract can't drift from the dialog's own type resolution) and folding in
 *     `multiple` and the `file`/`image` fileId serialization.
 *   - {@link classifyValueShape} — a runtime classifier for render proofs to
 *     assert what a widget actually emitted matches the declared contract.
 *
 * The paired drift test (`paramValueShape.test.ts`, mirroring the
 * `paramToField` drift guard's style) fails if a new widget type lands without
 * a declared shape, or if a pinned endpoint contract changes.
 */
import type { ActionParamDef } from '@object-ui/core';
import { paramToField } from './paramToField.js';

/**
 * The vocabulary of emitted value shapes. A closed union so the table, the
 * resolver, and the runtime classifier all speak the same language.
 *
 * `'none'` = the widget is computed/read-only and emits no param value (its
 * cell holds display-only state). `'array'` is only produced by
 * {@link classifyValueShape} for an *empty* array whose element type can't be
 * inferred — the resolver never returns it (it always knows the base).
 */
export type ValueShapeTag =
  | 'none'
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'string[]'
  | 'number[]'
  | 'boolean[]'
  | 'object[]'
  | 'array';

/** The base JS type a single emitted value carries. */
type BaseShape = 'string' | 'number' | 'boolean' | 'object';

/**
 * How a widget type's `multiple` flag affects the emitted cardinality:
 *   - `'scalar'`      — always a single `base` value (`text`, `number`, `date`…).
 *   - `'scalar|array'`— a single `base`, or `base[]` when the param is `multiple`
 *                       (`select`, `lookup`, `user`, `file`, …).
 *   - `'array'`       — always `base[]`, regardless of `multiple`
 *                       (`multiselect`, `tags`, `checkboxes`, `grid`).
 */
type Cardinality = 'scalar' | 'scalar|array' | 'array';

export interface ParamValueShapeSpec {
  /**
   * The JS type each emitted value carries **at the endpoint boundary** — i.e.
   * the value the dialog POSTs after `serializeParamValues`. For `file`/`image`
   * that is the fileId `string` (the widget holds a `{ file_id, name, url, … }`
   * descriptor in local state, which the dialog serializes to its id on confirm;
   * see #2698/#2710); every other type passes its widget value through untouched.
   */
  readonly base: BaseShape;
  /** How `multiple` promotes the cardinality — see {@link Cardinality}. */
  readonly cardinality: Cardinality;
  /**
   * `true` for computed/read-only widgets that never call `onChange`
   * (`formula`, `summary`, `auto_number`, `vector`). They render display-only,
   * so a param of the type emits nothing (`'none'`).
   */
  readonly computed?: boolean;
  /**
   * `true` for widget-hint-only keys that are reached through a field `widget:`
   * override, never a bare param `type` (`object-ref`, `filter-condition`,
   * `recipient-picker`). Listed so the drift guard's `FORM_FIELD_TYPES` coverage
   * is total, but they are outside the declarable-param contract.
   */
  readonly widgetHintOnly?: boolean;
  /** One-line description for the documented contract table. */
  readonly note: string;
}

/**
 * The emitted value-shape contract, keyed by `FORM_FIELD_TYPES` widget key.
 *
 * Every key in `@object-ui/fields`' `fieldWidgetMap` MUST have an entry here —
 * the drift guard asserts full coverage, so adding a new widget type without
 * declaring the shape a param of that type POSTs fails CI. Keep entries ordered
 * to match `fieldWidgetMap` for easy diffing.
 */
export const PARAM_VALUE_SHAPES: Readonly<Record<string, ParamValueShapeSpec>> = Object.freeze({
  // Text-ish → string
  text: { base: 'string', cardinality: 'scalar', note: 'Free text.' },
  textarea: { base: 'string', cardinality: 'scalar', note: 'Multi-line text.' },
  email: { base: 'string', cardinality: 'scalar', note: 'Email address string.' },
  phone: { base: 'string', cardinality: 'scalar', note: 'Phone number string.' },
  url: { base: 'string', cardinality: 'scalar', note: 'URL string.' },
  password: { base: 'string', cardinality: 'scalar', note: 'Secret string (masked input).' },
  markdown: { base: 'string', cardinality: 'scalar', note: 'Markdown source string (RichTextField).' },
  html: { base: 'string', cardinality: 'scalar', note: 'HTML source string (RichTextField).' },
  richtext: { base: 'string', cardinality: 'scalar', note: 'Rich-text source string.' },
  code: { base: 'string', cardinality: 'scalar', note: 'Code source string.' },
  color: { base: 'string', cardinality: 'scalar', note: 'Hex color string (e.g. #8B5CF6).' },
  avatar: { base: 'string', cardinality: 'scalar', note: 'Data-URL / base64 image string.' },
  signature: { base: 'string', cardinality: 'scalar', note: 'Signature data-URL string.' },
  qrcode: { base: 'string', cardinality: 'scalar', note: 'Encoded QR payload string.' },

  // Date/time → ISO-ish string
  date: { base: 'string', cardinality: 'scalar', note: 'ISO date string (YYYY-MM-DD).' },
  datetime: { base: 'string', cardinality: 'scalar', note: 'ISO-8601 instant with an explicit zone (2026-08-10T07:00:00.000Z) — what the platform `datetime` value contract requires. The control is zone-less; DateTimeField converts (objectstack#5061).' },
  time: { base: 'string', cardinality: 'scalar', note: 'Time string (HH:mm).' },

  // Numeric → number
  number: { base: 'number', cardinality: 'scalar', note: 'Numeric value — NOT a string (null when cleared).' },
  currency: { base: 'number', cardinality: 'scalar', note: 'Numeric amount.' },
  percent: { base: 'number', cardinality: 'scalar', note: 'Numeric percent.' },
  slider: { base: 'number', cardinality: 'scalar', note: 'Numeric slider value.' },
  rating: { base: 'number', cardinality: 'scalar', note: 'Numeric rating (1..n).' },

  // Boolean
  boolean: { base: 'boolean', cardinality: 'scalar', note: 'true / false (dialog renders an inline checkbox).' },

  // Single-value selection → string, promotes to string[] when multiple
  select: { base: 'string', cardinality: 'scalar|array', note: 'Option value string; multiple → string[] via the chip picker (#2709).' },
  radio: { base: 'string', cardinality: 'scalar', note: 'Single option value string.' },

  // Inherently multi-value selection → string[]
  multiselect: { base: 'string', cardinality: 'array', note: 'Always string[] of option values.' },
  checkboxes: { base: 'string', cardinality: 'array', note: 'Always string[] of checked values.' },
  tags: { base: 'string', cardinality: 'array', note: 'Always string[] of free tags.' },

  // Record pickers → id string(s)
  lookup: { base: 'string', cardinality: 'scalar|array', note: 'Referenced record id; multiple → id[]. (No referenceTo → falls back to a text string.)' },
  master_detail: { base: 'string', cardinality: 'scalar|array', note: 'Parent record id — renders the single-value LookupField, not a child list.' },
  user: { base: 'string', cardinality: 'scalar|array', note: 'sys_user id; multiple → id[].' },
  // `owner` had an entry here until objectui#4814 retired the spelling. Removed
  // on this card's own drift guard's instruction ("no stale contract entries
  // pointing at removed widget types"): a shape declared for a type no form can
  // render is a contract for a param nobody can author.

  // Uploads → fileId string(s) after serializeParamValues (#2698/#2710)
  file: { base: 'string', cardinality: 'scalar|array', note: 'fileId string after serialize; multiple → fileId[]. Widget state holds a { file_id, name, url, … } descriptor pre-serialize.' },
  image: { base: 'string', cardinality: 'scalar|array', note: 'fileId string after serialize; multiple → fileId[]. Same descriptor→id serialization as file.' },

  // Structured object values (stored as JSON on the row)
  object: { base: 'object', cardinality: 'scalar', note: 'Parsed JSON value (null when empty); the json alias resolves here (objectui#11448).' },
  location: { base: 'object', cardinality: 'scalar', note: '{ latitude, longitude } object.' },
  address: { base: 'object', cardinality: 'scalar', note: 'Structured address object.' },
  geolocation: { base: 'object', cardinality: 'scalar', note: '{ latitude, longitude, … } object.' },
  grid: { base: 'object', cardinality: 'array', note: 'Array of row objects (embedded table).' },

  // Computed / read-only — never emit a param value
  formula: { base: 'string', cardinality: 'scalar', computed: true, note: 'Computed — read-only, emits nothing.' },
  summary: { base: 'number', cardinality: 'scalar', computed: true, note: 'Computed roll-up — read-only, emits nothing.' },
  auto_number: { base: 'string', cardinality: 'scalar', computed: true, note: 'Auto-generated — read-only, emits nothing.' },
  vector: { base: 'number', cardinality: 'array', computed: true, note: 'Embedding vector — read-only display, emits nothing.' },

  // Widget-hint-only pickers — reached via a field `widget:` override, never a
  // bare param `type`. Present for total FORM_FIELD_TYPES coverage only.
  'object-ref': { base: 'string', cardinality: 'scalar', widgetHintOnly: true, note: 'Object name string. Widget-hint only — not a declarable param type.' },
  'filter-condition': { base: 'object', cardinality: 'scalar', widgetHintOnly: true, note: 'Filter/criteria object. Widget-hint only — not a declarable param type.' },
  'recipient-picker': { base: 'string', cardinality: 'scalar', widgetHintOnly: true, note: 'Recipient id string. Widget-hint only — not a declarable param type.' },
  'position-ref': { base: 'string', cardinality: 'scalar', widgetHintOnly: true, note: 'Position name string. Widget-hint only — not a declarable param type.' },
  'permission-ref': { base: 'string', cardinality: 'scalar', widgetHintOnly: true, note: 'Permission-set name string. Widget-hint only — not a declarable param type.' },
});

/** Concrete `base[]` tag for a base shape. */
function arrayTagOf(base: BaseShape): ValueShapeTag {
  return `${base}[]` as ValueShapeTag;
}

/**
 * Resolve a spec + `multiple` flag to the concrete shape the dialog emits.
 * Computed widgets → `'none'`. Inherently-array widgets → `base[]`. Scalar-or-
 * array widgets → `base[]` when `multiple`, else `base`. Plain scalars → `base`.
 */
export function resolveShapeSpec(spec: ParamValueShapeSpec, multiple: boolean): ValueShapeTag {
  if (spec.computed) return 'none';
  switch (spec.cardinality) {
    case 'array':
      return arrayTagOf(spec.base);
    case 'scalar|array':
      return multiple ? arrayTagOf(spec.base) : spec.base;
    case 'scalar':
    default:
      return spec.base;
  }
}

/**
 * The concrete value shape the dialog POSTs for a given param definition.
 *
 * Resolves through the SAME `paramToField()` adapter the dialog renders with —
 * so it inherits the real widget-type resolution (aliases, the
 * lookup-without-`referenceTo` → text fallback, `multiple` inheritance) and can
 * never drift from what the dialog actually mounts. The resolved
 * `{ type, multiple }` then indexes {@link PARAM_VALUE_SHAPES}.
 */
export function expectedParamShape(param: ActionParamDef): ValueShapeTag {
  const field = paramToField(param);
  const spec = PARAM_VALUE_SHAPES[field.type as string];
  // paramToField only ever yields a FORM_FIELD_TYPES key (or 'text'), all of
  // which are in the table; guard defensively so an unseen key surfaces loudly.
  if (!spec) {
    throw new Error(`No value-shape contract for resolved widget type "${field.type}" (param "${param.name}")`);
  }
  return resolveShapeSpec(spec, field.multiple === true);
}

/**
 * Classify a runtime value into a {@link ValueShapeTag}. Used by the dialog
 * render proofs to assert what a widget actually emitted on confirm matches the
 * declared contract ({@link expectedParamShape}).
 *
 * `null`/`undefined` → `'none'`. A non-empty array is tagged by its first
 * element's base (`['a'] → 'string[]'`); an empty array can't reveal its base,
 * so it degrades to the generic `'array'` — pass a populated value in proofs.
 */
export function classifyValueShape(value: unknown): ValueShapeTag {
  if (value === null || value === undefined) return 'none';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array';
    const elem = classifyValueShape(value[0]);
    // First element is itself a scalar/object tag here (proofs never nest arrays).
    return arrayTagOf((elem === 'none' ? 'object' : elem) as BaseShape);
  }
  const t = typeof value;
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'object';
}
