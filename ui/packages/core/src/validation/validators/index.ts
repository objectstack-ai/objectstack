/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Validators
 *
 * Publishes the @deprecated `ObjectValidationEngine` (#3110). Object-level
 * validation rules are enforcement, and enforcement is single-implementation on
 * the server (`objectql`'s rule-validator); objectui renders the server's
 * rejection rather than predicting it, and pre-submit feedback belongs in a
 * validate-only (dry-run) write. This barrel keeps the API exported for host
 * applications that already depend on it — re-exporting is not wiring, and
 * `validation-engine-stays-unwired.test.ts` enforces that distinction.
 *
 * @module validators
 * @packageDocumentation
 */

export {
  ObjectValidationEngine,
  defaultObjectValidationEngine,
  validateRecord,
  type ObjectValidationContext,
  type ObjectValidationResult,
  type ValidationExpressionEvaluator,
} from './object-validation-engine.js';
