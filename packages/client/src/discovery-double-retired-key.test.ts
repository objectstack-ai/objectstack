// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5787] No discovery test double in THIS package may spell the retired
 * `endpoints` key, or hand `capabilities` an array.
 *
 * ## What was wrong
 *
 * The sibling of #5674, one package over. That issue cleared 25 `getDiscovery`
 * doubles in `packages/rest/src` that spelled `endpoints`; a repo-scope re-read
 * — by the rule's consumption radius rather than by the edited package — found
 * the same retired key still alive here, in `client.test.ts`'s `connect()`
 * double, alongside a second divergence of the same class:
 *
 * ```
 *     capabilities: ['metadata', 'data', 'ui'],
 *     endpoints: {}
 * ```
 *
 * Both describe a producer shape that has never existed:
 *
 * - **`endpoints`** — the real producer
 *   (`ObjectStackProtocolImplementation.getDiscovery()` in
 *   `packages/metadata-protocol/src/protocol.ts`) emits `routes`, declared as
 *   `ApiRoutesSchema` and REQUIRED by `DiscoverySchema`. `endpoints` existed
 *   only on the dispatcher path, as a verbatim copy of `routes`, and #4828
 *   removed it under ADR-0049.
 * - **`capabilities` as an array** — `DiscoverySchema.capabilities` is a CLOSED
 *   object over `WellKnownCapabilitiesSchema`, one required
 *   `CapabilityDescriptor` (`{ enabled, features?, description? }`) per
 *   vocabulary key (#5672 ruling A). A string array is a shape from further
 *   back still, and it names three things (`metadata` / `data` / `ui`) that are
 *   not capability keys in any vocabulary — they are `routes` keys.
 *
 * Both were inert. That test asserts only `expect(fetchMock).toHaveBeenCalled()`
 * and never reads a key of the body, which is precisely why the shape survived
 * two retirements untouched.
 *
 * ## Why a pin, and why a LOCAL one
 *
 * The harm is authoring-time, not runtime: a test double is the most-copied
 * artifact there is, so a double teaching a shape no producer ever had is the
 * seed the next copy-paste grows from. The producer-side conformance gates
 * (three `discovery-schema-conformance.test.ts` files) cannot see this — no
 * producer is involved in a hand-written `fetch` mock.
 *
 * This deliberately mirrors `packages/rest/src/discovery-double-retired-key.test.ts`
 * (#5674) as a per-package pin rather than being promoted to a repo-level gate.
 * The two packages do not write their doubles the same way — `rest` mocks the
 * protocol OBJECT (`getDiscovery: vi.fn().mockResolvedValue(…)`), `client` mocks
 * the WIRE (`fetch` → `json()`) — so a single cross-package scanner would need
 * both capture forms anyway, and would then be one file whose failure names a
 * package its reader is not working in. Two local pins, each reading the form
 * its own package actually uses, is the smaller and more legible arrangement.
 * Widening is a decision for a maintainer, not a side effect of this fix.
 *
 * ## Scope, stated honestly
 *
 * - It reads the two shapes this package's doubles are actually written in: a
 *   `fetch` mock's `json: async () => ({ … })` body, and a direct assignment to
 *   the private `discoveryInfo` field. A double written some third way is not
 *   read.
 * - A literal counts as a DISCOVERY double when it carries a `capabilities` or
 *   `routes` key — the two keys nothing else in this package's response bodies
 *   uses. Bodies for `/meta`, `/data` and the rest are captured and then
 *   correctly ignored.
 * - It asserts only the two NEGATIVES above. It deliberately does not require
 *   `routes` or a full vocabulary: the capability-getter tests next door drive
 *   the getter with deliberately PARTIAL and deliberately LEGACY payloads
 *   (`capabilities-vocabulary.test.ts` replays the exact pre-#5672 dispatcher
 *   map on purpose), and that coverage is the point of those tests. Demanding a
 *   conformant body of every double would delete it.
 * - This file is excluded from its own scan. Its prose quotes the defective
 *   shape verbatim — that is the point of it — and the exclusion is NAMED here
 *   rather than left to depend on how the docblock happens to be wrapped.
 * - The floor below is anti-vacuity, in the sense of #4642: a scanner that
 *   silently stopped matching would otherwise pass by finding nothing.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));

/** @see the docblock's "excluded from its own scan" note. */
const SELF = 'discovery-double-retired-key.test.ts';

/** Matches an `endpoints` key at the start of a line or after `{` / `,`. */
const ENDPOINTS_KEY = /(^|[{,])\s*endpoints\s*:/;

/** Matches `capabilities` bound to an ARRAY literal. */
const CAPABILITIES_ARRAY = /(^|[{,])\s*capabilities\s*:\s*\[/;

/**
 * Marks a captured literal as a discovery body: a `capabilities` key (written
 * long-hand or as an ES shorthand property) or a `routes` key.
 */
const DISCOVERY_MARKER = /(^|[{,])\s*(?:capabilities\s*[:,}]|routes\s*:)/;

/**
 * The two ways this package builds a discovery double.
 *
 * 1. the wire: `json: async () => ({ … })` on a `fetch` mock — how `connect()`
 *    is driven everywhere;
 * 2. the field: `(client as any)['discoveryInfo'] = { … }` — used where a test
 *    wants a discovered route table without a round trip.
 */
const OPENERS: readonly RegExp[] = [
    /json\s*:\s*(?:async\s*)?\(\s*\)\s*=>\s*\(\s*\{/g,
    /discoveryInfo['"\]]*\s*=(?!=)\s*\{/g,
];

interface Double {
    file: string;
    /** The source text of the double's object literal, braces included. */
    literal: string;
}

/**
 * Capture the balanced `{ … }` that follows each opener.
 *
 * Brace counting is enough here: the doubles are plain data literals, and a
 * `{` inside a string would only ever make this capture MORE text, i.e. fail
 * loud rather than pass quiet.
 */
function collectDoubles(file: string, source: string): Double[] {
    const found: Double[] = [];
    for (const opener of OPENERS) {
        opener.lastIndex = 0;
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
            if (end === -1) throw new Error(`${file}: unbalanced discovery double literal`);
            found.push({ file, literal: source.slice(start, end + 1) });
        }
    }
    return found;
}

const DOUBLES: Double[] = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.test.ts') && f !== SELF)
    .flatMap((f) => collectDoubles(f, readFileSync(join(SRC_DIR, f), 'utf8')))
    .filter((d) => DISCOVERY_MARKER.test(d.literal));

describe('[#5787] discovery doubles carry the producer shape, not a retired one', () => {
    it('finds the doubles it claims to police (anti-vacuity)', () => {
        // 5 discovery doubles across 2 files when this pin was written. The
        // floor is deliberately slack — it exists so a scanner that matches
        // NOTHING fails instead of reporting a clean sweep of an empty set.
        expect(
            DOUBLES.length,
            'the scanner found (almost) no discovery doubles — it has drifted from how this package writes them, so its verdicts below mean nothing',
        ).toBeGreaterThanOrEqual(3);
    });

    it('no double carries `endpoints` (retired in #4828)', () => {
        const offenders = DOUBLES
            .filter((d) => ENDPOINTS_KEY.test(d.literal))
            .map((d) => d.file);

        expect(
            Array.from(new Set(offenders)),
            'the discovery producer emits `routes` (ApiRoutesSchema) and never emitted `endpoints`; '
            + '`endpoints` was the dispatcher-only copy retired by #4828 (ADR-0049). A double that spells '
            + 'it teaches a shape no producer ever had, and is the seed the next copy-paste grows from (#5674/#5787).',
        ).toEqual([]);
    });

    it('no double binds `capabilities` to an array', () => {
        const offenders = DOUBLES
            .filter((d) => CAPABILITIES_ARRAY.test(d.literal))
            .map((d) => d.file);

        expect(
            Array.from(new Set(offenders)),
            '`DiscoverySchema.capabilities` is a closed object over WellKnownCapabilitiesSchema — one '
            + '`{ enabled, features?, description? }` descriptor per vocabulary key (#5672 ruling A). It has '
            + 'never been a string array, and `client.capabilities` reads it as a map, so an array double '
            + 'teaches a shape that would silently read as no capabilities at all (#5787).',
        ).toEqual([]);
    });
});
