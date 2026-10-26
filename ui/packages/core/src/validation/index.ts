/**
 * @object-ui/core - Validation Module
 * 
 * Phase 3.5: Validation module
 *
 * Object-level validation. The rule vocabulary is owned by
 * `@objectstack/spec/data` and derived in `@object-ui/types`; canonicity is
 * carried by that derivation and its parity gate, not by this comment.
 *
 * The object-level rule ENGINE (`validators/`) is @deprecated (#3110) — the
 * server is the single implementation of rule enforcement. Field/record SHAPE
 * validation (`schema-validator.js`) is unaffected: it is client-side form
 * validation, not a mirror of a server rule.
 *
 * The field-rule engine that once sat beside it (`ValidationEngine`, a second
 * snake_case rule vocabulary no renderer consumed) was retired under ADR-0049
 * enforce-or-remove (objectui#7659). Client-side field rules are compiled by
 * `buildValidationRules` in `@object-ui/fields`.
 */

export * from './required-presence.js';
export * from './server-owned-value.js';
export * from './schema-validator.js';
export * from './validators/index.js';
