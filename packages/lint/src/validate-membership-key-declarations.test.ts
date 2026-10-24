// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25234 ruling A, refusals 3 to 6] A membership key's declaration is judged
 * at authoring time: its `userField` and `valueField` on the merged object,
 * one key on two objects (the runtime door's leg), and a key the registered
 * resolver also owns (the runtime door alone).
 *
 * The security plugin resolves each declaration per request and fails closed
 * on every one of these shapes, so each is a key that reads as a grant and
 * matches no rows. Every object fixture passes `ObjectSchema` first, so no case
 * here exercises a shape an author cannot write.
 */

import { describe, expect, it } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';

import {
  MEMBERSHIP_KEY_DECLARED_TWICE,
  MEMBERSHIP_KEY_RESOLVER_COLLISION,
  MEMBERSHIP_KEY_USER_FIELD_INVALID,
  MEMBERSHIP_KEY_VALUE_FIELD_INVALID,
  membershipKeyOwnersOf,
  validateMembershipKeyDeclarations,
  type MembershipKeyFinding,
} from './validate-membership-key-declarations.js';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import { explainRule } from './rule-explanations.js';

type AnyRec = Record<string, unknown>;

/** Parse `def` through `ObjectSchema`, or throw naming every issue. */
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

const ROSTER_FIELDS = {
  user: { type: 'user', label: 'User' },
  supplier: { type: 'lookup', reference: 'srm_supplier', label: 'Supplier' },
  suppliers: { type: 'lookup', reference: 'srm_supplier', multiple: true, label: 'Suppliers' },
  contact_user: { type: 'lookup', reference: 'sys_user', label: 'Contact user' },
  watchers: { type: 'lookup', reference: 'sys_user', multiple: true, label: 'Watchers' },
  supplier_name: { type: 'text', label: 'Supplier name' },
  active: { type: 'boolean', label: 'Active' },
} as const;

/** The roster object, declaring `portal_supplier_ids` with `key`'s members. */
function roster(key: AnyRec = {}, name = 'srm_supplier_contact'): AnyRec {
  return parsed({
    name,
    label: 'Supplier contact',
    fields: ROSTER_FIELDS,
    membershipKeys: {
      portal_supplier_ids: { userField: 'user', valueField: 'supplier', filter: 'active == true', ...key },
    },
  });
}

const supplier = parsed({ name: 'srm_supplier', label: 'Supplier', fields: { title: { type: 'text', label: 'Title' } } });

const KEY_PATH = 'objects[0].membershipKeys.portal_supplier_ids';

const brief = (fs: readonly MembershipKeyFinding[]) => fs.map((f) => ({ rule: f.rule, path: f.path }));

/** Every verdict and hint these cases fire, for the one-line check at the end. */
const fired: MembershipKeyFinding[] = [];
function judge(stack: AnyRec, options: Parameters<typeof validateMembershipKeyDeclarations>[1] = {}) {
  const findings = validateMembershipKeyDeclarations(stack, options);
  fired.push(...findings);
  return findings;
}

describe('validateMembershipKeyDeclarations — refusal 5: `userField` is a single-valued user reference', () => {
  it('CONTROL: a `user` field, a lookup to `sys_user` and an injected `owner_id` are accepted', () => {
    expect(judge({ objects: [roster(), supplier] })).toEqual([]);
    expect(judge({ objects: [roster({ userField: 'contact_user' }), supplier] })).toEqual([]);
    expect(judge({ objects: [roster({ userField: 'owner_id' }), supplier] })).toEqual([]);
  });

  it('refuses a column the object does not declare, naming the nearest one', () => {
    const findings = judge({ objects: [roster({ userField: 'usr' }), supplier] });
    expect(brief(findings)).toEqual([{ rule: MEMBERSHIP_KEY_USER_FIELD_INVALID, path: `${KEY_PATH}.userField` }]);
    expect(findings[0].where).toBe('membership key "portal_supplier_ids" of object "srm_supplier_contact"');
    expect(findings[0].message).toContain("names 'usr', which object 'srm_supplier_contact' does not declare");
    expect(findings[0].hint).toContain('Did you mean "user"?');
  });

  it.each([
    ['a text column', 'supplier_name', 'is a `text` field, not a user reference'],
    ['a lookup to another object', 'supplier', "is a `lookup` field to 'srm_supplier', not a user reference"],
    ['a multi-user lookup', 'watchers', 'holds several users (`multiple: true`)'],
  ])('refuses %s', (_label, userField, verdict) => {
    // `valueField` moves off `supplier` when U takes it, so only U is judged.
    const findings = judge({
      objects: [roster({ userField, valueField: userField === 'supplier' ? 'suppliers' : 'supplier' }), supplier],
    });
    expect(brief(findings)).toEqual([{ rule: MEMBERSHIP_KEY_USER_FIELD_INVALID, path: `${KEY_PATH}.userField` }]);
    expect(findings[0].message).toContain(verdict);
    expect(findings[0].severity).toBe('error');
  });

  it('judges U on the MERGED object: an extension that replaces it with a text column is refused', () => {
    const stack = {
      objects: [roster(), supplier],
      objectExtensions: [{ extend: 'srm_supplier_contact', fields: { user: { type: 'text', label: 'User' } } }],
    };
    expect(brief(judge(stack))).toEqual([{ rule: MEMBERSHIP_KEY_USER_FIELD_INVALID, path: `${KEY_PATH}.userField` }]);
    // CONTROL: an extension that adds an unrelated column leaves U as declared.
    const unrelated = {
      objects: [roster(), supplier],
      objectExtensions: [{ extend: 'srm_supplier_contact', fields: { region: { type: 'text', label: 'Region' } } }],
    };
    expect(judge(unrelated)).toEqual([]);
  });

  it('leaves a column two packages write at the deciding priority unjudged', () => {
    const textUser = { extend: 'srm_supplier_contact', fields: { user: { type: 'text', label: 'User' } } };
    const stack = {
      objects: [roster(), supplier],
      packages: [{ manifest: { objectExtensions: [textUser] } }, { manifest: { objectExtensions: [textUser] } }],
    };
    expect(judge(stack)).toEqual([]);
    // CONTROL: one package writing it is judged.
    expect(brief(judge({ ...stack, packages: [stack.packages[0]] }))).toEqual([
      { rule: MEMBERSHIP_KEY_USER_FIELD_INVALID, path: `${KEY_PATH}.userField` },
    ]);
  });
});

describe('validateMembershipKeyDeclarations — refusal 6: `valueField` is a reference', () => {
  it('CONTROL: a lookup, a multi-valued lookup and a `user` field are accepted', () => {
    expect(judge({ objects: [roster({ valueField: 'suppliers' }), supplier] })).toEqual([]);
    expect(judge({ objects: [roster({ valueField: 'contact_user' }), supplier] })).toEqual([]);
  });

  it('refuses a column the object does not declare, and a column that is no reference', () => {
    const missing = judge({ objects: [roster({ valueField: 'supplierr' }), supplier] });
    expect(brief(missing)).toEqual([{ rule: MEMBERSHIP_KEY_VALUE_FIELD_INVALID, path: `${KEY_PATH}.valueField` }]);
    expect(missing[0].hint).toContain('Did you mean "supplier"?');

    const text = judge({ objects: [roster({ valueField: 'supplier_name' }), supplier] });
    expect(brief(text)).toEqual([{ rule: MEMBERSHIP_KEY_VALUE_FIELD_INVALID, path: `${KEY_PATH}.valueField` }]);
    expect(text[0].message).toContain('is a `text` field, not a reference');
  });
});

describe('validateMembershipKeyDeclarations — refusal 3: one key on two objects', () => {
  it('reports both declarations inside one stack', () => {
    const other = roster({}, 'srm_buyer_contact');
    const findings = judge({ objects: [roster(), other, supplier] });
    expect(brief(findings)).toEqual([
      { rule: MEMBERSHIP_KEY_DECLARED_TWICE, path: KEY_PATH },
      { rule: MEMBERSHIP_KEY_DECLARED_TWICE, path: 'objects[1].membershipKeys.portal_supplier_ids' },
    ]);
    expect(findings[0].message).toContain("also declared by object 'srm_buyer_contact'");
  });

  it('at the runtime door, reads the live objects the stack does not carry', () => {
    const live = membershipKeyOwnersOf([roster({}, 'srm_buyer_contact')], []);
    expect(brief(judge({ objects: [roster(), supplier] }, { membershipKeyOwners: live }))).toEqual([
      { rule: MEMBERSHIP_KEY_DECLARED_TWICE, path: KEY_PATH },
    ]);
    // CONTROL: the written object's own stored self is not a second declaration.
    const self = membershipKeyOwnersOf([roster()], []);
    expect(judge({ objects: [roster(), supplier] }, { membershipKeyOwners: self })).toEqual([]);
  });
});

describe('validateMembershipKeyDeclarations — refusal 4: a key the registered resolver owns', () => {
  it('is refused when the runtime door states the resolver owns it, and not judged on the CLI', () => {
    const owners = membershipKeyOwnersOf([], ['portal_supplier_ids']);
    const findings = judge({ objects: [roster(), supplier] }, { membershipKeyOwners: owners });
    expect(brief(findings)).toEqual([{ rule: MEMBERSHIP_KEY_RESOLVER_COLLISION, path: KEY_PATH }]);
    expect(findings[0].message).toContain('also owned by the registered membership resolver');
    // CONTROL: the resolver owns other keys; and the CLI states no resolver.
    expect(judge({ objects: [roster(), supplier] }, { membershipKeyOwners: membershipKeyOwnersOf([], ['team_ids']) })).toEqual([]);
    expect(judge({ objects: [roster(), supplier] })).toEqual([]);
  });
});

describe('the doors', () => {
  it('`runAuthoringRules` (the CLI registry door) reports a declaration fault', () => {
    const stack = { objects: [roster({ userField: 'supplier_name' }), supplier] };
    const cli = runAuthoringRules('validate', { normalized: stack, parsed: stack }).filter((f) =>
      f.rule.startsWith('membership-key-'),
    );
    expect(cli.map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: MEMBERSHIP_KEY_USER_FIELD_INVALID, path: `${KEY_PATH}.userField` },
    ]);
  });

  it('the runtime publish gate runs the rule for `object` writes and refuses with the resolver\'s keys', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateMembershipKeyDeclarations');
    expect(runtimeAuthoringRulesFor('permission').map((r) => r.name)).not.toContain('validateMembershipKeyDeclarations');

    const item = roster();
    const saved = runRuntimeAuthoringRules({
      type: 'object',
      item,
      context: { objects: [supplier], permissions: [] },
      rlsMembershipResolverKeys: ['portal_supplier_ids'],
    });
    expect(saved.errors.filter((f) => f.rule.startsWith('membership-key-')).map((f) => ({ rule: f.rule, path: f.path }))).toEqual([
      { rule: MEMBERSHIP_KEY_RESOLVER_COLLISION, path: 'objects.srm_supplier_contact.membershipKeys.portal_supplier_ids' },
    ]);
    // CONTROL: a host that states no resolver key, and one that states nothing.
    for (const keys of [[], undefined]) {
      const clean = runRuntimeAuthoringRules({
        type: 'object',
        item,
        context: { objects: [supplier], permissions: [] },
        ...(keys !== undefined ? { rlsMembershipResolverKeys: keys } : {}),
      });
      expect(clean.errors.filter((f) => f.rule.startsWith('membership-key-'))).toEqual([]);
    }
  });

  it('the runtime gate refuses a declaration of a key another live object declares, outside the package closure too', () => {
    const otherRoster = { ...roster({}, 'srm_buyer_contact'), _packageId: 'app.buyers' };
    const saved = runRuntimeAuthoringRules({
      type: 'object',
      item: { ...roster(), _packageId: 'app.srm' },
      context: { objects: [supplier, otherRoster], permissions: [] },
      packageScope: { packageId: 'app.srm', dependencies: [] },
      rlsMembershipResolverKeys: [],
    });
    expect(saved.errors.filter((f) => f.rule.startsWith('membership-key-')).map((f) => f.rule)).toEqual([
      MEMBERSHIP_KEY_DECLARED_TWICE,
    ]);
  });
});

describe('os explain and one-line verdicts', () => {
  it('each new id has an explanation that says how a key resolves', () => {
    for (const id of [
      MEMBERSHIP_KEY_USER_FIELD_INVALID,
      MEMBERSHIP_KEY_VALUE_FIELD_INVALID,
      MEMBERSHIP_KEY_DECLARED_TWICE,
      MEMBERSHIP_KEY_RESOLVER_COLLISION,
    ]) {
      const text = explainRule(id)?.paragraphs.join('\n') ?? '';
      expect(text, id).toContain('Every miss fails closed');
    }
  });

  it('every verdict and hint the cases above fired is one line of at most 200 characters', () => {
    expect(new Set(fired.map((f) => f.rule)).size).toBe(4);
    for (const f of fired) {
      for (const line of [f.message, f.hint]) {
        expect(line, f.rule).not.toContain('\n');
        expect(line.length, `${f.rule}: ${line}`).toBeLessThanOrEqual(200);
      }
    }
  });
});
