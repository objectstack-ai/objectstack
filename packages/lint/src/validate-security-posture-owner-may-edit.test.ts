// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §3 amendment · #25760 · ruling 6398566164]
 * `security-controlled-by-parent-owner-policy-without-opt-in`: an `update`
 * (or `all`) row-level policy keyed on the caller — `owner_id ==
 * current_user.id` — on a `controlled_by_parent` detail that has NOT declared
 * `sharing: { controlledByParent: { ownerMayEdit: true } }` can only narrow
 * the master's editors; it never admits the row's owner, which is what such a
 * policy is written to do. Advisory (`warning`): a narrowing can be meant, and
 * no runtime door refuses the shape.
 *
 * The positive control comes first; every silence below is measured against
 * the same fixture with one thing changed.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackSchema } from '@objectstack/spec';
import { ObjectSchema } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN, validateSecurityPosture } from './validate-security-posture.js';
import { explainRule } from './rule-explanations.js';

const MASTER = { name: 'omd_contract', label: 'Contract', sharingModel: 'private', fields: { name: { name: 'name', type: 'text', label: 'Name' } } };
const DETAIL_FIELDS = {
  name: { name: 'name', type: 'text', label: 'Name' },
  contract: { name: 'contract', type: 'master_detail', label: 'Contract', reference: 'omd_contract', required: true },
};
/** A `controlled_by_parent` detail with one resolving master, plus `extra` (the opt-in, or nothing). */
const detail = (extra: Record<string, unknown> = {}) => ({
  name: 'omd_obligation', label: 'Obligation', sharingModel: 'controlled_by_parent', fields: DETAIL_FIELDS, ...extra,
});
const OPT_IN = { sharing: { controlledByParent: { ownerMayEdit: true } } };

type Policy = Record<string, unknown>;
const policy = (overrides: Policy = {}): Policy => ({
  name: 'omd_obligation_owner_updates', object: 'omd_obligation', operation: 'update', using: 'owner_id == current_user.id', ...overrides,
});
const stack = (objects: unknown[], ...policies: Policy[]) => ({
  objects,
  permissions: [{ name: 'omd_requester', label: 'Requester', objects: {}, rowLevelSecurity: policies }],
});

const ownerArm = (s: Record<string, unknown>) =>
  validateSecurityPosture(s).filter((f) => f.rule === SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN);

describe('security-controlled-by-parent-owner-policy-without-opt-in (#25760)', () => {
  // ── POSITIVE CONTROL — the arm must be able to SEE before any silence below is worth believing.
  it('flags an owner-keyed update policy on a controlled_by_parent detail that has not opted in — one warning, at the predicate', () => {
    const findings = ownerArm(stack([MASTER, detail()], policy()));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN,
      where: 'permission set "omd_requester"',
      path: 'permissions[0].rowLevelSecurity[0].using',
    });
    expect(findings[0].message).toContain('update policy "omd_obligation_owner_updates" keys on the caller (owner_id == current_user.id)');
    expect(findings[0].message).toContain('controlled_by_parent detail "omd_obligation", which has not opted in');
    expect(findings[0].message).toContain('never admits the owner');
    expect(findings[0].hint).toContain('sharing: { controlledByParent: { ownerMayEdit: true } }');
    expect(findings[0].hint).toContain('"omd_obligation"');
  });

  it('silent once the detail declares the opt-in — the policy then decides as authored', () => {
    expect(ownerArm(stack([MASTER, detail(OPT_IN)], policy()))).toEqual([]);
  });

  it('`os explain` carries the rule', () => {
    const explanation = explainRule(SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN);
    expect(explanation?.rule).toBe(SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN);
    expect(explanation?.paragraphs.join('\n')).toContain('ownerMayEdit');
  });

  describe('the predicate shapes that key on the caller', () => {
    it.each([
      ['the SQL spelling the compiler bridges', 'owner_id = current_user.id'],
      ['the operands reversed', 'current_user.id == owner_id'],
      ['the record-qualified field', 'record.owner_id == current_user.id'],
      ['a conjunction carrying the identity term', "owner_id == current_user.id && stage == 'open'"],
      ['a disjunction carrying the identity term', "stage == 'open' || owner_id == current_user.id"],
    ])('%s', (_label, using) => {
      const findings = ownerArm(stack([MASTER, detail()], policy({ using })));
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('(owner_id == current_user.id)');
    });

    it('names every caller-keyed field once, in predicate order', () => {
      const findings = ownerArm(stack([MASTER, detail()], policy({ using: 'assignee == current_user.id || owner_id == current_user.id || owner_id == current_user.id' })));
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('(assignee == current_user.id, owner_id == current_user.id)');
    });

    it('a `check` predicate is judged too, at its own path; `using` and `check` each report once', () => {
      const findings = ownerArm(stack([MASTER, detail()], policy({ using: "stage == 'open'", check: 'owner_id == current_user.id' })));
      expect(findings.map((f) => f.path)).toEqual(['permissions[0].rowLevelSecurity[0].check']);
      const both = ownerArm(stack([MASTER, detail()], policy({ check: 'owner_id == current_user.id' })));
      expect(both.map((f) => f.path)).toEqual([
        'permissions[0].rowLevelSecurity[0].using',
        'permissions[0].rowLevelSecurity[0].check',
      ]);
    });

    it.each([
      ['a predicate that does not key on the caller', "stage == 'open'"],
      ['a comparison other than equality', 'owner_id != current_user.id'],
      ['the caller compared to a literal, not a field', "current_user.id == 'usr_1'"],
      ['a traversal, which the compiler refuses and is not a field', 'contract.owner_id == current_user.id'],
      ['a predicate that does not parse (the parse rule reports it)', 'owner_id == ('],
      ['an empty predicate', ''],
    ])('silent on %s', (_label, using) => {
      expect(ownerArm(stack([MASTER, detail()], policy({ using })))).toEqual([]);
    });
  });

  describe('which policies are the arm\'s subject', () => {
    it('`all` covers update and is flagged; select, insert and delete are not', () => {
      expect(ownerArm(stack([MASTER, detail()], policy({ operation: 'all' })))).toHaveLength(1);
      for (const operation of ['select', 'insert', 'delete']) {
        expect(ownerArm(stack([MASTER, detail()], policy({ operation }))), operation).toEqual([]);
      }
    });

    it('a disabled policy is not judged', () => {
      expect(ownerArm(stack([MASTER, detail()], policy({ enabled: false })))).toEqual([]);
      expect(ownerArm(stack([MASTER, detail()], policy({ enabled: true })))).toHaveLength(1);
    });

    it("a wildcard policy ('*') names no detail", () => {
      expect(ownerArm(stack([MASTER, detail()], policy({ object: '*' })))).toEqual([]);
    });

    it('each policy reports at its own index, across sets', () => {
      const findings = validateSecurityPosture({
        objects: [MASTER, detail()],
        permissions: [
          { name: 'first', objects: {}, rowLevelSecurity: [policy({ using: "stage == 'open'" }), policy({ name: 'second_of_first' })] },
          { name: 'second', objects: {}, rowLevelSecurity: [policy({ name: 'first_of_second', operation: 'all' })] },
        ],
      }).filter((f) => f.rule === SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN);
      expect(findings.map((f) => [f.where, f.path])).toEqual([
        ['permission set "first"', 'permissions[0].rowLevelSecurity[1].using'],
        ['permission set "second"', 'permissions[1].rowLevelSecurity[0].using'],
      ]);
      expect(findings[0].message).toContain('"second_of_first"');
      expect(findings[1].message).toContain('"first_of_second"');
    });
  });

  describe('which objects are the arm\'s subject', () => {
    it('silent on a private object: its own update policy admits as authored', () => {
      expect(ownerArm(stack([MASTER, detail({ sharingModel: 'private' })], policy()))).toEqual([]);
    });

    it('silent on a controlled_by_parent object whose master does not resolve — the no-relation rule owns that object', () => {
      const findings = validateSecurityPosture(stack([MASTER, detail({ fields: { name: DETAIL_FIELDS.name } })], policy()));
      expect(findings.map((f) => f.rule)).toContain('security-controlled-by-parent-no-relation');
      expect(findings.map((f) => f.rule)).not.toContain(SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN);
    });

    it('silent on a policy naming an object the stack does not declare', () => {
      expect(ownerArm(stack([MASTER, detail()], policy({ object: 'omd_elsewhere' })))).toEqual([]);
    });

    it('`ownerMayEdit: false` is not an opt-in', () => {
      expect(ownerArm(stack([MASTER, detail({ sharing: { controlledByParent: { ownerMayEdit: false } } })], policy()))).toHaveLength(1);
    });
  });

  // [#26591] The opt-in admits ONE column — the stored row's `owner_id`, on a
  // detail that carries it — so the arm prescribes it only there. hotclm's
  // shape: the accountable person is the detail's own user field `owner`, and
  // the requester's update policy keys on it.
  describe('the opt-in is prescribed only where it admits (#26591)', () => {
    const OWNER_FIELD = { owner: { name: 'owner', type: 'user', reference: 'sys_user', label: 'Owner' } };
    /** hotclm's `clm_obligation`: a `controlled_by_parent` detail with its own `owner` user field. */
    const hotclmDetail = (extra: Record<string, unknown> = {}) =>
      detail({ fields: { ...DETAIL_FIELDS, ...OWNER_FIELD }, ...extra });
    const ownerPolicy = policy({ name: 'obligation_requester_own', using: 'owner == current_user.id' });

    it('an owner_id-keyed policy without the opt-in: flagged, and the opt-in is the remedy', () => {
      const findings = ownerArm(stack([MASTER, hotclmDetail()], policy()));
      expect(findings).toHaveLength(1);
      expect(findings[0].hint).toContain('Declare sharing: { controlledByParent: { ownerMayEdit: true } }');
    });

    it('an owner_id-keyed policy with the opt-in: silent', () => {
      expect(ownerArm(stack([MASTER, hotclmDetail(OPT_IN)], policy()))).toEqual([]);
    });

    it('an other-field policy without the opt-in: flagged with the owner_id remedy, never the opt-in', () => {
      const findings = ownerArm(stack([MASTER, hotclmDetail()], ownerPolicy));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        severity: 'warning',
        rule: SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN,
        path: 'permissions[0].rowLevelSecurity[0].using',
      });
      expect(findings[0].message).toContain('(owner == current_user.id)');
      expect(findings[0].message).toContain("ownerMayEdit admits only the row's stored owner_id");
      expect(findings[0].hint).toContain('Key the accountable person on owner_id');
      expect(findings[0].hint).not.toContain('ownerMayEdit');
    });

    it('an other-field policy with the opt-in: still flagged, the opt-in does not admit that field', () => {
      const findings = ownerArm(stack([MASTER, hotclmDetail(OPT_IN)], ownerPolicy));
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('(owner == current_user.id)');
      expect(findings[0].message).toContain("the opt-in it declares (sharing.controlledByParent.ownerMayEdit) admits only the row's stored owner_id");
      expect(findings[0].hint).toContain('Key the accountable person on owner_id');
      expect(findings[0].hint).not.toContain('ownerMayEdit');
    });

    it('a predicate keying owner_id beside another field is one the opt-in serves: prescribed without it, silent with it', () => {
      const mixed = policy({ using: 'owner == current_user.id || owner_id == current_user.id' });
      const findings = ownerArm(stack([MASTER, hotclmDetail()], mixed));
      expect(findings).toHaveLength(1);
      expect(findings[0].hint).toContain('ownerMayEdit: true');
      expect(ownerArm(stack([MASTER, hotclmDetail(OPT_IN)], mixed))).toEqual([]);
    });

    describe('a detail that carries no owner_id: the opt-in names nobody there', () => {
      it.each([
        ['ownership: org', { ownership: 'org' }],
        ['ownership: none', { ownership: 'none' }],
        ['ownership: business_unit', { ownership: 'business_unit' }],
      ])('%s — an owner_id-keyed policy is flagged with the owner-column remedy, with or without the opt-in', (_label, ownership) => {
        for (const extra of [ownership, { ...ownership, ...OPT_IN }]) {
          const findings = ownerArm(stack([MASTER, detail(extra)], policy()));
          expect(findings, JSON.stringify(extra)).toHaveLength(1);
          expect(findings[0].message).toContain('a column "omd_obligation" does not carry');
          expect(findings[0].hint).toContain('Give "omd_obligation" an owner_id column');
          expect(findings[0].hint).not.toContain('ownerMayEdit');
        }
      });

      it("an author's own owner_id field is the column the runtime reads: the opt-in is prescribed, then silent", () => {
        const ownOwner = { ownership: 'none', fields: { ...DETAIL_FIELDS, owner_id: { name: 'owner_id', type: 'user', reference: 'sys_user', label: 'Owner' } } };
        expect(ownerArm(stack([MASTER, detail(ownOwner)], policy()))[0]?.hint).toContain('ownerMayEdit: true');
        expect(ownerArm(stack([MASTER, detail({ ...ownOwner, ...OPT_IN })], policy()))).toEqual([]);
      });
    });

    it('the hotclm fixture is key-legal: the stack schema refuses no key it carries', () => {
      const result = ObjectStackSchema.safeParse({
        manifest: { id: 'com.example.omd', name: 'omd', version: '1.0.0', type: 'app' },
        ...stack([MASTER, hotclmDetail(OPT_IN)], ownerPolicy),
      });
      expect(result.success ? [] : result.error.issues.filter((i) => i.code === 'unrecognized_keys')).toEqual([]);
    });
  });

  describe('the parsed path reads what the raw path reads', () => {
    it('the PARSED detail and set: flagged without the opt-in, silent with it', () => {
      const parsedSet = PermissionSetSchema.parse({ name: 'omd_requester', objects: {}, rowLevelSecurity: [policy()] });
      const without = { objects: [ObjectSchema.parse(MASTER), ObjectSchema.parse(detail())], permissions: [parsedSet] };
      expect(ownerArm(without)).toHaveLength(1);
      const withOptIn = { objects: [ObjectSchema.parse(MASTER), ObjectSchema.parse(detail(OPT_IN))], permissions: [parsedSet] };
      expect(ownerArm(withOptIn)).toEqual([]);
    });

    it('the fixture is key-legal: the stack schema refuses no key it carries', () => {
      const result = ObjectStackSchema.safeParse({
        manifest: { id: 'com.example.omd', name: 'omd', version: '1.0.0', type: 'app' },
        ...stack([MASTER, detail(OPT_IN)], policy()),
      });
      expect(result.success ? [] : result.error.issues.filter((i) => i.code === 'unrecognized_keys')).toEqual([]);
    });
  });
});
