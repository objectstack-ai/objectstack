// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The published prose that teaches the ADR-0020 D3.3 legal-next-state
 * introspection route spells it the way the REST ledger does (#10178).
 *
 * WHY THIS EXISTS (measured, not argued). #9180 step ② retired the plural
 * `/api/v1/meta/objects/:name/state/:field` registration and moved the SDK to
 * the singular `object` segment. Nothing connected that change to the prose
 * that teaches the route, so two published sites kept teaching a retired
 * spelling for as long as nobody swept for it by hand — and the sweep that did
 * find them found a THIRD spelling (`/metadata/objects/...`) that a grep for
 * the plural `meta/objects` does not match at all. This asserts the link the
 * ledger row and the prose never had.
 *
 * THE ASSERTION IS DERIVED, NEVER SPELLED OUT HERE. The expected path is read
 * off the `REST_ROUTE_LEDGER` row that owns the route, so this file cannot
 * become a second, hand-copied statement of the canonical spelling — exactly
 * the disease the two-site drift is an instance of. Change the ledger row and
 * this test asks the docs to follow; change a doc line to a non-canonical
 * spelling and it reddens naming the file.
 *
 * PRESENCE, NOT ABSENCE. The assertion is that the canonical path IS THERE.
 * "no doc contains the plural" would pass on a page that stopped mentioning
 * the route at all, which is the same silence this guard exists to break — see
 * `scripts/check-doc-authoring.mjs` for the repo's standing statement of why an
 * evaporated corpus must not read as a clean one.
 *
 * ⛔ WHAT THIS DOES NOT SAY. The plural is NOT universally dead and this test
 * must never be read as saying it is: the legacy if-chain branch in
 * `packages/runtime/src/domains/meta.ts` still matches BOTH literals, so
 * `/meta/objects/:name/state/:field` is refused by a REST-fronted deployment
 * and still ANSWERED wherever `dispatch()` is the front door. That asymmetry is
 * deliberate (maintainer re-weigh of the #9180 ruling, 2026-08-17 item 3) and
 * is pinned by `packages/runtime/src/domains/meta-state-plural-tolerance.test.ts`.
 * This file is about the spelling the docs TEACH, nothing else.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `.js` on the relative import: without it `moduleResolution: nodenext` does
// not resolve it and every imported symbol degrades to `any`.
import { REST_ROUTE_LEDGER } from './rest-route-ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The published prose that teaches this route. Both spell the REST wire path,
 * so both are judged against the REST ledger row.
 */
const TEACHING_SITES = [
    'content/docs/protocol/objectql/state-machine.mdx',
    'skills/objectstack-automation/SKILL.md',
] as const;

describe('meta state-introspection route — docs spell it the way the ledger does', () => {
    const rows = REST_ROUTE_LEDGER.filter((r) => r.client === 'meta.getLegalNextStates');

    it('the ledger names exactly one route for `meta.getLegalNextStates`', () => {
        // If this ever fails the derivation below has no single answer to give,
        // and the doc assertion would be judging against an arbitrary row.
        expect(rows.map((r) => r.route)).toHaveLength(1);
    });

    const canonicalPath = rows[0]!.route.replace(/^[A-Z]+\s+/, '');

    it('the derived path is the singular `/meta/object/…` spelling', () => {
        // Not a second statement of the canonical spelling — a sanity clamp on
        // the DERIVATION, so a ledger row that lost its method prefix or its
        // path shape cannot silently turn the assertion below into a tautology.
        expect(canonicalPath).toMatch(/^\/api\/v1\/meta\/object\/:name\/state\/:field$/);
    });

    for (const site of TEACHING_SITES) {
        it(`${site} teaches the canonical path`, () => {
            // readFileSync throws on a moved/renamed file rather than passing
            // quietly: a site that evaporated is a finding, not a green.
            const text = readFileSync(resolve(HERE, '../../../', site), 'utf8');
            expect(
                text.includes(canonicalPath),
                `${site} does not teach \`${canonicalPath}\`, the path the REST ledger row for `
                + '`meta.getLegalNextStates` declares. Update the prose to the ledger spelling '
                + '(or, if the route itself moved, update the ledger first and let this follow). '
                + '⛔ Do not "fix" this by asserting the plural is dead everywhere — it is still '
                + 'answered on the dispatch path by deliberate decision.',
            ).toBe(true);
        });
    }
});
