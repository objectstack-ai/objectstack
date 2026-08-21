// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10340 — `declaresOrgOverride` and the boundary fold, pinned as ONE
// composed contract.
//
// The predicate tolerates the MANIFEST-collection spellings only; the URL
// spelling contract is larger (`META_URL_TO_SINGULAR` also carries every
// registry-derived spelling). The two disagreed for `translations` /
// `email_templates`, and the REST doors — which held raw URL segments —
// consulted the predicate directly, so those two spellings read and wrote
// env-wide while their singular twins were org-scoped.
//
// The correction is at the boundary: doors fold through
// `canonicalMetaUrlType` BEFORE asking. These cases pin BOTH halves:
//
//   1. the COMPOSED contract (fold → predicate) answers the registry flag
//      for every spelling in the URL map — the property the doors rely on;
//   2. the predicate itself does NOT absorb the URL map — the repair
//      `metadata-url-spelling.ts` forbids ("nothing here should ever be
//      consulted by a predicate one layer down"). If a future change widens
//      the predicate, this pin turns red so the widening is argued against
//      #10340 / #7894 rather than slipped in as a convenience.

import { describe, it, expect } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { META_URL_TO_SINGULAR, canonicalMetaUrlType } from '@objectstack/spec/meta-spelling';
import {
    declaresOrgOverride,
    organizationIdForMetaRead,
    organizationIdForMetaWrite,
} from './meta-write-org-scope.js';

const ORG = 'org_alpha';

const REGISTRY_FLAG = new Map<string, boolean>(
    DEFAULT_METADATA_TYPE_REGISTRY.map((e) => [e.type, e.allowOrgOverride === true]),
);

describe('#10340 org scope composed with the boundary fold', () => {
    it('fold → predicate answers the registry flag for EVERY spelling in the URL map', () => {
        // The contract every REST door relies on after #10340: whatever the
        // caller spelled, folding first yields the canonical type's own
        // declaration. Quantified over the whole map so a new spelling limb
        // arrives already covered.
        for (const [spelling, folded] of Object.entries(META_URL_TO_SINGULAR)) {
            const expected = REGISTRY_FLAG.get(folded) === true ? ORG : undefined;
            expect(
                organizationIdForMetaWrite(canonicalMetaUrlType(spelling), ORG),
                `composed write scope for '${spelling}' (folds to '${folded}')`,
            ).toBe(expected);
            expect(
                organizationIdForMetaRead(canonicalMetaUrlType(spelling), ORG),
                `composed read scope for '${spelling}' (folds to '${folded}')`,
            ).toBe(expected);
        }
    });

    it('the predicate alone still answers the canonical singular correctly', () => {
        for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
            expect(
                declaresOrgOverride(entry.type),
                `declaresOrgOverride('${entry.type}')`,
            ).toBe(entry.allowOrgOverride === true);
        }
    });

    it('⛔ the predicate does NOT absorb the URL map — URL-only spellings answer false raw', () => {
        // The documented limit, pinned so it cannot erode silently. These are
        // registry-derived URL spellings with no manifest key; the BOUNDARY
        // folds them, the predicate must not learn them (#7894's forbidden
        // repair, one layer down). A deliberate future widening flips this
        // pin consciously, against the recorded rationale — never as a
        // side effect.
        expect(declaresOrgOverride('translations')).toBe(false);
        expect(declaresOrgOverride('email_templates')).toBe(false);
        // The manifest tolerance it DOES carry, kept for dispatcher-era
        // callers, stays: manifest spellings of overridable types hold.
        expect(declaresOrgOverride('views')).toBe(true);
        expect(declaresOrgOverride('emailTemplates')).toBe(true);
    });
});
