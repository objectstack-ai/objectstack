// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25234 ruling A, refusals 7, 11, 12 and 13] The `rls-predicate-*` judge
 * meets declared membership keys (`ObjectSchema.membershipKeys`).
 *
 * - **7.** A key's `filter` is judged by the same passes as a row policy's
 *   `using`, with the declaring object as its target, plus one check of its
 *   own: it reads no `current_user` value. The security plugin compiles it
 *   with no caller before the roster read, so a filter that does not compile
 *   leaves the key unresolved.
 * - **11.** A policy testing a declared key against a column whose values can
 *   never be the key's: a reference to another object, a column that is no
 *   reference, the `id` of another object.
 * - **12.** At the runtime publish gate, which knows the registered resolver's
 *   keys, a key in a membership position that no kernel key, declaration or
 *   resolver owns. Unchanged on the CLI: `unknowable`.
 * - **13.** A declared key under `==` is the type fault a kernel list key earns,
 *   not "nothing pre-resolves".
 *
 * Every object fixture passes `ObjectSchema` first.
 */

import { describe, expect, it } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';

import {
  RLS_PREDICATE_MEMBERSHIP_KEY_TARGET,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNKNOWN_FIELD,
  RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
  validateRlsPredicateEnforceability,
  type RlsPredicateFinding,
} from './validate-rls-predicate-enforceability.js';
import { membershipKeyOwnersOf } from './validate-membership-key-declarations.js';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import { explainRule } from './rule-explanations.js';

type AnyRec = Record<string, unknown>;

function parsed(def: AnyRec): AnyRec {
  const result = ObjectSchema.safeParse(def);
  if (!result.success) {
    throw new Error(
      'object fixture is not spec-valid: ' +
        result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return result.data as unknown as AnyRec;
}

/** The roster object, declaring `portal_supplier_ids` with `filter`. */
function roster(filter?: string, name = 'srm_supplier_contact'): AnyRec {
  return parsed({
    name,
    label: 'Supplier contact',
    fields: {
      user: { type: 'user', label: 'User' },
      supplier: { type: 'lookup', reference: 'srm_supplier', label: 'Supplier' },
      active: { type: 'boolean', label: 'Active' },
      notes: { type: 'json', label: 'Notes' },
      tier: { type: 'text', label: 'Tier' },
    },
    membershipKeys: {
      portal_supplier_ids: { userField: 'user', valueField: 'supplier', ...(filter !== undefined ? { filter } : {}) },
    },
  });
}

const supplier = parsed({
  name: 'srm_supplier',
  label: 'Supplier',
  fields: { title: { type: 'text', label: 'Title' } },
});

const po = parsed({
  name: 'srm_po',
  label: 'Purchase order',
  fields: {
    supplier: { type: 'lookup', reference: 'srm_supplier', label: 'Supplier' },
    buyer: { type: 'user', label: 'Buyer' },
    title: { type: 'text', label: 'Title' },
  },
});

/** A permission set holding one policy on `object` with `using`. */
function portalSet(using: string, object = 'srm_po'): AnyRec {
  return {
    name: 'supplier_portal',
    label: 'Supplier portal',
    rowLevelSecurity: [{ name: 'own_supplier', object, operation: 'select', using }],
  };
}

const POLICY_PATH = 'permissions[0].rowLevelSecurity[0].using';
const FILTER_PATH = 'objects[0].membershipKeys.portal_supplier_ids.filter';

const brief = (fs: readonly RlsPredicateFinding[]) => fs.map((f) => ({ rule: f.rule, path: f.path }));

const fired: RlsPredicateFinding[] = [];
function judge(stack: AnyRec, options: Parameters<typeof validateRlsPredicateEnforceability>[1] = {}) {
  const findings = validateRlsPredicateEnforceability(stack, options);
  fired.push(...findings);
  return findings;
}

describe('refusal 7 — a membership key\'s `filter`, judged with the declaring object as its target', () => {
  it('CONTROL: a filter over the object\'s own columns, and a key with no filter, report nothing', () => {
    expect(judge({ objects: [roster('active == true'), supplier] })).toEqual([]);
    expect(judge({ objects: [roster(), supplier] })).toEqual([]);
  });

  it('refuses a filter that does not lower, naming the key and not a permission set', () => {
    const findings = judge({ objects: [roster('size(tier) > 0'), supplier] });
    expect(brief(findings)).toEqual([{ rule: RLS_PREDICATE_UNENFORCEABLE, path: FILTER_PATH }]);
    expect(findings[0].where).toBe('membership key "portal_supplier_ids" of object "srm_supplier_contact"');
    expect(findings[0].message).toMatch(/^membership key filter is not lowerable/);
    expect(findings[0].message).toContain('the key never resolves and every policy reading it matches no rows');
    expect(findings[0].message).not.toContain('permission set');
  });

  it('refuses a filter naming a column the declaring object lacks', () => {
    const findings = judge({ objects: [roster('activ == true'), supplier] });
    expect(brief(findings)).toEqual([{ rule: RLS_PREDICATE_UNKNOWN_FIELD, path: FILTER_PATH }]);
    expect(findings[0].message).toContain('"srm_supplier_contact"');
  });

  it('refuses a filter reading any `current_user` value, the kernel\'s included', () => {
    for (const filter of ['active == true && user == current_user.id', 'tier in current_user.portal_supplier_ids']) {
      const findings = judge({ objects: [roster(filter), supplier] });
      expect(brief(findings), filter).toEqual([{ rule: RLS_PREDICATE_UNKNOWN_USER_VARIABLE, path: FILTER_PATH }]);
      expect(findings[0].message).toContain('resolved with no caller');
    }
  });

  it('refuses a field-to-field comparison with a list-holding column, as the roster read does', () => {
    const findings = judge({ objects: [roster('tier == notes'), supplier] });
    expect(brief(findings)).toEqual([{ rule: RLS_PREDICATE_UNENFORCEABLE, path: FILTER_PATH }]);
    expect(findings[0].message).toContain('the roster read is refused');
  });

  it('hands a clean filter to the engine\'s judge with the declaring object', () => {
    const calls: Array<{ object: string; where: unknown }> = [];
    judge({ objects: [roster('active == true'), supplier] }, {
      judgeFilter: (object, where) => {
        calls.push({ object, where });
        return { ok: true } as never;
      },
    });
    expect(calls).toEqual([{ object: 'srm_supplier_contact', where: { active: true } }]);
  });
});

describe('refusal 11 — a declared key tested against a column of another target', () => {
  const stackWith = (using: string, object = 'srm_po') => ({
    objects: [roster(), supplier, po],
    permissions: [portalSet(using, object)],
  });

  it('CONTROL: the referencing column, and `id` on the target itself, are accepted', () => {
    expect(judge(stackWith('supplier in current_user.portal_supplier_ids'))).toEqual([]);
    expect(judge(stackWith('record.supplier in current_user.portal_supplier_ids'))).toEqual([]);
    expect(judge(stackWith('id in current_user.portal_supplier_ids', 'srm_supplier'))).toEqual([]);
  });

  it.each([
    ['a user reference', 'buyer in current_user.portal_supplier_ids', "'buyer', which references 'sys_user'"],
    ['a text column', 'title in current_user.portal_supplier_ids', "'title', a `text` field"],
    ['the `id` of another object', 'id in current_user.portal_supplier_ids', "`id` of 'srm_po'"],
    ['a negated test', '!(buyer in current_user.portal_supplier_ids)', "'buyer', which references 'sys_user'"],
  ])('refuses %s', (_label, using, holds) => {
    const findings = judge(stackWith(using));
    expect(brief(findings)).toEqual([{ rule: RLS_PREDICATE_MEMBERSHIP_KEY_TARGET, path: POLICY_PATH }]);
    expect(findings[0].message).toContain(holds);
    expect(findings[0].message).toContain("which holds 'srm_supplier' ids, so the two never match");
    expect(findings[0].hint).toContain("a column that references 'srm_supplier'");
  });

  it('counts further faulty sites, and judges an object\'s default row scope too', () => {
    const findings = judge(stackWith('buyer in current_user.portal_supplier_ids || title in current_user.portal_supplier_ids'));
    expect(findings[0].message).toContain('(and 1 more)');

    const poWithDefault = parsed({
      ...(po as AnyRec),
      defaultRowScope: { name: 'po_default', operation: 'select', using: 'buyer in current_user.portal_supplier_ids' },
    });
    expect(brief(judge({ objects: [roster(), supplier, poWithDefault] }))).toEqual([
      { rule: RLS_PREDICATE_MEMBERSHIP_KEY_TARGET, path: 'objects[2].defaultRowScope.using' },
    ]);
  });

  it('does not judge a key two objects declare, or one whose declaring object the stack does not carry', () => {
    const twice = { objects: [roster(), roster(undefined, 'srm_buyer_contact'), supplier, po], permissions: [portalSet('buyer in current_user.portal_supplier_ids')] };
    expect(judge(twice).filter((f) => f.rule === RLS_PREDICATE_MEMBERSHIP_KEY_TARGET)).toEqual([]);
    const elsewhere = { objects: [supplier, po], permissions: [portalSet('buyer in current_user.portal_supplier_ids')] };
    expect(judge(elsewhere, { membershipKeyOwners: membershipKeyOwnersOf([roster()], []) })).toEqual([]);
  });
});

describe('refusal 13 — a declared key under `==` is the list type fault, now exact', () => {
  it('reports `rls-predicate-unenforceable` naming the key as a membership set', () => {
    const findings = judge({ objects: [roster(), supplier, po], permissions: [portalSet('supplier == current_user.portal_supplier_ids')] });
    expect(brief(findings)).toEqual([{ rule: RLS_PREDICATE_UNENFORCEABLE, path: POLICY_PATH }]);
    expect(findings[0].message).toContain('`current_user.portal_supplier_ids` is a membership set, a list on every request');
    expect(findings[0].hint).toContain('supplier in current_user.portal_supplier_ids');
  });

  it('CONTROL: with no declaration the same predicate is the unknown-variable finding it always was', () => {
    const findings = judge({ objects: [supplier, po], permissions: [portalSet('supplier == current_user.portal_supplier_ids')] });
    expect(brief(findings)).toEqual([{ rule: RLS_PREDICATE_UNKNOWN_USER_VARIABLE, path: POLICY_PATH }]);
    expect(findings[0].message).toContain('which nothing pre-resolves');
  });
});

describe('refusal 12 — a key in a membership position that nobody owns, at the runtime gate only', () => {
  const stack = { objects: [roster(), supplier, po], permissions: [portalSet('supplier in current_user.portal_suplier_ids')] };

  it('is refused when the gate states the owners, naming the nearest owned key', () => {
    const findings = judge(stack, { membershipKeyOwners: membershipKeyOwnersOf([], []) });
    expect(brief(findings)).toEqual([{ rule: RLS_PREDICATE_UNKNOWN_USER_VARIABLE, path: POLICY_PATH }]);
    expect(findings[0].message).toContain('as a membership set, which no kernel key, membership key declaration');
    expect(findings[0].hint).toContain('Did you mean "portal_supplier_ids"?');
  });

  it('CONTROL: unknowable on the CLI; owned by the resolver; declared by a live object; or declared here', () => {
    expect(judge(stack)).toEqual([]);
    expect(judge(stack, { membershipKeyOwners: membershipKeyOwnersOf([], ['portal_suplier_ids']) })).toEqual([]);
    expect(judge(stack, { membershipKeyOwners: membershipKeyOwnersOf([roster(undefined, 'x')].map((o) => ({ ...o, membershipKeys: { portal_suplier_ids: { userField: 'user', valueField: 'supplier' } } })), []) })).toEqual([]);
    const declaredHere = { ...stack, permissions: [portalSet('supplier in current_user.portal_supplier_ids')] };
    expect(judge(declaredHere, { membershipKeyOwners: membershipKeyOwnersOf([], []) })).toEqual([]);
  });
});

describe('the doors', () => {
  it('the rule runs for `object` writes as well as `permission` writes', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateRlsPredicateEnforceability');
    expect(runtimeAuthoringRulesFor('permission').map((r) => r.name)).toContain('validateRlsPredicateEnforceability');
  });

  it('an object write whose key filter does not lower is refused at the save door', () => {
    const saved = runRuntimeAuthoringRules({
      type: 'object',
      item: roster('size(tier) > 0'),
      context: { objects: [supplier], permissions: [] },
    });
    expect(saved.errors.filter((f) => f.rule.startsWith('rls-predicate-')).map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: RLS_PREDICATE_UNENFORCEABLE, path: 'objects.srm_supplier_contact.membershipKeys.portal_supplier_ids.filter' },
    ]);
  });

  it('a permission write reading a key nobody owns is refused when the host states the resolver\'s keys', () => {
    const set = portalSet('supplier in current_user.team_supplier_ids');
    const write = (keys?: readonly string[]) =>
      runRuntimeAuthoringRules({
        type: 'permission',
        item: set,
        context: { objects: [roster(), supplier, po], permissions: [] },
        ...(keys !== undefined ? { rlsMembershipResolverKeys: keys } : {}),
      }).errors.filter((f) => f.rule.startsWith('rls-predicate-'));
    expect(write([]).map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: RLS_PREDICATE_UNKNOWN_USER_VARIABLE, path: 'permissions.supplier_portal.rowLevelSecurity[0].using' },
    ]);
    expect(write(['team_supplier_ids'])).toEqual([]);
    expect(write(undefined)).toEqual([]);
  });

  it('an object write that drops a key a stored policy reads is refused, and one that keeps it is not', () => {
    const stored = portalSet('supplier in current_user.portal_supplier_ids');
    const write = (item: AnyRec) =>
      runRuntimeAuthoringRules({
        type: 'object',
        item,
        context: { objects: [roster(), supplier, po], permissions: [stored] },
        rlsMembershipResolverKeys: [],
      }).errors.filter((f) => f.rule.startsWith('rls-predicate-'));
    const withoutKey = parsed({ ...(roster() as AnyRec), membershipKeys: undefined });
    expect(write(withoutKey).map((f) => f.rule)).toEqual([RLS_PREDICATE_UNKNOWN_USER_VARIABLE]);
    expect(write(roster())).toEqual([]);
  });

  it('`runAuthoringRules` (the CLI door) reports refusals 7, 11 and 13 and not 12', () => {
    const stack = {
      objects: [roster('size(tier) > 0'), supplier, po],
      permissions: [
        {
          name: 'supplier_portal',
          label: 'Supplier portal',
          rowLevelSecurity: [
            { name: 'a', object: 'srm_po', operation: 'select', using: 'buyer in current_user.portal_supplier_ids' },
            { name: 'b', object: 'srm_po', operation: 'select', using: 'supplier == current_user.portal_supplier_ids' },
            { name: 'c', object: 'srm_po', operation: 'select', using: 'supplier in current_user.nobody_ids' },
          ],
        },
      ],
    };
    const cli = runAuthoringRules('validate', { normalized: stack, parsed: stack }).filter((f) =>
      f.rule.startsWith('rls-predicate-'),
    );
    expect(cli.map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: RLS_PREDICATE_MEMBERSHIP_KEY_TARGET, path: 'permissions[0].rowLevelSecurity[0].using' },
      { rule: RLS_PREDICATE_UNENFORCEABLE, path: 'permissions[0].rowLevelSecurity[1].using' },
      { rule: RLS_PREDICATE_UNENFORCEABLE, path: FILTER_PATH },
    ]);
  });
});

describe('os explain and one-line verdicts', () => {
  it('explains the target rule, the filter and the runtime-only membership arm', () => {
    expect(explainRule(RLS_PREDICATE_MEMBERSHIP_KEY_TARGET)?.paragraphs.join('\n')).toContain('`!(x in KEY)` matches every row');
    const variable = explainRule(RLS_PREDICATE_UNKNOWN_USER_VARIABLE)?.paragraphs.join('\n') ?? '';
    expect(variable).toContain('The runtime publish gate');
    expect(variable).toContain('A membership key\'s `filter` may not read any `current_user` value');
    expect(explainRule(RLS_PREDICATE_UNENFORCEABLE)?.paragraphs.join('\n')).toContain('objects[N].membershipKeys.KEY.filter');
  });

  it('every verdict and hint the cases above fired is one line of at most 200 characters', () => {
    expect(fired.some((f) => f.rule === RLS_PREDICATE_MEMBERSHIP_KEY_TARGET)).toBe(true);
    expect(fired.some((f) => f.path === FILTER_PATH)).toBe(true);
    for (const f of fired) {
      for (const line of [f.message, f.hint]) {
        expect(line, f.rule).not.toContain('\n');
        expect(line.length, `${f.rule}: ${line}`).toBeLessThanOrEqual(200);
      }
    }
  });
});
