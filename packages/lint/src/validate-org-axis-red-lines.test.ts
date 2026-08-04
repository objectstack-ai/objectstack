// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { ShareRecipientType, SharingRuleSchema, type SharingRuleInput } from '@objectstack/spec/security';

import {
  validateOrgAxisRedLines,
  ORG_AXIS_PERMISSION_INHERITANCE,
  ORG_AXIS_CROSS_ORG_BU_GRANT,
} from './validate-org-axis-red-lines.js';

const rules = (stack: unknown) => validateOrgAxisRedLines(stack).map((f) => f.rule);

/**
 * ── The fixture/schema drift guard (#4984) ──────────────────────────────────
 *
 * Every sharing-rule fixture below is built through `sharingRule()`, which
 * PARSES it with the real `SharingRuleSchema` before the lint ever sees it. A
 * fixture that drifts from the spec surface therefore fails here, loudly, at
 * the fixture — not silently, by exercising a code path no author can reach.
 *
 * This guard exists because its absence cost a red line. The pre-#4984 fixtures
 * spelled the rule's keys `criteria` and `sharedTo`; `SharingRuleSchema` is
 * `.strict()` and knows those two only as REJECTED aliases of `condition` and
 * `sharedWith`. The lint read the aliases too, so the tests passed against a
 * shape no spec-valid stack can contain: green tests, dead gate. Renaming the
 * keys alone would fix today's bug and leave tomorrow's drift undetectable —
 * this helper is the structural half of the fix.
 *
 * It returns the PARSED rule, which is also what the registry feeds the lint
 * (`input: 'parsed'`): `condition` arrives as the `{ dialect, source }`
 * envelope, not the authored string.
 */
function sharingRule(input: SharingRuleInput): Record<string, unknown> {
  const result = SharingRuleSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(
      `sharing-rule fixture is not spec-valid — the lint would be tested against a shape ` +
        `no author can write (#4984). Keys given: ${Object.keys(input as object).join(', ')}. ${detail}`,
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

/** Same guard for the object fixtures rule ② reads (`tenancy` / `systemFields`). */
function objectFixture(input: Record<string, unknown>): Record<string, unknown> {
  const result = ObjectSchema.safeParse({
    label: 'Fixture',
    fields: { name: { type: 'text', label: 'Name' } },
    ...input,
  });
  if (!result.success) {
    throw new Error(
      `object fixture is not spec-valid (#4984): ` +
        result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as Record<string, unknown>;
}

/** A recipient that is beyond reproach, for fixtures whose subject is the predicate. */
const HQ_TEAM = { type: 'team', value: 'hq' } as const;

describe('sharing-rule fixtures track the spec surface (meta-test, #4984)', () => {
  it('rejects a fixture spelled with the schema-rejected aliases', () => {
    // The exact pre-#4984 fixture shapes. Each must now fail at the fixture.
    expect(() =>
      sharingRule({
        name: 'hq_rollup',
        object: 'work_order',
        criteria: { parent_organization_id: 'org_hq' },
      } as unknown as SharingRuleInput),
    ).toThrow(/not spec-valid/);
    expect(() =>
      sharingRule({
        name: 'plant_team',
        object: 'work_order',
        sharedTo: { type: 'business_unit', id: 'bu_plant_a' },
      } as unknown as SharingRuleInput),
    ).toThrow(/not spec-valid/);
  });

  it('rejects the rejected recipient alias `id` (the recipient shape is strict too)', () => {
    expect(() =>
      sharingRule({
        name: 'r',
        type: 'criteria',
        object: 'work_order',
        // `id` is an alias of `value`, rejected by `sharingRecipientUnknownKeyError`.
        sharedWith: { type: 'business_unit', id: 'bu_plant_a' },
        condition: 'true',
      } as unknown as SharingRuleInput),
    ).toThrow(/not spec-valid/);
  });

  it('accepts the canonical shape and hands the lint the PARSED envelope', () => {
    const rule = sharingRule({
      name: 'ok',
      type: 'criteria',
      object: 'work_order',
      sharedWith: HQ_TEAM,
      condition: "record.status == 'open'",
    });
    expect(rule.condition).toEqual({ dialect: 'cel', source: "record.status == 'open'" });
    expect(rule.sharedWith).toEqual({ type: 'team', value: 'hq' });
  });
});

describe('validateOrgAxisRedLines — ① no permission inheritance on the org axis', () => {
  it('flags an RLS `using` on a permission set that walks the org parent', () => {
    const findings = validateOrgAxisRedLines({
      permissions: [
        {
          name: 'group_hq_reader',
          rowLevelSecurity: [
            {
              name: 'child_orgs',
              object: 'work_order',
              using: 'organization_id IN (current_user.parent_organization_id)',
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: ORG_AXIS_PERMISSION_INHERITANCE,
      path: 'permissions[0].rowLevelSecurity[0].using',
    });
    // The fix-it must point at membership, the mechanism that actually works.
    expect(findings[0].hint).toMatch(/accessible_org_ids/);
  });

  it('flags a `check` clause too (write-side inheritance is the same defect)', () => {
    expect(
      rules({
        permissions: [
          {
            name: 'p',
            rowLevelSecurity: [{ name: 'r', check: "parent_organization_id = 'org_hq'" }],
          },
        ],
      }),
    ).toEqual([ORG_AXIS_PERMISSION_INHERITANCE]);
  });

  it('flags an object-authored RLS policy', () => {
    const findings = validateOrgAxisRedLines({
      objects: [
        {
          name: 'work_order',
          rowLevelSecurity: [{ name: 'rollup', using: 'parent_organization_id = current_user.organization_id' }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].rowLevelSecurity[0].using');
  });

  it('flags a spec-valid sharing rule whose `condition` walks the org parent', () => {
    // Exactly the stack #4984 showed passing `os validate` / `os build` / `os lint`.
    const findings = validateOrgAxisRedLines({
      sharingRules: [
        sharingRule({
          name: 'hq_sees_children',
          type: 'criteria',
          object: 'work_order',
          sharedWith: HQ_TEAM,
          condition: "record.parent_organization_id == 'org_hq'",
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: ORG_AXIS_PERMISSION_INHERITANCE,
      path: 'sharingRules[0].condition',
    });
    expect(findings[0].where).toBe('sharing rule "hq_sees_children"');
    expect(findings[0].message).toMatch(/parent_organization_id/);
  });

  it('flags the pre-parse `condition` shape too (`os lint` runs on the normalized stack)', () => {
    // Bare-string shorthand — what the author typed, before `ExpressionInputSchema`
    // wraps it. The `parsed` tier falls back to `normalized` under `os lint`.
    expect(
      rules({
        sharingRules: [
          {
            name: 'hq_sees_children',
            type: 'criteria',
            object: 'work_order',
            sharedWith: { type: 'team', value: 'hq' },
            condition: "record.parent_organization_id == 'org_hq'",
          },
        ],
      }),
    ).toEqual([ORG_AXIS_PERMISSION_INHERITANCE]);
  });

  it('flags the compiled `{ dialect, ast }` condition shape', () => {
    expect(
      rules({
        sharingRules: [
          {
            name: 'hq_sees_children',
            object: 'work_order',
            sharedWith: { type: 'team', value: 'hq' },
            condition: {
              dialect: 'cel',
              ast: { type: 'binary', op: '==', left: { type: 'member', path: ['record', 'parent_organization_id'] } },
            },
          },
        ],
      }),
    ).toEqual([ORG_AXIS_PERMISSION_INHERITANCE]);
  });

  it('flags a recipient that reaches for the org parent', () => {
    const findings = validateOrgAxisRedLines({
      sharingRules: [
        sharingRule({
          name: 'by_parent_org',
          type: 'criteria',
          object: 'work_order',
          sharedWith: { type: 'team', value: 'parent_organization_id' },
          condition: 'true',
        }),
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('sharingRules[0].sharedWith');
  });

  it('does NOT resurrect the schema-rejected aliases — parse is that gate', () => {
    // `criteria` / `filter` / `sharedTo` / `recipient` are rejected by
    // `SharingRuleSchema` with a named fix-it. Reading them here as `??`
    // fallbacks is what made this rule inert (#4984); a consumer must not
    // tolerate what the producer's contract refuses (Prime Directive #12).
    expect(
      rules({
        sharingRules: [
          { name: 'a', object: 'work_order', criteria: { parent_organization_id: 'org_hq' } },
          { name: 'b', object: 'work_order', filter: "record.parent_organization_id == 'x'" },
          { name: 'c', object: 'work_order', sharedTo: { type: 'team', id: 'parent_organization_id' } },
          { name: 'd', object: 'work_order', recipient: { type: 'team', id: 'parent_organization_id' } },
        ],
      }),
    ).toEqual([]);
  });

  it('stays silent on membership-based and business-unit scoping (the sanctioned paths)', () => {
    expect(
      rules({
        permissions: [
          {
            name: 'plant_reader',
            rowLevelSecurity: [
              // ADR-0105 D2 — the engine's own union wall vocabulary.
              { name: 'my_orgs', using: 'organization_id IN (current_user.accessible_org_ids)' },
              // Intra-org hierarchy — the business-unit tree, not the org tree.
              { name: 'my_unit', using: 'business_unit_id IN (current_user.unit_ids)' },
              { name: 'mine', using: 'owner_id = current_user.id' },
            ],
          },
        ],
        sharingRules: [
          sharingRule({
            name: 'plant_team',
            type: 'criteria',
            object: 'work_order',
            sharedWith: { type: 'business_unit', value: 'bu_plant_a' },
            condition: "record.status == 'open'",
          }),
        ],
        objects: [objectFixture({ name: 'work_order' })],
      }),
    ).toEqual([]);
  });
});

/**
 * ── Rule ②'s recipient word list ────────────────────────────────────────────
 *
 * The two BU-tree recipients ② intercepts, and the three it deliberately lets
 * past. Split out here because the drift guard below asserts the two halves
 * partition `ShareRecipientType` exactly — the check whose absence is #4991.
 */
const BU_TREE_RECIPIENTS = ['business_unit', 'unit_and_subordinates'] as const;
const FLAT_RECIPIENTS = ['user', 'team', 'position'] as const;

describe('validateOrgAxisRedLines — ② business-unit trees stay org-internal', () => {
  const platformGlobalStack = (
    tenancy: unknown,
    recipientType: string = 'business_unit',
  ) => ({
    objects: [
      objectFixture(
        tenancy === undefined
          ? { name: 'material_catalog' }
          : { name: 'material_catalog', tenancy },
      ),
    ],
    sharingRules: [
      sharingRule({
        name: 'catalog_to_plant',
        type: 'criteria',
        object: 'material_catalog',
        sharedWith: { type: recipientType, value: 'bu_plant_a' },
        condition: 'true',
      } as unknown as SharingRuleInput),
    ],
  });

  /**
   * The word list ② enforces must PARTITION the authoring enum: every member of
   * `ShareRecipientType` is either intercepted as a BU-tree recipient or named
   * in the allowed half with a reason in the rule's own comment. No third
   * bucket, no silent remainder.
   *
   * This is the guard #4991 is the absence of. ② shipped naming a single
   * recipient, `business_unit`, while ADR-0105 D6 ②'s own sentence names
   * `unit_and_subordinates` — the strictly WIDER grant (a BU plus every
   * descendant unit) sailed past the gate that stopped the narrower one. A
   * sixth enum member added tomorrow fails HERE, at the vocabulary, instead of
   * quietly inheriting whichever bucket nobody chose for it.
   */
  it('partitions `ShareRecipientType` — no recipient is unaccounted for (#4991)', () => {
    const declared = [...ShareRecipientType.options].sort();
    const accounted = [...BU_TREE_RECIPIENTS, ...FLAT_RECIPIENTS].sort();
    expect(accounted).toEqual(declared);
  });

  it.each(BU_TREE_RECIPIENTS)(
    'flags a `%s` grant on a `tenancy.enabled: false` object',
    (recipientType) => {
      const findings = validateOrgAxisRedLines(platformGlobalStack({ enabled: false }, recipientType));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'error',
        rule: ORG_AXIS_CROSS_ORG_BU_GRANT,
        path: 'sharingRules[0].sharedWith',
      });
      expect(findings[0].message).toMatch(/spans EVERY organization/);
      // The diagnostic names the recipient actually written, not a generic
      // "business-unit rule" the author then has to go match up themselves.
      expect(findings[0].message).toContain(`\`${recipientType}\``);
    },
  );

  it('spells out that `unit_and_subordinates` reaches the whole subtree', () => {
    // The two recipients share a defect but not a blast radius: this one is the
    // BU plus every descendant unit (ADR-0057 D5), so the message says so.
    const [finding] = validateOrgAxisRedLines(
      platformGlobalStack({ enabled: false }, 'unit_and_subordinates'),
    );
    expect(finding.message).toMatch(/AND every descendant unit/);
    const [narrow] = validateOrgAxisRedLines(platformGlobalStack({ enabled: false }, 'business_unit'));
    expect(narrow.message).not.toMatch(/descendant/);
  });

  it('flags `unit_and_subordinates` under the `systemFields.tenant: false` spelling too', () => {
    expect(
      rules({
        objects: [objectFixture({ name: 'material_catalog', systemFields: { tenant: false } })],
        sharingRules: [
          sharingRule({
            name: 'r',
            type: 'criteria',
            object: 'material_catalog',
            sharedWith: { type: 'unit_and_subordinates', value: 'bu_field_ops' },
            condition: 'true',
          }),
        ],
      }),
    ).toEqual([ORG_AXIS_CROSS_ORG_BU_GRANT]);
  });

  it('allows `unit_and_subordinates` on an ORG-SCOPED object (the showcase shape)', () => {
    // `share_new_inquiries_with_field_ops` → `showcase_inquiry` in
    // examples/app-showcase: a real, correct subtree grant. The widened word
    // list must not turn the sanctioned intra-org case red.
    expect(rules(platformGlobalStack({ enabled: true }, 'unit_and_subordinates'))).toEqual([]);
    expect(rules(platformGlobalStack(undefined, 'unit_and_subordinates'))).toEqual([]);
  });

  it('flags the `systemFields.tenant: false` spelling of the same opt-out', () => {
    expect(
      rules({
        objects: [objectFixture({ name: 'material_catalog', systemFields: { tenant: false } })],
        sharingRules: [
          sharingRule({
            name: 'r',
            type: 'criteria',
            object: 'material_catalog',
            sharedWith: { type: 'business_unit', value: 'bu' },
            condition: 'true',
          }),
        ],
      }),
    ).toEqual([ORG_AXIS_CROSS_ORG_BU_GRANT]);
  });

  it('allows a business-unit grant on an ORG-SCOPED object (the normal case)', () => {
    expect(rules(platformGlobalStack({ enabled: true }))).toEqual([]);
    expect(rules(platformGlobalStack(undefined))).toEqual([]);
  });

  it.each(FLAT_RECIPIENTS)(
    'allows the flat `%s` audience on a platform-global object (the sanctioned path)',
    (recipientType) => {
      // These three expand with no business-unit tree involved — `user` not at
      // all, `team` via `TeamGraphService`, `position` flat over holders
      // (ADR-0090 D3). Sharing a platform-global catalog to them is what
      // `tenancy.enabled: false` is FOR; ② forbids resolving a BU subtree with
      // no organization to resolve it within, not sharing a global object.
      expect(
        rules({
          objects: [objectFixture({ name: 'material_catalog', tenancy: { enabled: false } })],
          sharingRules: [
            sharingRule({
              name: 'r',
              type: 'criteria',
              object: 'material_catalog',
              sharedWith: { type: recipientType, value: 'buyer' },
              condition: 'true',
            } as unknown as SharingRuleInput),
          ],
        }),
      ).toEqual([]);
    },
  );
});

describe('validateOrgAxisRedLines — input tolerance', () => {
  it('returns no findings for empty / malformed input instead of throwing', () => {
    expect(validateOrgAxisRedLines(undefined)).toEqual([]);
    expect(validateOrgAxisRedLines({})).toEqual([]);
    expect(validateOrgAxisRedLines({ permissions: 'nonsense', objects: 42 })).toEqual([]);
  });

  it('accepts the name-keyed map shape as well as arrays', () => {
    expect(
      rules({
        permissions: {
          group_hq: { rowLevelSecurity: [{ name: 'r', using: 'parent_organization_id = 1' }] },
        },
      }),
    ).toEqual([ORG_AXIS_PERMISSION_INHERITANCE]);
  });
});
