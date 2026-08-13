// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/analytics` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-2). Bridges to whatever provides the `analytics` service slot — in
 * practice the service-analytics engine, the slot's ONE implementation since
 * the degraded ObjectQL fallback was retired (#3891: it dropped the caller's
 * ExecutionContext and the contract `where` filter). Route registration stays
 * dispatcher-owned so the URL contract is stable regardless of what occupies
 * the slot; an empty slot answers the `handled: false` 404 below — as does a
 * slot occupied by a self-declared stub (#4000, see {@link isServiceServeable},
 * the shared predicate every service domain reads since #4058).
 */

import { CoreServiceName } from '@objectstack/spec/system';
import { AnalyticsQueryRequestSchema } from '@objectstack/spec/api';
import { isServiceServeable } from '../service-serveable.js';
import { validationFailure, fieldsFromZodIssues } from '../validation-failure.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

// [#3878] `validationFailure` — the duck-typed shape both dispatcher error
// exits map to 400 `VALIDATION_FAILED` + `details.fields[]` (#3918) — began
// life inline here; it lives in `../validation-failure.js` now, next to the
// recogniser, shared with the notifications/automation entry gates (#3899).

/**
 * [#3878] Reject a malformed `AnalyticsQuery` body AT THE ENTRY with a 400
 * naming what is wrong, instead of letting it reach the engine — where a
 * shapeless body used to infer a column-less cube and die as an SQL syntax
 * error deep in the driver (`SELECT  FROM …`), or worse, have its off-contract
 * filter key silently ignored.
 *
 * The retired `{ cube, query: {...} }` envelope (#3891 shim dialect) needs no
 * special case here: the schema tombstones `query`/`format` (`retiredKey`),
 * so the Zod issue itself carries the migration prescription. Only `filters` —
 * never a declared key, so `.strict()` would answer a generic
 * "unrecognized key" — gets a bespoke hint at the contract field `where`.
 *
 * Validation only — the ORIGINAL body is forwarded to the service untouched.
 * (Historically load-bearing: the schema carried a `timezone: 'UTC'` default
 * that parsing would have injected, silently overriding the engine's
 * org-timezone resolution, #1982/#2018. #4538 removed that default from
 * `AnalyticsQuerySchema` itself — the schema is transform-free now, so
 * validated body ≡ parsed output by construction — but forwarding the
 * original body stays the rule: it keeps this entry immune to any future
 * default someone adds to the schema without re-reading this file.)
 */
function assertAnalyticsQueryBody(body: unknown): void {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        const b = body as Record<string, unknown>;
        if ('filters' in b && !('where' in b)) {
            throw validationFailure(
                '`filters` is not an AnalyticsQuery field — use `where` (canonical Query DSL FilterCondition, the same shape find() takes).',
                // `unknown_field` — the ADR-0114 catalog member for "a key the
                // target does not declare"; this entry used to hand-spell Zod's
                // `unrecognized_keys`, a code outside the closed catalog (#8124).
                [{ field: 'filters', code: 'unknown_field', message: 'use `where` instead of `filters`' }],
            );
        }
    }
    const parsed = AnalyticsQueryRequestSchema.safeParse(body);
    if (!parsed.success) {
        const fields = fieldsFromZodIssues(parsed.error.issues);
        throw validationFailure(
            `Invalid AnalyticsQuery body: ${fields.map((f) => `${f.field}: ${f.message}`).join('; ')}`,
            fields,
        );
    }
}

export function createAnalyticsDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/analytics',
        handler: (req, context) =>
            handleAnalyticsRequest(deps, req.path.substring(10), req.method, req.body, context, req.query),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleAnalytics`. */
export async function handleAnalyticsRequest(
    deps: DomainHandlerDeps,
    path: string,
    method: string,
    body: any,
    context: HttpProtocolContext,
    query?: any,
): Promise<HttpDispatcherResult> {
    const analyticsService = await deps.getService(context, CoreServiceName.enum.analytics);
    // Empty slot — or a slot filled by a self-declared stub (#4000), which is
    // the same amount of analytics capability. 404 handled by caller.
    if (!isServiceServeable(analyticsService)) return { handled: false };

    const m = method.toUpperCase();
    const subPath = path.replace(/^\/+/, '');

    // POST /analytics/query
    if (subPath === 'query' && m === 'POST') {
        // [#3878] Entry validation AFTER the service check on purpose: an
        // uninstalled analytics capability answers 404 (the honest "install
        // service-analytics" signal, #3891) regardless of body shape.
        assertAnalyticsQueryBody(body);
        // [#2852] Pass the request's execution context so the analytics
        // service scopes each object by its per-object read filter (tenant +
        // RLS). Without it, `getReadScope(object, undefined)` returned no
        // filter and the query ran UNSCOPED — an authenticated caller saw
        // rows RLS would otherwise hide.
        const result = await analyticsService.query(body, context?.executionContext);
        return { handled: true, response: deps.success(result) };
    }

    // GET /analytics/meta[?cube=<name>]
    if (subPath === 'meta' && m === 'GET') {
        // [#3584] Optional single-cube filter. `AnalyticsService.getMeta`
        // already accepts `cubeName?`; an implementation that ignores the
        // argument keeps returning the full listing, which is still correct.
        const cube = typeof query?.cube === 'string' && query.cube !== '' ? query.cube : undefined;
        const result = await analyticsService.getMeta(cube);
        return { handled: true, response: deps.success(result) };
    }

    // POST /analytics/sql (Dry-run or debug)
    if (subPath === 'sql' && m === 'POST') {
        // [#3878] Same body contract as /query — validated the same way.
        assertAnalyticsQueryBody(body);
        // [#4127] `generateSql` is OPTIONAL on `IAnalyticsService` — unlike
        // `query` / `getMeta` above, which are required — and this call had no
        // guard, so a provider filling the slot without it answered a 500 from
        // `TypeError: generateSql is not a function` instead of saying the
        // capability is absent. service-analytics implements it, which is why
        // nothing noticed; the contract permits a provider that does not, and
        // the registry names this slot as multi-provider by design.
        //
        // `handled: false` is the file's own answer for absent analytics
        // capability (the entry gate above), so an absent SUB-capability gets
        // the same 404 rather than a new third shape.
        if (typeof analyticsService.generateSql !== 'function') return { handled: false };
        // [#2852] Scope the generated SQL to the caller too, so a preview
        // reflects the same per-object read filter the real query applies.
        const result = await analyticsService.generateSql(body, context?.executionContext);
        return { handled: true, response: deps.success(result) };
    }

    return { handled: false };
}
