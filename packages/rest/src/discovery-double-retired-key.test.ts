// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5674] No `getDiscovery` test double in this package may spell `endpoints`.
 *
 * ## What was wrong
 *
 * 25 test files in `packages/rest/src` mocked the protocol like this:
 *
 * ```ts
 * getDiscovery: vi.fn().mockResolvedValue({
 *   version: 'v0',
 *   endpoints: { data: '', metadata: '', ui: '', auth: '/auth' },
 * })
 * ```
 *
 * The real producer (`ObjectStackProtocolImplementation.getDiscovery()` in
 * `packages/metadata-protocol/src/protocol.ts`) emits `routes` — declared as
 * `ApiRoutesSchema` and REQUIRED by `DiscoverySchema` — and has never emitted
 * `endpoints`. That key existed only on the dispatcher path, as a verbatim
 * copy of `routes`, and #4828 removed it under ADR-0049. The producer side is
 * already pinned next door: `discovery-schema-conformance.test.ts` asserts the
 * live `/discovery` body has no `endpoints` property.
 *
 * Those doubles were inert — `rest-server`'s discovery handler reads
 * `discovery.routes`, so `if (discovery.routes)` was simply false and the
 * route-augmentation block was skipped — which is exactly why they survived
 * the retirement: nothing they asserted depended on the key at all.
 *
 * ## Why a pin, and why THIS pin
 *
 * The harm is authoring-time, not runtime: these were the last places in the
 * repo still spelling a retired key, and a test double is the most-copied
 * artifact there is. Copy one and the key is back in the fixture layer, still
 * inert, still teaching a producer shape that never existed. A conformance
 * test over the live producer cannot see that — no producer is involved.
 *
 * Scope, stated honestly:
 *
 * - It scans the `mockResolvedValue({ … })` form only, which is the form all
 *   26 doubles in this package use and therefore the form that gets copied. A
 *   double written some other way (`vi.fn(async () => ({ … }))`) is not read.
 * - It asserts only the NEGATIVE — no `endpoints` key. It deliberately does
 *   not require `routes`, because `rest-server` guards with
 *   `if (discovery.routes)` and a future test is entitled to drive that guard's
 *   falsy branch with a double that omits it.
 * - The floor below is anti-vacuity, in the sense of #4642: a scanner that
 *   silently stops matching would otherwise pass by finding nothing.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * This file is excluded from its own scan, EXPLICITLY.
 *
 * The docblock above quotes the defective double verbatim — that is the point
 * of it — so the scanner does match a "double" here. It happens to escape the
 * key check only because a docblock line prefixes the key with `* `, which the
 * `[{,]\s*` lead-in does not accept. Depending on that is depending on comment
 * formatting: re-wrap the docblock and this pin fails on its own prose. Name
 * the exclusion instead of inheriting the luck.
 */
const SELF = 'discovery-double-retired-key.test.ts';

/** Matches an `endpoints` key at the start of a line or after `{` / `,`. */
const ENDPOINTS_KEY = /(^|[{,])\s*endpoints\s*:/;

interface Double {
    file: string;
    /** The source text of the object the double resolves to, braces included. */
    literal: string;
}

/**
 * Capture the balanced `{ … }` that follows `getDiscovery: …mockResolvedValue(`.
 *
 * Brace counting is enough here: the doubles are plain data literals, and a
 * `{` inside a string would only ever make this capture MORE text, i.e. fail
 * loud rather than pass quiet.
 */
function collectDoubles(file: string, source: string): Double[] {
    const found: Double[] = [];
    const opener = /getDiscovery\s*:[\s\S]{0,80}?mockResolvedValue\(\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = opener.exec(source)) !== null) {
        const start = m.index + m[0].length - 1; // index of the `{`
        let depth = 0;
        let end = -1;
        for (let i = start; i < source.length; i++) {
            const ch = source[i];
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        if (end === -1) throw new Error(`${file}: unbalanced getDiscovery double literal`);
        found.push({ file, literal: source.slice(start, end + 1) });
    }
    return found;
}

const DOUBLES: Double[] = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.test.ts') && f !== SELF)
    .flatMap((f) => collectDoubles(f, readFileSync(join(SRC_DIR, f), 'utf8')));

describe('[#5674] getDiscovery doubles carry the producer key, not the retired one', () => {
    it('finds the doubles it claims to police (anti-vacuity)', () => {
        // 27 doubles across 26 files when this pin was written (the 26 #5674
        // corrected, plus `rest-route-ledger.conformance.test.ts`, which
        // resolves to a bare `{}` and never spelled the retired key). The floor
        // is deliberately slack — it exists so a scanner that matches NOTHING
        // fails instead of reporting a clean sweep of an empty set.
        expect(
            DOUBLES.length,
            'the scanner found (almost) no getDiscovery doubles — it has drifted from how this package writes them, so its verdict below means nothing',
        ).toBeGreaterThanOrEqual(20);
    });

    it('no double resolves to an object carrying `endpoints` (retired in #4828)', () => {
        const offenders = DOUBLES
            .filter((d) => ENDPOINTS_KEY.test(d.literal))
            .map((d) => d.file);

        expect(
            Array.from(new Set(offenders)),
            'the discovery producer emits `routes` (ApiRoutesSchema) and never emitted `endpoints`; '
            + '`endpoints` was the dispatcher-only copy retired by #4828 (ADR-0049). A double that spells '
            + 'it teaches a shape no producer ever had, and is the seed the next copy-paste grows from (#5674).',
        ).toEqual([]);
    });
});
