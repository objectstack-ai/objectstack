// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

/**
 * # ObjectStack Validation Protocol
 * 
 * This module defines the validation schema protocol for ObjectStack, providing a comprehensive
 * type-safe validation system similar to Salesforce's validation rules but with enhanced capabilities.
 * 
 * ## Overview
 *
 * Validation rules are applied at the data layer to ensure data integrity and enforce business logic.
 * A validation rule is a **deterministic, synchronous, side-effect-free predicate over a single
 * record** — it must be decidable from the incoming write (and, on update, the prior record) with
 * no I/O. Everything advertised here runs on the write path (see
 * `objectql/src/validation/rule-validator.ts`) — insert, single-id update, and multi-row
 * (`multi: true`) update, where the evaluator runs once per matched row (#3106); nothing is a
 * silent no-op. The `events` enum admits only `insert`/`update` for this reason — see the
 * `delete` note under "Deliberately NOT validation rules" below.
 *
 * The system supports these validation types:
 *
 * 1. **Script Validation**: Formula-based validation using a CEL predicate
 * 2. **State Machine Validation**: Control allowed state transitions
 * 3. **Format Validation**: Validate a field's value (email, URL, phone, JSON, regex)
 * 4. **Cross-Field Validation**: Validate relationships between multiple fields
 * 5. **JSON Schema Validation**: Validate a JSON field against a JSON Schema
 * 6. **Conditional Validation**: Apply a nested rule based on a CEL condition
 *
 * ## Deliberately NOT validation rules
 *
 * These were once declared here but never enforced. Because the contract above rules them out
 * (they need I/O or are client-side concerns), they were removed rather than left as silent
 * no-ops. Use the layer that already does each one correctly:
 *
 * - **Uniqueness** → a unique **index** whose scope is stated (`ObjectSchema.indexes`, with
 *   `unique: 'organization'` for one holder per organization or `unique: 'global'` for one
 *   across the whole installation — ADR-0120; `partial` for a scoped/conditional constraint),
 *   or field-level `unique`. A SELECT-then-INSERT "rule" is inherently racy (TOCTOU); a DB
 *   unique constraint is not.
 * - **Async / remote validation** → a client-form concern (`debounce`/`validatorUrl` only mean
 *   anything against keystrokes) and an SSRF/latency hazard on the server write path. Keep it in
 *   the form layer, or enforce the underlying invariant with a `unique` index / lifecycle hook.
 * - **Custom handler** → a `beforeInsert` / `beforeUpdate` lifecycle hook, the typed, supported
 *   extension point for arbitrary validation code.
 * - **Delete-time guards** (`events: ['delete']`) → a `beforeDelete` lifecycle hook. The evaluator
 *   only runs on the insert/update write path (a delete carries no record payload to validate), so
 *   a `delete` event was a proven silent no-op — the enum value was removed rather than left
 *   advertised-but-unenforced (#3184; see docs/audits/2026-06-validationschema-property-liveness.md).
 *
 * ## Salesforce Comparison
 * 
 * ObjectStack validation rules are inspired by Salesforce validation rules but enhanced:
 * - Salesforce: Formula-based validation with `Error Condition Formula`
 * - ObjectStack: Multiple validation types with composable rules
 * 
 * Example Salesforce validation rule:
 * ```
 * Rule Name: Discount_Cannot_Exceed_40_Percent
 * Error Condition Formula: Discount_Percent__c > 0.40
 * Error Message: Discount cannot exceed 40%.
 * ```
 * 
 * Equivalent ObjectStack rule:
 * ```typescript
 * {
 *   type: 'script',
 *   name: 'discount_cannot_exceed_40_percent',
 *   condition: 'discount_percent > 0.40',
 *   message: 'Discount cannot exceed 40%',
 *   severity: 'error'
 * }
 * ```
 */

/**
 * Base Validation Rule
 * 
 * All validation rules extend from this base schema with common properties.
 * 
 * ## Industry Standard Enhancements
 * - **Label/Description**: Essential for governance in large systems with thousands of rules.
 * - **Events**: granular control over validation timing (Context-aware validation).
 * - **Tags**: categorization for reporting and management.
 *
 * `label`, `description` and `tags` are **governance / editor metadata**: they are
 * surfaced to the Studio validation-rule editor form (via the `/meta/types` form
 * schema) and to rule listings, but are NOT evaluated on the write path — the
 * rule validator only reads `type`/`condition`/`field`/`events`/`severity`/`message`.
 * They are declared here on purpose (not silent no-ops): they carry authoring intent,
 * not enforcement.
 */
import { lazySchema } from '../shared/lazy-schema';
/**
 * Keys every validation-rule variant shares.
 *
 * A named SHAPE rather than a schema, because each variant needs its own
 * `strictObject` call: an error map closes over the key list it was built with,
 * so closing the shared base alone would leave a variant's own keys
 * (`condition`, `transitions`, `regex`, …) outside the suggestion set — a typo
 * of `transitions` would be rejected with no rename offered. The union
 * discriminates on `type`, so the author is always on exactly one variant and
 * that variant's full key list is the right candidate set.
 *
 * The ADR-0010 protection envelope lives here so all six inherit it in one
 * place: `validation` is a registered metadata type, the loader stamps
 * `_packageId` / `_provenance` on it, and whichever branch matches has to
 * accept them (see `kernel/metadata-type-schemas.test.ts`).
 */
const BASE_VALIDATION_SHAPE = {
  // Identification
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique rule name (snake_case)'),
  label: z.string().optional().describe('Human-readable label for the rule listing'),
  description: z.string().optional().describe('Administrative notes explaining the business reason'),
  
  // Execution Control
  active: z.boolean().default(true),
  events: z.array(z.enum(['insert', 'update'])).default(['insert', 'update']).describe('Write contexts the rule runs on. `delete` is intentionally absent — the evaluator only runs on the insert/update write path; guard deletions with a `beforeDelete` lifecycle hook'),
  priority: z.number().int().min(0).max(9999).default(100).describe('Execution priority (lower runs first, default: 100)'),
  
  // Classification
  tags: z.array(z.string()).optional().describe('Categorization tags (e.g., "compliance", "billing")'),
  
  // Feedback
  severity: z.enum(['error', 'warning', 'info']).default('error'),
  message: z.string().describe('Error message to display to the user'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  ...MetadataProtectionFields,
};

// No `BaseValidationSchema` object: nothing parses the base alone. Every
// instance is one of the six discriminated variants, and each builds its own
// strict shape from BASE_VALIDATION_SHAPE — see the note above for why the key
// list has to be per-variant rather than shared.

/**
 * 1. Script/Expression Validation
 * Generic formula-based validation.
 */
export const ScriptValidationSchema = lazySchema(() => strictObject({
  surface: 'this script validation rule',
  history:
    'Until this shape was closed these were dropped silently — the rule still registered and ran, minus whatever the key was meant to configure.',
  aliases: { formula: 'condition', expression: 'condition', predicate: 'condition', rule: 'condition' },
}, {
  ...BASE_VALIDATION_SHAPE,
  type: z.literal('script'),
  condition: ExpressionInputSchema.describe('Predicate (CEL). If TRUE, validation fails. e.g. P`record.amount < 0`'),
}));

/**
 * 2. State Machine Validation
 * State transition logic.
 */
export const StateMachineValidationSchema = lazySchema(() => strictObject({
  surface: 'this state-machine validation rule',
  history:
    'Until this shape was closed these were dropped silently — the rule still registered and ran, minus whatever the key was meant to configure.',
  aliases: { states: 'transitions', statefield: 'field', from: 'transitions', initial: 'initialStates', initialstate: 'initialStates' },
}, {
  ...BASE_VALIDATION_SHAPE,
  type: z.literal('state_machine'),
  field: z.string().describe('State field (e.g. status)'),
  transitions: z.record(z.string(), z.array(z.string())).describe('Map of { OldState: [AllowedNewStates] }'),
  initialStates: z.array(z.string()).optional().describe('States a record may be CREATED in. When set, an INSERT whose state field carries a value outside this list is rejected (server-enforced) — the FSM entry point. `transitions` only governs UPDATE, and a `select` field permits ANY declared option as an initial value, so without this a record could be born mid-flow (e.g. created already `approved`). Omit to keep the legacy behavior (no initial-state check on insert).'),
}));

/**
 * 3. Value Format Validation
 * Regex or specialized formats.
 */
export const FormatValidationSchema = lazySchema(() => strictObject({
  surface: 'this format validation rule',
  history:
    'Until this shape was closed these were dropped silently — the rule still registered and ran, minus whatever the key was meant to configure.',
  aliases: { pattern: 'regex', fieldname: 'field' },
}, {
  ...BASE_VALIDATION_SHAPE,
  type: z.literal('format'),
  field: z.string(),
  regex: z.string().optional(),
  format: z.enum(['email', 'url', 'phone', 'json']).optional(),
}));

/**
 * 4. Cross-Field Validation
 * Validates relationships between multiple fields.
 * 
 * ## Use Cases
 * - Date range validations (end_date > start_date)
 * - Amount comparisons (discount < total)
 * - Complex business rules involving multiple fields
 * 
 * ## Salesforce Examples
 * 
 * ### Example 1: Close Date Must Be In Current or Future Month
 * **Salesforce Formula:**
 * ```
 * MONTH(CloseDate) < MONTH(TODAY()) ||
 * YEAR(CloseDate) < YEAR(TODAY())
 * ```
 * 
 * **ObjectStack Equivalent:**
 * ```typescript
 * {
 *   type: 'cross_field',
 *   name: 'close_date_future',
 *   condition: 'MONTH(close_date) >= MONTH(TODAY()) AND YEAR(close_date) >= YEAR(TODAY())',
 *   fields: ['close_date'],
 *   message: 'Close Date must be in the current or a future month'
 * }
 * ```
 * 
 * ### Example 2: Discount Validation
 * **Salesforce Formula:**
 * ```
 * Discount__c > (Amount__c * 0.40)
 * ```
 * 
 * **ObjectStack Equivalent:**
 * ```typescript
 * {
 *   type: 'cross_field',
 *   name: 'discount_limit',
 *   condition: 'discount > (amount * 0.40)',
 *   fields: ['discount', 'amount'],
 *   message: 'Discount cannot exceed 40% of the amount'
 * }
 * ```
 * 
 * ### Example 3: Opportunity Must Have Products
 * **Salesforce Formula:**
 * ```
 * ISBLANK(Products__c) && ISPICKVAL(StageName, "Closed Won")
 * ```
 * 
 * **ObjectStack Equivalent:**
 * ```typescript
 * {
 *   type: 'cross_field',
 *   name: 'products_required_for_won',
 *   condition: 'products = null AND stage = "closed_won"',
 *   fields: ['products', 'stage'],
 *   message: 'Opportunity must have products to be marked as Closed Won'
 * }
 * ```
 */
// NOTE: `cross_field` shares the exact evaluation path as `script` — both dispatch
// to the same predicate checker. `fields` is advisory: only `fields[0]` is read, to
// label which field the violation attaches to (a `script` rule attaches to `_record`);
// `fields[1..]` are documentation only. Prefer `script` unless you want the error
// targeted at a specific field. Kept as a distinct variant for that field-targeting
// affordance and for backward compatibility.
export const CrossFieldValidationSchema = lazySchema(() => strictObject({
  surface: 'this cross-field validation rule',
  history:
    'Until this shape was closed these were dropped silently — the rule still registered and ran, minus whatever the key was meant to configure.',
  aliases: { formula: 'condition', expression: 'condition' },
}, {
  ...BASE_VALIDATION_SHAPE,
  type: z.literal('cross_field'),
  condition: ExpressionInputSchema.describe('Predicate (CEL) comparing fields. e.g. P`record.end_date > record.start_date`'),
  fields: z.array(z.string()).describe('Fields involved. Only fields[0] is read (labels which field the violation attaches to); the rest are advisory. Shares script’s evaluation path.'),
}));

/**
 * 5. JSON Structure Validation
 * Validates JSON fields against a JSON Schema.
 * 
 * ## Use Cases
 * - Validating configuration objects stored in JSON fields
 * - Enforcing API payload structures
 * - Complex nested data validation
 */
export const JSONValidationSchema = lazySchema(() => strictObject({
  surface: 'this JSON-schema validation rule',
  history:
    'Until this shape was closed these were dropped silently — the rule still registered and ran, minus whatever the key was meant to configure.',
  aliases: { jsonschema: 'schema', fieldname: 'field' },
}, {
  ...BASE_VALIDATION_SHAPE,
  type: z.literal('json_schema'),
  field: z.string().describe('JSON field to validate'),
  schema: z.record(z.string(), z.unknown()).describe('JSON Schema object definition'),
}));



/**
 * 6. Master Validation Rule Schema
 */
/** Base type for validation rules - used for z.lazy() recursive type annotation */
export interface BaseValidationRuleShape {
  type: string;
  name: string;
  message: string;
  label?: string;
  description?: string;
  active?: boolean;
  events?: ('insert' | 'update')[];
  priority?: number;
  tags?: string[];
  severity?: 'error' | 'warning' | 'info';
  [key: string]: unknown;
}

/**
 * Both type arguments are given (#4195) so `z.input` is not `unknown` —
 * validation rules are hand-authored, and an `unknown` input type means nothing
 * checks what an author writes.
 *
 * Read {@link BaseValidationRuleShape} before trusting the result: it carries a
 * `[key: string]: unknown` index signature, so it types the KNOWN keys and
 * accepts any others. That is a real improvement over `unknown` (which types
 * nothing) but it is not strictness — the discriminated union below is what
 * actually rejects a malformed rule, at parse time. Removing the index
 * signature is the #4075 family of work, not this change.
 */
export const ValidationRuleSchema: z.ZodType<BaseValidationRuleShape, BaseValidationRuleShape> = z.lazy(() =>
  z.discriminatedUnion('type', [
    ScriptValidationSchema,
    StateMachineValidationSchema,
    FormatValidationSchema,
    CrossFieldValidationSchema,
    JSONValidationSchema,
    ConditionalValidationSchema,
  ])
);

/**
 * 7. Conditional Validation
 * Validation that only applies when a condition is met.
 * 
 * ## Overview
 * Conditional validations follow the pattern: "Validate X only if Y is true"
 * This allows for context-aware validation rules that adapt to different scenarios.
 * 
 * ## Use Cases
 * 
 * ### 1. Validate Based on Record Type
 * Apply different validation rules based on the type of record.
 * ```typescript
 * {
 *   type: 'conditional',
 *   name: 'enterprise_approval_required',
 *   when: 'account_type = "enterprise"',
 *   message: 'Enterprise validation',
 *   then: {
 *     type: 'script',
 *     name: 'require_approval',
 *     message: 'Enterprise accounts require manager approval',
 *     condition: 'approval_status = null'
 *   }
 * }
 * ```
 * 
 * ### 2. Conditional Field Requirements
 * Require certain fields only when specific conditions are met.
 * ```typescript
 * {
 *   type: 'conditional',
 *   name: 'shipping_address_when_required',
 *   when: 'requires_shipping = true',
 *   message: 'Shipping validation',
 *   then: {
 *     type: 'script',
 *     name: 'shipping_address_required',
 *     message: 'Shipping address is required for physical products',
 *     condition: 'shipping_address = null OR shipping_address = ""'
 *   }
 * }
 * ```
 * 
 * ### 3. Amount-Based Validation
 * Apply different rules based on transaction amount.
 * ```typescript
 * {
 *   type: 'conditional',
 *   name: 'high_value_approval',
 *   when: 'order_total > 10000',
 *   message: 'High value order validation',
 *   then: {
 *     type: 'script',
 *     name: 'manager_approval_required',
 *     message: 'Orders over $10,000 require manager approval',
 *     condition: 'manager_approval_id = null'
 *   },
 *   otherwise: {
 *     type: 'script',
 *     name: 'standard_validation',
 *     message: 'Payment method is required',
 *     condition: 'payment_method = null'
 *   }
 * }
 * ```
 * 
 * ### 4. Regional Compliance
 * Apply region-specific validation rules.
 * ```typescript
 * {
 *   type: 'conditional',
 *   name: 'regional_compliance',
 *   when: 'region = "EU"',
 *   message: 'EU compliance validation',
 *   then: {
 *     type: 'script',
 *     name: 'gdpr_consent',
 *     message: 'GDPR consent is required for EU customers',
 *     condition: 'gdpr_consent_given = false'
 *   },
 *   otherwise: {
 *     type: 'script',
 *     name: 'tos_acceptance',
 *     message: 'Terms of Service acceptance required',
 *     condition: 'tos_accepted = false'
 *   }
 * }
 * ```
 * 
 * ### 5. Nested Conditional Validation
 * Create complex validation logic with nested conditions.
 * ```typescript
 * {
 *   type: 'conditional',
 *   name: 'country_state_validation',
 *   when: 'country = "US"',
 *   message: 'US-specific validation',
 *   then: {
 *     type: 'conditional',
 *     name: 'california_validation',
 *     when: 'state = "CA"',
 *     message: 'California-specific validation',
 *     then: {
 *       type: 'script',
 *       name: 'ca_tax_id_required',
 *       message: 'California requires a valid tax ID',
 *       condition: 'tax_id = null OR NOT(REGEX(tax_id, "^\\d{2}-\\d{7}$"))'
 *     }
 *   }
 * }
 * ```
 * 
 * ### 6. Tax Validation for Taxable Items
 * Only validate tax fields when the item is taxable.
 * ```typescript
 * {
 *   type: 'conditional',
 *   name: 'tax_field_validation',
 *   when: 'is_taxable = true',
 *   message: 'Tax validation',
 *   then: {
 *     type: 'script',
 *     name: 'tax_code_required',
 *     message: 'Tax code is required for taxable items',
 *     condition: 'tax_code = null OR tax_code = ""'
 *   }
 * }
 * ```
 * 
 * ### 7. Role-Based Validation
 * Apply validation based on user role.
 * ```typescript
 * {
 *   type: 'conditional',
 *   name: 'role_based_approval_limit',
 *   when: 'user_role = "manager"',
 *   message: 'Manager approval limits',
 *   then: {
 *     type: 'script',
 *     name: 'manager_limit',
 *     message: 'Managers can approve up to $50,000',
 *     condition: 'approval_amount > 50000'
 *   }
 * }
 * ```
 * 
 * ## Salesforce Pattern Comparison
 * 
 * Salesforce doesn't have explicit "conditional validation" rules but achieves similar
 * behavior using formula logic. ObjectStack makes this pattern explicit and composable.
 * 
 * **Salesforce Approach:**
 * ```
 * IF(
 *   ISPICKVAL(Type, "Enterprise"),
 *   AND(Amount > 100000, ISBLANK(Approval__c)),
 *   FALSE
 * )
 * ```
 * 
 * **ObjectStack Approach:**
 * ```typescript
 * {
 *   type: 'conditional',
 *   name: 'enterprise_high_value',
 *   when: 'type = "enterprise"',
 *   then: {
 *     type: 'cross_field',
 *     name: 'amount_approval',
 *     condition: 'amount > 100000 AND approval = null',
 *     fields: ['amount', 'approval']
 *   }
 * }
 * ```
 */
export const ConditionalValidationSchema = lazySchema(() => strictObject({
  surface: 'this conditional validation rule',
  history:
    'Until this shape was closed these were dropped silently — the rule still registered and ran, minus whatever the key was meant to configure.',
  aliases: { if: 'when', condition: 'when', match: 'when', else: 'otherwise' },
}, {
  ...BASE_VALIDATION_SHAPE,
  type: z.literal('conditional'),
  when: ExpressionInputSchema.describe('Predicate (CEL). e.g. P`record.type == \'enterprise\'`'),
  then: ValidationRuleSchema.describe('Validation rule to apply when condition is true'),
  otherwise: ValidationRuleSchema.optional().describe('Validation rule to apply when condition is false'),
}));

export type ValidationRule = z.input<typeof ValidationRuleSchema>;
export type ScriptValidation = z.input<typeof ScriptValidationSchema>;
/** Post-parse shape of {@link ScriptValidation} — defaults applied, transforms run (ADR-0122). */
export type ScriptValidationParsed = z.infer<typeof ScriptValidationSchema>;
export type StateMachineValidation = z.input<typeof StateMachineValidationSchema>;
/** Post-parse shape of {@link StateMachineValidation} — defaults applied, transforms run (ADR-0122). */
export type StateMachineValidationParsed = z.infer<typeof StateMachineValidationSchema>;
export type FormatValidation = z.input<typeof FormatValidationSchema>;
/** Post-parse shape of {@link FormatValidation} — defaults applied, transforms run (ADR-0122). */
export type FormatValidationParsed = z.infer<typeof FormatValidationSchema>;
export type CrossFieldValidation = z.input<typeof CrossFieldValidationSchema>;
/** Post-parse shape of {@link CrossFieldValidation} — defaults applied, transforms run (ADR-0122). */
export type CrossFieldValidationParsed = z.infer<typeof CrossFieldValidationSchema>;
export type JSONValidation = z.input<typeof JSONValidationSchema>;
/** Post-parse shape of {@link JSONValidation} — defaults applied, transforms run (ADR-0122). */
export type JSONValidationParsed = z.infer<typeof JSONValidationSchema>;
export type ConditionalValidation = z.input<typeof ConditionalValidationSchema>;
/** Post-parse shape of {@link ConditionalValidation} — defaults applied, transforms run (ADR-0122). */
export type ConditionalValidationParsed = z.infer<typeof ConditionalValidationSchema>;