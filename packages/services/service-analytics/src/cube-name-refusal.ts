// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ANALYTICS_CUBE_NAME_REQUIRED, AnalyticsQueryRequestSchema } from '@objectstack/spec/api';
import { fieldsFromZodIssues, validationFailure, VALIDATION_FAILED_STATUS } from '@objectstack/types';

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
 * message is `ANALYTICS_CUBE_NAME_REQUIRED`, the sentence the schema refuses
 * the empty string with: one rule, one wording, two readers.
 *
 * ## The `fields[]` entry is the door's, literally
 *
 * The value is run through the schema's own `cube` member and the issues
 * through `fieldsFromZodIssues` with the value beside them — the one ADR-0114
 * D3 table in the repo (`zodIssuesToFields`, `@objectstack/spec`), the same
 * call the door makes on the whole body. So the entry's code is whatever the
 * door answers for the same value — `required` for an absent key, `min_length`
 * for the empty string, `invalid_type` for a `null` an untyped caller slipped
 * past `!queryInput.cube` — and its message is the member's own. ⛔ No
 * hand-rolled `typeof` split here: a second copy of that table is the drift
 * the ADR exists to prevent, and it disagreed with the door on `null` once.
 * `analytics-empty-cube-refusal.test.ts` (runtime) pins the door's half,
 * `analytics-service.test.ts` this one.
 *
 * ⛔ A whitespace-only name is NOT refused here: it is a name, one no cube
 * carries, and the engine's cube resolution answers it `CUBE_NOT_FOUND` / 404.
 * Refusing it would be a second rule beside the schema's `.min(1)`.
 */
export function cubeNameRequiredError(cube: unknown): Error & { code: string; status: number } {
  const verdict = AnalyticsQueryRequestSchema.shape.cube.safeParse(cube);
  const issues = verdict.success
    ? []
    : verdict.error.issues.map((issue) => ({ ...issue, path: ['cube', ...issue.path] }));
  const err = validationFailure(ANALYTICS_CUBE_NAME_REQUIRED, fieldsFromZodIssues(issues, { cube })) as Error & {
    code: string;
    status: number;
  };
  err.status = VALIDATION_FAILED_STATUS;
  return err;
}
