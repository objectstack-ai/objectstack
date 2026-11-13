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
  type UserTextCatalog,
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
import {
  APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER,
  APPROVAL_APPROVER_TYPE_DEPRECATED,
  APPROVAL_APPROVER_TYPE_UNKNOWN,
  APPROVAL_APPROVER_TYPE_UNSUPPORTED,
  APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
  APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
  APPROVAL_EXPRESSION_INVALID,
  APPROVAL_EXPRESSION_NO_EMPTY_POLICY,
  validateApprovalApprovers,
} from './validate-approval-approvers.js';
import { APPROVAL_APPROVERS_USER_TEXT } from './validate-approval-approvers.user-text.js';
import {
  FLOW_DRAFT_STATUS_AMBIGUOUS,
  FLOW_INPUT_OBJECT_LESS,
  FLOW_INPUT_RECORD_READ_AS_LIST,
  FLOW_INPUT_UNKNOWN_OBJECT,
  FLOW_TRIGGER_UNKNOWN_OBJECT,
  validateFlowTriggerReadiness,
} from './validate-flow-trigger-readiness.js';
import { FLOW_TRIGGER_READINESS_USER_TEXT } from './validate-flow-trigger-readiness.user-text.js';
import {
  FLOW_TEMPLATE_FIELD_UNPROVISIONED,
  FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
  FLOW_TEMPLATE_UNKNOWN_FIELD,
  validateFlowTemplatePaths,
} from './validate-flow-template-paths.js';
import { FLOW_TEMPLATE_PATHS_USER_TEXT } from './validate-flow-template-paths.user-text.js';
import { FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR, validateFlowNodeWrites } from './validate-flow-node-writes.js';
import { FLOW_NODE_WRITES_USER_TEXT } from './validate-flow-node-writes.user-text.js';
import { FLOW_UPDATE_READONLY_WHEN_FIELD, validateReadonlyFlowWrites } from './validate-readonly-flow-writes.js';
import { READONLY_FLOW_WRITES_USER_TEXT } from './validate-readonly-flow-writes.user-text.js';
import { FLOW_CREDENTIAL_LITERAL, lintFlowCredentialLiterals } from './lint-flow-credential-literals.js';
import { FLOW_CREDENTIAL_LITERALS_USER_TEXT } from './lint-flow-credential-literals.user-text.js';

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
    expect(userTextLocaleOf(entry, ['vi-VN', 'zh-Hans'])).toBe('zh-Hans');
    expect(userTextLocaleOf(entry, ['ja', 'zh-CN'])).toBe('zh-Hans');
    // `pt-PT` names `pt-BR` (through `pt`), which this entry has no sentence for.
    expect(userTextLocaleOf(entry, ['pt-PT', 'zh-CN'])).toBe('zh-Hans');
  });

  it('reads a region or script code as its table language, one subtag shorter at a time, ahead of the default', () => {
    /** An entry with sentences in more languages, as a producer's catalog has. */
    const wide: UserTextEntry = {
      en: () => 'en',
      'zh-Hans': () => 'zh-Hans',
      'zh-Hant': () => 'zh-Hant',
      fr: () => 'fr',
      es: () => 'es',
      'pt-BR': () => 'pt-BR',
    };
    // A browser's region code reaches its own language, never the workspace default.
    expect(userTextLocaleOf(wide, ['fr-FR', 'zh-CN'])).toBe('fr');
    expect(userTextLocaleOf(wide, ['en-GB', 'zh-CN'])).toBe('en');
    expect(userTextLocaleOf(wide, ['es-MX', 'zh-CN'])).toBe('es');
    expect(userTextLocaleOf(wide, ['pt-PT', 'zh-CN'])).toBe('pt-BR');
    expect(userTextLocaleOf(wide, ['EN-gb', 'zh-CN'])).toBe('en');
    expect(userTextLocaleOf(wide, ['zh-Hant-US', 'zh-CN'])).toBe('zh-Hant');
    // The workspace default is read the same way.
    expect(userTextLocaleOf(wide, [undefined, 'fr-FR'])).toBe('fr');
    expect(userTextLocaleOf(wide, ['vi-VN', 'fr-CA'])).toBe('fr');
    // The first prefix the table names decides: a Traditional code whose
    // language the entry lacks takes the next rung, never `zh` → Simplified.
    expect(userTextLocaleOf(entry, ['zh-Hant-TW'])).toBe('en');
    expect(userTextLocaleOf(entry, ['zh-TW'])).toBe('en');
    expect(userTextLocaleOf(entry, ['zh-Hant-US', 'zh-CN'])).toBe('zh-Hans');
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
    params: { permissionSet: 'deal_manager', field: 'deal.restricted_note', object: 'deal', bypass: 'modify', inert: 'edit' },
  },
  {
    label: 'field mask and lock under Modify All',
    rule: SECURITY_SUPERUSER_FIELD_MASK_INERT,
    stack: {
      permissions: [PermissionSetSchema.parse({
        name: 'deal_manager', label: 'Deal manager',
        objects: { deal: { allowRead: true, allowEdit: true, modifyAllRecords: true } },
        fields: { 'deal.margin': { readable: false, editable: false } },
      })],
    },
    params: { permissionSet: 'deal_manager', field: 'deal.margin', object: 'deal', bypass: 'modify', inert: 'both' },
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
    params: { permissionSet: 'directory_masked', field: 'sys_user.email', object: 'sys_user', bypass: 'view', inert: 'read' },
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
    .filter(([key, value]) => key !== 'bypass' && key !== 'remedy' && key !== 'inert' && value !== '')
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

  it('a request in a region code of a catalog language answers in that language, not the workspace default', () => {
    const finding = findingOf(CASES[0]!);
    expect(findingUserMessage(finding, ['fr-FR', 'zh-CN'])).toBe(findingUserMessage(finding, ['fr']));
    expect(findingUserMessage(finding, ['en-GB', 'zh-CN'])).toBe(findingUserMessage(finding, ['en']));
    expect(findingUserMessage(finding, ['de-AT', 'zh-CN'])).toBe(findingUserMessage(finding, ['de']));
    expect(findingUserMessage(finding, ['ko-KR', 'zh-CN'])).toBe(findingUserMessage(finding, ['ko']));
    expect(findingUserMessage(finding, ['zh-Hant-HK', 'en'])).toBe(findingUserMessage(finding, ['zh-Hant']));
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
    const [modifyLock, modifyBoth, view] = CASES.filter((c) => c.rule === SECURITY_SUPERUSER_FIELD_MASK_INERT)
      .map((c) => findingUserMessage(findingOf(c), ['en'])!);
    for (const modify of [modifyLock!, modifyBoth!]) expect(modify).toContain('Modify All Records');
    expect(view).toContain('View All Records');
    expect(view).not.toContain('Modify All Records');
  });

  it('calls ineffective only the half of the field restriction the bypass unbinds, as the rule\'s message does', () => {
    const [modifyLock, modifyBoth, view] = CASES.filter((c) => c.rule === SECURITY_SUPERUSER_FIELD_MASK_INERT)
      .map((c) => findingUserMessage(findingOf(c), ['en'])!);
    // View All beside a read mask and an edit lock: only the mask is inert.
    // The lock still binds, so the sentence neither calls the restriction
    // ineffective as a whole nor prescribes deleting it.
    expect(view).toContain('hiding field "sys_user.email" has no effect');
    expect(view).not.toContain('read-only');
    expect(view).not.toContain('delete the field restriction');
    expect(view).toContain('let the set read the field');
    // Modify All beside an edit lock alone: the lock is inert.
    expect(modifyLock).toContain('making field "deal.restricted_note" read-only has no effect');
    expect(modifyLock).not.toContain('hiding');
    expect(modifyLock).toContain('delete the field restriction');
    // Modify All beside both: both halves are inert.
    expect(modifyBoth).toContain('hiding field "deal.margin" and making it read-only have no effect');
    expect(modifyBoth).toContain('delete the field restriction');
  });

  it('renders the three field-restriction sentences apart in every platform locale', () => {
    // Same names and the same bypass, so only `inert` tells the three apart.
    const findings = CASES.filter((c) => c.rule === SECURITY_SUPERUSER_FIELD_MASK_INERT).map(findingOf);
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const [lock, both, view] = findings.map((f) => findingUserMessage({ ...f, userTextParams: { ...f.userTextParams!, permissionSet: 'p', field: 'f', object: 'o', bypass: 'modify' } }, [tag])!);
      expect(new Set([lock, both, view]).size, tag).toBe(3);
    }
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

// ── The automation writes: approval, flow trigger and flow node advisories ──
//
// Six rule files' catalogs, pinned the way the security-posture catalog is
// above: exact coverage, every push site rendered from the rule's REAL
// findings in every platform locale, and each finding's flow written through
// the runtime gate so the advisory the save door returns carries its params.
// The ids pinned are the ones that reach the save door; the other advisory ids
// of the automation family's write-body rules are judged on no runtime write.

/** A finding as every rule here returns it. */
type AutomationFinding = { rule: string; severity: string; userTextParams?: Readonly<Record<string, string>> };

/** One advisory push site: a stack whose rule run draws exactly one finding of `rule`, with these params. */
interface AdvisoryCase {
  label: string;
  rule: string;
  stack: Record<string, unknown>;
  params: Record<string, string>;
}

/** Params that pick a sentence's arm rather than name something the sentence must show. */
const ARM_PARAMS: ReadonlySet<string> = new Set(['slate', 'locked', 'trigger', 'root', 'position']);

const shownNamesOf = (params: Record<string, string>): string[] =>
  Object.entries(params)
    .filter(([key, value]) => !ARM_PARAMS.has(key) && value !== '')
    .map(([, value]) => value);

/** The catalog holds exactly `ids`, each in exactly the platform locales, and is the one the door renders from. */
function pinCatalog(name: string, catalog: UserTextCatalog, ids: readonly string[]): void {
  describe(`${name} user text · the catalog`, () => {
    it('holds a sentence for exactly the rule\'s door-reaching advisory ids, in every platform locale and no other', () => {
      expect(Object.keys(catalog).sort()).toEqual([...ids].sort());
      for (const [rule, entry] of Object.entries(catalog)) {
        expect(Object.keys(entry).sort(), rule).toEqual([...PLATFORM_LOCALE_TAGS].sort());
      }
    });

    it('is merged into the one finding catalog the door renders from', () => {
      for (const rule of ids) expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(catalog[rule]);
    });
  });
}

/**
 * Every case renders in every platform locale from the rule's real finding,
 * and its flow, written through the runtime gate, returns that advisory with
 * the same params and a `userMessage` the wire schema accepts.
 */
function pinCases(
  name: string,
  run: (stack: Record<string, unknown>) => readonly AutomationFinding[],
  cases: readonly AdvisoryCase[],
): void {
  const findingOf = (c: AdvisoryCase): AutomationFinding => {
    const found = run(c.stack).filter((f) => f.rule === c.rule);
    expect(found, `${c.label}: exactly one ${c.rule} finding`).toHaveLength(1);
    return found[0]!;
  };

  describe(`${name} user text · rendered from the rule's real findings`, () => {
    it.each(cases.map((c) => [c.label, c] as const))('%s: carries its params and renders in every platform locale', (_label, c) => {
      const finding = findingOf(c);
      expect(finding.severity).not.toBe('error');
      expect(finding.userTextParams).toEqual(c.params);

      const english = findingUserMessage(finding, ['en'])!;
      for (const tag of PLATFORM_LOCALE_TAGS) {
        const text = findingUserMessage(finding, [tag]);
        expect(text, `${c.rule} · ${tag}`).toBeTruthy();
        expect(text, `${c.rule} · ${tag}`).not.toMatch(/undefined|\$\{/);
        for (const shown of shownNamesOf(c.params)) expect(text, `${c.rule} · ${tag} names ${shown}`).toContain(shown);
        // A real translation, not the English floor standing in for it.
        if (tag !== 'en') expect(text, `${c.rule} · ${tag}`).not.toBe(english);
      }
    });

    it('renders each rule\'s arms apart in every platform locale', () => {
      const byRule = new Map<string, AdvisoryCase[]>();
      for (const c of cases) byRule.set(c.rule, [...(byRule.get(c.rule) ?? []), c]);
      for (const [rule, armCases] of byRule) {
        if (armCases.length < 2) continue;
        for (const tag of PLATFORM_LOCALE_TAGS) {
          const texts = armCases.map((c) => findingUserMessage(findingOf(c), [tag])!);
          expect(new Set(texts).size, `${rule} · ${tag}`).toBe(armCases.length);
        }
      }
    });
  });

  describe(`${name} user text · from the runtime gate to the wire field`, () => {
    it.each(cases.map((c) => [c.label, c] as const))('%s: the flow write returns the advisory with its params', (_label, c) => {
      const flows = c.stack.flows as unknown[];
      expect(flows, c.label).toHaveLength(1);
      const result = runRuntimeAuthoringRules({
        type: 'flow',
        item: flows[0],
        context: { objects: (c.stack.objects as unknown[] | undefined) ?? [] },
      });
      const advisory = result.advisories.find((f) => f.rule === c.rule);
      expect(advisory, `${c.label}: the gate returns the ${c.rule} advisory`).toBeDefined();
      expect(advisory!.userTextParams).toEqual(c.params);

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
      expect(issue.rule).toBe(c.rule);
      expect(issue.userMessage).toBe(findingUserMessage(advisory!, ['zh-Hans']));
      expect(issue.message).toBe(advisory!.message);
    });
  });
}

// ── validate-approval-approvers ─────────────────────────────────────────────

/** A one-node approval flow; `config` is merged into the approval node's. */
const approvalStack = (approvers: unknown[], config: Record<string, unknown> = {}) => ({
  flows: [{
    name: 'expense_approval',
    nodes: [
      { id: 'start', type: 'start', config: {} },
      { id: 'manager_review', type: 'approval', config: { approvers, ...config } },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'manager_review' }],
  }],
});
const AT = { flow: 'expense_approval', node: 'manager_review' };

const APPROVAL_CASES: readonly AdvisoryCase[] = [
  {
    label: 'an off-spec approver type with a canonical fix',
    rule: APPROVAL_APPROVER_TYPE_UNKNOWN,
    stack: approvalStack([{ type: 'business_unit', value: 'sales' }]),
    params: { ...AT, type: 'business_unit', suggested: 'department' },
  },
  {
    label: 'an off-spec approver type with no fix',
    rule: APPROVAL_APPROVER_TYPE_UNKNOWN,
    stack: approvalStack([{ type: 'robot', value: 'r1' }]),
    params: { ...AT, type: 'robot', suggested: '' },
  },
  {
    label: 'resolveAs on a non-expression approver',
    rule: APPROVAL_EXPRESSION_INVALID,
    stack: approvalStack([{ type: 'user', value: 'u_finance_lead', resolveAs: 'users' }]),
    params: { ...AT, type: 'user' },
  },
  {
    label: 'a position name authored as a membership level',
    rule: APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER,
    stack: approvalStack([{ type: 'org_membership_level', value: 'sales_manager' }]),
    params: { ...AT, value: 'sales_manager' },
  },
  {
    label: 'the deprecated role spelling',
    rule: APPROVAL_APPROVER_TYPE_DEPRECATED,
    stack: approvalStack([{ type: 'role', value: 'admin' }]),
    params: { ...AT, type: 'role', replacement: 'org_membership_level' },
  },
  {
    label: 'an all-position slate on a locking node',
    rule: APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
    stack: approvalStack([{ type: 'position', value: 'finance_manager' }]),
    params: { ...AT, slate: 'group', locked: 'yes' },
  },
  {
    label: 'an all-position slate on a node that does not lock',
    rule: APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
    stack: approvalStack([{ type: 'position', value: 'finance_manager' }], { lockRecord: false }),
    params: { ...AT, slate: 'group', locked: 'no' },
  },
  {
    label: 'an all-manager slate',
    rule: APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
    stack: approvalStack([{ type: 'manager' }]),
    params: { ...AT, slate: 'manager', locked: 'yes' },
  },
  {
    label: 'an expression approver with no empty-slate policy',
    rule: APPROVAL_EXPRESSION_NO_EMPTY_POLICY,
    stack: approvalStack([{ type: 'expression', value: 'current.approvers_dynamic' }]),
    params: { ...AT },
  },
  {
    label: 'a reassign escalation with no target',
    rule: APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
    stack: approvalStack([{ type: 'user', value: 'u_finance_lead' }], { escalation: { action: 'reassign' } }),
    params: { ...AT },
  },
];

pinCatalog('approval approvers', APPROVAL_APPROVERS_USER_TEXT, [
  APPROVAL_APPROVER_TYPE_UNKNOWN,
  APPROVAL_EXPRESSION_INVALID,
  APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER,
  APPROVAL_APPROVER_TYPE_DEPRECATED,
  APPROVAL_APPROVER_TYPE_UNSUPPORTED,
  APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
  APPROVAL_EXPRESSION_NO_EMPTY_POLICY,
  APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
]);
pinCases('approval approvers', validateApprovalApprovers, APPROVAL_CASES);

describe('approval approvers user text · the arms say what the finding found', () => {
  const en = (label: string) => findingUserMessage(
    validateApprovalApprovers(APPROVAL_CASES.find((c) => c.label === label)!.stack)
      .find((f) => f.rule === APPROVAL_CASES.find((c) => c.label === label)!.rule)!,
    ['en'],
  )!;

  it('offers the canonical type only where the rule has one', () => {
    expect(en('an off-spec approver type with a canonical fix')).toContain('Change the type to "department"');
    expect(en('an off-spec approver type with no fix')).toContain('Choose one of the approver types');
  });

  it('says the record stays locked only on a locking node, and names the cause of each slate', () => {
    expect(en('an all-position slate on a locking node')).toContain('the record stays locked');
    expect(en('an all-position slate on a node that does not lock')).not.toContain('locked');
    expect(en('an all-manager slate')).toContain('has no manager set');
  });

  it('an expression-invalid refusal carries no params, so it never renders the advisory\'s sentence', () => {
    const refusal = validateApprovalApprovers(approvalStack([{ type: 'expression', value: '' }]))
      .find((f) => f.rule === APPROVAL_EXPRESSION_INVALID)!;
    expect(refusal.severity).toBe('error');
    expect(refusal.userTextParams).toBeUndefined();
    expect(findingUserMessage(refusal, ['zh-CN'])).toBeUndefined();
  });
});

// ── validate-flow-trigger-readiness ─────────────────────────────────────────

const CANDIDATE = { name: 'app_candidate', label: 'Candidate', fields: { name: { type: 'text', label: 'Name' } } };

/** A screen flow whose start input `variables` are declared; `nodes` follow its start node. */
const inputFlowStack = (variables: unknown[], nodes: unknown[] = [], objects: unknown[] = [CANDIDATE]) => ({
  objects,
  flows: [{
    name: 'review_candidates',
    type: 'screen',
    variables,
    nodes: [{ id: 'start', type: 'start', config: {} }, ...nodes],
    edges: [],
  }],
});

const FLOW_TRIGGER_CASES: readonly AdvisoryCase[] = [
  {
    label: 'a record trigger on an object the stack does not define',
    rule: FLOW_TRIGGER_UNKNOWN_OBJECT,
    stack: {
      objects: [CANDIDATE],
      flows: [{
        name: 'notify_on_hire',
        type: 'record_change',
        status: 'active',
        nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'candidate' } }],
        edges: [],
      }],
    },
    params: { flow: 'notify_on_hire', object: 'candidate', trigger: 'record' },
  },
  {
    label: 'a time-relative sweep of an object the stack does not define',
    rule: FLOW_TRIGGER_UNKNOWN_OBJECT,
    stack: {
      objects: [CANDIDATE],
      flows: [{
        name: 'remind_before_interview',
        type: 'schedule',
        status: 'active',
        nodes: [{
          id: 'start',
          type: 'start',
          config: { timeRelative: { object: 'interview', dateField: 'scheduled_at', offset: { value: -1, unit: 'days' } } },
        }],
        edges: [],
      }],
    },
    params: { flow: 'remind_before_interview', object: 'interview', trigger: 'schedule' },
  },
  {
    label: 'a start input declared a record of an undefined object',
    rule: FLOW_INPUT_UNKNOWN_OBJECT,
    stack: inputFlowStack([{ name: 'candidateId', type: 'text', isInput: true, objectName: 'app_candidat' }]),
    params: { flow: 'review_candidates', input: 'candidateId', object: 'app_candidat' },
  },
  {
    label: 'a start input declared a record of the object-less placeholder',
    rule: FLOW_INPUT_OBJECT_LESS,
    stack: inputFlowStack(
      [{ name: 'recordId', type: 'text', isInput: true, objectName: 'global' }],
      [],
      [CANDIDATE, { name: 'global', label: 'Global', fields: {} }],
    ),
    params: { flow: 'review_candidates', input: 'recordId' },
  },
  {
    label: 'one declared record id read as a list',
    rule: FLOW_INPUT_RECORD_READ_AS_LIST,
    stack: inputFlowStack(
      [{ name: 'candidateIds', type: 'text', isInput: true, objectName: 'app_candidate' }],
      [{
        id: 'load',
        type: 'get_record',
        label: 'Load candidates',
        config: { objectName: 'app_candidate', filter: { id: { $in: { dialect: 'cel', source: 'candidateIds' } } } },
      }],
    ),
    params: {
      flow: 'review_candidates', input: 'candidateIds', object: 'app_candidate', node: 'Load candidates',
      listObject: 'app_candidate',
    },
  },
  {
    label: 'an auto-triggered flow left in draft',
    rule: FLOW_DRAFT_STATUS_AMBIGUOUS,
    stack: {
      objects: [CANDIDATE],
      flows: [{
        name: 'welcome_candidate',
        type: 'record_change',
        nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-create', objectName: 'app_candidate' } }],
        edges: [],
      }],
    },
    params: { flow: 'welcome_candidate' },
  },
];

pinCatalog('flow trigger readiness', FLOW_TRIGGER_READINESS_USER_TEXT, [
  FLOW_TRIGGER_UNKNOWN_OBJECT,
  FLOW_INPUT_UNKNOWN_OBJECT,
  FLOW_INPUT_OBJECT_LESS,
  FLOW_INPUT_RECORD_READ_AS_LIST,
  FLOW_DRAFT_STATUS_AMBIGUOUS,
]);
pinCases('flow trigger readiness', (stack) => validateFlowTriggerReadiness(stack), FLOW_TRIGGER_CASES);

describe('flow trigger readiness user text · a refusal under a package closure renders no advisory sentence', () => {
  it('the closure\'s unknown-object refusal carries no params', () => {
    const refusal = validateFlowTriggerReadiness(FLOW_TRIGGER_CASES[0]!.stack, {
      packageScope: { packageId: 'app_recruiting', dependencies: [] },
    }).find((f) => f.rule === FLOW_TRIGGER_UNKNOWN_OBJECT)!;
    expect(refusal.severity).toBe('error');
    expect(refusal.userTextParams).toBeUndefined();
    expect(findingUserMessage(refusal, ['zh-CN'])).toBeUndefined();
  });
});

// ── validate-flow-template-paths ────────────────────────────────────────────

const LEAD = {
  name: 'crm_lead',
  fields: {
    company: { name: 'company', type: 'text' },
    crm_account: { name: 'crm_account', type: 'lookup', reference: 'crm_account' },
  },
};
const EXTERNAL_CUSTOMER = {
  name: 'ext_customer',
  external: { remoteName: 'customers' },
  fields: { email: { name: 'email', type: 'text' } },
};
/** A record-change flow on `object` with one notify node carrying `title`; `extra` nodes follow it. */
const templateStack = (object: { name: string }, title: string, extra: unknown[] = []) => ({
  objects: [object, ...(object === LEAD ? [] : [LEAD])],
  flows: [{
    name: 'notify_owner',
    type: 'record_change',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', config: { objectName: object.name, triggerType: 'record-after-create' } },
      ...extra,
      { id: 'n1', type: 'notify', notify: { title, body: 'x' } },
    ],
    edges: [],
  }],
});

const FLOW_TEMPLATE_CASES: readonly AdvisoryCase[] = [
  {
    label: 'a placeholder naming no field',
    rule: FLOW_TEMPLATE_UNKNOWN_FIELD,
    stack: templateStack(LEAD, 'New lead: {{ record.compnay }}'),
    params: { flow: 'notify_owner', reference: 'record.compnay', field: 'compnay', object: 'crm_lead' },
  },
  {
    label: 'a hop through the trigger record\'s lookup',
    rule: FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
    stack: templateStack(LEAD, 'From {{ record.crm_account.name }}'),
    params: {
      flow: 'notify_owner', reference: 'record.crm_account.name', field: 'crm_account', object: 'crm_lead',
      root: 'trigger',
    },
  },
  {
    label: 'a hop through a bound variable\'s lookup',
    rule: FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
    stack: templateStack(LEAD, 'Account {{ lead.crm_account.name }}', [{
      id: 'get_lead',
      type: 'get_record',
      config: { objectName: 'crm_lead', outputVariable: 'lead', filter: { id: { dialect: 'cel', source: 'record.id' } } },
    }]),
    params: {
      flow: 'notify_owner', reference: 'lead.crm_account.name', field: 'crm_account', object: 'crm_lead',
      root: 'variable',
    },
  },
  {
    label: 'a placeholder over an external object\'s unprovisioned anchor',
    rule: FLOW_TEMPLATE_FIELD_UNPROVISIONED,
    stack: templateStack(EXTERNAL_CUSTOMER, 'Owned by {{ record.owner_id }}'),
    params: { flow: 'notify_owner', reference: 'record.owner_id', field: 'owner_id', object: 'ext_customer' },
  },
];

pinCatalog('flow template paths', FLOW_TEMPLATE_PATHS_USER_TEXT, [
  FLOW_TEMPLATE_UNKNOWN_FIELD,
  FLOW_TEMPLATE_LOOKUP_TRAVERSAL,
  FLOW_TEMPLATE_FIELD_UNPROVISIONED,
]);
pinCases('flow template paths', validateFlowTemplatePaths, FLOW_TEMPLATE_CASES);

// ── validate-flow-node-writes · validate-readonly-flow-writes · lint-flow-credential-literals ──

const WH_ORDER = {
  name: 'wh_order',
  datasource: 'warehouse',
  external: { remoteName: 'fact_orders' },
  fields: { order_id: { type: 'text' }, amount: { type: 'currency' } },
};
const DEAL = {
  name: 'crm_deal',
  fields: {
    stage: { type: 'text' },
    discount: { type: 'percent', readonlyWhen: "record.stage == 'closed_won'" },
  },
};
/** A record-change flow whose second node is `node`. */
const oneNodeFlowStack = (name: string, objects: unknown[], node: Record<string, unknown>) => ({
  objects,
  flows: [{
    name,
    type: 'record_change',
    status: 'active',
    runAs: 'user',
    nodes: [{ id: 'start', type: 'start', config: {} }, node],
    edges: [],
  }],
});

const FLOW_NODE_WRITE_CASES: readonly AdvisoryCase[] = [
  {
    label: 'an update writing an external object\'s unprovisioned anchor',
    rule: FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR,
    stack: oneNodeFlowStack('stamp_owner', [WH_ORDER], {
      id: 'mark',
      type: 'update_record',
      label: 'Stamp',
      config: { objectName: 'wh_order', filter: { id: { dialect: 'cel', source: 'recordId' } }, fields: { owner_id: '{user.id}' } },
    }),
    params: { flow: 'stamp_owner', node: 'Stamp', field: 'owner_id', object: 'wh_order' },
  },
];

const READONLY_FLOW_WRITE_CASES: readonly AdvisoryCase[] = [
  {
    label: 'an update writing a readonlyWhen field',
    rule: FLOW_UPDATE_READONLY_WHEN_FIELD,
    stack: oneNodeFlowStack('apply_discount', [DEAL], {
      id: 'set_discount',
      type: 'update_record',
      label: 'Set discount',
      config: { objectName: 'crm_deal', filter: { id: { dialect: 'cel', source: 'recordId' } }, fields: { discount: 10 } },
    }),
    params: { flow: 'apply_discount', node: 'Set discount', field: 'discount', object: 'crm_deal' },
  },
];

/** A flow with one credential-shaped literal at `position`. */
const credentialStack = (node: Record<string, unknown>) => ({
  flows: [{
    name: 'sync_invoices',
    type: 'autolaunched',
    status: 'active',
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, node],
    edges: [],
  }],
});

const FLOW_CREDENTIAL_CASES: readonly AdvisoryCase[] = [
  {
    label: 'a credential in an http header',
    rule: FLOW_CREDENTIAL_LITERAL,
    stack: credentialStack({
      id: 'push_invoice', type: 'http',
      config: { url: 'https://billing.invalid/invoices', method: 'POST', headers: { Authorization: 'Bearer user-text-probe-1' } },
    }),
    params: { flow: 'sync_invoices', node: 'push_invoice', name: 'Authorization', position: 'header' },
  },
  {
    label: 'a credential in a url query parameter',
    rule: FLOW_CREDENTIAL_LITERAL,
    stack: credentialStack({
      id: 'push_invoice', type: 'http',
      config: { url: 'https://billing.invalid/invoices?api_key=user-text-probe-2', method: 'POST' },
    }),
    params: { flow: 'sync_invoices', node: 'push_invoice', name: 'api_key', position: 'query' },
  },
  {
    label: 'a credential in a connector input',
    rule: FLOW_CREDENTIAL_LITERAL,
    stack: credentialStack({
      id: 'push_invoice', type: 'connector_action',
      connectorConfig: { connectorId: 'rest', actionId: 'request', input: { token: 'user-text-probe-3', path: '/p' } },
    }),
    params: { flow: 'sync_invoices', node: 'push_invoice', name: 'token', position: 'input' },
  },
];

pinCatalog('flow node writes', FLOW_NODE_WRITES_USER_TEXT, [FLOW_NODE_WRITE_UNPROVISIONED_ANCHOR]);
pinCases('flow node writes', validateFlowNodeWrites, FLOW_NODE_WRITE_CASES);
pinCatalog('readonly flow writes', READONLY_FLOW_WRITES_USER_TEXT, [FLOW_UPDATE_READONLY_WHEN_FIELD]);
pinCases('readonly flow writes', validateReadonlyFlowWrites, READONLY_FLOW_WRITE_CASES);
pinCatalog('flow credential literals', FLOW_CREDENTIAL_LITERALS_USER_TEXT, [FLOW_CREDENTIAL_LITERAL]);
pinCases('flow credential literals', lintFlowCredentialLiterals, FLOW_CREDENTIAL_CASES);

describe('flow credential literals user text · never the value', () => {
  it('no sentence in any locale carries the credential, the save door\'s copy included', () => {
    for (const c of FLOW_CREDENTIAL_CASES) {
      const [finding] = lintFlowCredentialLiterals(c.stack);
      for (const tag of PLATFORM_LOCALE_TAGS) {
        expect(findingUserMessage(finding!, [tag]), `${c.label} · ${tag}`).not.toMatch(/user-text-probe/);
      }
    }
  });

  it('the registry entry\'s re-map keeps the params, so the door can render the sentence', () => {
    const result = runRuntimeAuthoringRules({ type: 'flow', item: (FLOW_CREDENTIAL_CASES[0]!.stack.flows as unknown[])[0] });
    const advisory = result.advisories.find((f) => f.rule === FLOW_CREDENTIAL_LITERAL)!;
    expect(result.rulesRun).toContain('lintFlowCredentialLiterals');
    expect(findingUserMessage(advisory, ['ja-JP'])).toContain('ヘッダー「Authorization」');
  });
});
