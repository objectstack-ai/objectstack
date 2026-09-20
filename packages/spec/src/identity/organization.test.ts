import { describe, it, expect } from 'vitest';
import {
  OrganizationSchema,
  MemberSchema,
  InvitationSchema,
  InvitationStatus,
  type Organization,
  type Member,
  type Invitation,
} from "./organization.zod";

describe('OrganizationSchema', () => {
  it('should accept valid organization data', () => {
    const org: Organization = {
      id: 'org_123',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      logo: 'https://example.com/logo.png',
      metadata: {
        industry: 'Technology',
        size: 'Enterprise',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => OrganizationSchema.parse(org)).not.toThrow();
  });

  it('should accept minimal organization data', () => {
    const org = {
      id: 'org_123',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => OrganizationSchema.parse(org)).not.toThrow();
  });

  it('should validate slug format', () => {
    const validSlugs = [
      'acme-corp',
      'my_organization',
      'test123',
      'org-123',
      'my_org-123',
    ];

    validSlugs.forEach((slug) => {
      const org = {
        id: 'org_123',
        name: 'Test Org',
        slug,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(() => OrganizationSchema.parse(org)).not.toThrow();
    });
  });

  it('should reject invalid slug format', () => {
    const invalidSlugs = [
      'Acme Corp', // spaces and uppercase
      'acme.corp', // dots
      'acme@corp', // special characters
      'ACME', // uppercase
      'acme corp', // spaces
    ];

    invalidSlugs.forEach((slug) => {
      const org = {
        id: 'org_123',
        name: 'Test Org',
        slug,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(() => OrganizationSchema.parse(org)).toThrow();
    });
  });

  it('should validate logo URL format', () => {
    const org = {
      id: 'org_123',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      logo: 'not-a-url',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => OrganizationSchema.parse(org)).toThrow();
  });

  it('should accept organization with metadata', () => {
    const org = {
      id: 'org_123',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      metadata: {
        industry: 'Technology',
        size: 'Enterprise',
        customField: 'Custom Value',
        nested: {
          key: 'value',
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => OrganizationSchema.parse(org)).not.toThrow();
  });
});

/**
 * [#18509] `OrganizationSchema.logo` accepts `null` — the shape better-auth
 * serves.
 *
 * `logo` is one of better-auth's own `sys_organization` columns, declared
 * `Field.url({ required: false })` and reaching SQLite as `logo varchar(255)`
 * with `notnull=0`. `/auth/organization/create`, `/auth/organization/list` and
 * `/auth/organization/get-full-organization` all serve `"logo": null` for an
 * organization created without one. Measured on a real `AuthManager` over
 * ObjectQL + driver-sqlite-wasm; evidence and controls in PR #18718's body.
 *
 * The whole accept set is pinned, not just the row that moved — see the sibling
 * block in `identity.test.ts` for why.
 */
describe('[#18509] OrganizationSchema.logo accept set', () => {
  const base = {
    id: 'org_123',
    name: 'Acme Corporation',
    slug: 'acme-corp',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const failedPaths = (value: unknown, present = true) => {
    const input = present ? { ...base, logo: value } : { ...base };
    const result = OrganizationSchema.safeParse(input);
    return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
  };

  it('accepts `null` — the value every organization body carries', () => {
    expect(failedPaths(null)).toEqual([]);
  });

  it('still accepts the key being ABSENT — `.nullish()`, not `.nullable()`', () => {
    expect(failedPaths(undefined, false)).toEqual([]);
  });

  it('still accepts a well-formed URL', () => {
    expect(failedPaths('https://example.com/logo.png')).toEqual([]);
  });

  it('still refuses a malformed URL — `.url()` keeps its force on the string branch', () => {
    expect(failedPaths('not-a-url')).toEqual(['logo']);
  });

  it('still refuses the empty string', () => {
    expect(failedPaths('')).toEqual(['logo']);
  });

  it('still refuses a non-string, non-null value', () => {
    expect(failedPaths(42)).toEqual(['logo']);
  });

  it('lit control: the instrument reports a neighbour when a neighbour is wrong', () => {
    const { slug: _dropped, ...withoutSlug } = base;
    const result = OrganizationSchema.safeParse({ ...withoutSlug, logo: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join('.'))).toEqual(['slug']);
    }
  });

  /**
   * ⭐ [#18728] The scope fence this block used to pin is DOWN, and #18509's own
   * pin asked whoever took it down to come here and say so. Saying so:
   *
   * The fence pinned two refusals as current behaviour — `metadata` served
   * present-and-null, and `updatedAt` absent while declared required — and
   * maintainer ruling C (batch #158 item 4) closed each at a different end:
   *
   *  - `updatedAt` is now `.optional()` on this schema, which is the ruling's
   *    own fallback A: the wire is better-auth's serializer and its documented
   *    organization model declares no such field, so the schema aligns to the
   *    documented wire rather than the producer inventing a value.
   *  - `metadata` was fixed at the PRODUCER, not here. plugin-auth's data
   *    adapter decodes `sys_organization.metadata` from its stored JSON text on
   *    its read verbs and OMITS the key when the column is unset, so the served
   *    body now carries an object or nothing — never `null`.
   *
   * So a served body parses whole, and the `null` this schema still refuses is
   * a shape nothing sends any more. Both halves are pinned below, because
   * "accepts the served body" and "stopped checking" are otherwise the same
   * green.
   */
  it('[#18728] accepts a served read-route body WHOLE — updatedAt absent, metadata decoded', () => {
    const served = {
      id: 'org_123',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      logo: null,
      metadata: { plan: 'pro' },
      createdAt: '2026-01-01T00:00:00.000Z',
      // `updatedAt` absent, exactly as every route of this family serves it
    };
    const result = OrganizationSchema.safeParse(served);
    expect(result.error?.issues.map((i) => i.path.join('.')) ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('[#18728] accepts the same body with metadata OMITTED — an unset column', () => {
    const { metadata: _unset, ...withoutMetadata } = {
      id: 'org_123',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      logo: null,
      metadata: { plan: 'pro' },
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const result = OrganizationSchema.safeParse(withoutMetadata);
    expect(result.success).toBe(true);
  });

  it('⭐ [#18728] still REFUSES metadata as null or as the stored JSON text', () => {
    // The producer omits an unset column and decodes a set one, so neither of
    // these is a shape any route sends. They must stay refused: if either ever
    // parses, the producer has regressed or this schema has been loosened to
    // hide the regression.
    for (const wrong of [null, '{"plan":"pro"}']) {
      const result = OrganizationSchema.safeParse({
        id: 'org_123',
        name: 'Acme Corporation',
        slug: 'acme-corp',
        logo: null,
        metadata: wrong,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['metadata']);
    }
  });

  it('⭐ [#18728] `.optional()` widened updatedAt by ABSENCE only — a present value is still a datetime', () => {
    const result = OrganizationSchema.safeParse({
      id: 'org_123',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      logo: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: 'whenever',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['updatedAt']);
  });
});

describe('MemberSchema', () => {
  it('should accept valid member data', () => {
    const member: Member = {
      id: 'member_123',
      organizationId: 'org_123',
      userId: 'user_123',
      role: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => MemberSchema.parse(member)).not.toThrow();
  });

  it('should accept different role types', () => {
    const roles = ['owner', 'admin', 'member', 'guest', 'viewer', 'editor'];

    roles.forEach((role) => {
      const member = {
        id: 'member_123',
        organizationId: 'org_123',
        userId: 'user_123',
        role,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(() => MemberSchema.parse(member)).not.toThrow();
    });
  });

  it('should require all mandatory fields', () => {
    const incompleteMember = {
      id: 'member_123',
      organizationId: 'org_123',
      // missing userId and role
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => MemberSchema.parse(incompleteMember)).toThrow();
  });
});

describe('InvitationStatus', () => {
  it('should accept valid invitation statuses', () => {
    const statuses = ['pending', 'accepted', 'rejected', 'expired', 'canceled'];

    statuses.forEach((status) => {
      expect(() => InvitationStatus.parse(status)).not.toThrow();
    });
  });

  // [#7726] The vocabulary itself, spelled out: `canceled` was missing here
  // while `cancel-invitation` wrote it, so an invitation the platform had
  // canceled failed its own contract. A value list is the one thing a
  // "parses without throwing" loop cannot pin — it stays green when the enum
  // is widened by accident just as readily as on purpose.
  it('declares exactly the five shipped statuses, in order', () => {
    expect(InvitationStatus.options).toEqual([
      'pending',
      'accepted',
      'rejected',
      'expired',
      'canceled',
    ]);
  });

  it('should reject invalid status', () => {
    expect(() => InvitationStatus.parse('invalid')).toThrow();
  });

  it('still refuses an out-of-vocabulary value after the widening', () => {
    // Asserted on the issue rather than on the throw: widening an enum is
    // exactly the change that can slip into `z.string()` and keep every
    // `toThrow()` test green by no longer rejecting anything at all.
    const result = InvitationStatus.safeParse('cancelled'); // en-GB spelling — not the value
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('invalid_value');
  });
});

describe('InvitationSchema', () => {
  it('should accept valid invitation data', () => {
    const invitation: Invitation = {
      id: 'invite_123',
      organizationId: 'org_123',
      email: 'newuser@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      inviterId: 'user_123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => InvitationSchema.parse(invitation)).not.toThrow();
  });

  it('should use default status of pending', () => {
    const invitation = {
      id: 'invite_123',
      organizationId: 'org_123',
      email: 'newuser@example.com',
      role: 'member',
      expiresAt: new Date().toISOString(),
      inviterId: 'user_123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = InvitationSchema.parse(invitation);
    expect(result.status).toBe('pending');
  });

  it('should accept all valid statuses', () => {
    const statuses: Array<'pending' | 'accepted' | 'rejected' | 'expired' | 'canceled'> = [
      'pending',
      'accepted',
      'rejected',
      'expired',
      // [#7726] The row `cancel-invitation` actually leaves behind — this is
      // the case `InvitationSchema` used to reject.
      'canceled',
    ];

    statuses.forEach((status) => {
      const invitation = {
        id: 'invite_123',
        organizationId: 'org_123',
        email: 'newuser@example.com',
        role: 'member',
        status,
        expiresAt: new Date().toISOString(),
        inviterId: 'user_123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(() => InvitationSchema.parse(invitation)).not.toThrow();
    });
  });

  it('should validate email format', () => {
    const invitation = {
      id: 'invite_123',
      organizationId: 'org_123',
      email: 'invalid-email',
      role: 'member',
      expiresAt: new Date().toISOString(),
      inviterId: 'user_123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => InvitationSchema.parse(invitation)).toThrow();
  });

  it('should accept different role types', () => {
    const roles = ['admin', 'member', 'guest', 'viewer', 'editor'];

    roles.forEach((role) => {
      const invitation = {
        id: 'invite_123',
        organizationId: 'org_123',
        email: 'newuser@example.com',
        role,
        expiresAt: new Date().toISOString(),
        inviterId: 'user_123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      expect(() => InvitationSchema.parse(invitation)).not.toThrow();
    });
  });

  it('should require all mandatory fields', () => {
    const incompleteInvitation = {
      id: 'invite_123',
      organizationId: 'org_123',
      // missing email, role, expiresAt, inviterId
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => InvitationSchema.parse(incompleteInvitation)).toThrow();
  });
});

describe('Type inference', () => {
  it('should correctly infer Organization type', () => {
    const org: Organization = {
      id: 'org_123',
      name: 'Acme Corporation',
      slug: 'acme-corp',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // This test passes if TypeScript compiles without errors
    expect(org.id).toBe('org_123');
    expect(org.name).toBe('Acme Corporation');
    expect(org.slug).toBe('acme-corp');
  });

  it('should correctly infer Member type', () => {
    const member: Member = {
      id: 'member_123',
      organizationId: 'org_123',
      userId: 'user_123',
      role: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // This test passes if TypeScript compiles without errors
    expect(member.role).toBe('admin');
    expect(member.organizationId).toBe('org_123');
  });

  it('should correctly infer Invitation type', () => {
    const invitation: Invitation = {
      id: 'invite_123',
      organizationId: 'org_123',
      email: 'newuser@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: new Date().toISOString(),
      inviterId: 'user_123',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // This test passes if TypeScript compiles without errors
    expect(invitation.email).toBe('newuser@example.com');
    expect(invitation.status).toBe('pending');
  });
});
