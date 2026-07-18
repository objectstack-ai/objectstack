// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

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
 * (`multi: true`) update, where the evaluator runs once per matched row (#3106). One known gap:
 * rules declaring `events: ['delete']` are not yet evaluated on delete (tracked separately).
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
 * - **Uniqueness** → a unique **index** (`ObjectSchema.indexes`, `{ fields, unique: true }`,
 *   with `partial` for a scoped/conditional constraint), or field-level `unique: true`. A
 *   SELECT-then-INSERT "rule" is inherently racy (TOCTOU); a DB unique constraint is not.
 * - **Async / remote validation** → a client-form concern (`debounce`/`validatorUrl` only mean
 *   anything against keystrokes) and an SSRF/latency hazard on the server write path. Keep it in
 *   the form layer, or enforce the underlying invariant with a `unique` index / lifecycle hook.
 * - **Custom handler** → a `beforeInsert` / `beforeUpdate` lifecycle hook, the typed, supported
 *   extension point for arbitrary validation code.
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
 */
import { lazySchema } from '../shared/lazy-schema';
const BaseValidationSchema = z.object({
  // Identification
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Unique rule name (snake_case)'),
  label: z.string().optional().describe('Human-readable label for the rule listing'),
  description: z.string().optional().describe('Administrative notes explaining the business reason'),
  
  // Execution Control
  active: z.boolean().default(true),
  events: z.array(z.enum(['insert', 'update', 'delete'])).default(['insert', 'update']).describe('Validation contexts'),
  priority: z.number().int().min(0).max(9999).default(100).describe('Execution priority (lower runs first, default: 100)'),
  
  // Classification
  tags: z.array(z.string()).optional().describe('Categorization tags (e.g., "compliance", "billing")'),
  
  // Feedback
  severity: z.enum(['error', 'warning', 'info']).default('error'),
  message: z.string().describe('Error message to display to the user'),
});

/**
 * 1. Script/Expression Validation
 * Generic formula-based validation.
 */
export const ScriptValidationSchema = lazySchema(() => BaseValidationSchema.extend({
  type: z.literal('script'),
  condition: ExpressionInputSchema.describe('Predicate (CEL). If TRUE, validation fails. e.g. P`record.amount < 0`'),
}));

/**
 * 2. State Machine Validation
 * State transition logic.
 */
export const StateMachineValidationSchema = lazySchema(() => BaseValidationSchema.extend({
  type: z.literal('state_machine'),
  field: z.string().describe('State field (e.g. status)'),
  transitions: z.record(z.string(), z.array(z.string())).describe('Map of { OldState: [AllowedNewStates] }'),
  initialStates: z.array(z.string()).optional().describe('States a record may be CREATED in. When set, an INSERT whose state field carries a value outside this list is rejected (server-enforced) — the FSM entry point. `transitions` only governs UPDATE, and a `select` field permits ANY declared option as an initial value, so without this a record could be born mid-flow (e.g. created already `approved`). Omit to keep the legacy behavior (no initial-state check on insert). #3165.'),
}));

/**
 * 3. Value Format Validation
 * Regex or specialized formats.
 */
export const FormatValidationSchema = lazySchema(() => BaseValidationSchema.extend({
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
export const CrossFieldValidationSchema = lazySchema(() => BaseValidationSchema.extend({
  type: z.literal('cross_field'),
  condition: ExpressionInputSchema.describe('Predicate (CEL) comparing fields. e.g. P`record.end_date > record.start_date`'),
  fields: z.array(z.string()).describe('Fields involved in the validation'),
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
export const JSONValidationSchema = lazySchema(() => BaseValidationSchema.extend({
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
  events?: ('insert' | 'update' | 'delete')[];
  priority?: number;
  tags?: string[];
  severity?: 'error' | 'warning' | 'info';
  [key: string]: unknown;
}

export const ValidationRuleSchema: z.ZodType<BaseValidationRuleShape> = z.lazy(() =>
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
export const ConditionalValidationSchema = lazySchema(() => BaseValidationSchema.extend({
  type: z.literal('conditional'),
  when: ExpressionInputSchema.describe('Predicate (CEL). e.g. P`record.type == \'enterprise\'`'),
  then: ValidationRuleSchema.describe('Validation rule to apply when condition is true'),
  otherwise: ValidationRuleSchema.optional().describe('Validation rule to apply when condition is false'),
}));

export type ValidationRule = z.infer<typeof ValidationRuleSchema>;
export type ScriptValidation = z.infer<typeof ScriptValidationSchema>;
export type StateMachineValidation = z.infer<typeof StateMachineValidationSchema>;
export type FormatValidation = z.infer<typeof FormatValidationSchema>;
export type CrossFieldValidation = z.infer<typeof CrossFieldValidationSchema>;
export type JSONValidation = z.infer<typeof JSONValidationSchema>;
export type ConditionalValidation = z.infer<typeof ConditionalValidationSchema>;