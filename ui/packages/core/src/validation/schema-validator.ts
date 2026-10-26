/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Schema Validation
 * 
 * Runtime validation utilities for Object UI schemas.
 * These utilities help ensure schemas are valid before rendering.
 * 
 * @module validation
 * @packageDocumentation
 */

import type { BaseSchema } from '@object-ui/types';
import { nodeSlotValues, nodeSlotsFor } from '@object-ui/types';
import { hasDeclaredPredicate } from '../evaluator/declaredPredicate.js';
import { isUnevaluablePredicate } from '../evaluator/unevaluablePredicate.js';

/**
 * One issue found while walking an ObjectUI schema TREE — `path` locates the
 * offending node (e.g. `children[0].type`), and `type` says whether it is fatal.
 *
 * NOT the spec's `ValidationError` (`@objectstack/spec/kernel`), whose name this
 * interface carried until objectstack#4115. That one describes PLUGIN-manifest
 * validation and is keyed by `field`, with no severity discriminant. The two
 * share no key beyond `message`/`code`.
 *
 * Naming convention for this family, set here and followed by the rest of the
 * burn-down: `<what-is-validated>Validation<Error|Result>`. (`SchemaValidationResult`
 * and `SchemaValidationReport` are themselves spec exports — checked, not assumed.)
 */
export interface SchemaNodeValidationError {
  path: string;
  message: string;
  type: 'error' | 'warning';
  code?: string;
}

/**
 * The outcome of validating an ObjectUI schema tree.
 *
 * NOT the spec's `ValidationResult` (`@objectstack/spec/kernel` and
 * `@objectstack/spec/contracts`), whose name this interface carried until
 * objectstack#4115: there `errors`/`warnings` are OPTIONAL arrays of
 * `{ field, message, code? }` describing a plugin manifest. Here both arrays are
 * required and carry node paths.
 */
export interface SchemaNodeValidationResult {
  valid: boolean;
  errors: SchemaNodeValidationError[];
  warnings: SchemaNodeValidationError[];
}

/**
 * The rule for a PREDICATE GATE key (`visible` / `disabled`) — objectui#6505.
 *
 * ## What this rule used to say, and what it cost
 *
 * Both keys read `typeof value === 'boolean'`, message `"<key> must be a
 * boolean"`. Both keys are EXPRESSIONS everywhere else in the system: AGENTS.md
 * §4 declares the protocol as `hidden?: string; // expression` /
 * `disabled?: string; // expression`, `SchemaRenderer` evaluates them through
 * `hasDeclaredPredicate` + `evaluateCondition`, `@objectstack/spec` normalizes
 * every authored predicate into a `{ dialect, source }` envelope, and the
 * objectui#3862 / objectui#3955 rulings are entirely about which EXPRESSION
 * spellings count as declared. So the node the docs teach —
 * `{ type: 'button', disabled: "${record.stage == 'closed'}" }` — was reported
 * `disabled must be a boolean` by the dev-mode validator and its host element
 * got `data-obj-schema-invalid`, the cue apps hang a red outline off.
 *
 * `BASE_SCHEMA_RULES` was the ONE place in the repo that disagreed with the
 * protocol, so this restores declared = enforced rather than widening a
 * contract: the accept set moves to exactly what the runtime already accepts.
 *
 * ## Why `hasDeclaredPredicate` and not a check written here
 *
 * `evaluator/declaredPredicate.ts` is the repo's single definition of "is a
 * predicate gate DECLARED on this value?" (objectui#3850's ruling; nothing in
 * the repo asks that question anywhere else). A second, hand-rolled answer in
 * this table is how the validator and the renderer come to disagree about the
 * same value — which is the defect class this rule was already an instance of.
 * The delegation is behavioural, so it is pinned behaviourally: the drift pin in
 * `__tests__/predicate-valued-gate-rules.test.ts` asserts this rule's verdict
 * equals `boolean || (declared && !unevaluable)` across every probe — the second
 * half since objectui#11358, see below.
 *
 * ## Why the boolean arm survives even though it is subsumed
 *
 * `hasDeclaredPredicate(true)` and `hasDeclaredPredicate(false)` are both
 * `true` today (`toPredicateInput` returns a boolean unchanged), so the first
 * arm changes no verdict. It is kept because it makes this rule's accept set a
 * provable SUPERSET of the one it replaces, locally: a future narrowing on the
 * declaredness side cannot silently start reporting `disabled: false` — the
 * most explicit gate an author can write — as an invalid schema.
 *
 * ## What it still REFUSES (the half that is not negotiable)
 *
 * `null`, `''`, whitespace-only predicate text and the empty / blank-`source`
 * envelope (objectui#3960) — what `hasDeclaredPredicate` calls "not declared" —
 * and a value that IS declared but cannot be evaluated: a number, `{}`, an
 * array, an envelope with no string `source` (`isUnevaluablePredicate`).
 * Every one of those was refused before this change too — the accept set
 * widens and nothing refused becomes accepted. Dropping the two keys from this
 * table was the option this fix was explicitly forbidden to take: an absent
 * rule reports nothing at all, which is gate weakening wearing the same green.
 *
 * ## Why "declared" alone stopped being this rule's answer (objectui#11358)
 *
 * Until objectui#11358 every declared gate was also an evaluable one, so
 * "declared" answered both questions. That ruling made a present value with no
 * evaluable `source` DECLARED (and faulting) so that the runtime fails it in
 * its key's fault direction instead of reading it as no gate — and this rule
 * asks a different question, "is this a predicate the runtime can evaluate?".
 * Reading `hasDeclaredPredicate` alone would have widened the accept set to
 * exactly the shapes that ruling exists to stop. So the rule refuses the
 * unevaluable state by the same internal definition the runtime uses for it,
 * not by a list written here.
 */
function predicateGateRule(key: 'visible' | 'disabled') {
  return {
    required: false,
    validate: (value: unknown): boolean =>
      typeof value === 'boolean' || (!isUnevaluablePredicate(value) && hasDeclaredPredicate(value)),
    message:
      `${key} must be a boolean or a declared predicate: an expression string ` +
      `(bare, e.g. "record.stage == 'closed'", or the "\${...}" template ` +
      `spelling), or a { dialect, source } expression envelope`,
  };
}

/**
 * Validation rules for base schema
 */
const BASE_SCHEMA_RULES = {
  type: {
    required: true,
    validate: (value: any) => typeof value === 'string' && value.length > 0,
    message: 'type must be a non-empty string'
  },
  id: {
    required: false,
    validate: (value: any) => typeof value === 'string',
    message: 'id must be a string'
  },
  className: {
    required: false,
    validate: (value: any) => typeof value === 'string',
    message: 'className must be a string'
  },
  // objectui#6505 — both keys are EXPRESSIONS in the protocol, not booleans.
  // See `predicateGateRule` above for the accept set and what it still refuses.
  visible: predicateGateRule('visible'),
  disabled: predicateGateRule('disabled')
};

/**
 * A schema node as this validator may READ it: an object whose every key is
 * `unknown` until a rule proves otherwise.
 *
 * `Record<string, unknown>` and NOT `BaseSchema` — a typed parameter here would
 * assert the very thing being checked, and every rule below would be reading a
 * value the type system had already promised was there. Arrays are deliberately
 * inside the type: `typeof [] === 'object'`, and this validator has always
 * walked into an array node and reported the `type` key missing from it
 * (`MISSING_REQUIRED`). That verdict is unchanged.
 */
type SchemaNodeUnderValidation = Record<string, unknown>;

/**
 * The ONE narrowing between {@link validateSchema}'s `unknown` parameter and
 * every rule below it (objectui#8416).
 *
 * The VERDICT is the guard this replaces, spelled the same way: the
 * `!schema || typeof schema !== 'object'` test that used to sit at the top of
 * `validateBaseSchema`. `null`, `undefined` and every primitive are refused;
 * arrays and plain objects pass, exactly as before.
 *
 * What changes is WHERE it runs. Only ONE of the four rules ever had it, and
 * `validateSchema` calls all four unconditionally: `validateFormSchema` read
 * `schema.type` and `validateChildren` read `schema.children` with no guard at
 * all, so `validateSchema(null)` and `validateSchema(undefined)` threw a raw
 * `TypeError: Cannot read properties of null (reading 'type')` — measured on
 * 256c709e2 — instead of returning the `INVALID_SCHEMA` result this function's
 * own contract promises, and `isValidSchema(null)` threw instead of answering
 * `false`. `SchemaRenderer` wraps its call in a `try`/`catch` whose comment
 * reads "Validator itself failed — surface but don't crash render"; that catch
 * is where the crash was landing.
 */
function isSchemaNodeShape(value: unknown): value is SchemaNodeUnderValidation {
  return !!value && typeof value === 'object';
}

/**
 * Validate a schema against base rules
 */
function validateBaseSchema(
  schema: SchemaNodeUnderValidation,
  path: string = 'schema'
): SchemaNodeValidationError[] {
  const errors: SchemaNodeValidationError[] = [];

  // Validate required and optional properties
  Object.entries(BASE_SCHEMA_RULES).forEach(([key, rule]) => {
    const value = schema[key];
    
    if (rule.required && value === undefined) {
      errors.push({
        path: `${path}.${key}`,
        message: `${key} is required`,
        type: 'error',
        code: 'MISSING_REQUIRED'
      });
    }
    
    if (value !== undefined && !rule.validate(value)) {
      errors.push({
        path: `${path}.${key}`,
        message: rule.message,
        type: 'error',
        code: 'INVALID_TYPE'
      });
    }
  });

  return errors;
}

/**
 * TOMBSTONE table — node `type` spellings this renderer has RETIRED, mapped to
 * the prescription an author must follow instead (ADR-0049 enforce-or-remove).
 *
 * A retired spelling is not merely absent from this file. Absence here means
 * {@link validateSchema} runs `validateBaseSchema` — which only asks that
 * `type` be a non-empty string — finds nothing type-specific to say, and
 * returns `valid: true`. That silence is the failure mode this table exists to
 * prevent: the author is told their schema is fine and then gets the OBJUI-001
 * "Unknown component type" panel at render time, one layer too late to act on.
 * So a retired spelling is refused BY NAME, with the migration in the message.
 *
 * `crud` (objectui#5373, maintainer ruling of 2026-08-20): `CRUDSchema` carried
 * FOUR declaration faces — the TS interface, the zod mirror, a dedicated branch
 * in this very function, and `CRUDBuilder` — and never once had a registered
 * renderer, for the whole life of the key. Every face taught an author (and an
 * AI author reading the published reference page) that the type existed. The
 * branch that used to sit here is what made this validator the loudest of the
 * four lies: it read `schema.type === 'crud'`, checked that `columns` was an
 * array, and returned no error — an affirmative "your CRUD schema is valid"
 * for a node that renders nothing.
 *
 * Keyed by the authored spelling, and quantified over the table rather than
 * written per spelling, so the next retirement closes this face the day it
 * lands here.
 */
const RETIRED_NODE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  crud:
    "Node type `crud` was RETIRED (objectui#5373, ADR-0049 enforce-or-remove). " +
    "`CRUDSchema` declared it in four places and no renderer ever registered it, " +
    "so a node spelling it painted the OBJUI-001 \"Unknown component type\" panel. " +
    "Compose the shapes that DO render instead: `object-grid` for the record " +
    "table with its toolbar, filters, pagination and row/batch actions, " +
    "`object-form` for the create/edit form, and `detail` for the record view.",
});

/**
 * Refuse a retired node-type spelling by name.
 *
 * Severity is `error`, not `warning`, and that is the whole point of the
 * retirement: a warning leaves `result.valid === true`, so `assertValidSchema`
 * would still not throw and `isValidSchema` would still answer `true` — the
 * same silence, one console line louder.
 *
 * `hasOwnProperty` rather than a plain index read: a `type` of `'constructor'`
 * or `'toString'` reaches `Object.prototype` and would answer truthy.
 *
 * Reached for every node in the tree, not just the root — {@link validateSchema}
 * is what `validateChildren` recurses with, so a retired spelling nested inside
 * a `children` array is refused with its own path.
 */
function validateRetiredNodeType(
  schema: SchemaNodeUnderValidation,
  path: string = 'schema'
): SchemaNodeValidationError[] {
  const type = schema.type;
  if (typeof type !== 'string') return [];
  if (!Object.prototype.hasOwnProperty.call(RETIRED_NODE_TYPES, type)) return [];
  return [{
    path: `${path}.type`,
    message: RETIRED_NODE_TYPES[type],
    type: 'error',
    code: 'RETIRED_TYPE'
  }];
}

/**
 * The ONE namespace a form field's widget id may name — objectui#5254,
 * maintainer ruling of 2026-08-19.
 *
 * A form field's `type` either names a `field:`-namespaced widget or takes the
 * renderer's declared `default` input branch. It never resolves a plain SDUI
 * node renderer: `renderFieldComponent` (`@object-ui/components`) resolves a
 * colon-qualified id ONLY under this prefix, and `resolveFieldLabelling` /
 * `resolvesToRegisteredFieldWidget` there mirror it exactly.
 */
const FIELD_WIDGET_NAMESPACE = 'field:';

/**
 * The two keys of an AUTHORED form field that can carry a widget id.
 *
 * Both are `unknown` rather than `string`: this validator's whole job is to be
 * handed metadata that may be any shape at all, so the narrowing has to happen
 * here and not be assumed by the type. (The rest of this file predates that
 * discipline and reads its input as `any`; new code does not add to it.)
 */
interface AuthoredFormField {
  type?: unknown;
  widget?: unknown;
}

/**
 * The widget id a form field will actually be RENDERED as.
 *
 * Mirrors the renderer's own precedence (`resolvedType` in
 * `packages/components/src/renderers/form/form.tsx`: explicit form-config
 * `widget`, then the resolved field metadata's widget hint, then the bare
 * `type`). Only the two keys an AUTHORED schema carries are read here —
 * `field.field?.widget` is a resolved metadata OBJECT that a hand-authored
 * standalone `FormSchema` does not have.
 *
 * The mirroring is the point, not a convenience: validator and renderer must
 * not be able to disagree about which component will actually render, which is
 * the same discipline `resolveFieldLabelling` states on the renderer side.
 */
function resolveAuthoredFieldWidgetId(field: AuthoredFormField): string | undefined {
  const id = field.widget ?? field.type;
  return typeof id === 'string' ? id : undefined;
}

/**
 * A form field's widget id names a namespace that resolves NO field widget —
 * objectui#5375, maintainer ruling of 2026-08-20 (option C, the primary).
 *
 * ## What this refuses, and why it is an error rather than a warning
 *
 * Measured on `main` at f2e11ae6f, the real `form` renderer on the built-in
 * path (no `registerAllFields()`):
 *
 *   type            registry hit   rendered type
 *   ui:password     TRUE           text
 *   secret          false          text
 *   field:secret    false          text
 *
 * `ui:password` **is** registered — as an SDUI node renderer for a top-level
 * `{ type: 'email' }`-style node — so an author who checks whether it resolves
 * gets a YES, and still gets a clear-text box on the field path. That is the
 * shape where verifying does not protect you, and it is why the class, not
 * another entry in a renderer-side table, is what gets closed here: the table
 * fix answers today's spellings and leaves the next invented id to find the
 * same silent degrade. AI-authored metadata invents plausible-looking widget
 * ids constantly; this makes inventing one an ERROR at authoring time instead
 * of a text box that looks like it worked.
 *
 * A warning was explicitly ruled out — a warning IS the silent degrade this
 * check exists to kill, in a new spelling.
 *
 * ## Why only the NAMESPACED spelling
 *
 * `field:` is allowed whether or not the widget is registered: registration is
 * a RUNTIME fact (`registerAllFields()`, a lazily loaded plugin) that an
 * authoring-time validator cannot see, and the renderer already answers an
 * unregistered `field:` secret with a visible refusal (objectui#5322). A BARE
 * name is likewise allowed: it is an open set — every registered `field:<name>`
 * widget, third-party ones included, is reachable by its short name.
 *
 * What is decidable statically is the namespace, and it is a CLOSED set of one.
 * Any other `<ns>:<name>` resolves nothing on the field path by the #5254
 * ruling and falls to the renderer's plain-text `default` arm.
 *
 * ## Census (the ruling made arming this conditional on one)
 *
 * 4,397 authored files in this repo, 649 form-field `type`/`widget` literals,
 * 98 structurally parsed form-field entries in `examples/schema-catalog`:
 * SEVEN colon-qualified ids on the form-field path, five of them `field:*`.
 * The two remaining occurrences are one source line naming `ref:component`,
 * which is a metadata-admin designer `SchemaForm` widget resolved by its own
 * `WIDGETS` table — a different shape (`{ field, widget }` under
 * `sections[].fields[]`, node type `simple`) that this function, gated on
 * `type === 'form'`, never reaches. Zero occurrences of `ui:password`,
 * `secret` or `field:secret` anywhere on the field path.
 */
function validateFieldWidgetNamespace(
  field: AuthoredFormField,
  path: string,
): SchemaNodeValidationError | undefined {
  const id = resolveAuthoredFieldWidgetId(field);
  if (!id || !id.includes(':') || id.startsWith(FIELD_WIDGET_NAMESPACE)) return undefined;
  const key = typeof field.widget === 'string' ? 'widget' : 'type';
  return {
    path: `${path}.${key}`,
    message:
      `'${id}' is not a form field widget: a namespaced field widget id must name the ` +
      `\`field:\` namespace (objectui#5254), so this id resolves NOTHING on the field path ` +
      `and the renderer would fall through to a plain text box — putting a secret on screen ` +
      `in clear text when the field holds one (objectui#5375). Write the built-in spelling ` +
      `(e.g. \`password\`), or the field widget id \`field:${id.slice(id.indexOf(':') + 1)}\`. ` +
      `Resolving in the registry is not proof it resolves HERE — \`ui:password\` is a ` +
      `registered SDUI node renderer and still renders clear text as a field.`,
    type: 'error',
    code: 'UNRESOLVABLE_FIELD_WIDGET_NAMESPACE',
  };
}

/**
 * Validate form schema specific properties
 */
function validateFormSchema(
  schema: SchemaNodeUnderValidation,
  path: string = 'schema'
): SchemaNodeValidationError[] {
  const errors: SchemaNodeValidationError[] = [];

  if (schema.type === 'form') {
    const fields = schema.fields;
    if (Array.isArray(fields)) {
      fields.forEach((entry: unknown, index: number) => {
        // Narrowed before it is read, for the same reason the root is: a
        // `fields` array is authored data too, and reading `field.name` off
        // whatever an author put there made `fields: [null]` throw the same raw
        // `TypeError` a `null` root did. A non-object entry keeps its old
        // verdict — every key reads `undefined`, so `MISSING_FIELD_NAME`.
        const field: SchemaNodeUnderValidation = isSchemaNodeShape(entry) ? entry : {};
        if (!field.name) {
          errors.push({
            path: `${path}.fields[${index}]`,
            message: 'Form field requires name property',
            type: 'error',
            code: 'MISSING_FIELD_NAME'
          });
        }

        // objectui#5375 — an invented namespaced widget id is an ERROR here,
        // not a silent clear-text box at render time. See the helper's doc.
        const namespaceError = validateFieldWidgetNamespace(
          field,
          `${path}.fields[${index}]`,
        );
        if (namespaceError) {
          errors.push(namespaceError);
        }

        // Check for duplicate field names
        const duplicates = fields.filter(
          (other: unknown) => (isSchemaNodeShape(other) ? other.name : undefined) === field.name
        );
        if (duplicates.length > 1) {
          errors.push({
            path: `${path}.fields[${index}]`,
            message: `Duplicate field name: ${String(field.name)}`,
            type: 'warning',
            code: 'DUPLICATE_FIELD_NAME'
          });
        }
      });
    }
  }

  return errors;
}

/** `schema.items[0].content[1]`: the child's path, spelled the way `children[0]` already is. */
function spellSlotPath(path: string, segments: readonly (string | number)[]): string {
  return segments.reduce<string>(
    (spelled, segment) => (typeof segment === 'number' ? `${spelled}[${segment}]` : `${spelled}.${segment}`),
    path,
  );
}

/**
 * Validate child schemas recursively: what `children` holds on every node,
 * and what the node slots declared for this node's type hold.
 */
function validateChildren(
  schema: SchemaNodeUnderValidation,
  path: string = 'schema'
): SchemaNodeValidationError[] {
  const errors: SchemaNodeValidationError[] = [];

  // One child-list spelling. This walker resolved `children || body` for ANY
  // node type, so it outlived every per-registration read of the dialect —
  // objectui#6771 retired it, and a recursive validator that still descended
  // `body` on every node would keep validating a child list no renderer puts
  // on the page.
  const children = schema.children;
  if (children) {
    if (Array.isArray(children)) {
      children.forEach((child: unknown, index: number) => {
        if (isSchemaNodeShape(child)) {
          const childResult = validateSchema(child, `${path}.children[${index}]`);
          errors.push(...childResult.errors, ...childResult.warnings);
        }
      });
    } else if (isSchemaNodeShape(children)) {
      const childResult = validateSchema(children, `${path}.children`);
      errors.push(...childResult.errors, ...childResult.warnings);
    }
  }

  // The node slots THIS type's renderer reads — a dialog's `trigger`, a tab
  // item's `content`, a page's `regions[].components` — from the one
  // declaration in `@object-ui/types` (`nodeSlotsFor`, objectui#11170), which
  // the `objectui check` gate and the SDUI parser read too. Per type, never a
  // second generic spelling: `page:card`'s retired `body` is walked because
  // that renderer is measured still painting it; `body` on any other type is
  // not, which is the objectui#6771 line above, kept.
  if (typeof schema.type === 'string') {
    for (const slot of nodeSlotsFor(schema.type)) {
      for (const { segments, value } of nodeSlotValues(schema, slot.path)) {
        if (!isSchemaNodeShape(value)) continue;
        const childResult = validateSchema(value, spellSlotPath(path, segments));
        errors.push(...childResult.errors, ...childResult.warnings);
      }
    }
  }

  return errors;
}

/**
 * Validate a complete schema
 * 
 * @param schema - The schema to validate
 * @param options - Validation options
 * @returns Validation result with errors and warnings
 * 
 * @example
 * ```typescript
 * const result = validateSchema({
 *   type: 'form',
 *   fields: [
 *     { name: 'email', type: 'input' }
 *   ]
 * });
 * 
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function validateSchema(
  schema: unknown,
  path: string = 'schema'
): SchemaNodeValidationResult {
  const allErrors: SchemaNodeValidationError[] = [];

  // Narrow ONCE, here, before any rule reads a key off the value — see
  // `isSchemaNodeShape`. Every rule below is handed a value already proven to
  // be an object, which is why none of them re-tests it.
  if (!isSchemaNodeShape(schema)) {
    allErrors.push({
      path,
      message: 'Schema must be an object',
      type: 'error',
      code: 'INVALID_SCHEMA'
    });
  } else {
    // Validate base schema
    allErrors.push(...validateBaseSchema(schema, path));

    // Validate type-specific schemas
    allErrors.push(...validateRetiredNodeType(schema, path));
    allErrors.push(...validateFormSchema(schema, path));

    // Validate children recursively
    allErrors.push(...validateChildren(schema, path));
  }

  const errors = allErrors.filter(e => e.type === 'error');
  const warnings = allErrors.filter(e => e.type === 'warning');

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Assert that a schema is valid, throwing an error if not
 * 
 * @param schema - The schema to validate
 * @throws Error if schema is invalid
 * 
 * @example
 * ```typescript
 * try {
 *   assertValidSchema(schema);
 *   // Schema is valid, continue rendering
 * } catch (error) {
 *   console.error('Invalid schema:', error.message);
 * }
 * ```
 */
export function assertValidSchema(schema: any): asserts schema is BaseSchema {
  const result = validateSchema(schema);
  
  if (!result.valid) {
    const errorMessages = result.errors.map(e => `${e.path}: ${e.message}`).join('\n');
    throw new Error(`Schema validation failed:\n${errorMessages}`);
  }
}

/**
 * Check if a value is a valid schema
 * 
 * @param value - The value to check
 * @returns True if the value is a valid schema
 * 
 * @example
 * ```typescript
 * if (isValidSchema(data)) {
 *   renderSchema(data);
 * }
 * ```
 */
export function isValidSchema(value: any): value is BaseSchema {
  const result = validateSchema(value);
  return result.valid;
}

/**
 * Get a human-readable error summary
 * 
 * @param result - The validation result
 * @returns Formatted error summary
 */
export function formatValidationErrors(result: SchemaNodeValidationResult): string {
  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push('Errors:');
    result.errors.forEach(error => {
      parts.push(`  - ${error.path}: ${error.message}`);
    });
  }

  if (result.warnings.length > 0) {
    parts.push('Warnings:');
    result.warnings.forEach(warning => {
      parts.push(`  - ${warning.path}: ${warning.message}`);
    });
  }

  return parts.join('\n');
}
