// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Moved to `@objectstack/types` (#8016) — re-exported here so every import site
 * in this package keeps the name it always had.
 *
 * The recogniser had to become reachable from `@objectstack/rest`: the shared
 * thrown-error resolver both `/api/v1/packages` doors now call
 * (`resolveThrownHttpError`) answers "is this throw a validation failure?", and
 * `rest` cannot import `runtime` — runtime depends on rest, so the arrow only
 * points one way. `@objectstack/types` is where the repo already keeps the
 * helpers every HTTP boundary shares.
 *
 * The module's own argument — why the predicate duck-types on `code`/`name`
 * rather than importing objectql's `ValidationError`, and why the constructor
 * sits beside the recogniser so the two cannot drift — travelled with it. Read
 * it there: `packages/types/src/validation-failure.ts`.
 */

export {
    VALIDATION_FAILED_STATUS,
    validationFailureDetails,
    validationFailure,
    fieldsFromZodIssues,
    type ValidationFailureDetails,
} from '@objectstack/types';
