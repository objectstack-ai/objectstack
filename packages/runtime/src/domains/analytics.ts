// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/analytics` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-2). Bridges to whatever provides the `analytics` service slot — in
 * practice the service-analytics engine, the slot's ONE implementation since
 * the degraded ObjectQL fallback was retired (#3891: it dropped the caller's
 * ExecutionContext and the contract `where` filter). Route registration stays
 * dispatcher-owned so the URL contract is stable regardless of what occupies
 * the slot; an empty slot answers the `handled: false` 404 below — as does a
 * slot occupied by a self-declared stub (#4000, see {@link isAnalyticsServiceServeable}).
 */

import { CoreServiceName } from '@objectstack/spec/system';
import { AnalyticsQueryRequestSchema, readServiceSelfInfo } from '@objectstack/spec/api';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * [#3878] The duck-typed validation-failure shape both dispatcher error exits
 * already map to 400 `VALIDATION_FAILED` + `details.fields[]` (see
 * `validation-failure.ts`, #3918) — thrown here so entry validation needs no
 * new error channel and no dependency on objectql's `ValidationError` class.
 */
function validationFailure(message: string, fields: unknown[]): Error {
    const err = new Error(message) as Error & { code: string; fields: unknown[] };
    err.name = 'ValidationError';
    err.code = 'VALIDATION_FAILED';
    err.fields = fields;
    return err;
}

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
 * (Parsing would inject the schema's `timezone: 'UTC'` default and silently
 * override the engine's org-timezone resolution, #1982/#2018.)
 */
function assertAnalyticsQueryBody(body: unknown): void {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        const b = body as Record<string, unknown>;
        if ('filters' in b && !('where' in b)) {
            throw validationFailure(
                '`filters` is not an AnalyticsQuery field — use `where` (canonical Query DSL FilterCondition, the same shape find() takes).',
                [{ field: 'filters', code: 'unrecognized_keys', message: 'use `where` instead of `filters`' }],
            );
        }
    }
    const parsed = AnalyticsQueryRequestSchema.safeParse(body);
    if (!parsed.success) {
        const fields = parsed.error.issues.map((issue) => ({
            field: issue.path.length > 0 ? issue.path.join('.') : '(body)',
            code: issue.code,
            message: issue.message,
        }));
        throw validationFailure(
            `Invalid AnalyticsQuery body: ${fields.map((f) => `${f.field}: ${f.message}`).join('; ')}`,
            fields,
        );
    }
}

/**
 * [#4000] Is the thing occupying the `analytics` slot something we may call
 * like a real engine?
 *
 * ADR-0076 D12 gave services a way to self-declare that they are a stub or a
 * degraded fallback, and its third conclusion binds *consumers*: only
 * `handlerReady: true` counts as a real capability. Discovery honoured that
 * from day one; the dispatcher — a consumer too — gated on mere presence, so
 * anything registered in the slot got called and its fabricated rows went back
 * as a 200. That is precisely the shape #3891 retired one layer up, and
 * plugin-dev's analytics stub kept it alive in dev mode (retired with this
 * change; this predicate is what stops the next one).
 *
 * `handlerReady` (not `status`) is the right test: a `degraded` implementation
 * that genuinely serves requests defaults to `true` and keeps serving — only a
 * self-confessed non-handler is treated as an empty slot.
 */
export function isAnalyticsServiceServeable(svc: unknown): boolean {
    if (!svc) return false;
    return readServiceSelfInfo(svc)?.handlerReady !== false;
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
    const analyticsService = await deps.getService(CoreServiceName.enum.analytics);
    // Empty slot — or a slot filled by a self-declared stub (#4000), which is
    // the same amount of analytics capability. 404 handled by caller.
    if (!isAnalyticsServiceServeable(analyticsService)) return { handled: false };

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
        // [#2852] Scope the generated SQL to the caller too, so a preview
        // reflects the same per-object read filter the real query applies.
        const result = await analyticsService.generateSql(body, context?.executionContext);
        return { handled: true, response: deps.success(result) };
    }

    return { handled: false };
}
