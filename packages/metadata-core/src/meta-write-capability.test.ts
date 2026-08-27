// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12702] `metaWriteCapabilityVerdict` — which CALLERS a `/meta` item write
 * door admits.
 *
 * The contract under test (maintainer direction 2026-08-27, quoted in #12701):
 * `manage_org_presentation` is a SUBSET key beside platform `manage_metadata`
 * — it admits a write ONLY for a type whose registry entry declares
 * `allowOrgOverride: true` AND a session with an active organization (the very
 * organization the door threads). `manage_metadata` and `isSystem` behave
 * exactly as before.
 *
 * ## Registry-derived, so the truth table is the REGISTRY's
 *
 * The tier-A membership cases iterate `DEFAULT_METADATA_TYPE_REGISTRY` rather
 * than a hand-written five-type list (Prime Directive #8). The IDENTITY of the
 * five org-overridable types is pinned elsewhere, on the protocol's own
 * refusal (`protocol.org-scoped-write-refused.test.ts`) — this file pins that
 * the verdict MOVES WITH the registry, whatever the registry says.
 *
 * ## Refusal messages are envelope halves, not the envelope
 *
 * The verdict returns a message; each DOOR supplies its own status/code
 * (REST `403 FORBIDDEN`, dispatcher `403 PERMISSION_DENIED` — pinned in their
 * own gate suites). What is pinned HERE about messages:
 *   - the tier-B sentence is BYTE-IDENTICAL to the pre-#12702 one (the
 *     platform's most common metadata refusal stays stable — the
 *     `single`-posture stability half of the card's acceptance);
 *   - the tier-A sentences name the sanctioned path (both capabilities) and
 *     never the caller's own grants (#7450: the message varies only on
 *     request/session-derived facts, so the same request shape answers the
 *     same sentence whatever the caller holds).
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import {
    METADATA_AUTHORING_CAPABILITY,
    ORG_PRESENTATION_AUTHORING_CAPABILITY,
    metaWriteCapabilityVerdict,
    type MetaWriteOperation,
} from './meta-write-capability.js';

const ORG = 'org_a';

/** Shorthand: verdict for a caller shape against a canonical type. */
function verdict(input: {
    isSystem?: boolean;
    held?: unknown;
    type: string;
    org?: string | undefined;
    operation?: MetaWriteOperation;
}) {
    return metaWriteCapabilityVerdict({
        ...(input.isSystem !== undefined ? { isSystem: input.isSystem } : {}),
        systemPermissions: input.held ?? [],
        canonicalType: input.type,
        activeOrganizationId: input.org,
        operation: input.operation ?? 'save',
    });
}

describe('#12702 — the declaration cannot drift from the enforcement spelling', () => {
    it('`manage_org_presentation` is a curated PLATFORM_CAPABILITIES entry with scope org', () => {
        const declared = PLATFORM_CAPABILITIES.find(
            (c) => c.name === ORG_PRESENTATION_AUTHORING_CAPABILITY,
        );
        expect(declared).toBeDefined();
        expect(declared!.scope).toBe('org');
    });

    it('`manage_metadata` stays the platform-scoped authoring capability', () => {
        const declared = PLATFORM_CAPABILITIES.find(
            (c) => c.name === METADATA_AUTHORING_CAPABILITY,
        );
        expect(declared).toBeDefined();
        expect(declared!.scope).toBe('platform');
    });
});

describe('#12702 — the unchanged paths: isSystem and manage_metadata', () => {
    it('isSystem is admitted unconditionally — tier-B type, no organization', () => {
        expect(verdict({ isSystem: true, type: 'object' })).toEqual({ allowed: true });
    });

    it('manage_metadata is admitted for a tier-B type with no organization (env-wide, as today)', () => {
        expect(verdict({ held: ['manage_metadata'], type: 'object' })).toEqual({ allowed: true });
        expect(verdict({ held: ['manage_metadata'], type: 'flow' })).toEqual({ allowed: true });
    });

    it('manage_metadata is admitted for a tier-A type with and without an organization', () => {
        expect(verdict({ held: ['manage_metadata'], type: 'view' })).toEqual({ allowed: true });
        expect(verdict({ held: ['manage_metadata'], type: 'view', org: ORG })).toEqual({ allowed: true });
    });
});

describe('#12702 — org-scoped tier-A admission, derived from the registry', () => {
    // The whole registry, both directions — no hand-written type list. A
    // registry entry flipping `allowOrgOverride` moves this table the same day
    // with nothing to keep in sync (and the five-type IDENTITY pin in
    // metadata-protocol goes red, which is that pin working).
    for (const entry of DEFAULT_METADATA_TYPE_REGISTRY) {
        const expected = entry.allowOrgOverride === true;
        it(`'${entry.type}' (allowOrgOverride: ${String(entry.allowOrgOverride ?? false)}) → holder with active org is ${expected ? 'ADMITTED' : 'REFUSED'}`, () => {
            const out = verdict({
                held: [ORG_PRESENTATION_AUTHORING_CAPABILITY],
                type: entry.type,
                org: ORG,
            });
            expect(out.allowed).toBe(expected);
        });
    }

    it('a type with NO registry entry at all (runtime plugin type) is refused — same posture as boot hydration', () => {
        const out = verdict({ held: [ORG_PRESENTATION_AUTHORING_CAPABILITY], type: 'agent_tool_custom', org: ORG });
        expect(out.allowed).toBe(false);
    });

    it('the boundary fold composes: a URL-only spelling folded through canonicalMetaUrlType is admitted', () => {
        // `email_templates` is a URL-only spelling (`SINGULAR_TO_PLURAL` has no
        // manifest key for it — the #10340 measurement). The doors fold BEFORE
        // asking; this case pins that the folded spelling answers tier-A.
        expect(canonicalMetaUrlType('email_templates')).toBe('email_template');
        const out = verdict({
            held: [ORG_PRESENTATION_AUTHORING_CAPABILITY],
            type: canonicalMetaUrlType('email_templates'),
            org: ORG,
        });
        expect(out).toEqual({ allowed: true });
    });
});

describe('#12702 — the walls: env-wide, foreign-scope, and no-capability shapes', () => {
    it('tier-A with NO active organization is refused — the write would land env-wide', () => {
        const out = verdict({ held: [ORG_PRESENTATION_AUTHORING_CAPABILITY], type: 'view' });
        expect(out.allowed).toBe(false);
        if (!out.allowed) {
            expect(out.message).toContain('`manage_metadata`');
            expect(out.message).toContain('active organization');
            expect(out.message).toContain('environment-wide');
        }
    });

    it("an empty-string organization is absent, not an organization (the conservative direction)", () => {
        const out = verdict({ held: [ORG_PRESENTATION_AUTHORING_CAPABILITY], type: 'view', org: '' });
        expect(out.allowed).toBe(false);
    });

    it('holding nothing relevant is refused on every tier', () => {
        expect(verdict({ held: [], type: 'view', org: ORG }).allowed).toBe(false);
        expect(verdict({ held: ['setup.access', 'studio.access'], type: 'view', org: ORG }).allowed).toBe(false);
        expect(verdict({ held: ['manage_org_users'], type: 'object', org: ORG }).allowed).toBe(false);
    });

    it('a non-array systemPermissions is nothing held, never a throw (fail closed)', () => {
        expect(verdict({ held: undefined, type: 'view', org: ORG }).allowed).toBe(false);
        expect(verdict({ held: 'manage_metadata', type: 'view', org: ORG }).allowed).toBe(false);
        expect(verdict({ held: { has: () => true }, type: 'view', org: ORG }).allowed).toBe(false);
    });
});

describe('#12702 — refusal sentences (#7450: request-derived, never caller-derived)', () => {
    it('tier-B keeps the pre-#12702 sentence BYTE-IDENTICAL — for every caller shape', () => {
        const legacy = 'Saving a metadata item requires the `manage_metadata` capability.';
        const noCaps = verdict({ held: [], type: 'object', org: ORG });
        const holder = verdict({ held: [ORG_PRESENTATION_AUTHORING_CAPABILITY], type: 'object', org: ORG });
        expect(noCaps).toEqual({ allowed: false, message: legacy });
        // The SAME sentence for the org-presentation holder: the message varies
        // on the request's tier, never on what this caller holds (#7450).
        expect(holder).toEqual({ allowed: false, message: legacy });
    });

    it('tier-A with an active org names BOTH sanctioned paths — identically for every refused caller shape', () => {
        const noCaps = verdict({ held: [], type: 'view', org: ORG });
        const unrelated = verdict({ held: ['setup.access'], type: 'view', org: ORG });
        expect(noCaps.allowed).toBe(false);
        if (!noCaps.allowed) {
            expect(noCaps.message).toContain('`manage_metadata`');
            expect(noCaps.message).toContain('`manage_org_presentation`');
            expect(noCaps.message).toContain('active organization');
        }
        expect(unrelated).toEqual(noCaps);
    });

    it('each door verb keeps its own pre-#12702 tier-B subject', () => {
        const subject: Record<MetaWriteOperation, string> = {
            save: 'Saving a metadata item requires the `manage_metadata` capability.',
            reset: 'Resetting a metadata item requires the `manage_metadata` capability.',
            publish: 'Publishing a metadata item requires the `manage_metadata` capability.',
            rollback: 'Rolling back a metadata item requires the `manage_metadata` capability.',
        };
        for (const op of Object.keys(subject) as MetaWriteOperation[]) {
            const out = verdict({ held: [], type: 'object', org: ORG, operation: op });
            expect(out).toEqual({ allowed: false, message: subject[op] });
        }
    });
});
