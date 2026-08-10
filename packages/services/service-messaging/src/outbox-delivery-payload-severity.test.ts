// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7174 — compile-time pin for `DeliveryPayload.severity`.
 *
 * The field used to be declared `'info' | 'warning' | 'critical' | string`,
 * which TypeScript collapses to exactly `string` (a literal union member is
 * absorbed by the wider primitive it is unioned with). The three names read
 * as a closed vocabulary but enforced nothing — `severity: 'urgent'`
 * type-checked with no error. This file is the guard-rail: every line below
 * is a type-level assertion evaluated by `tsc --noEmit`, run as part of this
 * package's ordinary `typecheck` script (this package's tsconfig does not
 * exclude `*.test.ts`, so no separate `.pin.ts` is needed — see AGENTS.md's
 * `PINS_CHECKED` invariant).
 */

import { describe, it, expect } from 'vitest';
import type { DeliveryPayload } from './outbox.js';

describe('DeliveryPayload.severity (#7174)', () => {
    it('accepts the closed info | warning | critical vocabulary', () => {
        const payloads: DeliveryPayload[] = [
            { severity: 'info' },
            { severity: 'warning' },
            { severity: 'critical' },
            {}, // severity is optional
        ];
        expect(payloads.map((p) => p.severity)).toEqual(['info', 'warning', 'critical', undefined]);
    });

    it('rejects an out-of-vocabulary literal at compile time', () => {
        // @ts-expect-error 'urgent' is not a member of the closed severity vocabulary
        const bad: DeliveryPayload = { severity: 'urgent' };
        // Runtime side is unreachable in practice (a real construction site
        // would fail to compile); assert only that the pin above is real —
        // if the `| string` collapse ever comes back, this line stops being
        // an error and `tsc --noEmit` goes red on the missing `@ts-expect-error`.
        expect(bad.severity).toBe('urgent');
    });
});
