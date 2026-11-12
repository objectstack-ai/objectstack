// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A finding's user-facing sentence in the request's language (ruling record
 * 6819749037): the locale ladder `finding-user-text.ts` applies, and the
 * security-posture rule's own catalog (`validate-security-posture.user-text.ts`)
 * rendered from the rule's REAL findings in every platform locale.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeAuthoringIssueSchema } from '@objectstack/spec/api';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import {
  FINDING_USER_TEXT_CATALOG,
  findingUserMessage,
  mergeUserTextCatalogs,
  renderUserText,
  userTextLocaleOf,
  type UserTextEntry,
} from './finding-user-text.js';
import { SECURITY_POSTURE_USER_TEXT } from './validate-security-posture.user-text.js';
import {
  SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
  SECURITY_CBP_MASTER_REFERENCE_HIDDEN,
  SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN,
  SECURITY_MASTER_DETAIL_UNGRANTED,
  SECURITY_PRIVATE_NO_READSCOPE,
  SECURITY_SUPERUSER_FIELD_MASK_INERT,
  SECURITY_UPDATE_POLICY_NO_CHECK,
  validateSecurityPosture,
  type SecurityFinding,
} from './validate-security-posture.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

describe('finding user text · the locale ladder (request locale, then workspace default, then en)', () => {
  /** A synthetic entry with two sentences: English and Simplified Chinese. */
  const entry: UserTextEntry = {
    en: (p) => `object "${p.object}"`,
    'zh-Hans': (p) => `对象“${p.object}”`,
  };

  it('answers the request locale when the entry has a sentence for it, read through the table aliases', () => {
    expect(userTextLocaleOf(entry, ['zh-Hans'])).toBe('zh-Hans');
    expect(userTextLocaleOf(entry, ['zh-CN'])).toBe('zh-Hans');
    expect(userTextLocaleOf(entry, ['zh-cn'])).toBe('zh-Hans');
    expect(renderUserText(entry, { object: 'crm_deal' }, ['zh-CN'])).toBe('对象“crm_deal”');
  });

  it('falls to the workspace default when the request names no locale, one off the table, or one the entry lacks', () => {
    expect(userTextLocaleOf(entry, [undefined, 'zh-Hans'])).toBe('zh-Hans');
    expect(userTextLocaleOf(entry, ['pt-PT', 'zh-Hans'])).toBe('zh-Hans');
    expect(userTextLocaleOf(entry, ['ja', 'zh-CN'])).toBe('zh-Hans');
  });

  it('ends at en: an unknown locale, and a platform locale a rule has no sentence for, both render English', () => {
    expect(PLATFORM_LOCALE_TAGS).toContain('en');
    expect(userTextLocaleOf(entry, ['tlh'])).toBe('en');
    expect(userTextLocaleOf(entry, ['ja'])).toBe('en');
    expect(userTextLocaleOf(entry, ['ja', 'ko'])).toBe('en');
    expect(userTextLocaleOf(entry, [])).toBe('en');
    expect(renderUserText(entry, { object: 'crm_deal' }, ['ja'])).toBe('object "crm_deal"');
  });

  it('refuses two catalogs that claim the same rule id', () => {
    expect(() => mergeUserTextCatalogs({ r: entry }, { r: entry })).toThrow(/rule "r" has sentences in two catalogs/);
    expect(Object.keys(mergeUserTextCatalogs({ a: entry }, { b: entry }))).toEqual(['a', 'b']);
  });

  it('a finding without userTextParams, or whose rule has no catalog entry, has no user sentence', () => {
    expect(findingUserMessage({ rule: SECURITY_PRIVATE_NO_READSCOPE }, ['en'])).toBeUndefined();
    expect(findingUserMessage({ rule: 'flow-multi-write-unfiltered', userTextParams: {} }, ['en'])).toBeUndefined();
  });
});

// ── The security-posture rule's catalog, from the rule's real findings ──────

const ADVISORY_RULES = [
  SECURITY_PRIVATE_NO_READSCOPE,
  SECURITY_MASTER_DETAIL_UNGRANTED,
  SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
  SECURITY_SUPERUSER_FIELD_MASK_INERT,
  SECURITY_CBP_MASTER_REFERENCE_HIDDEN,
  SECURITY_UPDATE_POLICY_NO_CHECK,
  SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN,
];

const TEXT = { name: { name: 'name', type: 'text', label: 'Name' } };
const OMD_MASTER = { name: 'omd_contract', label: 'Contract', sharingModel: 'private', fields: TEXT };
const OMD_DETAIL_FIELDS = {
  ...TEXT,
  contract: { name: 'contract', type: 'master_detail', label: 'Contract', reference: 'omd_contract', required: true },
};
const omdDetail = (extra: Record<string, unknown> = {}) => ({
  name: 'omd_obligation', label: 'Obligation', sharingModel: 'controlled_by_parent', fields: OMD_DETAIL_FIELDS, ...extra,
});
const omdStack = (detail: Record<string, unknown>, using: string) => ({
  objects: [OMD_MASTER, detail],
  permissions: [{
    name: 'omd_requester', label: 'Requester', objects: {},
    rowLevelSecurity: [{ name: 'omd_obligation_updates', object: 'omd_obligation', operation: 'update', using }],
  }],
});

/**
 * One stack per advisory push site, with the params each finding must carry
 * (the names its sentence interpolates). Every push site of the seven rule ids
 * is reached: the two owner-policy functions, and the second one in both of
 * its remedy states.
 */
const CASES: ReadonlyArray<{ label: string; rule: string; stack: Record<string, unknown>; params: Record<string, string> }> = [
  {
    label: 'private object read without a read scope',
    rule: SECURITY_PRIVATE_NO_READSCOPE,
    stack: {
      objects: [{ name: 'expense', sharingModel: 'private' }],
      permissions: [{ name: 'finance_user', objects: { expense: { allowRead: true } } }],
    },
    params: { permissionSet: 'finance_user', object: 'expense' },
  },
  {
    label: 'detail object no set grants',
    rule: SECURITY_MASTER_DETAIL_UNGRANTED,
    stack: {
      objects: [
        { name: 'work_order', label: 'Work Order', sharingModel: 'private', fields: TEXT },
        {
          name: 'work_order_item', label: 'Work Order Item', sharingModel: 'controlled_by_parent',
          fields: { order: { name: 'order', type: 'master_detail', reference: 'work_order', required: true } },
        },
      ],
      permissions: [{ name: 'field_tech', objects: { work_order: { allowRead: true, readScope: 'org' } } }],
    },
    params: { object: 'work_order_item', master: 'work_order' },
  },
  {
    label: 'book gated on an undeclared set',
    rule: SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
    stack: {
      permissions: [{ name: 'crm_admin' }],
      books: [{ name: 'crm_admin_guide', audience: { permissionSet: 'crm_admn' }, groups: [] }],
    },
    params: { book: 'crm_admin_guide', permissionSet: 'crm_admn' },
  },
  {
    label: 'field lock under Modify All',
    rule: SECURITY_SUPERUSER_FIELD_MASK_INERT,
    stack: {
      permissions: [PermissionSetSchema.parse({
        name: 'deal_manager', label: 'Deal manager',
        objects: { deal: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
        fields: { 'deal.restricted_note': { readable: true, editable: false } },
      })],
    },
    params: { permissionSet: 'deal_manager', field: 'deal.restricted_note', object: 'deal', bypass: 'modify' },
  },
  {
    label: 'field mask under View All',
    rule: SECURITY_SUPERUSER_FIELD_MASK_INERT,
    stack: {
      permissions: [PermissionSetSchema.parse({
        name: 'directory_masked',
        objects: { sys_user: { allowRead: true, viewAllRecords: true } },
        fields: { 'sys_user.email': { readable: false, editable: false } },
      })],
    },
    params: { permissionSet: 'directory_masked', field: 'sys_user.email', object: 'sys_user', bypass: 'view' },
  },
  {
    label: 'hidden master reference',
    rule: SECURITY_CBP_MASTER_REFERENCE_HIDDEN,
    stack: {
      objects: [
        { name: 'invoice', label: 'X', sharingModel: 'private', fields: TEXT },
        {
          name: 'line_item', label: 'X', sharingModel: 'controlled_by_parent',
          fields: { invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', required: true } },
        },
      ],
      permissions: [PermissionSetSchema.parse({
        name: 'clerk',
        objects: { line_item: { allowRead: true, allowEdit: true }, invoice: { allowRead: true, allowEdit: true } },
        fields: { 'line_item.invoice': { readable: false, editable: true } },
      })],
    },
    params: { permissionSet: 'clerk', field: 'line_item.invoice' },
  },
  {
    label: 'update policy with no check',
    rule: SECURITY_UPDATE_POLICY_NO_CHECK,
    stack: {
      permissions: [PermissionSetSchema.parse({
        name: 'sales_rep',
        objects: { deal: { allowRead: true, allowCreate: true, allowEdit: true } },
        rowLevelSecurity: [{ name: 'own_deals', object: 'deal', operation: 'update', using: 'owner_id == current_user.id' }],
      })],
    },
    params: { permissionSet: 'sales_rep', policy: 'own_deals' },
  },
  {
    label: 'owner_id policy on a detail that has not opted in',
    rule: SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN,
    stack: omdStack(omdDetail(), 'owner_id == current_user.id'),
    params: { permissionSet: 'omd_requester', policy: 'omd_obligation_updates', object: 'omd_obligation', remedy: 'allow-owner-edit' },
  },
  {
    label: 'policy keyed on another user field',
    rule: SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN,
    stack: omdStack(
      omdDetail({ fields: { ...OMD_DETAIL_FIELDS, owner: { name: 'owner', type: 'user', reference: 'sys_user', label: 'Owner' } } }),
      'owner == current_user.id',
    ),
    params: { permissionSet: 'omd_requester', policy: 'omd_obligation_updates', object: 'omd_obligation', remedy: 'key-owner-id' },
  },
  {
    label: 'owner_id policy on a detail with no owner column',
    rule: SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN,
    stack: omdStack(omdDetail({ ownership: 'org' }), 'owner_id == current_user.id'),
    params: { permissionSet: 'omd_requester', policy: 'omd_obligation_updates', object: 'omd_obligation', remedy: 'add-owner-id' },
  },
];

/** The one finding of `rule` the case's stack produces. */
const findingOf = (c: (typeof CASES)[number]): SecurityFinding => {
  const found = validateSecurityPosture(c.stack).filter((f) => f.rule === c.rule);
  expect(found, `${c.label}: exactly one ${c.rule} finding`).toHaveLength(1);
  return found[0]!;
};

/** The params that are NAMES the sentence must show (not the variant selectors). */
const namesOf = (params: Record<string, string>): string[] =>
  Object.entries(params)
    .filter(([key, value]) => key !== 'bypass' && key !== 'remedy' && value !== '')
    .map(([, value]) => value);

describe('security-posture user text · the catalog', () => {
  it('holds a sentence for exactly the rule\'s seven advisory ids, in every platform locale and no other', () => {
    expect(Object.keys(SECURITY_POSTURE_USER_TEXT).sort()).toEqual([...ADVISORY_RULES].sort());
    for (const [rule, entry] of Object.entries(SECURITY_POSTURE_USER_TEXT)) {
      expect(Object.keys(entry).sort(), rule).toEqual([...PLATFORM_LOCALE_TAGS].sort());
    }
  });

  it('is merged into the one finding catalog the door renders from', () => {
    for (const rule of ADVISORY_RULES) {
      expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(SECURITY_POSTURE_USER_TEXT[rule]);
    }
  });

  it('keeps every rule id stable: the catalog is keyed by the ids the findings already carry', () => {
    expect(ADVISORY_RULES).toEqual([
      'security-private-no-readscope',
      'security-master-detail-ungranted',
      'security-book-audience-unknown-set',
      'security-superuser-field-mask-inert',
      'security-controlled-by-parent-master-reference-hidden',
      'security-update-policy-no-check',
      'security-controlled-by-parent-owner-policy-without-opt-in',
    ]);
  });
});

describe('security-posture user text · rendered from the rule\'s real findings', () => {
  it.each(CASES.map((c) => [c.label, c] as const))('%s: carries its params and renders in every platform locale', (_label, c) => {
    const finding = findingOf(c);
    expect(finding.severity).not.toBe('error');
    expect(finding.userTextParams).toEqual(c.params);

    const english = findingUserMessage(finding, ['en'])!;
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const text = findingUserMessage(finding, [tag]);
      expect(text, `${c.rule} · ${tag}`).toBeTruthy();
      expect(text, `${c.rule} · ${tag}`).not.toMatch(/undefined|\$\{/);
      for (const name of namesOf(c.params)) expect(text, `${c.rule} · ${tag} names ${name}`).toContain(name);
      // A real translation, not the English floor standing in for it.
      if (tag !== 'en') expect(text, `${c.rule} · ${tag}`).not.toBe(english);
    }
  });

  it('renders the private-object sentence in zh-Hans and en with the set and object names interpolated', () => {
    const finding = findingOf(CASES[0]!);
    const zh = findingUserMessage(finding, ['zh-CN'])!;
    const en = findingUserMessage(finding, ['en-US'])!;
    expect(zh).toContain('权限集“finance_user”');
    expect(zh).toContain('“expense”');
    expect(en).toContain('permission set "finance_user"');
    expect(en).toContain('"expense"');
    expect(finding.rule).toBe('security-private-no-readscope');
  });

  it('an unknown request locale falls back to the workspace default, then to en', () => {
    const finding = findingOf(CASES[0]!);
    expect(findingUserMessage(finding, ['tlh'])).toBe(findingUserMessage(finding, ['en']));
    expect(findingUserMessage(finding, ['tlh', 'ja-JP'])).toBe(findingUserMessage(finding, ['ja']));
    expect(findingUserMessage(finding, [undefined, undefined])).toBe(findingUserMessage(finding, ['en']));
  });

  it('the owner-policy sentence prescribes the opt-in only where it admits, as the rule\'s hint does', () => {
    const [optIn, keyOwner, addOwner] = CASES.filter((c) => c.rule === SECURITY_CBP_OWNER_POLICY_WITHOUT_OPT_IN)
      .map((c) => findingUserMessage(findingOf(c), ['en'])!);
    expect(optIn).toContain('Allow record owners to edit "omd_obligation" in its sharing settings');
    for (const text of [keyOwner!, addOwner!]) expect(text).not.toContain('sharing settings');
    expect(keyOwner).toContain('Key the policy on the record owner (owner_id)');
    expect(addOwner).toContain('Give "omd_obligation" a record owner (owner_id)');
  });

  it('names the bypass the set actually holds', () => {
    const [modify, view] = CASES.filter((c) => c.rule === SECURITY_SUPERUSER_FIELD_MASK_INERT)
      .map((c) => findingUserMessage(findingOf(c), ['en'])!);
    expect(modify).toContain('Modify All Records');
    expect(view).toContain('View All Records');
    expect(view).not.toContain('Modify All Records');
  });
});

describe('security-posture user text · from the runtime gate to the wire field', () => {
  it('a permission-set write\'s advisory carries its params out of the gate and renders a valid userMessage', () => {
    const set = { name: 'finance_user', objects: { expense: { allowRead: true } } };
    const result = runRuntimeAuthoringRules({
      type: 'permission',
      item: set,
      context: { objects: [{ name: 'expense', sharingModel: 'private' }] },
    });
    const advisory = result.advisories.find((f) => f.rule === SECURITY_PRIVATE_NO_READSCOPE);
    expect(advisory, 'the gate returns the private-object advisory for this write').toBeDefined();
    expect(advisory!.userTextParams).toEqual({ permissionSet: 'finance_user', object: 'expense' });

    // The element the save door's `advisories[]` carries, with the sentence
    // the door renders for a zh-CN request beside the unchanged rule id.
    const userMessage = findingUserMessage(advisory!, ['zh-CN', 'en']);
    const issue = RuntimeAuthoringIssueSchema.parse({
      rule: advisory!.rule,
      path: advisory!.path,
      where: advisory!.where,
      message: advisory!.message,
      hint: advisory!.hint,
      severity: advisory!.severity,
      userMessage,
    });
    expect(issue.rule).toBe('security-private-no-readscope');
    expect(issue.userMessage).toContain('权限集“finance_user”');
    expect(issue.message).toBe(advisory!.message);
  });
});
