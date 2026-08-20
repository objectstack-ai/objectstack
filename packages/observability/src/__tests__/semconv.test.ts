// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SEMCONV, RUNTIME_METRICS } from '../semconv.js';

describe('SEMCONV', () => {
    it('declares the two HTTP families the transport seam emits', () => {
        expect(SEMCONV.httpRequestsTotal).toBe('http_requests_total');
        expect(SEMCONV.httpRequestDurationMs).toBe('http_request_duration_ms');
    });

    /**
     * The retirement pin for `http_request_errors_total` (#9834, ADR-0049
     * enforce-or-remove, maintainer ruling 2026-08-20).
     *
     * It is asserted HERE, on the declaration, rather than only on the emission
     * site in `@objectstack/runtime`: `SEMCONV` is the published namespace the
     * docs point hosts at "so hosts can wire alerts/dashboards against it", so
     * the name being back in this object is itself the regression — a host
     * reading the constant would start naming a series nothing writes, which is
     * the declared-not-enforced shape the retirement removed.
     *
     * Both directions are checked on purpose. The key check catches a re-add
     * under the old member name; the VALUE check catches a re-add under a new
     * member name that resurrects the same wire string, which is what an
     * external dashboard actually keys on.
     */
    it('does not declare the retired http_request_errors_total name (#9834)', () => {
        expect(SEMCONV as Record<string, string>).not.toHaveProperty(
            'httpRequestErrorsTotal',
        );
        expect(Object.values(SEMCONV)).not.toContain('http_request_errors_total');
        expect(RUNTIME_METRICS as Record<string, string>).not.toHaveProperty(
            'httpRequestErrorsTotal',
        );
        expect(Object.values(RUNTIME_METRICS)).not.toContain('http_request_errors_total');
    });
});
