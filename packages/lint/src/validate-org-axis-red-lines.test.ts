// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { ObjectStackSchema } from '@objectstack/spec';
import { ObjectSchema } from '@objectstack/spec/data';
import {
  PermissionSetSchema,
  RowLevelSecurityPolicySchema,
  ShareRecipientType,
  SharingRuleSchema,
  type PermissionSet,
  type SharingRule,
} from '@objectstack/spec/security';

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
function sharingRule(input: SharingRule): Record<string, unknown> {
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

/**
 * Same guard for the permission-set fixtures rule ① reads (#5009).
 *
 * `permissions[].rowLevelSecurity` is the ONLY authorable RLS surface —
 * `ObjectSchema` declares no `rowLevelSecurity` (nor `rls`) and is `.strict()`,
 * so the object-level traversal this rule used to carry could not run against a
 * stack that parses. Building rule ①'s fixtures through the real schema is what
 * keeps that from quietly coming back: a fixture for a surface the spec does
 * not have now fails HERE.
 */
function permissionSet(input: PermissionSet): Record<string, unknown> {
  const result = PermissionSetSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `permission-set fixture is not spec-valid (#5009): ` +
        result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
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
      } as unknown as SharingRule),
    ).toThrow(/not spec-valid/);
    expect(() =>
      sharingRule({
        name: 'plant_team',
        object: 'work_order',
        sharedTo: { type: 'business_unit', id: 'bu_plant_a' },
      } as unknown as SharingRule),
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
      } as unknown as SharingRule),
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
        permissionSet({
          name: 'group_hq_reader',
          label: 'Group HQ Reader',
          objects: {},
          rowLevelSecurity: [
            {
              name: 'child_orgs',
              object: 'work_order',
              operation: 'select',
              using: 'organization_id IN (current_user.parent_organization_id)',
            },
          ],
        }),
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
          permissionSet({
            name: 'pset',
            label: 'P',
            objects: {},
            rowLevelSecurity: [
              { name: 'r', object: 'work_order', operation: 'all', check: "parent_organization_id = 'org_hq'" },
            ],
          }),
        ],
      }),
    ).toEqual([ORG_AXIS_PERMISSION_INHERITANCE]);
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
          permissionSet({
            name: 'plant_reader',
            label: 'Plant Reader',
            objects: {},
            rowLevelSecurity: [
              // ADR-0105 D2 — the engine's own union wall vocabulary.
              {
                name: 'my_orgs',
                object: 'work_order',
                operation: 'select',
                using: 'organization_id IN (current_user.accessible_org_ids)',
              },
              // Intra-org hierarchy — the business-unit tree, not the org tree.
              {
                name: 'my_unit',
                object: 'work_order',
                operation: 'select',
                using: 'business_unit_id IN (current_user.unit_ids)',
              },
              { name: 'mine', object: 'work_order', operation: 'select', using: 'owner_id = current_user.id' },
            ],
          }),
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
 * ── The surfaces this rule deliberately does NOT read (#5009) ───────────────
 *
 * #4984 removed the `??` alias reads from the sharing rule's FIELDS and left
 * three more of the same shape one level up. Each is pinned here against the
 * schema fact that makes it unreachable, so "put the fallback back, just in
 * case" fails a test with the evidence attached rather than passing quietly.
 */
const MANIFEST = { id: 'org_axis_probe', name: 'org_axis_probe', version: '1.0.0', type: 'app' } as const;

/** The violating RLS policy shape, spelled for the object-level key that does not exist. */
const ORG_WALKING_POLICY = { name: 'rollup', using: 'parent_organization_id = current_user.organization_id' };

describe('validateOrgAxisRedLines — undeclared keys are the schema’s job, not this rule’s (#5009)', () => {
  it('object-level RLS is not an authoring surface: `ObjectSchema` declares neither `rowLevelSecurity` nor `rls`', () => {
    const objectKeys = Object.keys(ObjectSchema.shape);
    expect(objectKeys).not.toContain('rowLevelSecurity');
    expect(objectKeys).not.toContain('rls');
    // The only declared home for RLS policies is the permission set.
    expect(Object.keys(PermissionSetSchema.shape)).toContain('rowLevelSecurity');

    // And `ObjectSchema` is `.strict()`, so this is not a silent strip: a stack
    // carrying an object-level policy is REFUSED by `os validate` / `os build`,
    // by name. The traversal deleted in #5009 could therefore never run against
    // a stack anyone can ship — it only ever described a surface that isn't.
    const refused = ObjectStackSchema.safeParse({
      manifest: MANIFEST,
      objects: [
        {
          name: 'work_order',
          label: 'Work Order',
          fields: { name: { type: 'text', label: 'Name' } },
          rowLevelSecurity: [ORG_WALKING_POLICY],
        },
      ],
    });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.message).join(' ')).toMatch(
      /Unrecognized key\(s\) on this object: `rowLevelSecurity`/,
    );

    // The lint stays silent on both spellings — as it did BEFORE the deletion
    // for every stack that parses. Removing dead code changed no verdict.
    expect(rules({ objects: [{ name: 'work_order', rowLevelSecurity: [ORG_WALKING_POLICY] }] })).toEqual([]);
    expect(rules({ objects: [{ name: 'work_order', rls: [ORG_WALKING_POLICY] }] })).toEqual([]);
  });

  it('`permissionSets` / `sharing` are not stack-root keys — the root now REFUSES them (#8687)', () => {
    const rootKeys = Object.keys(ObjectStackSchema.shape);
    expect(rootKeys).toEqual(expect.arrayContaining(['permissions', 'sharingRules']));
    expect(rootKeys).not.toContain('permissionSets');
    expect(rootKeys).not.toContain('sharing');

    // When this pin was written the root STRIPPED rather than rejected — which
    // is precisely why the dead branch was invisible: the stack parsed, and the
    // key the rule reached for was simply gone. #8687 closed the root
    // (`strictObject`, the last #4001 door), so the same wrong spellings now
    // fail the parse loudly, naming both keys. The rule's position is
    // unchanged either way: the diagnostic belongs to the schema.
    const parsed = ObjectStackSchema.safeParse({
      manifest: MANIFEST,
      permissionSets: [{ name: 'pset', label: 'P', objects: {} }],
      sharing: [{ name: 'r', type: 'criteria', object: 'o', sharedWith: HQ_TEAM, condition: 'true' }],
    });
    expect(parsed.success).toBe(false);
    const issue = parsed.success ? undefined : parsed.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue).toBeDefined();
    expect((issue as unknown as { keys: string[] }).keys).toEqual(
      expect.arrayContaining(['permissionSets', 'sharing']),
    );

    // So the rule reads the declared spellings only. A stack that spells them
    // the other way gets its diagnostic from the schema, not from a red line
    // that would fire on a shape `os validate` never lets through.
    expect(
      rules({
        permissionSets: [
          { name: 'p', rowLevelSecurity: [{ name: 'r', using: "parent_organization_id = 'org_hq'" }] },
        ],
        sharing: [
          { name: 's', object: 'work_order', condition: "record.parent_organization_id == 'x'" },
        ],
      }),
    ).toEqual([]);
  });

  it('`sharingRules[].objectName` is rejected by name, and `object` is required on any rule that parsed', () => {
    expect(Object.keys(SharingRuleSchema.shape)).toContain('object');
    expect(Object.keys(SharingRuleSchema.shape)).not.toContain('objectName');
    expect(() =>
      sharingRule({
        name: 'r',
        type: 'criteria',
        objectName: 'material_catalog',
        sharedWith: { type: 'business_unit', value: 'bu' },
        condition: 'true',
      } as unknown as SharingRule),
    ).toThrow(/not spec-valid/);
    // ② therefore never needs a fallback for the rule's target object.
    expect(
      rules({
        objects: [objectFixture({ name: 'material_catalog', tenancy: { enabled: false } })],
        sharingRules: [
          { name: 'r', objectName: 'material_catalog', sharedWith: { type: 'business_unit', value: 'bu' } },
        ],
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
      } as unknown as SharingRule),
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
            } as unknown as SharingRule),
          ],
        }),
      ).toEqual([]);
    },
  );
});

/**
 * ── The structural meta-guard (#4992 pattern, #5009) ────────────────────────
 *
 * The two tests above pin the three branches #5009 removed. These two pin the
 * PROPERTY that made them removable, so the next one is caught before review:
 *
 * 1. **Declared-key guard.** Every key this rule reads off a stack, permission
 *    set, RLS policy, object or sharing rule must appear in that surface's own
 *    Zod `.shape`. A rule registered `input: 'parsed'` can only ever see
 *    declared keys, so a read of anything else is dead on arrival — this is the
 *    check whose absence cost #4984 a red line and #5009 three more branches.
 *    Scanning the source (not the behaviour) is deliberate: an unreachable
 *    branch has no behaviour to assert on, which is exactly the problem.
 *
 * 2. **Reachability guard.** Every `findings.push` site must be reached by at
 *    least one fixture that passed `safeParse`. A gate no spec-valid stack can
 *    trip is not a gate; it is documentation of a surface that does not exist,
 *    and it reads as an invitation to write more code against it.
 */
const RULE_SOURCE = readFileSync(new URL('./validate-org-axis-red-lines.ts', import.meta.url), 'utf8');

/** The rule's CODE — comments stripped, since the guards below scan reads, not prose. */
const RULE_CODE = RULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Distinct property names read off `receiver` in the rule's code. */
function keysReadOff(receiver: string): string[] {
  const re = new RegExp(`\\b${receiver}\\??\\.([A-Za-z_$][\\w$]*)`, 'g');
  return [...new Set([...RULE_CODE.matchAll(re)].map((m) => m[1]))].sort();
}

const shapeKeys = (schema: unknown): string[] =>
  Object.keys((schema as { shape: Record<string, unknown> }).shape);

/**
 * Each receiver in the rule's body, the keys it is EXPECTED to read, and the
 * schema that has to declare every one of them. The expected list is spelled
 * out so that adding a read (or renaming a parameter, which would silently
 * disarm the scan) forces a deliberate visit to this table.
 */
const READ_SURFACES: Array<{
  receiver: string;
  expected: string[];
  declaredBy: string;
  keys: () => string[];
}> = [
  {
    receiver: 'cfg',
    expected: ['objects', 'permissions', 'sharingRules'],
    declaredBy: 'ObjectStackSchema',
    keys: () => shapeKeys(ObjectStackSchema),
  },
  {
    receiver: 'ps',
    expected: ['name', 'rowLevelSecurity'],
    declaredBy: 'PermissionSetSchema',
    keys: () => shapeKeys(PermissionSetSchema),
  },
  {
    receiver: 'policy',
    expected: ['name'],
    declaredBy: 'RowLevelSecurityPolicySchema',
    keys: () => shapeKeys(RowLevelSecurityPolicySchema),
  },
  {
    receiver: 'object',
    expected: ['systemFields', 'tenancy'],
    declaredBy: 'ObjectSchema',
    keys: () => shapeKeys(ObjectSchema),
  },
  {
    receiver: 'rule',
    expected: ['condition', 'name', 'object', 'sharedWith'],
    declaredBy: 'SharingRuleSchema',
    keys: () => shapeKeys(SharingRuleSchema),
  },
  {
    receiver: 'sharedWith',
    expected: ['type'],
    declaredBy: 'SharingRuleSchema.sharedWith',
    keys: () => shapeKeys((SharingRuleSchema as unknown as { shape: { sharedWith: unknown } }).shape.sharedWith),
  },
];

describe('validateOrgAxisRedLines — reads only keys the spec declares (meta-test, #5009)', () => {
  it.each(READ_SURFACES)('every key read off `$receiver` is declared by $declaredBy', (surface) => {
    const read = keysReadOff(surface.receiver);
    expect(read).toEqual(surface.expected);
    const declared = surface.keys();
    expect(read.filter((k) => !declared.includes(k))).toEqual([]);
  });

  it('the RLS clause list is spelled from `RowLevelSecurityPolicySchema` keys', () => {
    // `policy[clause]` is a COMPUTED read, so the scan above cannot see it; the
    // word list it indexes with is checked here instead.
    const match = /for \(const clause of \[([^\]]*)\] as const\)/.exec(RULE_CODE);
    expect(match, 'the clause loop moved — update this guard').not.toBeNull();
    const clauses = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(clauses).toEqual(['using', 'check']);
    const declared = shapeKeys(RowLevelSecurityPolicySchema);
    expect(clauses.filter((c) => !declared.includes(c))).toEqual([]);
  });
});

/** A `findings.push` call site, as the rule's source declares it. */
interface PushSite {
  rule: string;
  pathTemplate: string;
}

const RULE_IDS: Record<string, string> = {
  ORG_AXIS_PERMISSION_INHERITANCE,
  ORG_AXIS_CROSS_ORG_BU_GRANT,
};

function pushSites(): PushSite[] {
  return RULE_CODE.split('findings.push({')
    .slice(1)
    .map((block, i) => {
      const ruleConst = /rule:\s*([A-Z_][A-Z0-9_]*)/.exec(block)?.[1];
      const pathTemplate = /path:\s*`([^`]*)`/.exec(block)?.[1];
      if (!ruleConst || !pathTemplate) {
        throw new Error(`findings.push site #${i} has no literal \`rule:\` / \`path:\` — the guard cannot map it`);
      }
      const rule = RULE_IDS[ruleConst];
      if (!rule) throw new Error(`findings.push site #${i} emits unknown rule id \`${ruleConst}\``);
      return { rule, pathTemplate };
    });
}

/** `permissions[${i}].rowLevelSecurity[${j}].${clause}` → a matcher for a concrete path. */
function templateToRegex(template: string): RegExp {
  const literals = template.split(/\$\{[^}]*\}/g).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${literals.join('[^.\\[\\]]+')}$`);
}

/**
 * One spec-valid stack per branch the rule still carries. EVERY fixture here
 * goes through `safeParse` (via the helpers at the top of this file), so a
 * branch is only "covered" if a stack an author can actually ship reaches it.
 */
const REACHABILITY_CORPUS: Array<{ label: string; stack: unknown }> = [
  {
    label: '① permission-set RLS `using`',
    stack: {
      permissions: [
        permissionSet({
          name: 'group_hq_reader',
          label: 'Group HQ Reader',
          objects: {},
          rowLevelSecurity: [
            {
              name: 'child_orgs',
              object: 'work_order',
              operation: 'select',
              using: 'organization_id IN (current_user.parent_organization_id)',
            },
          ],
        }),
      ],
    },
  },
  {
    label: '① permission-set RLS `check`',
    stack: {
      permissions: [
        permissionSet({
          name: 'group_hq_writer',
          label: 'Group HQ Writer',
          objects: {},
          rowLevelSecurity: [
            {
              name: 'child_orgs',
              object: 'work_order',
              operation: 'insert',
              check: "parent_organization_id = 'org_hq'",
            },
          ],
        }),
      ],
    },
  },
  {
    label: '① sharing-rule `condition`',
    stack: {
      sharingRules: [
        sharingRule({
          name: 'hq_sees_children',
          type: 'criteria',
          object: 'work_order',
          sharedWith: HQ_TEAM,
          condition: "record.parent_organization_id == 'org_hq'",
        }),
      ],
    },
  },
  {
    label: '① sharing-rule `sharedWith`',
    stack: {
      sharingRules: [
        sharingRule({
          name: 'by_parent_org',
          type: 'criteria',
          object: 'work_order',
          sharedWith: { type: 'team', value: 'parent_organization_id' },
          condition: 'true',
        }),
      ],
    },
  },
  {
    label: '② BU grant on a platform-global object',
    stack: {
      objects: [objectFixture({ name: 'material_catalog', tenancy: { enabled: false } })],
      sharingRules: [
        sharingRule({
          name: 'catalog_to_plant',
          type: 'criteria',
          object: 'material_catalog',
          sharedWith: { type: 'unit_and_subordinates', value: 'bu_plant_a' },
          condition: 'true',
        }),
      ],
    },
  },
];

describe('validateOrgAxisRedLines — every branch is reachable by a spec-valid stack (meta-test, #5009)', () => {
  it('maps every `findings.push` site in the source', () => {
    const sites = pushSites();
    // ① permission-set RLS, ① sharing rule, ② cross-org BU grant. The fourth —
    // `objects[].rowLevelSecurity[].${clause}` — is gone: no such surface.
    expect(sites).toHaveLength(3);
    expect(sites.map((s) => s.pathTemplate)).not.toContain(
      'objects[${oIndex}].rowLevelSecurity[${pIndex}].${clause}',
    );
  });

  it('reaches every site from a fixture that passed `safeParse`', () => {
    const emitted = REACHABILITY_CORPUS.flatMap(({ stack }) => validateOrgAxisRedLines(stack));
    expect(emitted.length).toBeGreaterThanOrEqual(pushSites().length);

    const unreached = pushSites().filter(
      (site) =>
        !emitted.some((f) => f.rule === site.rule && templateToRegex(site.pathTemplate).test(f.path)),
    );
    expect(
      unreached.map((s) => `${s.rule} @ ${s.pathTemplate}`),
      'a branch no spec-valid stack can reach must be deleted, not kept "just in case" (#5009)',
    ).toEqual([]);
  });

  it('emits no path the source does not declare', () => {
    const matchers = pushSites().map((s) => ({ rule: s.rule, re: templateToRegex(s.pathTemplate) }));
    const emitted = REACHABILITY_CORPUS.flatMap(({ stack }) => validateOrgAxisRedLines(stack));
    for (const finding of emitted) {
      expect(matchers.some((m) => m.rule === finding.rule && m.re.test(finding.path))).toBe(true);
    }
  });
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
