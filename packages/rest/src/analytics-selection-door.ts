// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17058] The door parse for `POST {basePath}/analytics/dataset/query`'s
 * `selection` — the half of the analytics family this route never had.
 *
 * ## The gap
 *
 * `/analytics/query` and `/analytics/sql` Zod-parse their body at the entry
 * (`runtime/src/domains/analytics.ts` → `assertAnalyticsQueryBody`) and lift a
 * malformed member to a 400 before the service is reached. The dataset route
 * checked only that `selection.measures` was a non-empty array, so every other
 * member travelled into `dataset-executor` unrefused and was answered by
 * whatever the face behind it happened to do with it. That is the same door,
 * one family, two postures — the inconsistency a client cannot predict.
 *
 * ## Why this is a PROJECTION and not a reuse of the siblings' schema
 *
 * ⚠️ Measured before writing a line, because the card left it open: **the
 * dataset route's `selection` is NOT the sibling routes' shape.** It is
 * `DatasetSelection` (`spec/contracts/analytics-service.ts`), and against
 * `AnalyticsQueryRequestSchema` a perfectly legal selection fails twice over —
 * the sibling schema requires `cube` (a dataset selection never carries one:
 * the dataset is addressed by `body.dataset` / `body.datasetName`) and it is
 * `.strict()`, so `runtimeFilter`, `dateGranularity`, `compareTo` and `totals`
 * are all rejected as unrecognized keys. ⛔ Reusing it would refuse every real
 * dashboard widget — a far worse defect than the one being fixed.
 *
 * What IS shared is member-by-member, and it is most of the shape. Seven of
 * `DatasetSelection`'s eleven members declare exactly the type the
 * `AnalyticsQuery` member of the same name declares:
 *
 * | member | `DatasetSelection` | `AnalyticsQuery` |
 * |:---|:---|:---|
 * | `dimensions` | `string[]?` | `string[]?` |
 * | `measures` | `string[]` | `string[]` |
 * | `timeDimensions` | `AnalyticsQuery['timeDimensions']` — declared BY REFERENCE | itself |
 * | `order` | `Record<string, 'asc' \| 'desc'>?` | same |
 * | `limit` / `offset` | `number?` | same |
 * | `timezone` | `string?` | same |
 *
 * So parsing those seven against `AnalyticsQuerySchema.pick(…)` enforces the
 * contract `DatasetSelection` already declares — a pull-back onto published
 * text, never a narrowing past it. The four dataset-only members
 * (`runtimeFilter`, `dateGranularity`, `compareTo`, `totals`) are PROJECTED
 * AWAY before the parse, deliberately: `.pick()` carries `.strict()` through,
 * so handing the raw selection to the picked schema would reject them.
 *
 * ⚠️ Those four therefore still have no door. `DatasetSelection` is a
 * TypeScript interface with no Zod schema anywhere in the repo, and authoring
 * one belongs in `packages/spec` beside the interface (Prime Directive #1),
 * not here in a consumer — a second declaration of a spec-owned wire shape is
 * the dialect Prime Directive #12 exists to prevent. Filed separately; this
 * module is deliberately the derivable half.
 *
 * ## The refusal shapes, and why the date-range code is not spelled here
 *
 * Two answers, matching the family:
 *
 * - Every issue is the closed-vocabulary `timeDimensions[].dateRange` refusal
 *   ⇒ `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED`, the ADR-0112 envelope the
 *   sibling door answers for the identical condition. All-or-nothing, exactly
 *   as `assertAnalyticsQueryBody` lifts it: a body wrong in several places
 *   stays the generic failure, whose per-field carrier is the right one there.
 * - Anything else ⇒ `400 VALIDATION_FAILED` + `details.fields[]`, the shape
 *   this route's two neighbouring hand-built doors already answer with.
 *
 * ⛔ The date-range code is read off {@link analyticsDateRangeUnrecognizedError}
 * — `@objectstack/core`'s ONE constructor for this refusal — and never spelled
 * as a literal in this package. Two reasons, and both are load-bearing:
 * ADR-0112 D3 registers the code under `@objectstack/runtime` (the door that
 * names the wire vocabulary) with a recorded provenance waiver for `core`'s
 * shared constructor, so a literal here would be a stamp site under an owner
 * key that does not list it; and the #5240 convention wants one condition to
 * keep one wording, which a second spelling quietly ends. That constructor's
 * own TSDoc names this route as the caller it was waiting for.
 *
 * The `message` is built the way the sibling builds it — `<field>: <message>`
 * joined — over `zodIssuesToFields`, the one ADR-0114 D3 mapper. Field paths
 * are prefixed `selection.` because they are reported against the REQUEST
 * body, where the parsed object sits one level down.
 *
 * Validation-only: the caller's `selection` is forwarded to the service
 * untouched, never the parse output — the rule `assertAnalyticsQueryBody`
 * records for the same reason (a default someone adds to the schema later must
 * not silently override the engine's own resolution chain).
 */

import { zodIssuesToFields } from '@objectstack/spec/api';
import { analyticsDateRangeUnrecognizedError } from '@objectstack/core';

/**
 * The `DatasetSelection` members whose declared type IS the `AnalyticsQuery`
 * member of the same name — the projection this door parses.
 *
 * ⛔ Adding a member here is a claim about the two declarations agreeing:
 * check `DatasetSelection` in `spec/contracts/analytics-service.ts` against
 * `AnalyticsQuerySchema` in `spec/data/analytics.zod.ts` first. A member that
 * only LOOKS alike (`runtimeFilter` vs `where` — same `FilterCondition`, a
 * different key on each side) does not belong: this list is what makes the
 * parse a pull-back rather than a new contract. `.pick()` is type-checked
 * against the schema, so a member that leaves `AnalyticsQuery` fails the
 * build here rather than silently dropping out of coverage.
 */
export const SELECTION_MEMBERS_SHARED_WITH_ANALYTICS_QUERY = [
    'dimensions',
    'measures',
    'timeDimensions',
    'order',
    'limit',
    'offset',
    'timezone',
] as const;

/** A door refusal, ready for `res.status(...).json(...)`. */
export interface DatasetSelectionRefusal {
    status: number;
    body: Record<string, unknown>;
}

/**
 * Built on first use and memoised — `@objectstack/spec/data` stays off this
 * module's init path, the same lazy `await import` the analytics route already
 * performs for `DatasetSchema`.
 */
let sharedSelectionSchema: { safeParse(input: unknown): any } | undefined;

async function getSharedSelectionSchema(): Promise<{ safeParse(input: unknown): any }> {
    if (!sharedSelectionSchema) {
        const { AnalyticsQuerySchema } = await import('@objectstack/spec/data');
        sharedSelectionSchema = (AnalyticsQuerySchema as any).pick({
            dimensions: true,
            measures: true,
            timeDimensions: true,
            order: true,
            limit: true,
            offset: true,
            timezone: true,
        });
    }
    return sharedSelectionSchema!;
}

/**
 * Parse the shared members of a dataset `selection` and describe the refusal,
 * or `undefined` when the selection passes.
 *
 * A non-object `selection` answers `undefined`: the route's own check ahead of
 * this one (`selection.measures` must be a non-empty array) already owns that
 * case and answers it with a message naming the member, which is the better
 * sentence for by far the most common mistake. This function is about the
 * members that had no door at all.
 */
export async function datasetSelectionRefusal(
    selection: unknown,
): Promise<DatasetSelectionRefusal | undefined> {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return undefined;

    const source = selection as Record<string, unknown>;
    const projection: Record<string, unknown> = {};
    for (const member of SELECTION_MEMBERS_SHARED_WITH_ANALYTICS_QUERY) {
        if (member in source) projection[member] = source[member];
    }

    const schema = await getSharedSelectionSchema();
    const parsed = schema.safeParse(projection);
    if (parsed.success) return undefined;

    const issues: Array<{ code: string; path: ReadonlyArray<PropertyKey>; input?: unknown }> =
        parsed.error.issues;
    const fields = zodIssuesToFields(issues, projection).map((entry) => ({
        ...entry,
        field: `selection.${entry.field}`,
    }));
    const message = `Invalid dataset selection: ${fields
        .map((f) => `${f.field}: ${f.message}`)
        .join('; ')}`;

    const { isAnalyticsDateRangeRefusalIssue } = await import('@objectstack/spec/data');
    if (issues.length > 0 && issues.every((issue) => isAnalyticsDateRangeRefusalIssue(issue))) {
        // The code and status come from the platform's one constructor for this
        // condition; only the sentence is this door's, and it is the family's
        // `<field>: <message>` form over the schema's own prescription.
        const declared = analyticsDateRangeUnrecognizedError(issues[0]?.input) as Error & {
            code?: string;
            status?: number;
        };
        return { status: declared.status ?? 400, body: { code: declared.code, message } };
    }

    return { status: 400, body: { code: 'VALIDATION_FAILED', message, details: { fields } } };
}
