// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18728] The identity wires this SDK declares are the spec's own schemas —
 * and a served body really parses through them.
 *
 * ## What this file is for
 *
 * Maintainer ruling C (batch #158 item 4) ended a state where three PUBLISHED
 * schemas could not parse a response: `OrganizationSchema` declared
 * `updatedAt` required and `metadata` an object, while the four organization
 * read routes carried no `updatedAt` and served `metadata` as the stored JSON
 * text. The client recorded that as three 「not relayed」 notes; the spec side
 * was untouched. Both ends moved:
 *
 *  - **producer** — plugin-auth's data adapter decodes
 *    `sys_organization.metadata` on its READ verbs, so `setActive`, `get`,
 *    `delete` and `list` all serve the object the spec declares, with the key
 *    omitted when the column is unset;
 *  - **spec** — ruling C's own fallback A, on measurement: the wire is
 *    better-auth's serializer and its documented organization / member /
 *    invitation models declare no `updatedAt`, so the three schemas align to
 *    the documented wire and declare it optional.
 *
 * ## Why a RUNTIME parse, next to the type-level pins
 *
 * `return-type-precision.test.ts` is type-level on purpose and pins that the
 * DECLARED types are the spec's. That cannot observe whether a served body
 * actually satisfies the schema — the declaration could be a relay and the
 * body could still be refused. So this file runs the parse.
 *
 * ## ⭐ The negative controls are the point of the file
 *
 * "The client now relays the spec schemas" and "the client stopped validating"
 * look identical from a green positive test. Every positive case below is
 * therefore paired with a body that MUST be refused:
 *
 *  - a required field genuinely missing (`slug` / `userId` / `inviterId`);
 *  - ⭐ `metadata` still arriving as the stored JSON TEXT — the exact dimension
 *    the producer fix moves, so this one distinguishes "the producer decodes"
 *    from "the schema stopped caring";
 *  - `createdAt` present but not a datetime, and `updatedAt` present but not a
 *    datetime — because `.optional()` must widen the accept set by exactly one
 *    shape (absence) and must NOT drop the format check on a value that is
 *    there.
 *
 * Each refusal asserts the ISSUE PATH, not merely `success === false`: a parse
 * that fails for an unrelated reason is not evidence about the field named.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
    InvitationSchema,
    MemberSchema,
    OrganizationSchema,
    type Invitation,
    type Member,
    type Organization,
} from '@objectstack/spec/identity';
import type {
    OrganizationInvitationWire,
    OrganizationMemberWire,
    OrganizationWire,
} from './index';

/** Paths of every issue a `safeParse` reported, as dotted strings. */
function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
    return (result.error?.issues ?? []).map((i) => i.path.join('.'));
}

// ---------------------------------------------------------------------------
// The measured bodies — what the four read routes serve AFTER ruling C
// ---------------------------------------------------------------------------

/**
 * An organization row as `setActive` / `get` / `delete` / `list` serve it:
 * better-auth's own organization columns, `metadata` decoded by the producer,
 * `logo` present-and-null for an organization created without one (PR #18718's
 * measurement), and NO `updatedAt` — the vendor's output transform walks its
 * own declared fields only.
 */
const ORGANIZATION_WIRE = {
    id: 'org_01HQ',
    name: 'Acme',
    slug: 'acme',
    logo: null,
    createdAt: '2026-09-07T09:27:01.545Z',
    metadata: { plan: 'pro' },
};

/** The same row for an organization that never had metadata: the key is absent. */
const ORGANIZATION_WIRE_NO_METADATA = {
    id: 'org_01HR',
    name: 'Beta',
    slug: 'beta',
    logo: null,
    createdAt: '2026-09-07T09:27:01.545Z',
};

/** A membership row as better-auth serves it — its own member schema, no more. */
const MEMBER_WIRE = {
    id: 'mem_01HQ',
    organizationId: 'org_01HQ',
    userId: 'usr_01HQ',
    role: 'owner',
    createdAt: '2026-09-07T09:27:01.545Z',
};

/**
 * An invitation row as better-auth serves it: its invitation schema plus the
 * three members the platform adds — `teamId` (the vendor's own, written `null`
 * explicitly) and the two ADR-0105 D8 `additionalFields`.
 */
const INVITATION_WIRE = {
    id: 'inv_01HQ',
    organizationId: 'org_01HQ',
    email: 'invitee@example.com',
    role: 'member',
    status: 'pending',
    teamId: null,
    inviterId: 'usr_01HQ',
    expiresAt: '2026-09-09T09:27:01.545Z',
    createdAt: '2026-09-07T09:27:01.545Z',
    businessUnitId: null,
    positions: null,
};

describe('[#18728] the identity wires parse through the spec schemas', () => {
    it('OrganizationSchema accepts a served read-route body whole', () => {
        const parsed = OrganizationSchema.safeParse(ORGANIZATION_WIRE);
        expect(issuePaths(parsed)).toEqual([]);
        expect(parsed.success).toBe(true);
        // The decoded object survives the parse as an object.
        expect(parsed.success && parsed.data.metadata).toEqual({ plan: 'pro' });
        // `updatedAt` is absent on the wire and stays absent after parsing —
        // `.optional()` admits absence, it does not invent a value.
        expect(parsed.success && 'updatedAt' in parsed.data).toBe(false);
    });

    it('OrganizationSchema accepts a row whose metadata column was never set', () => {
        const parsed = OrganizationSchema.safeParse(ORGANIZATION_WIRE_NO_METADATA);
        expect(issuePaths(parsed)).toEqual([]);
        expect(parsed.success).toBe(true);
    });

    it('MemberSchema accepts a served membership row whole', () => {
        const parsed = MemberSchema.safeParse(MEMBER_WIRE);
        expect(issuePaths(parsed)).toEqual([]);
        expect(parsed.success).toBe(true);
    });

    it('InvitationSchema accepts a served invitation row whole, stripping the platform members', () => {
        const parsed = InvitationSchema.safeParse(INVITATION_WIRE);
        expect(issuePaths(parsed)).toEqual([]);
        expect(parsed.success).toBe(true);
        // The schema is a plain (non-strict) object, so the three keys it does
        // not declare are STRIPPED rather than refused. That is what makes the
        // relay claim honest: the wire is a superset of the spec's declaration.
        if (parsed.success) {
            expect('teamId' in parsed.data).toBe(false);
            expect('businessUnitId' in parsed.data).toBe(false);
            expect('positions' in parsed.data).toBe(false);
        }
    });

    it('relays the spec declarations as the SDK types, not a transcription of them', () => {
        expectTypeOf<OrganizationWire>().toEqualTypeOf<Organization>();
        expectTypeOf<OrganizationMemberWire>().toEqualTypeOf<Member>();
        // The invitation wire narrows `status` per route and adds the three
        // platform members, so it is the spec's declaration EXTENDED — every
        // key the spec declares still comes from the spec.
        expectTypeOf<OrganizationInvitationWire>().toMatchObjectType<Omit<Invitation, 'status'>>();
    });
});

describe('⭐ [#18728] negative controls — the spec parse still REFUSES a malformed body', () => {
    it('refuses an organization body missing a genuinely required field', () => {
        const { slug: _slug, ...withoutSlug } = ORGANIZATION_WIRE;
        const parsed = OrganizationSchema.safeParse(withoutSlug);
        expect(parsed.success).toBe(false);
        expect(issuePaths(parsed)).toContain('slug');
    });

    it('⭐ refuses an organization body whose metadata is still the stored JSON TEXT', () => {
        // This is the body the four read routes served BEFORE the producer fix.
        // It must stay refused: if it ever parses, the producer has regressed
        // or the schema has been loosened to hide the regression.
        const parsed = OrganizationSchema.safeParse({
            ...ORGANIZATION_WIRE,
            metadata: '{"plan":"pro"}',
        });
        expect(parsed.success).toBe(false);
        expect(issuePaths(parsed)).toContain('metadata');
    });

    it('refuses an organization body whose metadata is null rather than absent', () => {
        // The producer OMITS the key for an unset column; `null` is not the
        // declared shape and is not quietly admitted.
        const parsed = OrganizationSchema.safeParse({ ...ORGANIZATION_WIRE, metadata: null });
        expect(parsed.success).toBe(false);
        expect(issuePaths(parsed)).toContain('metadata');
    });

    it('refuses a non-datetime createdAt — the format check is live, not decorative', () => {
        const parsed = OrganizationSchema.safeParse({ ...ORGANIZATION_WIRE, createdAt: 'yesterday' });
        expect(parsed.success).toBe(false);
        expect(issuePaths(parsed)).toContain('createdAt');
    });

    it('⭐ refuses a non-datetime updatedAt — `.optional()` widened by absence ONLY', () => {
        // The one shape fallback A added is the key being ABSENT. A value that
        // IS there is still held to `z.string().datetime()`, on all three
        // schemas — otherwise the widening would have quietly retired the
        // format check as well.
        for (const [name, schema, wire] of [
            ['organization', OrganizationSchema, ORGANIZATION_WIRE],
            ['member', MemberSchema, MEMBER_WIRE],
            ['invitation', InvitationSchema, INVITATION_WIRE],
        ] as const) {
            const parsed = schema.safeParse({ ...wire, updatedAt: 'whenever' });
            expect(parsed.success, name).toBe(false);
            expect(issuePaths(parsed), name).toContain('updatedAt');
        }
    });

    it('refuses a membership row missing userId', () => {
        const { userId: _userId, ...withoutUserId } = MEMBER_WIRE;
        const parsed = MemberSchema.safeParse(withoutUserId);
        expect(parsed.success).toBe(false);
        expect(issuePaths(parsed)).toContain('userId');
    });

    it('refuses an invitation row missing inviterId, and one with an unknown status', () => {
        const { inviterId: _inviterId, ...withoutInviter } = INVITATION_WIRE;
        const missing = InvitationSchema.safeParse(withoutInviter);
        expect(missing.success).toBe(false);
        expect(issuePaths(missing)).toContain('inviterId');

        const badStatus = InvitationSchema.safeParse({ ...INVITATION_WIRE, status: 'withdrawn' });
        expect(badStatus.success).toBe(false);
        expect(issuePaths(badStatus)).toContain('status');
    });
});
