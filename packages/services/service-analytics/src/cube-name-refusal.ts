// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ANALYTICS_CUBE_NAME_REQUIRED, type FieldErrorCode } from '@objectstack/spec/api';
import { validationFailure, VALIDATION_FAILED_STATUS } from '@objectstack/types';

/**
 * The ONE refusal for an analytics query that names no cube — `cube` absent or
 * the empty string — thrown by `AnalyticsService.query` (through `queryIn`) and
 * `AnalyticsService.generateSql` before any other gate runs.
 *
 * ## Why a typed refusal, and why its words are the schema's
 *
 * The HTTP doors (`POST /analytics/query`, `POST /analytics/sql`) parse the body
 * with `AnalyticsQueryRequestSchema`, whose `cube` is `z.string().min(1, …)`:
 * a missing or empty name is refused there, `400 VALIDATION_FAILED` with a
 * `fields[]` entry at `cube`, and the engine is never reached. The engine's
 * own guard stays for the callers that do not pass through that schema — a
 * plugin, a flow, a test, anything that holds the service — and the base
 * `AnalyticsQuery` type leaves `cube` optional for them. Until this module the
 * guard threw a plain `Error`, which every boundary maps to a 500: a client
 * input mistake read as a server fault, paged operators and got retried.
 *
 * The refusal is `validationFailure` from `@objectstack/types` — the shape both
 * dispatcher error exits and `resolveThrownHttpError` recognise as
 * `VALIDATION_FAILED` — with `status: 400` declared on it as this service's
 * sibling refusals do (`cubeNotFoundError`, 404), so an in-process caller reads
 * `{ code, status }` without a boundary to decide the status for it. Its
 * sentence is `ANALYTICS_CUBE_NAME_REQUIRED`, imported from the schema that
 * refuses the same input at the door: one rule, one wording, two readers.
 *
 * The `fields[]` entry carries the ADR-0114 catalog code the door produces
 * for the same input — `required` for an absent `cube` (the door hands the
 * body to `fieldsFromZodIssues`, so the D3 split reports a missing key as
 * `required`), `min_length` for the empty string (Zod's `too_small` on a
 * string, mapped by `zodIssuesToFields`) — so a UI anchoring per-field errors
 * sees one vocabulary whichever side refused. `analytics-empty-cube-refusal.test.ts`
 * (runtime) pins the door's half, `analytics-service.test.ts` this one.
 *
 * ⛔ A whitespace-only name is NOT refused here: it is a name, one no cube
 * carries, and the engine's cube resolution answers it `CUBE_NOT_FOUND` / 404.
 * Refusing it would be a second rule beside the schema's `.min(1)`.
 */
export function cubeNameRequiredError(cube: unknown): Error & { code: string; status: number } {
  // Only a string can be too short; anything else that `!queryInput.cube`
  // let through (`undefined`, or a `null` from an untyped caller) is absent.
  const code: FieldErrorCode = typeof cube === 'string' ? 'min_length' : 'required';
  const err = validationFailure(ANALYTICS_CUBE_NAME_REQUIRED, [
    { field: 'cube', code, message: ANALYTICS_CUBE_NAME_REQUIRED },
  ]) as Error & { code: string; status: number };
  err.status = VALIDATION_FAILED_STATUS;
  return err;
}
