// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The door parse for `POST {basePath}/analytics/dataset/query`'s `selection`.
 *
 * ## The gap, and the two rounds that closed it
 *
 * ⚠️ The first round is cited by its PULL REQUEST throughout this file. The card
 * it closed is no longer on this board — `check:issue-citations` classes that
 * number `allocated-but-absent`, and deleted-vs-transferred is NOT MEASURED —
 * so PR #17548 is the live record, and its own body names the card it closed.
 *
 * [PR #17548] `/analytics/query` and `/analytics/sql` Zod-parse their body at the
 * entry (`runtime/src/domains/analytics.ts` → `assertAnalyticsQueryBody`) and
 * lift a malformed member to a 400 before the service is reached. The dataset
 * route checked only that `selection.measures` was a non-empty array, so every
 * other member travelled into `dataset-executor` unrefused and was answered by
 * whatever the face behind it happened to do with it. That is the same door,
 * one family, two postures — the inconsistency a client cannot predict.
 *
 * That PR's own answer was PARTIAL and said so: `DatasetSelection` had no Zod
 * schema anywhere in the repo, so this module parsed a PROJECTION — the seven
 * members whose declarations coincide with `AnalyticsQuery`'s — and
 * deliberately projected the four dataset-only members (`runtimeFilter`,
 * `dateGranularity`, `compareTo`, `totals`) AWAY. Reusing the siblings' schema
 * for the whole selection was ⛔ not available and that was measured rather
 * than assumed: `AnalyticsQueryRequestSchema` requires `cube` (a dataset
 * selection carries none — the dataset is addressed by `body.dataset` /
 * `body.datasetName`) and is `.strict()`, so a legal selection failed it on
 * `cube` **plus** all four members above, which would have 400'd every real
 * dashboard widget.
 *
 * [#17551, ruled — decision batch #204 item 3, letter A] The missing half is
 * now declared where it belongs: `DatasetSelectionSchema`
 * (`@objectstack/spec/api`, beside the `AnalyticsQueryRequestSchema` the
 * sibling routes parse) is the ONE declaration of this wire shape, and
 * `@objectstack/spec/contracts` re-exports its type rather than carrying a
 * second interface. So this module parses the **whole** selection against it,
 * and the projection is gone.
 *
 * ⛔ Assembling the missing members out of spec-exported parts HERE was
 * refused by name in that ruling: it is exactly the second declaration of a
 * spec-owned wire shape Prime Directive #12 exists to prevent. This module
 * owns the ENVELOPE — which refusal shape a failure lands in, and how a field
 * path is spelled against the request body — and owns no part of the contract.
 *
 * ## The refusal shapes
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
 * The same convention governs the newly-doored members, and it is why no
 * sentence about them is written here either: an unrecognised `compareTo.kind`
 * answers {@link datasetCompareKindRefusalMessage}, the builder
 * `service-analytics`'s `shiftRange` also raises for the in-process caller that
 * never posted a body, and every unknown-key refusal is the schema's own
 * `strictObject` prescription.
 *
 * The `message` is built the way the sibling builds it — `<field>: <message>`
 * joined — over `fieldsFromZodIssues` (`@objectstack/types`), which is
 * `zodIssuesToFields`, the one ADR-0114 D3 mapper, plus the two things every
 * HTTP boundary owes on top of it: the root-path rename, and [#17598] the drop
 * of the date-range union's own arm RESTATEMENT, so an arity refusal reaches
 * the wire with ONE wording rather than the prescription followed by zod's
 * `Too small: expected array to have >=2 items`. That collapse lives in the one
 * mapper both analytics doors share, ⛔ never as a second copy here.
 *
 * ⚠️ The root rename is LIVE here since #17551 and was inert before it. The
 * projection was an object this module built out of declared members only, so
 * no issue of that parse could land at the root; the full selection is
 * `.strict()`, and an unrecognized-keys issue lands at exactly the root. The
 * mapper spells that position `(body)`, which is true for the sibling routes —
 * their body IS the query — and false here, where the parsed object sits under
 * `selection`. So the root is re-spelled `selection` and every deeper path is
 * prefixed `selection.`, because both are reported against the REQUEST body.
 *
 * Validation-only: the caller's `selection` is forwarded to the service
 * untouched, never the parse output — the rule `assertAnalyticsQueryBody`
 * records for the same reason (a default someone adds to the schema later must
 * not silently override the engine's own resolution chain).
 */

import { fieldsFromZodIssues } from '@objectstack/types';
import { analyticsDateRangeUnrecognizedError } from '@objectstack/core';

/** A door refusal, ready for `res.status(...).json(...)`. */
export interface DatasetSelectionRefusal {
    status: number;
    body: Record<string, unknown>;
}

/**
 * Built on first use and memoised — `@objectstack/spec/api` stays off this
 * module's init path, the same lazy `await import` the analytics route already
 * performs for `DatasetSchema`.
 */
let selectionSchema: { safeParse(input: unknown): any } | undefined;

async function getSelectionSchema(): Promise<{ safeParse(input: unknown): any }> {
    if (!selectionSchema) {
        const { DatasetSelectionSchema } = await import('@objectstack/spec/api');
        selectionSchema = DatasetSelectionSchema as unknown as { safeParse(input: unknown): any };
    }
    return selectionSchema!;
}

/**
 * Parse a dataset `selection` and describe the refusal, or `undefined` when the
 * selection passes.
 *
 * A non-object `selection` answers `undefined`: the route's own check ahead of
 * this one (`selection.measures` must be a non-empty array) already owns that
 * case and answers it with a message naming the member, which is the better
 * sentence for by far the most common mistake.
 */
export async function datasetSelectionRefusal(
    selection: unknown,
): Promise<DatasetSelectionRefusal | undefined> {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return undefined;

    const schema = await getSelectionSchema();
    const parsed = schema.safeParse(selection);
    if (parsed.success) return undefined;

    const issues: Array<{
        code: string;
        path: Array<string | number | symbol>;
        message: string;
        input?: unknown;
    }> = parsed.error.issues;
    const fields = fieldsFromZodIssues(issues, selection).map((entry) => ({
        ...entry,
        // `(body)` is the mapper's name for the ROOT, correct on the sibling
        // routes whose body IS the parsed object and wrong here, where it sits
        // one level down under `selection`.
        field: entry.field === '(body)' ? 'selection' : `selection.${entry.field}`,
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
